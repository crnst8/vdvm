import type { KitEntry, Machine } from '../../contract/types'
import { Art } from '../Art'
import { InfoIcon, StarIcon } from '../icons'

export interface MachineCardProps {
  machine: Machine
  kits: KitEntry[]
  activeKitId: string | null
  loadingKitId: string | null
  progress: { done: number; total: number }
  favourite: boolean
  savedOffline: boolean
  /** Kit a tap loads (the machine's most recently used kit, else its first). */
  preferredKitId: string | null
  /** False inside a manufacturer group, whose header already shows the logo. */
  showLogo: boolean
  resolve: (rel: string) => string
  onSelectKit: (kitId: string) => void
  onToggleFavourite: () => void
  onDetails: () => void
}

/** Short first sentence of the history for a one-line preview. */
export const firstSentence = (text: string) => {
  const m = text.match(/^.*?[.!?](\s|$)/)
  return (m ? m[0] : text).trim()
}

export function MachineCard(p: MachineCardProps) {
  const m = p.machine
  const active = p.kits.some((k) => k.id === p.activeKitId)
  const loading = p.kits.find((k) => k.id === p.loadingKitId)
  const primary = p.kits.find((k) => k.id === p.activeKitId) ?? p.kits.find((k) => k.id === p.preferredKitId) ?? p.kits[0]
  const pct = loading && p.progress.total ? Math.round((p.progress.done / p.progress.total) * 100) : 0
  return (
    <li className={`mcard${active ? ' mcard--active' : ''}${loading ? ' mcard--loading' : ''}`}>
      <button
        type="button"
        className="mcard__main"
        aria-current={active ? 'true' : undefined}
        aria-label={`${m.displayName}${active ? ', playing' : loading ? ', loading' : ''}. Load`}
        disabled={!primary}
        onClick={() => primary && p.onSelectKit(primary.id)}
      >
        <Art photo={m.photo} logo={p.showLogo ? m.logo : null} label={m.model} resolve={p.resolve} className="mcard__art" />
        <span className="mcard__text">
          <span className="mcard__name">{m.model}</span>
          <span className="mcard__maker">
            {m.manufacturer}
            {p.kits.length > 1 ? ` · ${p.kits.length} kits` : ''}
            {p.savedOffline ? ' · offline' : ''}
          </span>
          {m.history && <span className="mcard__blurb">{firstSentence(m.history.text)}</span>}
        </span>
        <span className="mcard__state" aria-hidden="true">
          {active ? <span className="led led--on" /> : loading ? `${pct}%` : null}
        </span>
        {loading && <span className="mcard__progress" style={{ width: `${pct}%` }} aria-hidden="true" />}
      </button>
      <div className="mcard__side">
        <button
          type="button"
          className={`iconbtn${p.favourite ? ' iconbtn--fav' : ''}`}
          aria-pressed={p.favourite}
          aria-label={`${p.favourite ? 'Remove' : 'Add'} ${m.displayName} ${p.favourite ? 'from' : 'to'} favourites`}
          onClick={p.onToggleFavourite}
        >
          <StarIcon filled={p.favourite} />
        </button>
        <button type="button" className="iconbtn" aria-label={`About ${m.displayName}`} onClick={p.onDetails}>
          <InfoIcon />
        </button>
      </div>
    </li>
  )
}
