// Small IndexedDB wrapper. Failures reject; callers degrade without disabling audio.

const DB_NAME = 'drums'
const DB_VERSION = 2
export const STORES = { patterns: 'patterns', meta: 'meta', media: 'media', offlineKits: 'offlineKits' } as const

let dbPromise: Promise<IDBDatabase> | null = null

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'))
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (ev) => {
      const db = req.result
      // Migrations: add a branch per version; never drop user data.
      if (ev.oldVersion < 1) {
        db.createObjectStore(STORES.patterns, { keyPath: 'id' })
        db.createObjectStore(STORES.meta)
      }
      if (ev.oldVersion < 2) {
        // Encoded-media cache metadata and offline kit references (A4).
        db.createObjectStore(STORES.media, { keyPath: 'url' })
        db.createObjectStore(STORES.offlineKits, { keyPath: 'kitId' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'))
  })
  dbPromise.catch(() => (dbPromise = null))
  return dbPromise
}

const wrap = <T,>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

export async function dbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb()
  return wrap(db.transaction(store).objectStore(store).get(key)) as Promise<T | undefined>
}

export async function dbGetAll<T>(store: string): Promise<T[]> {
  const db = await openDb()
  return wrap(db.transaction(store).objectStore(store).getAll()) as Promise<T[]>
}

export async function dbPut(store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(store, 'readwrite')
  tx.objectStore(store).put(value, key)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'))
  })
}

export async function dbDelete(store: string, key: IDBValidKey): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(store, 'readwrite')
  tx.objectStore(store).delete(key)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Ask the browser not to evict this site's storage (patterns, prefs, offline
 * kits) under pressure or after inactivity (Safari clears unpersisted site data
 * after seven days without a visit). Called on the first explicit save; Chrome
 * and Safari decide silently, Firefox may ask once.
 */
export function requestPersistentStorage(): void {
  if (typeof navigator === 'undefined' || !navigator.storage?.persisted) return
  void navigator.storage
    .persisted()
    .then((done) => (done ? true : navigator.storage.persist()))
    .catch(() => false)
}
