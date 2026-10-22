// Tape echo panel: the RE-201's controls (heads and spring for the MODE
// SELECTOR, REPEAT RATE, INTENSITY, the volumes, BASS, TREBLE, INPUT), tempo
// sync, tape condition and a send per instrument. Settings live in the pattern.
import { useRef } from 'react'
import type { Slot } from '../contract/types'
import { iconFor } from '../data/catalog'
import type { TrackState } from '../state/pattern'
import {
  ECHO_HEAD_DELAYS_SEC, ECHO_SYNC_NAMES, TAPE_CONDITIONS, hardwareMode, leadingHead, rateForSpeed,
  syncAvailable, targetSpeed, type EchoState, type EchoSync,
} from '../audio/echo/settings'
import { TONE_RANGE_DB } from '../audio/echo/dsp'
import { Sheet } from './Sheet'
import { INSTRUMENT_ICONS, TriangleIcon } from './icons'

const SWEEP_DEG = 135
/** Pixels of vertical drag for the whole knob range; Shift drags five times finer. */
const DRAG_PX = 200

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

export function EchoKnob(props: {
  id: string
  caption: string
  label: string
  value: number
  text: string
  /** Value restored by a double click. */
  initial: number
  dim?: boolean
  onChange: (value: number) => void
}) {
  const { value } = props
  const drag = useRef<{ id: number; y: number; v: number } | null>(null)
  const apply = (v: number) => {
    const next = Math.min(1, Math.max(0, Math.round(v * 100) / 100))
    if (next !== value) props.onChange(next)
  }
  return (
    <div className={`eknob${props.dim ? ' eknob--dim' : ''}`}>
      <span className="eknob__cap" aria-hidden="true">{props.caption}</span>
      <div
        id={props.id}
        className="knob__dial eknob__dial"
        role="slider"
        tabIndex={0}
        aria-label={props.label}
        aria-valuemin={0}
        aria-valuemax={10}
        aria-valuenow={Number(tenths(value))}
        aria-valuetext={props.text}
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
          apply(next)
          drag.current = { ...d, y: e.clientY, v: Math.min(1, Math.max(0, next)) }
        }}
        onPointerUp={(e) => { if (drag.current?.id === e.pointerId) drag.current = null }}
        onPointerCancel={(e) => { if (drag.current?.id === e.pointerId) drag.current = null }}
        onLostPointerCapture={() => { drag.current = null }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.01 : 0.05
          let next: number | null = null
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value + step
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value - step
          else if (e.key === 'PageUp') next = value + 0.1
          else if (e.key === 'PageDown') next = value - 0.1
          else if (e.key === 'Home') next = 0
          else if (e.key === 'End') next = 1
          if (next === null) return
          e.preventDefault()
          apply(next)
        }}
      >
        <span className="knob__ticks" aria-hidden="true" />
        <span className="knob__pointer" aria-hidden="true" style={{ transform: `rotate(${(value * 2 - 1) * SWEEP_DEG}deg)` }} />
        <span className="knob__cap" aria-hidden="true" />
      </div>
      <output className="eknob__value" htmlFor={props.id}>{props.text}</output>
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
  const knob = (key: 'intensity' | 'echo' | 'reverb' | 'input', caption: string, label: string, initial: number, text = tenths(echo[key])) => (
    <EchoKnob id={`echo-${key}`} caption={caption} label={label} value={echo[key]} text={text} initial={initial}
      dim={(key === 'echo' || key === 'intensity') ? lead < 0 : key === 'reverb' ? !echo.spring : false}
      onChange={(v) => props.onChange({ [key]: v })} />
  )
  return (
    <Sheet open={props.open} onClose={props.onClose} title="Echo" closeLabel="Done" className="sheet--echo" returnFocusId="echo-button">
      <div className="echo__mode">
        <button type="button" className={`tkey echo__power${echo.on ? ' tkey--latched' : ''}`} aria-pressed={echo.on}
          aria-label="Echo on" data-autofocus="" onClick={() => props.onChange({ on: !echo.on })}>
          <Led on={echo.on} />
          {echo.on ? 'ON' : 'OFF'}
        </button>
        <div className="echo__readout readout" role="status" aria-label={mode === null ? 'No hardware mode' : `Mode ${mode}`}>
          <span className="readout__cap" aria-hidden="true">Mode</span>
          <span className="echo__mode-num" aria-hidden="true">{mode ?? '–'}</span>
        </div>
        <div className="echo__heads" role="group" aria-label="Playback heads and reverb">
          {[0, 1, 2].map((i) => (
            <button key={i} type="button" className={`tkey echo__head${echo.heads[i] ? ' tkey--latched' : ''}`}
              aria-pressed={echo.heads[i]} aria-label={`Head ${i + 1}`} onClick={() => setHead(i)}>
              <span className="tkey__caption echo__key-cap"><Led on={echo.heads[i]} />HEAD</span>
              <span className="tkey__label tkey__label--big">{i + 1}</span>
            </button>
          ))}
          <button type="button" className={`tkey echo__head echo__spring${echo.spring ? ' tkey--latched' : ''}`}
            aria-pressed={echo.spring} aria-label="Spring reverb" onClick={() => props.onChange({ spring: !echo.spring })}>
            <span className="tkey__caption echo__key-cap"><Led on={echo.spring} />REVERB</span>
            <span className="echo__spring-icon" aria-hidden="true">
              <svg viewBox="0 0 40 16" width="36" height="14"><path d="M2 8c3-6 5-6 6 0s3 6 6 0 3-6 6 0 3 6 6 0 3-6 6 0 3 6 6 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </span>
          </button>
        </div>
      </div>

      <div className="echo__knobs">
        <EchoKnob id="echo-rate" caption="Repeat" label="Repeat rate" value={rateShown} initial={0.5} dim={lead < 0}
          text={ms === null ? '–' : echo.sync ? echo.sync : `${ms} ms`}
          onChange={(v) => props.onChange({ rate: v, sync: null })} />
        {knob('intensity', 'Intensity', 'Intensity', 0.35)}
        {knob('echo', 'Echo', 'Echo volume', 0.5)}
        {knob('reverb', 'Reverb', 'Reverb volume', 0.4)}
        <EchoKnob id="echo-bass" caption="Bass" label="Bass" value={echo.bass} text={toneDb(echo.bass)} initial={0.5} dim={lead < 0}
          onChange={(v) => props.onChange({ bass: v })} />
        <EchoKnob id="echo-treble" caption="Treble" label="Treble" value={echo.treble} text={toneDb(echo.treble)} initial={0.5} dim={lead < 0}
          onChange={(v) => props.onChange({ treble: v })} />
        {knob('input', 'Input', 'Input volume', 0.5)}
        <div className="eknob echo__tape" role="radiogroup" aria-label="Tape">
          <span className="eknob__cap" aria-hidden="true">Tape</span>
          {TAPE_CONDITIONS.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={echo.tape === t}
              className={`tkey echo__tape-key${echo.tape === t ? ' tkey--latched' : ''}`} onClick={() => props.onChange({ tape: t })}>
              <Led on={echo.tape === t} />{t.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="echo__sync" role="group" aria-label="Tempo sync">
        <button type="button" className="tkey tkey--arrow" aria-label="Previous sync value" disabled={syncIndex <= 0}
          onClick={() => props.onChange({ sync: syncs[syncIndex - 1] })}>
          <TriangleIcon dir="left" />
        </button>
        <div className={`echo__sync-value readout${syncOk ? '' : ' echo__sync-value--out'}`} aria-live="polite">
          <span className="readout__cap">Sync</span>
          <span className="echo__sync-text">{echo.sync ?? 'FREE'}</span>
        </div>
        <button type="button" className="tkey tkey--arrow" aria-label="Next sync value" disabled={syncIndex >= syncs.length - 1}
          onClick={() => props.onChange({ sync: syncs[syncIndex + 1] })}>
          <TriangleIcon dir="right" />
        </button>
        <output className="echo__sync-ms" aria-label="Repeat time">{echo.sync && ms !== null ? `${ms} ms` : ''}</output>
      </div>

      <h3 className="echo__sends-h">Sends</h3>
      <div className="echo__sends">
        {props.slots.map((slot) => {
          const track = props.tracks[slot.id]
          if (!track) return null
          const Icon = INSTRUMENT_ICONS[iconFor(slot.icon)]
          const pct = Math.round(track.echoSend * 100)
          return (
            <div className="echo__send" key={slot.id}>
              <span className="echo__send-label" title={slot.label}><Icon />{slot.label}</span>
              <input type="range" className="fader fader--h" min={0} max={100} step={1} value={pct}
                aria-label={`${slot.label} echo send`} aria-valuetext={`${pct}%`}
                style={{ ['--fill' as string]: `${pct}%`, ['--unity' as string]: '-4px' }}
                onChange={(e) => props.onSend(slot.id, Number(e.target.value) / 100)} />
              <output className="echo__send-value">{pct}%</output>
            </div>
          )
        })}
      </div>
    </Sheet>
  )
}
