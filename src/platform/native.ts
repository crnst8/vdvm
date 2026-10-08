// Plugin platform: the WebView UI drives the C++ processor. Sound, kit
// loading, libraries, saved patterns and preferences all live on the native
// side; this module mirrors their state for the React app.
import type { KitManifest, Pattern, Sample } from '../contract/types'
import type { CatalogIO } from '../data/catalog'
import type { Draft } from '../data/patterns'
import type { ArrowScope, LibraryTab, Prefs, PrefsApi } from '../data/prefs'
import type { TransportSnapshot } from '../audio/transport'
import { toPattern, type PatternState } from '../state/pattern'
import { call, on, send } from './bridge'
import { DEFAULT_VIEW_SCALE as DEFAULT_SCALE, VIEW_SCALES } from './view'
import type { Platform, TransportApi } from './types'

// ---- protocol ----------------------------------------------------------------------

export type LibraryKind = 'factory' | 'catalog' | 'user' | 'linked'

export interface LibraryInfo {
  id: string
  kind: LibraryKind
  name: string
  path: string
  linkedPath: string | null
  writable: boolean
  available: boolean
  problem: string | null
  kits: number
  imported: number
}

export interface NativeStatus {
  kitStatus: 'idle' | 'loading' | 'ready' | 'error' | 'missing'
  libraryId: string | null
  kitId: string | null
  pendingKitId: string | null
  progress: { done: number; total: number }
  playing: boolean
  followingHost: boolean
  hostSync: boolean
  hostBpm: number | null
  standalone: boolean
  error: string | null
  readySampleIds: string[]
}

export interface ScanCandidateInfo {
  index: number
  name: string
  relPath: string
  format: string
  channels: number
  sampleRate: number
  durationSec: number
  bytes: number
  suggestedRole: string
}

export interface ScanInfo {
  scanId: number
  folder: string | null
  candidates: ScanCandidateInfo[]
  rejected: { name: string; reason: string }[]
  rejectedTotal: number
  truncated: boolean
}

export interface ImportedSampleInfo {
  sha: string
  name: string
  channels: number
  sampleRate: number
  durationSec: number
  suggestedRole: string
  assigned: boolean
}

export interface SlotDraftInfo {
  id: string
  role: string
  label: string
  sampleShas: string[]
  defaultSha: string
}

export interface KitDraftInfo {
  kitId: string
  label: string
  slots: SlotDraftInfo[]
}

export interface MidiNoteInfo {
  slotId: string
  label: string
  note: number
  name: string
  overridden: boolean
}

export interface ExternalChange {
  pattern: Pattern | null
  saved: boolean
  selectedSlotId: string | null
  libraryId: string | null
  kitId: string | null
}

export interface ViewInfo {
  layout: 'wide' | 'compact'
  scale: number
  /** False where the plugin cannot zoom its web view (Windows, Linux): the page zooms itself with CSS. */
  nativeZoom: boolean
}


interface BootInfo {
  view: ViewInfo | null
  version: string
  resourceRoot: string
  libraries: LibraryInfo[]
  activeLibraryId: string | null
  draft: Draft | null
  status: NativeStatus
  prefs: Partial<Prefs>
  roles: { id: string; label: string }[]
}

// ---- state mirrored from native ---------------------------------------------------------

const emptyStatus: NativeStatus = {
  kitStatus: 'idle', libraryId: null, kitId: null, pendingKitId: null, progress: { done: 0, total: 0 },
  playing: false, followingHost: false, hostSync: true, hostBpm: null, standalone: false, error: null, readySampleIds: [],
}

let status: NativeStatus = emptyStatus
let libraries: LibraryInfo[] = []
let activeLibraryId: string | null = null
let roles: { id: string; label: string }[] = []
let version = ''
let bootPromise: Promise<BootInfo> | null = null
let view: ViewInfo = { layout: 'wide', scale: DEFAULT_SCALE, nativeZoom: true }
const viewListeners = new Set<() => void>()

