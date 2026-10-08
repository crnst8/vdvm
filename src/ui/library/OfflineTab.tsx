export interface OfflineTabProps {
  kitLabel: string | null
  status: 'none' | 'saved' | 'incomplete'
  saving: { done: number; total: number } | null
  kitBytes: number
  ready: boolean
  usedBytes: number
  budgetBytes: number | null
  warning: string | null
  error: string | null
  savedKits: { id: string; label: string; bytes: number; verified: boolean }[]
  onSaveOffline: () => void
  onRemoveOffline: (kitId: string | null) => void
  onClearDownloads: () => void
}

const mb = (n: number) => `${(n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)} MB`

export function OfflineTab(p: OfflineTabProps) {
  return (
    <div className="otab">
      {p.kitLabel && (
        <div className="pcurrent">
          <div>
            <span className="pcurrent__label">Current kit</span>
            <span className="pcurrent__name">{p.kitLabel}</span>
            <span className="pcurrent__state">
              {p.saving
                ? `Saving ${p.saving.done}/${p.saving.total}`
                : p.status === 'saved'
                  ? `Saved offline · ${mb(p.kitBytes)}`
                  : p.status === 'incomplete'
                    ? 'Offline copy incomplete'
                    : 'Not saved offline'}
              {' · '}
              {p.ready ? 'ready to play' : 'loading'}
            </span>
          </div>
          <span className="pcurrent__actions">
            {p.status === 'saved' ? (
              <button type="button" className="keybtn keybtn--quiet" onClick={() => p.onRemoveOffline(null)} disabled={!!p.saving}>
                Remove
              </button>
            ) : (
              <button type="button" className="keybtn" onClick={p.onSaveOffline} disabled={!!p.saving}>
                {p.status === 'incomplete' ? 'Repair' : 'Save offline'}
              </button>
            )}
          </span>
        </div>
      )}
      {p.error && <p className="lib__error">{p.error}</p>}
      {p.warning && <p className="lib__error">{p.warning}</p>}
      <h4 className="lib__subhead">Saved offline {p.savedKits.length ? <span className="mgroup__count">{p.savedKits.length}</span> : null}</h4>
      {p.savedKits.length ? (
        <ul className="plist">
          {p.savedKits.map((k) => (
            <li key={k.id} className="prow">
              <span className="prow__main prow__main--static">
                <span className="prow__name">{k.label}</span>
                <span className="prow__meta">{k.verified ? mb(k.bytes) : 'incomplete'}</span>
              </span>
              <span className="prow__actions">
                <button type="button" className="textbtn" onClick={() => p.onRemoveOffline(k.id)}>
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">Kits you save offline play without a connection.</p>
      )}
      <div className="ostorage">
        <span>
          Downloaded sounds: {mb(p.usedBytes)}
          {p.budgetBytes !== null ? ` of ${mb(p.budgetBytes)}` : ''}
        </span>
        <button type="button" className="textbtn" onClick={p.onClearDownloads} disabled={!!p.saving || p.usedBytes === 0}>
          Clear
        </button>
      </div>
      <p className="muted">Clearing downloaded sounds keeps your patterns. The browser may remove stored files when the device runs low on space.</p>
    </div>
  )
}
