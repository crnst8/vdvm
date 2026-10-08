// Decoded AudioBuffer store keyed by blob hash. Bounded fetch/decode
// concurrency, in-flight deduplication, pinning and an LRU decoded budget.

import { normalisedGainDb } from './loudness'

export const DECODED_BUDGET_BYTES = 64 * 1024 * 1024
export const MAX_FETCHES = 4
export const MAX_DECODES = 2

export interface Decoder {
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>
}

export type Fetcher = (url: string, sha256: string) => Promise<ArrayBuffer>

class Limiter {
  private active = 0
  private waiting: (() => void)[] = []
  private max: number
  constructor(max: number) {
    this.max = max
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.waiting.push(r))
    this.active++
    try {
      return await fn()
    } finally {
      this.active--
      this.waiting.shift()?.()
    }
  }
}

export const decodedBytes = (b: Pick<AudioBuffer, 'length' | 'numberOfChannels'>) => b.length * b.numberOfChannels * 4

interface Entry {
  buffer: AudioBuffer
  bytes: number
  lastUsed: number
}

export interface LoadRequest {
  sha256: string
  url: string
}

export class BufferStore {
  private entries = new Map<string, Entry>()
  private inflight = new Map<string, Promise<AudioBuffer>>()
  private pins = new Map<string, Set<string>>() // pin set name -> hashes
  private fetchLimit = new Limiter(MAX_FETCHES)
  private decodeLimit = new Limiter(MAX_DECODES)
  private clock = 0
  private decoder: Decoder
  private fetcher: Fetcher
  readonly budget: number
  stats = { fetches: 0, decodes: 0, fetchedBytes: 0 }

  constructor(decoder: Decoder, fetcher: Fetcher, budget = DECODED_BUDGET_BYTES) {
    this.decoder = decoder
    this.fetcher = fetcher
    this.budget = budget
  }

  /** Synchronous lookup for the trigger path. */
  get(sha256: string): AudioBuffer | undefined {
    const e = this.entries.get(sha256)
    if (e) e.lastUsed = ++this.clock
    return e?.buffer
  }

  has(sha256: string) {
    return this.entries.has(sha256)
  }

  get usedBytes() {
    let n = 0
    for (const e of this.entries.values()) n += e.bytes
    return n
  }

  load(req: LoadRequest): Promise<AudioBuffer> {
    const hit = this.get(req.sha256)
    if (hit) return Promise.resolve(hit)
    const pending = this.inflight.get(req.sha256)
    if (pending) return pending
    const p = (async () => {
      const data = await this.fetchLimit.run(async () => {
        this.stats.fetches++
        const d = await this.fetcher(req.url, req.sha256)
        this.stats.fetchedBytes += d.byteLength
        return d
      })
      const buffer = await this.decodeLimit.run(() => {
        this.stats.decodes++
        return this.decoder.decodeAudioData(data)
      })
      // Measure loudness here so the trigger path only reads the cached gain.
      normalisedGainDb(buffer)
      this.entries.set(req.sha256, { buffer, bytes: decodedBytes(buffer), lastUsed: ++this.clock })
      this.evict()
      return buffer
    })().finally(() => this.inflight.delete(req.sha256))
    this.inflight.set(req.sha256, p)
    return p
  }

  /** Estimated decoded size for a sample before loading. */
  static estimate(durationSec: number, channels: number, contextRate: number) {
    return Math.ceil(durationSec * contextRate) * channels * 4
  }

  /**
   * Load a named set of samples and pin it. Rejects without loading when the
   * set cannot fit alongside other pinned sets.
   */
  async loadSet(
    name: string,
    reqs: LoadRequest[],
    estimatedBytes: number,
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    const others = this.pinnedBytes(name)
    if (others + estimatedBytes > this.budget) {
      throw new Error(`Kit needs ${Math.ceil(estimatedBytes / 1048576)} MiB of decoded audio; not enough memory budget`)
    }
    this.pins.set(name, new Set(reqs.map((r) => r.sha256)))
    let done = 0
    onProgress?.(0, reqs.length)
    await Promise.all(
      reqs.map((r) =>
        this.load(r).then(() => {
          done++
          onProgress?.(done, reqs.length)
        }),
      ),
    )
  }

  unpin(name: string) {
    this.pins.delete(name)
    this.evict()
  }

  /** Rename a pin set (staging -> active) without touching buffers. */
  movePin(from: string, to: string) {
    const set = this.pins.get(from)
    this.pins.delete(from)
    if (set) this.pins.set(to, set)
    this.evict()
  }

  addToPin(name: string, sha256: string) {
    const set = this.pins.get(name) ?? new Set<string>()
    set.add(sha256)
    this.pins.set(name, set)
  }

  private isPinned(hash: string) {
    for (const s of this.pins.values()) if (s.has(hash)) return true
    return false
  }

  private pinnedBytes(exclude?: string) {
    const hashes = new Set<string>()
    for (const [name, s] of this.pins) if (name !== exclude) for (const h of s) hashes.add(h)
    let n = 0
    for (const h of hashes) n += this.entries.get(h)?.bytes ?? 0
    return n
  }

  private evict() {
    let used = this.usedBytes
    if (used <= this.budget) return
    const candidates = [...this.entries.entries()]
      .filter(([h]) => !this.isPinned(h))
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed)
    for (const [h, e] of candidates) {
      if (used <= this.budget) break
      this.entries.delete(h)
      used -= e.bytes
    }
  }
}
