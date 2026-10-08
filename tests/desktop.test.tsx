import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StepBank } from '../src/ui/StepBank'
import { DesktopMixer } from '../src/ui/DesktopMixer'
import type { Slot } from '../src/contract/types'
import { fullLevels, zeroStepPitches } from '../src/state/pattern'
import { instrumentCapacity } from '../src/ui/instrumentWindow'
import { InstrumentStrip } from '../src/ui/InstrumentStrip'
import { PitchSheet } from '../src/ui/PitchSheet'
import { PitchKnob } from '../src/ui/PitchKnob'

describe('desktop panel structure', () => {
  it('shows paging arrows only when the instruments exceed the single row', () => {
    const slots = Array.from({ length: 15 }, (_, i) => ({ id: `drum-${i}`, label: `Drum ${i}`, icon: 'kick' })) as Slot[]
    const props = { slots, selectedId: 'drum-0', start: 0, visible: 10, desktop: true, missing: new Set<string>(), flashing: new Set<string>(), onSelect: () => {}, onHold: () => {}, onPage: () => {}, onCapacity: () => {} }
    const first = renderToStaticMarkup(<InstrumentStrip {...props} />)
    expect(first.match(/role="radio"/g)).toHaveLength(10)
    expect(first).toContain('strip--paged')
    expect(first).toContain('aria-label="Previous instruments" disabled=""')
    const last = renderToStaticMarkup(<InstrumentStrip {...props} start={5} />)
    expect(last).toContain('id="tile-drum-14"')
    expect(last).toContain('aria-label="Next instruments" disabled=""')
    const all = renderToStaticMarkup(<InstrumentStrip {...props} visible={15} />)
    expect(all.match(/role="radio"/g)).toHaveLength(15)
    expect(all.match(/hidden=""/g)).toHaveLength(2)
  })
  it.each([260, 298, 350, 900, 1296, 1728])('fits the row and arrows within %i px', (width) => {
    const desktop = width >= 900
    const count = 30
    const capacity = instrumentCapacity(width, count, desktop)
    const tile = desktop ? 68 : 44
    const gap = desktop ? 8 : 6
    expect(capacity * tile + (capacity - 1) * gap + 88 + gap * 2).toBeLessThanOrEqual(width)
    expect(instrumentCapacity(width, 3, desktop)).toBe(3)
  })
  it('shows all 16 steps in two eight-key rows, retaining long-press bindings and out-of-loop edits', () => {
    const props = { steps: new Array(16).fill(true), page: 1, playStep: 10, trackLabel: 'Kick', silent: false, loopLength: 8, onToggle: () => {}, onHoldStep: () => {} }
    const desktop = renderToStaticMarkup(<StepBank {...props} desktop />)
    expect(desktop.match(/id="step-/g)).toHaveLength(16)
    expect(desktop.match(/step--outside/g)).toHaveLength(8)
    expect(desktop).toContain('aria-label="Step 16"')
    expect(desktop).toContain('Hold, right-click or press V for step volume')
    expect(desktop.match(/bar__cell--on/g)).toHaveLength(1)
    const phone = renderToStaticMarkup(<StepBank {...props} />)
    expect(phone.match(/id="step-/g)).toHaveLength(8)
    expect(phone).toContain('id="step-8"')
    expect(phone).not.toContain('id="step-0"')
  })
  it('renders the pitch sheet global controls without a slot, and step controls with one', () => {
    const base = {
      open: true, onClose: () => {}, pitchCents: 0, focusStep: null as number | null, focus: 'overall' as const,
      loopLength: 8, playing: false, canAudition: true, auditionNote: null,
      onPitch: () => {}, onStepPitch: () => {}, onToggleStep: () => {}, onResetStepPitches: () => {}, onAudition: () => {},
    }
    const globalOnly = renderToStaticMarkup(<PitchSheet {...base} slot={null} track={null} />)
    expect(globalOnly).toContain('Overall pitch')
    expect(globalOnly).toContain('aria-valuenow="0"')
    expect(globalOnly).not.toContain('step pitch')
    const slot = { id: 'kick', label: 'Kick', icon: 'kick' } as Slot
    const track = { slotId: 'kick', sampleId: 'kick', steps: new Array(16).fill(false), levels: fullLevels(), gainDb: 0, stepPitchCents: zeroStepPitches() }
    track.steps[12] = true
    track.stepPitchCents[12] = 700
    const stepped = renderToStaticMarkup(<PitchSheet {...base} slot={slot} track={track} focusStep={12} focus="step" />)
    expect(stepped).toContain('Kick step pitch targets')
    expect(stepped).toContain('Step 13 offset')
    expect(stepped).toContain('outside the 8-step loop')
    expect(stepped).toContain('+7.0 st')
    expect(stepped).toContain('aria-pressed="true"')
    expect(stepped).toContain('Audition step 13')
    // Every step is reachable without paging; no exposition occupies mobile space.
    expect(stepped.match(/class="pitch-cell(?: |")/g)).toHaveLength(16)
    expect(stepped).not.toContain('<p ')
  })
  it('gives the pitch knob slider semantics with a signed value text and a numeric input', () => {
    const html = renderToStaticMarkup(<PitchKnob id="pitch-x" label="Overall pitch" value={-50} onChange={() => {}} />)
    expect(html).toContain('role="slider"')
    expect(html).toContain('aria-valuetext="−0.5 st"')
    expect(html).toContain('aria-valuenow="-0.5"')
    expect(html).toContain('type="number"')
    expect(html).toContain('min="-12"')
    expect(html).toContain('max="12"')
    expect(html).toContain('value="-0.5"')
    expect(html).toContain('Lower overall pitch by one semitone')
    expect(html).toContain('Raise overall pitch by one semitone')
  })
  it('exposes all step levels, disables off steps and keeps drum mixer volumes separate', () => {
    const slot = { id: 'kick', label: 'Kick', icon: 'kick' } as Slot
    const track = { slotId: 'kick', sampleId: 'kick', steps: new Array(16).fill(false), levels: fullLevels(), gainDb: -6, stepPitchCents: zeroStepPitches() }
    track.steps[0] = true
    const props = { open: true, slots: [slot], tracks: { kick: track }, selected: slot, loopLength: 8, playing: false, onOpen: () => {}, onMode: () => {}, onClose: () => {}, onGain: () => {}, onLevel: () => {}, onToggle: () => {}, onAudition: () => {} }
    const steps = renderToStaticMarkup(<DesktopMixer {...props} mode="steps" />)
    expect(steps.match(/type="range"/g)).toHaveLength(16)
    expect(steps.match(/disabled=""/g)).toHaveLength(15)
    expect(steps.match(/mixer-channel--outside/g)).toHaveLength(8)
    const drums = renderToStaticMarkup(<DesktopMixer {...props} mode="drums" />)
    expect(drums.match(/type="range"/g)).toHaveLength(1)
    expect(drums).toContain('aria-label="Kick volume"')
    expect(drums).toContain('−6.0 dB')
    // Closed, the mixer is only the tab that opens it.
    const closed = renderToStaticMarkup(<DesktopMixer {...props} open={false} mode="drums" />)
    expect(closed).toContain('id="mixer-open-button"')
    expect(closed).not.toContain('type="range"')
  })
})
