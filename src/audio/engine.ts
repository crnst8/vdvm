// Web Audio voice engine. Owns the AudioContext, master gain, voice tracking,
// hi-hat choke and stop fades. The trigger path is synchronous: no fetch,
// storage, decode, Promise or React work happens between a hit and start().

import { pitchRate } from './pitch'

export const MASTER_GAIN_DB = -12
export const MAX_VOICES = 64
export const STOP_FADE_SEC = 0.005
export const CHOKE_FADE_SEC = 0.005
/** Listener output gain range, relative to the fixed master level. */
export const OUTPUT_GAIN_MIN_DB = -24
export const OUTPUT_GAIN_MAX_DB = 12
const OUTPUT_RAMP_SEC = 0.02

export const dbToGain = (db: number) => 10 ** (db / 20)

/** The subset of BaseAudioContext the engine needs; lets tests pass a fake. */
export interface AudioContextLike {
  readonly currentTime: number
  readonly state: string
  readonly destination: AudioNode
  createBufferSource(): AudioBufferSourceNode
  createGain(): GainNode
  /** Optional so test fakes can omit it; without it a boost runs unlimited. */
  createDynamicsCompressor?(): DynamicsCompressorNode
  resume(): Promise<void>
}

export interface TriggerOptions {
  /** Loudness normalisation + mixer gain in dB; master gain is applied by the engine. */
  gainDb: number
  slotId: string
  kitId: string
  generation: number
  /** Effective sample tuning in cents (overall + step offset); omitted or 0 leaves pitch unchanged. */
  pitchCents?: number
}

interface Voice {
  source: AudioBufferSourceNode
  gain: GainNode
  when: number
  slotId: string
  kitId: string
  generation: number
  /** Time at which a fade-out has been scheduled, or Infinity. */
  endAt: number
  /** Time the buffer finishes on its own. */
  naturalEnd: number
}

export class AudioEngine {
  readonly ctx: AudioContextLike
  private master: GainNode
  /** Listener output gain after the master. */
  private output: GainNode
  /** Peak limiter, in the path only while the output gain is above 0 dB. */
  private limiter: DynamicsCompressorNode | null = null
  private limiting = false
  private voices: Voice[] = []

  constructor(ctx: AudioContextLike) {
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = dbToGain(MASTER_GAIN_DB)
    this.output = ctx.createGain()
    this.master.connect(this.output)
    this.output.connect(ctx.destination)
  }

  /**
   * Listener output gain in dB (0 = the fixed master level). Above 0 dB a limiter
   * catches peaks; at or below it the limiter is out of the path, because the
   * compressor adds a few milliseconds of lookahead delay.
   */
  setOutputGain(db: number): void {
    const clamped = Math.min(OUTPUT_GAIN_MAX_DB, Math.max(OUTPUT_GAIN_MIN_DB, db))
    const g = this.output.gain
    const now = this.ctx.currentTime
    g.cancelScheduledValues(now)
    g.setValueAtTime(g.value, now)
    g.linearRampToValueAtTime(dbToGain(clamped), now + OUTPUT_RAMP_SEC)
    const limit = clamped > 0 && !!this.ctx.createDynamicsCompressor
    if (limit === this.limiting) return
    this.limiting = limit
    this.output.disconnect()
    if (limit) {
      if (!this.limiter) {
        const l = this.ctx.createDynamicsCompressor!()
        l.threshold.value = -1
        l.knee.value = 0
        l.ratio.value = 20
        l.attack.value = 0.002
        l.release.value = 0.1
        l.connect(this.ctx.destination)
        this.limiter = l
      }
      this.output.connect(this.limiter)
    } else {
      this.output.connect(this.ctx.destination)
    }
  }

  get activeVoices() {
    return this.voices.length
  }

