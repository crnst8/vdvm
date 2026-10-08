import { SevenSegment } from './Segments'
import { CircuitIcon, TriangleIcon } from './icons'
import { useHoldRepeat } from './hooks'
import { Sheet } from './Sheet'

export const SWING_MIN = 50
export const SWING_MAX = 75

export interface CircuitProps {
  on: boolean
  machine: string
  summary: string
  /** Source line for the tooltip. */
  source: string
  /** Swing the hardware actually plays, when it differs from the readout. */
  plays: number | null
  onToggle: () => void
}

interface GrooveProps {
  swing: number
  grid: 8 | 16
  onSwing: (amount: number) => void
  onGrid: (grid: 8 | 16) => void
}

/** Swing amount (same key language as tempo) and the swing grid. */
export function GrooveControls(props: GrooveProps) {
  // useHoldRepeat keeps the latest closure, so repeats read the current amount.
  const down = useHoldRepeat(() => props.onSwing(Math.max(SWING_MIN, props.swing - 1)))
  const up = useHoldRepeat(() => props.onSwing(Math.min(SWING_MAX, props.swing + 1)))
  const straight = props.swing === SWING_MIN
  return (
    <>
      <div className="tempo groove-swing" role="group" aria-label="Swing">
        <button type="button" className="tkey tkey--arrow" aria-label="Less swing" disabled={straight} {...down}>
          <TriangleIcon dir="left" />
        </button>
        <button
          type="button"
          className="tempo__display readout"
          aria-label={straight ? 'Swing 50%, straight' : `Swing ${props.swing}%. Reset to straight`}
          title={straight ? 'Straight timing' : 'Reset to straight'}
          disabled={straight}
          onClick={() => props.onSwing(SWING_MIN)}
        >
          <span className="readout__cap" aria-hidden="true">{straight ? 'Straight' : 'Swing %'}</span>
          <SevenSegment text={String(props.swing)} cells={2} className="seg7" />
        </button>
        <button type="button" className="tkey tkey--arrow" aria-label="More swing" disabled={props.swing >= SWING_MAX} {...up}>
          <TriangleIcon dir="right" />
        </button>
      </div>
      <button
        type="button"
        className="tkey tkey--square"
        aria-label={`Swing on ${props.grid === 16 ? 'sixteenth' : 'eighth'} notes. Switch to ${props.grid === 16 ? 'eighth' : 'sixteenth'} notes`}
        title="Which notes the swing delays"
        onClick={() => props.onGrid(props.grid === 16 ? 8 : 16)}
      >
        <span className="tkey__caption">GRID</span>
        <span className="tkey__label tkey__label--big">1/{props.grid}</span>
      </button>
    </>
  )
}

/** Hardware timing toggle; shown only when the machine has documented timing. */
export function CircuitKey({ c, className = '' }: { c: CircuitProps; className?: string }) {
  return (
    <button
      type="button"
      className={`tkey tkey--square circuitkey${c.on ? ' tkey--latched' : ''}${className ? ` ${className}` : ''}`}
      aria-pressed={c.on}
      aria-label={`${c.machine} circuit timing: ${c.summary}${c.plays !== null ? `, plays ${Number(c.plays.toFixed(2))}% swing` : ''}. ${c.on ? 'On' : 'Off'}`}
      title={`${c.summary}${c.plays !== null ? `\nPlays ${Number(c.plays.toFixed(2))}% swing` : ''}\nSource: ${c.source}`}
      onClick={c.onToggle}
    >
      <span className="tkey__caption">CIRCUIT</span>
      <span className="circuitkey__face" aria-hidden="true">
        <span className={`circuitkey__led${c.on ? ' circuitkey__led--on' : ''}`} />
        <CircuitIcon className="circuitkey__icon" />
      </span>
    </button>
  )
}

/** Desktop groove panel. */
export function Groove(props: GrooveProps & { circuit?: CircuitProps }) {
  return (
    <section className="desktop-groove" aria-label="Groove">
      <span className="bay__cap" aria-hidden="true">Groove</span>
      <div className="groove-controls">
        <GrooveControls {...props} />
        {props.circuit && <CircuitKey c={props.circuit} />}
      </div>
    </section>
  )
}

/** Phone groove controls in a sheet, opened from the groove key under the logo. */
export function GrooveSheet(props: GrooveProps & { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={props.open} onClose={props.onClose} title="Groove" closeLabel="Done" className="sheet--groove" returnFocusId="groove-button">
      <div className="groove-controls groove-controls--sheet">
        <GrooveControls {...props} />
      </div>
      <p className="groove-sheet__note">Swing delays every second {props.grid === 16 ? 'sixteenth' : 'eighth'} note. 50 is straight.</p>
    </Sheet>
  )
}
