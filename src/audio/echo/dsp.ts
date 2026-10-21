// Tape echo and spring reverb DSP modelled on the Roland RE-201 Space Echo.
// Pure maths on plain arrays: runs in the AudioWorklet, in offline export and in
// tests. plugin/source/core/TapeEcho.cpp is a line-for-line port; both render
// plugin/source/tests/data/echo-reference.json, so keep the operation order the same.
//
// Signal path (Roland and UA documentation; see docs/research/SPACE_ECHO.md):
//   send ─ INPUT VOLUME ─┬─ (+ INTENSITY feedback) ─ preamp clip ─ record pre-emphasis ─ tape saturation ─▶ tape
//                        └─ preamp clip ─ spring reverb (three springs) ─ REVERB VOLUME ────────────────▶ out
//   tape ─ heads 1/2/3 (read by tape position) ─ hiss ─ playback loss ─ de-emphasis ─ head bump ─ low cut
//        ─ BASS/TREBLE ─┬─ ECHO VOLUME ─▶ out
//                       └─ INTENSITY ─▶ back to the record input
// The tape is a buffer of samples, each stamped with the tape position written
// under the record head. A head reads the sample whose position is its distance
// behind, so a speed change bends the pitch of the repeats the way the motor does.
import {
  ECHO_FAST_TAU_SEC, ECHO_HEAD_DELAYS_SEC, ECHO_SLOW_TAU_SEC, ECHO_SPEED_RATIO, TAPE_CONDITIONS, targetSpeed,
  type EchoState, type TapeCondition,
} from './settings'

/** AudioWorklet processor name (src/audio/echo/worklet.ts). */
export const ECHO_PROCESSOR = 'vdvm-echo'
/** Sample-block length of the control rate (wow, flutter, speed-dependent filters). */
export const ECHO_CONTROL_FRAMES = 32
/** Parameter smoothing, seconds. */
const SMOOTH_SEC = 0.02
/** Record level into the tape (playback divides by it): the sends' peaks meet the tape's soft knee at unity input. */
export const TAPE_LEVEL = 2
/** INTENSITY loop gain at full: oscillation starts a little past the knob's centre, as the RE-20 manual describes. */
export const INTENSITY_MAX_GAIN = 1.6
/** Playback amplifier rail in signal units (estimated): extreme tone and intensity settings clip here, inside the loop. */
export const PLAYBACK_RAIL = 1.5
/** INPUT VOLUME span around unity, dB each way. */
export const INPUT_RANGE_DB = 18
/** BASS/TREBLE: first-order shelves hinged at the tone stack's 750 Hz crossover (Downing & Terjesen). Range estimated. */
export const TONE_HZ = 750
export const TONE_RANGE_DB = 12
/** Record pre-emphasis and matching playback de-emphasis (estimated). */
export const EMPHASIS_HZ = 2500
export const EMPHASIS_DB = 8
/** Playback head bump and low cut at the fastest tape; both scale with speed (estimated). */
export const BUMP_HZ = 100
export const BUMP_DB = 2.5
export const BUMP_Q = 1.4
/** Wow is low-passed noise with a 1 Hz cutoff (Downing & Terjesen, measured); capstan and pinch-roller rates estimated. */
export const WOW_HZ = 1
export const CAPSTAN_HZ = 9
export const ROLLER_HZ = 2.1
/** Per tape condition (new, used, old); all estimated, see docs/research/SPACE_ECHO.md. */
export const TAPE_WEAR = {
  /** RMS speed deviation of wow, fraction of speed. */
  wow: [0.0006, 0.0012, 0.0025],
  /** Peak speed deviation of the capstan and pinch-roller components. */
  capstan: [0.0003, 0.0005, 0.0009],
  roller: [0.0002, 0.0004, 0.0008],
  /** Playback loss low-pass at the fastest tape, Hz; scales with speed. */
  lossHz: [11000, 9000, 6500],
  /** Tape hiss RMS relative to tape saturation, dB. */
  hissDb: [-74, -68, -62],
}
/** Spring tank: three springs (Roland: "arranged in a Z formation"); delays, T60 and dispersion estimated. */
export const SPRING_DELAYS_SEC = [0.0347, 0.0411, 0.0463]
export const SPRING_TRANSITION_HZ = 4000
export const SPRING_STAGES = 60
export const SPRING_ALLPASS = 0.6
export const SPRING_T60_SEC = 2.4
export const SPRING_LOW_CUT_HZ = 120
export const SPRING_DAMP_HZ = 6000
export const SPRING_LEVEL = 1
/** Silence after ECHO OFF before the processor sleeps, seconds; level below which it counts as silent. */
const IDLE_SEC = 0.5
const IDLE_LEVEL = 1e-6

