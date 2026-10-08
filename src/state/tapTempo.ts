// Tap tempo: BPM from the intervals between taps. Pure; callers pass event timestamps (ms).

export const TAP_RESET_MS = 2000
export const TAP_WINDOW = 8

export interface TapState {
  times: number[]
}

export const emptyTaps = (): TapState => ({ times: [] })

/**
 * Add a tap. A gap longer than TAP_RESET_MS starts a new measurement. Keeps the
 * last TAP_WINDOW taps. Returns the new state and the BPM (null until two taps).
 */
export function addTap(state: TapState, at: number, clamp: (bpm: number) => number): { state: TapState; bpm: number | null } {
  const last = state.times[state.times.length - 1]
  const times = last !== undefined && at - last <= TAP_RESET_MS && at > last ? [...state.times, at].slice(-TAP_WINDOW) : [at]
  if (times.length < 2) return { state: { times }, bpm: null }
  const intervals = times.slice(1).map((t, i) => t - times[i])
  // Median resists one late or early tap better than the mean.
  const sorted = [...intervals].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return { state: { times }, bpm: clamp(60000 / median) }
}
