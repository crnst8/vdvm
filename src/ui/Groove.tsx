import { SevenSegment } from './Segments'
import { CircuitIcon, NoteIcon, TriangleIcon, UndoIcon } from './icons'
import { useHoldRepeat } from './hooks'
import { Sheet } from './Sheet'
import type { PresetMachine, RhythmPreset } from '../data/presets'

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
        className="tkey tkey--square groove-grid"
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

/** Opens the rhythm sheet (presets, swing and grid). The LED is lit while the pattern swings. */
export function RhythmKey({ swing, onOpen, className = '' }: { swing: number; onOpen: () => void; className?: string }) {
  const straight = swing <= SWING_MIN
  return (
    <button
      type="button"
      id="rhythm-button"
      className={`tkey rhythmkey${className ? ` ${className}` : ''}`}
      aria-haspopup="dialog"
      aria-label={`Rhythm: presets and swing, ${straight ? 'straight' : `${swing}% swing`}. Open rhythm`}
      onClick={onOpen}
    >
      <span className="tkey__caption">RHYTHM</span>
      <span className="rhythmkey__face" aria-hidden="true">
        <span className={`circuitkey__led${straight ? '' : ' circuitkey__led--on'}`} />
        <NoteIcon className="rhythmkey__icon" />
      </span>
    </button>
  )
}

/** Desktop groove panel. */
export function Groove(props: GrooveProps & { circuit?: CircuitProps; onOpenRhythm: () => void }) {
  return (
    <section className="desktop-groove" aria-label="Rhythm">
      <span className="bay__cap" aria-hidden="true">Rhythm</span>
      <div className="groove-controls">
        <RhythmKey swing={props.swing} onOpen={props.onOpenRhythm} className="tkey--square" />
        <GrooveControls {...props} />
        {props.circuit && <CircuitKey c={props.circuit} />}
      </div>
    </section>
  )
}

/** Rhythm sheet: swing and grid, then the machines' preset rhythms. Picking a preset replaces the
 *  pattern's steps and keeps the sheet open; undo returns to the pattern as it was before the
 *  first preset of the run. */
export function RhythmSheet(props: GrooveProps & {
  open: boolean
  onClose: () => void
  machines: PresetMachine[]
  activePresetId: string | null
  onPreset: (preset: RhythmPreset) => void
  onUndo: (() => void) | null
}) {
  return (
    <Sheet open={props.open} onClose={props.onClose} title="Rhythm" closeLabel="Done" className="sheet--groove" returnFocusId="rhythm-button">
      <div className="groove-controls groove-controls--sheet">
        <GrooveControls {...props} />
      </div>
      <p className="groove-sheet__note">Swing delays every second {props.grid === 16 ? 'sixteenth' : 'eighth'} note. 50 is straight.</p>
      <div className="presets__rule">
        <span className="presets__cap">Presets</span>
        <button
          type="button"
          className="tkey tkey--square presets__undo"
          aria-label="Undo preset"
          title="Undo preset"
          disabled={!props.onUndo}
          onClick={() => props.onUndo?.()}
        >
          <UndoIcon />
        </button>
      </div>
      {props.machines.map((m) => (
        <section key={m.id} className="presets" aria-label={`${m.name} presets`}>
          <h3 className="presets__machine">{m.name}</h3>
          <div className="presetgrid">
            {m.presets.map((p) => {
              const active = p.id === props.activePresetId
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={active}
                  aria-label={`${m.name} ${p.name}${p.feel === 'shuffle' ? ', shuffle' : ''}`}
                  className={`tkey kitkey kitkey--grid presetkey${active ? ' tkey--latched kitkey--active' : ''}`}
                  onClick={() => props.onPreset(p)}
                >
                  <span className="kitkey__led" aria-hidden="true" />
                  {/* Non-breaking hyphens keep "Rock-1" on one line. */}
                  <span className="kitkey__label">{p.name.replaceAll('-', '\u2011')}</span>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </Sheet>
  )
}
