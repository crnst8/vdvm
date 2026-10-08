// App-wide singletons, created once outside React so effect remounts cannot
// create duplicate contexts, schedulers or caches.
import { Transport } from './transport'
import { preferPlaybackSession, setBackgroundPlayback } from './session'
import { workerTimer } from './scheduler'
import { resolveCatalogUrl } from '../contract/urls'
import { CATALOG_BASE, type CatalogIO } from '../data/catalog'
import { MediaCache, fetchCatalogJson, rememberCatalogJson } from '../data/cache'

export const mediaCache = new MediaCache()

export const catalogIO: CatalogIO = { fetchJson: fetchCatalogJson, remember: rememberCatalogJson }

export const transport = new Transport({
  createContext: () => {
    preferPlaybackSession()
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    return new Ctor({ latencyHint: 'interactive' })
  },
  fetcher: (url, sha256) => mediaCache.fetch(url, sha256),
  resolveUrl: (rel) => resolveCatalogUrl(CATALOG_BASE, rel),
  onGesture: preferPlaybackSession,
  onPlayingChange: setBackgroundPlayback,
  timer: workerTimer(),
})

// Diagnostics for manual timing checks in devtools.
;(window as unknown as { __drums: unknown }).__drums = { transport, mediaCache }
