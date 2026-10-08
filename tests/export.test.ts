import { describe, expect, it, vi } from 'vitest'
import { midiBytes, renderWav, stepTimes, wavBytes } from '../src/audio/export'
import { fromPattern } from '../src/state/pattern'
import { pitchRate } from '../src/audio/pitch'
import type { KitManifest } from '../src/contract/types'

const kit = {
  id: 'kit', slots: ['kick', 'hat-open', 'hat-closed'].map((id) => ({ id, category: id === 'kick' ? 'kick' : 'hat', label: id, sampleIds: [id], defaultSampleId: id, gainDb: -2 })),
  samples: ['kick', 'hat-open', 'hat-closed'].map((id) => ({ id, blobSha256: id, gainDb: -1 })),
} as unknown as KitManifest
const pattern = () => fromPattern({
  schemaVersion: 1, id: 'p', name: 'TEST', kitId: 'kit', kitRevision: '0123456789abcdef', bpm: 120, swing: 75,
  tracks: kit.slots.map((s) => ({ slotId: s.id, sampleId: s.id, steps: Array.from({ length: 16 }, (_, i) => i < 2) as never })),
  updatedAt: '2026-09-30T00:00:00Z',
}, false)

function readMidi(bytes: Uint8Array) {
  let pos = 22
  let tick = 0
  const events: { tick: number; status: number; data: number[] }[] = []
  const variable = () => {
    let value = 0
    let byte: number
    do { byte = bytes[pos++]; value = value * 128 + (byte & 127) } while (byte & 128)
    return value
  }
  while (pos < bytes.length) {
    tick += variable()
    const status = bytes[pos++]
    if (status === 255) {
      const type = bytes[pos++]
      const size = variable()
      events.push({ tick, status: type, data: [...bytes.slice(pos, pos + size)] })
      pos += size
    } else {
      events.push({ tick, status, data: [...bytes.slice(pos, pos + 2)] })
      pos += 2
    }
  }
  return events
}

