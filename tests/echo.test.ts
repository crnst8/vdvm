import { describe, expect, it } from 'vitest'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { readFileSync, readdirSync } from 'node:fs'
import {
  ECHO_FAST_TAU_SEC, ECHO_HEAD_DELAYS_SEC, ECHO_SLOW_TAU_SEC, ECHO_SPEED_RATIO, defaultEcho, hardwareMode, headRange,
  headsForMode, readEcho, syncAvailable, targetSpeed,
} from '../src/audio/echo/settings'
import { ECHO_CONTROL_FRAMES, TapeEcho, echoDspParams, echoTailSec, erf, type EchoDspParams } from '../src/audio/echo/dsp'
import { fromPattern, hitSend, patternReducer, toPattern } from '../src/state/pattern'
import type { Pattern } from '../src/contract/types'

const params = (over: Partial<EchoDspParams> = {}): EchoDspParams => ({ ...echoDspParams({ ...defaultEcho(), on: true }, 120), ...over })

/** Render `seconds` of the echo's response to `input` (a function of the frame index). */
function render(p: EchoDspParams, seconds: number, input: (i: number) => number = (i) => (i === 0 ? 0.5 : 0), fs = 48000) {
  const echo = new TapeEcho(fs)
  echo.set(p)
  const n = Math.round(seconds * fs)
  const x = new Float32Array(n).map((_, i) => input(i))
  const left = new Float32Array(n), right = new Float32Array(n)
  echo.process(x, left, right, n)
  return { left, right, echo }
}

/** Frame of the first sample above `level` from `from` on. */
const firstAbove = (a: Float32Array, level: number, from = 0) => {
  for (let i = from; i < a.length; i++) if (Math.abs(a[i]) > level) return i
  return -1
}

describe('echo settings', () => {
  it('maps head and reverb combinations to the RE-201 mode selector (RE-20 manual p. 18)', () => {
    const table: [boolean[], boolean, number][] = [
      [[true, false, false], false, 1], [[false, true, false], false, 2], [[false, false, true], false, 3], [[false, true, true], false, 4],
      [[true, false, false], true, 5], [[false, true, false], true, 6], [[false, false, true], true, 7], [[true, true, false], true, 8],
      [[false, true, true], true, 9], [[true, false, true], true, 10], [[true, true, true], true, 11], [[false, false, false], true, 12],
    ]
    for (const [heads, spring, mode] of table) {
      expect(hardwareMode(heads, spring)).toBe(mode)
      expect(headsForMode(mode)).toEqual({ heads, spring })
    }
    expect(hardwareMode([true, true, false], false)).toBeNull()
    expect(hardwareMode([false, false, false], false)).toBeNull()
  })
  it('covers the measured head ranges (UA: 69-177, 131-337, 189-489 ms)', () => {
    expect(headRange(0)[1] * 1000).toBeCloseTo(177, -0.5)
    expect(headRange(1)[1] * 1000).toBeCloseTo(337, -0.5)
    expect(headRange(2)[1] * 1000).toBeCloseTo(489, -0.7)
  })
  it('syncs the earliest active head to the tempo inside the motor range', () => {
    const e = { ...defaultEcho(), heads: [false, true, true] as [boolean, boolean, boolean], sync: '1/8' as const }
    // 1/8 at 120 BPM = 250 ms on head 2.
    expect(ECHO_HEAD_DELAYS_SEC[1] / targetSpeed(e, 120)).toBeCloseTo(0.25, 9)
    expect(syncAvailable('1/8', e.heads, 120)).toBe(true)
    expect(syncAvailable('1/4', e.heads, 120)).toBe(false)
    // Out of range holds the motor at its limit.
    expect(targetSpeed({ ...e, sync: '1/4' }, 60)).toBeCloseTo(1 / ECHO_SPEED_RATIO, 9)
    expect(targetSpeed({ ...e, sync: '1/32' }, 240)).toBe(1)
    expect(targetSpeed({ ...e, sync: null, rate: 1 }, 120)).toBe(1)
  })
  it('reads stored settings leniently', () => {
    expect(readEcho(undefined)).toEqual(defaultEcho())
    const e = readEcho({ on: true, heads: [1, true, 'x'], rate: 3, sync: '1/5', intensity: 0.444, tape: 'mint' })
    expect(e.on).toBe(true)
    expect(e.heads).toEqual([false, true, false])
    expect(e.rate).toBe(1)
    expect(e.sync).toBeNull()
    expect(e.intensity).toBe(0.44)
    expect(e.tape).toBe('used')
  })
})

