import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import type { Machine } from '../contract/types'
import { useArtwork } from './useArtwork'
import { BooksIcon, BrandRings, ChevronIcon, StarIcon, TriangleIcon } from './icons'
import { Art } from './Art'
import { APP_VERSION } from '../version'
import { CircuitKey, type CircuitProps } from './Groove'
import { useHold } from './hooks'

/** Kit load state for the line under the maker logo; null when the shown kit is loaded and active. */
export type KitLoad = { phase: 'fetch' | 'decode' | 'queued'; fraction: number }

export function LogoBay(props: {
  /** Neighbouring machines in library order (wrapping); null disables the key. */
  prevLabel: string | null
  nextLabel: string | null
  onPrev: () => void
  onNext: () => void
  /** The shown machine's kits; keys appear when there is more than one. */
  kits: { id: string; label: string; full: string }[]
  activeKitId: string | null
  loadingKitId: string | null
  load: KitLoad | null
  onOpenKits: () => void
  /** Phones: the variant key cycles to the next kit; hold, right-click or V opens the named list. */
  onCycleKit: () => void
  /** Phones: groove key under the logo opens the groove sheet. */
  swing: number
  onOpenGroove: () => void
  circuit?: CircuitProps
  favourite: boolean
  onToggleFavourite: () => void
  machine: Machine | null
  logoUrl: string | null
  status: string | null
  /** 'loading' text is for screen readers only; the load line under the logo shows it visually. */
  statusKind: 'info' | 'error' | 'loading'
  onRetry: (() => void) | null
  onDetails: () => void
  onLibrary: () => void
  resolve: (rel: string) => string
  /** Desktop: the V.D.V.M mark opens the about card (phones have the mark in the header). */
  onAbout: () => void
  desktop?: boolean
}) {
  const m = props.machine
  const hold = useHold()
  const modelName = useModelNameFit(!props.desktop, m?.model ?? null, !!props.circuit)
  const logoUrl = useArtwork(props.logoUrl, m?.logo?.sha256 ?? null)
  // Logos are sized by area within width/height caps; the desktop manufacturer cell allows a larger mark.
  // The size goes to CSS as max-width/max-height so a narrower cell shrinks the logo without changing its aspect.
  const [area, maxW, maxH] = props.desktop ? [19000, 330, 92] : [8000, 200, 48]
  const logoScale = m?.logo ? Math.min(Math.sqrt(area / (m.logo.width * m.logo.height)), maxW / m.logo.width, maxH / m.logo.height) : 1
  return (
    <section className="logobay">
      {props.desktop && (
        <button type="button" id="brand-button-desktop" className="desktop-brand" aria-label={`About V.D.V.M, version ${APP_VERSION}`} aria-haspopup="dialog" onClick={props.onAbout}>
          <BrandRings />
          <span>V.D.V.M</span>
          <small className="app-version">v{APP_VERSION}</small>
        </button>
      )}
      {/* Section wrappers are display: contents on phones; on desktop they are the captioned panel cells. */}
      <div className="bay bay--machine" role={props.desktop ? 'group' : undefined} aria-label={props.desktop ? 'Machine' : undefined}>
        <span className="bay__cap" aria-hidden="true">Machine</span>
        <button
          type="button"
          className="tkey tkey--arrow logobay__kit logobay__kit--prev"
          aria-label={props.prevLabel ? `Previous machine: ${props.prevLabel}` : 'Previous machine'}
          disabled={!props.prevLabel}
          onClick={props.onPrev}
        >
          <TriangleIcon dir="left" />
        </button>
        {props.desktop && <>
          <button
            type="button"
            className="tkey tkey--arrow logobay__kit logobay__kit--next"
            aria-label={props.nextLabel ? `Next machine: ${props.nextLabel}` : 'Next machine'}
            disabled={!props.nextLabel}
            onClick={props.onNext}
          >
            <TriangleIcon dir="right" />
          </button>
          <button type="button" id="library-button" className="tkey desktop-library" onClick={props.onLibrary}>
            <BooksIcon />
            <span>Open library</span>
          </button>
        </>}
      </div>
      <div className="bay bay--maker">
        <span className="bay__cap" aria-hidden="true">Manufacturer</span>
        <button
          type="button"
          id="machine-button"
          className="logo"
          aria-label={m ? `${m.displayName}. Machine details` : 'Machine details'}
          onClick={props.onDetails}
          disabled={!m}
        >
          <span className="logo__plate">
            {m && logoUrl && m.logo ? (
              <img src={logoUrl} alt="" width={m.logo.width} height={m.logo.height} style={{ '--logo-w': `${m.logo.width * logoScale}px`, '--logo-h': `${m.logo.height * logoScale}px` } as CSSProperties} className="logo__img" />
            ) : (
              <span className="logo__text" aria-hidden="true">{m?.manufacturer ?? ''}</span>
            )}
            {/* The status line carries the same state as text for screen readers. */}
            <span
              className={`loadline${props.load ? ` loadline--${props.load.phase}` : ''}`}
              style={{ '--load': props.load?.fraction ?? 1 } as CSSProperties}
              aria-hidden="true"
            />
          </span>
        </button>
      </div>
      {!props.desktop && (
        <button
          type="button"
          className="tkey tkey--arrow logobay__kit logobay__kit--next"
          aria-label={props.nextLabel ? `Next machine: ${props.nextLabel}` : 'Next machine'}
          disabled={!props.nextLabel}
          onClick={props.onNext}
        >
          <TriangleIcon dir="right" />
        </button>
      )}
      <div className={`bay bay--model${props.desktop && props.kits.length <= 1 ? ' bay--solo' : ''}`}>
        {/* Phones: the MODEL caption sits on the rule and centres over the name; the name scales to the room it has. */}
        {!props.desktop && (
          <div className="modelcell">
            <div className="modelcell__capbox">
              <span className="bay__cap modelcell__cap" aria-hidden="true">Model</span>
            </div>
            <div className="modelcell__namerow">
              {m && <span ref={modelName} className="logo__model modelcell__name" aria-hidden="true">{m.model}</span>}
            </div>
            {m && (
              <button
                type="button"
                className={`logobay__fav iconbtn${props.favourite ? ' iconbtn--fav' : ''}`}
                aria-pressed={props.favourite}
                aria-label={props.favourite ? `Remove ${m.displayName} from favourites` : `Add ${m.displayName} to favourites`}
                onClick={props.onToggleFavourite}
              >
                <StarIcon filled={props.favourite} />
              </button>
            )}
          </div>
        )}
        {props.desktop && <span className="bay__cap" aria-hidden="true">Model</span>}
        {m && props.desktop && (
          <div className="logobay__line">
            <span className="logo__model" aria-hidden="true">{m.model}</span>
            <button
              type="button"
              className={`logobay__fav iconbtn${props.favourite ? ' iconbtn--fav' : ''}`}
              aria-pressed={props.favourite}
              aria-label={props.favourite ? `Remove ${m.displayName} from favourites` : `Add ${m.displayName} to favourites`}
              onClick={props.onToggleFavourite}
            >
              <StarIcon filled={props.favourite} />
            </button>
          </div>
        )}
        {/* The row is always present so the panel below does not move between single- and multi-kit machines. */}
        {!props.desktop ? (() => {
          const at = Math.max(0, props.kits.findIndex((k) => k.id === (props.loadingKitId ?? props.activeKitId)))
          const current = props.kits[at]
          const many = props.kits.length > 1
          const straight = props.swing <= 50
          return (<>
            <span className="bay__cap bay__cap--groove" aria-hidden="true">Groove</span>
            <div className="kitrow kitrow--phone">
              <button
                type="button"
                id="groove-button"
                className={`tkey groovekey${straight ? '' : ' groovekey--on'}`}
                aria-haspopup="dialog"
                aria-label={`Groove: ${straight ? 'straight' : `${props.swing}% swing`}. Open groove`}
                onClick={props.onOpenGroove}
              >
                <span className="tkey__caption">GROOVE</span>
                <span className="groovekey__value">{straight ? 'STR' : `${props.swing}%`}</span>
              </button>
              <button
                type="button"
                id="kits-button"
                className={`tkey varkey${props.loadingKitId ? ' kitkey--loading' : ''}`}
                disabled={!many}
                aria-label={current ? `Variant ${at + 1} of ${props.kits.length}: ${current.full}.${many ? ' Next variant. Hold for the list' : ''}` : 'Variant'}
                title={current?.full}
                {...hold({ onTap: props.onCycleKit, onHold: props.onOpenKits })}
              >
                <span className="tkey__caption">VAR</span>
                <span className="varkey__num">{current ? at + 1 : 1}</span>
              </button>
              {props.circuit && <CircuitKey c={props.circuit} className="circuitkey--phone" />}
            </div>
          </>)
        })() : <div className="kitrow">
          {props.kits.length > 1 && (() => {
            const current = props.kits.find((k) => k.id === (props.loadingKitId ?? props.activeKitId)) ?? props.kits[0]
            return (
              <button
                type="button"
                id="kits-button"
                className={`tkey kitbtn${props.loadingKitId ? ' kitkey--loading' : ' kitkey--active'}`}
                aria-haspopup="dialog"
                aria-label={`Kit: ${current.full}. ${props.kits.length} kits. Choose kit`}
                onClick={props.onOpenKits}
              >
                <span className="kitkey__led" aria-hidden="true" />
                <span className="kitkey__label">{current.label}</span>
                <span className="kitbtn__count" aria-hidden="true">{props.kits.length}</span>
                <ChevronIcon open={false} className="kitbtn__chev" />
              </button>
            )
          })()}
        </div>}
      <div className={`status status--${props.statusKind}`} role="status" aria-live="polite">
        {props.statusKind === 'loading'
          ? <span className="visually-hidden">{props.status}</span>
          : props.status && <span className="status__text" title={props.status}>{props.status}</span>}
        {props.onRetry && (
          <button type="button" className="status__retry" onClick={props.onRetry}>
            Retry
          </button>
        )}
      </div>
      </div>
      {props.desktop && <section className="bay bay--about desktop-about" aria-label="About this machine">
        <span className="bay__cap" aria-hidden="true">About</span>
        <button type="button" className="desktop-about__photo" onClick={props.onDetails} aria-label={m ? `${m.displayName} photo. Machine details` : 'Machine details'} disabled={!m}>
          <Art photo={m?.photo ?? null} logo={m?.logo ?? null} label={m?.displayName ?? ''} resolve={props.resolve} eager />
        </button>
        <div className="desktop-about__text">
          <p>{m?.history?.text ?? 'No sourced history is available for this machine yet.'}</p>
          <button type="button" className="desktop-about__more" onClick={props.onDetails} disabled={!m}>Machine details</button>
        </div>
      </section>}
    </section>
  )
}

