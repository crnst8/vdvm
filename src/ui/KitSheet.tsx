// Kit picker for machines with several kits. Picking loads the kit and keeps the
// sheet open, so kits can be compared while a pattern plays.
import { Sheet } from './Sheet'

export function KitSheet(props: {
  open: boolean
  onClose: () => void
  title: string
  kits: { id: string; label: string; full: string }[]
  activeKitId: string | null
  loadingKitId: string | null
  progress: { done: number; total: number }
  onSelectKit: (kitId: string) => void
}) {
  return (
    <Sheet open={props.open} onClose={props.onClose} title={props.title} closeLabel="Done" className="sheet--kits" returnFocusId="kits-button">
      <div className="kitgrid" role="radiogroup" aria-label={props.title}>
        {props.kits.map((k) => {
          const active = k.id === props.activeKitId
          const loading = k.id === props.loadingKitId
          return (
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={k.full}
              title={k.full}
              data-autofocus={active ? '' : undefined}
              className={`tkey kitkey kitkey--grid${active ? ' tkey--latched kitkey--active' : ''}${loading ? ' kitkey--loading' : ''}`}
              onClick={() => !active && props.onSelectKit(k.id)}
            >
              <span className="kitkey__led" aria-hidden="true" />
              <span className="kitkey__label">{k.label}</span>
              {loading && props.progress.total > 0 && (
                <span className="kitkey__progress" style={{ width: `${(props.progress.done / props.progress.total) * 100}%` }} aria-hidden="true" />
              )}
            </button>
          )
        })}
      </div>
    </Sheet>
  )
}
