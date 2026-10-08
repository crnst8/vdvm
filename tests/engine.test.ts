import { describe, it, expect } from 'vitest'
import { AudioEngine, MAX_VOICES, OUTPUT_GAIN_MAX_DB, dbToGain, MASTER_GAIN_DB } from '../src/audio/engine'
import { pitchRate } from '../src/audio/pitch'
import { FakeContext, FakeSource, FakeGain, fakeBuffer } from './fake-audio'

const setup = () => {
  const ctx = new FakeContext()
  const engine = new AudioEngine(ctx)
  const opts = (slotId: string, kitId = 'k') => ({ gainDb: 0, slotId, kitId, generation: 1 })
  return { ctx, engine, opts }
}
// gains[0] is master, gains[1] the output stage; each voice adds one gain after its source.
const voiceGain = (ctx: FakeContext, i: number) => ctx.gains[i + 2] as FakeGain

describe('audio engine', () => {
  it('applies master gain of -12 dB and converts dB with 10^(dB/20)', () => {
    const { ctx } = setup()
    expect(ctx.gains[0].gain.value).toBeCloseTo(dbToGain(MASTER_GAIN_DB))
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3)
  })
  it('closed hat chokes an older open hat with a fade starting at the closed-hat onset', () => {
    const { ctx, engine, opts } = setup()
    engine.trigger(fakeBuffer(), 1.0, opts('hat-open'))
    engine.trigger(fakeBuffer(), 1.5, opts('hat-closed'))
    const open = ctx.sources[0] as FakeSource
    const g = voiceGain(ctx, 0).gain.events
    expect(g.find((e) => e.type === 'set')!.time).toBe(1.5) // not "now" (0)
    expect(g.find((e) => e.type === 'ramp')!.time).toBeCloseTo(1.505)
    expect(open.stopAt).toBeGreaterThan(1.5)
  })
  it('does not choke an open hat that starts after the closed hat', () => {
    const { ctx, engine, opts } = setup()
    engine.trigger(fakeBuffer(), 1.0, opts('hat-closed'))
    engine.trigger(fakeBuffer(), 1.25, opts('hat-open'))
    expect((ctx.sources[1] as FakeSource).stopAt).toBeNull()
  })
  it('open hat never chokes closed hat', () => {
    const { ctx, engine, opts } = setup()
    engine.trigger(fakeBuffer(), 1.0, opts('hat-closed'))
    engine.trigger(fakeBuffer(), 1.1, opts('hat-open'))
    expect((ctx.sources[0] as FakeSource).stopAt).toBeNull()
  })
  it('lets a same-step open hat and closed hat sound together', () => {
    const { ctx, engine, opts } = setup()
    engine.trigger(fakeBuffer(), 2.0, opts('hat-open'))
    engine.trigger(fakeBuffer(), 2.0, opts('hat-closed'))
    expect((ctx.sources[0] as FakeSource).stopAt).toBeNull()
    expect(voiceGain(ctx, 0).gain.events).toHaveLength(0)
  })
  it('stop cancels queued hits and fades sounding voices', () => {
    const { ctx, engine, opts } = setup()
    engine.trigger(fakeBuffer(), 0.0, opts('kick'))
    engine.trigger(fakeBuffer(), 0.5, opts('snare'))
    ctx.currentTime = 0.1
    engine.stopAll()
    const [sounding, queued] = ctx.sources as FakeSource[]
    expect(queued.audible).toBe(false)
    expect(sounding.stopAt).toBeCloseTo(0.106)
    expect(engine.pendingAfter(0.1)).toBe(0)
  })
  it('caps voices at 64 by fading the oldest', () => {
    const { ctx, engine, opts } = setup()
    for (let i = 0; i < MAX_VOICES + 5; i++) engine.trigger(fakeBuffer(480000), i * 0.01, opts('kick'))
    expect(engine.activeVoices).toBe(MAX_VOICES)
    expect((ctx.sources[0] as FakeSource).stopAt).not.toBeNull()
    expect((ctx.sources.at(-1) as FakeSource).stopAt).toBeNull()
  })
  it('does not count hits queued after the cap time or voices that have already ended', () => {
    const { ctx, engine, opts } = setup()
    // 0.1 s buffers, one every 0.2 s: never more than one sounding at once.
    for (let i = 0; i < MAX_VOICES * 2; i++) engine.trigger(fakeBuffer(), i * 0.2, opts('kick'))
    expect(ctx.sources.every((s) => (s as FakeSource).stopAt === null)).toBe(true)
  })
  it('cancels hits from a rewind time and keeps earlier ones', () => {
    const { ctx, engine, opts } = setup()
    for (let i = 0; i < 4; i++) engine.trigger(fakeBuffer(), i * 0.5, opts('kick'))
    engine.cancelFrom(1)
    expect(engine.pendingAfter(0)).toBe(1)
    expect((ctx.sources[1] as FakeSource).stopAt).toBeNull()
    expect((ctx.sources[2] as FakeSource).stopAt).not.toBeNull()
  })
  it('removes voices when they end', () => {
    const { ctx, engine, opts } = setup()
    engine.trigger(fakeBuffer(), 0, opts('kick'))
    ;(ctx.sources[0] as FakeSource).onended!()
    expect(engine.activeVoices).toBe(0)
  })

  it('sets playbackRate from effective cents before start, leaving detune alone', () => {
    const { ctx, engine, opts } = setup()
    const cases: [number, number][] = [[0, 1], [1200, 2], [-1200, 0.5], [2400, 4], [-2400, 0.25], [700, pitchRate(700)]]
    cases.forEach(([cents, rate], i) => {
      engine.trigger(fakeBuffer(), i, { ...opts('kick'), pitchCents: cents })
      const s = ctx.sources[i] as FakeSource
      expect(s.playbackRate.value).toBeCloseTo(rate)
      expect(s.rateAtStart).toBeCloseTo(rate)
      expect(s.startAt).toBe(i)
      expect(s.detune.value).toBe(0)
    })
  })
  it('treats omitted, zero and nonfinite pitch as no tuning', () => {
    const { ctx, engine, opts } = setup()
    engine.trigger(fakeBuffer(), 0, opts('kick'))
    engine.trigger(fakeBuffer(), 1, { ...opts('kick'), pitchCents: 0 })
    engine.trigger(fakeBuffer(), 2, { ...opts('kick'), pitchCents: NaN })
    engine.trigger(fakeBuffer(), 3, { ...opts('kick'), pitchCents: Infinity })
    for (const s of ctx.sources as FakeSource[]) expect(s.playbackRate.value).toBe(1)
  })
  it('lets two sources sharing one buffer play at different rates', () => {
    const { ctx, engine, opts } = setup()
    const shared = fakeBuffer()
    engine.trigger(shared, 0, { ...opts('kick'), pitchCents: 1200 })
    engine.trigger(shared, 0.5, { ...opts('kick'), pitchCents: -1200 })
    expect((ctx.sources[0] as FakeSource).playbackRate.value).toBeCloseTo(2)
    expect((ctx.sources[1] as FakeSource).playbackRate.value).toBeCloseTo(0.5)
    expect(shared.duration).toBe(0.1)
  })
  it('counts a pitched-down voice at a later onset but not a pitched-up one', () => {
    const down = setup()
    for (let i = 0; i < MAX_VOICES; i++) down.engine.trigger(fakeBuffer(48000), 0, { ...down.opts('kick'), pitchCents: -1200 })
    down.ctx.currentTime = 1.5
    down.engine.trigger(fakeBuffer(48000), 1.5, { ...down.opts('kick'), pitchCents: -1200 })
    // A 1 s buffer at rate 0.5 still sounds at 1.5 s, so the cap steals the oldest.
    expect((down.ctx.sources[0] as FakeSource).stopAt).not.toBeNull()
    expect(down.engine.activeVoices).toBe(MAX_VOICES)

    const up = setup()
    for (let i = 0; i < MAX_VOICES; i++) up.engine.trigger(fakeBuffer(48000), 0, { ...up.opts('kick'), pitchCents: 1200 })
    up.ctx.currentTime = 0.75
    up.engine.trigger(fakeBuffer(48000), 0.75, { ...up.opts('kick'), pitchCents: 1200 })
    // A 1 s buffer at rate 2 ended by 0.5 s, so the cap does not steal.
    expect((up.ctx.sources[0] as FakeSource).stopAt).toBeNull()
    expect(up.engine.activeVoices).toBe(MAX_VOICES + 1)
  })
})

