// Editable pattern state. Pure reducer; no audio or storage here.
import type { KitManifest, Pattern } from '../contract/types'
import { clampPitchCents } from '../audio/pitch'

export const STEPS = 16
export const PAGE_SIZE = 8
export const BPM_MIN = 40
export const BPM_MAX = 240
export const BPM_DEFAULT = 120
export const DEFAULT_NAME = 'UNTITLED'
export const NAME_MAX = 64
export const TRACK_GAIN_MIN_DB = -36
export const TRACK_GAIN_MAX_DB = 6
export const LOOP_LENGTHS = [16, 8] as const
export type LoopLength = (typeof LOOP_LENGTHS)[number]

export interface TrackState {
  slotId: string
  sampleId: string
  steps: boolean[]
  /** Drum volume offset in dB; -Infinity means off. */
  gainDb: number
  /** Per-step level 0..1; amplitude is level squared. */
  levels: number[]
  /** Per-step pitch offset in integer cents, added to the pattern's overall pitch. Exactly 16 entries. */
  stepPitchCents: number[]
}

export interface PatternState {
  id: string
  name: string
  kitId: string
  kitRevision: string
  bpm: number
  swing: number
  swingGrid: 8 | 16
  /** Apply the current machine's documented hardware timing (swing positions, step jitter) when it has any. */
  circuit: boolean
  /** Loop length: 16, or 8 to repeat steps 1-8 only. */
  length: LoopLength
  /** Overall sample tuning in integer cents applied to every instrument. Default 0. */
  pitchCents: number
  /** Keyed by slotId. Tracks for slots missing from the active kit stay here untouched. */
  tracks: Record<string, TrackState>
  /** Saved revision marker: equals `edits` when the current state is saved. */
  edits: number
  savedEdits: number | null
}

export type PatternAction =
  | { type: 'toggleStep'; slotId: string; step: number; sampleId: string }
  | { type: 'setBpm'; bpm: number }
  | { type: 'setSwing'; swing: number }
  | { type: 'setCircuit'; circuit: boolean }
  | { type: 'setSwingGrid'; grid: 8 | 16 }
  | { type: 'nudgeBpm'; delta: number }
  | { type: 'rename'; name: string }
  | { type: 'setSample'; slotId: string; sampleId: string }
  | { type: 'bindKit'; kit: KitManifest; silent?: boolean }
  | { type: 'load'; pattern: PatternState }
  | { type: 'setTrackGain'; slotId: string; gainDb: number }
  | { type: 'setStepLevel'; slotId: string; step: number; level: number }
  | { type: 'resetTrackVolume'; slotId: string }
  | { type: 'setPitch'; pitchCents: number }
  | { type: 'setStepPitch'; slotId: string; step: number; pitchCents: number }
  | { type: 'resetStepPitches'; slotId: string }
  | { type: 'setLength'; length: LoopLength }
  | { type: 'markSaved' }
  | { type: 'clear' }

export const clampBpm = (bpm: number) =>
  Number.isFinite(bpm) ? Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(bpm))) : BPM_DEFAULT

export const emptySteps = () => new Array<boolean>(STEPS).fill(false)
export const fullLevels = () => new Array<number>(STEPS).fill(1)
export const zeroStepPitches = () => new Array<number>(STEPS).fill(0)

/** Effective pitch for a hit: the pattern's overall tune plus the track's offset for that step. */
export function hitPitchCents(
  pattern: Pick<PatternState, 'pitchCents'>,
  track: Pick<TrackState, 'stepPitchCents'> | null | undefined,
  step: number | null,
): number {
  if (step === null || !track) return pattern.pitchCents
  return pattern.pitchCents + (track.stepPitchCents[step] ?? 0)
}

/** Track gain is stored finite; the fader's bottom stop (below the minimum) means off. */
export const clampTrackGain = (db: number) =>
  !Number.isFinite(db) || db < TRACK_GAIN_MIN_DB ? -Infinity : Math.min(TRACK_GAIN_MAX_DB, Math.round(db * 2) / 2)
export const clampLevel = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, Math.round(x * 100) / 100)) : 1)

/** Total dB offset for a hit from track gain and step level. -Infinity when silent. */
export function hitGainDb(track: Pick<TrackState, 'gainDb' | 'levels'>, step: number | null): number {
  const level = step === null ? 1 : (track.levels[step] ?? 1)
  if (level <= 0 || track.gainDb === -Infinity) return -Infinity
  return track.gainDb + 40 * Math.log10(level)
}

