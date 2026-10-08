// Transport: connects catalog kits, decoded buffers, the voice engine and the
// step scheduler. Lives outside React; UI subscribes through subscribe()/snapshot.
import type { KitManifest, Sample, Slot } from '../contract/types'
import { AudioEngine, type AudioContextLike } from './engine'
import { BufferStore, type Fetcher, type LoadRequest } from './buffers'
import { LOOKAHEAD_SEC, StepScheduler, type SchedulerDeps } from './scheduler'
import { hitGainDb, hitPitchCents, type PatternState } from '../state/pattern'
import { circuitFor } from '../data/timing'
import { machineSwing, StepJitter } from './circuit'
import { hitPlaybackDb } from './loudness'

export type AudioStatus = 'locked' | 'running' | 'suspended'
export type KitStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface TransportSnapshot {
  audio: AudioStatus
  kitStatus: KitStatus
  kitId: string | null
  pendingKitId: string | null
  progress: { done: number; total: number }
  playing: boolean
  error: string | null
  notice: string | null
  /** Plugin in a host only: tempo from the host (sync) or the panel (free), and the host's tempo when it reports one. */
  host?: { sync: boolean; bpm: number | null }
}

interface PreparedKit {
  kit: KitManifest
  slots: { slot: Slot; samples: Map<string, Sample> }[]
}

const ACTIVE = 'active'
const SUSPENDED_NOTICE = 'Audio paused by the system. Tap ON/OFF to resume.'
const STAGING = 'staging'

function prepare(kit: KitManifest): PreparedKit {
  const byId = new Map(kit.samples.map((s) => [s.id, s]))
  return {
    kit,
    slots: kit.slots.map((slot) => ({
      slot,
      samples: new Map(slot.sampleIds.map((id) => [id, byId.get(id)!] as const).filter(([, s]) => s)),
    })),
  }
}

/**
 * The sample a slot plays under the given pattern. Without a track: the slot
 * default. With a track whose variant this kit lacks: undefined (the slot is
 * silent and flagged missing; the reference is kept, never silently replaced).
 */
export function chosenSample(kit: KitManifest, slot: Slot, pattern: PatternState | null): Sample | undefined {
  // A pattern bound to another kit (mid-switch) says nothing about this kit's variants.
  const want = pattern && pattern.kitId === kit.id ? pattern.tracks[slot.id]?.sampleId : undefined
  const id = want ?? slot.defaultSampleId
  if (!slot.sampleIds.includes(id)) return undefined
  return kit.samples.find((s) => s.id === id)
}

export interface TransportDeps {
  createContext: () => AudioContextLike & { decodeAudioData(d: ArrayBuffer): Promise<AudioBuffer>; onstatechange: unknown }
  fetcher: Fetcher
  resolveUrl: (rel: string) => string
  /** Runs inside every unlocking user gesture (iOS audio session setup). */
  onGesture?: () => void
  /** Runs synchronously when playback starts or stops (inside the gesture when there is one). */
  onPlayingChange?: (playing: boolean) => void
  /** Scheduler wake-up timer; defaults to setInterval. */
  timer?: Pick<SchedulerDeps, 'setTimer' | 'clearTimer'>
}

export class Transport {
  private deps: TransportDeps
  private ctx: ReturnType<TransportDeps['createContext']> | null = null
  private engine: AudioEngine | null = null
  buffers: BufferStore | null = null
  private scheduler: StepScheduler
  private active: PreparedKit | null = null
  private pending: PreparedKit | null = null
  private kitGeneration = 0
  private pattern: PatternState | null = null
  private listeners = new Set<() => void>()
  private snap: TransportSnapshot = {
    audio: 'locked', kitStatus: 'idle', kitId: null, pendingKitId: null,
    progress: { done: 0, total: 0 }, playing: false, error: null, notice: null,
  }
  /** Listener output gain in dB, kept before the context exists. */
  private outputDb = 0
  /** Handler-to-start() durations in ms for ready audition triggers. */
  triggerTimings: number[] = []