/** Everything the DSP needs, in panel units. */
export interface EchoDspParams {
  on: boolean
  heads: readonly boolean[]
  spring: boolean
  /** Target tape speed relative to the fastest (1 / ECHO_SPEED_RATIO .. 1). */
  speed: number
  intensity: number
  echo: number
  reverb: number
  bass: number
  treble: number
  input: number
  tape: TapeCondition
}

/** DSP parameters for stored settings at a tempo (the tempo matters only while synced). */
export const echoDspParams = (e: EchoState, bpm: number): EchoDspParams => ({
  on: e.on, heads: [...e.heads], spring: e.spring, speed: targetSpeed(e, bpm), intensity: e.intensity,
  echo: e.echo, reverb: e.reverb, bass: e.bass, treble: e.treble, input: e.input, tape: e.tape,
})

/**
 * Seconds for the echo to fade after its input stops: repeats of the longest active head
 * until the loop has lost 60 dB, or the spring's T60; 12 s at most (self-oscillation never ends).
 */
export function echoTailSec(e: EchoState, bpm: number): number {
  const speed = targetSpeed(e, bpm)
  const longest = Math.max(0, ...e.heads.map((on, h) => (on ? ECHO_HEAD_DELAYS_SEC[h] / speed : 0)))
  const loop = INTENSITY_MAX_GAIN * e.intensity
  const echo = longest === 0 ? 0 : loop < 0.97 ? longest * (1 + Math.log(1e-3) / Math.log(Math.max(loop, 0.01))) : Infinity
  return Math.min(12, Math.max(echo, e.spring ? SPRING_T60_SEC : 0))
}

const TWO_PI = 2 * Math.PI

/** Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7); same formula in C++ so both builds agree. */
export function erf(x: number): number {
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * ax)
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax)
  return x < 0 ? -y : y
}

/** Tape magnetisation curve: erf with unity small-signal gain, saturating at ±1 (DAFX 2nd ed., ch. 12). */
export const tapeCurve = (x: number) => erf(0.886226925452758 * x)

class Biquad {
  b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0
  x1 = 0; x2 = 0; y1 = 0; y2 = 0
  process(x: number) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y
    return y
  }
  clear() { this.x1 = this.x2 = this.y1 = this.y2 = 0 }
  private set(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number) {
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0
  }
  // RBJ audio EQ cookbook.
  lowpass(f: number, q: number, fs: number) {
    const w = TWO_PI * f / fs, c = Math.cos(w), al = Math.sin(w) / (2 * q)
    this.set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al)
  }
  highpass(f: number, q: number, fs: number) {
    const w = TWO_PI * f / fs, c = Math.cos(w), al = Math.sin(w) / (2 * q)
    this.set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al)
  }
  peak(f: number, q: number, db: number, fs: number) {
    const A = 10 ** (db / 40), w = TWO_PI * f / fs, c = Math.cos(w), al = Math.sin(w) / (2 * q)
    this.set(1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A)
  }
}

