// Factory rhythms of original machines, transcribed by eye from the manufacturers' printed
// scores (source per machine below); not checked against recordings of the hardware.
// Only rhythms that fit one 16-step bar of 4/4 are listed. Left out: CR-78 Waltz (3/4) and Slow
// Rock (all three triplet eighths); CR-78 Samba, Mambo, Cha Cha, Beguine and Rhumba (overlapping
// note heads in the scan, not readable note for note); DR-110 D-5 (all three triplet eighths) and
// D-8 (3/4). Shuffle rhythms use only the first and last triplet eighth of each beat, which
// eighth-note swing at 67% plays exactly.
//
// Steps are 1-based (1 = beat one, 5 = beat two). Accents are per step, as on the hardware: one
// accent line for the whole machine.
import type { Rhythm } from '../state/pattern'

export type PresetVoice = 'kick' | 'snare' | 'hatClosed' | 'hatOpen' | 'cymbal' | 'rim' | 'maracas' | 'conga' | 'clap'

export interface RhythmPreset {
  id: string
  name: string
  voices: Partial<Record<PresetVoice, number[]>>
  accents: number[]
  feel: 'straight' | 'shuffle'
}

export interface PresetMachine {
  id: string
  name: string
  source: { title: string; url: string; pages: string }
  presets: RhythmPreset[]
}

/** Kit slot roles each voice plays on, in order of preference. */
export const VOICE_ROLES: Record<PresetVoice, string[]> = {
  kick: ['kick'],
  snare: ['snare'],
  hatClosed: ['hat-closed', 'hat'],
  hatOpen: ['hat-open'],
  cymbal: ['cymbal', 'ride', 'crash'],
  rim: ['rim', 'stick'],
  maracas: ['maracas', 'maraca', 'shaker', 'cabasa'],
  conga: ['conga'],
  clap: ['clap'],
}

/** Swing for shuffle rhythms: eighth-note pairs at 2:1, the triplet shuffle. */
export const SHUFFLE_SWING = 67
/** Level of an unaccented hit (amplitude is level squared, about -3.9 dB). */
export const UNACCENTED_LEVEL = 0.8

const odd = [1, 3, 5, 7, 9, 11, 13, 15]
const all = Array.from({ length: 16 }, (_, i) => i + 1)
const beats = [1, 5, 9, 13]

const cr78 = (id: string, name: string, voices: RhythmPreset['voices'], accents: number[], feel: RhythmPreset['feel'] = 'straight'): RhythmPreset =>
  ({ id: `cr78-${id}`, name, voices, accents, feel })
const dr110 = (id: string, voices: RhythmPreset['voices'], accents: number[], feel: RhythmPreset['feel'] = 'straight'): RhythmPreset =>
  ({ id: `dr110-${id.toLowerCase()}`, name: id, voices, accents, feel })