describe('echo in the pattern', () => {
  const base: Pattern = {
    schemaVersion: 1, id: 'p', name: 'T', kitId: 'k', kitRevision: '0123456789abcdef', bpm: 120,
    tracks: [{ slotId: 'kick', sampleId: 's', steps: new Array(16).fill(false) as never }], updatedAt: '2026-10-21T00:00:00Z',
  }
  it('omits default settings and round-trips edited ones', () => {
    let s = fromPattern(base, false)
    expect(toPattern(s).echo).toBeUndefined()
    expect(toPattern(s).tracks[0].echoSend).toBeUndefined()
    s = patternReducer(s, { type: 'setEcho', echo: { on: true, heads: [false, true, true], spring: true, sync: '1/8D', bass: 0.7 } })
    s = patternReducer(s, { type: 'setEchoSend', slotId: 'kick', send: 0.25 })
    const saved = toPattern(s)
    expect(saved.echo).toMatchObject({ on: true, heads: [false, true, true], spring: true, sync: '1/8D', bass: 0.7 })
    expect(saved.tracks[0].echoSend).toBe(0.25)
    const back = fromPattern(JSON.parse(JSON.stringify(saved)), true)
    expect(back.echo).toEqual(s.echo)
    expect(back.tracks.kick.echoSend).toBe(0.25)
    expect(hitSend(back, back.tracks.kick)).toBeCloseTo(0.0625)
    expect(hitSend({ echo: { ...back.echo, on: false } }, back.tracks.kick)).toBe(0)
  })
  it('validates against the pattern schema', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true })
    for (const f of readdirSync('catalog/schema').filter((f) => f.endsWith('.schema.json'))) ajv.addSchema(JSON.parse(readFileSync(`catalog/schema/${f}`, 'utf8')))
    const valid = ajv.getSchema('pattern.schema.json')!
    let s = fromPattern(base, false)
    s = patternReducer(s, { type: 'setEcho', echo: { on: true, sync: '1/16' } })
    s = patternReducer(s, { type: 'setEchoSend', slotId: 'kick', send: 0.5 })
    expect(valid(toPattern(s))).toBe(true)
    expect(valid({ ...toPattern(s), echo: { ...toPattern(s).echo, sync: null } })).toBe(true)
    expect(valid({ ...toPattern(s), echo: { ...toPattern(s).echo, tape: 'mint' } })).toBe(false)
    expect(valid({ ...toPattern(s), echo: { ...toPattern(s).echo, intensity: 2 } })).toBe(false)
  })
})