/** First-order shelf, bilinear with prewarp; `g` is the linear gain of the shelved band, `f` the geometric midpoint. */
class Shelf {
  b0 = 1; b1 = 0; a1 = 0; x1 = 0; y1 = 0
  process(x: number) {
    const y = this.b0 * x + this.b1 * this.x1 - this.a1 * this.y1
    this.x1 = x; this.y1 = y
    return y
  }
  clear() { this.x1 = this.y1 = 0 }
  low(f: number, g: number, fs: number) {
    const k = Math.tan(Math.PI * f / fs), r = Math.sqrt(g)
    const a0 = 1 + k / r
    this.b0 = (1 + k * r) / a0; this.b1 = (k * r - 1) / a0; this.a1 = (k / r - 1) / a0
  }
  high(f: number, g: number, fs: number) {
    const k = Math.tan(Math.PI * f / fs), r = Math.sqrt(g)
    const a0 = 1 / r + k
    this.b0 = (r + k) / a0; this.b1 = (k - r) / a0; this.a1 = (k - 1 / r) / a0
  }
}

/** xorshift32 white noise in [-1, 1). */
class Noise {
  private s: number
  constructor(seed: number) { this.s = (seed >>> 0) || 1 }
  next() {
    let s = this.s
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17
    s ^= s << 5; s >>>= 0
    this.s = s
    return s / 4294967296 * 2 - 1
  }
}

/** One spring: a delay loop with a cascade of stretched all-pass filters (Välimäki, Parker & Abel 2010). */
class Spring {
  private line: Float64Array
  private w = 0
  private delay: number
  private stages: Float64Array
  private k: number
  private idx = 0
  private gain: number
  private state = 0
  private dampK: number
  private damp = 0
  constructor(delaySec: number, fs: number) {
    this.delay = Math.max(1, Math.round(delaySec * fs))
    this.line = new Float64Array(this.delay + 1)
    // Stretch factor puts the all-pass group-delay peak at the transition frequency.
    this.k = Math.max(2, Math.round(fs / (2 * SPRING_TRANSITION_HZ)))
    this.stages = new Float64Array(SPRING_STAGES * this.k)
    // An all-pass section of k delays averages k samples of group delay over frequency.
    const meanGroupDelay = SPRING_STAGES * this.k / fs
    this.gain = 10 ** (-3 * (delaySec + meanGroupDelay) / SPRING_T60_SEC)
    this.dampK = 1 - Math.exp(-TWO_PI * SPRING_DAMP_HZ / fs)
  }
  clear() { this.line.fill(0); this.stages.fill(0); this.state = 0; this.damp = 0; this.w = 0; this.idx = 0 }
  process(x: number) {
    const line = this.line
    line[this.w] = x + this.gain * this.state
    let r = this.w + 1
    if (r > this.delay) r = 0
    let y = line[r]
    this.w = r
    const a = SPRING_ALLPASS, k = this.k, st = this.stages, i = this.idx
    for (let m = 0, base = 0; m < SPRING_STAGES; m++, base += k) {
      const old = st[base + i]
      const v = y - a * old
      st[base + i] = v
      y = a * v + old
    }
    this.idx = i + 1 === k ? 0 : i + 1
    this.damp += this.dampK * (y - this.damp)
    this.state = this.damp
    return y
  }
}

export class TapeEcho {
  readonly sampleRate: number
  private size: number
  private mask: number
  private tape: Float64Array
  private pos: Float64Array
  private wi = 0
  private ri = [0, 0, 0]
  private tapePos = 0
  /** Head-1 delay after motor ballistics, seconds. */
  private delay1: number
  private mod = 0
  private wow1 = 0
  private wow2 = 0
  private phCapstan = 0
  private phRoller = 0
  private tick = 0
  private fb = 0
  private wowNoise: Noise
  private hissNoise: Noise
  private preEmph = new Shelf()
  private deEmph = new Shelf()
  private loss = new Biquad()
  private bump = new Biquad()
  private lowCut = new Biquad()
  private bassShelf = new Shelf()
  private trebleShelf = new Shelf()
  private springIn = new Biquad()
  private springOut = new Biquad()
  private springs: Spring[]
  private kSmooth: number
  private kSlow: number
  private kFast: number
  private kWow: number
  // Smoothed values: current and target.
  private g = { input: 0, active: 0, intensity: 0, echo: 0, reverb: 0, spring: 0, hiss: 0, h0: 0, h1: 0, h2: 0, bass: 0.5, treble: 0.5 }
  private t = { ...this.g }
  private toneBass = NaN
  private toneTreble = NaN
  private p: EchoDspParams | null = null
  private tapeIndex = 1
  private silent = 0
  /** True while the echo is off and its tails have died away: process() adds nothing. */
  idle = true

