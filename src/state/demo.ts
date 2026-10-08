// Named demo pattern shown in the library for testing and discovery.
import type { Pattern } from '../contract/types'

const steps = (on: number[]) => Array.from({ length: 16 }, (_, i) => on.includes(i + 1)) as Pattern['tracks'][number]['steps']

export const DEMO_PATTERN_ID = 'demo-linndrum-basic'

export function demoPattern(kitRevision: string): Pattern {
  return {
    schemaVersion: 1,
    id: DEMO_PATTERN_ID,
    name: 'DEMO BEAT',
    kitId: 'linn-linndrum-main',
    kitRevision,
    bpm: 120,
    tracks: [
      { slotId: 'kick', sampleId: 'linn-linndrum-main-kick-01', steps: steps([1, 5, 9, 13]) },
      { slotId: 'snare', sampleId: 'linn-linndrum-main-snare-01', steps: steps([5, 13]) },
      { slotId: 'hat-closed', sampleId: 'linn-linndrum-main-hat-closed', steps: steps([1, 3, 5, 7, 9, 11, 13]) },
      { slotId: 'hat-open', sampleId: 'linn-linndrum-main-hat-open', steps: steps([15]) },
      { slotId: 'crash', sampleId: 'linn-linndrum-main-crash', steps: steps([]) },
    ],
    updatedAt: '2026-09-30T00:00:00Z',
  }
}
