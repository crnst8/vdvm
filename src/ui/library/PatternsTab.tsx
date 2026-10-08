import { useRef, useState } from 'react'
import type { CatalogIndex, Pattern } from '../../contract/types'
import { NAME_MAX } from '../../state/pattern'

export interface PatternsTabProps {
  index: CatalogIndex | null
  patterns: Pattern[]
  demo: Pattern | null
  currentId: string
  currentName: string
  saved: boolean
  storageError: string | null
  undo: { label: string; run: () => void } | null
  onSave: () => void
  onRename: (name: string) => void
  onNew: () => void
  onLoad: (p: Pattern) => void
  onDuplicate: (p: Pattern) => void
  onDelete: (p: Pattern) => void
  /** Result of the last backup export or import. */
  backupNote: string | null
  onExport: () => void
  onImport: (file: File) => void
}

const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function PatternsTab(p: PatternsTabProps) {
  // Phones have no name display on the panel, so the current pattern is renamed here.
  const [draft, setDraft] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const commit = () => {
    if (draft !== null) p.onRename(draft)
    setDraft(null)
  }
  const kitLabel = (id: string) => p.index?.kits.find((k) => k.id === id)?.label ?? id
  const row = (pat: Pattern, example = false) => (
    <li key={pat.id} className={`prow${pat.id === p.currentId ? ' prow--current' : ''}`}>
      <button type="button" className="prow__main" onClick={() => p.onLoad(pat)} aria-label={`Load ${pat.name}`}>
        <span className="prow__name">{pat.name}</span>
        <span className="prow__meta">
          {pat.bpm} BPM · {kitLabel(pat.kitId)}
          {pat.length === 8 ? ' · 8 steps' : ''}
          {example ? '' : ` · ${fmtDate(pat.updatedAt)}`}
        </span>
      </button>
      {!example && (
        <span className="prow__actions">
          <button type="button" className="textbtn" onClick={() => p.onDuplicate(pat)} aria-label={`Duplicate ${pat.name}`}>
            Copy
          </button>
          <button type="button" className="textbtn" onClick={() => p.onDelete(pat)} aria-label={`Delete ${pat.name}`}>
            Delete
          </button>
        </span>
      )}
    </li>
  )
  return (
    <div className="ptab">
      <div className="pcurrent">
        <div>
          <span className="pcurrent__label">Now editing</span>
          {draft === null ? (
            <button type="button" className="pcurrent__name pcurrent__rename" aria-label={`Pattern name: ${p.currentName}. Rename`} onClick={() => setDraft(p.currentName)}>
              {p.currentName}
            </button>
          ) : (
            <input
              className="pcurrent__name pcurrent__input"
              name="pattern-name"
              aria-label="Pattern name"
              maxLength={NAME_MAX}
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  setDraft(null)
                }
              }}
            />
          )}
          <span className={`pcurrent__state${p.saved ? ' pcurrent__state--saved' : ''}`}>{p.saved ? 'Saved' : 'Not saved'}</span>
        </div>
        <span className="pcurrent__actions">
          <button type="button" className="keybtn" onClick={p.onSave} disabled={p.saved}>
            Save
          </button>
          <button type="button" className="keybtn keybtn--quiet" onClick={p.onNew}>
            New
          </button>
        </span>
      </div>
      {p.storageError && <p className="lib__error">Saving on this device is unavailable: {p.storageError}</p>}
      {p.undo && (
        <p className="toast" role="status">
          {p.undo.label}
          <button type="button" className="textbtn" onClick={p.undo.run}>
            Undo
          </button>
        </p>
      )}
      <h4 className="lib__subhead">Saved {p.patterns.length ? <span className="mgroup__count">{p.patterns.length}</span> : null}</h4>
      {p.patterns.length ? <ul className="plist">{p.patterns.map((x) => row(x))}</ul> : <p className="empty">Patterns you save with the bookmark appear here.</p>}
      {p.demo && (
        <>
          <h4 className="lib__subhead">Examples</h4>
          <ul className="plist">{row(p.demo, true)}</ul>
        </>
      )}
      <h4 className="lib__subhead">Backup</h4>
      <p className="pbackup__text">Patterns and favourites live in this browser. Export a file to keep a copy or move them to another device; importing adds to what is here.</p>
      <span className="pbackup__actions">
        <button type="button" className="keybtn keybtn--quiet" onClick={p.onExport} disabled={!p.patterns.length}>
          Export
        </button>
        <button type="button" className="keybtn keybtn--quiet" onClick={() => fileInput.current?.click()}>
          Import
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) p.onImport(f)
          }}
        />
      </span>
      {p.backupNote && <p className="pbackup__note" role="status">{p.backupNote}</p>}
    </div>
  )
}
