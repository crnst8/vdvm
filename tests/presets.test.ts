import { describe, it, expect } from 'vitest'
import { PRESET_MACHINES, VOICE_ROLES, SHUFFLE_SWING, UNACCENTED_LEVEL, presetRhythm, presetTracks } from '../src/data/presets'
import { newPatternState, patternReducer, rhythmOf } from '../src/state/pattern'
import type { KitManifest } from '../src/contract/types'

const kit = (slots: string[]): KitManifest => ({
  schemaVersion: 1, id: 'k', machineId: 'm', label: 'k', revision: '0123456789abcdef',
  slots: slots.map((s) => ({
    id: s, label: s, category: 'percussion', icon: 'percussion', defaultSampleId: `k-${s}`,
    sampleIds: [`k-${s}`], chokeGroup: null, gainDb: 0,
  })) as unknown as KitManifest['slots'],
  samples: slots.map((s) => ({
    id: `k-${s}`, blobSha256: 'a'.repeat(64), url: 'x.wav', bytes: 1, durationSec: 1, channels: 1, sampleRate: 44100, gainDb: 0, peakDbfs: null,
  })) as unknown as KitManifest['samples'],
})

const presets = PRESET_MACHINES.flatMap((m) => m.presets)
const find = (id: string) => presets.find((p) => p.id === id)!

describe('preset rhythms', () => {
  it('have unique ids, sources and steps inside one 16-step bar', () => {
    expect(new Set(presets.map((p) => p.id)).size).toBe(presets.length)
    for (const m of PRESET_MACHINES) expect(m.source.url).toMatch(/^https:\/\//)
    for (const p of presets) {
      const lists = [...Object.values(p.voices), p.accents]
      for (const steps of lists) {
        expect(new Set(steps).size).toBe(steps!.length)
        for (const s of steps!) expect(Number.isInteger(s) && s >= 1 && s <= 16).toBe(true)
      }
      expect(Object.keys(p.voices).length).toBeGreaterThan(0)
    }
  })

  it('place shuffle hits only where eighth-note swing plays triplets', () => {
    for (const p of presets.filter((x) => x.feel === 'shuffle')) {
      for (const steps of Object.values(p.voices)) for (const s of steps!) expect(s % 2).toBe(1)
    }
  })

  it('map voices to the first role the kit has and accent per step', () => {
    const rock = find('cr78-rock-1-a')
    const t = presetTracks(rock, ['kick', 'snare', 'hat', 'clap'])
    expect(Object.keys(t).sort()).toEqual(['hat', 'kick', 'snare'])
    expect(t.kick.steps.flatMap((on, i) => (on ? [i + 1] : []))).toEqual([1, 7, 9])
    expect(t.kick.levels[0]).toBe(1)
    expect(t.kick.levels[6]).toBe(UNACCENTED_LEVEL)
    // Steps without a hit keep full level, so steps added later play normally.
    expect(t.kick.levels[1]).toBe(1)
    // Missing voices are left out rather than played on another instrument.
    expect(presetTracks(find('cr78-bossa-nova-a'), ['kick']).rim).toBeUndefined()
    expect(VOICE_ROLES.hatClosed[0]).toBe('hat-closed')
  })

  it('set swing for shuffles and straight time otherwise', () => {
    const slots = ['kick', 'snare', 'cymbal']
    expect(presetRhythm(find('cr78-shuffle-a'), slots, 16)).toMatchObject({ swing: SHUFFLE_SWING, swingGrid: 8, length: 16 })
    expect(presetRhythm(find('cr78-rock-1-a'), slots, 16)).toMatchObject({ swing: 50, swingGrid: 16, length: 16 })
  })

  it('replace every track in the pattern and restore from a snapshot', () => {
    const k = kit(['kick', 'snare', 'hat-closed', 'clap'])
    let s = newPatternState(k, 'p')
    s = patternReducer(s, { type: 'toggleStep', slotId: 'clap', step: 2, sampleId: 'k-clap' })
    s = patternReducer(s, { type: 'setLength', length: 8 })
    s = patternReducer(s, { type: 'setStepLevel', slotId: 'clap', step: 2, level: 0.5 })
    const before = rhythmOf(s)
    const applied = patternReducer(s, { type: 'setRhythm', rhythm: presetRhythm(find('cr78-shuffle-b'), k.slots.map((x) => x.id), s.swingGrid) })
    expect(applied.edits).toBe(s.edits + 1)
    expect(applied.tracks.clap.steps.every((on) => !on)).toBe(true)
    expect(applied.tracks.clap.levels[2]).toBe(0.5)
    expect(applied.tracks.snare.steps.flatMap((on, i) => (on ? [i + 1] : []))).toEqual([3, 7, 11, 15])
    expect(applied).toMatchObject({ swing: SHUFFLE_SWING, swingGrid: 8, length: 16 })
    const undone = patternReducer(applied, { type: 'setRhythm', rhythm: before })
    expect(rhythmOf(undone)).toEqual(before)
  })
})
