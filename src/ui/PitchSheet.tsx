// Compact tuning panel. Text labels name controls; details stay in accessible names.
import { useEffect, useRef, useState } from 'react'
import type { Slot } from '../contract/types'
import { iconFor } from '../data/catalog'
import { STEPS, hitPitchCents, type TrackState } from '../state/pattern'
import { Sheet } from './Sheet'
import { PitchKnob, formatSemitones } from './PitchKnob'
import { INSTRUMENT_ICONS, SpeakerIcon, UndoIcon } from './icons'
import { useThrottleLatest } from './hooks'

export function PitchSheet(props: {
  open: boolean
  onClose: () => void
  slot: Slot | null
  track: TrackState | null
  pitchCents: number
  focusStep: number | null
  focus: 'overall' | 'step'
  loopLength: number
  playing: boolean
  canAudition: boolean
  auditionNote: string | null
  onPitch: (cents: number) => void
  onStepPitch: (step: number, cents: number) => void
  onToggleStep: (step: number) => void
  onResetStepPitches: () => void
  onAudition: (step: number | null) => void
}) {
  const { slot, track } = props
  const [step, setStep] = useState(() => props.focusStep ?? 0)
  const playingRef = useRef(props.playing)
  playingRef.current = props.playing
  const { call: preview, cancel: cancelPreview } = useThrottleLatest((target: number | null) => {
    if (props.open && props.canAudition && !playingRef.current) props.onAudition(target)
  }, 160)

  useEffect(() => {
    if (props.open) setStep(props.focusStep ?? 0)
  }, [props.open, props.focusStep, slot?.id])
  useEffect(() => {
    cancelPreview()
  }, [props.open, props.focusStep, slot?.id, props.playing, cancelPreview])

  const offset = track?.stepPitchCents[step] ?? 0
  const result = track ? hitPitchCents({ pitchCents: props.pitchCents }, track, step) : props.pitchCents
  const on = !!track?.steps[step]
  const Icon = slot ? INSTRUMENT_ICONS[iconFor(slot.icon)] : null
  const changeOverall = (cents: number) => { props.onPitch(cents); preview(null) }
  const changeStep = (cents: number) => { props.onStepPitch(step, cents); preview(step) }
  const audible = props.canAudition && !!track && track.gainDb !== -Infinity && track.levels[step] > 0
  const auditionLabel = props.auditionNote ?? (track?.levels[step] === 0 ? 'Step is muted' : `Audition step ${step + 1}`)

  return (
    <Sheet open={props.open} onClose={props.onClose} title="Pitch" closeLabel="Done"
      className="sheet--pitch" returnFocusId="pitch-button" icon={Icon ? <Icon className="sheet__icon" /> : undefined}>
      <div className={`pitch__controls${slot && track ? '' : ' pitch__controls--solo'}`}>
        <section className="pitch__control" aria-labelledby="pitch-overall-h">
          <div className="pitch__heading">
            <h3 id="pitch-overall-h">Overall</h3>
            <button type="button" className="pitch__icon" aria-label="Reset overall pitch" title="Reset overall pitch"
              onClick={() => changeOverall(0)} disabled={props.pitchCents === 0}><UndoIcon /></button>
          </div>
          <PitchKnob id="pitch-overall" label="Overall pitch" value={props.pitchCents}
            autoFocus={props.focus !== 'step'} onChange={changeOverall} />
          <span className="pitch__unit" aria-hidden="true">st</span>
        </section>
        {slot && track && (
          <section className="pitch__control" aria-labelledby="pitch-step-h">
            <div className="pitch__heading">
              <h3 id="pitch-step-h">Step {step + 1}</h3>
              <button type="button" className="pitch__icon" aria-label={`Reset step ${step + 1} pitch`} title="Reset step pitch"
                onClick={() => changeStep(0)} disabled={offset === 0}><UndoIcon /></button>
            </div>
            <PitchKnob key={step} id={`pitch-step-${step}`} label={`Step ${step + 1} offset`} value={offset}
              autoFocus={props.focus === 'step'} onChange={changeStep} />
            <output className="pitch__result" aria-label={`Resulting step pitch ${formatSemitones(result)}`}>
              <span aria-hidden="true">Σ {formatSemitones(result)}</span>
            </output>
          </section>
        )}
      </div>
      {slot && track && (
        <section className="pitch__steps" aria-labelledby="pitch-steps-h">
          <div className="pitch__toolbar">
            <h3 id="pitch-steps-h">{slot.label}</h3>
            <button type="button" className="pitch__icon pitch__enable" aria-label={`Step ${step + 1} ${on ? 'on' : 'off'}`}
              aria-pressed={on} title={`Step ${step + 1} ${on ? 'on' : 'off'}`} onClick={() => props.onToggleStep(step)}>
              <span className="pitch-cell__led" aria-hidden="true" />
            </button>
            <button type="button" className="pitch__icon" aria-label={auditionLabel} title={auditionLabel}
              disabled={!audible} onClick={() => { cancelPreview(); props.onAudition(step) }}><SpeakerIcon /></button>
            <button type="button" className="pitch__icon" aria-label={`Reset all ${slot.label} step pitches`} title="Reset all step pitches"
              disabled={!track.stepPitchCents.some((c) => c !== 0)} onClick={() => { props.onResetStepPitches(); preview(step) }}>
              <UndoIcon /><span className="pitch__reset-all" aria-hidden="true">16</span>
            </button>
          </div>
          <div className="pitch__grid" role="group" aria-label={`${slot.label} step pitch targets`}>
            {Array.from({ length: STEPS }, (_, s) => {
              const cellOffset = track.stepPitchCents[s]
              return (
                <button key={s} type="button"
                  className={`pitch-cell${step === s ? ' pitch-cell--selected' : ''}${track.steps[s] ? ' pitch-cell--on' : ''}${s >= props.loopLength ? ' pitch-cell--outside' : ''}`}
                  aria-pressed={step === s}
                  aria-label={`Step ${s + 1}, ${track.steps[s] ? 'on' : 'off'}${s >= props.loopLength ? ', outside the 8-step loop' : ''}, offset ${formatSemitones(cellOffset)}`}
                  onClick={() => { cancelPreview(); setStep(s); preview(s) }}>
                  <span className="pitch-cell__top" aria-hidden="true"><span>{s + 1}</span><span className="pitch-cell__led" /></span>
                  <span className={`pitch-cell__offset${cellOffset !== 0 ? ' pitch-cell__offset--set' : ''}`} aria-hidden="true">
                    {cellOffset === 0 ? '—' : formatSemitones(cellOffset, false)}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      )}
    </Sheet>
  )
}
