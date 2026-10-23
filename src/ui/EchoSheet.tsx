// Tape echo panel, laid out like the unit: POWER, the TAPE HEADS keys and VERB on top, two banks
// of knobs (REPEAT RATE, INTENSITY, the volumes, BASS, TREBLE, INPUT and the MODE SELECTOR), tape
// condition and tempo sync at the foot, and a send per instrument. Settings live in the pattern.
import { useRef, type KeyboardEvent } from 'react'
import type { Slot } from '../contract/types'
import type { TrackState } from '../state/pattern'
import {
  ECHO_HEAD_DELAYS_SEC, ECHO_SYNC_NAMES, TAPE_CONDITIONS, hardwareMode, headsForMode, leadingHead, rateForSpeed,
  syncAvailable, targetSpeed, type EchoState, type EchoSync, type TapeCondition,
} from '../audio/echo/settings'
import { TONE_RANGE_DB } from '../audio/echo/dsp'
import specO from '../assets/spec-o.webp'
import { Sheet } from './Sheet'
import { TriangleIcon } from './icons'

const SWEEP_DEG = 135
/** Pixels of vertical drag for the whole knob range; Shift drags five times finer. */
const DRAG_PX = 200
/** Scale marks on a continuous knob. */
const KNOB_TICKS = 11
const MODES = 12
/** Tape positions left to right on the switch. */
const TAPE_ORDER: TapeCondition[] = [...TAPE_CONDITIONS].reverse()

// Load the panel face with the app, so the sheet never opens with its lettering still blank.
if (typeof document !== 'undefined') void document.fonts?.load('16px Pragmasevka').catch(() => {})

const tenths = (v: number) => (v * 10).toFixed(1)
const Led = ({ on }: { on: boolean }) => <span className={`circuitkey__led${on ? ' circuitkey__led--on' : ''}`} aria-hidden="true" />
const toneDb = (v: number) => {
  const db = (v - 0.5) * 2 * TONE_RANGE_DB
  return `${db > 0.05 ? '+' : db < -0.05 ? '−' : ''}${Math.abs(db).toFixed(1)} dB`
}

/** Repeat time of the earliest active head at the target tape speed. */
export function echoRepeatMs(e: EchoState, bpm: number): number | null {
  const h = leadingHead(e.heads)
  return h < 0 ? null : Math.round((ECHO_HEAD_DELAYS_SEC[h] / targetSpeed(e, bpm)) * 1000)
}

/** Short state for the panel key: OFF, the MODE SELECTOR position, or ON for combinations the hardware lacks. */
export function echoKeyValue(e: EchoState): string {
  if (!e.on) return 'OFF'
  const mode = hardwareMode(e.heads, e.spring)
  return mode === null ? 'ON' : `M${mode}`
}

/** Scale ring and tick marks around a dial, in a 100-unit box. */
function KnobScale({ ticks }: { ticks: number }) {
  const marks = Array.from({ length: ticks }, (_, i) => {
    const a = ((-SWEEP_DEG + (i * 2 * SWEEP_DEG) / (ticks - 1) - 90) * Math.PI) / 180
    return <line key={i} x1={50 + 45 * Math.cos(a)} y1={50 + 45 * Math.sin(a)} x2={50 + 49.5 * Math.cos(a)} y2={50 + 49.5 * Math.sin(a)} />
  })
  return (
    <svg className="eknob__scale" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="42.5" />
      {marks}
    </svg>
  )
}