function applyView(v: ViewInfo) {
  view = v
  if (!v.nativeZoom) (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = String(v.scale)
  for (const fn of viewListeners) fn()
}

async function setView(patch: Partial<Pick<ViewInfo, 'layout' | 'scale'>>) {
  applyView(await call<ViewInfo>('setView', patch))
}

function stepScale(dir: -1 | 1) {
  const i = VIEW_SCALES.findIndex((s) => s >= view.scale - 1e-6)
  const at = i < 0 ? VIEW_SCALES.length - 1 : i
  const next = VIEW_SCALES[Math.min(VIEW_SCALES.length - 1, Math.max(0, at + dir))]
  if (next !== view.scale) void setView({ scale: next })
}

/** Cmd/Ctrl with + or - steps the zoom; with 0 it returns to the default. */
function zoomKeys() {
  window.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return
    if (e.key === '=' || e.key === '+') stepScale(1)
    else if (e.key === '-' || e.key === '_') stepScale(-1)
    else if (e.key === '0') void setView({ scale: DEFAULT_SCALE })
    else return
    e.preventDefault()
  })
}
const libraryListeners = new Set<() => void>()
const externalListeners = new Set<(c: ExternalChange) => void>()

/** Root of the plugin's resource provider (the page's own origin, except when the UI runs from a dev server). */
let resourceRoot = '/'
const libraryBase = (id: string | null) => (id ? `${resourceRoot}lib/${encodeURIComponent(id)}/` : null)

function reportErrors() {
  const log = (message: string) => send('log', message)
  window.addEventListener('error', (e) => log(`error: ${e.message} at ${e.filename}:${e.lineno}`))
  window.addEventListener('unhandledrejection', (e) => log(`unhandled: ${String((e.reason as Error)?.stack ?? e.reason)}`))
}

function boot(): Promise<BootInfo> {
  if (!bootPromise) {
    reportErrors()
    zoomKeys()
    bootPromise = call<BootInfo>('boot').then((b) => {
      version = b.version
      resourceRoot = b.resourceRoot.endsWith('/') ? b.resourceRoot : `${b.resourceRoot}/`
      libraries = b.libraries
      activeLibraryId = b.activeLibraryId
      roles = b.roles
      if (b.view) applyView(b.view)
      nativeTransport.applyStatus(b.status)
      nativePrefs.apply(b.prefs)
      on<{ libraries: LibraryInfo[]; activeLibraryId: string | null }>('drums:libraries', (l) => {
        libraries = l.libraries
        if (l.activeLibraryId) activeLibraryId = l.activeLibraryId
        for (const fn of libraryListeners) fn()
      })
      on<ExternalChange>('drums:external', (c) => {
        if (c.libraryId) activeLibraryId = c.libraryId
        for (const fn of externalListeners) fn(c)
      })
      return b
    })
  }
  return bootPromise
}

// ---- transport ---------------------------------------------------------------------------

class NativeTransport implements TransportApi {
  private snap: TransportSnapshot = {
    audio: 'running', kitStatus: 'idle', kitId: null, pendingKitId: null,
    progress: { done: 0, total: 0 }, playing: false, error: null, notice: null,
  }
  private listeners = new Set<() => void>()
  private kit: KitManifest | null = null
  private ready = new Set<string>()
  private step: number | null = null
  private localError: string | null = null
  private subscribed = false

  private ensureEvents() {
    if (this.subscribed) return
    this.subscribed = true
    on<NativeStatus>('drums:status', (s) => this.applyStatus(s))
    on<{ step: number }>('drums:playhead', (p) => {
      this.step = p.step >= 0 ? p.step : null
    })
  }