  /**
   * Schedule one hit. `when` is audio-clock time. Closed hats choke open-hat
   * voices that started before them, with a fade at the closed-hat onset; an
   * open hat on the same step is not choked, so both hats layer.
   */
  trigger(buffer: AudioBuffer, when: number, opts: TriggerOptions): void {
    const ctx = this.ctx
    const at = Math.max(when, ctx.currentTime)
    // Native rate conversion: one playback-rate value set before start; detune stays at its default.
    const rate = pitchRate(opts.pitchCents ?? 0)
    if (opts.slotId === 'hat-closed') this.choke('hat-open', at)
    // The cap counts voices sounding at `at`; hits queued further ahead (background lookahead) do not count.
    const sounding = this.voices.filter((v) => v.when <= at && Math.min(v.endAt, v.naturalEnd) > at)
    if (sounding.length >= MAX_VOICES) this.steal(at, sounding)

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = rate
    const gain = ctx.createGain()
    gain.gain.value = dbToGain(opts.gainDb)
    source.connect(gain)
    gain.connect(this.master)
    const voice: Voice = {
      source, gain, when: at, slotId: opts.slotId, kitId: opts.kitId, generation: opts.generation, endAt: Infinity,
      // Pitched-down hits last longer and pitched-up hits shorter; the cap counts the true sounding window.
      naturalEnd: at + buffer.duration / rate,
    }
    source.onended = () => this.release(voice)
    this.voices.push(voice)
    source.start(at)
  }

  /** Fade voices of `slotId` that started before `at` (same-step hits are left alone). */
  private choke(slotId: string, at: number) {
    for (const v of this.voices) {
      if (v.slotId === slotId && v.when < at && v.endAt > at) this.fadeVoice(v, at, CHOKE_FADE_SEC)
    }
  }

  private steal(at: number, candidates: Voice[]) {
    let oldest: Voice | null = null
    for (const v of candidates) if (v.endAt === Infinity && (!oldest || v.when < oldest.when)) oldest = v
    if (oldest) {
      this.fadeVoice(oldest, Math.max(at, oldest.when), STOP_FADE_SEC)
      // Remove from accounting now so the cap holds; node cleans up on `ended`.
      this.voices = this.voices.filter((v) => v !== oldest)
    }
  }

  private fadeVoice(v: Voice, at: number, fade: number) {
    const g = v.gain.gain
    const level = g.value
    g.cancelScheduledValues(at)
    g.setValueAtTime(level, at)
    g.linearRampToValueAtTime(0, at + fade)
    try {
      v.source.stop(at + fade + 0.001)
    } catch {
      /* already stopped */
    }
    v.endAt = at
  }

  private release(v: Voice) {
    this.voices = this.voices.filter((x) => x !== v)
    try {
      v.source.disconnect()
      v.gain.disconnect()
    } catch {
      /* already disconnected */
    }
  }

  /** Cancel future hits and fade sounding voices. Optional filter by kit. */
  stopAll(filter?: (kitId: string) => boolean, at = this.ctx.currentTime): void {
    for (const v of this.voices.slice()) {
      if (filter && !filter(v.kitId)) continue
      if (v.when > at) {
        // Not started yet: cancel outright. stop() before the start time means it never sounds.
        try {
          v.source.stop()
        } catch {
          /* ignore */
        }
        v.endAt = at
        this.release(v)
      } else if (v.endAt > at) {
        this.fadeVoice(v, at, STOP_FADE_SEC)
      }
    }
  }

  /** Cancel hits that have not started by `from` (a scheduler rewind reschedules them). */
  cancelFrom(from: number): void {
    for (const v of this.voices.slice()) {
      if (v.when < from) continue
      try {
        v.source.stop()
      } catch {
        /* ignore */
      }
      v.endAt = from
      this.release(v)
    }
  }

  /** Voices scheduled to start after `at` (used by tests and diagnostics). */
  pendingAfter(at: number) {
    return this.voices.filter((v) => v.when > at).length
  }
}
