// Tempo: tap tempo pad, fine adjustment, halve/double and typed entry.
import { useRef, useState } from 'react'
import { addTap, emptyTaps, type TapState } from '../state/tapTempo'
import { BPM_MAX, BPM_MIN, clampBpm } from '../state/pattern'
import { Sheet } from './Sheet'
import { SevenSegment } from './Segments'
import { TriangleIcon } from './icons'
import { useHoldRepeat } from './hooks'

export function TempoSheet(props: { open: boolean; onClose: () => void; bpm: number; onSetBpm: (bpm: number) => void }) {
  const taps = useRef<TapState>(emptyTaps())
  const [count, setCount] = useState(0)
  const [flash, setFlash] = useState(0)
  const [draft, setDraft] = useState<string | null>(null)
  const down = useHoldRepeat(() => props.onSetBpm(props.bpm - 1))
  const up = useHoldRepeat(() => props.onSetBpm(props.bpm + 1))

  const tap = (at: number) => {
    const r = addTap(taps.current, at, clampBpm)
    taps.current = r.state
    setCount(r.state.times.length)
    setFlash((f) => f + 1)
    if (r.bpm !== null) props.onSetBpm(r.bpm)
  }
  const commit = () => {
    if (draft !== null) {
      const n = Number.parseInt(draft, 10)
      if (Number.isFinite(n)) props.onSetBpm(n)
    }
    setDraft(null)
  }

  return (
    <Sheet open={props.open} onClose={props.onClose} title="Tempo" closeLabel="Done" className="sheet--tempo" returnFocusId="tempo-display">
      <div className="tempo-sheet">
        <div className="tempo-sheet__readout">
          <button type="button" className="tkey tkey--arrow" aria-label="Tempo down" disabled={props.bpm <= BPM_MIN} {...down}>
            <TriangleIcon dir="left" />
          </button>
          <div className="tempo__display tempo-sheet__display" aria-live="polite" aria-label={`${props.bpm} BPM`}>
            <SevenSegment text={String(props.bpm)} cells={3} className="seg7" />
          </div>
          <button type="button" className="tkey tkey--arrow" aria-label="Tempo up" disabled={props.bpm >= BPM_MAX} {...up}>
            <TriangleIcon dir="right" />
          </button>
        </div>
        <button
          type="button"
          className={`tappad${flash % 2 ? ' tappad--a' : ' tappad--b'}`}
          data-autofocus=""
          aria-label="Tap tempo. Tap in time with the beat"
          onPointerDown={(e) => {
            if (e.button === 0) tap(e.timeStamp)
          }}
          onClick={(e) => {
            if (e.detail === 0) tap(e.timeStamp)
          }}
        >
          <span className="tappad__led" aria-hidden="true" />
          <span className="tappad__label">TAP</span>
          <span className="tappad__hint">{count < 2 ? 'Tap in time, 4 or more times' : `${count} taps`}</span>
        </button>
        <div className="tempo-sheet__row">
          <button type="button" className="keybtn keybtn--quiet" onClick={() => props.onSetBpm(Math.round(props.bpm / 2))} disabled={props.bpm / 2 < BPM_MIN}>
            ×½
          </button>
          <button type="button" className="keybtn keybtn--quiet" onClick={() => props.onSetBpm(props.bpm * 2)} disabled={props.bpm * 2 > BPM_MAX}>
            ×2
          </button>
          <input
            className="tempo-sheet__input"
            type="number"
            name="tempo"
            inputMode="numeric"
            min={BPM_MIN}
            max={BPM_MAX}
            aria-label={`Type a tempo, ${BPM_MIN} to ${BPM_MAX} BPM`}
            placeholder="BPM"
            value={draft ?? ''}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
            }}
          />
        </div>
        <p className="muted tempo-sheet__hint">Tempo follows your taps as you go. Press T anywhere to tap without opening this.</p>
      </div>
    </Sheet>
  )
}