describe('tape echo DSP', () => {
  it('approximates erf to 1.5e-7', () => {
    expect(erf(0)).toBeCloseTo(0, 8)
    expect(erf(0.5)).toBeCloseTo(0.5204998778, 6)
    expect(erf(-1.5)).toBeCloseTo(-0.9661051465, 6)
  })
  it('plays each head at its distance from the record head at the fastest and slowest tape', () => {
    for (const [speed, scale] of [[1, 1], [1 / ECHO_SPEED_RATIO, ECHO_SPEED_RATIO]] as const) {
      for (let h = 0; h < 3; h++) {
        const heads = [h === 0, h === 1, h === 2]
        const { left } = render(params({ speed, heads, intensity: 0 }), 0.6)
        const at = firstAbove(left, 0.002) / 48000
        // The playback filters spread the impulse by a millisecond or so.
        expect(at).toBeGreaterThan(ECHO_HEAD_DELAYS_SEC[h] * scale - 0.002)
        expect(at).toBeLessThan(ECHO_HEAD_DELAYS_SEC[h] * scale + 0.002)
      }
    }
  })
  it('keeps head timing at other sample rates', () => {
    for (const fs of [44100, 96000]) {
      const { left } = render(params({ speed: 1, heads: [false, false, true], intensity: 0 }), 0.3, undefined, fs)
      expect(firstAbove(left, 0.002) / fs).toBeCloseTo(ECHO_HEAD_DELAYS_SEC[2], 2)
    }
  })
  it('changes speed with the measured motor time constants and bends the pitch of the repeats', () => {
    const fs = 48000
    const echo = new TapeEcho(fs)
    echo.set(params({ speed: 1, heads: [true, false, false], intensity: 0 }))
    const block = ECHO_CONTROL_FRAMES * 4
    const zeros = new Float32Array(block), l = new Float32Array(block), r = new Float32Array(block)
    const run = (seconds: number) => { for (let i = 0; i < Math.round(seconds * fs / block); i++) echo.process(zeros, l, r, block) }
    const delay = () => (echo as unknown as { delay1: number }).delay1
    run(0.1)
    echo.set(params({ speed: 0.5, heads: [true, false, false], intensity: 0 }))
    run(ECHO_SLOW_TAU_SEC)
    // One time constant: 63% of the way from 69 ms to 138 ms.
    expect((delay() - 0.069) / 0.069).toBeCloseTo(1 - Math.exp(-1), 2)
    run(10)
    echo.set(params({ speed: 1, heads: [true, false, false], intensity: 0 }))
    run(ECHO_FAST_TAU_SEC)
    expect((0.138 - delay()) / 0.069).toBeCloseTo(1 - Math.exp(-1), 2)

    // A 1 kHz tone recorded at speed 1 and played while the tape slows comes back lower.
    const tone = new TapeEcho(fs)
    tone.set(params({ speed: 1, heads: [false, false, true], intensity: 0, tape: 'new' }))
    const n = fs
    const x = new Float32Array(n).map((_, i) => (i < 0.15 * fs ? 0.2 * Math.sin(2 * Math.PI * 1000 * i / fs) : 0))
    const L = new Float32Array(n), R = new Float32Array(n)
    tone.process(x.subarray(0, 0.15 * fs), L.subarray(0, 0.15 * fs), R.subarray(0, 0.15 * fs), 0.15 * fs)
    tone.set(params({ speed: 1 / ECHO_SPEED_RATIO, heads: [false, false, true], intensity: 0, tape: 'new' }))
    tone.process(x.subarray(0.15 * fs), L.subarray(0.15 * fs), R.subarray(0.15 * fs), n - 0.15 * fs)
    // Count zero crossings over 50 ms of the repeat.
    const start = firstAbove(L, 0.02, Math.round(0.19 * fs)) + Math.round(0.01 * fs)
    let crossings = 0
    for (let i = start + 1; i < start + 0.05 * fs; i++) if (L[i - 1] < 0 !== L[i] < 0) crossings++
    const hz = crossings / 2 / 0.05
    expect(hz).toBeLessThan(990)
    expect(hz).toBeGreaterThan(850)
  })
  it('self-oscillates past the knob centre with one head and stays bounded at full intensity', () => {
    const quiet = (intensity: number) => {
      const { left } = render(params({ speed: 0.6, heads: [true, false, false], intensity }), 6)
      let sum = 0
      for (let i = left.length - 48000; i < left.length; i++) sum += left[i] * left[i]
      return Math.sqrt(sum / 48000)
    }
    expect(quiet(0.45)).toBeLessThan(0.005)
    expect(quiet(0.7)).toBeGreaterThan(0.05)
    const { left } = render(params({ heads: [true, true, true], intensity: 1, bass: 1, treble: 1, input: 1 }), 4, (i) => (i % 9000 === 0 ? 1 : 0))
    let peak = 0
    for (const v of left) { expect(Number.isFinite(v)).toBe(true); peak = Math.max(peak, Math.abs(v)) }
    expect(peak).toBeLessThan(2.5)
  })
  it('lets the tails fade after ECHO OFF, then sleeps', () => {
    const fs = 48000
    const echo = new TapeEcho(fs)
    echo.set(params({ intensity: 0.9, heads: [true, true, true] }))
    const n = fs
    const imp = new Float32Array(n); imp[0] = 0.5
    echo.process(imp, new Float32Array(n), new Float32Array(n), n)
    echo.set(params({ on: false, intensity: 0.9, heads: [true, true, true] }))
    let slept = -1
    for (let s = 0; s < 30 && slept < 0; s++) {
      echo.process(new Float32Array(n), new Float32Array(n), new Float32Array(n), n)
      if (echo.idle) slept = s
    }
    expect(slept).toBeGreaterThanOrEqual(0)
    const out = new Float32Array(128)
    echo.process(new Float32Array(128).fill(1), out, new Float32Array(128), 128)
    expect(out.every((v) => v === 0)).toBe(true)
  })
  it('is deterministic', () => {
    const a = render(params({ spring: true, intensity: 0.5 }), 0.5).left
    const b = render(params({ spring: true, intensity: 0.5 }), 0.5).left
    expect(a).toEqual(b)
  })
  it('spring reverb is silent until switched in, then rings for seconds', () => {
    const dry = render(params({ heads: [false, false, false], spring: false }), 1).left
    expect(dry.every((v) => Math.abs(v) < 1e-3)).toBe(true)
    const wet = render(params({ heads: [false, false, false], spring: true, reverb: 1 }), 2.5).left
    let late = 0
    for (let i = 48000; i < 1.5 * 48000; i++) late = Math.max(late, Math.abs(wet[i]))
    expect(late).toBeGreaterThan(1e-4)
  })
  it('estimates the tail for export', () => {
    expect(echoTailSec({ ...defaultEcho(), heads: [false, false, false], spring: false }, 120)).toBe(0)
    expect(echoTailSec({ ...defaultEcho(), intensity: 1 }, 120)).toBe(12)
    const t = echoTailSec({ ...defaultEcho(), rate: 1, intensity: 0.35 }, 120)
    expect(t).toBeGreaterThan(0.3)
    expect(t).toBeLessThan(1)
  })
})

describe('echo reference for the plugin', () => {
  it('echo-reference.json matches the DSP (npx tsx plugin/scripts/echo-reference.ts to refresh)', async () => {
    const { reference } = await import('../plugin/scripts/echo-reference')
    const file = JSON.parse(readFileSync('plugin/source/tests/data/echo-reference.json', 'utf8'))
    expect(file).toEqual(JSON.parse(JSON.stringify(reference())))
  })
})