  constructor(sampleRate: number, seed = 1) {
    this.sampleRate = sampleRate
    const longest = ECHO_HEAD_DELAYS_SEC[2] * ECHO_SPEED_RATIO * 1.2
    this.size = 2 ** Math.ceil(Math.log2(longest * sampleRate + 8))
    this.mask = this.size - 1
    this.tape = new Float64Array(this.size)
    this.pos = new Float64Array(this.size)
    this.wowNoise = new Noise(0x9e3779b9 ^ seed)
    this.hissNoise = new Noise(0x85ebca6b ^ seed)
    this.springs = SPRING_DELAYS_SEC.map((d) => new Spring(d, sampleRate))
    this.kSmooth = 1 - Math.exp(-1 / (SMOOTH_SEC * sampleRate))
    this.kSlow = 1 - Math.exp(-1 / (ECHO_SLOW_TAU_SEC * sampleRate))
    this.kFast = 1 - Math.exp(-1 / (ECHO_FAST_TAU_SEC * sampleRate))
    this.kWow = 1 - Math.exp(-TWO_PI * WOW_HZ * ECHO_CONTROL_FRAMES / sampleRate)
    this.preEmph.high(EMPHASIS_HZ, 10 ** (EMPHASIS_DB / 20), sampleRate)
    this.deEmph.high(EMPHASIS_HZ, 10 ** (-EMPHASIS_DB / 20), sampleRate)
    this.springIn.highpass(SPRING_LOW_CUT_HZ, Math.SQRT1_2, sampleRate)
    this.springOut.lowpass(SPRING_TRANSITION_HZ, Math.SQRT1_2, sampleRate)
    this.delay1 = ECHO_HEAD_DELAYS_SEC[0]
    this.reset(1)
  }

  /** Clear the tape and the springs; the motor starts at `speed`. */
  reset(speed: number) {
    const fs = this.sampleRate
    this.tape.fill(0)
    this.tapePos = 0
    this.wi = 0
    // History as if the tape had always run at `speed`.
    for (let j = 1; j < this.size; j++) this.pos[(this.wi - j) & this.mask] = -j * speed / fs
    this.pos[this.wi] = 0
    for (let h = 0; h < 3; h++) this.ri[h] = (this.wi - Math.ceil(ECHO_HEAD_DELAYS_SEC[h] * fs / speed) - 4) & this.mask
    this.delay1 = ECHO_HEAD_DELAYS_SEC[0] / speed
    this.fb = 0
    this.mod = this.wow1 = this.wow2 = this.phCapstan = this.phRoller = 0
    this.tick = 0
    for (const f of [this.preEmph, this.deEmph, this.loss, this.bump, this.lowCut, this.bassShelf, this.trebleShelf, this.springIn, this.springOut]) f.clear()
    for (const s of this.springs) s.clear()
    this.silent = 0
    this.updateSpeedFilters(speed)
  }