  applyStatus(s: NativeStatus) {
    this.ensureEvents()
    status = s
    this.ready = new Set(s.readySampleIds)
    if (this.kit && s.kitId !== this.kit.id) this.kit = null
    this.snap = {
      audio: 'running',
      kitStatus: s.kitStatus === 'missing' ? 'error' : s.kitStatus,
      kitId: s.kitStatus === 'missing' ? null : s.kitId,
      pendingKitId: s.pendingKitId,
      progress: s.progress,
      playing: s.playing,
      error: s.error ?? this.localError,
      notice: null,
      host: s.standalone ? undefined : { sync: s.hostSync, bpm: s.hostBpm },
    }
    if (!s.playing) this.step = null
    for (const l of this.listeners) l()
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getSnapshot = () => this.snap

  setOutputGain(db: number) {
    send('setOutputDb', db)
  }
  setPattern(p: PatternState) {
    send('setPattern', toPattern(p))
  }
  async selectKit(kit: KitManifest): Promise<boolean> {
    if (!activeLibraryId) return false
    try {
      await call('selectKit', { libraryId: activeLibraryId, kitId: kit.id })
      this.kit = kit
      return true
    } catch {
      return false
    }
  }
  unlock() {}
  reportError(message: string | null) {
    this.localError = message
    this.snap = { ...this.snap, error: message ?? status.error }
    for (const l of this.listeners) l()
  }
  audition(slotId: string, step: number | null = null) {
    send('audition', { slotId, step: step ?? -1 })
  }
  toggle() {
    send('transport', 'toggle')
  }
  play() {
    send('transport', 'play')
  }
  stop() {
    send('transport', 'stop')
  }
  currentStep() {
    return this.snap.playing ? this.step : null
  }
  get activeKit() {
    return this.kit
  }
  isSampleReady(s: Sample) {
    return this.ready.has(s.id)
  }
  async prepareSample(s: Sample) {
    await call('prepareSample', { sampleId: s.id })
    this.ready.add(s.id)
  }
  setPageHidden() {}
}

export const nativeTransport = new NativeTransport()

// ---- preferences ----------------------------------------------------------------------------

// Same rules as src/data/prefs.ts (not imported: that module opens IndexedDB when loaded).
const RECENTS_MAX = 8
const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
const pushRecent = (list: string[], id: string) => [id, ...list.filter((x) => x !== id)].slice(0, RECENTS_MAX)

const DEFAULT_PREFS: Prefs = { favourites: [], recents: [], arrowScope: 'all', libraryTab: 'machines', outputDb: 0 }

class NativePrefs implements PrefsApi {
  private prefs: Prefs = DEFAULT_PREFS
  private listeners = new Set<() => void>()
  loaded: Promise<void> = Promise.resolve()

