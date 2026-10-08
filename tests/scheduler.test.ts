import { describe, it, expect } from 'vitest'
import { StepScheduler, sixteenthSec, LOOKAHEAD_SEC, BACKGROUND_LOOKAHEAD_SEC } from '../src/audio/scheduler'

function harness(bpm = 120) {
  const clock = { t: 0, bpm, length: 16, swing: 50, grid: 16 as 8 | 16 }
  const hits: { step: number; when: number; gen: number }[] = []
  let skipped = 0
  const s = new StepScheduler({
    now: () => clock.t,
    getBpm: () => clock.bpm,
    getLength: () => clock.length,
    getSwing: () => ({ amount: clock.swing, grid: clock.grid }),
    scheduleStep: (step, when, gen) => hits.push({ step, when, gen }),
    onSkip: (n) => (skipped += n),
    setTimer: () => 1,
    clearTimer: () => {},
  })
  /** Advance the clock to `to` with regular 25 ms wakeups. */
  const advance = (to: number) => {
    while (clock.t < to - 1e-9) {
      clock.t = Math.min(to, clock.t + 0.025)
      s.tick()
    }
  }
  return { clock, hits, s, advance, skipped: () => skipped }
}

describe('step scheduler', () => {
  it.each([8, 16] as const)('swings the 1/%i grid without changing bar duration or drifting', (grid) => {
    const { clock, hits, s, advance } = harness()
    clock.swing = 75
    clock.grid = grid
    s.start(0)
    advance(.2)
    expect(s.stepAt(.2)).toBe(1)
    advance(20)
    const expected = grid === 16 ? [0, .1875, .25, .4375, .5] : [0, .1875, .375, .4375, .5]
    expected.forEach((time, i) => expect(hits[i].when).toBeCloseTo(time, 9))
    hits.filter((h) => h.step === 0).forEach((h, i) => expect(h.when).toBeCloseTo(i * 2, 9))
  })
  it('latches the swing amount until the next pair to preserve its duration during live edits', () => {
    const { clock, hits, s, advance } = harness()
    clock.swing = 75
    s.start(0)
    clock.swing = 50
    advance(.8)
    expect(hits[1].when).toBeCloseTo(.1875, 9)
    expect(hits[2].when).toBeCloseTo(.25, 9)
    expect(hits[3].when).toBeCloseTo(.375, 9)
  })
  it('changes swing grid at a shared beat boundary without shortening the current beat', () => {
    const { clock, hits, s, advance } = harness()
    clock.swing = 75
    clock.grid = 8
    s.start(0)
    clock.grid = 16
    advance(.9)
    expect(hits.slice(0, 7).map((h) => h.when)).toEqual([0, .1875, .375, .4375, .5, .6875, .75])
  })
  it('wraps 16 steps and never drifts under jittery wakeups', () => {
    const { clock, hits, s } = harness(120)
    s.start(0.05)
    // 10 minutes of ticks with jitter between 5 and 45 ms.
    let seed = 1
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    while (clock.t < 600) {
      clock.t += 0.005 + rand() * 0.04
      s.tick()
    }
    const dt = sixteenthSec(120)
    hits.forEach((h, i) => {
      expect(h.step).toBe(i % 16)
      expect(Math.abs(h.when - (0.05 + i * dt))).toBeLessThan(1e-6)
    })
    // No step scheduled beyond the lookahead horizon, none skipped.
    expect(hits.at(-1)!.when).toBeLessThan(clock.t + LOOKAHEAD_SEC + 1e-9)
    expect(hits.length).toBe(Math.floor((hits.at(-1)!.when - 0.05) / dt + 1e-6) + 1)
  })
  it('applies tempo changes at the next unscheduled step only', () => {
    const { clock, hits, s, advance } = harness(120)
    s.start(0)
    const before = hits.length
    const lastBefore = hits.at(-1)!.when
    clock.bpm = 60
    advance(0.8)
    // Already scheduled steps keep their times.
    expect(hits.slice(0, before).map((h) => h.when)).toEqual(hits.slice(0, before).map((_, i) => i * sixteenthSec(120)))
    // First new step keeps the old spacing (its time was fixed when the prior step was scheduled); after that, 60 BPM.
    expect(hits[before].when).toBeCloseTo(lastBefore + sixteenthSec(120), 9)
    expect(hits[before + 1].when - hits[before].when).toBeCloseTo(sixteenthSec(60), 9)
  })
  it('ignores a duplicate start and restarts from step 0 with a new generation', () => {
    const { clock, hits, s, advance } = harness()
    const g1 = s.start(0)
    expect(s.start(0)).toBe(g1)
    const firstCount = hits.length
    expect(new Set(hits.map((h) => h.when)).size).toBe(firstCount)
    advance(0.5)
    s.stop()
    const afterStop = hits.length
    clock.t = 0.6
    s.tick()
    expect(hits.length).toBe(afterStop) // no hits while stopped
    clock.t = 0.95
    const g2 = s.start(1)
    expect(g2).toBeGreaterThan(g1)
    expect(hits[afterStop]).toMatchObject({ step: 0, when: 1, gen: g2 })
  })
  it('skips missed steps on the grid instead of bursting late hits', () => {
    const { clock, hits, s, skipped } = harness()
    s.start(0)
    const n = hits.length
    clock.t = 2 // timer starved for 2 s
    s.tick()
    expect(s.running).toBe(true)
    // Nothing earlier than the late limit sounds; playback resumes in phase.
    const fresh = hits.slice(n)
    expect(fresh.every((h) => h.when >= 2 - 0.05)).toBe(true)
    expect(fresh[0].when / sixteenthSec(120)).toBeCloseTo(Math.round(fresh[0].when / sixteenthSec(120)), 9)
    expect(fresh[0].step).toBe(Math.round(fresh[0].when / sixteenthSec(120)) % 16)
    expect(skipped()).toBeGreaterThan(0)
  })
  it('queues further ahead in the background and rewinds when visible', () => {
    const { clock, hits, s, advance } = harness()
    s.start(0)
    s.setBackground(true)
    clock.t = 0.025
    s.tick()
    expect(hits.at(-1)!.when).toBeGreaterThan(clock.t + BACKGROUND_LOOKAHEAD_SEC - sixteenthSec(120) - 1e-9)
    s.setBackground(false)
    const cut = s.rewind(clock.t + LOOKAHEAD_SEC)!
    expect(cut).toBeGreaterThanOrEqual(clock.t + LOOKAHEAD_SEC)
    const kept = hits.filter((h) => h.when < cut).length
    hits.splice(kept)
    advance(3)
    // The rewound steps are scheduled again exactly once, on the same grid.
    hits.forEach((h, i) => {
      expect(h.step).toBe(i % 16)
      expect(h.when).toBeCloseTo(i * sixteenthSec(120), 9)
    })
  })
  it('reports the step playing at an audio time', () => {
    const { s, advance } = harness(120)
    s.start(0)
    advance(0.3)
    expect(s.stepAt(0)).toBe(0)
    expect(s.stepAt(0.13)).toBe(1)
    expect(s.stepAt(0.26)).toBe(2)
  })
  it('loops steps 1-8 when the length is 8, and a mid-bar change wraps at the new end', () => {
    const { clock, hits, s, advance } = harness(120)
    clock.length = 8
    s.start(0)
    advance(2.5)
    expect(hits.slice(0, 18).map((h) => h.step)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7, 0, 1])
    s.stop()
    hits.length = 0
    clock.length = 16
    clock.t = 3
    s.start(3.05)
    advance(4.4) // steps 0..10 scheduled
    clock.length = 8
    advance(5.5)
    const steps = hits.map((h) => h.step)
    const firstWrap = steps.indexOf(0, 1)
    expect(steps.slice(0, firstWrap).every((x, i) => x === i)).toBe(true)
    expect(Math.max(...steps.slice(firstWrap))).toBeLessThan(8)
  })
})
