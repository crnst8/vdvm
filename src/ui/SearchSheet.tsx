// Machine search: one field with an inline completion and a ranked list under it. Enter loads
// the highlighted machine (Shift+Enter opens its details), arrows move, Tab or → takes the
// completion, Escape clears, then closes. Desktop: a box near the top of the window. Phones: the
// whole screen, a large field and tall rows, and the keyboard's Go key loads.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { CatalogIndex } from '../contract/types'
import { completionFor, searchMachines, type SearchHit } from '../data/search'
import { SearchIcon, StarIcon } from './icons'

/** Wraps the first match of each typed word, at the start of a word, in <mark>. */
function marked(text: string, query: string): ReactNode {
  const terms = query.toLowerCase().match(/[a-z0-9]+/g) ?? []
  const ranges: [number, number][] = []
  const lower = text.toLowerCase()
  for (const t of terms) {
    const re = new RegExp(`(^|[^a-z0-9])(${t})`, 'g')
    const m = re.exec(lower)
    if (m) ranges.push([m.index + m[1].length, m.index + m[1].length + t.length])
  }
  if (!ranges.length) return text
  ranges.sort((a, b) => a[0] - b[0])
  const out: ReactNode[] = []
  let at = 0
  for (const [s, e] of ranges) {
    if (s < at) continue
    if (s > at) out.push(text.slice(at, s))
    out.push(<mark key={s}>{text.slice(s, e)}</mark>)
    at = e
  }
  out.push(text.slice(at))
  return out
}

export function SearchSheet(props: {
  open: boolean
  onClose: () => void
  desktop: boolean
  index: CatalogIndex | null
  favourites: Set<string>
  recents: string[]
  activeKitId: string | null
  loadingKitId: string | null
  /** Load the machine's preferred kit. */
  onLoad: (machineId: string) => void
  onDetails: (machineId: string) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (props.open && !d.open) {
      opener.current = document.activeElement as HTMLElement | null
      setQuery('')
      setActive(0)
      d.showModal()
      input.current?.focus()
    } else if (!props.open && d.open) d.close()
  }, [props.open])

  const hits = useMemo(
    () => (props.index && props.open ? searchMachines(props.index, query, { favourites: props.favourites, recents: props.recents }) : []),
    [props.index, props.open, query, props.favourites, props.recents],
  )
  const at = Math.min(active, Math.max(0, hits.length - 1))
  const completion = query ? completionFor(query, hits[0]) : null
  const activeMachineId = props.index?.kits.find((k) => k.id === (props.loadingKitId ?? props.activeKitId))?.machineId ?? null

  // Keep the highlighted row in view while moving with the keys.
  useLayoutEffect(() => {
    list.current?.querySelector<HTMLElement>(`#search-opt-${at}`)?.scrollIntoView({ block: 'nearest' })
  }, [at, hits])

  const choose = (hit: SearchHit | undefined, details = false) => {
    if (!hit) return
    ref.current?.close()
    if (details) props.onDetails(hit.machine.id)
    else if (hit.machine.id !== activeMachineId) props.onLoad(hit.machine.id)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const atEnd = e.currentTarget.selectionStart === query.length && e.currentTarget.selectionEnd === query.length
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!hits.length) return
      setActive((at + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length)
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault()
      setActive(Math.min(hits.length - 1, Math.max(0, at + (e.key === 'PageDown' ? 8 : -8))))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (!e.nativeEvent.isComposing) choose(hits[at], e.shiftKey)
    } else if ((e.key === 'Tab' && !e.shiftKey) || (e.key === 'ArrowRight' && atEnd)) {
      if (completion) {
        e.preventDefault()
        setQuery(query + completion)
        setActive(0)
      }
    } else if (e.key === 'Escape' && query) {
      e.preventDefault()
      setQuery('')
      setActive(0)
    }
  }

  return (
    <dialog
      ref={ref}
      className={`search search--${props.desktop ? 'desktop' : 'phone'}`}
      aria-label="Search machines"
      onClose={() => {
        props.onClose()
        // Focus the panel key that opened search, unless choosing a machine opened another dialog.
        requestAnimationFrame(() => {
          if (!document.querySelector('dialog[open]')) (document.getElementById('search-button') ?? opener.current)?.focus?.()
        })
      }}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close()
      }}
    >
      <div className="search__box">
        <div className="search__field">
          <SearchIcon className="search__glass" />
          <div className="search__entry">
            {completion && (
              <span className="search__ghost" aria-hidden="true">
                <span className="search__typed">{query}</span>{completion}
              </span>
            )}
            <input
              ref={input}
              className="search__input"
              type="search"
              name="machine-search"
              role="combobox"
              aria-label="Search machines"
              aria-expanded={hits.length > 0}
              aria-controls="search-list"
              aria-autocomplete="both"
              aria-activedescendant={hits.length ? `search-opt-${at}` : undefined}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="go"
              placeholder="Machine or maker"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          <button type="button" className="search__close" onClick={() => ref.current?.close()}>
            {props.desktop ? 'Esc' : 'Cancel'}
          </button>
        </div>
        <div ref={list} id="search-list" className="search__list" role="listbox" aria-label="Machines">
          {hits.map((h, i) => {
            const playing = h.machine.id === activeMachineId
            return (
              <div
                key={h.machine.id}
                id={`search-opt-${i}`}
                role="option"
                aria-selected={i === at}
                className={`search__row${i === at ? ' search__row--active' : ''}`}
                onPointerMove={() => i !== at && setActive(i)}
                onClick={(e) => choose(h, e.shiftKey)}
              >
                <span className={`search__led${playing ? ' search__led--on' : ''}`} aria-hidden="true" />
                <span className="search__name">
                  <span className="search__maker">{marked(h.machine.manufacturer, query)}</span>
                  <span className="search__model">{marked(h.machine.model, query)}</span>
                  {playing && <span className="visually-hidden">, playing</span>}
                </span>
                {props.favourites.has(h.machine.id) && <StarIcon filled className="search__star" aria-label="Favourite" />}
                <span className="search__kits">{h.kits > 1 ? `${h.kits} kits` : ''}</span>
              </div>
            )
          })}
          {query.trim() && !hits.length && <p className="search__empty">No machines</p>}
        </div>
      </div>
    </dialog>
  )
}
