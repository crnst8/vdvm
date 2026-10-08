import type { Slot } from '../contract/types'
import { useEffect, useRef } from 'react'
import { iconFor } from '../data/catalog'
import { INSTRUMENT_ICONS, TriangleIcon } from './icons'
import { useHold } from './hooks'
import { instrumentCapacity } from './instrumentWindow'

/** Tile captions must fit ~45 px; full labels stay in aria-label and title. */
const SHORT: Record<string, string> = {
  'hat-closed': 'Closed', 'hat-open': 'Open', 'tom-low': 'Lo tom', 'tom-mid': 'Mid tom', 'tom-high': 'Hi tom', rim: 'Rim',
}

export function InstrumentStrip(props: {
  slots: Slot[]
  selectedId: string | null
  start: number
  visible: number
  desktop?: boolean
  missing: Set<string>
  flashing: Set<string>
  onSelect: (slotId: string) => void
  onHold: (slotId: string) => void
  onPage: (dir: -1 | 1) => void
  onCapacity: (count: number) => void
}) {
  const bind = useHold()
  const ref = useRef<HTMLElement>(null)
  const { slots, start, visible } = props
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const style = getComputedStyle(el)
      const width = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      props.onCapacity(instrumentCapacity(width, slots.length, !!props.desktop))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [slots.length, props.desktop, props.onCapacity])
  const overflow = slots.length > visible
  const first = Math.min(start, Math.max(0, slots.length - visible))
  const shown = slots.slice(first, first + visible)
  const canPrev = first > 0
  const canNext = first + visible < slots.length
  return (
    <section ref={ref} className={`strip${overflow ? ' strip--paged' : ' strip--all'}`} aria-label="Instruments" style={{ ['--tiles' as string]: Math.max(1, Math.min(visible, slots.length)) }}>
      <span className="bay__cap" aria-hidden="true">Hits</span>
      <button type="button" className="tile tile--arrow" aria-label="Previous instruments" hidden={!overflow} disabled={!canPrev} onClick={() => props.onPage(-1)}>
        <TriangleIcon dir="left" />
      </button>
      <div className="strip__tiles" role="radiogroup" aria-label={`Instruments ${first + 1}–${first + shown.length} of ${slots.length}`}>
        {shown.map((slot) => {
          const Icon = INSTRUMENT_ICONS[iconFor(slot.icon)]
          const selected = slot.id === props.selectedId
          const missing = props.missing.has(slot.id)
          return (
            <button
              key={slot.id}
              id={`tile-${slot.id}`}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`tile${selected ? ' tile--selected' : ''}${props.flashing.has(slot.id) ? ' tile--flash' : ''}`}
              aria-label={`${slot.label}${missing ? ' (sound missing)' : ''}`}
              aria-description="Hold, right-click or press V for volume"
              {...bind({ onDown: () => props.onSelect(slot.id), onTap: () => {}, onHold: () => props.onHold(slot.id) })}
              onClick={(e) => {
                if (e.detail === 0) props.onSelect(slot.id)
              }}
            >
              <Icon className="tile__icon" />
              <span className="tile__label" aria-hidden="true">{SHORT[slot.id] ?? slot.label}</span>
              <span className={`tile__ind${missing ? ' tile__ind--missing' : ''}`} aria-hidden="true" />
            </button>
          )
        })}
      </div>
      <button type="button" className="tile tile--arrow" aria-label="Next instruments" hidden={!overflow} disabled={!canNext} onClick={() => props.onPage(1)}>
        <TriangleIcon dir="right" />
      </button>
    </section>
  )
}
