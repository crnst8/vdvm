// What the app needs from the place it runs. The browser build uses Web Audio,
// HTTP and IndexedDB (src/platform/web.ts); the plugin build talks to the
// native processor through the WebView bridge (src/platform/native.ts). The
// build picks one through the '@platform' alias (vite.config.ts, tsconfig.json).
import type { KitManifest, Pattern, Sample } from '../contract/types'
import type { CatalogIO } from '../data/catalog'
import type { Draft } from '../data/patterns'
import type { PrefsApi } from '../data/prefs'
import type { MediaCache } from '../data/cache'
import type { TransportSnapshot } from '../audio/transport'
import type { PatternState } from '../state/pattern'
import type { NativeApi } from './native'

/** The transport surface the app uses (implemented by audio/transport.ts Transport and the native bridge). */
export interface TransportApi {
  subscribe(fn: () => void): () => void
  getSnapshot(): TransportSnapshot
  setOutputGain(db: number): void
  setPattern(p: PatternState): void
  selectKit(kit: KitManifest): Promise<boolean>
  unlock(): void
  reportError(message: string | null): void
  audition(slotId: string, step?: number | null): void
  toggle(): void
  play(): void
  stop(): void
  currentStep(): number | null
  readonly activeKit: KitManifest | null
  isSampleReady(sample: Sample): boolean
  prepareSample(sample: Sample): Promise<void>
  setPageHidden(hidden: boolean): void
}

export interface PatternStoreApi {
  loadDraft(): Promise<Draft | null>
  saveDraft(d: Draft): Promise<void>
  listPatterns(): Promise<Pattern[]>
  putPattern(p: Pattern): Promise<void>
  deletePattern(id: string): Promise<void>
  requestPersistentStorage(): void
}

export interface Platform {
  readonly kind: 'web' | 'plugin'
  readonly transport: TransportApi
  readonly catalogIO: CatalogIO
  /** Base URL of the active catalog; null when the plugin has no library yet. */
  catalogBase(): string | null
  /** Encoded-media cache for offline kits (browser only). */
  readonly mediaCache: MediaCache | null
  readonly prefs: PrefsApi
  readonly store: PatternStoreApi
  setMediaSession(meta: { title: string; artist: string; album: string } | null, actions: { play: () => void; stop: () => void }): void
  /** Render one loop to WAV and hand it to the user (download or save dialog). */
  exportAudio(p: PatternState, kit: KitManifest): Promise<void>
  exportMidi(p: PatternState, kit: KitManifest): Promise<void>
  /** Save a text file (backups): download in the browser, save dialog in the plugin. */
  saveText(name: string, text: string, type: string): Promise<boolean>
  /** Plugin-only functions (libraries, imports, MIDI notes, presets); null in the browser. */
  readonly native: NativeApi | null
}
