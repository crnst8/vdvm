import { describe, it, expect } from 'vitest'
import { machineSwing, StepJitter } from '../src/audio/circuit'
import { CIRCUITS, circuitFor } from '../src/data/timing'

const seeded = (seed = 7) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

describe('machine swing positions', () => {
  it('maps Linn-lineage displayed values to their tick timings', () => {
    const dmx = CIRCUITS['oberheim-dmx'].swing!.grids[16]!
    expect(machineSwing(54, dmx)).toBeCloseTo(54.1667, 3)
    expect(machineSwing(62, dmx)).toBeCloseTo(62.5, 3)
    expect(machineSwing(63, dmx)).toBeCloseTo(62.5, 3) // E-mu "63" is the same timing as DMX "62"
    expect(machineSwing(66, dmx)).toBeCloseTo(66.6667, 3)
    expect(machineSwing(75, dmx)).toBeCloseTo(70.8333, 3) // capped at the machine maximum
    expect(machineSwing(50, dmx)).toBe(50)
  })
  it('follows grid-specific limits (R-50 refuses 54/63/71 on 1/16; HR-16 range depends on grid)', () => {
    const r50 = CIRCUITS['kawai-r50'].swing!.grids
    expect(machineSwing(54, r50[16])).toBe(50)
    expect(machineSwing(63, r50[16])).toBeCloseTo(66.667, 2)
    expect(machineSwing(54, r50[8])).toBeCloseTo(54.1667, 3)
    const hr = CIRCUITS['alesis-hr-16'].swing!.grids
    expect(machineSwing(75, hr[16])).toBeCloseTo(66.6667, 3)
    expect(machineSwing(75, hr[8])).toBeCloseTo(68.75, 3)
  })
  it('snaps to documented values when true timings are unknown', () => {
    expect(machineSwing(65, CIRCUITS['boss-dr-660'].swing!.grids[16])).toBe(67)
    expect(machineSwing(75, CIRCUITS['alesis-sr-16'].swing!.grids[16])).toBe(62)
  })
  it('passes through when a machine has no swing data', () => {
    expect(machineSwing(61, undefined)).toBe(61)
  })
})

describe('step jitter', () => {
  it('matches the TR-808 measured maximum and average', () => {
    const j = new StepJitter(circuitFor('roland-tr-808')!.jitter!, seeded())
    const xs = Array.from({ length: 20000 }, (_, i) => j.offsetSec(i * 0.125) * 1000)
    expect(Math.max(...xs)).toBeLessThanOrEqual(2.052 + 1e-9)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length
    expect(mean).toBeCloseTo(1.72, 1)
  })
  it('keeps the TR-909 poll model within 4.46 ms and makes it depend on step time (cyclical)', () => {
    const p = circuitFor('roland-tr-909')!.jitter!
    const zeroCpu = new StepJitter(p, () => 0)
    const xs = Array.from({ length: 400 }, (_, i) => zeroCpu.offsetSec(i * 0.12347) * 1000)
    expect(Math.max(...xs)).toBeLessThanOrEqual(2 + 1e-9) // poll alone is under one poll period
    expect(new Set(xs.map((x) => x.toFixed(3))).size).toBeGreaterThan(10) // varies with timing, not constant
    const full = new StepJitter(p, seeded(3))
    const ys = Array.from({ length: 20000 }, (_, i) => full.offsetSec(i * 0.1171) * 1000)
    expect(Math.max(...ys)).toBeLessThanOrEqual(4.46 + 1e-9)
    expect(Math.max(...ys)).toBeGreaterThan(3.5)
  })
  it('lists only machines with documented data, each with a source', () => {
    for (const [id, c] of Object.entries(CIRCUITS)) {
      expect(c.swing || c.jitter, id).toBeTruthy()
      if (c.jitter) expect(c.jitter.source.url, id).toMatch(/^https:\/\//)
      if (c.swing) expect(c.swing.source.url, id).toMatch(/^https:\/\//)
    }
  })
})