describe('desktop exports', () => {
  it('writes a standard MIDI header, tempo, swung hits and note-offs through the full loop', () => {
    const p = pattern()
    p.tracks.kick.levels[1] = .5
    p.tracks['hat-open'].gainDb = -Infinity
    const bytes = midiBytes(p, kit)
    expect([...bytes.slice(0, 14)]).toEqual([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224])
    expect(new DataView(bytes.buffer).getUint32(18)).toBe(bytes.length - 22)
    const events = readMidi(bytes)
    expect(events.find((e) => e.status === 81)?.data).toEqual([7, 161, 32]) // 500,000 µs per quarter
    const kicks = events.filter((e) => e.status === 0x99 && e.data[0] === 36)
    expect(kicks.map((e) => [e.tick, e.data[1]])).toEqual([[0, 100], [180, 25]])
    expect(events.filter((e) => e.status === 0x99 && e.data[0] === 46)).toHaveLength(0)
    expect(events.filter((e) => e.status === 0x89)).toHaveLength(4)
    expect(events.at(-1)).toEqual({ tick: 1920, status: 47, data: [] })
    p.length = 8
    expect(readMidi(midiBytes(p, kit)).at(-1)?.tick).toBe(960)
  })
  it('chokes a later hat at the same time regardless of pitch', async () => {
    const sources: FakeSource[] = []
    vi.stubGlobal('OfflineAudioContext', offline(sources))
    try {
      const p = pattern()
      p.tracks['hat-open'].stepPitchCents[0] = -1200
      p.tracks['hat-closed'].stepPitchCents[1] = 1200
      await renderWav(p, kit, () => ({ duration: .5 }) as AudioBuffer)
      expect(sources[1].stopped).toBeCloseTo(.1935)
      expect(sources[1].playbackRate.value).toBeCloseTo(pitchRate(-1200))
    } finally { vi.unstubAllGlobals() }
  })
  it('leaves MIDI bytes unchanged when only pitch differs', () => {
    const a = pattern()
    const b = pattern()
    b.pitchCents = 500
    b.tracks.kick.stepPitchCents[0] = -300
    expect([...midiBytes(b, kit)]).toEqual([...midiBytes(a, kit)])
  })
  it('keeps swing export timing on the same bar duration on either grid', () => {
    const p = pattern()
    expect(stepTimes(p).times.slice(0, 5)).toEqual([0, .1875, .25, .4375, .5])
    p.swingGrid = 8
    expect(stepTimes(p).times.slice(0, 5)).toEqual([0, .1875, .375, .4375, .5])
    expect(stepTimes(p).duration).toBe(2)
    p.length = 8
    expect(stepTimes(p).duration).toBe(1)
  })
  it('encodes interleaved stereo 16-bit WAV data, with saturation at PCM limits', () => {
    const bytes = wavBytes({ length: 3, sampleRate: 44100, numberOfChannels: 2, getChannelData: (c) => new Float32Array(c === 0 ? [-2, 0, 2] : [.5, -.5, 0]) })
    const view = new DataView(bytes.buffer)
    const text = (a: number, b: number) => new TextDecoder().decode(bytes.slice(a, b))
    expect(text(0, 4)).toBe('RIFF')
    expect(text(8, 12)).toBe('WAVE')
    expect(text(36, 40)).toBe('data')
    expect(view.getUint32(24, true)).toBe(44100)
    expect(view.getUint16(22, true)).toBe(2)
    expect(view.getUint32(40, true)).toBe(12)
    expect(Array.from({ length: 6 }, (_, i) => view.getInt16(44 + i * 2, true))).toEqual([-32768, 16384, 0, -16384, 32767, 0])
  })
  interface FakeSource { at: number; stopped: number | null; gain: number; ramps: number[]; playbackRate: { value: number } }
  const offline = (sources: FakeSource[], onAllocate?: (frames: number) => void) => {
    class Offline {
      destination = {}
      constructor(_channels: number, length: number) { onAllocate?.(length) }
      createBufferSource() {
        const node = { at: -1, stopped: null as number | null, gain: 0, ramps: [] as number[], buffer: null, playbackRate: { value: 1 }, start: (at: number) => { node.at = at }, stop: (at: number) => { node.stopped = at }, connect: (gain: { gain: { value: number }; ramps: number[] }) => { node.gain = gain.gain.value; node.ramps = gain.ramps } }
        sources.push(node)
        return node
      }
      createGain() {
        const ramps: number[] = []
        return { ramps, gain: { value: 0, setValueAtTime: () => {}, linearRampToValueAtTime: (_v: number, at: number) => ramps.push(at) }, connect: () => {} }
      }
      startRendering() { return Promise.resolve({ length: 1, sampleRate: 44100, numberOfChannels: 2, getChannelData: () => new Float32Array(1) }) }
    }
    return Offline
  }

  it('schedules offline export with swing, mixed gains and hat choke at the hit time', async () => {
    const sources: FakeSource[] = []
    vi.stubGlobal('OfflineAudioContext', offline(sources))
    try {
      await renderWav(pattern(), kit, () => ({ duration: .5 }) as AudioBuffer)
      expect(sources.map((s) => s.at)).toEqual([0, 0, 0, .1875, .1875, .1875])
      // Catalog sample/slot gains are not applied; a buffer without sample data normalises to 0 dB, so kick = master -12 dB.
      expect(sources[0].gain).toBeCloseTo(10 ** (-12 / 20))
      expect(sources.every((s) => s.playbackRate.value === 1)).toBe(true)
      // Same-step open and closed hats layer: the step-0 open hat is only reached by the step-1 closer.
      expect(sources[1].stopped).toBeCloseTo(.1935)
      expect(sources[1].ramps).toEqual([.1925])
      expect(sources[4].stopped).toBeNull()
      await expect(renderWav(pattern(), kit, () => undefined)).rejects.toThrow('not ready')
    } finally { vi.unstubAllGlobals() }
  })

  it('pitches each exported voice by overall plus its step offset, without mutating the pattern', async () => {
    const sources: FakeSource[] = []
    vi.stubGlobal('OfflineAudioContext', offline(sources))
    try {
      const p = pattern()
      p.pitchCents = 700
      p.tracks.kick.stepPitchCents[0] = 500
      p.tracks.kick.stepPitchCents[1] = -1200
      const before = JSON.stringify(p)
      await renderWav(p, kit, () => ({ duration: .5 }) as AudioBuffer)
      expect(sources[0].playbackRate.value).toBeCloseTo(pitchRate(1200))
      expect(sources[3].playbackRate.value).toBeCloseTo(pitchRate(-500))
      expect(sources[1].playbackRate.value).toBeCloseTo(pitchRate(700))
      expect(JSON.stringify(p)).toBe(before)
    } finally { vi.unstubAllGlobals() }
  })

  it('extends the render for a slow pitched-down tail but not for a muted one', async () => {
    let frames = 0
    const sources: FakeSource[] = []
    vi.stubGlobal('OfflineAudioContext', offline(sources, (n) => { frames = n }))
    try {
      const slow = pattern()
      slow.length = 8
      slow.tracks.kick.stepPitchCents[1] = -1200
      await renderWav(slow, kit, () => ({ duration: 3 }) as AudioBuffer)
      // 8-step bar lasts 1 s; a 3 s sample at rate 0.5 on the last-enabled step needs well past that.
      expect(frames / 44100).toBeGreaterThan(1 + 3)

      const muted = pattern()
      muted.length = 8
      muted.tracks.kick.stepPitchCents[1] = -1200
      muted.tracks.kick.levels[1] = 0
      frames = 0
      await renderWav(muted, kit, () => ({ duration: 3 }) as AudioBuffer)
      expect(frames / 44100).toBeCloseTo(1 + 3, 2)
    } finally { vi.unstubAllGlobals() }
  })
})
