// Per-device preferences: favourite machines, recent kits, kit-arrow scope, the
// last library tab and the output volume. Stored in IndexedDB (meta store); the app keeps working
// in memory when storage is unavailable.
import { dbGet, dbPut, STORES } from './db'

/** 'offline' is the browser's offline-kit tab; 'sources' is the plugin's libraries tab. */
export type LibraryTab = 'machines' | 'patterns' | 'sounds' | 'offline' | 'sources'
export type ArrowScope = 'all' | 'favourites'

export interface Prefs {
  favourites: string[]
  /** Kit IDs, most recent first. */
  recents: string[]
  arrowScope: ArrowScope
  libraryTab: LibraryTab
  /** Listener output gain in dB; 0 is the default level. Not saved with patterns. */
  outputDb: number
}

export const RECENTS_MAX = 8
const KEY = 'prefs'
const DEFAULTS: Prefs = { favourites: [], recents: [], arrowScope: 'all', libraryTab: 'machines', outputDb: 0 }

export function toggleIn(list: string[], id: string) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
}

export function pushRecent(list: string[], id: string) {
  return [id, ...list.filter((x) => x !== id)].slice(0, RECENTS_MAX)
}

/** The preference store surface the app uses (also implemented over the plugin bridge). */
export interface PrefsApi {
  readonly loaded: Promise<void>
  subscribe(fn: () => void): () => void
  getSnapshot(): Prefs
  toggleFavourite(machineId: string): void
  addRecent(kitId: string): void
  addFavourites(ids: string[]): void
  setArrowScope(scope: ArrowScope): void
  setLibraryTab(tab: LibraryTab): void
  setOutputDb(db: number): void
  resolve(machine: (id: string) => string, kit: (id: string) => string): void
}

class PrefsStore implements PrefsApi {
  private prefs: Prefs = DEFAULTS
  private listeners = new Set<() => void>()
  loaded: Promise<void>

  constructor() {
    this.loaded =
      typeof indexedDB === 'undefined'
        ? Promise.resolve()
        : dbGet<Partial<Prefs>>(STORES.meta, KEY)
            .then((p) => {
              if (p) this.prefs = { ...DEFAULTS, ...p }
              this.emit()
            })
            .catch(() => {})
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getSnapshot = () => this.prefs
  private emit() {
    for (const l of this.listeners) l()
  }
  private update(patch: Partial<Prefs>) {
    this.prefs = { ...this.prefs, ...patch }
    this.emit()
    void dbPut(STORES.meta, this.prefs, KEY).catch(() => {})
  }

  toggleFavourite = (machineId: string) => this.update({ favourites: toggleIn(this.prefs.favourites, machineId) })
  addRecent = (kitId: string) => {
    if (this.prefs.recents[0] !== kitId) this.update({ recents: pushRecent(this.prefs.recents, kitId) })
  }
  addFavourites = (ids: string[]) => {
    const favourites = [...new Set([...this.prefs.favourites, ...ids])]
    if (favourites.length !== this.prefs.favourites.length) this.update({ favourites })
  }
  setArrowScope = (arrowScope: ArrowScope) => this.update({ arrowScope })
  setLibraryTab = (libraryTab: LibraryTab) => this.update({ libraryTab })
  setOutputDb = (outputDb: number) => this.update({ outputDb })
  /** Rewrite stored IDs through catalog redirects. */
  resolve(machine: (id: string) => string, kit: (id: string) => string) {
    const favourites = [...new Set(this.prefs.favourites.map(machine))]
    const recents = [...new Set(this.prefs.recents.map(kit))]
    if (favourites.join() !== this.prefs.favourites.join() || recents.join() !== this.prefs.recents.join()) {
      this.update({ favourites, recents })
    }
  }
}

export const prefs = new PrefsStore()
