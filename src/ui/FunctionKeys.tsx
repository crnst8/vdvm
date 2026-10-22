// Function keys: GAIN (output volume), PATTERN (presets and swing), PITCH and ECHO. Each opens
// its sheet; the LED is lit while that setting differs from its default. Desktop shows all four
// in the header's function cell; phones keep PATTERN beside VAR and the other three under the hits.
import type { ReactNode } from 'react'
import type { EchoState } from '../audio/echo/settings'
import { echoKeyValue } from './EchoSheet'
import { formatSemitones } from './PitchKnob'
import { formatDb } from './VolumeSheet'
import { EchoIcon, NoteIcon, PitchIcon, SpeakerIcon } from './icons'

function FunctionKey(props: {
  id: string
  caption: ReactNode
  captionClass?: string
  on: boolean
  icon: ReactNode
  label: string
  title?: string
  disabled?: boolean
  className?: string
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      id={props.id}
      className={`tkey fkey${props.className ? ` ${props.className}` : ''}`}
      aria-haspopup="dialog"
      aria-label={props.label}
      title={props.title}
      disabled={props.disabled}
      onClick={props.onOpen}
    >
      <span className={`tkey__caption fkey__cap${props.captionClass ? ` ${props.captionClass}` : ''}`}>{props.caption}</span>
      <span className="fkey__face" aria-hidden="true">
        <span className={`circuitkey__led${props.on ? ' circuitkey__led--on' : ''}`} />
        {props.icon}
      </span>
    </button>
  )
}

export function GainKey({ db, onOpen, className }: { db: number; onOpen: () => void; className?: string }) {
  return (
    <FunctionKey
      id="gain-button"
      caption="GAIN"
      on={db !== 0}
      icon={<SpeakerIcon level={db < -12 ? 0 : db < 0 ? 1 : 2} className="fkey__icon" />}
      label={`Gain: output volume ${formatDb(db)}. Open gain`}
      title={`Output volume ${formatDb(db)}`}
      className={className}
      onOpen={onOpen}
    />
  )
}

/** PATTERN opens the pattern sheet (presets, swing and grid); lit while the pattern swings or a preset is applied. */
export function PatternKey({ swing, on, onOpen, className }: { swing: number; on: boolean; onOpen: () => void; className?: string }) {
  return (
    <FunctionKey
      id="pattern-button"
      caption="PATTERN"
      on={on}
      icon={<NoteIcon className="fkey__icon" />}
      label={`Pattern: presets and swing, ${swing > 50 ? `${swing}% swing` : 'straight'}. Open pattern`}
      className={className}
      onOpen={onOpen}
    />
  )
}

/** PITCH is lit while the overall pitch or any step pitch is off zero. */
export function PitchKey(props: { cents: number; on: boolean; stepped: boolean; disabled: boolean; onOpen: () => void; className?: string }) {
  const value = formatSemitones(props.cents)
  return (
    <FunctionKey
      id="pitch-button"
      caption="PITCH"
      on={props.on}
      icon={<PitchIcon className="fkey__icon" />}
      label={`Pitch${props.stepped ? ', selected instrument has step pitch offsets' : ''}. Overall ${value}`}
      title={`Overall ${value}`}
      disabled={props.disabled}
      className={props.className}
      onOpen={props.onOpen}
    />
  )
}

export function EchoKey({ echo, disabled, onOpen, className }: { echo: EchoState | null; disabled: boolean; onOpen: () => void; className?: string }) {
  const value = echo ? echoKeyValue(echo) : 'OFF'
  return (
    <FunctionKey
      id="echo-button"
      caption="ECHO"
      captionClass="fkey__cap--echo"
      on={!!echo?.on}
      icon={<EchoIcon className="fkey__icon" />}
      label={`Tape echo, ${echo?.on ? (value === 'ON' ? 'on' : `mode ${value.slice(1)}`) : 'off'}. Open echo`}
      title={echo?.on ? (value === 'ON' ? 'On' : `Mode ${value.slice(1)}`) : 'Off'}
      disabled={disabled}
      className={className}
      onOpen={onOpen}
    />
  )
}
