// About card opened from the V.D.V.M mark. It unfolds downward out of the mark: the page dims
// behind a native <dialog>, and a copy of the mark is drawn inside the dialog at the original's
// position so the mark itself stays at full strength above the dim layer.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { BrandRings } from './icons'
import { APP_VERSION } from '../version'

/** Card content. Add entries to `links` and the card lists them under the note; remove the
 *  note when it no longer applies. Links open in a new tab. */
const ABOUT: {
  mark: string
  title: string
  note: string | null
  links: { label: string; href: string }[]
} = {
  mark: 'V . D . V . M',
  title: 'Vintage Drum Virtual Machine',
  note: '(I’ll put more info / source code link here soon!)',
  links: [],
}

/** Card width: 25 px clear of each screen edge on phones, capped for wide screens. */
const cardWidth = (vw: number) => Math.min(vw - 50, 420)

type Place = {
  /** The mark's SVG box, where the copy is drawn. */
  ring: { left: number; top: number; width: number; height: number; color: string; stroke: string }
  card: { left: number; top: number; width: number; originX: number; slit: number }
}

function measure(anchorId: string): Place | null {
  const button = document.getElementById(anchorId)
  const svg = button?.querySelector('svg')
  if (!button || !svg) return null
  const r = svg.getBoundingClientRect()
  const b = button.getBoundingClientRect()
  const cs = getComputedStyle(svg)
  const vw = document.documentElement.clientWidth
  const width = cardWidth(vw)
  const cx = r.left + r.width / 2
  const left = Math.min(Math.max(12, cx - width / 2), vw - 12 - width)
  // The drawn ellipses span x 11–169 and y 10–80 of the 180 × 90 viewBox. The card starts as a
  // slit as wide as them, hanging 1 px under their lowest point; when the button also holds the
  // wordmark (desktop), it hangs under the whole button instead.
  const drawnBottom = r.top + (r.height * 80) / 90
  const top = button.children.length > 1 ? b.bottom + 6 : drawnBottom + 1
  return {
    ring: { left: r.left, top: r.top, width: r.width, height: r.height, color: cs.color, stroke: cs.strokeWidth },
    card: { left, top, width, originX: cx - left, slit: (r.width * 158) / 180 },
  }
}

export function About(props: { open: boolean; onClose: () => void; anchorId: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [place, setPlace] = useState<Place | null>(null)
  const [closing, setClosing] = useState(false)

  useLayoutEffect(() => {
    const d = ref.current
    if (!d) return
    if (props.open && !d.open) {
      setClosing(false)
      setPlace(measure(props.anchorId))
      d.showModal()
      d.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    } else if (!props.open && d.open) {
      d.close()
    }
  }, [props.open, props.anchorId])

  useEffect(() => {
    if (!props.open) return
    const onResize = () => setPlace(measure(props.anchorId))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [props.open, props.anchorId])

  // Play the fold-up, then close. Without motion the animation never runs, so close at once.
  const requestClose = () => {
    if (closing) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) ref.current?.close()
    else setClosing(true)
  }

  const ring = place?.ring
  const card = place?.card
  return (
    <dialog
      ref={ref}
      className={`about${closing ? ' about--closing' : ''}`}
      aria-labelledby="about-title"
      onCancel={(e) => {
        e.preventDefault()
        requestClose()
      }}
      onClose={() => {
        setClosing(false)
        props.onClose()
        document.getElementById(props.anchorId)?.focus()
      }}
      onClick={(e) => {
        // The dialog fills the screen; a tap outside the card and the mark lands on it.
        if (e.target === ref.current) requestClose()
      }}
    >
      {props.open && ring && card && <>
        <button
          type="button"
          className="about__mark"
          aria-label="Close about"
          tabIndex={-1}
          style={{ left: ring.left, top: ring.top, width: ring.width, height: ring.height, color: ring.color, strokeWidth: ring.stroke }}
          onClick={requestClose}
        >
          <BrandRings />
        </button>
        <section
          className="about__card"
          style={{ left: card.left, top: card.top, width: card.width, '--origin-x': `${card.originX}px`, '--slit': `${card.slit}px` } as CSSProperties}
          onAnimationEnd={(e) => {
            if (closing && e.target === e.currentTarget) ref.current?.close()
          }}
        >
          <div className="about__body">
            <span className="about__version">V{APP_VERSION}</span>
            <button type="button" className="about__close" aria-label="Close" data-autofocus onClick={requestClose}>
              X
            </button>
            <p className="about__mark-text">{ABOUT.mark}</p>
            <h2 id="about-title" className="about__title">{ABOUT.title}</h2>
            {ABOUT.note && <p className="about__note">{ABOUT.note}</p>}
            {ABOUT.links.length > 0 && (
              <ul className="about__links">
                {ABOUT.links.map((l) => (
                  <li key={l.href}>
                    <a href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </>}
    </dialog>
  )
}