  constructor(deps: TransportDeps) {
    this.deps = deps
    this.scheduler = new StepScheduler({
      now: () => this.ctx?.currentTime ?? 0,
      getBpm: () => this.pattern?.bpm ?? 120,
      getLength: () => this.pattern?.length ?? 16,
      getSwing: () => this.effectiveSwing(),
      scheduleStep: (step, when, gen) => this.scheduleStep(step, when, gen),
      ...deps.timer,
    })
  }

  // --- subscription -------------------------------------------------------
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getSnapshot = () => this.snap
  private set(patch: Partial<TransportSnapshot>) {
    this.snap = { ...this.snap, ...patch }
    for (const l of this.listeners) l()
  }

  /** Show a recoverable error without changing kit or transport state. */
  reportError(message: string | null) {
    this.set({ error: message })
  }

  // --- context ------------------------------------------------------------
  private ensureContext() {
    if (this.ctx) return this.ctx
    const ctx = this.deps.createContext()
    this.ctx = ctx
    this.engine = new AudioEngine(ctx)
    if (this.outputDb !== 0) this.engine.setOutputGain(this.outputDb)
    this.buffers = new BufferStore(ctx, this.deps.fetcher)
    ctx.onstatechange = () => this.onContextState()
    this.onContextState()
    return ctx
  }

  private onContextState() {
    const state = this.ctx?.state
    const audio: AudioStatus = state === 'running' ? 'running' : this.snap.audio === 'locked' ? 'locked' : 'suspended'
    // A system interruption (call, Siri, another app's audio) pauses the audio clock, and the
    // scheduler with it. Playback stays on and continues in time when the context resumes.
    let notice = this.snap.notice
    if (audio !== 'running' && this.scheduler.running) notice = SUSPENDED_NOTICE
    else if (audio === 'running' && notice === SUSPENDED_NOTICE) notice = null
    if (audio !== this.snap.audio || notice !== this.snap.notice) this.set({ audio, notice })
  }

  /** Try to resume a context the system suspended (no-op when running or never unlocked). */
  resumeAudio(): void {
    const ctx = this.ctx
    if (!ctx || ctx.state === 'running' || this.snap.audio === 'locked') return
    void ctx.resume().then(() => this.onContextState(), () => this.onContextState())
  }

  /** Call directly inside a user gesture handler. */
  unlock(): void {
    this.deps.onGesture?.()
    const ctx = this.ensureContext()
    if (ctx.state !== 'running') {
      void ctx.resume().then(() => this.onContextState(), () => this.onContextState())
    }
  }

  /** Listener output gain in dB (0 = default level). Applies now, or when the context is created. */
  setOutputGain(db: number): void {
    this.outputDb = db
    this.engine?.setOutputGain(db)
  }

  get currentTime() {
    return this.ctx?.currentTime ?? 0
  }

  // --- pattern ------------------------------------------------------------
  setPattern(p: PatternState) {
    this.pattern = p
  }

