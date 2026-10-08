// Backup file: every saved pattern plus favourites, as one JSON file the user
// keeps or moves to another device. Import merges; it never deletes.
import type { Pattern } from '../contract/types'
import { isPattern } from './patterns'

export const BACKUP_FORMAT = 'vdvm-backup'
/** Backups exported before the product was named V.D.V.M; still imported. */
const LEGACY_BACKUP_FORMAT = 'drums-backup'

export interface Backup {
  format: typeof BACKUP_FORMAT
  version: 1
  exportedAt: string
  patterns: Pattern[]
  favourites: string[]
}

export function makeBackup(patterns: Pattern[], favourites: string[], now = new Date()): Backup {
  return { format: BACKUP_FORMAT, version: 1, exportedAt: now.toISOString(), patterns, favourites }
}

/** Parse a backup file; throws a message fit for the user when it is not one. */
export function parseBackup(text: string): Backup {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('This file is not a V.D.V.M backup (not JSON).')
  }
  const b = data as Omit<Partial<Backup>, 'format'> & { format?: string }
  if (!b || (b.format !== BACKUP_FORMAT && b.format !== LEGACY_BACKUP_FORMAT) || b.version !== 1 || !Array.isArray(b.patterns)) {
    throw new Error('This file is not a V.D.V.M backup.')
  }
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: typeof b.exportedAt === 'string' ? b.exportedAt : '',
    patterns: b.patterns.filter(isPattern),
    favourites: Array.isArray(b.favourites) ? b.favourites.filter((x): x is string => typeof x === 'string') : [],
  }
}

/** Patterns from `incoming` to write: new IDs, or a newer `updatedAt` than the local copy. */
export function patternsToImport(local: Pattern[], incoming: Pattern[]): Pattern[] {
  const have = new Map(local.map((p) => [p.id, p.updatedAt]))
  return incoming.filter((p) => {
    const at = have.get(p.id)
    return at === undefined || p.updatedAt > at
  })
}
