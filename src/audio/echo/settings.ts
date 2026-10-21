// Tape echo settings: the panel controls of a Roland RE-201 Space Echo, stored
// with the pattern. Pure numbers; no browser or React imports. Sources and
// estimates for every constant are in docs/research/SPACE_ECHO.md.

/** Playback head delays at the fastest tape speed, seconds (UA RE-201 manual: 69, 131, 189 ms). */
export const ECHO_HEAD_DELAYS_SEC = [0.069, 0.131, 0.189] as const
/**
 * Slowest over fastest delay of each head. UA lists 177/69, 337/131 and 489/189 ms
 * (2.565, 2.573, 2.587); the mean keeps the three heads in one fixed tape geometry.
 */
export const ECHO_SPEED_RATIO = 2.575
/** Motor ballistics, time constants in seconds (Downing & Terjesen 2016, measured): slowing down, speeding up. */
export const ECHO_SLOW_TAU_SEC = 1.89
export const ECHO_FAST_TAU_SEC = 1.07

export const TAPE_CONDITIONS = ['new', 'used', 'old'] as const
export type TapeCondition = (typeof TAPE_CONDITIONS)[number]

/** Tempo-synced repeat times for the earliest active head, in quarter notes. */
export const ECHO_SYNCS = {
  '1/32': 1 / 8,
  '1/16T': 1 / 6,
  '1/16': 1 / 4,
  '1/8T': 1 / 3,
  '1/16D': 3 / 8,
  '1/8': 1 / 2,
  '1/4T': 2 / 3,
  '1/8D': 3 / 4,
  '1/4': 1,
} as const
export type EchoSync = keyof typeof ECHO_SYNCS
export const ECHO_SYNC_NAMES = Object.keys(ECHO_SYNCS) as EchoSync[]

export interface EchoState {
  /** Echo in circuit. Off mutes the tape input (the hardware's ECHO/NORMAL switch); tails fade out. */
  on: boolean
  /** Playback heads 1-3 in the echo mix. */
  heads: [boolean, boolean, boolean]
  /** Spring reverb in circuit. */
  spring: boolean
  /** REPEAT RATE knob, 0..1; 1 is the fastest tape (shortest repeats). Ignored while synced. */
  rate: number
  /** Tempo sync of the earliest active head, or null for the free REPEAT RATE knob. */
  sync: EchoSync | null
  /** INTENSITY (feedback), 0..1. */
  intensity: number
  /** ECHO VOLUME, 0..1. */
  echo: number
  /** REVERB VOLUME, 0..1. */
  reverb: number
  /** BASS and TREBLE, 0..1 with 0.5 flat. */
  bass: number
  treble: number
  /** INPUT VOLUME, 0..1 with 0.5 unity. Drives the preamp and the tape. */
  input: number
  tape: TapeCondition
}

export const defaultEcho = (): EchoState => ({
  on: false, heads: [true, false, false], spring: false, rate: 0.5, sync: null,
  intensity: 0.35, echo: 0.5, reverb: 0.4, bass: 0.5, treble: 0.5, input: 0.5, tape: 'used',
})

/** Knob values are stored to two decimals. Non-finite input gives `fallback`. */
export const clampKnob = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, Math.round(value * 100) / 100)) : fallback

/** Lenient read of a stored echo (older patterns have none): every field clamped or defaulted. */
export function readEcho(value: unknown): EchoState {
  const d = defaultEcho()
  if (!value || typeof value !== 'object') return d
  const v = value as Record<string, unknown>
  const heads = Array.isArray(v.heads) && v.heads.length === 3 ? (v.heads.map((h) => h === true) as EchoState['heads']) : d.heads
  return {
    on: v.on === true,
    heads,
    spring: v.spring === true,
    rate: clampKnob(v.rate, d.rate),
    sync: typeof v.sync === 'string' && v.sync in ECHO_SYNCS ? (v.sync as EchoSync) : null,
    intensity: clampKnob(v.intensity, d.intensity),
    echo: clampKnob(v.echo, d.echo),
    reverb: clampKnob(v.reverb, d.reverb),
    bass: clampKnob(v.bass, d.bass),
    treble: clampKnob(v.treble, d.treble),
    input: clampKnob(v.input, d.input),
    tape: TAPE_CONDITIONS.includes(v.tape as TapeCondition) ? (v.tape as TapeCondition) : d.tape,
  }
}

