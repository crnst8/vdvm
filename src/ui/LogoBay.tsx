import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import type { Machine } from '../contract/types'
import { useArtwork } from './useArtwork'
import { BooksIcon, BrandRings, InfoIcon, SearchIcon, StarIcon, TriangleIcon } from './icons'
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
  /** The shown machine's kits; the VAR key is enabled when there is more than one. */
  kits: { id: string; label: string; full: string }[]
  activeKitId: string | null
  loadingKitId: string | null
  load: KitLoad | null
  onOpenKits: () => void
  /** The VAR key cycles to the next kit; hold, right-click or V opens the named list. */
  onCycleKit: () => void
  /** Phones: the PATTERN key beside VAR. */
  patternKey: ReactNode
  /** Desktop: GAIN, PATTERN, PITCH and ECHO in the function cell. */
  functionKeys: ReactNode
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
  onSearch: () => void
  resolve: (rel: string) => string
  /** Desktop: the V.D.V.M mark opens the about card (phones have the mark in the header). */
  onAbout: () => void
  desktop?: boolean
}) {
  const m = props.machine
  const hold = useHold()
  const modelName = useModelNameFit(!props.desktop, m?.model ?? null, !!props.circuit)
  const logoUrl = useArtwork(props.logoUrl, m?.logo?.sha256 ?? null)
  const photoUrl = useArtwork(props.desktop && m?.photo ? props.resolve(m.photo.url) : null, m?.photo?.sha256 ?? null)
  // Every plate takes one 3.6:1 box on the wood block, whatever the logo's pixel size and whether it
  // has loaded, so the block never changes size. The height goes to CSS, which also caps it in short windows.
  const plateH = props.desktop ? 58 : 36
  const plateSize = { '--logo-h': `${plateH}px` } as CSSProperties

  const at = Math.max(0, props.kits.findIndex((k) => k.id === (props.loadingKitId ?? props.activeKitId)))
  const currentKit = props.kits[at]
  const manyKits = props.kits.length > 1
  const varKey = (
    <button
      type="button"
      id="kits-button"
      className={`tkey varkey${props.loadingKitId ? ' kitkey--loading' : ''}`}
      disabled={!manyKits}
      aria-label={currentKit ? `Variant ${at + 1} of ${props.kits.length}: ${currentKit.full}.${manyKits ? ' Next variant. Hold for the list' : ''}` : 'Variant'}
      title={currentKit ? (manyKits ? `${currentKit.full} (${at + 1} of ${props.kits.length})` : currentKit.full) : undefined}
      {...hold({ onTap: props.onCycleKit, onHold: props.onOpenKits })}
    >
      <span className="tkey__caption">VAR</span>
      <span className="varkey__num">{currentKit ? at + 1 : 1}</span>
    </button>
  )
  const favButton = m && (
    <button
      type="button"
      className={`logobay__fav iconbtn${props.favourite ? ' iconbtn--fav' : ''}`}
      aria-pressed={props.favourite}
      aria-label={props.favourite ? `Remove ${m.displayName} from favourites` : `Add ${m.displayName} to favourites`}
      onClick={props.onToggleFavourite}
    >
      <StarIcon filled={props.favourite} />
    </button>
  )
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
          <div className="machine-tools">
            <button type="button" id="library-button" className="tkey toolkey" aria-label="Library" title="Library" onClick={props.onLibrary}>
              <BooksIcon />
            </button>
            <button type="button" id="search-button" className="tkey toolkey" aria-label="Search machines" title="Search" aria-haspopup="dialog" onClick={props.onSearch}>
              <SearchIcon />
            </button>
            {varKey}
          </div>
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
          <span className="logo__wood" style={plateSize}>
            {m && logoUrl && m.logo ? (
              <img src={logoUrl} alt="" width={m.logo.width} height={m.logo.height} className="logo__img" />
            ) : (
              <span className="logo__blank" aria-hidden="true"><span className="logo__text">{m?.manufacturer ?? ''}</span></span>
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
      <div className={`bay bay--model${props.desktop && m?.photo ? ' bay--photo' : ''}`}>
        {/* Phones: the MODEL caption sits on the rule and centres over the name; the name scales to the room it has. */}
        {!props.desktop && (
          <div className="modelcell">
            <div className="modelcell__capbox">
              <span className="bay__cap modelcell__cap" aria-hidden="true">Model</span>
            </div>
            <div className="modelcell__namerow">
              {m && <span ref={modelName} className="logo__model modelcell__name" aria-hidden="true">{m.model}</span>}
            </div>
            {favButton}
          </div>
        )}
        {props.desktop && <span className="bay__cap" aria-hidden="true">Model</span>}
        {/* Desktop: the machine image when there is one (its box is reserved while it loads); without
            one, the name row centres on the logo's axis. */}
        {props.desktop && m?.photo && (
          <button type="button" className="model__photo" aria-label={`${m.displayName}. Machine details`} onClick={props.onDetails}>
            {photoUrl && <img src={photoUrl} alt="" width={m.photo.width} height={m.photo.height} draggable={false} />}
          </button>
        )}
        {m && props.desktop && (
          <div className="logobay__line">
            <button type="button" className="logobay__info iconbtn" aria-haspopup="dialog" aria-label={`About the ${m.displayName}`} title="About this machine" onClick={props.onDetails}>
              <InfoIcon />
            </button>
            {/* Most names are 5–8 characters; longer ones step down in size before the ellipsis. */}
            <span className={`logo__model${m.model.length > 16 ? ' logo__model--longer' : m.model.length > 10 ? ' logo__model--long' : ''}`} title={m.model}>{m.model}</span>
            {favButton}
          </div>
        )}
        {!props.desktop && <>
          <span className="bay__cap bay__cap--groove" aria-hidden="true">Pattern</span>
          <div className="kitrow kitrow--phone">
            {props.patternKey}
            {varKey}
            {props.circuit && <CircuitKey c={props.circuit} className="circuitkey--phone" />}
          </div>
        </>}
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
      {props.desktop && (
        <section className="bay bay--function" aria-label="Function">
          <span className="bay__cap" aria-hidden="true">Function</span>
          <div className="fkeys">{props.functionKeys}</div>
        </section>
      )}
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
