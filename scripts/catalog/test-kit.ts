// Synthesised test kits for the fixture build, so tests and a fresh checkout
// have sounds without any sample library. Deterministic: the same code gives
// the same bytes. Audio is written to fixtures/test/audio/ (git-ignored).
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Machine, Slot } from '../../src/contract/types.ts'

export interface SourceSample { suffix: string; source: string; label?: string }
export type SourceSlot = Pick<Slot, 'id' | 'label' | 'category' | 'icon' | 'chokeGroup' | 'gainDb'> & { samples: SourceSample[] }
export interface SourceRecord {
  machine: Machine
  kit: { id: string; machineId: string; label: string }
  slots: SourceSlot[]
}

const RATE = 44100
const DIR = 'fixtures/test/audio'

/** 16-bit mono PCM WAV. */
function wav(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2)
  const v = new DataView(out.buffer)
  const ascii = (at: number, s: string) => { for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i) }
  ascii(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); ascii(8, 'WAVE')
  ascii(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  ascii(36, 'data'); v.setUint32(40, samples.length * 2, true)
  samples.forEach((x, i) => v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, x)) * 32767), true))
  return out
}

/** Linear congruential noise, seeded, so output never changes between runs. */
function noise(seed: number) {
  let s = seed >>> 0
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 31) - 1
}

function render(seconds: number, f: (t: number) => number): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE))
  for (let i = 0; i < out.length; i++) out[i] = f(i / RATE)
  return out
}

const kick = (start: number, end: number) => {
  let phase = 0
  return render(0.4, (t) => {
    phase += (2 * Math.PI * (end + (start - end) * Math.exp(-t * 30))) / RATE
    return 0.9 * Math.sin(phase) * Math.exp(-t * 9)
  })
}
const snare = (tone: number, seed: number) => {
  const n = noise(seed)
  return render(0.25, (t) => 0.4 * Math.sin(2 * Math.PI * tone * t) * Math.exp(-t * 25) + 0.5 * n() * Math.exp(-t * 18))
}
const metal = (seconds: number, decay: number, seed: number) => {
  const n = noise(seed)
  let last = 0
  // First difference of noise: a crude high-pass, enough for a hat or cymbal.
  return render(seconds, (t) => { const x = n(); const y = x - last; last = x; return 0.35 * y * Math.exp(-t * decay) })
}

const SOUNDS: Record<string, () => Float32Array> = {
  'kick-low': () => kick(150, 45),
  'kick-high': () => kick(220, 60),
  'snare-1': () => snare(190, 1),
  'snare-2': () => snare(230, 2),
  'snare-3': () => snare(170, 3),
  'hat-closed': () => metal(0.08, 60, 4),
  'hat-open': () => metal(0.5, 7, 5),
  crash: () => metal(1.2, 3, 6),
}

const slot = (id: string, label: string, category: Slot['category'], icon: Slot['icon'], names: string[], chokeGroup: string | null = null): SourceSlot => ({
  id, label, category, icon, chokeGroup, gainDb: -2,
  samples: names.map((n) => ({ suffix: n, source: path.join(DIR, `${n}.wav`) })),
})

const machine: Machine = {
  id: 'test-tones', manufacturer: 'V.D.V.M', model: 'Test Tones', displayName: 'Test Tones', aliases: [],
  kind: 'drum-machine', identityStatus: 'verified', logo: null, photo: null, history: null,
}

/** Three kits on one machine: A has all five slots with variants; B and C are smaller. */
export const TEST_KITS: SourceRecord[] = [
  { machine, kit: { id: 'test-tones-a', machineId: machine.id, label: 'Tones A' }, slots: [
    slot('kick', 'Kick', 'kick', 'kick', ['kick-low', 'kick-high']),
    slot('snare', 'Snare', 'snare', 'snare', ['snare-1', 'snare-2', 'snare-3']),
    slot('hat-closed', 'Closed hat', 'hat', 'hat-closed', ['hat-closed'], 'hi-hat'),
    slot('hat-open', 'Open hat', 'hat', 'hat-open', ['hat-open'], 'hi-hat'),
    slot('crash', 'Crash', 'cymbal', 'cymbal', ['crash']),
  ] },
  { machine, kit: { id: 'test-tones-b', machineId: machine.id, label: 'Tones B' }, slots: [
    slot('kick', 'Kick', 'kick', 'kick', ['kick-high']),
    slot('snare', 'Snare', 'snare', 'snare', ['snare-2']),
    slot('hat-closed', 'Closed hat', 'hat', 'hat-closed', ['hat-closed'], 'hi-hat'),
    slot('hat-open', 'Open hat', 'hat', 'hat-open', ['hat-open'], 'hi-hat'),
  ] },
  { machine, kit: { id: 'test-tones-c', machineId: machine.id, label: 'Tones C' }, slots: [
    slot('kick', 'Kick', 'kick', 'kick', ['kick-low']),
    slot('snare', 'Snare', 'snare', 'snare', ['snare-3']),
    slot('hat-closed', 'Closed hat', 'hat', 'hat-closed', ['hat-closed'], 'hi-hat'),
    slot('hat-open', 'Open hat', 'hat', 'hat-open', ['hat-open'], 'hi-hat'),
  ] },
]

export async function writeTestAudio(): Promise<void> {
  await mkdir(DIR, { recursive: true })
  for (const [name, make] of Object.entries(SOUNDS)) await writeFile(path.join(DIR, `${name}.wav`), wav(make()))
}