describe('output gain', () => {
  const withLimiter = () => {
    const ctx = new FakeContext()
    const limiters: FakeGain[] = []
    const fake = Object.assign(ctx, {
      createDynamicsCompressor: () => {
        const n = Object.assign(new FakeGain(), {
          threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 },
        })
        limiters.push(n)
        return n as unknown as DynamicsCompressorNode
      },
    })
    const engine = new AudioEngine(fake as never)
    // gains[0] is the master, gains[1] the output stage.
    return { ctx, engine, output: ctx.gains[1], limiters }
  }

  it('starts at unity and ramps to the requested level, clamped to the range', () => {
    const { engine, output } = withLimiter()
    expect(output.gain.value).toBe(1)
    engine.setOutputGain(-6)
    expect(output.gain.events.at(-1)).toMatchObject({ type: 'ramp', value: dbToGain(-6) })
    engine.setOutputGain(40)
    expect(output.gain.events.at(-1)!.value).toBeCloseTo(dbToGain(OUTPUT_GAIN_MAX_DB))
  })

  it('puts the limiter in the path only while boosting', () => {
    const { ctx, engine, output, limiters } = withLimiter()
    expect(output.connections).toEqual([ctx.destination])
    engine.setOutputGain(6)
    expect(limiters).toHaveLength(1)
    expect(output.connections).toEqual([limiters[0]])
    engine.setOutputGain(0)
    expect(output.connections).toEqual([ctx.destination])
    engine.setOutputGain(3)
    expect(limiters).toHaveLength(1)
    expect(output.connections).toEqual([limiters[0]])
  })

  it('boosts without a limiter when the context has none', () => {
    const ctx = new FakeContext()
    const engine = new AudioEngine(ctx as never)
    engine.setOutputGain(6)
    expect(ctx.gains[1].connections).toEqual([ctx.destination])
  })
})