const newTrack = (slotId: string, sampleId: string): TrackState => ({
  slotId, sampleId, steps: emptySteps(), gainDb: 0, levels: fullLevels(), stepPitchCents: zeroStepPitches(),
})

export { bindKit as bindKitState }

export function newPatternState(kit: KitManifest, id: string): PatternState {
  const s: PatternState = {
    id, name: DEFAULT_NAME, kitId: kit.id, kitRevision: kit.revision, bpm: BPM_DEFAULT, length: 16, swing: 50, swingGrid: 16, circuit: false,
    pitchCents: 0, tracks: {}, edits: 0, savedEdits: null,
  }
  return bindKit(s, kit)
}

/** Ensure a track exists for every slot of `kit`; keep tracks for other slots (silenced, restorable). */
function bindKit(state: PatternState, kit: KitManifest): PatternState {
  const tracks = { ...state.tracks }
  for (const slot of kit.slots) {
    const existing = tracks[slot.id]
    if (!existing) {
      tracks[slot.id] = newTrack(slot.id, slot.defaultSampleId)
    } else if (!slot.sampleIds.includes(existing.sampleId) && state.kitId !== kit.id) {
      // Kit switch: the previous kit's sample cannot play here. Keep steps, use this kit's default.
      tracks[slot.id] = { ...existing, sampleId: slot.defaultSampleId }
    }
  }
  return { ...state, kitId: kit.id, kitRevision: kit.revision, tracks }
}

const edited = (s: PatternState): PatternState => ({ ...s, edits: s.edits + 1 })

export function patternReducer(state: PatternState, action: PatternAction): PatternState {
  switch (action.type) {
    case 'setSwing': {
      const swing = Number.isFinite(action.swing) ? Math.min(75, Math.max(50, Math.round(action.swing))) : 50
      return swing === state.swing ? state : edited({ ...state, swing })
    }
    case 'setCircuit':
      return action.circuit === state.circuit ? state : edited({ ...state, circuit: action.circuit })
    case 'setSwingGrid':
      return action.grid === state.swingGrid ? state : edited({ ...state, swingGrid: action.grid })
    case 'toggleStep': {
      if (action.step < 0 || action.step >= STEPS) return state
      const track = state.tracks[action.slotId] ?? newTrack(action.slotId, action.sampleId)
      const steps = track.steps.slice()
      steps[action.step] = !steps[action.step]
      return edited({ ...state, tracks: { ...state.tracks, [action.slotId]: { ...track, steps } } })
    }
    case 'setBpm': {
      const bpm = clampBpm(action.bpm)
      return bpm === state.bpm ? state : edited({ ...state, bpm })
    }
    case 'nudgeBpm':
      return patternReducer(state, { type: 'setBpm', bpm: state.bpm + action.delta })
    case 'rename': {
      const name = action.name.trim().slice(0, NAME_MAX) || DEFAULT_NAME
      return name === state.name ? state : edited({ ...state, name })
    }
    case 'setSample': {
      const track = state.tracks[action.slotId]
      if (!track || track.sampleId === action.sampleId) return state
      return edited({ ...state, tracks: { ...state.tracks, [action.slotId]: { ...track, sampleId: action.sampleId } } })
    }
    case 'setTrackGain': {
      const track = state.tracks[action.slotId]
      const gainDb = clampTrackGain(action.gainDb)
      if (!track || track.gainDb === gainDb) return state
      return edited({ ...state, tracks: { ...state.tracks, [action.slotId]: { ...track, gainDb } } })
    }
    case 'setStepLevel': {
      const track = state.tracks[action.slotId]
      if (!track || action.step < 0 || action.step >= STEPS) return state
      const level = clampLevel(action.level)
      if (track.levels[action.step] === level) return state
      const levels = track.levels.slice()
      levels[action.step] = level
      return edited({ ...state, tracks: { ...state.tracks, [action.slotId]: { ...track, levels } } })
    }
    case 'resetTrackVolume': {
      const track = state.tracks[action.slotId]
      if (!track) return state
      return edited({ ...state, tracks: { ...state.tracks, [action.slotId]: { ...track, gainDb: 0, levels: fullLevels() } } })
    }
    case 'setPitch': {
      const pitchCents = clampPitchCents(action.pitchCents)
      return pitchCents === state.pitchCents ? state : edited({ ...state, pitchCents })
    }
    case 'setStepPitch': {
      if (!Number.isInteger(action.step) || action.step < 0 || action.step >= STEPS) return state
      const track = state.tracks[action.slotId]
      if (!track) return state
      const pitchCents = clampPitchCents(action.pitchCents)
      if (track.stepPitchCents[action.step] === pitchCents) return state
      const stepPitchCents = track.stepPitchCents.slice()
      stepPitchCents[action.step] = pitchCents
      return edited({ ...state, tracks: { ...state.tracks, [action.slotId]: { ...track, stepPitchCents } } })
    }
    case 'resetStepPitches': {
      const track = state.tracks[action.slotId]
      if (!track || track.stepPitchCents.every((c) => c === 0)) return state
      return edited({ ...state, tracks: { ...state.tracks, [action.slotId]: { ...track, stepPitchCents: zeroStepPitches() } } })
    }
    case 'setLength':
      return action.length === state.length ? state : edited({ ...state, length: action.length })
    case 'bindKit': {
      // `silent`: rebinding a loaded pattern to the current kit revision is not a user edit.
      const next = bindKit(state, action.kit)
      return action.silent ? next : edited(next)
    }
    case 'load':
      return action.pattern
    case 'markSaved':
      return { ...state, savedEdits: state.edits }
    case 'clear': {
      const tracks: Record<string, TrackState> = {}
      for (const [k, t] of Object.entries(state.tracks)) tracks[k] = { ...t, steps: emptySteps() }
      return edited({ ...state, tracks })
    }
  }
}

