import { useRef } from 'react'
import type { Slot } from '../contract/types'
import { TRACK_GAIN_MAX_DB, TRACK_GAIN_MIN_DB, type TrackState } from '../state/pattern'
import { iconFor } from '../data/catalog'
import { formatDb } from './VolumeSheet'
import { INSTRUMENT_ICONS } from './icons'
import { useThrottle } from './hooks'

export type MixerMode = 'drums' | 'steps'

/** Tab arrow drawn like the mock's long arrow, pointing into or out of the mixer. */
const TabArrow = ({ dir }: { dir: 'left' | 'right' }) => (
  <svg viewBox="0 0 32 16" width="32" height="16" aria-hidden="true" focusable="false">
    <path d={dir === 'right' ? 'M2 8h27M22 2l7 6-7 6' : 'M30 8H3M10 2 3 8l7 6'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/**
 * Desktop mixer. Closed, it is a tab at the left of the bottom row; open, it
 * replaces Groove, Save and the tempo keys so the panel height does not change.
 */
export function DesktopMixer(props: {
  open: boolean
  mode: MixerMode
  slots: Slot[]
  tracks: Record<string, TrackState>
  selected: Slot | null
  loopLength: number
  playing: boolean
  onOpen: () => void
  onMode: (mode: MixerMode) => void
  onClose: () => void
  onGain: (slotId: string, gainDb: number) => void
  onLevel: (step: number, level: number) => void
  onToggle: (step: number) => void
  onAudition: (slotId: string, step: number | null) => void
}) {
  const target = useRef<{ slotId: string; step: number | null } | null>(null)
  const audition = useThrottle(() => {
    const t = target.current
    if (!props.playing && t) requestAnimationFrame(() => props.onAudition(t.slotId, t.step))
  }, 160)
  if (!props.open) {
    return (
      <button type="button" id="mixer-open-button" className="mixer-tab mixer-tab--open" aria-label="Open mixer" aria-expanded={false} onClick={props.onOpen}>
        <span className="mixer-tab__text">Mixer</span>
        <TabArrow dir="right" />
      </button>
    )
  }
  const stepMode = props.mode === 'steps'
  const track = props.selected && props.tracks[props.selected.id]
  const cells = stepMode ? Array.from({ length: 16 }, (_, i) => i) : props.slots
  const title = stepMode ? `${props.selected?.label ?? ''} step levels` : 'Mixer'
  return (
    <section className="desktop-mixer" id="desktop-mixer" aria-label={title}>
      <span className="bay__cap" aria-hidden="true">{title}</span>
      <div className="desktop-mixer__modes" role="radiogroup" aria-label="Mixer mode">
        <button type="button" role="radio" className={`tkey mixer-mode${stepMode ? '' : ' tkey--latched'}`} aria-checked={!stepMode} title="Volume of each drum" onClick={() => props.onMode('drums')}>Drums</button>
        <button type="button" role="radio" className={`tkey mixer-mode${stepMode ? ' tkey--latched' : ''}`} aria-checked={stepMode} title={`Level of each ${props.selected?.label ?? ''} step`} onClick={() => props.onMode('steps')}>Steps</button>
      </div>
      <div className={`desktop-mixer__channels${stepMode ? ' desktop-mixer__channels--steps' : ''}`} style={{ ['--channels' as string]: cells.length }}>
        {cells.map((cell) => {
          const step = typeof cell === 'number' ? cell : null
          const slot = typeof cell === 'number' ? props.selected : cell
          if (!slot) return null
          const t = stepMode ? track : props.tracks[slot.id]
          if (!t) return null
          const Icon = INSTRUMENT_ICONS[iconFor(slot.icon)]
          const off = TRACK_GAIN_MIN_DB - 1
          const value = step !== null ? Math.round(t.levels[step] * 100) : t.gainDb === -Infinity ? off : t.gainDb
          const min = step !== null ? 0 : off
          const max = step !== null ? 100 : TRACK_GAIN_MAX_DB
          const label = step !== null ? `Step ${step + 1} level` : `${slot.label} volume`
          const stepOff = step !== null && !t.steps[step]
          return (
            <div className={`mixer-channel${step !== null && step >= props.loopLength ? ' mixer-channel--outside' : ''}${stepOff ? ' mixer-channel--off' : ''}`} key={step ?? slot.id}>
              {step !== null ? (
                <button type="button" className="mixer-channel__step" aria-label={`Step ${step + 1}`} aria-pressed={t.steps[step]} onClick={() => props.onToggle(step)}>
                  <span className="mixer-channel__num" aria-hidden="true">{step + 1}</span>
                  <span className={t.steps[step] ? 'mixer-led mixer-led--on' : 'mixer-led'} aria-hidden="true" />
                </button>
              ) : (
                <span className="mixer-channel__label" title={slot.label}><Icon />{slot.label}</span>
              )}
              <input
                type="range"
                className="fader fader--v"
                min={min}
                max={max}
                step={step !== null ? 5 : 0.5}
                value={value}
                disabled={stepOff}
                aria-label={label}
                aria-valuetext={step !== null ? `${value}%` : formatDb(t.gainDb)}
                title={stepOff ? `Step ${step! + 1} is off. Switch it on to set its level.` : undefined}
                style={{ ['--fill' as string]: `${(value - min) / (max - min) * 100}%` }}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (step !== null) props.onLevel(step, v / 100)
                  else props.onGain(slot.id, v <= off ? -Infinity : v)
                  target.current = { slotId: slot.id, step }
                  audition()
                }}
              />
              <output>{step !== null ? `${value}%` : formatDb(t.gainDb)}</output>
            </div>
          )
        })}
      </div>
      <button type="button" className="mixer-tab mixer-tab--close" aria-expanded={true} aria-controls="desktop-mixer" aria-label="Close mixer" onClick={props.onClose}>
        <TabArrow dir="left" />
      </button>
    </section>
  )
}
