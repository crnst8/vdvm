// Library: tabs for Machines, Patterns, Sounds, then Offline (browser) or
// Sources (plugin libraries and imports). The last tab used is remembered.
import type { ReactNode } from 'react'
import type { LibraryTab } from '../data/prefs'
import { Sheet } from './Sheet'
import { MachinesTab, type MachinesTabProps } from './library/MachinesTab'
import { PatternsTab, type PatternsTabProps } from './library/PatternsTab'
import { SoundsTab, type SoundsTabProps } from './library/SoundsTab'
import { OfflineTab, type OfflineTabProps } from './library/OfflineTab'

const ALL_TABS: { id: LibraryTab; label: string }[] = [
  { id: 'machines', label: 'Machines' },
  { id: 'patterns', label: 'Patterns' },
  { id: 'sounds', label: 'Sounds' },
  { id: 'offline', label: 'Offline' },
  { id: 'sources', label: 'Sources' },
]

export function LibrarySheet(p: {
  open: boolean
  onClose: () => void
  tab: LibraryTab
  onTab: (t: LibraryTab) => void
  machines: (MachinesTabProps & { key?: number }) | null
  patterns: PatternsTabProps
  sounds: SoundsTabProps | null
  /** Browser offline kits; null hides the tab. */
  offline: OfflineTabProps | null
  /** Plugin libraries and imports; null hides the tab. */
  sources?: ReactNode | null
}) {
  const TABS = ALL_TABS.filter((t) => (t.id !== 'offline' || p.offline) && (t.id !== 'sources' || p.sources))
  const tab = TABS.some((t) => t.id === p.tab) ? p.tab : TABS[0].id
  const tabs = (
    <div className="tabs" role="tablist" aria-label="Library sections">
      {TABS.map((t) => (
        <button
          key={t.id}
          id={`libtab-${t.id}`}
          type="button"
          role="tab"
          className="tab"
          aria-selected={tab === t.id}
          aria-controls="libpanel"
          tabIndex={tab === t.id ? 0 : -1}
          onClick={() => p.onTab(t.id)}
          onKeyDown={(e) => {
            const i = TABS.findIndex((x) => x.id === tab)
            const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null
            if (next === null) return
            e.preventDefault()
            const t2 = TABS[(next + TABS.length) % TABS.length]
            p.onTab(t2.id)
            document.getElementById(`libtab-${t2.id}`)?.focus()
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
  return (
    <Sheet
      open={p.open}
      onClose={p.onClose}
      title="Library"
      returnFocusId="library-button"
      className="sheet--library"
      subheader={tabs}
      contentKey={tab}
    >
      <div id="libpanel" role="tabpanel" aria-labelledby={`libtab-${tab}`} className="libpanel">
        {tab === 'machines' &&
          (p.machines ? (() => {
            const { key, ...rest } = p.machines
            return <MachinesTab key={key} {...rest} />
          })() : <p className="empty">Loading catalog…</p>)}
        {tab === 'patterns' && <PatternsTab {...p.patterns} />}
        {tab === 'sounds' && (p.sounds ? <SoundsTab {...p.sounds} /> : <p className="empty">No kit loaded yet.</p>)}
        {tab === 'offline' && p.offline && <OfflineTab {...p.offline} />}
        {tab === 'sources' && p.sources}
      </div>
    </Sheet>
  )
}