export const isSaved = (s: PatternState) => s.savedEdits !== null && s.savedEdits === s.edits

export function toPattern(s: PatternState, now = new Date()): Pattern {
  return {
    schemaVersion: 1, id: s.id, name: s.name, kitId: s.kitId, kitRevision: s.kitRevision, bpm: s.bpm,
    ...(s.length !== 16 ? { length: s.length } : {}),
    ...(s.swing !== 50 ? { swing: s.swing } : {}),
    ...(s.swingGrid !== 16 ? { swingGrid: s.swingGrid } : {}),
    ...(s.circuit ? { circuit: true } : {}),
    ...(s.pitchCents !== 0 ? { pitchCents: s.pitchCents } : {}),
    tracks: Object.values(s.tracks)
      .sort((a, b) => (a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0))
      .map((t) => {
        type T = Pattern['tracks'][number]
        const out: T = { slotId: t.slotId, sampleId: t.sampleId, steps: t.steps.slice() as T['steps'] }
        // Off is stored as the schema minimum; defaults are omitted to keep saved patterns small.
        if (t.gainDb !== 0) out.gainDb = t.gainDb === -Infinity ? -60 : t.gainDb
        if (t.levels.some((l) => l !== 1)) out.levels = t.levels.slice() as T['levels']
        if (t.stepPitchCents.some((c) => c !== 0)) out.stepPitchCents = t.stepPitchCents.slice() as T['stepPitchCents']
        return out
      }),
    updatedAt: now.toISOString(),
  }
}

export function fromPattern(p: Pattern, saved: boolean): PatternState {
  const tracks: Record<string, TrackState> = {}
  for (const t of p.tracks) {
    const steps = emptySteps().map((_, i) => t.steps[i] === true)
    const levels = fullLevels().map((_, i) => clampLevel(t.levels?.[i] ?? 1))
    const src = Array.isArray(t.stepPitchCents) ? t.stepPitchCents : []
    const stepPitchCents = zeroStepPitches().map((_, i) => clampPitchCents(src[i]))
    tracks[t.slotId] = { slotId: t.slotId, sampleId: t.sampleId, steps, gainDb: clampTrackGain(t.gainDb ?? 0), levels, stepPitchCents }
  }
  return {
    id: p.id, name: p.name || DEFAULT_NAME, kitId: p.kitId, kitRevision: p.kitRevision,
    bpm: clampBpm(p.bpm), length: p.length === 8 ? 8 : 16,
    swing: Number.isFinite(p.swing) ? Math.min(75, Math.max(50, Math.round(p.swing!))) : 50,
    swingGrid: p.swingGrid === 8 ? 8 : 16, circuit: p.circuit === true, pitchCents: clampPitchCents(p.pitchCents),
    tracks, edits: 0, savedEdits: saved ? 0 : null,
  }
}
