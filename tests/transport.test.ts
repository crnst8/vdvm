import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { Transport } from '../src/audio/transport'
import { newPatternState, patternReducer, type PatternState } from '../src/state/pattern'
import { pitchRate } from '../src/audio/pitch'
import type { CatalogIndex, KitManifest } from '../src/contract/types'
import { FakeContext, type FakeSource } from './fake-audio'

const index: CatalogIndex = JSON.parse(readFileSync('public/fixture/catalog/index.json', 'utf8'))
const kit = (id: string): KitManifest =>
  JSON.parse(readFileSync(`public/fixture/${index.kits.find((k) => k.id === id)!.url}`, 'utf8'))
const kitA = kit('test-tones-a')
const kitB = kit('test-tones-b')
// Circuit timing is keyed by machine; the synthesised kit stands in for a TR-909.
const kitC = { ...kit('test-tones-c'), machineId: 'roland-tr-909' }

function setup(opts: { fail?: (url: string) => boolean; hold?: boolean } = {}) {
  const ctx = new FakeContext()
  const held: (() => void)[] = []
  let fetches = 0
  const t = new Transport({
    createContext: () => ctx as never,
    resolveUrl: (u) => u,
    fetcher: async (url) => {
      fetches++
      if (opts.hold) await new Promise<void>((r) => held.push(r))
      if (opts.fail?.(url)) throw new Error('HTTP 404')
      return new ArrayBuffer(8)
    },
  })
  return { t, ctx, held, fetches: () => fetches }
}

const demo = (k: KitManifest): PatternState => {
  let s = newPatternState(k, 'p')
  const on = (slotId: string, steps: number[]) => {
    for (const step of steps) s = patternReducer(s, { type: 'toggleStep', slotId, step, sampleId: '' })
  }
  on('kick', [0, 4, 8, 12])
  on('snare', [4, 12])
  on('hat-closed', [0, 2, 4, 6, 8, 10, 12])
  on('hat-open', [14])
  return s
}

const tickTo = (t: Transport, ctx: FakeContext, to: number) => {
  const sched = (t as unknown as { scheduler: { tick(): void } }).scheduler
  while (ctx.currentTime < to - 1e-9) {
    ctx.currentTime = Math.min(to, ctx.currentTime + 0.025)
    sched.tick()
  }
}

