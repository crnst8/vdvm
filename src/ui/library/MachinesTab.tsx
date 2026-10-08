import { useMemo, useState } from 'react'
import type { CatalogIndex, Machine } from '../../contract/types'
import { preferredKit, sortMachines } from '../../data/catalog'
import type { ArrowScope } from '../../data/prefs'
import { MachineCard } from './MachineCard'
import { ChevronIcon } from '../icons'
import { useArtwork } from '../useArtwork'

/** The maker's logo, once per group; loads when the header is rendered. */
function GroupLogo({ machines, resolve }: { machines: Machine[]; resolve: (rel: string) => string }) {
  const logo = machines.find((m) => m.logo)?.logo ?? null
  const url = useArtwork(logo ? resolve(logo.url) : null, logo?.sha256 ?? null)
  if (!logo || !url) return null
  return <img className="mgroup__logo" src={url} alt="" width={logo.width} height={logo.height} />
}

type Filter = 'all' | 'favourites' | 'recent'

export interface MachinesTabProps {
  index: CatalogIndex
  resolve: (rel: string) => string
  activeKitId: string | null
  loadingKitId: string | null
  progress: { done: number; total: number }
  favourites: Set<string>
  recents: string[]
  savedKitIds: Set<string>
  arrowScope: ArrowScope
  onArrowScope: (s: ArrowScope) => void
  onSelectKit: (kitId: string) => void
  onToggleFavourite: (machineId: string) => void
  onDetails: (machineId: string) => void
  /** Search text to start with (e.g. a manufacturer from machine details). */
  initialQuery?: string
}

const matches = (m: Machine, q: string) =>
  !q || [m.displayName, m.manufacturer, m.model, ...m.aliases].some((s) => s.toLowerCase().includes(q))

export function MachinesTab(p: MachinesTabProps) {
  const [query, setQuery] = useState(p.initialQuery ?? '')
  const [filter, setFilter] = useState<Filter>('all')
  const q = query.trim().toLowerCase()
  const activeMachineId = p.index.kits.find((k) => k.id === p.activeKitId)?.machineId ?? null
  const activeMaker = p.index.machines.find((m) => m.id === activeMachineId)?.manufacturer ?? null
  // Browsing all machines shows manufacturers as bundles; the playing machine's maker starts open.
  const bundled = filter === 'all' && !q
  const [openMakers, setOpenMakers] = useState<Set<string>>(() => new Set(activeMaker ? [activeMaker] : []))
  const toggleMaker = (maker: string, el: HTMLElement | null) => {
    setOpenMakers((cur) => {
      const next = new Set(cur)
      if (next.has(maker)) next.delete(maker)
      else {
        next.add(maker)
        requestAnimationFrame(() => el?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
      }
      return next
    })
  }

  const recentMachines = useMemo(() => {
    const ids: string[] = []
    for (const kitId of p.recents) {
      const mid = p.index.kits.find((k) => k.id === kitId)?.machineId
      if (mid && !ids.includes(mid)) ids.push(mid)
    }
    return ids.map((id) => p.index.machines.find((m) => m.id === id)).filter((m): m is Machine => !!m)
  }, [p.index, p.recents])

  const shown = useMemo(() => {
    if (filter === 'recent') return recentMachines.filter((m) => matches(m, q))
    const all = sortMachines(p.index.machines).filter((m) => matches(m, q))
    return filter === 'favourites' ? all.filter((m) => p.favourites.has(m.id)) : all
  }, [filter, q, p.index, p.favourites, recentMachines])

  // Group by manufacturer, keeping display order (recent view stays ungrouped: order is the point).
  const groups = useMemo(() => {
    if (filter === 'recent') return [{ maker: '', machines: shown }]
    const byMaker = new Map<string, Machine[]>()
    for (const m of shown) byMaker.set(m.manufacturer, [...(byMaker.get(m.manufacturer) ?? []), m])
    return [...byMaker].map(([maker, machines]) => ({ maker, machines }))
  }, [shown, filter])

  const card = (m: Machine) => (
    <MachineCard
      key={m.id}
      machine={m}
      kits={p.index.kits.filter((k) => k.machineId === m.id)}
      activeKitId={p.activeKitId}
      loadingKitId={p.loadingKitId}
      progress={p.progress}
      favourite={p.favourites.has(m.id)}
      savedOffline={p.index.kits.some((k) => k.machineId === m.id && p.savedKitIds.has(k.id))}
      showLogo={filter === 'recent'}
      preferredKitId={preferredKit(p.index, m.id, p.recents)?.id ?? null}
      resolve={p.resolve}
      onSelectKit={p.onSelectKit}
      onToggleFavourite={() => p.onToggleFavourite(m.id)}
      onDetails={() => p.onDetails(m.id)}
    />
  )


  return (
    <div className="mtab">
      <div className="mtab__tools">
        <input
          className="lib__search"
          type="search"
          name="machine-search"
          placeholder={`Search ${p.index.machines.length} machines`}
          aria-label="Search machines"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="chips" role="group" aria-label="Show">
          {(['all', 'favourites', 'recent'] as const).map((f) => (
            <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'favourites' ? `★ Favourites${p.favourites.size ? ` ${p.favourites.size}` : ''}` : 'Recent'}
            </button>
          ))}
        </div>
        {filter === 'favourites' && (
          <div className="mtab__scope" role="group" aria-label="Kit arrows beside the logo step through">
            <span>Logo arrows step through</span>
            <span className="chips">
              <button type="button" className="chip" aria-pressed={p.arrowScope === 'all'} onClick={() => p.onArrowScope('all')}>
                All
              </button>
              <button
                type="button"
                className="chip"
                aria-pressed={p.arrowScope === 'favourites'}
                disabled={p.favourites.size === 0}
                onClick={() => p.onArrowScope('favourites')}
              >
                Favourites
              </button>
            </span>
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="empty">
          {q
            ? `No machines match “${query}”.`
            : filter === 'favourites'
              ? 'No favourites yet. Tap ☆ on a machine, or the ☆ under the logo on the panel.'
              : 'Kits you load appear here.'}
        </p>
      ) : (
        groups.map((g) =>
          bundled ? (
            <section key={g.maker} className={`mbundle${openMakers.has(g.maker) ? ' mbundle--open' : ''}`}>
              <button
                type="button"
                className="mbundle__head"
                aria-expanded={openMakers.has(g.maker)}
                onClick={(e) => toggleMaker(g.maker, e.currentTarget.parentElement)}
              >
                <GroupLogo machines={g.machines} resolve={p.resolve} />
                <span className="mbundle__name">{g.maker}</span>
                <span className="mbundle__meta">
                  {g.maker === activeMaker && <span className="led led--on" aria-label="Playing" />}
                  {g.machines.some((m) => p.favourites.has(m.id)) && <span className="mbundle__star" aria-label="Has favourites">★</span>}
                  <span className="mbundle__count">{g.machines.length}</span>
                  <ChevronIcon open={openMakers.has(g.maker)} />
                </span>
              </button>
              {openMakers.has(g.maker) && <ul className="mlist mbundle__list">{g.machines.map(card)}</ul>}
            </section>
          ) : (
            <section key={g.maker || 'recent'} className="mgroup" aria-label={g.maker || 'Recent'}>
              {g.maker && (
                <h4 className="mgroup__head">
                  <GroupLogo machines={g.machines} resolve={p.resolve} />
                  <span className="mgroup__maker">{g.maker}</span> <span className="mgroup__count">{g.machines.length}</span>
                </h4>
              )}
              <ul className="mlist">{g.machines.map(card)}</ul>
            </section>
          ),
        )
      )}
    </div>
  )
}
