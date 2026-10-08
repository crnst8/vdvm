import { useState } from 'react'
import { FourteenSegment } from './Segments'
import { BooksIcon, BookmarkIcon, BrandRings, SpeakerIcon, TrashIcon, UndoIcon } from './icons'
import { formatDb } from './VolumeSheet'
import { NAME_MAX } from '../state/pattern'

export function Header(props: {
  name: string
  saved: boolean
  onLibrary: () => void
  onRename: (name: string) => void
  onSave: () => void
  desktop?: boolean
  canExport?: boolean
  exporting?: boolean
  onMidi: () => void
  onAudio: () => void
  /** Phones: the bin clears every step; for a few seconds afterwards it is an undo key. */
  canClear: boolean
  onClear: () => void
  onUndoClear: (() => void) | null
  /** The V.D.V.M mark opens the about card. */
  onAbout: () => void
  /** Output volume in dB (0 = default); the speaker key opens its sheet. */
  outputDb: number
  onOutput: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const commit = () => {
    props.onRename(draft)
    setEditing(false)
  }
  const speaker = (
    <button
      type="button"
      id={props.desktop ? 'output-button-desktop' : 'output-button'}
      className={props.desktop ? 'save-action save-action--icon' : 'head__icon head__output'}
      aria-label={`Output volume, ${formatDb(props.outputDb)}`}
      aria-haspopup="dialog"
      onClick={props.onOutput}
    >
      <SpeakerIcon level={props.outputDb < -12 ? 0 : props.outputDb < 0 ? 1 : 2} />
      {props.outputDb > 0 && <span className="head__boost" aria-hidden="true" />}
    </button>
  )
  return (
    <header className="head" aria-label={props.desktop ? 'Save' : undefined}>
      {props.desktop ? (
        <span className="bay__cap" aria-hidden="true">Save</span>
      ) : (<>
        {/* Phones: a strip across the top holds the bin and bookmark (left) and the library (right);
            the V.D.V.M mark sits over it. Its version is in the about card. */}
        {props.onUndoClear ? (
          <button type="button" className="head__icon head__clear head__clear--undo" aria-label="Undo clear" onClick={props.onUndoClear}>
            <UndoIcon />
          </button>
        ) : (
          <button type="button" className="head__icon head__clear" aria-label="Clear pattern" disabled={!props.canClear} onClick={props.onClear}>
            <TrashIcon />
          </button>
        )}
        <button
          type="button"
          className="head__icon head__bookmark"
          aria-label={props.saved ? 'Pattern saved' : 'Save pattern'}
          aria-pressed={props.saved}
          onClick={props.onSave}
        >
          <BookmarkIcon filled={props.saved} />
        </button>
        <button type="button" id="brand-button" className="brand" aria-label="About V.D.V.M" aria-haspopup="dialog" onClick={props.onAbout}>
          <BrandRings />
        </button>
      </>)}
      {props.desktop && <div className="save-name"><div className="namewin">
        {editing ? (
          <input
            className="namewin__input"
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
                setEditing(false)
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="namewin__display"
            aria-label={`Pattern name: ${props.name}. Rename`}
            onClick={() => {
              setDraft(props.name)
              setEditing(true)
            }}
          >
            <FourteenSegment text={props.name} cells={10} className="seg14" />
          </button>
        )}
      </div>{speaker}</div>}
      {props.desktop ? (
        <div className="save-actions">
          <button type="button" className="save-action" aria-pressed={props.saved} onClick={props.onSave}>
            <span className={`save-action__led${props.saved ? ' save-action__led--on' : ''}`} aria-hidden="true" />
            {props.saved ? 'Saved' : 'Save'}
          </button>
          <button type="button" className="save-action" disabled={!props.canExport} aria-description="Rhythm and dynamics only. Use audio export to include sample pitch." onClick={props.onMidi}>Export MIDI</button>
          <button type="button" className="save-action" disabled={!props.canExport || props.exporting} onClick={props.onAudio}>
            {props.exporting ? 'Rendering…' : 'Export audio'}
          </button>
        </div>
      ) : (<>
        {speaker}
        <button type="button" id="library-button" className="head__icon head__books" aria-label="Library" onClick={props.onLibrary}>
          <BooksIcon />
        </button>
      </>)}
    </header>
  )
}
