import { describe, expect, it } from 'vitest'
import { MAX_BOOST_DB, PEAK_CEILING_DB, TARGET_LUFS, measureHit, normalisationDb, normalisedGainDb, type ChannelSource } from '../src/audio/loudness'

const RATE = 48000
function buffer(channels: Float32Array[], sampleRate = RATE): ChannelSource {
  return { numberOfChannels: channels.length, sampleRate, length: channels[0].length, getChannelData: (c) => channels[c] }
}
const sine = (amp: number, sec: number, hz = 997, rate = RATE) =>
  Float32Array.from({ length: Math.round(sec * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate))

describe('measureHit', () => {
  it('reads a 997 Hz sine at BS.1770 reference loudness', () => {
    // A 0 dBFS 997 Hz sine on both channels is 0 LUFS; at amplitude 0.1 it is -20 LUFS.
    const s = sine(0.1, 1)
    const level = measureHit(buffer([s, s]))
    expect(level.lufs).toBeCloseTo(-20, 1)
    expect(level.peakDb).toBeCloseTo(-20, 1)
  })

  it('counts a mono buffer on both output channels', () => {
    const s = sine(0.1, 1)
    expect(measureHit(buffer([s])).lufs).toBeCloseTo(measureHit(buffer([s, s])).lufs, 6)
  })

  it('measures the same at 44.1 kHz and 48 kHz', () => {
    const a = measureHit(buffer([sine(0.1, 1, 997, 44100)], 44100)).lufs
    const b = measureHit(buffer([sine(0.1, 1)])).lufs
    expect(a).toBeCloseTo(b, 1)
  })

  it('treats hits shorter than the 400 ms window as zero-padded', () => {
    const long = measureHit(buffer([sine(0.1, 0.4)])).lufs
    const short = measureHit(buffer([sine(0.1, 0.1)])).lufs
    expect(long - short).toBeCloseTo(10 * Math.log10(4), 1)
  })

  it('returns -Infinity for silence', () => {
    expect(measureHit(buffer([new Float32Array(4800)])).lufs).toBe(-Infinity)
  })
})

describe('normalisationDb', () => {
  it('brings a hit to the target loudness', () => {
    expect(normalisationDb({ lufs: -30, peakDb: -15 })).toBeCloseTo(TARGET_LUFS + 30)
    expect(normalisationDb({ lufs: -8, peakDb: 0 })).toBeCloseTo(TARGET_LUFS + 8)
  })

  it('stops at the peak ceiling', () => {
    expect(normalisationDb({ lufs: -40, peakDb: -6 })).toBeCloseTo(PEAK_CEILING_DB + 6)
  })

  it('limits the boost and leaves silence alone', () => {
    expect(normalisationDb({ lufs: -90, peakDb: -80 })).toBe(MAX_BOOST_DB)
    expect(normalisationDb({ lufs: -Infinity, peakDb: -Infinity })).toBe(0)
  })

  it('caches per buffer and gives 0 dB to buffers without sample data', () => {
    const b = buffer([sine(0.01, 0.5)])
    const first = normalisedGainDb(b)
    expect(first).toBeCloseTo(TARGET_LUFS + 40, 1)
    b.getChannelData = () => { throw new Error('measured twice') }
    expect(normalisedGainDb(b)).toBe(first)
    expect(normalisedGainDb({ numberOfChannels: 1, sampleRate: RATE, length: 10 } as unknown as AudioBuffer)).toBe(0)
  })
})