export const PRESET_MACHINES: PresetMachine[] = [
  {
    id: 'roland-cr-78',
    name: 'Roland CR-78',
    source: {
      title: 'Roland CR-78 Service Notes (20 June 1979), "Rhythm Patterns"',
      url: 'https://www.polynominal.com/roland-cr78/roland-cr78-service-manual.pdf',
      pages: 'pp. 13–14',
    },
    presets: [
      cr78('rock-1-a', 'Rock-1 A', { hatClosed: odd, kick: [1, 7, 9], snare: [5, 13] }, beats),
      cr78('rock-1-b', 'Rock-1 B', { hatClosed: odd, kick: [1, 9], snare: [5, 7, 13] }, beats),
      cr78('rock-2-a', 'Rock-2 A', { hatClosed: odd, kick: [1, 9, 11], snare: [5, 13] }, [1, 5, 11, 13]),
      cr78('rock-2-b', 'Rock-2 B', { hatClosed: odd, kick: [1, 3, 7, 11], snare: [5, 13] }, [3, 5, 11, 13]),
      cr78('rock-3-a', 'Rock-3 A', { hatClosed: odd, kick: [1, 9, 11], snare: [5, 8, 13] }, [1, 5, 11, 13]),
      cr78('rock-3-b', 'Rock-3 B', { hatClosed: odd, kick: [1, 4, 6, 9, 11, 16], snare: [5, 8, 13] }, [1, 5, 11, 13]),
      cr78('rock-4-a', 'Rock-4 A', { maracas: all, cymbal: [3, 11], kick: [1, 8, 9, 11, 16], snare: [5, 13] }, [1, 5, 9, 11, 13]),
      cr78('rock-4-b', 'Rock-4 B', { maracas: all, cymbal: [3, 11], kick: [1, 3, 6, 9, 16], snare: [5, 8, 13] }, [1, 3, 5, 9, 13]),
      cr78('disco-1-a', 'Disco-1 A', { maracas: odd, cymbal: [3, 14], kick: [1, 8, 9], snare: [5, 13] }, [5, 13]),
      cr78('disco-1-b', 'Disco-1 B', { maracas: odd, cymbal: [3, 14], kick: [1, 8, 9, 14], snare: [5, 14] }, [5, 14]),
      cr78('disco-2-a', 'Disco-2 A', { cymbal: [1, 13], maracas: [3, 7, 11, 15], conga: [3, 7], kick: [5, 13], snare: [5, 13] }, [5, 13]),
      cr78('disco-2-b', 'Disco-2 B', { cymbal: [1, 13], maracas: [3, 7, 11, 15], kick: [5, 13, 15], snare: [5, 13] }, [5, 13]),
      cr78('bossa-nova-a', 'Bossa Nova A', { maracas: all, cymbal: [1, 7, 14], rim: [1, 4, 7, 11, 14], kick: [1, 4, 5, 8, 9, 12, 13, 16] }, [5, 13]),
      cr78('bossa-nova-b', 'Bossa Nova B', { maracas: all, cymbal: [1, 7, 14], rim: [1, 3, 6, 9, 11, 14], kick: [1, 4, 5, 8, 9, 12, 13, 16] }, [5, 13]),
      cr78('enka-a', 'Enka A', { hatClosed: odd, kick: [1, 5, 9, 13], snare: [3, 4, 7, 11, 12, 15] }, [1, 9]),
      cr78('enka-b', 'Enka B', { hatClosed: odd, kick: [1, 7, 9, 13], snare: [3, 4, 5, 11, 15] }, [7, 9]),
      cr78('fox-trot', 'Fox Trot', { maracas: [1, 9], cymbal: [5, 13], kick: [1, 9], snare: [5, 13] }, [13]),
      cr78('tango', 'Tango', { kick: [1, 5, 9, 13, 15], snare: [1, 5, 9, 13, 15], cymbal: [15] }, [15]),
      cr78('shuffle-a', 'Shuffle A', { cymbal: odd, kick: [1, 7, 9], snare: [5, 13] }, beats, 'shuffle'),
      cr78('shuffle-b', 'Shuffle B', { cymbal: odd, kick: [1, 9], snare: [3, 7, 11, 15] }, beats, 'shuffle'),
      cr78('swing-a', 'Swing A', { cymbal: [1, 7, 9, 15], maracas: [5, 13], kick: [1, 9] }, beats, 'shuffle'),
      cr78('swing-b', 'Swing B', { cymbal: [1, 7, 9, 15], maracas: [5, 13], kick: [1, 9], snare: [7, 11] }, [11], 'shuffle'),
      cr78('boogie-a', 'Boogie A', { cymbal: beats, kick: [1, 9, 11], snare: [5, 13], maracas: [11] }, beats, 'shuffle'),
      cr78('boogie-b', 'Boogie B', { cymbal: beats, kick: [1, 3, 9, 11], snare: [5, 13], maracas: [3, 7, 11, 15] }, beats, 'shuffle'),
    ],
  },
  {
    id: 'boss-dr-110',
    name: 'Boss DR-110',
    source: {
      title: 'Boss DR-110 Dr. Rhythm Graphic Owner\'s Manual, "Preset Rhythms"',
      url: 'https://static.roland.com/assets/media/pdf/DR-110_OM.pdf',
      pages: 'pp. 36–39',
    },
    // The score's "closed & open hi-hat" notes are written as open hi-hat.
    presets: [
      dr110('C-1', { hatClosed: [1, 2, 4, 5, 6, 7, 9, 10, 11, 12, 14, 16], hatOpen: [3, 8, 13, 15], snare: [5, 13], kick: [1, 8, 10, 15] }, [1, 5, 8, 9, 13, 15, 16]),
      dr110('C-2', { hatClosed: [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 14, 16], hatOpen: [5, 13, 15], snare: [5, 13], kick: [1, 4, 7, 10, 13, 16] }, [1, 5, 9, 13, 15]),
      dr110('C-3', { hatClosed: [1, 3, 4, 7, 8, 9, 11, 12, 15, 16], hatOpen: [5, 13], snare: [5, 13], kick: beats }, [5, 9, 13]),
      dr110('C-4', { hatClosed: [1, 2, 6, 9, 10, 14], hatOpen: [3, 5, 7, 11, 13, 15], snare: [5, 13], kick: beats }, beats),
      dr110('C-5', { cymbal: odd, snare: [5, 13], kick: [1, 9, 11] }, odd),
      dr110('C-6', { hatClosed: [1, 3, 4, 7, 9, 11], hatOpen: [5, 8, 10, 12, 13, 15], snare: [5, 15], kick: [1, 4, 8, 10, 12, 15] }, [1, 5, 8, 9, 10, 12, 13, 15]),
      dr110('C-7', { hatClosed: odd, snare: [5, 13, 14], kick: [1, 7, 9, 15], cymbal: [1, 6, 9, 14, 16], clap: [5, 11, 13] }, beats),
      dr110('C-8', { hatClosed: [1, 7, 9, 15], hatOpen: [3, 11], snare: [5, 13], kick: [1, 7, 11, 15] }, [1, 5, 9, 13, 15]),
      dr110('D-1', { hatClosed: [2, 4, 6, 7, 8, 10, 12, 14, 15, 16], hatOpen: [1, 3, 5, 9, 11, 13], snare: [5, 13], kick: [1, 11, 16], cymbal: [2, 4, 6, 8, 10, 12, 15, 16] }, beats),
      dr110('D-2', { hatClosed: [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 13], hatOpen: [4, 12, 15], snare: [5, 13, 15, 16], kick: [1, 8, 10, 16] }, [1, 2, 3, 4, 5, 9, 12, 13, 15, 16]),
      dr110('D-3', { hatClosed: [1, 3, 5, 7, 11, 13, 14, 15], hatOpen: [9, 16], snare: [9], kick: [1, 15], cymbal: [1] }, [1, 3, 5, 7, 9, 11, 13, 15, 16]),
      dr110('D-4', { hatClosed: [1, 2, 3, 4, 5, 6, 10, 11, 12], hatOpen: [7, 9, 13], snare: [9, 13, 15], kick: [3, 7] }, [1, 3, 5, 7, 9, 13, 15]),
      dr110('D-6', { hatClosed: [1, 9], hatOpen: [5, 13], snare: [5, 13], kick: [1, 9, 11] }, beats, 'shuffle'),
      dr110('D-7', { hatClosed: [1, 3, 9, 11], hatOpen: [5, 13], snare: [9], kick: [1, 15] }, [1, 3, 5, 9, 11, 13], 'shuffle'),
    ],
  },
]

