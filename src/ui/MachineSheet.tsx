// Machine details and exploration: history, load/favourite, then ways to move
// to other machines (same maker, neighbours in library order, surprise me).
import { useState } from 'react'
import type { CatalogIndex, Machine } from '../contract/types'
import { sortMachines } from '../data/catalog'
import { Sheet } from './Sheet'
import { Art } from './Art'
import { ShuffleIcon, StarIcon, TriangleIcon } from './icons'

const STATUS_TEXT: Record<string, string> = {
  provisional: 'Provisional: name taken from the sample collection; not yet verified against original documentation.',
  verified: 'Verified against original documentation.',
  unresolved: 'Unresolved: the exact model is still being researched.',
}

export function MachineSheet(props: {
  open: boolean
  onClose: () => void
  machine: Machine | null
  index: CatalogIndex | null
  resolve: (rel: string) => string
  activeKitId: string | null
  loadingKitId: string | null
  progress: { done: number; total: number }
  favourites: Set<string>
  onToggleFavourite: (machineId: string) => void
  onSelectKit: (kitId: string) => void
  /** Show another machine in this sheet. */
  onNavigate: (machineId: string) => void
  /** Open the library's machine list filtered to one manufacturer. */
  onBrowseMaker: (maker: string) => void
  /** Present when there is a previous machine in this sheet's history. */
  onBack: (() => void) | null
  returnFocusId?: string
}) {
  const m = props.machine
  const index = props.index
  const [surpriseSeed, setSurpriseSeed] = useState(0)
  if (!m || !index) return <Sheet open={props.open} onClose={props.onClose} title="Machine" children={null} />

  const ordered = sortMachines(index.machines)
  const at = ordered.findIndex((x) => x.id === m.id)
  const prev = ordered.length > 1 ? ordered[(at - 1 + ordered.length) % ordered.length] : null
  const next = ordered.length > 1 ? ordered[(at + 1) % ordered.length] : null
  // The 12 same-maker machines nearest to this one in library order (models sort within a maker).
  const allSameMaker = ordered.filter((x) => x.manufacturer === m.manufacturer && x.id !== m.id)
  const sameMaker = [...allSameMaker]
    .sort((a, b) => Math.abs(ordered.indexOf(a) - at) - Math.abs(ordered.indexOf(b) - at))
    .slice(0, 12)
    .sort((a, b) => ordered.indexOf(a) - ordered.indexOf(b))
  const kits = index.kits.filter((k) => k.machineId === m.id)
  const fav = props.favourites.has(m.id)
  const others = ordered.filter((x) => x.id !== m.id)
  const surprise = () => {
    if (!others.length) return
    setSurpriseSeed((s) => s + 1)
    props.onNavigate(others[Math.floor(Math.random() * others.length)].id)
  }

  const kitButton = (kitId: string, label: string) => {
    const active = kitId === props.activeKitId
    const loading = kitId === props.loadingKitId
    return (
      <button key={kitId} type="button" className="keybtn" disabled={active || loading} onClick={() => props.onSelectKit(kitId)}>
        {active ? `Playing: ${label}` : loading ? `Loading ${props.progress.done}/${props.progress.total}` : kits.length > 1 ? `Load ${label}` : 'Load this kit'}
      </button>
    )
  }

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title={m.displayName}
      returnFocusId={props.returnFocusId}
      onBack={props.onBack ?? undefined}
      contentKey={`${m.id}-${surpriseSeed}`}
      className="sheet--machine"
    >
      <div className="machine">
        <Art photo={m.photo} logo={m.logo} label={m.displayName} resolve={props.resolve} eager className="machine__hero" />
        <div className="machine__title">
          <div>
            <p className="machine__name">{m.model}</p>
            <p className="muted machine__maker">{m.manufacturer}</p>
          </div>
          <button
            type="button"
            className={`iconbtn iconbtn--big${fav ? ' iconbtn--fav' : ''}`}
            aria-pressed={fav}
            aria-label={fav ? 'Remove from favourites' : 'Add to favourites'}
            onClick={() => props.onToggleFavourite(m.id)}
          >
            <StarIcon filled={fav} />
          </button>
        </div>
        <div className="machine__kits">{kits.map((k) => kitButton(k.id, k.label))}</div>
        {m.history ? (
          <p className="machine__history">{m.history.text}</p>
        ) : (
          <p className="muted">A short history of this machine has not been written yet.</p>
        )}

        <nav className="explore" aria-label="Explore machines">
          {sameMaker.length > 0 && (
            <>
              <h3>More from {m.manufacturer}</h3>
              <ul className="explore__row">
                {sameMaker.map((x) => (
                  <li key={x.id}>
                    <button type="button" className="mini" onClick={() => props.onNavigate(x.id)}>
                      {/* Same maker: the logo would repeat on every tile, so show a photo or the model name. */}
                      <Art photo={x.photo} logo={null} label={x.model} resolve={props.resolve} className="mini__art" />
                      <span className="mini__name">{x.model}</span>
                      {props.favourites.has(x.id) && <StarIcon filled className="mini__star" aria-label="Favourite" />}
                    </button>
                  </li>
                ))}
              </ul>
              {allSameMaker.length > sameMaker.length && (
                <button type="button" className="textbtn explore__all" onClick={() => props.onBrowseMaker(m.manufacturer)}>
                  Show all {allSameMaker.length + 1} {m.manufacturer} machines
                </button>
              )}
            </>
          )}
          <h3>Browse</h3>
          <div className="explore__step">
            <button type="button" className="keybtn keybtn--quiet explore__nav" disabled={!prev} onClick={() => prev && props.onNavigate(prev.id)}>
              <TriangleIcon dir="left" />
              <span>{prev?.displayName ?? '—'}</span>
            </button>
            <button type="button" className="keybtn keybtn--quiet explore__nav explore__nav--next" disabled={!next} onClick={() => next && props.onNavigate(next.id)}>
              <span>{next?.displayName ?? '—'}</span>
              <TriangleIcon dir="right" />
            </button>
          </div>
          <button type="button" className="keybtn keybtn--quiet explore__surprise" disabled={!others.length} onClick={surprise}>
            <ShuffleIcon /> Surprise me
          </button>
        </nav>

        <details className="machine__details">
          <summary>About this entry</summary>
          <dl className="machine__facts">
            <dt>Identity</dt>
            <dd>{STATUS_TEXT[m.identityStatus] ?? m.identityStatus}</dd>
            {m.aliases.length > 0 && (
              <>
                <dt>Also listed as</dt>
                <dd>{m.aliases.join(', ')}</dd>
              </>
            )}
            <dt>Samples</dt>
            <dd>Attribution is provisional until the library curation confirms the recordings.</dd>
          </dl>
          {!m.photo && <p className="muted">No verified photo of this model yet.</p>}
        </details>
      </div>
    </Sheet>
  )
}