export function EchoKnob(props: {
  id: string
  caption: string
  label: string
  value: number
  text: string
  /** Value restored by a double click. */
  initial: number
  dim?: boolean
  /** Click positions of a stepped switch (the MODE SELECTOR); continuous when absent. */
  steps?: number
  /** Hides the pointer when the setting has no position on this knob. */
  free?: boolean
  /** Slider values for assistive tech; 0-10 in tenths and `text` when absent. */
  aria?: { min: number; max: number; now: number; text?: string }
  onChange: (value: number) => void
}) {
  const { value, steps } = props
  const drag = useRef<{ id: number; y: number; v: number } | null>(null)
  const apply = (v: number) => {
    const c = Math.min(1, Math.max(0, v))
    const next = steps ? Math.round(c * (steps - 1)) / (steps - 1) : Math.round(c * 100) / 100
    if (next !== value || props.free) props.onChange(next)
  }
  const aria = props.aria ?? { min: 0, max: 10, now: Number(tenths(value)) }
  return (
    <div className={`eknob${props.dim ? ' eknob--dim' : ''}${props.free ? ' eknob--free' : ''}`}>
      <span className="eknob__cap" aria-hidden="true">{props.caption}</span>
      <div className="eknob__well">
        <div
          id={props.id}
          className="eknob__dial"
          role="slider"
          tabIndex={0}
          aria-label={props.label}
          aria-valuemin={aria.min}
          aria-valuemax={aria.max}
          aria-valuenow={aria.now}
          aria-valuetext={aria.text ?? props.text}
          aria-orientation="vertical"
          onDoubleClick={() => apply(props.initial)}
          onPointerDown={(e) => {
            if (e.button !== 0 || !e.isPrimary || drag.current) return
            e.preventDefault()
            e.currentTarget.focus({ preventScroll: true })
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = { id: e.pointerId, y: e.clientY, v: value }
          }}
          onPointerMove={(e) => {
            const d = drag.current
            if (!d || d.id !== e.pointerId) return
            const next = d.v + (d.y - e.clientY) / (DRAG_PX * (e.shiftKey ? 5 : 1))
            if (Math.abs(next - value) * (steps ? steps - 1 : 100) >= 0.5) apply(next)
            drag.current = { ...d, y: e.clientY, v: Math.min(1, Math.max(0, next)) }
          }}
          onPointerUp={(e) => { if (drag.current?.id === e.pointerId) drag.current = null }}
          onPointerCancel={(e) => { if (drag.current?.id === e.pointerId) drag.current = null }}
          onLostPointerCapture={() => { drag.current = null }}
          onKeyDown={(e) => {
            const click = steps ? 1 / (steps - 1) : 0
            const step = click || (e.shiftKey ? 0.01 : 0.05)
            let next: number | null = null
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value + step
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value - step
            else if (e.key === 'PageUp') next = value + Math.max(step, 0.1)
            else if (e.key === 'PageDown') next = value - Math.max(step, 0.1)
            else if (e.key === 'Home') next = 0
            else if (e.key === 'End') next = 1
            if (next === null) return
            e.preventDefault()
            apply(next)
          }}
        >
          <KnobScale ticks={steps ?? KNOB_TICKS} />
          <span className="eknob__body" aria-hidden="true" style={{ transform: `rotate(${(value * 2 - 1) * SWEEP_DEG}deg)` }} />
        </div>
      </div>
      <output className="eknob__value" htmlFor={props.id}>{props.text}</output>
    </div>
  )
}

/** Bat-handle toggle with its lamp; the whole plate is the switch. */
function Toggle(props: { id: string; on: boolean; label: string; autofocus?: boolean; onToggle: () => void }) {
  return (
    <button type="button" id={props.id} role="switch" aria-checked={props.on} aria-label={props.label}
      className={`echo__plate etoggle${props.on ? ' etoggle--on' : ''}`} data-autofocus={props.autofocus ? '' : undefined}
      onClick={props.onToggle}>
      <span className="etoggle__base" aria-hidden="true"><span className="etoggle__bat" /></span>
      <span className="etoggle__lamp" aria-hidden="true" />
    </button>
  )
}