describe('transport', () => {
  it('loads a kit, becomes ready and plays the demo beat with no fetch or decode during playback', async () => {
    const { t, ctx, fetches } = setup()
    t.setPattern(demo(kitA))
    expect(await t.selectKit(kitA)).toBe(true)
    expect(t.getSnapshot()).toMatchObject({ kitStatus: 'ready', kitId: kitA.id })
    const f0 = fetches()
    const d0 = ctx.decodes
    t.play()
    tickTo(t, ctx, 2.05) // one bar at 120 BPM = 2 s
    expect(fetches()).toBe(f0)
    expect(ctx.decodes).toBe(d0)
    // One bar: 4 kicks + 2 snares + 7 closed + 1 open = 14 hits.
    const firstBar = ctx.sources.filter((s: FakeSource) => s.startAt! < 0.05 + 2 - 1e-9)
    expect(firstBar).toHaveLength(14)
    t.stop()
    const afterStop = ctx.sources.length
    tickTo(t, ctx, 3)
    expect(ctx.sources.length).toBe(afterStop)
    expect(ctx.sources.filter((s) => s.startAt! > 2.05 && s.audible)).toHaveLength(0)
  })
  it('ignores a stale kit request that finishes after a newer one', async () => {
    const { t, held } = setup({ hold: true })
    const first = t.selectKit(kitB)
    const second = t.selectKit(kitC)
    await new Promise((r) => setTimeout(r, 0))
    // Release all fetches (in whatever order); the newer request must win.
    while (held.length) {
      held.pop()!()
      await new Promise((r) => setTimeout(r, 0))
    }
    expect(await second).toBe(true)
    expect(await first).toBe(false)
    expect(t.getSnapshot().kitId).toBe(kitC.id)
  })
  it('keeps the old kit when a switch fails and reports the error', async () => {
    const failing = kitB.samples[0].url
    const { t } = setup({ fail: (u) => u === failing })
    await t.selectKit(kitA)
    expect(await t.selectKit(kitB)).toBe(false)
    expect(t.getSnapshot()).toMatchObject({ kitId: kitA.id, kitStatus: 'ready' })
    expect(t.getSnapshot().error).toMatch(/Could not load Tones B/)
  })
  it('swaps kits at the next bar boundary while playing', async () => {
    const { t, ctx } = setup()
    let s = demo(kitA)
    t.setPattern(s)
    await t.selectKit(kitA)
    t.play()
    tickTo(t, ctx, 0.5)
    s = patternReducer(s, { type: 'bindKit', kit: kitC })
    await t.selectKit(kitC)
    t.setPattern(s)
    expect(t.getSnapshot().kitId).toBe(kitA.id) // still old kit mid-bar
    tickTo(t, ctx, 2.2)
    const beforeBoundary = ctx.sources.filter((x) => x.startAt! > 0.5 && x.startAt! < 2.05 - 1e-9 && x.audible).length
    expect(t.getSnapshot().kitId).toBe(kitC.id)
    // Old kit kept playing the rest of the bar (steps 4..15 of the demo: 2 kicks, 2 snares, 5 hats, 1 open hat).
    expect(beforeBoundary).toBeGreaterThanOrEqual(8)
    // New kit's chosen samples were decoded and play from the boundary.
    expect(ctx.sources.some((x) => x.startAt! >= 2.05 - 1e-9 && x.audible)).toBe(true)
    t.stop()
  })
  it('keeps a missing variant silent instead of substituting', async () => {
    const { t, ctx } = setup()
    let s = demo(kitA)
    s = { ...s, tracks: { ...s.tracks, kick: { ...s.tracks.kick, sampleId: 'test-tones-a-kick-99' } } }
    t.setPattern(s)
    await t.selectKit(kitA)
    t.play()
    tickTo(t, ctx, 2.05)
    // 14 hits minus 4 kicks.
    expect(ctx.sources.filter((x) => x.startAt! < 2.05 - 1e-9)).toHaveLength(10)
    t.stop()
  })
  it('keeps playing while the page is hidden and reschedules cleanly when shown', async () => {
    const { t, ctx } = setup()
    t.setPattern(demo(kitA))
    await t.selectKit(kitA)
    t.play()
    tickTo(t, ctx, 0.3)
    t.setPageHidden(true)
    tickTo(t, ctx, 0.325)
    expect(t.getSnapshot().playing).toBe(true)
    // Hidden: hits are queued about 1.5 s ahead.
    expect(Math.max(...ctx.sources.map((x) => x.startAt ?? 0))).toBeGreaterThan(1.5)
    t.setPageHidden(false)
    tickTo(t, ctx, 4.05)
    t.stop()
    // Each demo hit sounds once per bar: no hit cancelled by the rewind is lost or doubled.
    const sounded = ctx.sources.filter((x) => x.audible).map((x) => x.startAt!)
    const bar1 = sounded.filter((x) => +x < 2.05).length
    const bar2 = sounded.filter((x) => +x >= 2.05 && +x < 4.05).length
    expect(bar1).toBe(bar2)
    expect(bar1).toBe(14)
  })
  it('keeps playback on through a system audio interruption', async () => {
    const { t, ctx } = setup()
    t.setPattern(demo(kitA))
    await t.selectKit(kitA)
    t.play()
    tickTo(t, ctx, 0.3)
    ctx.state = 'suspended'
    ;(ctx.onstatechange as () => void)()
    expect(t.getSnapshot().playing).toBe(true)
    expect(t.getSnapshot().notice).toMatch(/paused by the system/)
    ctx.state = 'running'
    ;(ctx.onstatechange as () => void)()
    expect(t.getSnapshot().notice).toBe(null)
    expect(t.getSnapshot().playing).toBe(true)
    t.stop()
  })
  it('applies drum volume and step level, and skips silent steps', async () => {
    const { t, ctx } = setup()
    let s = demo(kitA)
    s = patternReducer(s, { type: 'setTrackGain', slotId: 'kick', gainDb: -6 })
    s = patternReducer(s, { type: 'setStepLevel', slotId: 'snare', step: 4, level: 0 })
    t.setPattern(s)
    await t.selectKit(kitA)
    t.play()
    tickTo(t, ctx, 2.05)
    t.stop()
    // 14 demo hits minus the silenced snare on step 5.
    expect(ctx.sources.filter((x) => x.startAt! < 2.05 - 1e-9)).toHaveLength(13)
    // Voice gains: kick = normalisation (0 dB for fake buffers) + track (-6); catalog slot gain is not applied.
    const expected = 10 ** (-6 / 20)
    expect(ctx.gains.some((g) => Math.abs(g.gain.value - expected) < 1e-9)).toBe(true)
  })
  it('auditions overall pitch alone and overall plus step offset for a step', async () => {
    const { t, ctx } = setup()
    let s = demo(kitA)
    s = patternReducer(s, { type: 'setPitch', pitchCents: 300 })
    s = patternReducer(s, { type: 'setStepPitch', slotId: 'kick', step: 2, pitchCents: -500 })
    t.setPattern(s)
    await t.selectKit(kitA)
    t.audition('kick', null)
    t.audition('kick', 2)
    expect((ctx.sources[0] as FakeSource).playbackRate.value).toBeCloseTo(pitchRate(300))
    expect((ctx.sources[1] as FakeSource).playbackRate.value).toBeCloseTo(pitchRate(-200))
  })
  it('applies composed pitch to sequenced hits without adding fetches or decodes', async () => {
    const { t, ctx, fetches } = setup()
    let s = demo(kitA)
    s = patternReducer(s, { type: 'setPitch', pitchCents: 100 })
    s = patternReducer(s, { type: 'setStepPitch', slotId: 'kick', step: 0, pitchCents: 1100 })
    t.setPattern(s)
    await t.selectKit(kitA)
    const f0 = fetches()
    const d0 = ctx.decodes
    t.play()
    tickTo(t, ctx, 2.05)
    t.stop()
    expect(fetches()).toBe(f0)
    expect(ctx.decodes).toBe(d0)
    const rates = (ctx.sources as FakeSource[]).map((x) => x.playbackRate.value)
    expect(rates.some((r) => Math.abs(r - pitchRate(1200)) < 1e-9)).toBe(true)
    expect(rates.some((r) => Math.abs(r - pitchRate(100)) < 1e-9)).toBe(true)
  })
  it('circuit timing: TR-909 steps land late by at most the measured 4.46 ms, all voices of a step together', async () => {
    const run = async (circuit: boolean) => {
      const { t, ctx } = setup()
      const s = { ...demo(kitC), circuit }
      t.setPattern(s)
      await t.selectKit(kitC)
      t.play()
      tickTo(t, ctx, 8.05) // four bars at 120 BPM
      t.stop()
      return ctx.sources.map((x) => x.startAt!).filter((x) => x < 8)
    }
    const straight = await run(false)
    const circuit = await run(true)
    const step = 60 / 120 / 4
    const lateness = (t: number) => ((t - 0.05) % step + step) % step
    expect(straight.every((x) => lateness(x) < 1e-9 || step - lateness(x) < 1e-9)).toBe(true)
    const late = circuit.map(lateness)
    expect(Math.max(...late)).toBeLessThanOrEqual(0.00446 + 1e-9)
    expect(late.some((x) => x > 0.0005)).toBe(true)
    // Hits sharing a step share one lateness (the clock, not the voice, is late).
    const byStep = new Map<number, Set<string>>()
    for (const x of circuit) {
      const k = Math.round((x - 0.05) / step)
      byStep.set(k, (byStep.get(k) ?? new Set()).add(lateness(x).toFixed(9)))
    }
    expect([...byStep.values()].every((v) => v.size === 1)).toBe(true)
  })
  it('circuit timing: swing snaps to the machine positions only when circuit is on', async () => {
    const { t } = setup()
    t.setPattern({ ...demo(kitC), swing: 63 })
    await t.selectKit(kitC)
    expect(t.effectiveSwing().amount).toBe(63)
    t.setPattern({ ...demo(kitC), swing: 63, circuit: true })
    expect(t.effectiveSwing().amount).toBeCloseTo(62.5, 6)
  })
})
