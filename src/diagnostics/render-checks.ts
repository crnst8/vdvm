// Offline audio render checks: onset placement,
// hat choke, no post-stop hits, and peak headroom for real fixture kits.
// Runs the production AudioEngine against an OfflineAudioContext.
import { AudioEngine, type AudioContextLike } from '../audio/engine'
import { sixteenthSec } from '../audio/scheduler'
import { hitPlaybackDb } from '../audio/loudness'
import { pitchRate } from '../audio/pitch'
import { Catalog } from '../data/catalog'
import type { KitManifest } from '../contract/types'

const RATE = 48000
const QUANTUM = 128

interface Result { name: string; pass: boolean; detail: string }

const offline = (seconds: number) => new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(seconds * RATE), sampleRate: RATE })
const asLike = (c: OfflineAudioContext) => c as unknown as AudioContextLike

function impulse(ctx: BaseAudioContext, length = 64, value = 1) {
  const b = ctx.createBuffer(1, length, RATE)
  b.getChannelData(0)[0] = value
  return b
}
function dc(ctx: BaseAudioContext, seconds: number, value = 0.5) {
  const b = ctx.createBuffer(1, Math.ceil(seconds * RATE), RATE)
  b.getChannelData(0).fill(value)
  return b
}
const onsets = (data: Float32Array, threshold = 1e-4) => {
  const out: number[] = []
  let quiet = true
  for (let i = 0; i < data.length; i++) {
    const loud = Math.abs(data[i]) > threshold
    if (loud && quiet) out.push(i)
    quiet = !loud
  }
  return out
}
const peakDb = (buf: AudioBuffer) => {
  let p = 0
  for (let c = 0; c < buf.numberOfChannels; c++) for (const v of buf.getChannelData(c)) p = Math.max(p, Math.abs(v))
  return p === 0 ? -Infinity : 20 * Math.log10(p)
}

async function onsetCheck(): Promise<Result> {
  const ctx = offline(2.2)
  const engine = new AudioEngine(asLike(ctx))
  const dt = sixteenthSec(120)
  const expected: number[] = []
  for (let i = 0; i < 16; i++) {
    const when = 0.05 + i * dt
    expected.push(Math.round(when * RATE))
    engine.trigger(impulse(ctx), when, { gainDb: 0, slotId: 'kick', kitId: 'diag', generation: 1 })
  }
  const out = await ctx.startRendering()
  const got = onsets(out.getChannelData(0))
  const errs = expected.map((e, i) => Math.abs((got[i] ?? Infinity) - e))
  const worst = Math.max(...errs)
  return { name: 'onsets within one render quantum', pass: got.length === 16 && worst <= QUANTUM, detail: `${got.length}/16 onsets, worst error ${worst} frames (limit ${QUANTUM})` }
}

async function chokeCheck(): Promise<Result> {
  const ctx = offline(1)
  const engine = new AudioEngine(asLike(ctx))
  engine.trigger(dc(ctx, 0.8, 0.5), 0.1, { gainDb: 0, slotId: 'hat-open', kitId: 'd', generation: 1 })
  // Closed hat queued well ahead; choke must start at its onset (0.5 s), not at scheduling time.
  engine.trigger(impulse(ctx, 1, 0), 0.5, { gainDb: 0, slotId: 'hat-closed', kitId: 'd', generation: 1 })
  const out = (await ctx.startRendering()).getChannelData(0)
  const at = (t: number) => Math.abs(out[Math.round(t * RATE)])
  const pass = at(0.3) > 0.01 && at(0.49) > 0.01 && at(0.52) < 1e-6
  return { name: 'closed hat chokes open hat at its onset', pass, detail: `open-hat level 0.30s=${at(0.3).toFixed(4)} 0.49s=${at(0.49).toFixed(4)} 0.52s=${at(0.52).toExponential(1)}` }
}

async function stopCheck(): Promise<Result> {
  const ctx = offline(1.2)
  const engine = new AudioEngine(asLike(ctx))
  for (let i = 0; i < 8; i++) engine.trigger(impulse(ctx), 0.1 + i * 0.125, { gainDb: 0, slotId: 'kick', kitId: 'd', generation: 1 })
  const stopAt = 0.4
  void ctx.suspend(stopAt).then(() => {
    engine.stopAll()
    void ctx.resume()
  })
  const out = (await ctx.startRendering()).getChannelData(0)
  const after = onsets(out).filter((i) => i > (stopAt + 0.006) * RATE)
  return { name: 'no queued hits sound after stop', pass: after.length === 0, detail: `${onsets(out).length} onsets before stop, ${after.length} after` }
}

