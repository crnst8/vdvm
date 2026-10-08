// Sample tuning maths. Pure numbers; no browser or React imports.
// 100 cents = 1 semitone. Overall pitch and per-step offsets are each bounded
// to one octave, so their sum is bounded to two.
export const PITCH_MIN_CENTS = -1200
export const PITCH_MAX_CENTS = 1200
export const EFFECTIVE_PITCH_MIN_CENTS = -2400
export const EFFECTIVE_PITCH_MAX_CENTS = 2400

/** Normalise a stored/imported overall or step offset to an integer ±1200 cents; 0 for anything else. */
export function clampPitchCents(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(PITCH_MAX_CENTS, Math.max(PITCH_MIN_CENTS, Math.round(value)))
}

/**
 * Playback rate for an already-composed pitch (overall + step). Bounds finite
 * cents to the two-octave sum range; nonfinite input means no tuning.
 */
export function pitchRate(effectiveCents: number): number {
  const cents = Number.isFinite(effectiveCents)
    ? Math.min(EFFECTIVE_PITCH_MAX_CENTS, Math.max(EFFECTIVE_PITCH_MIN_CENTS, effectiveCents))
    : 0
  return 2 ** (cents / 1200)
}
