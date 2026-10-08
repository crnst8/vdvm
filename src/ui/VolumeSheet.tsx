// Drum volume and per-step levels for one instrument. Opened by holding a tile
// or step key (or right-click / V / the library). Changes apply immediately.
import { useEffect, useRef, useState } from 'react'
import type { Slot } from '../contract/types'
import { iconFor } from '../data/catalog'
import { PAGE_SIZE, STEPS, TRACK_GAIN_MAX_DB, TRACK_GAIN_MIN_DB, type TrackState } from '../state/pattern'
import { Sheet } from './Sheet'
import { INSTRUMENT_ICONS } from './icons'
import { useThrottle } from './hooks'

/** Fader position one notch below the minimum means off. */
const OFF_POS = TRACK_GAIN_MIN_DB - 1

export const formatDb = (db: number) =>
  db === -Infinity ? 'Off' : `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)} dB`

export function VolumeSheet(props: {
  open: boolean
  onClose: () => void
  slot: Slot | null
  track: TrackState | null
  /** Step the sheet was opened from, or null when opened from the drum. */
  focusStep: number | null
  loopLength: number
  playing: boolean
  onGain: (db: number) => void
  onLevel: (step: number, level: number) => void
  onToggleStep: (step: number) => void
  onReset: () => void
  onAudition: (step: number | null) => void
  onEditPitch: () => void
}) {
  const { slot, track } = props
  const [page, setPage] = useState(0)
  const auditionTarget = useRef<number | null>(null)
  const audition = useThrottle(() => {
    // While playing, the loop itself is the preview.
    if (!props.playing) props.onAudition(auditionTarget.current)
  }, 160)

  useEffect(() => {
    if (props.open) setPage(props.focusStep !== null ? Math.floor(props.focusStep / PAGE_SIZE) : 0)
  }, [props.open, props.focusStep])

  if (!slot || !track) return <Sheet open={false} onClose={props.onClose} title="" children={null} />
  const Icon = INSTRUMENT_ICONS[iconFor(slot.icon)]
  const gainPos = track.gainDb === -Infinity ? OFF_POS : track.gainDb
  const pct = (gainPos - OFF_POS) / (TRACK_GAIN_MAX_DB - OFF_POS)
  const unity = (0 - OFF_POS) / (TRACK_GAIN_MAX_DB - OFF_POS)
  const cells = Array.from({ length: PAGE_SIZE }, (_, i) => page * PAGE_SIZE + i)
  const changed = track.gainDb !== 0 || track.levels.some((l) => l !== 1)

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title={`${slot.label} volume`}
      closeLabel="Done"
      className="sheet--volume"
      returnFocusId={props.focusStep === null ? `tile-${slot.id}` : `step-${props.focusStep}`}
      icon={<Icon className="sheet__icon" />}
    >
      <section className="vol__drum" aria-labelledby="vol-drum">
        <div className="vol__row">
          <h3 id="vol-drum">Drum volume</h3>
          <output className="vol__value" htmlFor="vol-gain">{formatDb(track.gainDb)}</output>
        </div>
        <input
          id="vol-gain"
          name="drum-volume"
          className="fader fader--h"
          type="range"
          min={OFF_POS}
          max={TRACK_GAIN_MAX_DB}
          step={0.5}
          value={gainPos}
          aria-valuetext={formatDb(track.gainDb)}
          data-autofocus={props.focusStep === null ? '' : undefined}
          style={{ ['--fill' as string]: `${pct * 100}%`, ['--unity' as string]: `${unity * 100}%` }}
          onChange={(e) => {
            const v = Number(e.target.value)
            props.onGain(v <= OFF_POS ? -Infinity : v)
            auditionTarget.current = null
            audition()
          }}
        />
        <div className="vol__scale" aria-hidden="true">
          <span>Off</span>
          <span style={{ left: `${unity * 100}%` }}>0 dB</span>
          <span>+{TRACK_GAIN_MAX_DB}</span>
        </div>
        <div className="vol__actions">
          <button type="button" onClick={() => props.onGain(0)} disabled={track.gainDb === 0}>
            Set 0 dB
          </button>
          <button type="button" onClick={props.onReset} disabled={!changed}>
            Reset drum and steps
          </button>
          <button type="button" onClick={props.onEditPitch}>
            Pitch
          </button>
        </div>
      </section>

      <section className="vol__steps" aria-labelledby="vol-steps">
        <div className="vol__row">
          <h3 id="vol-steps">Step levels</h3>
          <div className="vol__pages" role="group" aria-label="Step page">
            {[0, 1].map((p) => (
              <button key={p} type="button" aria-pressed={page === p} onClick={() => setPage(p)}>
                {p === 0 ? '1–8' : '9–16'}
              </button>
            ))}
          </div>
        </div>
        <div className="vol__grid">
          {cells.map((step) => {
            const on = track.steps[step]
            const level = track.levels[step]
            const outside = step >= props.loopLength
            return (
              <div
                key={step}
                className={`vcell${on ? ' vcell--on' : ''}${step === props.focusStep ? ' vcell--focus' : ''}${outside ? ' vcell--outside' : ''}`}
              >
                <button
                  type="button"
                  className="vcell__toggle"
                  aria-pressed={on}
                  aria-label={`Step ${step + 1} ${on ? 'on' : 'off'}${outside ? ', outside the loop' : ''}`}
                  onClick={() => props.onToggleStep(step)}
                >
                  <span className="vcell__led" aria-hidden="true" />
                  {step + 1}
                </button>
                <input
                  className="fader fader--v"
                  type="range"
                  name={`step-${step + 1}-level`}
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(level * 100)}
                  disabled={!on}
                  aria-label={`Step ${step + 1} level`}
                  aria-valuetext={`${Math.round(level * 100)}%`}
                  data-autofocus={step === props.focusStep ? '' : undefined}
                  style={{ ['--fill' as string]: `${level * 100}%` }}
                  onChange={(e) => {
                    props.onLevel(step, Number(e.target.value) / 100)
                    auditionTarget.current = step
                    audition()
                  }}
                />
                <span className="vcell__value" aria-hidden="true">{on ? `${Math.round(level * 100)}%` : 'off'}</span>
              </div>
            )
          })}
        </div>
        <p className="muted vol__hint">
          Tap a number to switch that step on or off. Changes apply as you move a fader.
          {props.loopLength < STEPS ? ' Steps 9–16 are outside the 8-step loop.' : ''}
        </p>
      </section>
    </Sheet>
  )
}
