// Plugin only: sample libraries (factory, added catalogs, user and linked
// libraries), importing audio, building and editing user kits, MIDI notes,
// presets and host sync. Every action runs on the native side.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { KitManifest } from '../../contract/types'
import { VIEW_SCALES } from '../../platform/view'
import type {
  ImportedSampleInfo, KitDraftInfo, LibraryInfo, MidiNoteInfo, NativeApi, ScanInfo, SlotDraftInfo,
} from '../../platform/native'

export interface SourcesTabProps {
  native: NativeApi
  kit: KitManifest | null
  onOpenLibrary: (libraryId: string) => void
  onKitSaved: (libraryId: string, kitId: string) => void
}

const KIND: Record<LibraryInfo['kind'], string> = { factory: 'Factory', catalog: 'Catalog', user: 'Library', linked: 'Linked folder' }
const seconds = (s: number) => `${s < 10 ? s.toFixed(2) : s.toFixed(1)} s`
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

function useLibraries(native: NativeApi) {
  return useSyncExternalStore(native.onLibraries, native.libraries)
}

export function SourcesTab(p: SourcesTabProps) {
  const { native } = p
  const libraries = useLibraries(native)
  const activeId = native.activeLibraryId()
  const writable = libraries.filter((l) => l.writable)
  const [targetId, setTargetId] = useState<string | null>(null)
  const target = writable.find((l) => l.id === targetId) ?? writable.find((l) => l.id === activeId) ?? writable[0] ?? null
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [scan, setScan] = useState<ScanInfo | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [samples, setSamples] = useState<ImportedSampleInfo[]>([])
  const [kits, setKits] = useState<{ id: string; label: string }[]>([])
  const [draft, setDraft] = useState<{ libraryId: string; kit: KitDraftInfo } | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)

  const run = async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label)
    setNote(null)
    try {
      return await fn()
    } catch (e) {
      setNote(errorText(e))
      return undefined
    } finally {
      setBusy(null)
    }
  }

  const refreshTarget = async (id: string | null = target?.id ?? null) => {
    if (!id) {
      setSamples([])
      setKits([])
      return
    }
    try {
      const [s, k] = await Promise.all([native.librarySamples(id), native.libraryKits(id)])
      setSamples(s)
      setKits(k)
    } catch (e) {
      setNote(errorText(e))
    }
  }
  useEffect(() => {
    void refreshTarget()
  }, [target?.id, libraries])

  // ---- libraries ----------------------------------------------------------------------
  const addCatalog = () => run('Adding', async () => {
    const id = await native.addCatalog()
    if (id) p.onOpenLibrary(id)
  })
  const newLibrary = () => run('Creating', async () => {
    const id = await native.createLibrary('My Sounds')
    setTargetId(id)
  })
  const linkFolder = () => run('Linking', async () => {
    const id = await native.linkFolder()
    if (id) setTargetId(id)
  })
  const relocate = (lib: LibraryInfo) => run('Locating', async () => {
    const r = await native.relocateLibrary(lib.id)
    if (r && r.missing > 0) setNote(`${r.found} found, ${r.missing} still missing: ${r.missingNames.slice(0, 6).join(', ')}`)
    else if (r) setNote(`${r.found} found.`)
    await native.retryMissing().catch(() => {})
  })
  const check = (lib: LibraryInfo) => run('Checking', async () => {
    const h = await native.checkLibrary(lib.id)
    setNote(
      h.problems[0] ??
        `${h.kits} kits · ${h.samples} sounds${h.missing ? ` · ${h.missing} missing` : ''}${h.changed ? ` · ${h.changed} changed` : ''}`,
    )
  })

  // ---- import -------------------------------------------------------------------------------
  const choose = (mode: 'files' | 'folder') => run('Scanning', async () => {
    const s = await native.chooseAudio(mode)
    if (!s) return
    setScan(s)
    setPicked(new Set(s.candidates.map((c) => c.index)))
  })
  const importPicked = () => run('Importing', async () => {
    if (!scan) return
    let libraryId = target?.id ?? null
    // The first import creates a library to hold it.
    if (!libraryId) libraryId = await native.createLibrary('My Sounds')
    const r = await native.importScan(scan.scanId, [...picked], libraryId)
    setScan(null)
    setTargetId(libraryId)
    await refreshTarget(libraryId)
    setNote(`${r.imported.length} imported${r.failed.length ? ` · ${r.failed.length} failed: ${r.failed.slice(0, 3).map((f) => `${f.name} (${f.reason})`).join('; ')}` : ''}`)
    // Offer a kit built from the role suggestions straight away.
    const fresh = r.imported.filter((s) => !s.assigned)
    if (fresh.length) setDraft({ libraryId, kit: draftFromSamples(fresh, native.roles()) })
  })

  // ---- kits ---------------------------------------------------------------------------------
  const editKit = (libraryId: string, kitId: string) => run('Opening', async () => {
    setDraft({ libraryId, kit: await native.kitDraft(libraryId, kitId) })
  })
  const saveDraft = () => run('Saving', async () => {
    if (!draft) return
    const kitId = await native.saveKit(draft.libraryId, draft.kit)
    const libraryId = draft.libraryId
    setDraft(null)
    await refreshTarget(libraryId)
    p.onKitSaved(libraryId, kitId)
  })
  const deleteKit = (libraryId: string, kitId: string) => run('Deleting', async () => {
    await native.deleteKit(libraryId, kitId)
    setDraft(null)
    await refreshTarget(libraryId)
  })
  const copyCurrentKit = (toLibraryId: string) => run('Copying', async () => {
    if (!p.kit || !activeId) return
    const kitId = await native.copyKit(activeId, p.kit.id, toLibraryId)
    await refreshTarget(toLibraryId)
    p.onKitSaved(toLibraryId, kitId)
  })

  const active = libraries.find((l) => l.id === activeId) ?? null

  if (draft) {
    return (
      <KitEditor
        native={native}
        libraryId={draft.libraryId}
        draft={draft.kit}
        samples={samples}
        busy={busy}
        note={note}
        onChange={(kit) => setDraft({ ...draft, kit })}
        onSave={() => void saveDraft()}
        onCancel={() => setDraft(null)}
        onDelete={draft.kit.kitId ? () => void deleteKit(draft.libraryId, draft.kit.kitId) : null}
      />
    )
  }

  return (
    <div className="srctab">
      {note && <p className="lib__error src__note" role="status">{note}</p>}

      <h4 className="lib__subhead">Libraries {libraries.length ? <span className="mgroup__count">{libraries.length}</span> : null}</h4>
      {libraries.length > 0 && (
        <ul className="plist">
          {libraries.map((lib) => (
            <li key={lib.id} className={`prow${lib.id === activeId ? ' prow--active' : ''}`}>
              {renaming?.id === lib.id ? (
                <input
                  className="src__input"
                  aria-label="Library name"
                  value={renaming.name}
                  autoFocus
                  onChange={(e) => setRenaming({ id: lib.id, name: e.target.value })}
                  onBlur={() => {
                    void run('Renaming', () => native.renameLibrary(lib.id, renaming.name))
                    setRenaming(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                />
              ) : (
                <button type="button" className="prow__main" disabled={!lib.available} onClick={() => p.onOpenLibrary(lib.id)} aria-label={`Use ${lib.name}`}>
                  <span className="prow__name">{lib.name}</span>
                  <span className={`prow__meta${lib.available ? '' : ' lib__error'}`}>
                    {lib.available ? `${KIND[lib.kind]} · ${lib.kits} kit${lib.kits === 1 ? '' : 's'}${lib.writable ? ` · ${lib.imported} sounds` : ''}` : (lib.problem ?? 'Missing')}
                  </span>
                </button>
              )}
              <span className="prow__actions">
                {(!lib.available || lib.kind === 'linked') && lib.kind !== 'factory' && (
                  <button type="button" className="textbtn" disabled={!!busy} onClick={() => void relocate(lib)}>Locate</button>
                )}
                {lib.available && <button type="button" className="textbtn" disabled={!!busy} onClick={() => void check(lib)}>Check</button>}
                <button type="button" className="textbtn" onClick={() => native.revealLibrary(lib.id)}>Show</button>
                {lib.kind !== 'factory' && (
                  <>
                    {lib.writable && <button type="button" className="textbtn" onClick={() => setRenaming({ id: lib.id, name: lib.name })}>Rename</button>}
                    <button type="button" className="textbtn" disabled={!!busy} onClick={() => void run('Removing', () => native.removeLibrary(lib.id))}>Remove</button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="src__actions">
        <button type="button" className="keybtn keybtn--quiet" disabled={!!busy} onClick={() => void addCatalog()}>Add catalog</button>
        <button type="button" className="keybtn keybtn--quiet" disabled={!!busy} onClick={() => void newLibrary()}>New library</button>
        <button type="button" className="keybtn keybtn--quiet" disabled={!!busy} onClick={() => void linkFolder()}>Link folder</button>
      </div>

      <h4 className="lib__subhead">Import</h4>
      {writable.length > 1 && (
        <label className="src__field">
          <span>Into</span>
          <select value={target?.id ?? ''} onChange={(e) => setTargetId(e.target.value)}>
            {writable.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
      )}
      <div className="src__actions">
        <button type="button" className="keybtn" disabled={!!busy} onClick={() => void choose('files')}>Files</button>
        <button type="button" className="keybtn" disabled={!!busy} onClick={() => void choose('folder')}>Folder</button>
        {busy && <span className="muted src__busy" role="status">{busy}…</span>}
      </div>
      {scan && (
        <div className="src__scan">
          <ul className="src__list">
            {scan.candidates.map((c) => (
              <li key={c.index} className="src__item">
                <label className="src__check">
                  <input
                    type="checkbox"
                    checked={picked.has(c.index)}
                    onChange={(e) => {
                      const next = new Set(picked)
                      if (e.target.checked) next.add(c.index)
                      else next.delete(c.index)
                      setPicked(next)
                    }}
                  />
                  <span className="src__name">{c.relPath}</span>
                </label>
                <span className="prow__meta">
                  {[c.suggestedRole && native.roles().find((r) => r.id === c.suggestedRole)?.label, c.format.toUpperCase(), `${c.channels === 1 ? 'mono' : 'stereo'}`, `${Math.round(c.sampleRate / 100) / 10} kHz`, seconds(c.durationSec)].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
          {scan.rejectedTotal > 0 && (
            <details className="src__rejected">
              <summary>{scan.rejectedTotal} skipped{scan.truncated ? ' · scan stopped at its limit' : ''}</summary>
              <ul>
                {scan.rejected.map((r, i) => <li key={i}>{r.name}: {r.reason}</li>)}
              </ul>
            </details>
          )}
          <div className="src__actions">
            <button type="button" className="keybtn" disabled={!!busy || picked.size === 0 || (target?.kind === 'linked' && !scan.folder)} onClick={() => void importPicked()}>
              {target?.kind === 'linked' ? 'Link' : 'Import'} {picked.size}
            </button>
            <button type="button" className="keybtn keybtn--quiet" onClick={() => setScan(null)}>Cancel</button>
          </div>
        </div>
      )}

      {target && (
        <>
          <h4 className="lib__subhead">Kits in {target.name} {kits.length ? <span className="mgroup__count">{kits.length}</span> : null}</h4>
          {kits.length > 0 && (
            <ul className="plist">
              {kits.map((k) => (
                <li key={k.id} className="prow">
                  <button type="button" className="prow__main" onClick={() => p.onKitSaved(target.id, k.id)} aria-label={`Play ${k.label}`}>
                    <span className="prow__name">{k.label}</span>
                  </button>
                  <span className="prow__actions">
                    <button type="button" className="textbtn" onClick={() => void editKit(target.id, k.id)}>Edit</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="src__actions">
            <button
              type="button"
              className="keybtn keybtn--quiet"
              disabled={samples.length === 0}
              onClick={() => setDraft({ libraryId: target.id, kit: draftFromSamples(samples.filter((s) => !s.assigned), native.roles()) })}
            >
              New kit
            </button>
          </div>
        </>
      )}

      {p.kit && active && !active.writable && writable.length > 0 && (
        <>
          <h4 className="lib__subhead">Copy {p.kit.label}</h4>
          <div className="src__actions">
            {writable.filter((l) => l.kind === 'user').map((l) => (
              <button key={l.id} type="button" className="keybtn keybtn--quiet" disabled={!!busy} onClick={() => void copyCurrentKit(l.id)}>
                To {l.name}
              </button>
            ))}
          </div>
        </>
      )}

      {p.kit && <MidiNotes native={native} kitId={p.kit.id} />}

      <h4 className="lib__subhead">Preset</h4>
      <div className="src__actions">
        <button type="button" className="keybtn keybtn--quiet" disabled={!p.kit} onClick={() => void run('Saving', () => native.savePreset())}>Save preset</button>
        <button type="button" className="keybtn keybtn--quiet" onClick={() => void run('Loading', () => native.loadPreset())}>Load preset</button>
      </div>
      <WindowView native={native} />
    </div>
  )
}

/** A first draft from imported samples: one pad per suggested role, variants in import order. */
function draftFromSamples(samples: ImportedSampleInfo[], roles: { id: string; label: string }[]): KitDraftInfo {
  const slots: SlotDraftInfo[] = []
  for (const r of roles) {
    const matching = samples.filter((s) => s.suggestedRole === r.id)
    if (matching.length) slots.push({ id: '', role: r.id, label: r.label, sampleShas: matching.map((s) => s.sha), defaultSha: matching[0].sha })
  }
  return { kitId: '', label: 'New kit', slots }
}

function KitEditor(p: {
  native: NativeApi
  libraryId: string
  draft: KitDraftInfo
  samples: ImportedSampleInfo[]
  busy: string | null
  note: string | null
  onChange: (d: KitDraftInfo) => void
  onSave: () => void
  onCancel: () => void
  onDelete: (() => void) | null
}) {
  const roles = p.native.roles()
  const byShaName = useMemo(() => new Map(p.samples.map((s) => [s.sha, s])), [p.samples])
  const used = new Set(p.draft.slots.flatMap((s) => s.sampleShas))
  const setSlot = (i: number, slot: SlotDraftInfo) => p.onChange({ ...p.draft, slots: p.draft.slots.map((s, j) => (j === i ? slot : s)) })
  const removeSlot = (i: number) => p.onChange({ ...p.draft, slots: p.draft.slots.filter((_, j) => j !== i) })
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= p.draft.slots.length) return
    const slots = p.draft.slots.slice()
    ;[slots[i], slots[j]] = [slots[j], slots[i]]
    p.onChange({ ...p.draft, slots })
  }
  const filled = p.draft.slots.filter((s) => s.sampleShas.length > 0).length
  return (
    <div className="srctab kited">
      <label className="src__field">
        <span>Kit</span>
        <input className="src__input" value={p.draft.label} maxLength={80} onChange={(e) => p.onChange({ ...p.draft, label: e.target.value })} />
      </label>
      {p.note && <p className="lib__error src__note" role="status">{p.note}</p>}
      <ol className="kited__pads">
        {p.draft.slots.map((slot, i) => (
          <li key={i} className="kited__pad">
            <div className="kited__head">
              <select
                aria-label={`Pad ${i + 1} role`}
                value={slot.role}
                onChange={(e) => {
                  const role = e.target.value
                  const label = role ? (roles.find((r) => r.id === role)?.label ?? role) : slot.label
                  setSlot(i, { ...slot, role, label })
                }}
              >
                <option value="">Custom</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
              <input className="src__input" aria-label={`Pad ${i + 1} name`} value={slot.label} maxLength={40} onChange={(e) => setSlot(i, { ...slot, label: e.target.value })} />
              <button type="button" className="textbtn" aria-label={`Move pad ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="textbtn" aria-label={`Move pad ${i + 1} down`} disabled={i === p.draft.slots.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button type="button" className="textbtn" onClick={() => removeSlot(i)}>Remove</button>
            </div>
            <ul className="variants" role="radiogroup" aria-label={`Default sound for ${slot.label || `pad ${i + 1}`}`}>
              {slot.sampleShas.map((sha) => {
                const s = byShaName.get(sha)
                return (
                  <li key={sha} className="kited__variant">
                    <button type="button" role="radio" aria-checked={sha === slot.defaultSha} className="variant" onClick={() => setSlot(i, { ...slot, defaultSha: sha })}>
                      <span className="variant__dot" aria-hidden="true" />
                      <span>{s?.name ?? sha.slice(0, 12)}</span>
                      <span className="muted variant__meta">{s ? seconds(s.durationSec) : ''}</span>
                    </button>
                    <button type="button" className="textbtn" onClick={() => p.native.previewSample(p.libraryId, sha)}>Play</button>
                    <button
                      type="button"
                      className="textbtn"
                      onClick={() => {
                        const sampleShas = slot.sampleShas.filter((x) => x !== sha)
                        setSlot(i, { ...slot, sampleShas, defaultSha: slot.defaultSha === sha ? (sampleShas[0] ?? '') : slot.defaultSha })
                      }}
                    >
                      Remove
                    </button>
                  </li>
                )
              })}
            </ul>
            <select
              aria-label={`Add a sound to ${slot.label || `pad ${i + 1}`}`}
              value=""
              onChange={(e) => {
                const sha = e.target.value
                if (!sha) return
                setSlot(i, { ...slot, sampleShas: [...slot.sampleShas, sha], defaultSha: slot.defaultSha || sha })
              }}
            >
              <option value="">Add sound…</option>
              {p.samples
                .filter((s) => !slot.sampleShas.includes(s.sha))
                .sort((a, b) => Number(used.has(a.sha)) - Number(used.has(b.sha)) || a.name.localeCompare(b.name))
                .map((s) => <option key={s.sha} value={s.sha}>{s.name}{used.has(s.sha) ? ' (on another pad)' : ''}</option>)}
            </select>
          </li>
        ))}
      </ol>
      <div className="src__actions">
        <button type="button" className="keybtn keybtn--quiet" onClick={() => p.onChange({ ...p.draft, slots: [...p.draft.slots, { id: '', role: '', label: `Pad ${p.draft.slots.length + 1}`, sampleShas: [], defaultSha: '' }] })}>
          Add pad
        </button>
      </div>
      <div className="src__actions">
        <button type="button" className="keybtn" disabled={!!p.busy || filled === 0} onClick={p.onSave}>Save kit</button>
        <button type="button" className="keybtn keybtn--quiet" onClick={p.onCancel}>Cancel</button>
        {p.onDelete && <button type="button" className="textbtn" disabled={!!p.busy} onClick={p.onDelete}>Delete kit</button>}
      </div>
    </div>
  )
}

function MidiNotes(p: { native: NativeApi; kitId: string }) {
  const [notes, setNotes] = useState<MidiNoteInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const load = () => p.native.midiMap().then(setNotes, (e) => setError(errorText(e)))
  useEffect(() => {
    void load()
  }, [p.kitId])
  const set = (slotId: string, note: number) => {
    if (!Number.isInteger(note) || note < 0 || note > 127) return
    p.native.setMidiNote(slotId, note).then(load, (e) => setError(errorText(e)))
  }
  return (
    <>
      <h4 className="lib__subhead">MIDI notes</h4>
      {error && <p className="lib__error">{error}</p>}
      <ul className="src__midi">
        {notes.map((n) => (
          <li key={n.slotId} className="src__midirow">
            <span className="src__name">{n.label}</span>
            <input
              type="number"
              min={0}
              max={127}
              aria-label={`MIDI note for ${n.label}`}
              className="src__input src__note-input"
              value={n.note}
              onChange={(e) => set(n.slotId, Number(e.target.value))}
            />
            <span className={`muted src__notename${n.overridden ? ' src__notename--set' : ''}`}>{n.name}</span>
          </li>
        ))}
      </ul>
      <div className="src__actions">
        <button type="button" className="textbtn" onClick={() => p.native.resetMidiMap().then(load, (e) => setError(errorText(e)))}>Reset notes</button>
      </div>
    </>
  )
}

function WindowView(p: { native: NativeApi }) {
  const view = useSyncExternalStore(p.native.onView, p.native.view)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: { layout?: 'wide' | 'compact'; scale?: number }) => p.native.setView(patch).catch((e) => setError(errorText(e)))
  return (
    <>
      <h4 className="lib__subhead">Window</h4>
      {error && <p className="lib__error">{error}</p>}
      <div className="src__actions" role="group" aria-label="Window size">
        {(['wide', 'compact'] as const).map((layout) => (
          <button
            key={layout}
            type="button"
            className={`keybtn${view.layout === layout ? '' : ' keybtn--quiet'}`}
            aria-pressed={view.layout === layout}
            onClick={() => void set({ layout })}
          >
            {layout === 'wide' ? 'Wide' : 'Compact'}
          </button>
        ))}
      </div>
      <div className="src__actions" role="group" aria-label="Zoom">
        {VIEW_SCALES.map((scale) => (
          <button
            key={scale}
            type="button"
            className={`keybtn${Math.abs(view.scale - scale) < 1e-6 ? '' : ' keybtn--quiet'}`}
            aria-pressed={Math.abs(view.scale - scale) < 1e-6}
            onClick={() => void set({ scale })}
          >
            {Math.round(scale * 100)}%
          </button>
        ))}
      </div>
    </>
  )
}
