// Encoded-media cache: Cache Storage holds immutable hash-addressed responses;
// IndexedDB holds sizes, access times and offline-kit pins. This module is the
// only writer of media into Cache Storage (the service worker handles the shell).
import { dbDelete, dbGet, dbGetAll, dbPut, requestPersistentStorage, STORES } from './db'

export const MEDIA_CACHE = 'drums-media-v1'
export const CATALOG_CACHE = 'drums-catalog-v1'
export const MEDIA_CAP_BYTES = 200 * 1024 * 1024

export interface MediaRecord {
  url: string
  sha256: string
  bytes: number
  lastAccess: number
}

export interface OfflineKitRecord {
  kitId: string
  revision: string
  label: string
  /** Every media URL (with hash) this kit needs offline. */
  entries: { url: string; sha256: string }[]
  /** Catalog JSON URLs (index + manifest) to keep for this kit. */
  catalogUrls: string[]
  savedAt: string
  /** Set only after every entry was verified present. */
  verified: boolean
}

export type StorageWarning = string | null

const hasCaches = () => typeof caches !== 'undefined'

async function sha256Hex(data: ArrayBuffer) {
  const d = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export class MediaCache {
  private records = new Map<string, MediaRecord>()
  private offline = new Map<string, OfflineKitRecord>()
  private ready: Promise<void>
  private listeners = new Set<() => void>()
  private dirtyAccess = new Set<string>()
  private flushTimer = 0
  warning: StorageWarning = null
  /** Bytes fetched from the network this session (diagnostics). */
  networkBytes = 0
  networkFetches = 0
  cacheHits = 0

  constructor() {
    this.ready = this.reconcile().catch((e) => {
      this.warn(`Downloaded sounds cannot be stored on this device (${(e as Error).message}). Sounds will load each session.`)
    })
  }

  private version = 0
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  /** Changes whenever cache contents, pins or warnings change (for useSyncExternalStore). */
  getSnapshot = () => this.version
  private emit() {
    this.version++
    for (const l of this.listeners) l()
  }
  private warn(msg: string) {
    this.warning = msg
    this.emit()
  }

  /** Drop metadata for entries the browser evicted; adopt entries whose metadata write was interrupted. */
  async reconcile() {
    if (!hasCaches()) throw new Error('Cache Storage unavailable')
    const [records, kits, cache] = await Promise.all([
      dbGetAll<MediaRecord>(STORES.media),
      dbGetAll<OfflineKitRecord>(STORES.offlineKits),
      caches.open(MEDIA_CACHE),
    ])
    const keys = new Set((await cache.keys()).map((r) => r.url))
    for (const r of records) {
      if (keys.has(r.url)) this.records.set(r.url, r)
      else await dbDelete(STORES.media, r.url)
    }
    for (const url of keys) {
      if (this.records.has(url)) continue
      // Cached without metadata: an interrupted write. Keep it only if we can size it.
      const res = await cache.match(url)
      const sha = url.match(/([0-9a-f]{64})\.[a-z0-9]+$/)?.[1]
      if (!res || !sha) {
        await cache.delete(url)
        continue
      }
      const data = await res.arrayBuffer()
      if ((await sha256Hex(data)) !== sha) {
        await cache.delete(url)
        continue
      }
      const rec = { url, sha256: sha, bytes: data.byteLength, lastAccess: 0 }
      this.records.set(url, rec)
      await dbPut(STORES.media, rec)
    }
    for (const k of kits) {
      const complete = k.entries.every((e) => this.records.has(e.url))
      const next = { ...k, verified: complete }
      this.offline.set(k.kitId, next)
      if (next.verified !== k.verified) await dbPut(STORES.offlineKits, next)
    }
    this.emit()
  }

  get usedBytes() {
    let n = 0
    for (const r of this.records.values()) n += r.bytes
    return n
  }

  async budget(): Promise<number> {
    try {
      const est = await navigator.storage?.estimate?.()
      if (est?.quota && est.usage !== undefined) {
        const headroom = est.quota - est.usage
        return Math.max(0, Math.min(MEDIA_CAP_BYTES, this.usedBytes + headroom * 0.8))
      }
    } catch {
      /* fall through */
    }
    return MEDIA_CAP_BYTES
  }

  private pinnedUrls() {
    const s = new Set<string>()
    for (const k of this.offline.values()) for (const e of k.entries) s.add(e.url)
    return s
  }

  /**
   * Fetch an immutable media file: Cache Storage first, then network. Network
   * bytes are hash-checked, then cached. Cache failures fall back to
   * session-only playback.
   */
  async fetch(url: string, sha256: string): Promise<ArrayBuffer> {
    await this.ready
    if (hasCaches()) {
      try {
        const hit = await (await caches.open(MEDIA_CACHE)).match(url)
        if (hit) {
          const data = await hit.arrayBuffer()
          this.cacheHits++
          this.touch(url)
          return data
        }
      } catch {
        /* treat as miss */
      }
    }
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.arrayBuffer()
    this.networkBytes += data.byteLength
    this.networkFetches++
    if ((await sha256Hex(data)) !== sha256) throw new Error('downloaded file does not match its checksum')
    // Copy now: decodeAudioData detaches the returned buffer before the async write runs.
    void this.store(url, sha256, data.slice(0), res.headers.get('content-type') ?? 'audio/wav')
    return data
  }

  private async store(url: string, sha256: string, data: ArrayBuffer, type: string) {
    if (!hasCaches()) return
    try {
      await this.makeRoom(data.byteLength)
      const cache = await caches.open(MEDIA_CACHE)
      await cache.put(url, new Response(data, { headers: { 'content-type': type, 'content-length': String(data.byteLength) } }))
      const rec = { url, sha256, bytes: data.byteLength, lastAccess: Date.now() }
      this.records.set(url, rec)
      await dbPut(STORES.media, rec)
      // An incomplete offline kit becomes complete again once every entry is back.
      for (const k of this.offline.values()) {
        if (!k.verified && k.entries.some((e) => e.url === url) && k.entries.every((e) => this.records.has(e.url))) {
          const fixed = { ...k, verified: true }
          this.offline.set(k.kitId, fixed)
          await dbPut(STORES.offlineKits, fixed)
        }
      }
      this.emit()
    } catch (e) {
      const quota = (e as DOMException)?.name === 'QuotaExceededError'
      this.warn(quota ? 'Device storage is full. New sounds play this session only.' : `Could not store a sound (${(e as Error).message}); it will play this session only.`)
    }
  }

  private touch(url: string) {
    const r = this.records.get(url)
    if (!r) return
    r.lastAccess = Date.now()
    this.dirtyAccess.add(url)
    if (!this.flushTimer) {
      this.flushTimer = window.setTimeout(() => {
        this.flushTimer = 0
        const urls = [...this.dirtyAccess]
        this.dirtyAccess.clear()
        for (const u of urls) {
          const rec = this.records.get(u)
          if (rec) void dbPut(STORES.media, rec).catch(() => {})
        }
      }, 2000)
    }
  }

  /** Evict unpinned least-recently-used entries until `incoming` bytes fit. Pinned kits are never evicted. */
  private async makeRoom(incoming: number) {
    const budget = await this.budget()
    let used = this.usedBytes
    if (used + incoming <= budget) return
    const pinned = this.pinnedUrls()
    const victims = [...this.records.values()].filter((r) => !pinned.has(r.url)).sort((a, b) => a.lastAccess - b.lastAccess)
    const cache = await caches.open(MEDIA_CACHE)
    for (const v of victims) {
      if (used + incoming <= budget) break
      await cache.delete(v.url)
      await dbDelete(STORES.media, v.url)
      this.records.delete(v.url)
      used -= v.bytes
    }
    if (used + incoming > budget) {
      throw new DOMException('Saved offline kits fill the storage budget', 'QuotaExceededError')
    }
  }

  // ---- offline kits --------------------------------------------------------------
  offlineStatus(kitId: string): 'none' | 'saved' | 'incomplete' {
    const k = this.offline.get(kitId)
    if (!k) return 'none'
    return k.verified ? 'saved' : 'incomplete'
  }

  offlineKits() {
    return [...this.offline.values()]
  }

  offlineBytes(kitId: string) {
    const k = this.offline.get(kitId)
    if (!k) return 0
    return k.entries.reduce((n, e) => n + (this.records.get(e.url)?.bytes ?? 0), 0)
  }

  /**
   * Download and pin everything a kit needs offline, then verify each entry is
   * present before marking it saved.
   */
  async saveKitOffline(rec: Omit<OfflineKitRecord, 'savedAt' | 'verified'>, onProgress?: (done: number, total: number) => void) {
    await this.ready
    if (!hasCaches()) throw new Error('This browser cannot store files for offline use.')
    requestPersistentStorage()
    // Pin first so eviction during the download cannot remove earlier entries.
    const pending: OfflineKitRecord = { ...rec, savedAt: new Date().toISOString(), verified: false }
    this.offline.set(rec.kitId, pending)
    await dbPut(STORES.offlineKits, pending)
    this.emit()
    const fail = async (message: string): Promise<never> => {
      // Leave no half-saved pin behind: the kit is either saved offline or not.
      this.offline.delete(rec.kitId)
      await dbDelete(STORES.offlineKits, rec.kitId).catch(() => {})
      this.emit()
      throw new Error(message)
    }
    let done = 0
    onProgress?.(0, rec.entries.length)
    try {
      for (const e of rec.entries) {
        if (!this.records.has(e.url)) {
          const res = await fetch(e.url)
          if (!res.ok) return await fail(`A sound in ${rec.label} returned HTTP ${res.status}. Retry later.`)
          const data = await res.arrayBuffer()
          this.networkBytes += data.byteLength
          this.networkFetches++
          if ((await sha256Hex(data)) !== e.sha256) return await fail(`A sound in ${rec.label} failed its checksum. Retry later.`)
          await this.store(e.url, e.sha256, data, res.headers.get('content-type') ?? 'audio/wav')
        }
        onProgress?.(++done, rec.entries.length)
      }
      // Catalog snapshot for offline launch.
      const catCache = await caches.open(CATALOG_CACHE)
      for (const u of rec.catalogUrls) {
        if (!(await catCache.match(u))) {
          const res = await fetch(u)
          if (res.ok) await catCache.put(u, res)
        }
      }
    } catch (e) {
      if ((e as Error).message.startsWith('A sound in')) throw e
      const quota = (e as DOMException)?.name === 'QuotaExceededError'
      return await fail(quota ? `Not enough device storage to save ${rec.label} offline.` : `Could not save ${rec.label} offline: ${(e as Error).message}`)
    }
    const verified = await this.verify(rec.entries.map((e) => e.url))
    if (!verified) return await fail(`Not enough device storage to save ${rec.label} offline.`)
    const final = { ...pending, verified }
    this.offline.set(rec.kitId, final)
    await dbPut(STORES.offlineKits, final)
    this.emit()
  }

  private async verify(urls: string[]) {
    const cache = await caches.open(MEDIA_CACHE)
    for (const u of urls) if (!this.records.has(u) || !(await cache.match(u))) return false
    return true
  }

  /** Unpin a kit. Its files stay as ordinary evictable cache entries. */
  async removeKitOffline(kitId: string) {
    this.offline.delete(kitId)
    await dbDelete(STORES.offlineKits, kitId)
    this.emit()
  }

  /** Delete all downloaded media and offline pins. Patterns and draft are untouched. */
  async clearAll() {
    if (hasCaches()) {
      await caches.delete(MEDIA_CACHE)
    }
    for (const url of this.records.keys()) await dbDelete(STORES.media, url)
    for (const id of this.offline.keys()) await dbDelete(STORES.offlineKits, id)
    this.records.clear()
    this.offline.clear()
    this.warning = null
    this.emit()
  }

  hasRecord(url: string) {
    return this.records.has(url)
  }
}

/**
 * Catalog JSON fetch: network first (revalidating), falling back to the last
 * good copy in Cache Storage when offline. Callers store a copy with
 * rememberCatalogJson only after it validates.
 */
export async function fetchCatalogJson(url: string, opts: { revalidate: boolean }): Promise<Response> {
  try {
    const res = await fetch(url, opts.revalidate ? { cache: 'no-cache' } : undefined)
    if (res.ok || !hasCaches()) return res
    const cached = await (await caches.open(CATALOG_CACHE)).match(url)
    return cached ?? res
  } catch (e) {
    if (hasCaches()) {
      const cached = await (await caches.open(CATALOG_CACHE)).match(url)
      if (cached) return cached
    }
    throw e
  }
}

/** Keep a validated catalog document as the last known good copy. */
export async function rememberCatalogJson(url: string, value: unknown) {
  if (!hasCaches()) return
  try {
    const c = await caches.open(CATALOG_CACHE)
    await c.put(url, new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } }))
  } catch {
    /* session-only */
  }
}

export async function getOfflineKit(kitId: string) {
  return dbGet<OfflineKitRecord>(STORES.offlineKits, kitId)
}