async function headroomCheck(catalog: Catalog, kit: KitManifest): Promise<Result> {
  // Worst case: every slot on every step at 240 BPM for one bar.
  const dt = sixteenthSec(240)
  const seconds = 16 * dt + 2
  const ctx = offline(seconds)
  const engine = new AudioEngine(asLike(ctx))
  const buffers = new Map<string, AudioBuffer>()
  for (const s of kit.samples) {
    const data = await (await fetch(catalog.url(s.url))).arrayBuffer()
    buffers.set(s.id, await ctx.decodeAudioData(data))
  }
  for (let step = 0; step < 16; step++) {
    for (const slot of kit.slots) {
      const s = kit.samples.find((x) => x.id === slot.defaultSampleId)!
      engine.trigger(buffers.get(s.id)!, 0.01 + step * dt, { gainDb: hitPlaybackDb(buffers.get(s.id)!, 0), slotId: slot.id, kitId: kit.id, generation: 1 })
    }
  }
  const peak = peakDb(await ctx.startRendering())
  return { name: `peak headroom ${kit.label} (all slots, every step, 240 BPM)`, pass: peak <= -1, detail: `peak ${peak.toFixed(2)} dBFS (limit -1.00)` }
}

function tone(ctx: BaseAudioContext, freq: number, seconds: number, value = 0.5) {
  const b = ctx.createBuffer(1, Math.ceil(seconds * RATE), RATE)
  const d = b.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = value * Math.sin((2 * Math.PI * freq * i) / RATE)
  return b
}
function stereo(ctx: BaseAudioContext, left: number, right: number, seconds: number) {
  const b = ctx.createBuffer(2, Math.ceil(seconds * RATE), RATE)
  for (let i = 0; i < b.length; i++) {
    b.getChannelData(0)[i] = 0.5 * Math.sin((2 * Math.PI * left * i) / RATE)
    b.getChannelData(1)[i] = 0.5 * Math.sin((2 * Math.PI * right * i) / RATE)
  }
  return b
}
/** Frequency from zero crossings in a window that excludes fades and endpoints. */
function zeroCrossFreq(data: Float32Array, from: number, to: number) {
  let crossings = 0
  for (let i = from + 1; i < to; i++) if (data[i - 1] <= 0 !== data[i] <= 0) crossings++
  return crossings / 2 / ((to - from) / RATE)
}
const pitchOpts = (pitchCents?: number) => ({ gainDb: 0, slotId: 'kick', kitId: 'diag', generation: 1, ...(pitchCents === undefined ? {} : { pitchCents }) })

/** Neutral pitch must be bit-identical to the original rate-1 path. */
async function neutralRegression(): Promise<Result> {
  const render = async (pitchCents?: number) => {
    const ctx = offline(0.2)
    const engine = new AudioEngine(asLike(ctx))
    engine.trigger(tone(ctx, 440, 0.1), 0.03, pitchOpts(pitchCents))
    return ctx.startRendering()
  }
  const a = (await render()).getChannelData(0)
  const b = (await render(0)).getChannelData(0)
  let diff = 0
  for (let i = 0; i < a.length; i++) diff = Math.max(diff, Math.abs(a[i] - b[i]))
  return { name: 'neutral pitch matches the rate-1 path', pass: diff <= 1e-6 && a.length === b.length, detail: `max |Δ| ${diff.toExponential(1)}` }
}

/** A 440 Hz tone plays an octave down/up at ±1200 and two octaves at ±2400. */
async function pitchFrequency(): Promise<Result> {
  const cases: [number, number][] = [[0, 440], [1200, 880], [-1200, 220], [2400, 1760], [-2400, 110]]
  const errors: string[] = []
  for (const [cents, expected] of cases) {
    const ctx = offline(0.4)
    const engine = new AudioEngine(asLike(ctx))
    const buffer = tone(ctx, 440, 0.3)
    engine.trigger(buffer, 0.01, pitchOpts(cents))
    const out = (await ctx.startRendering()).getChannelData(0)
    const played = 0.3 / pitchRate(cents)
    const from = Math.round((0.01 + played * 0.25) * RATE)
    const to = Math.round((0.01 + played * 0.75) * RATE)
    const got = zeroCrossFreq(out, from, to)
    const err = Math.abs(got - expected) / expected
    if (err > 0.01) errors.push(`${cents} cents: ${got.toFixed(1)} Hz (want ${expected})`)
  }
  return { name: 'pitched tone frequency tracks ±12 and ±24 semitones within 1%', pass: errors.length === 0, detail: errors.length ? errors.join('; ') : '440/880/220/1760/110 Hz' }
}

/** Rate 0.5 lasts about twice as long, rate 2 about half. */
async function pitchDuration(): Promise<Result> {
  const measure = async (rateCents: number) => {
    const ctx = offline(0.6)
    const engine = new AudioEngine(asLike(ctx))
    engine.trigger(tone(ctx, 440, 0.1), 0.02, pitchOpts(rateCents))
    const out = (await ctx.startRendering()).getChannelData(0)
    let last = 0
    for (let i = out.length - 1; i >= 0; i--) if (Math.abs(out[i]) > 1e-3) { last = i; break }
    return last / RATE - 0.02
  }
  const half = await measure(-1200)
  const double = await measure(1200)
  const pass = Math.abs(half - 0.2) < 0.005 && Math.abs(double - 0.05) < 0.005
  return { name: 'pitched duration halves/doubles with rate 0.5/2', pass, detail: `rate 0.5 ≈ ${half.toFixed(3)} s, rate 2 ≈ ${double.toFixed(3)} s (from 0.1 s)` }
}

