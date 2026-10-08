// Controlled rotary tuning control + a paired numeric input. The value lives in
// pattern state; this component only displays it and reports edits.
import { useEffect, useRef, useState } from 'react'
import { PITCH_MAX_CENTS, PITCH_MIN_CENTS, clampPitchCents } from '../audio/pitch'

/** Dial sweep at the limits: −135° at −12 st, 0° at 0, +135° at +12 st. */
const SWEEP_DEG = 135
const COARSE_CENTS_PER_PX = 10
const FINE_CENTS_PER_PX = 1

/** Signed semitones, e.g. `+2.0 st`, `−0.5 st`, `0.0 st`; cents are exact, never rounded away. */
export function formatSemitones(cents: number, withUnit = true): string {
  const sign = cents > 0 ? '+' : cents < 0 ? '−' : ''
  let text = (Math.abs(cents) / 100).toFixed(2)
  if (text.endsWith('0')) text = text.slice(0, -1)
  return withUnit ? `${sign}${text} st` : `${sign}${text}`
}

/** Parse a semitone text field to integer cents, or null when it is not a finite number. */
export function semitonesToCents(text: string): number | null {
  if (text.trim() === '') return null
  const value = Number(text.trim().replace('−', '-').replace(',', '.'))
  if (!Number.isFinite(value)) return null
  return clampPitchCents(Math.round(value * 100))
}

export function PitchKnob(props: {
  id: string
  label: string
  value: number
  onChange: (cents: number) => void
  autoFocus?: boolean
}) {
  const { value } = props
  // A number input rejects the typographic minus and explicit plus used in readouts.
  const [text, setText] = useState(() => String(value / 100))
  const [editing, setEditing] = useState(false)
  const discard = useRef(false)
  const drag = useRef<{ id: number; startY: number; startCents: number } | null>(null)

  useEffect(() => {
    if (!editing) setText(String(value / 100))
  }, [value, editing])

  const apply = (next: number) => {
    const cents = clampPitchCents(next)
    if (cents !== value) props.onChange(cents)
  }
  const angle = (value / PITCH_MAX_CENTS) * SWEEP_DEG

  return (
    <div className="knob">
      <div
        id={props.id}
        className="knob__dial"
        role="slider"
        tabIndex={0}
        aria-label={props.label}
        aria-valuemin={PITCH_MIN_CENTS / 100}
        aria-valuemax={PITCH_MAX_CENTS / 100}
        aria-valuenow={value / 100}
        aria-valuetext={formatSemitones(value)}
        aria-orientation="vertical"
        data-autofocus={props.autoFocus ? '' : undefined}
        onPointerDown={(e) => {
          if (e.button !== 0 || !e.isPrimary || drag.current) return
          e.preventDefault()
          e.currentTarget.focus({ preventScroll: true })
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { id: e.pointerId, startY: e.clientY, startCents: value }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d || d.id !== e.pointerId) return
          const perPx = e.shiftKey ? FINE_CENTS_PER_PX : COARSE_CENTS_PER_PX
          const raw = d.startCents + (d.startY - e.clientY) * perPx
          apply(e.shiftKey ? raw : Math.round(raw / COARSE_CENTS_PER_PX) * COARSE_CENTS_PER_PX)
          // Re-anchor so changing Shift mid-drag does not jump the value.
          drag.current = { ...d, startY: e.clientY, startCents: clampPitchCents(raw) }
        }}
        onPointerUp={(e) => {
          if (drag.current?.id === e.pointerId) drag.current = null
        }}
        onPointerCancel={(e) => {
          if (drag.current?.id === e.pointerId) drag.current = null
        }}
        onLostPointerCapture={() => {
          drag.current = null
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 1 : 10
          let next: number | null = null
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value + step
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value - step
          else if (e.key === 'PageUp') next = value + 100
          else if (e.key === 'PageDown') next = value - 100
          else if (e.key === 'Home') next = PITCH_MIN_CENTS
          else if (e.key === 'End') next = PITCH_MAX_CENTS
          if (next === null) return
          e.preventDefault()
          apply(next)
        }}
      >
        <span className="knob__ticks" aria-hidden="true" />
        <span className="knob__pointer" aria-hidden="true" style={{ transform: `rotate(${angle}deg)` }} />
        <span className="knob__cap" aria-hidden="true" />
      </div>
      <div className="knob__entry">
        <button type="button" className="knob__nudge" aria-label={`Lower ${props.label.toLowerCase()} by one semitone`} disabled={value <= PITCH_MIN_CENTS} onClick={() => apply(value - 100)}>−</button>
        <input
          id={`${props.id}-input`}
          className="knob__input"
          type="number"
          inputMode="decimal"
          min={-12}
          max={12}
          step={0.1}
          aria-label={`${props.label} semitones`}
          value={text}
          onFocus={(e) => { discard.current = false; setEditing(true); e.currentTarget.select() }}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const cents = discard.current ? null : semitonesToCents(text)
            setText(String((cents ?? value) / 100))
            if (cents !== null) apply(cents)
            discard.current = false
            setEditing(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              discard.current = true
              e.currentTarget.blur()
            }
          }}
        />
        <button type="button" className="knob__nudge" aria-label={`Raise ${props.label.toLowerCase()} by one semitone`} disabled={value >= PITCH_MAX_CENTS} onClick={() => apply(value + 100)}>+</button>
      </div>
    </div>
  )
}