/** Largest model-name size (px) by viewport width; most names (six or seven characters) fit at it. */
const nameBase = () => Math.min(24, Math.max(20, window.innerWidth * 0.062))
const NAME_MIN = 15

/** Phones: the MODEL caption and the star never move. The name centres under the caption at the
 *  base size; a longer name moves left into the free space beside the keys, then shrinks to fit,
 *  then wraps onto two lines at the minimum size. */
function useModelNameFit(active: boolean, model: string | null, circuit: boolean) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const name = ref.current
    const row = name?.parentElement
    const cell = row?.closest('.modelcell')
    if (!active || !name || !row || !cell) return
    const place = () => {
      const cap = cell.querySelector('.modelcell__capbox')?.getBoundingClientRect()
      const star = cell.querySelector('.logobay__fav svg')?.getBoundingClientRect()
      const circuitKey = cell.parentElement?.querySelector('.circuitkey--phone')?.getBoundingClientRect()
      const box = row.getBoundingClientRect()
      if (!cap || !box.width) return
      const left = Math.max(box.left, circuitKey ? circuitKey.right + 12 : box.left)
      const right = star ? star.left - 12 : box.right
      const room = right - left
      const base = nameBase()
      Object.assign(name.style, { fontSize: `${base}px`, whiteSpace: 'nowrap', width: '', left: '0px' })
      const w = name.getBoundingClientRect().width
      let size = base
      let width = w
      if (w > room) {
        size = Math.max(NAME_MIN, (base * room) / w)
        width = size > NAME_MIN ? (w * size) / base : room
      }
      const centre = cap.left + cap.width / 2
      const x = Math.min(Math.max(centre - width / 2, left), right - width)
      Object.assign(name.style, {
        fontSize: `${size}px`,
        whiteSpace: width < (w * size) / base - 0.5 ? 'normal' : 'nowrap',
        width: `${width}px`,
        left: `${x - box.left}px`,
      })
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(cell)
    void document.fonts?.ready.then(place)
    return () => ro.disconnect()
  }, [active, model, circuit])
  return ref
}