/** Both channels get the same rate and stay in their own channel. */
async function pitchStereo(): Promise<Result> {
  const ctx = offline(0.4)
  const engine = new AudioEngine(asLike(ctx))
  engine.trigger(stereo(ctx, 440, 880, 0.3), 0.01, pitchOpts(1200))
  const out = await ctx.startRendering()
  const left = zeroCrossFreq(out.getChannelData(0), Math.round(0.04 * RATE), Math.round(0.09 * RATE))
  const right = zeroCrossFreq(out.getChannelData(1), Math.round(0.04 * RATE), Math.round(0.09 * RATE))
  const pass = Math.abs(left - 880) / 880 < 0.02 && Math.abs(right - 1760) / 1760 < 0.02
  return { name: 'stereo channels keep their own signal at one shared rate', pass, detail: `L ${left.toFixed(0)} Hz (want 880), R ${right.toFixed(0)} Hz (want 1760)` }
}

/** A pitched-down open hat is still faded at the unchanged later closed-hat onset. */
async function pitchChoke(): Promise<Result> {
  const ctx = offline(1)
  const engine = new AudioEngine(asLike(ctx))
  engine.trigger(dc(ctx, 0.8, 0.5), 0.1, { gainDb: 0, slotId: 'hat-open', kitId: 'd', generation: 1, pitchCents: -1200 })
  engine.trigger(impulse(ctx, 1, 0), 0.5, { gainDb: 0, slotId: 'hat-closed', kitId: 'd', generation: 1, pitchCents: 1200 })
  const out = (await ctx.startRendering()).getChannelData(0)
  const at = (t: number) => Math.abs(out[Math.round(t * RATE)])
  const pass = at(0.3) > 0.01 && at(0.49) > 0.01 && at(0.52) < 1e-6
  return { name: 'pitched hats choke at the unchanged onset', pass, detail: `open-hat level 0.30s=${at(0.3).toFixed(4)} 0.49s=${at(0.49).toFixed(4)} 0.52s=${at(0.52).toExponential(1)}` }
}

async function pitchChecks(): Promise<Result[]> {
  return [await neutralRegression(), await pitchFrequency(), await pitchDuration(), await pitchStereo(), await pitchChoke()]
}

/** Repeat one chord through every pitch tuning and report the peak growth. */
async function pitchHeadroomCheck(catalog: Catalog, kit: KitManifest): Promise<Result> {
  const buffers = new Map<string, AudioBuffer>()
  const decodeCtx = offline(0.1)
  for (const s of kit.samples) {
    const data = await (await fetch(catalog.url(s.url))).arrayBuffer()
    buffers.set(s.id, await decodeCtx.decodeAudioData(data))
  }
  const peaks = new Map<number, number>()
  for (const cents of [0, 500, -500, 1200, -1200, 2400, -2400]) {
    const ctx = offline(3)
    const engine = new AudioEngine(asLike(ctx))
    for (let i = 0; i < 10; i++) {
      for (const slot of kit.slots) {
        const s = kit.samples.find((x) => x.id === slot.defaultSampleId)!
        const buf = buffers.get(s.id)!
        engine.trigger(buf, 0.1 + i * 0.1, { gainDb: hitPlaybackDb(buf, 0), slotId: slot.id, kitId: 'diag', generation: 1, pitchCents: cents })
      }
    }
    peaks.set(cents, peakDb(await ctx.startRendering()))
  }
  const neutral = peaks.get(0)!
  const worst = Math.max(...[...peaks.entries()].filter(([c]) => c !== 0).map(([, p]) => p))
  const detail = [...peaks].map(([c, p]) => `${c > 0 ? '+' : ''}${c / 100}st ${p.toFixed(1)}`).join(', ')
  return { name: `pitch headroom ${kit.label} (chord every 100 ms)`, pass: worst <= neutral + 6, detail }
}

async function run() {
  const out = document.getElementById('out')!
  out.textContent = 'running…\n'
  const results: Result[] = []
  for (const f of [onsetCheck, chokeCheck, stopCheck]) results.push(await f())
  for (const r of await pitchChecks()) results.push(r)
  const catalog = await Catalog.load()
  for (const e of catalog.index.kits) results.push(await headroomCheck(catalog, await catalog.loadKit(e.id)))
  const first = catalog.index.kits[0]
  if (first) results.push(await pitchHeadroomCheck(catalog, await catalog.loadKit(first.id)))
  out.innerHTML = results.map((r) => `<span class="${r.pass ? 'pass' : 'fail'}">${r.pass ? 'PASS' : 'FAIL'}</span> ${r.name}: ${r.detail}`).join('\n')
  ;(window as unknown as { __renderChecks: Result[] }).__renderChecks = results
  return results
}

document.getElementById('run')!.addEventListener('click', () => void run())
;(window as unknown as { runRenderChecks: typeof run }).runRenderChecks = run
