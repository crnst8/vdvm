// Documented hardware timing per machine ("circuit" timing), from
// docs/research/GROOVE_RESEARCH.md. Only machines with a documented figure are
// listed; nothing here is estimated by ear. Keyed by catalog machine ID.

export interface Source {
  title: string
  url: string
}

/** Swing positions the hardware could actually reach. */
export type SwingSteps =
  /** Delay in whole ticks: first note of a pair = 50% + k × (100 / divisions)%, k ≤ maxSteps. */
  | { kind: 'ticks'; divisions: number; maxSteps: number }
  /** Documented percentages (true timings unknown), used as listed. */
  | { kind: 'values'; values: number[] }

export interface SwingProfile {
  /** Per swing grid; a grid the machine did not offer is absent. */
  grids: Partial<Record<8 | 16, SwingSteps>>
  note: string
  source: Source
  confidence: 'manual' | 'derived' | 'reported'
}

export type JitterProfile =
  /** Step lateness in [0, maxMs] with the measured mean (uniform when no mean was published). */
  | { kind: 'measured'; maxMs: number; meanMs?: number; conditions: string; source: Source; confidence: 'measured' | 'reported' }
  /**
   * Free-running tempo oscillator polled by the CPU every pollMs: a step fires at the next
   * poll, plus CPU delay; total bounded by the measured maximum.
   */
  | { kind: 'poll'; pollMs: number; maxMs: number; conditions: string; source: Source; confidence: 'measured' | 'reported' }

export interface CircuitProfile {
  /** Short line for the panel, e.g. "Clock polled every 2 ms · up to 4.46 ms". */
  summary: string
  swing?: SwingProfile
  jitter?: JitterProfile
}

const LITMUS: Source = { title: 'Innerclock Systems Litmus timing tests', url: 'https://www.innerclocksystems.com/litmus' }
const INNERCLOCK_909: Source = {
  title: 'Innerclock Systems TR-909 measurement (quoted on Gearspace; original post offline)',
  url: 'https://gearspace.com/board/electronic-music-instruments-and-electronic-music-production/1022404-there-way-improve-tr-909-timing-jitter.html',
}
// Millisecond figures are the ones Litmus states (its sample counts are at 96 kHz for some devices, 48 kHz for others).

// Linn-lineage swing: 54, 58, 63, 67, 71% are 1-tick steps of a 24-division pair (54.17, 58.33, 62.5, 66.67, 70.83).
const LINN_24: SwingSteps = { kind: 'ticks', divisions: 24, maxSteps: 5 }

