// Circuit timing: documented hardware swing positions and step jitter.
// Pure functions; the random source is injected so tests are deterministic.
import type { JitterProfile, SwingSteps } from '../data/timing'

/**
 * The swing percentage the hardware would actually play for a requested amount:
 * the nearest reachable tick position (or documented value), capped at the machine's maximum.
 */
export function machineSwing(requested: number, steps: SwingSteps | undefined): number {
  if (!steps || requested <= 50) return Math.max(50, requested)
  if (steps.kind === 'values') {
    return steps.values.reduce((best, v) => (Math.abs(v - requested) < Math.abs(best - requested) ? v : best), steps.values[0])
  }
  const unit = 100 / steps.divisions
  const k = Math.min(steps.maxSteps, Math.max(0, Math.round((requested - 50) / unit)))
  return 50 + k * unit
}

/** Stateful per-transport-run jitter source. Offsets are lateness in seconds, never negative. */
export class StepJitter {
  private profile: JitterProfile
  private random: () => number
  /** Phase of the free-running poll loop relative to the audio clock (poll model). */
  private pollPhaseMs: number

  constructor(profile: JitterProfile, random: () => number = Math.random) {
    this.profile = profile
    this.random = random
    this.pollPhaseMs = profile.kind === 'poll' ? random() * profile.pollMs : 0
  }

  /** Lateness for a step whose ideal time is `whenSec` (audio clock). */
  offsetSec(whenSec: number): number {
    const p = this.profile
    if (p.kind === 'measured') {
      // Shape u^k so the mean matches the published average: mean = max / (k + 1).
      const k = p.meanMs && p.meanMs > 0 && p.meanMs < p.maxMs ? p.maxMs / p.meanMs - 1 : 1
      return (p.maxMs * this.random() ** k) / 1000
    }
    // Poll model: the step is noticed at the next poll of the free-running loop,
    // then waits for whatever the CPU is doing; the sum never exceeds the measured maximum.
    const tMs = whenSec * 1000 + this.pollPhaseMs
    const toNextPoll = (p.pollMs - (tMs % p.pollMs)) % p.pollMs
    const cpu = this.random() * Math.max(0, p.maxMs - p.pollMs)
    return Math.min(p.maxMs, toNextPoll + cpu) / 1000
  }
}
