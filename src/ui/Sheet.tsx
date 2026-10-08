// Modal sheet on the native <dialog>: Escape closes, focus is trapped by the
// browser and restored to the opener on close.
import { useEffect, useRef, type ReactNode } from 'react'
import { BackIcon } from './icons'

export function Sheet(props: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  className?: string
  /** Element to focus on close. Safari does not focus buttons on click, so activeElement is unreliable. */
  returnFocusId?: string
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
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (props.open && !d.open) {
      opener.current = document.activeElement as HTMLElement | null
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
  return (
    <dialog
      ref={ref}
      className={`sheet ${props.className ?? ''}`}
      aria-label={props.title}
      onClose={() => {
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
        <div className="sheet__top">
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
          <button type="button" className="sheet__close" onClick={props.onClose}>
            {props.closeLabel ?? 'Close'}
          </button>
        </header>
        {props.subheader && props.open && <div className="sheet__sub">{props.subheader}</div>}
        </div>
        {props.open && props.children}
      </div>
    </dialog>
  )
}
