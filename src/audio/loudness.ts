// Per-hit loudness normalisation. Each decoded buffer is measured once, off the
// trigger path, and gets a gain that brings it to a common loudness so every
// sound starts at the same level and the mixer adjusts from there.
//
// Measure: ITU-R BS.1770 K-weighting, maximum momentary loudness (400 ms
// rectangular window, zero-padded for shorter hits), reported in LUFS. A mono
// buffer is counted on both output channels because Web Audio up-mixes it to
// stereo, so mono and stereo hits that sound equally loud measure the same.

/**
 * Common loudness every hit is brought to, before the mixer and the -12 dB
 * master gain. Chosen from the curated catalog (3955 default hits, 2026-10-02):
 * at -20 LUFS only 75 hits are limited by the peak ceiling, and all default
 * hits of a kit started together peak above -1 dBFS in 26 of 423 kits.
 */
export const TARGET_LUFS = -20
/** Normalised sample peak ceiling before the master gain (-9 dBFS at the output), so sharp clicks are not pushed into clipping. */
export const PEAK_CEILING_DB = 3
/** Limits on the correction so near-silent or broken files are not amplified into noise. */
export const MAX_BOOST_DB = 24
export const MAX_CUT_DB = -24

const WINDOW_SEC = 0.4

export interface HitLevel {
  /** Maximum momentary loudness in LUFS; -Infinity for silence. */
  lufs: number
  /** Sample peak in dBFS; -Infinity for silence. */
  peakDb: number
}

/** Minimal AudioBuffer view so tests and build scripts can measure plain arrays. */
export interface ChannelSource {
  readonly numberOfChannels: number
  readonly sampleRate: number
  readonly length: number
  getChannelData(channel: number): Float32Array
}

interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

/** BS.1770 K-weighting at any sample rate (shelf, then high-pass), as in libebur128. */
function kWeighting(rate: number): [Biquad, Biquad] {
  let K = Math.tan(Math.PI * 1681.974450955533 / rate)
  const Vh = 10 ** (3.999843853973347 / 20)
  const Vb = Vh ** 0.4996667741545416
  let Q = 0.7071752369554196
  let a0 = 1 + K / Q + K * K
  const shelf = {
    b0: (Vh + Vb * K / Q + K * K) / a0, b1: 2 * (K * K - Vh) / a0, b2: (Vh - Vb * K / Q + K * K) / a0,
    a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0,
  }
  K = Math.tan(Math.PI * 38.13547087602444 / rate)
  Q = 0.5003270373238773
  a0 = 1 + K / Q + K * K
  const highPass = { b0: 1, b1: -2, b2: 1, a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0 }
  return [shelf, highPass]
}

function filter(x: ArrayLike<number>, f: Biquad, out: Float64Array) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i]
    const y0 = f.b0 * x0 + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2
    x2 = x1; x1 = x0; y2 = y1; y1 = y0
    out[i] = y0
  }
}

export function measureHit(buffer: ChannelSource): HitLevel {
  const n = buffer.length
  const rate = buffer.sampleRate
  const channels = buffer.numberOfChannels
  if (n === 0 || channels === 0) return { lufs: -Infinity, peakDb: -Infinity }
  const [shelf, highPass] = kWeighting(rate)
  const power = new Float64Array(n)
  const shelved = new Float64Array(n)
  const stage = new Float64Array(n)
  // A mono buffer plays on both speakers; count it twice like a centred stereo signal.
  const weight = channels === 1 ? 2 : 1
  let peak = 0
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < n; i++) {
      const v = Math.abs(data[i])
      if (v > peak) peak = v
    }
    filter(data, shelf, shelved)
    filter(shelved, highPass, stage)
    for (let i = 0; i < n; i++) power[i] += weight * stage[i] * stage[i]
  }
  const window = Math.max(1, Math.round(WINDOW_SEC * rate))
  let sum = 0
  for (let i = 0; i < Math.min(window, n); i++) sum += power[i]
  let max = sum
  for (let i = window; i < n; i++) {
    sum += power[i] - power[i - window]
    if (sum > max) max = sum
  }
  const ms = max / window
  return {
    lufs: ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity,
    peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
  }
}

/** Gain in dB that brings a measured hit to TARGET_LUFS within the peak ceiling and limits. */
export function normalisationDb(level: HitLevel): number {
  if (!Number.isFinite(level.lufs) || !Number.isFinite(level.peakDb)) return 0
  const toTarget = TARGET_LUFS - level.lufs
  const toCeiling = PEAK_CEILING_DB - level.peakDb
  return Math.min(MAX_BOOST_DB, Math.max(MAX_CUT_DB, Math.min(toTarget, toCeiling)))
}

const normalisation = new WeakMap<object, number>()

/**
 * Normalisation gain for a decoded buffer, measured once and cached. The buffer
 * store calls this right after decoding, so the trigger path only reads the
 * cache. Buffers without sample data (test fakes) get 0 dB.
 */
export function normalisedGainDb(buffer: AudioBuffer | ChannelSource): number {
  let db = normalisation.get(buffer)
  if (db === undefined) {
    db = typeof buffer.getChannelData === 'function' ? normalisationDb(measureHit(buffer)) : 0
    normalisation.set(buffer, db)
  }
  return db
}

/** Playback gain for one hit: normalisation plus the mixer (track volume and step level). Master gain is separate. */
export const hitPlaybackDb = (buffer: AudioBuffer, mixerDb: number) => normalisedGainDb(buffer) + mixerDb
