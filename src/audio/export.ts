import type { KitManifest } from '../contract/types'
import type { PatternState } from '../state/pattern'
import { hitGainDb, hitPitchCents } from '../state/pattern'
import { chosenSample } from './transport'
import { swungStepSec } from './scheduler'
import { CHOKE_FADE_SEC, MASTER_GAIN_DB, dbToGain } from './engine'
import { hitPlaybackDb } from './loudness'
import { pitchRate } from './pitch'

/** Output sample rate of the rendered WAV; the existing export format. */
const EXPORT_RATE = 44100
/** One render quantum of slack so a pitched tail is not cut at the allocation boundary. */
const PITCH_GUARD_FRAMES = 128

/** App export uses General MIDI percussion on channel 10. Unmapped percussion uses note 75. */
export const GM_NOTES: Record<string, number> = {
  kick: 36, snare: 38, 'hat-closed': 42, 'hat-open': 46, 'tom-low': 45, 'tom-mid': 47, 'tom-high': 50,
  tom: 47, crash: 49, ride: 51, clap: 39, rim: 37, agogo: 67, bongo: 60, cabasa: 69,
  clave: 75, conga: 64, cowbell: 56, tambourine: 54, shaker: 70,
}

export function stepTimes(p: Pick<PatternState, 'bpm' | 'length' | 'swing' | 'swingGrid'>) {
  let time = 0
  const times = Array.from({ length: p.length }, (_, step) => {
    const at = time
    time += swungStepSec(p.bpm, step, p.swing, p.swingGrid)
    return at
  })
  return { times, duration: time }
}

const be32 = (n: number) => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255]
const vlq = (n: number) => {
  const bytes = [n & 127]
  while ((n >>>= 7) > 0) bytes.unshift((n & 127) | 128)
  return bytes
}

export function midiBytes(p: PatternState, kit: KitManifest): Uint8Array<ArrayBuffer> {
  const { times } = stepTimes(p)
  const tempo = Math.round(60_000_000 / p.bpm)
  const events: { tick: number; bytes: number[] }[] = [
    { tick: 0, bytes: [255, 81, 3, ...be32(tempo).slice(1)] },
    { tick: 0, bytes: [255, 88, 4, 4, 2, 24, 8] },
  ]
  for (const slot of kit.slots) {
    const track = p.tracks[slot.id]
    if (!track || !chosenSample(kit, slot, p)) continue
    times.forEach((time, step) => {
      if (!track.steps[step]) return
      const gain = hitGainDb(track, step)
      if (gain === -Infinity) return
      const velocity = Math.max(1, Math.min(127, Math.round(100 * dbToGain(gain))))
      const tick = Math.round(time * p.bpm / 60 * 480)
      const note = GM_NOTES[slot.id] ?? GM_NOTES[slot.category] ?? 75
      events.push({ tick, bytes: [0x99, note, velocity] }, { tick: tick + 30, bytes: [0x89, note, 0] })
    })
  }
  events.sort((a, b) => a.tick - b.tick)
  const data: number[] = []
  let last = 0
  for (const e of events) { data.push(...vlq(e.tick - last), ...e.bytes); last = e.tick }
  const end = p.length * 120
  data.push(...vlq(Math.max(0, end - last)), 255, 47, 0)
  return new Uint8Array([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224, 77, 84, 114, 107, ...be32(data.length), ...data])
}

export function wavBytes(buffer: Pick<AudioBuffer, 'numberOfChannels' | 'length' | 'sampleRate' | 'getChannelData'>): Uint8Array<ArrayBuffer> {
  const channels = buffer.numberOfChannels
  const size = buffer.length * channels * 2
  const bytes = new Uint8Array(44 + size)
  const view = new DataView(bytes.buffer)
  const tag = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  tag(0, 'RIFF'); view.setUint32(4, 36 + size, true); tag(8, 'WAVE'); tag(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true)
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true)
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); tag(36, 'data'); view.setUint32(40, size, true)
  const planes = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i))
  for (let frame = 0; frame < buffer.length; frame++) for (let c = 0; c < channels; c++) {
    const v = Math.max(-1, Math.min(1, planes[c][frame]))
    view.setInt16(44 + (frame * channels + c) * 2, Math.round(v * (v < 0 ? 32768 : 32767)), true)
  }
  return bytes
}

/** Render one loop plus its decay tail, using the same samples, gain and hat choke as playback. */
export async function renderWav(p: PatternState, kit: KitManifest, getBuffer: (hash: string) => AudioBuffer | undefined) {
  const { times, duration } = stepTimes(p)
  const sounds = kit.slots.map((slot) => {
    const sample = chosenSample(kit, slot, p)
    const buffer = sample && getBuffer(sample.blobSha256)
    if (sample && !buffer) throw new Error(`${slot.label} is not ready for export.`)
    return { slot, sample, buffer }
  })
  const tail = Math.max(.1, ...sounds.map((s) => s.buffer?.duration ?? 0))
  // Neutral length stays exactly as before; a slowed tail may extend past it. Muted hits add nothing.
  let latestEnd = 0
  times.forEach((when, step) => {
    for (const { slot, sample, buffer } of sounds) {
      const track = p.tracks[slot.id]
      if (!track?.steps[step] || !sample || !buffer || hitGainDb(track, step) === -Infinity) continue
      latestEnd = Math.max(latestEnd, when + buffer.duration / pitchRate(hitPitchCents(p, track, step)))
    }
  })
  const seconds = Math.max(duration + tail, latestEnd + PITCH_GUARD_FRAMES / EXPORT_RATE)
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * EXPORT_RATE), EXPORT_RATE)
  const hats: { gain: GainNode; source: AudioBufferSourceNode; when: number; level: number; ended: boolean }[] = []
  times.forEach((when, step) => {
    // A closed hat chokes open hats that started before it; same-step hats layer.
    for (const { slot, sample, buffer } of sounds) {
      const track = p.tracks[slot.id]
      if (!track?.steps[step] || !sample || !buffer) continue
      const extra = hitGainDb(track, step)
      if (extra === -Infinity) continue
      if (slot.id === 'hat-closed') for (const hat of hats) if (!hat.ended && hat.when < when) {
        hat.gain.gain.setValueAtTime(hat.level, when)
        hat.gain.gain.linearRampToValueAtTime(0, when + CHOKE_FADE_SEC)
        hat.source.stop(when + CHOKE_FADE_SEC + .001)
        hat.ended = true
      }
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.playbackRate.value = pitchRate(hitPitchCents(p, track, step))
      const gain = ctx.createGain()
      const level = dbToGain(hitPlaybackDb(buffer, extra) + MASTER_GAIN_DB)
      gain.gain.value = level
      source.connect(gain)
      gain.connect(ctx.destination)
      source.start(when)
      if (slot.id === 'hat-open') hats.push({ source, gain, level, when, ended: false })
    }
  })
  return wavBytes(await ctx.startRendering())
}

export function download(bytes: Uint8Array<ArrayBuffer>, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name.replace(/[/\\:*?"<>|]/g, '_')
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