/** Three-position slide switch for the tape condition (a radio group: arrows move the slider). */
function TapeSwitch(props: { value: TapeCondition; onChange: (t: TapeCondition) => void }) {
  const at = TAPE_ORDER.indexOf(props.value)
  const keys = useRef<(HTMLButtonElement | null)[]>([])
  const move = (e: KeyboardEvent, d: number) => {
    e.preventDefault()
    const i = Math.min(TAPE_ORDER.length - 1, Math.max(0, at + d))
    props.onChange(TAPE_ORDER[i])
    keys.current[i]?.focus()
  }
  return (
    <div className="echo__plate echo__plate--slate etape" role="radiogroup" aria-labelledby="echo-tape-l"
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(e, 1)
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(e, -1)
      }}>
      <span className="etape__slot" aria-hidden="true">
        <span className="etape__thumb" style={{ left: `${((at + 0.5) / TAPE_ORDER.length) * 100}%` }} />
      </span>
      {TAPE_ORDER.map((t, i) => (
        <button key={t} ref={(el) => { keys.current[i] = el }} type="button" role="radio" aria-checked={i === at}
          tabIndex={i === at ? 0 : -1} className="etape__pos" onClick={() => props.onChange(t)}>
          {t.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

/** Panel key that opens the echo sheet; its value shows OFF or the MODE position. */
export function EchoSheet(props: {
  open: boolean
  onClose: () => void
  echo: EchoState
  bpm: number
  slots: Slot[]
  tracks: Record<string, TrackState>
  onChange: (patch: Partial<EchoState>) => void
  onSend: (slotId: string, send: number) => void
}) {
  const { echo, bpm } = props
  const mode = hardwareMode(echo.heads, echo.spring)
  // A head set the MODE SELECTOR lacks (1+2, 1+3, 1+2+3 without reverb, or nothing) parks the knob at the same heads with reverb.
  const modeAt = (mode ?? hardwareMode(echo.heads, true) ?? MODES) - 1
  const lead = leadingHead(echo.heads)
  const ms = echoRepeatMs(echo, bpm)
  const syncOk = echo.sync ? syncAvailable(echo.sync, echo.heads, bpm) : true
  // Free, then the note values the earliest active head can reach at this tempo; the current one stays listed.
  const syncs: (EchoSync | null)[] = [null, ...ECHO_SYNC_NAMES.filter((s) => s === echo.sync || syncAvailable(s, echo.heads, bpm))]
  const syncIndex = syncs.indexOf(echo.sync)
  const rateShown = echo.sync ? rateForSpeed(targetSpeed(echo, bpm)) : echo.rate
  const setHead = (i: number) => {
    const heads = [...echo.heads] as EchoState['heads']
    heads[i] = !heads[i]
    props.onChange({ heads })
  }
  const knob = (key: 'intensity' | 'echo' | 'reverb' | 'input', caption: string, label: string, initial: number) => (
    <EchoKnob id={`echo-${key}`} caption={caption} label={label} value={echo[key]} text={tenths(echo[key])} initial={initial}
      dim={(key === 'echo' || key === 'intensity') ? lead < 0 : key === 'reverb' ? !echo.spring : false}
      onChange={(v) => props.onChange({ [key]: v })} />
  )
  return (
    <Sheet open={props.open} onClose={props.onClose} title="Echo" className="sheet--echo" returnFocusId="echo-button">
      {/* Wide sheets: the unit on the left, the sends on the right. */}
      <div className="echo__layout">
        <div className="echo__unit">
          <div className="echo__top">
            <div className="echo__cell">
              <span className="echo__label" aria-hidden="true">Power</span>
              <Toggle id="echo-power" on={echo.on} label="Echo power" autofocus onToggle={() => props.onChange({ on: !echo.on })} />
            </div>
            <div className="echo__cell">
              <span className="echo__label" aria-hidden="true">Tape heads</span>
              <div className="echo__plate echo__heads" role="group" aria-label="Tape heads">
                {[0, 1, 2].map((i) => (
                  <button key={i} type="button" className={`tkey echo__head${echo.heads[i] ? ' tkey--latched' : ''}`}
                    aria-pressed={echo.heads[i]} aria-label={`Head ${i + 1}`} onClick={() => setHead(i)}>
                    <span className="echo__head-cap"><Led on={echo.heads[i]} />HEAD</span>
                    <span className="echo__head-num">{i + 1}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="echo__cell">
              <span className="echo__label" aria-hidden="true">Verb</span>
              <Toggle id="echo-spring" on={echo.spring} label="Spring reverb" onToggle={() => props.onChange({ spring: !echo.spring })} />
            </div>
          </div>

          <div className="echo__bank">
            <EchoKnob id="echo-rate" caption="Repeat" label="Repeat rate" value={rateShown} initial={0.5} dim={lead < 0}
              text={ms === null ? '–' : `${ms} ms`}
              onChange={(v) => props.onChange({ rate: v, sync: null })} />
            {knob('intensity', 'Intensity', 'Intensity', 0.35)}
            {knob('echo', 'Echo', 'Echo volume', 0.5)}
            {knob('reverb', 'Reverb', 'Reverb volume', 0.4)}
          </div>
          <div className="echo__bank">
            <EchoKnob id="echo-bass" caption="Bass" label="Bass" value={echo.bass} text={toneDb(echo.bass)} initial={0.5} dim={lead < 0}
              onChange={(v) => props.onChange({ bass: v })} />
            <EchoKnob id="echo-treble" caption="Treble" label="Treble" value={echo.treble} text={toneDb(echo.treble)} initial={0.5} dim={lead < 0}
              onChange={(v) => props.onChange({ treble: v })} />
            {knob('input', 'Input', 'Input volume', 0.5)}
            <EchoKnob id="echo-mode" caption="Mode" label="Mode selector" value={modeAt / (MODES - 1)} steps={MODES} initial={0}
              free={mode === null} text={mode === null ? '–' : String(mode)} aria={{ min: 1, max: MODES, now: mode ?? modeAt + 1, text: mode === null ? 'No mode' : `Mode ${mode}` }}
              onChange={(v) => props.onChange(headsForMode(Math.round(v * (MODES - 1)) + 1))} />
          </div>

          <div className="echo__foot">
            <img className="echo__logo" src={specO} alt="V.D.V.M SPEC-O" width={480} height={429} draggable={false} />
            <div className="echo__cell echo__cell--tape">
              <span className="echo__label" id="echo-tape-l">Tape</span>
              <TapeSwitch value={echo.tape} onChange={(tape) => props.onChange({ tape })} />
            </div>
            <div className="echo__cell echo__cell--sync">
              <span className="echo__label" aria-hidden="true">Sync</span>
              <div className="echo__plate echo__plate--slate echo__sync" role="group" aria-label="Tempo sync">
                <button type="button" className="tkey tkey--arrow" aria-label="Previous sync value" disabled={syncIndex <= 0}
                  onClick={() => props.onChange({ sync: syncs[syncIndex - 1] })}>
                  <TriangleIcon dir="left" />
                </button>
                <div className={`echo__sync-value${syncOk ? '' : ' echo__sync-value--out'}`} aria-live="polite">
                  <span className="echo__sync-cap">Sync</span>
                  <span className="echo__sync-text">{echo.sync ?? 'FREE'}</span>
                </div>
                <button type="button" className="tkey tkey--arrow" aria-label="Next sync value" disabled={syncIndex >= syncs.length - 1}
                  onClick={() => props.onChange({ sync: syncs[syncIndex + 1] })}>
                  <TriangleIcon dir="right" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <section className="echo__sends" aria-label="Echo sends">
          {props.slots.map((slot) => {
            const track = props.tracks[slot.id]
            if (!track) return null
            const pct = Math.round(track.echoSend * 100)
            return (
              <div className="echo__send" key={slot.id}>
                <span className="echo__send-label" title={slot.label}>{slot.label}</span>
                <div className="echo__send-track">
                  <input type="range" className="efader" min={0} max={100} step={1} value={pct}
                    aria-label={`${slot.label} echo send`} aria-valuetext={`${pct}%`}
                    style={{ ['--fill' as string]: `calc(12px + (100% - 24px) * ${pct / 100})` }}
                    onChange={(e) => props.onSend(slot.id, Number(e.target.value) / 100)} />
                  <output className="echo__send-value">{pct}</output>
                </div>
              </div>
            )
          })}
        </section>
      </div>
    </Sheet>
  )
}
