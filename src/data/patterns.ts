// Saved patterns and the autosaved working draft. Saved patterns use the
// contract Pattern shape; the draft also records whether it matches a save.
import type { Pattern } from '../contract/types'
import { dbDelete, dbGet, dbGetAll, dbPut, STORES } from './db'

export interface Draft {
  pattern: Pattern
  /** True when the draft equals its saved copy. */
  saved: boolean
  selectedSlotId: string | null
}

const DRAFT_KEY = 'draft'

/** Structural check for patterns read from storage; unknown extra fields are kept. */
export function isPattern(p: unknown): p is Pattern {
  const x = p as Pattern
  return (
    !!x && x.schemaVersion === 1 && typeof x.id === 'string' && typeof x.kitId === 'string' &&
    typeof x.bpm === 'number' && Array.isArray(x.tracks) &&
    x.tracks.every((t) => typeof t?.slotId === 'string' && typeof t.sampleId === 'string' && Array.isArray(t.steps))
  )
}

export async function loadDraft(): Promise<Draft | null> {
  const d = await dbGet<Draft>(STORES.meta, DRAFT_KEY)
  return d && isPattern(d.pattern) ? d : null
}

export const saveDraft = (d: Draft) => dbPut(STORES.meta, d, DRAFT_KEY)

export async function listPatterns(): Promise<Pattern[]> {
  const all = (await dbGetAll<Pattern>(STORES.patterns)).filter(isPattern)
  return all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
}

export const putPattern = (p: Pattern) => dbPut(STORES.patterns, p)
export const deletePattern = (id: string) => dbDelete(STORES.patterns, id)

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