  apply(p: Partial<Prefs>) {
    this.prefs = { ...DEFAULT_PREFS, ...p }
    // The offline tab does not exist in the plugin.
    if (this.prefs.libraryTab === 'offline') this.prefs.libraryTab = 'sources'
    this.emit()
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
    send('setPrefs', patch)
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
  resolve(machine: (id: string) => string, kit: (id: string) => string) {
    const favourites = [...new Set(this.prefs.favourites.map(machine))]
    const recents = [...new Set(this.prefs.recents.map(kit))]
    if (favourites.join() !== this.prefs.favourites.join() || recents.join() !== this.prefs.recents.join()) {
      this.update({ favourites, recents })
    }
  }
}

const nativePrefs = new NativePrefs()

// ---- catalog IO: files served by the plugin's resource provider -------------------------------

const nativeCatalogIO: CatalogIO = {
  fetchJson: (url) => fetch(url),
}

// ---- library and plugin functions for the Sources tab -----------------------------------------

export const native = {
  boot,
  version: () => version,
  roles: () => roles,
  status: () => status,
  libraries: () => libraries,
  activeLibraryId: () => activeLibraryId,
  onLibraries(fn: () => void) {
    libraryListeners.add(fn)
    return () => {
      libraryListeners.delete(fn)
    }
  },
  /** Changes made outside the UI: host automation, project restore, presets, a located library. */
  onExternalChange(fn: (c: ExternalChange) => void) {
    externalListeners.add(fn)
    return () => {
      externalListeners.delete(fn)
    }
  },
  async useLibrary(id: string) {
    await call('useLibrary', id)
    activeLibraryId = id
  },
  addCatalog: () => call<string | null>('addCatalog'),
  createLibrary: (name: string) => call<string>('createLibrary', name),
  linkFolder: () => call<string | null>('linkFolder'),
  removeLibrary: (id: string) => call('removeLibrary', id),
  renameLibrary: (id: string, name: string) => call('renameLibrary', { id, name }),
  relocateLibrary: (id: string) => call<{ found: number; missing: number; missingNames: string[] } | null>('relocateLibrary', id),
  checkLibrary: (id: string) => call<{ kits: number; samples: number; missing: number; changed: number; problems: string[] }>('checkLibrary', id),
  revealLibrary: (id: string) => send('revealLibrary', id),
  chooseAudio: (mode: 'files' | 'folder') => call<ScanInfo | null>('chooseAudio', mode),
  cancelScan: () => send('cancelScan'),
  importScan: (scanId: number, indices: number[], libraryId: string) =>
    call<{ imported: ImportedSampleInfo[]; failed: { name: string; reason: string }[] }>('importScan', { scanId, indices, libraryId }),
  librarySamples: (libraryId: string) => call<ImportedSampleInfo[]>('librarySamples', libraryId),
  libraryKits: (libraryId: string) => call<{ id: string; label: string }[]>('libraryKits', libraryId),
  removeSamples: (libraryId: string, shas: string[]) => call<number>('removeSamples', { libraryId, shas }),
  previewSample: (libraryId: string, sha: string) => send('previewSample', { libraryId, sha }),
  kitDraft: (libraryId: string, kitId: string) => call<KitDraftInfo>('kitDraft', { libraryId, kitId }),
  saveKit: (libraryId: string, draft: KitDraftInfo) => call<string>('saveKit', { libraryId, draft }),
  deleteKit: (libraryId: string, kitId: string) => call('deleteKit', { libraryId, kitId }),
  copyKit: (fromLibraryId: string, kitId: string, toLibraryId: string) => call<string>('copyKit', { fromLibraryId, kitId, toLibraryId }),
  midiMap: () => call<MidiNoteInfo[]>('midiMap'),
  setMidiNote: (slotId: string, note: number) => call('setMidiNote', { slotId, note }),
  resetMidiMap: () => call('resetMidiMap'),
  savePreset: () => call<boolean>('savePreset'),
  loadPreset: () => call<boolean>('loadPreset'),
  retryMissing: () => call('retryMissing'),
  findKit: (kitId: string, revision: string) => call<string | null>('findKit', { kitId, revision }),
  setHostSync: (on: boolean) => send('setHostSync', on),
  view: () => view,
  onView(fn: () => void) {
    viewListeners.add(fn)
    return () => {
      viewListeners.delete(fn)
    }
  },
  setView,
}

export type NativeApi = typeof native

// ---- platform -------------------------------------------------------------------------------

export const platform: Platform = {
  kind: 'plugin',
  transport: nativeTransport,
  catalogIO: nativeCatalogIO,
  catalogBase: () => libraryBase(activeLibraryId),
  mediaCache: null,
  prefs: nativePrefs,
  store: {
    async loadDraft() {
      return (await boot()).draft
    },
    async saveDraft(d: Draft) {
      await call('saveDraft', d)
    },
    listPatterns: () => call<Pattern[]>('listPatterns'),
    async putPattern(p: Pattern) {
      await call('putPattern', p)
    },
    async deletePattern(id: string) {
      await call('deletePattern', id)
    },
    requestPersistentStorage() {},
  },
  setMediaSession() {},
  async exportAudio(p, kit) {
    await call('exportWav', { pattern: toPattern(p), kitId: kit.id, name: p.name })
  },
  async exportMidi(p, kit) {
    await call('exportMidi', { pattern: toPattern(p), kitId: kit.id, name: p.name })
  },
  async saveText(name, text) {
    return call<boolean>('saveText', { name, text })
  },
  native,
}