  // --- kits ---------------------------------------------------------------
  /**
   * Prepare `kit` (all chosen slot samples decoded) and make it active:
   * immediately when stopped, at the next bar boundary while playing.
   * Stale completions from older requests are ignored.
   */
  async selectKit(kit: KitManifest): Promise<boolean> {
    this.ensureContext()
    const gen = ++this.kitGeneration
    if (this.active?.kit.id === kit.id && !this.pending) return true
    const prepared = prepare(kit)
    const reqs = this.requestsFor(prepared)
    const rate = (this.ctx as unknown as { sampleRate?: number }).sampleRate ?? 48000
    const estimate = kit.samples
      .filter((s) => reqs.some((r) => r.sha256 === s.blobSha256))
      .reduce((n, s) => n + BufferStore.estimate(s.durationSec, s.channels, rate), 0)
    this.set({ kitStatus: 'loading', pendingKitId: kit.id, progress: { done: 0, total: reqs.length }, error: null })
    try {
      this.buffers!.unpin(STAGING)
      await this.buffers!.loadSet(STAGING, reqs, estimate, (done, total) => {
        if (gen === this.kitGeneration) this.set({ progress: { done, total } })
      })
    } catch (e) {
      if (gen !== this.kitGeneration) return false
      this.buffers!.unpin(STAGING)
      this.set({
        kitStatus: this.active ? 'ready' : 'error', pendingKitId: null,
        error: `Could not load ${kit.label}: ${(e as Error).message}`,
      })
      return false
    }
    if (gen !== this.kitGeneration) return false
    if (this.scheduler.running) {
      this.pending = prepared
      this.set({ kitStatus: 'ready' })
    } else {
      this.commitKit(prepared, this.currentTime)
    }
    return true
  }

  private requestsFor(p: PreparedKit): LoadRequest[] {
    const seen = new Set<string>()
    const out: LoadRequest[] = []
    for (const { slot } of p.slots) {
      const s = chosenSample(p.kit, slot, this.pattern)
      if (s && !seen.has(s.blobSha256)) {
        seen.add(s.blobSha256)
        out.push({ sha256: s.blobSha256, url: this.deps.resolveUrl(s.url) })
      }
    }
    return out
  }

  private commitKit(p: PreparedKit, at: number) {
    const old = this.active
    if (old && old.kit.id !== p.kit.id) this.engine?.stopAll((k) => k === old.kit.id, at)
    this.active = p
    this.pending = null
    this.buffers!.unpin(ACTIVE)
    this.buffers!.movePin(STAGING, ACTIVE)
    this.set({ kitId: p.kit.id, pendingKitId: null, kitStatus: 'ready', error: null })
  }

  /** Decode a variant before the UI switches a track to it. */
  async prepareSample(sample: Sample): Promise<void> {
    this.ensureContext()
    await this.buffers!.load({ sha256: sample.blobSha256, url: this.deps.resolveUrl(sample.url) })
    this.buffers!.addToPin(ACTIVE, sample.blobSha256)
  }

  isSampleReady(sample: Sample) {
    return !!this.buffers?.has(sample.blobSha256)
  }

  get activeKit() {
    return this.active?.kit ?? null
  }

  // --- playback -------------------------------------------------------------
  /**
   * Audition one slot now at its track volume (and a step's level when given).
   * Synchronous; silently does nothing when the buffer is not ready or the volume is off.
   */
  audition(slotId: string, step: number | null = null): void {
    const t0 = performance.now()
    this.unlock()
    const p = this.active
    if (!p || !this.engine || !this.buffers) return
    const entry = p.slots.find((s) => s.slot.id === slotId)
    if (!entry) return
    const sample = chosenSample(p.kit, entry.slot, this.pattern)
    const buffer = sample && this.buffers.get(sample.blobSha256)
    if (!sample || !buffer) return
    const track = this.pattern?.tracks[slotId]
    const extra = track ? hitGainDb(track, step) : 0
    if (extra === -Infinity) return
    this.engine.trigger(buffer, this.ctx!.currentTime, {
      gainDb: hitPlaybackDb(buffer, extra), slotId, kitId: p.kit.id, generation: -1,
      pitchCents: this.pattern ? hitPitchCents(this.pattern, track, step) : 0,
    })
    this.triggerTimings.push(performance.now() - t0)
    if (this.triggerTimings.length > 500) this.triggerTimings.shift()
  }

  play(): void {
    this.unlock()
    if (this.scheduler.running || !this.active) return
    this.deps.onPlayingChange?.(true)
    const start = () => {
      if (this.scheduler.running) return
      this.scheduler.start(this.ctx!.currentTime + 0.05)
      this.set({ playing: true, notice: null })
    }
    if (this.ctx!.state === 'running') start()
    else
      void this.ctx!.resume().then(start, () => {
        this.deps.onPlayingChange?.(false)
        this.set({ error: 'Audio could not start. Tap play again.' })
      })
  }

