import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react'
import type { KitManifest, Pattern, Sample } from './contract/types'
import { platform } from '@platform'
import { chosenSample } from './audio/transport'
import { Catalog, kitsOf, neighbourMachine, preferredKit, shortKitLabels } from './data/catalog'
import { newId } from './data/patterns'
import { makeBackup, parseBackup, patternsToImport } from './data/backup'
import {
  bindKitState, fromPattern, isSaved, newPatternState, PAGE_SIZE, patternReducer, toPattern,
  type PatternAction, type PatternState,
} from './state/pattern'
import { demoPattern } from './state/demo'
import { Header } from './ui/Header'
import { LogoBay, type KitLoad } from './ui/LogoBay'
import { StepBank } from './ui/StepBank'
import { InstrumentStrip } from './ui/InstrumentStrip'
import { TransportBar } from './ui/TransportBar'
import { LibrarySheet } from './ui/LibrarySheet'
import { MachineSheet } from './ui/MachineSheet'
import { VolumeSheet } from './ui/VolumeSheet'
import { PitchSheet } from './ui/PitchSheet'
import { formatSemitones } from './ui/PitchKnob'
import { OutputSheet } from './ui/OutputSheet'
import { TempoSheet } from './ui/TempoSheet'
import { About } from './ui/About'
import { KitSheet } from './ui/KitSheet'
import { DesktopMixer, type MixerMode } from './ui/DesktopMixer'
import { Groove, GrooveSheet, type CircuitProps } from './ui/Groove'
import { circuitFor } from './data/timing'
import { machineSwing } from './audio/circuit'
import { SourcesTab } from './ui/library/SourcesTab'
import { addTap, emptyTaps } from './state/tapTempo'
import { clampBpm } from './state/pattern'
import { isTextTarget } from './ui/hooks'

const { transport, prefs, store, catalogIO } = platform
const { loadDraft, saveDraft, listPatterns, putPattern, deletePattern, requestPersistentStorage } = store
/** The browser's offline media cache; the plugin reads sounds from disk and has none. */
const mediaCache = platform.mediaCache
const noCache = { subscribe: () => () => {}, getSnapshot: () => 0 }

const DEFAULT_KIT_ID = 'linn-linndrum-main'
const NARROW_QUERY = '(max-width: 359.98px)'
const DESKTOP_QUERY = '(min-width: 1000px)'

type State = PatternState | null
const reducer = (s: State, a: PatternAction | { type: 'replace'; state: PatternState }): State =>
  a.type === 'replace' ? a.state : s ? patternReducer(s, a) : s

function useMedia(query: string) {
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return narrow
}

/** Resolve redirected sample IDs so saved patterns follow catalog identity merges. */
function resolvePatternIds(catalog: Catalog, p: Pattern): Pattern {
  return {
    ...p,
    kitId: catalog.kitEntry(p.kitId)?.id ?? p.kitId,
    tracks: p.tracks.map((t) => ({ ...t, sampleId: catalog.resolveSampleId(t.sampleId) })),
  }
}