export const CIRCUITS: Record<string, CircuitProfile> = {
  'roland-tr-909': {
    summary: 'Clock polled every 2 ms · up to 4.46 ms between steps',
    swing: {
      grids: { 16: { kind: 'ticks', divisions: 24, maxSteps: 6 } },
      note: 'Shuffle as 2/96-beat steps (community figure; the manual gives 7 levels)',
      source: { title: 'TR-909 owner’s manual + community measurement', url: 'https://archive.org/details/synthmanual-roland-tr-909-owners-manual' },
      confidence: 'reported',
    },
    jitter: { kind: 'poll', pollMs: 2, maxMs: 4.46, conditions: 'own clock', source: INNERCLOCK_909, confidence: 'reported' },
  },
  'roland-tr-808': {
    summary: 'Up to 2.05 ms (average 1.72 ms) under DIN sync',
    jitter: { kind: 'measured', maxMs: 2.052, meanMs: 1.72, conditions: '24 PPQN DIN sync', source: LITMUS, confidence: 'measured' },
  },
  'roland-tr-606': {
    summary: 'Up to 2.19 ms under DIN sync',
    jitter: { kind: 'measured', maxMs: 2.187, conditions: '24 PPQN DIN sync', source: LITMUS, confidence: 'measured' },
  },
  'roland-cr-78': {
    summary: 'Up to 0.04 ms under 12 PPQN clock',
    jitter: { kind: 'measured', maxMs: 0.042, conditions: '12 PPQN 5 V clock', source: LITMUS, confidence: 'measured' },
  },
  'linn-lm-1': {
    summary: 'Up to 0.19 ms under 48 PPQN clock',
    jitter: { kind: 'measured', maxMs: 0.188, conditions: '48 PPQN V-clock', source: LITMUS, confidence: 'measured' },
  },
  'akai-mpc-60': {
    summary: '96 PPQN swing ticks · up to 1.0 ms under MIDI clock',
    swing: {
      grids: { 16: { kind: 'ticks', divisions: 48, maxSteps: 12 }, 8: { kind: 'ticks', divisions: 96, maxSteps: 24 } },
      note: 'Shuffle 50–75% at 96 PPQN',
      source: { title: 'MPC60 v2.0 operator’s manual', url: 'https://cdn.prod.website-files.com/5ad24a891dee8925107423d0/5e6a638d9490763986ab18f6_mpc60_v2.0_manual.pdf' },
      confidence: 'manual',
    },
    jitter: { kind: 'measured', maxMs: 1.0, conditions: 'MIDI clock (48 samples at 48 kHz)', source: LITMUS, confidence: 'measured' },
  },
  'oberheim-dmx': {
    summary: 'Swing 54 · 58 · 62 · 66 · 71% (actual 54.17–70.83%)',
    swing: {
      grids: { 16: LINN_24, 8: LINN_24 },
      note: 'Six settings 50–71%, 48 PPQN',
      source: { title: 'Oberheim DMX owner’s manual', url: 'https://archive.org/details/synthmanual-oberheim-dmx-owners-manual' },
      confidence: 'derived',
    },
  },
  'emu-drumulator': {
    summary: 'Swing 54 · 58 · 63 · 67 · 71% (actual 54.17–70.83%)',
    swing: {
      grids: { 16: LINN_24, 8: LINN_24 },
      note: 'Six swing factors 50–71%',
      source: { title: 'Drumulator owner’s manual', url: 'https://www.polynominal.com/emu-drumulator/emu-drumulator-manual.pdf' },
      confidence: 'derived',
    },
  },
  'yamaha-rx11': {
    summary: 'Swing 54 · 58 · 63 · 67 · 71% on 1/8 or 1/16',
    swing: {
      grids: { 16: LINN_24, 8: LINN_24 },
      note: 'Six values 50–71% (one page of the manual says 75%)',
      source: { title: 'Yamaha RX11 owner’s manual', url: 'https://archive.org/details/synthmanual-yamaha-rx-11-owners-manual' },
      confidence: 'derived',
    },
  },
  'yamaha-rx-5': {
    summary: 'Swing 54 · 58 · 63 · 67 · 71%',
    swing: {
      grids: { 16: LINN_24, 8: LINN_24 },
      note: 'Off, 54–71%; 67% is a triplet shuffle',
      source: { title: 'Yamaha RX5 owner’s manual', url: 'https://archive.org/details/synthmanual-yamaha-rx-5-owners-manual' },
      confidence: 'derived',
    },
  },
  'kawai-r50': {
    summary: 'Swing to 75%; 1/16 allows only 58 · 67 · 75%',
    swing: {
      grids: { 16: { kind: 'ticks', divisions: 12, maxSteps: 3 }, 8: { kind: 'ticks', divisions: 24, maxSteps: 6 } },
      note: '50–75%; 54, 63 and 71% are refused on 1/16',
      source: { title: 'Kawai R-50 owner’s manual', url: 'https://archive.org/details/synthmanual-r-50-owners-manual' },
      confidence: 'manual',
    },
  },
  'alesis-hr-16': {
    summary: 'Swing in 96 PPQN ticks: 1/16 to 66.7%, 1/8 to 68.8%',
    swing: {
      grids: { 16: { kind: 'ticks', divisions: 48, maxSteps: 8 }, 8: { kind: 'ticks', divisions: 96, maxSteps: 18 } },
      note: 'Swing range set by the quantize value',
      source: { title: 'Alesis HR-16/HR-16B manual', url: 'https://www.smemmusic.ch/sites/default/files/2025-10/alesis-hr16_hr16b_mmt8_manual.pdf' },
      confidence: 'manual',
    },
  },
  'roland-r-70': {
    summary: 'Swing delay 0–23 clocks (1/16) or 0–47 (1/8) at 96 PPQN',
    swing: {
      grids: { 16: { kind: 'ticks', divisions: 48, maxSteps: 23 }, 8: { kind: 'ticks', divisions: 96, maxSteps: 47 } },
      note: 'Clock = 1/384 note',
      source: { title: 'Roland R-70 owner’s manual', url: 'https://static.roland.com/assets/media/pdf/R-70_OM.pdf' },
      confidence: 'manual',
    },
  },
  'boss-dr-660': {
    summary: 'Swing 54 · 58 · 62 · 67 · 71 · 75 · 80%',
    swing: {
      grids: { 16: { kind: 'values', values: [50, 54, 58, 62, 67, 71, 75, 80] }, 8: { kind: 'values', values: [50, 54, 58, 62, 67, 71, 75, 80] } },
      note: 'Eight documented values; 67% is triplet swing',
      source: { title: 'Boss DR-660 owner’s manual', url: 'https://static.roland.com/assets/media/pdf/DR-660_OM.pdf' },
      confidence: 'manual',
    },
  },
  'alesis-sr-16': {
    summary: 'Swing 54 · 58 · 62%',
    swing: {
      grids: { 16: { kind: 'values', values: [50, 54, 58, 62] }, 8: { kind: 'values', values: [50, 54, 58, 62] } },
      note: 'Three documented values plus off',
      source: { title: 'Alesis SR-16 Reference Manual', url: 'https://www.alesis.com/rscdn/920/documents/SR16%20Reference%20Rev%20C.pdf' },
      confidence: 'manual',
    },
  },
}

// Siblings documented by the same manual.
CIRCUITS['alesis-hr-16b'] = CIRCUITS['alesis-hr-16']
CIRCUITS['kawai-r50e'] = { ...CIRCUITS['kawai-r50'], swing: { ...CIRCUITS['kawai-r50'].swing!, source: { title: 'Kawai R-50e owner’s manual', url: 'https://archive.org/details/synthmanual-r-50e-owners-manual' } } }

export const circuitFor = (machineId: string | null | undefined): CircuitProfile | null =>
  (machineId && CIRCUITS[machineId]) || null