  set(p: EchoDspParams) {
    const first = this.p === null
    const wake = this.idle && p.on
    this.p = p
    this.tapeIndex = Math.max(0, TAPE_CONDITIONS.indexOf(p.tape))
    const t = this.t
    t.input = p.input <= 0 ? 0 : 10 ** ((p.input - 0.5) * 2 * INPUT_RANGE_DB / 20)
    t.active = p.on ? 1 : 0
    // Off: the loop gain is held below unity (worst case of head mix, head bump and tone boost),
    // so even a self-oscillating echo dies away.
    const loop = INTENSITY_MAX_GAIN * p.intensity
    const heads = p.heads.filter(Boolean).length
    const boost = Math.sqrt(Math.max(1, heads)) * 10 ** (BUMP_DB / 20) * 10 ** (Math.max(0, Math.abs(p.bass - 0.5), Math.abs(p.treble - 0.5)) * 2 * TONE_RANGE_DB / 20)
    t.intensity = p.on ? loop : Math.min(loop, 0.9 / boost)
    t.echo = 2 * p.echo * p.echo
    t.reverb = 2 * p.reverb * p.reverb * SPRING_LEVEL
    t.spring = p.spring ? 1 : 0
    t.hiss = p.on ? 10 ** (TAPE_WEAR.hissDb[this.tapeIndex] / 20) * Math.sqrt(3) : 0
    t.h0 = p.heads[0] ? 1 : 0
    t.h1 = p.heads[1] ? 1 : 0
    t.h2 = p.heads[2] ? 1 : 0
    t.bass = p.bass
    t.treble = p.treble
    if (wake) {
      this.reset(p.speed)
      this.idle = false
    }
    if (first || wake) Object.assign(this.g, this.t)
  }

  private updateSpeedFilters(speed: number) {
    const fs = this.sampleRate
    const nyq = 0.45 * fs
    this.loss.lowpass(Math.min(nyq, TAPE_WEAR.lossHz[this.tapeIndex] * speed), Math.SQRT1_2, fs)
    this.bump.peak(BUMP_HZ * speed, BUMP_Q, BUMP_DB, fs)
    this.lowCut.highpass(0.5 * BUMP_HZ * speed, Math.SQRT1_2, fs)
  }

  private updateTone() {
    const g = this.g
    if (g.bass !== this.toneBass) {
      this.toneBass = g.bass
      this.bassShelf.low(TONE_HZ, 10 ** ((g.bass - 0.5) * 2 * TONE_RANGE_DB / 20), this.sampleRate)
    }
    if (g.treble !== this.toneTreble) {
      this.toneTreble = g.treble
      this.trebleShelf.high(TONE_HZ, 10 ** ((g.treble - 0.5) * 2 * TONE_RANGE_DB / 20), this.sampleRate)
    }
  }