export function App() {
  const snap = useSyncExternalStore(transport.subscribe, transport.getSnapshot)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const [kit, setKit] = useState<KitManifest | null>(null)
  const [pattern, dispatch] = useReducer(reducer, null)
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null)
  const [windowStart, setWindowStart] = useState(0)
  const [page, setPage] = useState(0)
  const [playStep, setPlayStep] = useState<number | null>(null)
  const [flashing, setFlashing] = useState<Set<string>>(new Set())
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [machineOpen, setMachineOpen] = useState(false)
  /** Volume sheet target: a slot, and the step it was opened from (null = the drum). */
  const [volume, setVolume] = useState<{ slotId: string; step: number | null } | null>(null)
  /** Pitch sheet target: a slot (null = overall only), the step to select, and which knob to focus. */
  const [pitch, setPitch] = useState<{ slotId: string | null; step: number | null; focus: 'overall' | 'step' } | null>(null)
  const pitchTargetRef = useRef(pitch)
  pitchTargetRef.current = pitch
  const pitchPreviewFrame = useRef<number | null>(null)
  useEffect(() => () => {
    if (pitchPreviewFrame.current !== null) cancelAnimationFrame(pitchPreviewFrame.current)
  }, [])
  /** Machine shown in details: the active kit's machine, or one picked while browsing. */
  const [detailsMachineId, setDetailsMachineId] = useState<string | null>(null)
  /** Machines visited inside the details sheet, for its Back button. */
  const [detailsTrail, setDetailsTrail] = useState<string[]>([])
  const [tempoOpen, setTempoOpen] = useState(false)
  const [kitsOpen, setKitsOpen] = useState(false)
  const [grooveOpen, setGrooveOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [outputOpen, setOutputOpen] = useState(false)
  /** Steps as they were before the header bin cleared them; undoable until the next edit or timeout. */
  const [cleared, setCleared] = useState<{ id: string; edits: number; steps: Record<string, boolean[]> } | null>(null)
  /** Search handed to the library's machine list; the counter remounts the tab so it applies. */
  const [machineQuery, setMachineQuery] = useState({ text: '', n: 0 })
  const keyTaps = useRef(emptyTaps())
  const userPrefs = useSyncExternalStore(prefs.subscribe, prefs.getSnapshot)
  const favourites = useMemo(() => new Set(userPrefs.favourites), [userPrefs.favourites])
  useEffect(() => transport.setOutputGain(userPrefs.outputDb), [userPrefs.outputDb])
  const [patterns, setPatterns] = useState<Pattern[]>([])
  const [storageError, setStorageError] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ label: string; run: () => void } | null>(null)
  const [backupNote, setBackupNote] = useState<string | null>(null)
  const [kitRequest, setKitRequest] = useState<string | null>(null)
  const cacheVersion = useSyncExternalStore((mediaCache ?? noCache).subscribe, (mediaCache ?? noCache).getSnapshot)
  const [offlineSaving, setOfflineSaving] = useState<{ done: number; total: number } | null>(null)
  const [offlineError, setOfflineError] = useState<string | null>(null)
  const [budget, setBudget] = useState<number | null>(null)
  const narrow = useMedia(NARROW_QUERY)
  const desktop = useMedia(DESKTOP_QUERY)
  const [mixer, setMixer] = useState<MixerMode | null>(null)
  const lastMixer = useRef<MixerMode>('drums')
  const [exporting, setExporting] = useState(false)
  const [tileCapacity, setTileCapacity] = useState(5)
  const visibleTiles = desktop ? tileCapacity : Math.min(narrow ? 3 : 5, tileCapacity)
  const bootStarted = useRef(false)

  const patternRef = useRef<PatternState | null>(null)
  patternRef.current = pattern
  useEffect(() => {
    if (pattern) transport.setPattern(pattern)
  }, [pattern])

  // ---- boot ------------------------------------------------------------------
  const boot = useCallback(async () => {
    setBootError(null)
    // Plugin: the processor may hold a project whose library is not on this computer.
    let missing: string | null = null
    if (platform.native) {
      try {
        const info = await platform.native.boot()
        missing = info.status.kitStatus === 'missing' ? info.status.error : null
      } catch (e) {
        setBootError((e as Error).message)
        return
      }
    }
    const base = platform.catalogBase()
    if (base === null) {
      // Plugin with no library yet (unbundled first run, or a missing project library): start in Sources.
      setBootError(missing ?? 'No sample library.')
      prefs.setLibraryTab('sources')
      setLibraryOpen(true)
      return
    }
    let cat: Catalog
    try {
      cat = await Catalog.load(base, catalogIO)
    } catch (e) {
      setBootError((e as Error).message)
      return
    }
    setCatalog(cat)
    // Stored favourites and recents follow catalog identity merges.
    void prefs.loaded.then(() => prefs.resolve((id) => cat.machine(id)?.id ?? id, (id) => cat.kitEntry(id)?.id ?? id))
    let draft = null
    try {
      draft = await loadDraft()
      setPatterns(await listPatterns())
    } catch (e) {
      setStorageError((e as Error).message)
    }
    if (missing && draft) {
      // Keep the saved pattern exactly as it is until its library is located or another kit is chosen.
      dispatch({ type: 'replace', state: fromPattern(draft.pattern, draft.saved) })
      setBootError(missing)
      prefs.setLibraryTab('sources')
      setLibraryOpen(true)
      return
    }
    const wantedKit = (draft && cat.kitEntry(draft.pattern.kitId)?.id) ?? cat.kitEntry(DEFAULT_KIT_ID)?.id ?? cat.index.kits[0]?.id
    if (!wantedKit) {
      setBootError('The catalog has no kits.')
      if (platform.native) {
        prefs.setLibraryTab('sources')
        setLibraryOpen(true)
      }
      return
    }
    let k: KitManifest
    try {
      k = await cat.loadKit(wantedKit)
    } catch (e) {
      setBootError((e as Error).message)
      return
    }
    let state = draft ? bindKitState(fromPattern(resolvePatternIds(cat, draft.pattern), draft.saved), k) : newPatternState(k, newId())
    if (draft && draft.pattern.kitId !== k.id) state = bindKitState(state, k)
    transport.setPattern(state)
    dispatch({ type: 'replace', state })
    setKit(k)
    setSelectedSlotId(draft?.selectedSlotId && k.slots.some((s) => s.id === draft.selectedSlotId) ? draft.selectedSlotId : k.slots[0].id)
    await transport.selectKit(k)
  }, [])

  useEffect(() => {
    if (bootStarted.current) return
    bootStarted.current = true
    void boot()
  }, [boot])

  // ---- autosave draft ----------------------------------------------------------
  /** Draft write still waiting for the debounce; flushed at once when the page is hidden. */
  const pendingDraft = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!pattern) return
    const write = () => {
      pendingDraft.current = null
      saveDraft({ pattern: toPattern(pattern), saved: isSaved(pattern), selectedSlotId }).catch((e) =>
        setStorageError((e as Error).message),
      )
    }
    pendingDraft.current = write
    const t = window.setTimeout(write, 300)
    return () => window.clearTimeout(t)
  }, [pattern, selectedSlotId])

  // ---- playhead (animation frames read the audio clock; they never drive sound) ----
  useEffect(() => {
    if (!snap.playing) {
      setPlayStep(null)
      setFlashing(new Set())
      return
    }
    let raf = 0
    let last: number | null = null
    const loop = () => {
      const step = transport.currentStep()
      if (step !== last) {
        last = step
        setPlayStep(step)
        const p = patternRef.current
        const k = transport.activeKit
        if (p && k && step !== null) {
          setFlashing(new Set(k.slots.filter((s) => p.tracks[s.id]?.steps[step]).map((s) => s.id)))
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [snap.playing])

  // ---- page visibility / audio unlock ------------------------------------------
  useEffect(() => {
    // Playback continues while hidden or locked; the draft is written before the page may be frozen or closed.
    const onVis = () => {
      const hidden = document.visibilityState === 'hidden'
      if (hidden) pendingDraft.current?.()
      transport.setPageHidden(hidden)
    }
    const onHide = () => pendingDraft.current?.()
    const unlock = () => transport.unlock()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', onHide)
    document.addEventListener('pointerdown', unlock, { capture: true })
    document.addEventListener('keydown', unlock, { capture: true })
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('pointerdown', unlock, { capture: true })
      document.removeEventListener('keydown', unlock, { capture: true })
    }
  }, [])

  // ---- actions -------------------------------------------------------------------
  const slots = kit?.slots ?? []
  const selectedSlot = slots.find((s) => s.id === selectedSlotId) ?? slots[0] ?? null
  const track = pattern && selectedSlot ? pattern.tracks[selectedSlot.id] : null
  const selectedTrackHasPitch = !!(pattern && selectedSlot && pattern.tracks[selectedSlot.id]?.stepPitchCents.some((c) => c !== 0))

  const missing = useMemo(() => {
    const out = new Set<string>()
    if (!pattern || !kit) return out
    for (const s of kit.slots) {
      const t = pattern.tracks[s.id]
      if (t && !s.sampleIds.includes(t.sampleId)) out.add(s.id)
    }
    return out
  }, [pattern, kit])

  // The pitch sheet closes on pattern load/new or kit change, and if its slot disappears.
  useEffect(() => { setPitch(null) }, [pattern?.id, kit?.id])
  useEffect(() => {
    setPitch((cur) => (cur && cur.slotId && !slots.some((s) => s.id === cur.slotId) ? null : cur))
  }, [slots])

  const toggleStep = useCallback(
    (step: number) => {
      const p = patternRef.current
      if (!p || !selectedSlot) return
      const wasOn = p.tracks[selectedSlot.id]?.steps[step]
      dispatch({ type: 'toggleStep', slotId: selectedSlot.id, step, sampleId: selectedSlot.defaultSampleId })
      if (!wasOn && !transport.getSnapshot().playing) transport.audition(selectedSlot.id)
    },
    [selectedSlot],
  )

  const openVolume = (slotId: string, step: number | null) => {
    const p = patternRef.current
    const slot = kit?.slots.find((s) => s.id === slotId)
    if (!p || !slot) return
    // Holding an off step switches it on, so the level being set is audible.
    if (step !== null && !p.tracks[slotId]?.steps[step]) {
      dispatch({ type: 'toggleStep', slotId, step, sampleId: slot.defaultSampleId })
    }
    setSelectedSlotId(slotId)
    setVolume({ slotId, step })
  }

  /** Open the pitch sheet for a slot and step; a step opens focused on that step's knob. */
  const openPitch = (slotId: string | null, step: number | null) => {
    setPitch({ slotId, step, focus: step === null ? 'overall' : 'step' })
  }

  const openPitchFromPanel = () => {
    if (!selectedSlot) return
    // The per-step editor starts on the first step of the visible page (desktop shows all 16: step 0).
    setPitch({ slotId: selectedSlot.id, step: desktop ? 0 : page * PAGE_SIZE, focus: 'overall' })
  }

  const editPitchFromVolume = () => {
    const v = volume
    if (!v) return
    setVolume(null)
    openPitch(v.slotId, v.step)
  }

  const selectSlot = (slotId: string) => {
    setSelectedSlotId(slotId)
    transport.audition(slotId)
  }

  const pageInstruments = (dir: -1 | 1) => {
    const max = Math.max(0, slots.length - visibleTiles)
    setWindowStart((s) => Math.min(max, Math.max(0, s + dir * visibleTiles)))
  }

  // Keep the selected tile inside the visible window when the window size or kit changes.
  useEffect(() => {
    const idx = slots.findIndex((s) => s.id === selectedSlot?.id)
    const max = Math.max(0, slots.length - visibleTiles)
    setWindowStart((s) => {
      let next = Math.min(s, max)
      if (idx >= 0 && (idx < next || idx >= next + visibleTiles)) next = Math.min(max, Math.max(0, idx - visibleTiles + 1))
      return next
    })
  }, [visibleTiles, kit])

  /** Latest requested kit; older requests that finish later are dropped. */
  const latestKitRequest = useRef<string | null>(null)

  const switchKit = async (kitId: string, then?: (k: KitManifest) => PatternState, from: Catalog | null = catalog) => {
    const catalog = from
    if (!catalog) return false
    latestKitRequest.current = kitId
    setKitRequest(kitId)
    let k: KitManifest
    try {
      k = await catalog.loadKit(kitId)
    } catch (e) {
      if (latestKitRequest.current !== kitId) return false
      latestKitRequest.current = null
      setKitRequest(null)
      setBootError(null)
      transport.reportError((e as Error).message)
      return false
    }
    if (latestKitRequest.current !== kitId) return false
    // Let the transport prepare the chosen samples of the pattern that will be active.
    const next = then ? then(k) : null
    if (next) transport.setPattern(next)
    const ok = await transport.selectKit(k)
    setKitRequest((cur) => (cur === kitId ? null : cur))
    if (latestKitRequest.current === kitId) latestKitRequest.current = null
    if (!ok) {
      if (next && patternRef.current) transport.setPattern(patternRef.current)
      return false
    }
    if (next) dispatch({ type: 'replace', state: next })
    else if (patternRef.current) dispatch({ type: 'bindKit', kit: k })
    else {
      // First kit of a session that started without one (plugin with no library yet): start a pattern.
      const fresh = newPatternState(k, newId())
      transport.setPattern(fresh)
      dispatch({ type: 'replace', state: fresh })
    }
    setKit(k)
    prefs.addRecent(k.id)
    setSelectedSlotId((cur) => (cur && k.slots.some((s) => s.id === cur) ? cur : k.slots[0].id))
    return true
  }

  // ---- plugin libraries -------------------------------------------------------------
  const catalogRef = useRef<Catalog | null>(null)
  catalogRef.current = catalog

  /** Plugin: make another library the one the panel browses, and load its preferred kit (or `kitId`). */
  const openLibrary = async (libraryId: string, kitId?: string) => {
    const n = platform.native
    if (!n) return
    try {
      await n.useLibrary(libraryId)
      const cat = await Catalog.load(platform.catalogBase()!, catalogIO)
      setCatalog(cat)
      setBootError(null)
      const target = kitId ?? cat.index.kits.find((k) => userPrefs.recents.includes(k.id))?.id ?? cat.index.kits[0]?.id
      if (target) await switchKit(target, undefined, cat)
    } catch (e) {
      transport.reportError((e as Error).message)
    }
  }

  /** Plugin: a user kit was created or edited; reread its library and play it. */
  const kitSaved = (libraryId: string, kitId: string) => openLibrary(libraryId, kitId)

  // Plugin: the processor changed state on its own (host automation, project restore, preset, located library).
  useEffect(() => {
    const n = platform.native
    if (!n) return
    return n.onExternalChange(async (c) => {
      if (!c.pattern || !c.kitId) return
      try {
        let cat = catalogRef.current
        const base = platform.catalogBase()
        if (!cat || (base && cat.base !== base) || !cat.kitEntry(c.kitId)) {
          cat = await Catalog.load(base!, catalogIO)
          setCatalog(cat)
        }
        const k = await cat.loadKit(c.kitId)
        const state = bindKitState(fromPattern(c.pattern, c.saved), k)
        dispatch({ type: 'replace', state })
        setKit(k)
        setSelectedSlotId((cur) => (c.selectedSlotId && k.slots.some((s) => s.id === c.selectedSlotId) ? c.selectedSlotId : cur && k.slots.some((s) => s.id === cur) ? cur : k.slots[0].id))
        setBootError(null)
        await transport.selectKit(k)
      } catch (e) {
        transport.reportError((e as Error).message)
      }
    })
  }, [])

  const refreshPatterns = async () => {
    try {
      setPatterns(await listPatterns())
    } catch (e) {
      setStorageError((e as Error).message)
    }
  }

  const save = async () => {
    const p = patternRef.current
    if (!p) return
    requestPersistentStorage()
    try {
      await putPattern(toPattern(p))
      dispatch({ type: 'markSaved' })
      await refreshPatterns()
    } catch (e) {
      setStorageError((e as Error).message)
    }
  }

  const exportBackup = () => {
    const b = makeBackup(patterns, userPrefs.favourites)
    const day = b.exportedAt.slice(0, 10)
    void platform.saveText(`V.D.V.M-backup-${day}.json`, JSON.stringify(b, null, 1), 'application/json').then(
      (saved) => saved && setBackupNote(`Exported ${patterns.length} pattern${patterns.length === 1 ? '' : 's'}.`),
      (e) => setBackupNote((e as Error).message),
    )
  }

  const importBackup = async (file: File) => {
    try {
      const b = parseBackup(await file.text())
      const fresh = patternsToImport(await listPatterns(), b.patterns)
      for (const p of fresh) await putPattern(p)
      prefs.addFavourites(catalog ? b.favourites.map((id) => catalog.machine(id)?.id ?? id) : b.favourites)
      requestPersistentStorage()
      await refreshPatterns()
      setBackupNote(`Imported ${fresh.length} of ${b.patterns.length} pattern${b.patterns.length === 1 ? '' : 's'}${fresh.length < b.patterns.length ? ' (the rest were already here)' : ''}.`)
    } catch (e) {
      setBackupNote((e as Error).message)
    }
  }

  const loadPattern = async (saved: Pattern, asSaved: boolean, newIdentity = false) => {
    if (!catalog) return
    const p = resolvePatternIds(catalog, newIdentity ? { ...saved, id: newId() } : saved)
    const make = (k: KitManifest) => bindKitState(fromPattern(p, asSaved), k)
    const entry = catalog.kitEntry(p.kitId)
    if (!entry) {
      transport.reportError(`Pattern "${p.name}" uses kit ${p.kitId}, which is not in this catalog.`)
      return
    }
    if (kit && entry.id === kit.id) {
      const next = make(kit)
      transport.setPattern(next)
      dispatch({ type: 'replace', state: next })
      // Decode any non-default variants the pattern uses before they are due.
      for (const slot of kit.slots) {
        const s = chosenSample(kit, slot, next)
        if (s && !transport.isSampleReady(s)) void transport.prepareSample(s).catch(() => {})
      }
    } else {
      await switchKit(entry.id, make)
    }
    setLibraryOpen(false)
  }

  const newPattern = () => {
    if (!kit) return
    const next = newPatternState(kit, newId())
    transport.setPattern(next)
    dispatch({ type: 'replace', state: next })
    setLibraryOpen(false)
  }

  const duplicate = async (p: Pattern) => {
    try {
      await putPattern({ ...p, id: newId(), name: `${p.name} COPY`.slice(0, 64), updatedAt: new Date().toISOString() })
      await refreshPatterns()
    } catch (e) {
      setStorageError((e as Error).message)
    }
  }

  const remove = async (p: Pattern) => {
    try {
      await deletePattern(p.id)
      await refreshPatterns()
      if (patternRef.current?.id === p.id) {
        // The working copy no longer has a saved version.
        dispatch({ type: 'replace', state: { ...patternRef.current, savedEdits: null } })
      }
      setUndo({
        label: `Deleted ${p.name}.`,
        run: async () => {
          setUndo(null)
          await putPattern(p).catch((e) => setStorageError((e as Error).message))
          await refreshPatterns()
        },
      })
    } catch (e) {
      setStorageError((e as Error).message)
    }
  }

  const clearPattern = () => {
    const p = patternRef.current
    if (!p) return
    const steps: Record<string, boolean[]> = {}
    for (const [id, t] of Object.entries(p.tracks)) steps[id] = t.steps
    dispatch({ type: 'clear' })
    // 'clear' counts as one edit; any later edit retires the undo.
    setCleared({ id: p.id, edits: p.edits + 1, steps })
  }
  const clearUndoable = !!cleared && !!pattern && pattern.id === cleared.id && pattern.edits === cleared.edits
  const undoClear = () => {
    const p = patternRef.current
    if (!p || !cleared) return
    const tracks = { ...p.tracks }
    for (const [id, steps] of Object.entries(cleared.steps)) if (tracks[id]) tracks[id] = { ...tracks[id], steps }
    dispatch({ type: 'replace', state: { ...p, tracks, edits: p.edits + 1 } })
    setCleared(null)
  }
  useEffect(() => {
    if (!cleared) return
    const t = window.setTimeout(() => setCleared(null), 6000)
    return () => window.clearTimeout(t)
  }, [cleared])

  useEffect(() => {
    if (!undo) return
    const t = window.setTimeout(() => setUndo(null), 10000)
    return () => window.clearTimeout(t)
  }, [undo])

  const chooseSample = async (s: Sample, slotId = selectedSlot?.id) => {
    if (!slotId) return
    try {
      await transport.prepareSample(s)
    } catch (e) {
      transport.reportError(`Could not load that sound: ${(e as Error).message}`)
      return
    }
    dispatch({ type: 'setSample', slotId, sampleId: s.id })
    // Audition after the reducer update reaches the transport.
    requestAnimationFrame(() => transport.audition(slotId))
  }

  // ---- offline -------------------------------------------------------------------
  useEffect(() => {
    if (libraryOpen && mediaCache) void mediaCache.budget().then(setBudget)
  }, [libraryOpen, cacheVersion])

  const saveOffline = async () => {
    if (!kit || !catalog || !pattern || !mediaCache) return
    setOfflineError(null)
    const urls = new Map<string, string>()
    for (const slot of kit.slots) {
      // Default sounds plus any variant the current pattern uses; not every variant.
      for (const id of new Set([slot.defaultSampleId, pattern.tracks[slot.id]?.sampleId])) {
        const s = kit.samples.find((x) => x.id === id)
        if (s) urls.set(catalog.url(s.url), s.blobSha256)
      }
    }
    const m = catalog.machine(kit.machineId)
    for (const art of [m?.logo, m?.photo]) if (art) urls.set(catalog.url(art.url), art.sha256)
    const entry = catalog.kitEntry(kit.id)!
    setOfflineSaving({ done: 0, total: urls.size })
    try {
      await mediaCache.saveKitOffline(
        {
          kitId: kit.id,
          revision: kit.revision,
          label: kit.label,
          entries: [...urls].map(([url, sha256]) => ({ url, sha256 })),
          catalogUrls: [catalog.url('catalog/index.json'), catalog.url(entry.url), catalog.url(catalog.index.creditsUrl)],
        },
        (done, total) => setOfflineSaving({ done, total }),
      )
    } catch (e) {
      setOfflineError((e as Error).message)
    } finally {
      setOfflineSaving(null)
    }
  }

  const savedKitIds = useMemo(
    () => new Set(mediaCache?.offlineKits().filter((k) => k.verified).map((k) => k.kitId) ?? []),
    [cacheVersion],
  )

  const loadingKitId = snap.kitStatus === 'loading' ? snap.pendingKitId : kitRequest
  // Load line under the maker logo: manifest fetch (indeterminate), sample decode (fraction), then queued for the next bar.
  const kitLoad: KitLoad | null =
    snap.kitStatus === 'loading'
      ? { phase: 'decode', fraction: snap.progress.total ? snap.progress.done / snap.progress.total : 0 }
      : snap.pendingKitId
        ? { phase: 'queued', fraction: 1 }
        : kitRequest || !catalog
          ? { phase: 'fetch', fraction: 0 }
          : null

  function openMachineDetails(machineId: string) {
    setDetailsMachineId(machineId)
    setDetailsTrail([])
    setMachineOpen(true)
  }

  // ---- machine arrows and kit keys --------------------------------------------------
  // Step from the machine most recently asked for, so repeated presses keep moving while one loads.
  const cursorKitId = kitRequest ?? kit?.id ?? null
  const cursorMachineId = (cursorKitId && catalog?.kitEntry(cursorKitId)?.machineId) ?? kit?.machineId ?? null
  const arrowFilter =
    userPrefs.arrowScope === 'favourites' && favourites.size > 0 ? (m: { id: string }) => favourites.has(m.id) : undefined
  const prevMachine = catalog && cursorMachineId ? neighbourMachine(catalog.index, cursorMachineId, -1, arrowFilter) : null
  const nextMachine = catalog && cursorMachineId ? neighbourMachine(catalog.index, cursorMachineId, 1, arrowFilter) : null
  const kitName = (e: { machineId: string; label: string }) => {
    const m = catalog?.machine(e.machineId)
    if (!m || m.displayName.includes(e.label)) return m?.displayName ?? e.label
    return `${m.displayName}, ${e.label}`
  }
  function stepMachine(dir: -1 | 1) {
    if (!catalog) return
    const fromKit = latestKitRequest.current ?? kit?.id
    const from = (fromKit && catalog.kitEntry(fromKit)?.machineId) ?? kit?.machineId
    const target = from ? neighbourMachine(catalog.index, from, dir, arrowFilter) : null
    const k = target ? preferredKit(catalog.index, target.id, userPrefs.recents) : null
    if (k) void switchKit(k.id)
  }
  // Kit keys under the logo: the shown machine's kits (follows the pending request while loading).
  const keysMachine = cursorMachineId ? (catalog?.machine(cursorMachineId) ?? null) : null
  const machineKits = useMemo(() => {
    if (!catalog || !keysMachine) return []
    const kits = kitsOf(catalog.index, keysMachine.id)
    const labels = shortKitLabels(keysMachine, kits)
    return kits.map((k) => ({ id: k.id, label: labels.get(k.id) ?? k.label, full: k.label }))
  }, [catalog, keysMachine])

  // ---- keyboard ----------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape' && mixer && !document.querySelector('dialog[open]')) {
        setMixer(null)
        requestAnimationFrame(() => document.getElementById('mixer-open-button')?.focus())
        return
      }
      if (isTextTarget(e.target) || document.querySelector('dialog[open]')) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (transport.activeKit) transport.toggle()
      } else if ((e.key === 'v' || e.key === 'V') && selectedSlot) {
        e.preventDefault()
        openVolume(selectedSlot.id, null)
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        const r = addTap(keyTaps.current, e.timeStamp, clampBpm)
        keyTaps.current = r.state
        if (r.bpm !== null) dispatch({ type: 'setBpm', bpm: r.bpm })
      } else if ((e.key === 'f' || e.key === 'F') && kit) {
        e.preventDefault()
        prefs.toggleFavourite(kit.machineId)
      } else if (e.key === '[' || e.key === ']') {
        e.preventDefault()
        stepMachine(e.key === '[' ? -1 : 1)
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault()
        dispatch({ type: 'setLength', length: patternRef.current?.length === 8 ? 16 : 8 })
      } else if (/^Digit[1-8]$/.test(e.code)) {
        // Phones: 1–8 edit the visible page. Desktop: 1–8 are steps 1–8, Shift+1–8 steps 9–16.
        e.preventDefault()
        const n = Number(e.code.slice(5)) - 1
        toggleStep(desktop ? n + (e.shiftKey ? PAGE_SIZE : 0) : page * PAGE_SIZE + n)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // openVolume only reads refs and stable setters besides kit/selectedSlot.
  }, [page, desktop, mixer, toggleStep, selectedSlot, kit, catalog, userPrefs])

  // ---- status line -----------------------------------------------------------------
  const machine = kit && catalog ? catalog.machine(kit.machineId) ?? null : null

  // Lock-screen / media-key controls name the pattern and machine.
  const nowPlaying = pattern && kit ? `${pattern.name}\n${machine ? `${machine.manufacturer} ${machine.model}` : ''}\n${kit.label}` : null
  useEffect(() => {
    const [title, artist, album] = nowPlaying?.split('\n') ?? []
    platform.setMediaSession(nowPlaying ? { title, artist, album } : null, { play: () => transport.play(), stop: () => transport.stop() })
  }, [nowPlaying])
  let status: string | null = null
  let statusKind: 'info' | 'error' | 'loading' = 'info'
  let retry: (() => void) | null = null
  if (bootError) {
    status = bootError
    statusKind = 'error'
    retry = platform.native
      ? () => {
          prefs.setLibraryTab('sources')
          setLibraryOpen(true)
        }
      : () => void boot()
  } else if (snap.error) {
    status = snap.error
    statusKind = 'error'
    const id = snap.pendingKitId ?? kitRequest
    retry = id ? () => void switchKit(id) : kit ? () => void transport.selectKit(kit) : null
  } else if (snap.kitStatus === 'loading') {
    const label = catalog?.kitEntry(snap.pendingKitId ?? '')?.label ?? 'kit'
    status = `Loading ${label} ${snap.progress.done}/${snap.progress.total}`
    statusKind = 'loading'
  } else if (snap.notice) {
    status = snap.notice
  } else if (!catalog) {
    status = 'Loading catalog'
    statusKind = 'loading'
  } else if (snap.audio !== 'running' && snap.kitStatus === 'ready') {
    status = 'Ready. Tap any key to switch on audio.'
  }

  const circuit: CircuitProps | undefined = (() => {
    const profile = circuitFor(kit?.machineId)
    if (!profile || !pattern || !kit) return undefined
    const src = profile.jitter?.source ?? profile.swing?.source
    const steps = profile.swing?.grids[pattern.swingGrid]
    const plays = pattern.swing > 50 && steps ? machineSwing(pattern.swing, steps) : null
    return {
      on: pattern.circuit,
      machine: machine?.displayName ?? kit.label,
      summary: profile.summary,
      source: src ? src.title : '',
      plays: plays !== null && Math.abs(plays - pattern.swing) > 1e-6 ? plays : null,
      onToggle: () => dispatch({ type: 'setCircuit', circuit: !pattern.circuit }),
    }
  })()
  const cycleKit = () => {
    if (machineKits.length < 2) return
    const current = loadingKitId ?? kit?.id
    const at = machineKits.findIndex((k) => k.id === current)
    void switchKit(machineKits[(at + 1) % machineKits.length].id)
  }

  const playingHalf = playStep === null ? null : playStep < PAGE_SIZE ? 0 : 1
  const visiblePlayStep = playStep !== null && Math.floor(playStep / PAGE_SIZE) === page ? playStep : null

  const pitchSlot = pitch && kit ? kit.slots.find((s) => s.id === pitch.slotId) ?? null : null
  const pitchTrack = pitch?.slotId && pattern ? pattern.tracks[pitch.slotId] ?? null : null
  const pitchMissing = !!(pitch?.slotId && missing.has(pitch.slotId))
  const pitchReady = (() => {
    if (!pitch?.slotId || !kit || !pattern) return false
    const slot = kit.slots.find((s) => s.id === pitch.slotId)
    if (!slot) return false
    const s = chosenSample(kit, slot, pattern)
    return !!s && transport.isSampleReady(s)
  })()
  let pitchAuditionNote: string | null = null
  if (pitchMissing) pitchAuditionNote = 'The saved sound is missing from this kit.'
  else if (!pitchReady) pitchAuditionNote = 'Sound still loading.'
  else if (pitchTrack?.gainDb === -Infinity) pitchAuditionNote = 'This instrument is muted; audition is silent.'

  const exportAudio = async () => {
    const p = patternRef.current
    if (!p || !kit || exporting) return
    setExporting(true)
    try {
      await platform.exportAudio(p, kit)
    } catch (e) {
      transport.reportError(`Audio export failed: ${(e as Error).message}`)
    } finally { setExporting(false) }
  }

  return (
    <main className={`panel${desktop && mixer ? ' panel--mixer' : ''}`}>
      <Header
        desktop={desktop}
        canExport={!!pattern && !!kit && snap.kitId === kit.id && !loadingKitId}
        exporting={exporting}
        onMidi={() => {
          if (pattern && kit) platform.exportMidi(pattern, kit).catch((e) => transport.reportError(`MIDI export failed: ${(e as Error).message}`))
        }}
        onAudio={() => void exportAudio()}
        name={pattern?.name ?? 'UNTITLED'}
        saved={pattern ? isSaved(pattern) : false}
        onLibrary={() => setLibraryOpen(true)}
        onRename={(name) => dispatch({ type: 'rename', name })}
        onSave={() => void save()}
        canClear={!!pattern && Object.values(pattern.tracks).some((t) => t.steps.some(Boolean))}
        onClear={clearPattern}
        onUndoClear={clearUndoable ? undoClear : null}
        onAbout={() => setAboutOpen(true)}
        outputDb={userPrefs.outputDb}
        onOutput={() => setOutputOpen(true)}
      />
      <hr className="rule rule--single" />
      <LogoBay
        desktop={desktop}
        onLibrary={() => setLibraryOpen(true)}
        onAbout={() => setAboutOpen(true)}
        resolve={(rel) => catalog?.url(rel) ?? rel}
        prevLabel={prevMachine?.displayName ?? null}
        nextLabel={nextMachine?.displayName ?? null}
        onPrev={() => stepMachine(-1)}
        onNext={() => stepMachine(1)}
        kits={machineKits}
        activeKitId={kit?.id ?? null}
        loadingKitId={loadingKitId}
        load={kitLoad}
        onOpenKits={() => setKitsOpen(true)}
        onCycleKit={cycleKit}
        swing={pattern?.swing ?? 50}
        onOpenGroove={() => setGrooveOpen(true)}
        circuit={circuit}
        favourite={!!machine && favourites.has(machine.id)}
        onToggleFavourite={() => machine && prefs.toggleFavourite(machine.id)}
        machine={machine}
        logoUrl={machine?.logo && catalog ? catalog.url(machine.logo.url) : null}
        status={status}
        statusKind={statusKind}
        onRetry={retry}
        onDetails={() => {
          setDetailsMachineId(null)
          setDetailsTrail([])
          setMachineOpen(true)
        }}
      />
      <div className="rule rule--stack" aria-hidden="true" />
      <StepBank
        desktop={desktop}
        steps={track?.steps ?? new Array(16).fill(false)}
        page={page}
        playStep={desktop ? playStep : visiblePlayStep}
        trackLabel={selectedSlot?.label ?? 'no instrument'}
        silent={!!selectedSlot && missing.has(selectedSlot.id)}
        loopLength={pattern?.length ?? 16}
        onToggle={toggleStep}
        onHoldStep={(step) => selectedSlot && openVolume(selectedSlot.id, step)}
      />
      <div className="rule rule--stack" aria-hidden="true" />
      <InstrumentStrip
        desktop={desktop}
        slots={slots}
        selectedId={selectedSlot?.id ?? null}
        start={windowStart}
        visible={visibleTiles}
        onCapacity={setTileCapacity}
        missing={missing}
        flashing={flashing}
        onSelect={selectSlot}
        onHold={(slotId) => openVolume(slotId, null)}
        onPage={pageInstruments}
      />
      <div className="pitch-row">
        <button
          type="button"
          id="pitch-button"
          className="pitch-key"
          disabled={!pattern}
          aria-haspopup="dialog"
          aria-label={`Pitch${selectedTrackHasPitch ? ', selected instrument has step pitch offsets' : ''}. Overall ${formatSemitones(pattern?.pitchCents ?? 0)}`}
          onClick={openPitchFromPanel}
        >
          <span className="pitch-key__label">PITCH</span>
          <span className="pitch-key__value">{formatSemitones(pattern?.pitchCents ?? 0)}</span>
          {selectedTrackHasPitch && <span className="pitch-key__badge">STEPS</span>}
        </button>
      </div>
      <div className="rule rule--stack rule--short" aria-hidden="true" />
      {desktop && <>
        <DesktopMixer
          open={mixer !== null}
          mode={mixer ?? 'drums'}
          slots={slots.slice(windowStart, windowStart + visibleTiles)}
          tracks={pattern?.tracks ?? {}}
          selected={selectedSlot}
          loopLength={pattern?.length ?? 16}
          playing={snap.playing}
          onOpen={() => setMixer(lastMixer.current)}
          onMode={(mode) => {
            lastMixer.current = mode
            setMixer(mode)
          }}
          onClose={() => {
            setMixer(null)
            requestAnimationFrame(() => document.getElementById('mixer-open-button')?.focus())
          }}
          onGain={(slotId, gainDb) => dispatch({ type: 'setTrackGain', slotId, gainDb })}
          onLevel={(step, level) => selectedSlot && dispatch({ type: 'setStepLevel', slotId: selectedSlot.id, step, level })}
          onToggle={toggleStep}
          onAudition={(slotId, step) => transport.audition(slotId, step)}
        />
        {mixer === null && <Groove
          swing={pattern?.swing ?? 50}
          grid={pattern?.swingGrid ?? 16}
          onSwing={(swing) => dispatch({ type: 'setSwing', swing })}
          onGrid={(grid) => dispatch({ type: 'setSwingGrid', grid })}
          circuit={circuit}
        />}
      </>}
      <TransportBar
        bpm={pattern?.bpm ?? 120}
        page={page}
        playingHalf={playingHalf}
        playing={snap.playing}
        canPlay={!!kit && snap.kitId !== null}
        onNudge={(delta) => dispatch({ type: 'nudgeBpm', delta })}
        onOpenTempo={() => setTempoOpen(true)}
        onPage={() => setPage((p) => 1 - p)}
        loopLength={pattern?.length ?? 16}
        onLoop={() => dispatch({ type: 'setLength', length: pattern?.length === 8 ? 16 : 8 })}
        onToggle={() => transport.toggle()}
        tempoSource={snap.host && platform.native ? {
          host: snap.host.sync,
          hostBpm: snap.host.bpm,
          onToggle: () => platform.native?.setHostSync(!snap.host?.sync),
        } : undefined}
      />
      <LibrarySheet
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        tab={userPrefs.libraryTab}
        onTab={prefs.setLibraryTab}
        machines={
          catalog
            ? {
                index: catalog.index,
                resolve: (rel) => catalog.url(rel),
                activeKitId: kit?.id ?? null,
                loadingKitId,
                progress: snap.progress,
                favourites,
                recents: userPrefs.recents,
                savedKitIds,
                arrowScope: userPrefs.arrowScope,
                onArrowScope: prefs.setArrowScope,
                onSelectKit: (id) => void switchKit(id),
                onToggleFavourite: prefs.toggleFavourite,
                onDetails: openMachineDetails,
                initialQuery: machineQuery.text,
                key: machineQuery.n,
              }
            : null
        }
        patterns={{
          index: catalog?.index ?? null,
          patterns,
          demo: catalog?.kitEntry('linn-linndrum-main') ? demoPattern(catalog.kitEntry('linn-linndrum-main')!.revision) : null,
          currentId: pattern?.id ?? '',
          currentName: pattern?.name ?? '',
          saved: pattern ? isSaved(pattern) : false,
          storageError,
          undo,
          onSave: () => void save(),
          onRename: (name) => dispatch({ type: 'rename', name }),
          onNew: newPattern,
          onLoad: (p) => void loadPattern(p, p.id !== 'demo-linndrum-basic', p.id === 'demo-linndrum-basic'),
          onDuplicate: (p) => void duplicate(p),
          onDelete: (p) => void remove(p),
          backupNote,
          onExport: exportBackup,
          onImport: (f) => void importBackup(f),
        }}
        sounds={
          kit && pattern
            ? {
                kit,
                tracks: pattern.tracks,
                selectedSlotId: selectedSlot?.id ?? null,
                isReady: (s) => transport.isSampleReady(s),
                onSelectSlot: selectSlot,
                onChooseSample: (slotId, s) => void chooseSample(s, slotId),
                onVolume: (slotId) => {
                  setLibraryOpen(false)
                  openVolume(slotId, null)
                },
                onPitch: (slotId) => {
                  setLibraryOpen(false)
                  openPitch(slotId, null)
                },
              }
            : null
        }
        offline={mediaCache ? {
          kitLabel: kit ? kitName({ machineId: kit.machineId, label: kit.label }) : null,
          status: kit ? mediaCache.offlineStatus(kit.id) : 'none',
          saving: offlineSaving,
          kitBytes: kit ? mediaCache.offlineBytes(kit.id) : 0,
          ready: !!kit && snap.kitId === kit.id && snap.kitStatus === 'ready',
          usedBytes: mediaCache.usedBytes,
          budgetBytes: budget,
          warning: mediaCache.warning,
          error: offlineError,
          savedKits: mediaCache.offlineKits().map((k) => ({
            id: k.kitId,
            label: catalog?.kitEntry(k.kitId) ? kitName(catalog.kitEntry(k.kitId)!) : k.label,
            bytes: mediaCache.offlineBytes(k.kitId),
            verified: k.verified,
          })),
          onSaveOffline: () => void saveOffline(),
          onRemoveOffline: (id) => {
            const target = id ?? kit?.id
            if (target) void mediaCache.removeKitOffline(target)
          },
          onClearDownloads: () => void mediaCache.clearAll(),
        } : null}
        sources={platform.native ? (
          <SourcesTab
            native={platform.native}
            kit={kit}
            onOpenLibrary={(id) => void openLibrary(id)}
            onKitSaved={(libraryId, kitId) => void kitSaved(libraryId, kitId)}
          />
        ) : null}
      />
      <VolumeSheet
        open={!!volume}
        onClose={() => setVolume(null)}
        slot={(volume && kit?.slots.find((s) => s.id === volume.slotId)) || null}
        track={(volume && pattern?.tracks[volume.slotId]) || null}
        focusStep={volume?.step ?? null}
        loopLength={pattern?.length ?? 16}
        playing={snap.playing}
        onGain={(gainDb) => volume && dispatch({ type: 'setTrackGain', slotId: volume.slotId, gainDb })}
        onLevel={(step, level) => volume && dispatch({ type: 'setStepLevel', slotId: volume.slotId, step, level })}
        onToggleStep={(step) => {
          const slot = volume && kit?.slots.find((s) => s.id === volume.slotId)
          if (slot) dispatch({ type: 'toggleStep', slotId: slot.id, step, sampleId: slot.defaultSampleId })
        }}
        onReset={() => volume && dispatch({ type: 'resetTrackVolume', slotId: volume.slotId })}
        onAudition={(step) => {
          // Audition after the reducer update reaches the transport.
          const id = volume?.slotId
          if (id) requestAnimationFrame(() => transport.audition(id, step))
        }}
        onEditPitch={editPitchFromVolume}
      />
      <PitchSheet
        key={`${pitch?.slotId ?? ''}:${pitch?.step ?? ''}:${pitch?.focus ?? ''}`}
        open={!!pitch}
        onClose={() => setPitch(null)}
        slot={pitchSlot}
        track={pitchTrack}
        pitchCents={pattern?.pitchCents ?? 0}
        focusStep={pitch?.step ?? null}
        focus={pitch?.focus ?? 'overall'}
        loopLength={pattern?.length ?? 16}
        playing={snap.playing}
        canAudition={pitchReady && !pitchMissing}
        auditionNote={pitchAuditionNote}
        onPitch={(cents) => dispatch({ type: 'setPitch', pitchCents: cents })}
        onStepPitch={(step, cents) => pitch?.slotId && dispatch({ type: 'setStepPitch', slotId: pitch.slotId, step, pitchCents: cents })}
        onToggleStep={(step) => {
          if (pitchSlot) dispatch({ type: 'toggleStep', slotId: pitchSlot.id, step, sampleId: pitchSlot.defaultSampleId })
        }}
        onResetStepPitches={() => pitch?.slotId && dispatch({ type: 'resetStepPitches', slotId: pitch.slotId })}
        onAudition={(step) => {
          // Audition after the reducer update reaches the transport.
          const id = pitch?.slotId
          if (pitchPreviewFrame.current !== null) cancelAnimationFrame(pitchPreviewFrame.current)
          const wasPlaying = transport.getSnapshot().playing
          if (id) pitchPreviewFrame.current = requestAnimationFrame(() => {
            pitchPreviewFrame.current = null
            if (pitchTargetRef.current === pitch && transport.getSnapshot().playing === wasPlaying) transport.audition(id, step)
          })
        }}
      />
      <MachineSheet
        open={machineOpen}
        onClose={() => setMachineOpen(false)}
        machine={(detailsMachineId && catalog?.machine(detailsMachineId)) || machine}
        index={catalog?.index ?? null}
        resolve={(rel) => catalog!.url(rel)}
        activeKitId={kit?.id ?? null}
        loadingKitId={loadingKitId}
        progress={snap.progress}
        favourites={favourites}
        onToggleFavourite={prefs.toggleFavourite}
        onSelectKit={(id) => void switchKit(id)}
        onBrowseMaker={(maker) => {
          setMachineQuery((q) => ({ text: maker, n: q.n + 1 }))
          prefs.setLibraryTab('machines')
          setMachineOpen(false)
          setLibraryOpen(true)
        }}
        onNavigate={(id) => {
          const current = detailsMachineId ?? machine?.id
          if (current) setDetailsTrail((t) => [...t, current])
          setDetailsMachineId(id)
        }}
        onBack={
          detailsTrail.length
            ? () => {
                setDetailsMachineId(detailsTrail[detailsTrail.length - 1])
                setDetailsTrail((t) => t.slice(0, -1))
              }
            : null
        }
        returnFocusId={detailsTrail.length || detailsMachineId ? undefined : 'machine-button'}
      />
      <KitSheet
        open={kitsOpen && machineKits.length > 1}
        onClose={() => setKitsOpen(false)}
        title={`${keysMachine?.displayName ?? ''} kits`}
        kits={machineKits}
        activeKitId={kit?.id ?? null}
        loadingKitId={loadingKitId}
        progress={snap.progress}
        onSelectKit={(id) => void switchKit(id)}
      />
      <GrooveSheet
        open={grooveOpen && !desktop}
        onClose={() => setGrooveOpen(false)}
        swing={pattern?.swing ?? 50}
        grid={pattern?.swingGrid ?? 16}
        onSwing={(swing) => dispatch({ type: 'setSwing', swing })}
        onGrid={(grid) => dispatch({ type: 'setSwingGrid', grid })}
      />
      <TempoSheet
        open={tempoOpen}
        onClose={() => setTempoOpen(false)}
        bpm={pattern?.bpm ?? 120}
        onSetBpm={(bpm) => dispatch({ type: 'setBpm', bpm })}
      />
      <OutputSheet
        open={outputOpen}
        onClose={() => setOutputOpen(false)}
        db={userPrefs.outputDb}
        onChange={prefs.setOutputDb}
        returnFocusId={desktop ? 'output-button-desktop' : 'output-button'}
      />
      <About open={aboutOpen} onClose={() => setAboutOpen(false)} anchorId={desktop ? 'brand-button-desktop' : 'brand-button'} />
    </main>
  )
}