export interface PresetTrack {
  steps: boolean[]
  levels: number[]
}

/**
 * Steps and accent levels per kit slot for `preset`. Each voice plays on the first of its roles
 * the kit has; a voice with none is left out. Accents are per step, so voices sharing a slot agree.
 */
export function presetTracks(preset: RhythmPreset, slotIds: readonly string[]): Record<string, PresetTrack> {
  const have = new Set(slotIds)
  const out: Record<string, PresetTrack> = {}
  for (const [voice, steps] of Object.entries(preset.voices) as [PresetVoice, number[]][]) {
    const slot = VOICE_ROLES[voice].find((r) => have.has(r))
    if (!slot) continue
    const t = (out[slot] ??= { steps: new Array<boolean>(16).fill(false), levels: new Array<number>(16).fill(1) })
    for (const s of steps) {
      t.steps[s - 1] = true
      t.levels[s - 1] = preset.accents.includes(s) ? 1 : UNACCENTED_LEVEL
    }
  }
  return out
}

/** The whole-pattern rhythm for `preset` on a kit: a 16-step loop, straight or shuffled. */
export function presetRhythm(preset: RhythmPreset, slotIds: readonly string[], swingGrid: 8 | 16): Rhythm {
  const shuffle = preset.feel === 'shuffle'
  return {
    tracks: presetTracks(preset, slotIds),
    swing: shuffle ? SHUFFLE_SWING : 50,
    swingGrid: shuffle ? 8 : swingGrid,
    length: 16,
  }
}