  stop(): void {
    this.scheduler.stop()
    this.engine?.stopAll()
    if (this.pending) this.commitKit(this.pending, this.currentTime)
    if (this.snap.playing) {
      this.deps.onPlayingChange?.(false)
      this.set({ playing: false, notice: this.snap.notice === SUSPENDED_NOTICE ? null : this.snap.notice })
    }
  }

  /** ON/OFF. While the system holds audio paused, the key resumes instead of stopping. */
  toggle() {
    if (this.scheduler.running && this.ctx?.state !== 'running') this.unlock()
    else if (this.scheduler.running) this.stop()
    else this.play()
  }

  /**
   * Page hidden or shown (tab switch, app switch, screen lock). Playback continues:
   * hidden, the scheduler queues further ahead to survive throttled timers; shown,
   * hits queued past the normal lookahead are cancelled and rescheduled so edits
   * apply at once.
   */
  setPageHidden(hidden: boolean) {
    this.scheduler.setBackground(hidden)
    if (hidden) return
    const cut = this.scheduler.rewind(this.currentTime + LOOKAHEAD_SEC)
    if (cut !== null) this.engine?.cancelFrom(cut)
    if (this.scheduler.running) this.resumeAudio()
  }

  currentStep(): number | null {
    return this.scheduler.running ? this.scheduler.stepAt(this.currentTime) : null
  }

  get schedulerLateness() {
    return this.scheduler.maxLateness
  }

  /** Steps skipped since play because the timer woke too late. */
  get skippedSteps() {
    return this.scheduler.skipped
  }

  /** Machine whose timing applies: the active kit's, when circuit timing is on and documented. */
  private circuit() {
    if (!this.pattern?.circuit || !this.active) return null
    return circuitFor(this.active.kit.machineId)
  }

  private jitters = new Map<string, StepJitter>()

  /** Swing the scheduler plays: the requested amount, or the nearest position the hardware could reach. */
  effectiveSwing(): { amount: number; grid: 8 | 16 } {
    const amount = this.pattern?.swing ?? 50
    const grid = this.pattern?.swingGrid ?? 16
    const steps = this.circuit()?.swing?.grids[grid]
    return { amount: steps ? machineSwing(amount, steps) : amount, grid }
  }

  private scheduleStep(step: number, when: number, gen: number) {
    if (step === 0 && this.pending) this.commitKit(this.pending, when)
    const p = this.active
    const pat = this.pattern
    if (!p || !pat || !this.engine || !this.buffers) return
    // Hardware step jitter moves every voice of a step together, as the sequencer clock did.
    const jitterProfile = this.circuit()?.jitter
    let lateness = 0
    if (jitterProfile) {
      let j = this.jitters.get(p.kit.machineId)
      if (!j) this.jitters.set(p.kit.machineId, (j = new StepJitter(jitterProfile)))
      lateness = j.offsetSec(when)
    }
    for (const { slot, samples } of p.slots) {
      const track = pat.tracks[slot.id]
      if (!track || !track.steps[step]) continue
      // Mid-switch the pattern already names the incoming kit's samples; the outgoing kit plays its defaults.
      const sample = pat.kitId === p.kit.id ? samples.get(track.sampleId) : samples.get(slot.defaultSampleId)
      const buffer = sample && this.buffers.get(sample.blobSha256)
      if (!sample || !buffer) continue
      const extra = hitGainDb(track, step)
      if (extra === -Infinity) continue
      this.engine.trigger(buffer, when + lateness, {
        gainDb: hitPlaybackDb(buffer, extra), slotId: slot.id, kitId: p.kit.id, generation: gen,
        pitchCents: hitPitchCents(pat, track, step),
      })
    }
  }
}
