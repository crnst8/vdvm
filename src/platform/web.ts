// Browser platform: Web Audio transport, HTTP catalog with the offline media
// cache, IndexedDB patterns and preferences, downloads for exports.
import { catalogIO, mediaCache, transport } from '../audio/instance'
import { setMediaSession } from '../audio/session'
import { chosenSample } from '../audio/transport'
import { download, midiBytes, renderWav } from '../audio/export'
import { CATALOG_BASE } from '../data/catalog'
import { deletePattern, listPatterns, loadDraft, putPattern, saveDraft } from '../data/patterns'
import { requestPersistentStorage } from '../data/db'
import { prefs } from '../data/prefs'
import type { Platform } from './types'

export const platform: Platform = {
  kind: 'web',
  transport,
  catalogIO,
  catalogBase: () => CATALOG_BASE,
  mediaCache,
  prefs,
  store: { loadDraft, saveDraft, listPatterns, putPattern, deletePattern, requestPersistentStorage },
  setMediaSession,
  async exportAudio(p, kit) {
    // Snapshot buffers before rendering, so later kit changes cannot evict them mid-export.
    const buffers = new Map<string, AudioBuffer>()
    for (const slot of kit.slots) {
      const sample = chosenSample(kit, slot, p)
      if (!sample) continue
      await transport.prepareSample(sample)
      const buffer = transport.buffers?.get(sample.blobSha256)
      if (buffer) buffers.set(sample.blobSha256, buffer)
    }
    const bytes = await renderWav(p, kit, (hash) => buffers.get(hash))
    download(bytes, `${p.name}.wav`, 'audio/wav')
  },
  async exportMidi(p, kit) {
    download(midiBytes(p, kit), `${p.name}.mid`, 'audio/midi')
  },
  async saveText(name, text, type) {
    download(new TextEncoder().encode(text), name, type)
    return true
  },
  native: null,
}
