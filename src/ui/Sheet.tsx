// Modal sheet on the native <dialog>: Escape closes, focus is trapped by the
// browser and restored to the opener on close. Phones: a bottom sheet with a
// grab handle; dragging the header down closes it. Wider screens: a centred
// panel sized by the sheet's class (--sheet-w in app.css).
import { useEffect, useRef, type ReactNode } from 'react'
import { BackIcon, CloseIcon } from './icons'

/** Bottom-sheet layout (matches the 520 px breakpoint in app.css). */
const PHONE_QUERY = '(max-width: 519.98px)'
/** Drag distance, or a short fast flick, that closes the sheet. */
const CLOSE_PX = 96
const FLICK_PX = 28
const FLICK_PX_PER_MS = 0.6

export function Sheet(props: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  className?: string
  /** Element to focus on close. Safari does not focus buttons on click, so activeElement is unreliable. */
  returnFocusId?: string
  /** Accessible name of the close key (it shows an X). */
  closeLabel?: string
  /** Optional leading element in the header (e.g. an instrument icon). */
  icon?: ReactNode
  /** Shows a Back button before the title. */
  onBack?: () => void
  /** Sticky content under the header (e.g. tabs). */
  subheader?: ReactNode
  /** Changes when the content is replaced, so the sheet scrolls back to the top. */
  contentKey?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const drag = useRef<{ id: number; y: number; t: number; dy: number } | null>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (props.open && !d.open) {
      opener.current = document.activeElement as HTMLElement | null
      d.style.transform = ''
      d.showModal()
      // showModal focuses the first control; prefer an explicitly marked one (React's autoFocus runs too early).
      d.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    } else if (!props.open && d.open) {
      d.close()
    }
  }, [props.open])
  useEffect(() => {
    ref.current?.scrollTo?.({ top: 0 })
  }, [props.contentKey])

  const endDrag = (e: React.PointerEvent) => {
    const g = drag.current
    const d = ref.current
    if (!g || g.id !== e.pointerId || !d) return
    drag.current = null
    const speed = g.dy / Math.max(1, e.timeStamp - g.t)
    if (g.dy > CLOSE_PX || (g.dy > FLICK_PX && speed > FLICK_PX_PER_MS)) {
      props.onClose()
    } else {
      d.style.transition = 'transform 140ms ease-out'
      d.style.transform = ''
    }
  }

  return (
    <dialog
      ref={ref}
      className={`sheet ${props.className ?? ''}`}
      aria-label={props.title}
      onClose={() => {
        if (ref.current) ref.current.style.transform = ''
        props.onClose()
        const target = (props.returnFocusId && document.getElementById(props.returnFocusId)) || opener.current
        target?.focus?.()
      }}
      onClick={(e) => {
        // Tap on the backdrop closes.
        if (e.target === ref.current) props.onClose()
      }}
    >
      <div className="sheet__inner">
        <div
          className="sheet__top"
          onPointerDown={(e) => {
            const d = ref.current
            if (!d || e.button !== 0 || !window.matchMedia(PHONE_QUERY).matches) return
            if ((e.target as HTMLElement).closest('button, input, select, a, [role="tab"]')) return
            if (d.scrollTop > 0) return
            drag.current = { id: e.pointerId, y: e.clientY, t: e.timeStamp, dy: 0 }
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            const g = drag.current
            const d = ref.current
            if (!g || g.id !== e.pointerId || !d) return
            g.dy = Math.max(0, e.clientY - g.y)
            d.style.transition = 'none'
            d.style.transform = g.dy ? `translateY(${g.dy}px)` : ''
          }}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span className="sheet__grip" aria-hidden="true" />
          <header className="sheet__head">
            {props.onBack && (
              <button type="button" className="sheet__back" aria-label="Back" onClick={props.onBack}>
                <BackIcon />
              </button>
            )}
            <h2>
              {props.icon}
              {props.title}
            </h2>
            <button type="button" className="sheet__close" aria-label={props.closeLabel ?? 'Close'} title="Close (Esc)" onClick={props.onClose}>
              <CloseIcon />
            </button>
          </header>
          {props.subheader && props.open && <div className="sheet__sub">{props.subheader}</div>}
        </div>
        {props.open && props.children}
      </div>
    </dialog>
  )
}