export const sameEcho = (a: EchoState, b: EchoState) =>
  a.on === b.on && a.heads.every((h, i) => h === b.heads[i]) && a.spring === b.spring && a.rate === b.rate &&
  a.sync === b.sync && a.intensity === b.intensity && a.echo === b.echo && a.reverb === b.reverb &&
  a.bass === b.bass && a.treble === b.treble && a.input === b.input && a.tape === b.tape

/**
 * RE-201 MODE SELECTOR position for a head/reverb combination (RE-20 owner's manual p. 18):
 * 1-4 echo only, 5-11 echo and reverb, 12 reverb only. Null for combinations the
 * hardware selector does not offer (heads 1+2, 1+3 or 1+2+3 without reverb, or nothing).
 */
export function hardwareMode(heads: readonly boolean[], spring: boolean): number | null {
  const key = (heads[0] ? 1 : 0) | (heads[1] ? 2 : 0) | (heads[2] ? 4 : 0)
  const echoOnly: Record<number, number> = { 1: 1, 2: 2, 4: 3, 6: 4 }
  const withReverb: Record<number, number> = { 0: 12, 1: 5, 2: 6, 4: 7, 3: 8, 6: 9, 5: 10, 7: 11 }
  return (spring ? withReverb[key] : echoOnly[key]) ?? null
}

/** Heads and spring for a MODE SELECTOR position 1-12. */
export function headsForMode(mode: number): { heads: EchoState['heads']; spring: boolean } {
  const table: [number, boolean][] = [[1, false], [2, false], [4, false], [6, false], [1, true], [2, true], [4, true], [3, true], [6, true], [5, true], [7, true], [0, true]]
  const [key, spring] = table[Math.min(11, Math.max(0, Math.round(mode) - 1))]
  return { heads: [(key & 1) !== 0, (key & 2) !== 0, (key & 4) !== 0], spring }
}

/** Index of the earliest active head, or -1. */
export const leadingHead = (heads: readonly boolean[]) => heads.findIndex((h) => h)

/** Tape speed relative to the fastest for a REPEAT RATE knob position (motor speed assumed linear in the knob). */
export const speedForRate = (rate: number) => {
  const slowest = 1 / ECHO_SPEED_RATIO
  return slowest + Math.min(1, Math.max(0, rate)) * (1 - slowest)
}

/** Delay range of head `h` (0-2) in seconds: [fastest tape, slowest tape]. */
export const headRange = (h: number): [number, number] => [ECHO_HEAD_DELAYS_SEC[h], ECHO_HEAD_DELAYS_SEC[h] * ECHO_SPEED_RATIO]

/** A synced repeat time is reachable when the earliest active head can play it. */
export function syncAvailable(sync: EchoSync, heads: readonly boolean[], bpm: number): boolean {
  const h = leadingHead(heads)
  if (h < 0) return false
  const t = (ECHO_SYNCS[sync] * 60) / bpm
  const [lo, hi] = headRange(h)
  return t >= lo - 1e-9 && t <= hi + 1e-9
}

/**
 * Target tape speed (relative to the fastest): from the knob, or from the synced
 * repeat time at the earliest active head, held inside the motor's range.
 */
export function targetSpeed(e: Pick<EchoState, 'rate' | 'sync' | 'heads'>, bpm: number): number {
  const h = leadingHead(e.heads)
  if (!e.sync || h < 0 || !(bpm > 0)) return speedForRate(e.rate)
  const t = (ECHO_SYNCS[e.sync] * 60) / bpm
  return Math.min(1, Math.max(1 / ECHO_SPEED_RATIO, ECHO_HEAD_DELAYS_SEC[h] / t))
}

/** The REPEAT RATE knob position that gives `speed`, for showing a synced setting on the knob. */
export const rateForSpeed = (speed: number) => {
  const slowest = 1 / ECHO_SPEED_RATIO
  return Math.min(1, Math.max(0, (speed - slowest) / (1 - slowest)))
}

/** Per-track send to the echo: 0..1, amplitude is level squared like step levels. Default 1. */
export const clampSend = (value: unknown) => clampKnob(value, 1)
