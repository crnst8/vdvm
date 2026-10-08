import { useState } from 'react'
import type { KitManifest, Sample } from '../../contract/types'
import { iconFor } from '../../data/catalog'
import { formatDb } from '../VolumeSheet'
import { ChevronIcon, INSTRUMENT_ICONS } from '../icons'

export interface SoundsTabProps {
  kit: KitManifest
  tracks: Record<string, { sampleId: string; gainDb: number } | undefined>
  selectedSlotId: string | null
  isReady: (s: Sample) => boolean
  onSelectSlot: (slotId: string) => void
  onChooseSample: (slotId: string, s: Sample) => void
  onVolume: (slotId: string) => void
  onPitch: (slotId: string) => void
}

export function SoundsTab(p: SoundsTabProps) {
  const [open, setOpen] = useState<string | null>(p.selectedSlotId)
  return (
    <div className="stab">
      <p className="muted stab__intro">Instruments in {p.kit.label}. Tap one to select and hear it.</p>
      <ul className="slist">
        {p.kit.slots.map((slot) => {
          const Icon = INSTRUMENT_ICONS[iconFor(slot.icon)]
          const t = p.tracks[slot.id]
          const sampleId = t?.sampleId ?? slot.defaultSampleId
          const sample = p.kit.samples.find((s) => s.id === sampleId)
          const missing = !slot.sampleIds.includes(sampleId)
          const expanded = open === slot.id
          return (
            <li key={slot.id} className={`srow${slot.id === p.selectedSlotId ? ' srow--selected' : ''}`}>
              <div className="srow__line">
                <button type="button" className="srow__main" onClick={() => p.onSelectSlot(slot.id)} aria-pressed={slot.id === p.selectedSlotId}>
                  <Icon className="srow__icon" />
                  <span className="srow__text">
                    <span className="srow__name">{slot.label}</span>
                    <span className={`srow__meta${missing ? ' lib__error' : ''}`}>
                      {missing ? 'Sound missing' : (sample?.label ?? 'Default')}
                      {t && t.gainDb !== 0 ? ` · ${formatDb(t.gainDb)}` : ''}
                    </span>
                  </span>
                </button>
                <button type="button" className="textbtn" onClick={() => p.onVolume(slot.id)}>
                  Volume
                </button>
                <button type="button" className="textbtn" onClick={() => p.onPitch(slot.id)}>
                  Pitch
                </button>
                {slot.sampleIds.length > 1 ? (
                  <button
                    type="button"
                    className="iconbtn"
                    aria-expanded={expanded}
                    aria-label={`${slot.sampleIds.length} sounds for ${slot.label}`}
                    onClick={() => setOpen(expanded ? null : slot.id)}
                  >
                    <ChevronIcon open={expanded} />
                  </button>
                ) : (
                  <span className="srow__spacer" aria-hidden="true" />
                )}
              </div>
              {expanded && (
                <ul className="variants" role="radiogroup" aria-label={`Sound for ${slot.label}`}>
                  {slot.sampleIds.map((id) => {
                    const s = p.kit.samples.find((x) => x.id === id)
                    if (!s) return null
                    return (
                      <li key={id}>
                        <button type="button" role="radio" aria-checked={id === sampleId} className="variant" onClick={() => p.onChooseSample(slot.id, s)}>
                          <span className="variant__dot" aria-hidden="true" />
                          <span>{s.label ?? id}</span>
                          <span className="muted variant__meta">
                            {s.durationSec.toFixed(2)} s{id === slot.defaultSampleId ? ' · default' : ''}
                            {!p.isReady(s) ? ' · not loaded' : ''}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