  /** Read head `h` at tape position `target` (4-point Hermite between the samples that straddle it). */
  private read(h: number, target: number) {
    const pos = this.pos, mask = this.mask, wi = this.wi
    let ri = this.ri[h]
    if (((wi - ri) & mask) > this.size - 8) ri = (wi - this.size + 8) & mask
    while (((wi - ri) & mask) > 3 && pos[(ri + 1) & mask] <= target) ri = (ri + 1) & mask
    this.ri[h] = ri
    const p0 = pos[ri], p1 = pos[(ri + 1) & mask]
    const span = p1 - p0
    const f = span > 0 ? Math.min(1, Math.max(0, (target - p0) / span)) : 0
    const tape = this.tape
    const xm1 = tape[(ri - 1) & mask], x0 = tape[ri], x1 = tape[(ri + 1) & mask], x2 = tape[(ri + 2) & mask]
    const c1 = 0.5 * (x1 - xm1)
    const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2
    const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1)
    return ((c3 * f + c2) * f + c1) * f + x0
  }

  /** Add the wet signal for `n` frames of mono `input` to `outL` and `outR`. */
  process(input: ArrayLike<number>, outL: { [i: number]: number }, outR: { [i: number]: number }, n: number) {
    const p = this.p
    if (!p || this.idle) return
    const fs = this.sampleRate
    const g = this.g, t = this.t, ks = this.kSmooth
    const d0 = ECHO_HEAD_DELAYS_SEC[0], d1 = ECHO_HEAD_DELAYS_SEC[1], d2 = ECHO_HEAD_DELAYS_SEC[2]
    const target1 = d0 / p.speed
    const ti = this.tapeIndex
    for (let i = 0; i < n; i++) {
      // Smoothed controls.
      g.input += (t.input - g.input) * ks
      g.active += (t.active - g.active) * ks
      g.intensity += (t.intensity - g.intensity) * ks
      g.echo += (t.echo - g.echo) * ks
      g.reverb += (t.reverb - g.reverb) * ks
      g.spring += (t.spring - g.spring) * ks
      g.hiss += (t.hiss - g.hiss) * ks
      g.h0 += (t.h0 - g.h0) * ks
      g.h1 += (t.h1 - g.h1) * ks
      g.h2 += (t.h2 - g.h2) * ks
      g.bass += (t.bass - g.bass) * ks
      g.treble += (t.treble - g.treble) * ks
      // Motor: the head-1 delay approaches its target with the measured time constants.
      this.delay1 += (target1 - this.delay1) * (target1 > this.delay1 ? this.kSlow : this.kFast)
      const speed = d0 / this.delay1
      if (this.tick === 0) {
        // Control rate: wow, flutter, speed-dependent playback filters, tone.
        const k = this.kWow
        this.wow1 += k * (this.wowNoise.next() - this.wow1)
        this.wow2 += k * (this.wow1 - this.wow2)
        // Two equal one-poles on uniform noise (variance 1/3): output RMS ≈ sqrt(k/3) / 2.
        const wow = this.wow2 * TAPE_WEAR.wow[ti] * 2 / Math.sqrt(k / 3)
        const step = TWO_PI * speed * ECHO_CONTROL_FRAMES / fs
        this.phCapstan += CAPSTAN_HZ * step
        this.phRoller += ROLLER_HZ * step
        if (this.phCapstan > TWO_PI) this.phCapstan -= TWO_PI
        if (this.phRoller > TWO_PI) this.phRoller -= TWO_PI
        this.mod = wow + TAPE_WEAR.capstan[ti] * Math.sin(this.phCapstan) + TAPE_WEAR.roller[ti] * Math.sin(this.phRoller)
        this.updateSpeedFilters(speed)
        this.updateTone()
      }
      this.tick = this.tick + 1 === ECHO_CONTROL_FRAMES ? 0 : this.tick + 1
      this.tapePos += speed * (1 + this.mod) / fs

      const x = input[i] * g.input * g.active
      // Record: feedback joins the input before the preamp, as on the hardware.
      const rec = Math.tanh(x + this.fb)
      const wi = (this.wi + 1) & this.mask
      this.wi = wi
      this.tape[wi] = tapeCurve(this.preEmph.process(rec * TAPE_LEVEL))
      this.pos[wi] = this.tapePos
      // Playback.
      let y = 0
      if (g.h0 > 1e-4) y += g.h0 * this.read(0, this.tapePos - d0)
      if (g.h1 > 1e-4) y += g.h1 * this.read(1, this.tapePos - d1)
      if (g.h2 > 1e-4) y += g.h2 * this.read(2, this.tapePos - d2)
      // Head mix: equal-power weights (estimated), so a multi-head mode builds up a little sooner than one head, not three times sooner.
      y /= Math.sqrt(Math.max(1, g.h0 + g.h1 + g.h2))
      // Hiss comes from the tape through the heads: none in REVERB ONLY.
      y += this.hissNoise.next() * g.hiss * Math.min(1, g.h0 + g.h1 + g.h2)
      y = this.lowCut.process(this.bump.process(this.deEmph.process(this.loss.process(y))))
      y = this.trebleShelf.process(this.bassShelf.process(y)) / TAPE_LEVEL
      y = PLAYBACK_RAIL * Math.tanh(y / PLAYBACK_RAIL)
      this.fb = y * g.intensity
      // Spring reverb, fed from the preamp in parallel with the tape.
      let r = 0
      if (g.spring > 1e-4) {
        const s = this.springIn.process(Math.tanh(x))
        r = this.springOut.process((this.springs[0].process(s) + this.springs[1].process(s) + this.springs[2].process(s)) / 3)
      }
      const wet = y * g.echo + r * g.reverb * g.spring
      outL[i] += wet
      outR[i] += wet
      if (t.active === 0) {
        this.silent = Math.abs(wet) < IDLE_LEVEL && Math.abs(this.fb) < IDLE_LEVEL ? this.silent + 1 : 0
        if (this.silent > IDLE_SEC * fs) {
          this.idle = true
          return
        }
      }
    }
  }
}
