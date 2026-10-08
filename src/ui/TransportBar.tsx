import { SevenSegment } from './Segments'
import { TriangleIcon } from './icons'
import { useHoldRepeat } from './hooks'
import { BPM_MAX, BPM_MIN } from '../state/pattern'

export function TransportBar(props: {
  bpm: number
  page: number
  playingHalf: number | null
  playing: boolean
  canPlay: boolean
  loopLength: number
  onNudge: (delta: number) => void
  onOpenTempo: () => void
  onPage: () => void
  onLoop: () => void
  onToggle: () => void
  /** Plugin in a host: HOST takes tempo and start/stop from the host; FREE runs on the panel's tempo. */
  tempoSource?: { host: boolean; hostBpm: number | null; onToggle: () => void }
}) {
  const fromHost = !!props.tempoSource?.host && props.tempoSource.hostBpm !== null
  const shownBpm = fromHost ? Math.round(props.tempoSource!.hostBpm!) : props.bpm
  const down = useHoldRepeat(() => props.onNudge(-1))
  const up = useHoldRepeat(() => props.onNudge(1))

  return (
    <section className={`transport${props.tempoSource ? ' transport--source' : ''}`} aria-label="Transport">
      <span className="bay__cap" aria-hidden="true">Playback</span>
      <div className="tempo" role="group" aria-label="Tempo">
        <button type="button" className="tkey tkey--arrow" aria-label="Tempo down" disabled={fromHost || props.bpm <= BPM_MIN} {...down}>
          <TriangleIcon dir="left" />
        </button>
        <button
          type="button"
          id="tempo-display"
          className="tempo__display"
          aria-label={fromHost ? `Tempo ${shownBpm} BPM from the host` : `Tempo ${props.bpm} BPM. Open tempo: tap tempo and entry`}
          disabled={fromHost}
          onClick={props.onOpenTempo}
        >
          <span className="readout__cap" aria-hidden="true">{fromHost ? 'HOST BPM' : 'BPM'}</span>
          <SevenSegment text={String(shownBpm)} cells={3} className="seg7" />
        </button>
        <button type="button" className="tkey tkey--arrow" aria-label="Tempo up" disabled={fromHost || props.bpm >= BPM_MAX} {...up}>
          <TriangleIcon dir="right" />
        </button>
      </div>
      {props.tempoSource && (
        <button
          type="button"
          className={`tkey tkey--square tkey--source${props.tempoSource.host ? ' tkey--latched' : ''}`}
          aria-pressed={props.tempoSource.host}
          aria-label={props.tempoSource.host ? 'Tempo and transport from the host. Switch to free' : 'Free tempo. Switch to host tempo and transport'}
          onClick={props.tempoSource.onToggle}
        >
          <span className="tkey__caption">TEMPO</span>
          <span className="tkey__label">{props.tempoSource.host ? 'HOST' : 'FREE'}</span>
        </button>
      )}
      <button
        type="button"
        className={`tkey tkey--square${props.loopLength === 8 ? ' tkey--latched' : ''}`}
        aria-pressed={props.loopLength === 8}
        aria-label={`Loop ${props.loopLength} steps. Switch to ${props.loopLength === 8 ? 16 : 8}`}
        onClick={props.onLoop}
      >
        <span className="tkey__caption">LOOP</span>
        <span className="tkey__label tkey__label--big">{props.loopLength}</span>
      </button>
      <button
        type="button"
        className="tkey tkey--square transport__page"
        aria-label={`Showing steps ${props.page === 0 ? '1 to 8' : '9 to 16'}. Switch page`}
        onClick={props.onPage}
      >
        <span className="tkey__label">{props.page === 0 ? '1–8' : '9–16'}</span>
        <span className="pageind" aria-hidden="true">
          <span className={props.playingHalf === 0 ? 'pageind--on' : ''} />
          <span className={`${props.playingHalf === 1 ? 'pageind--on' : ''}${props.loopLength === 8 ? ' pageind--unused' : ''}`} />
        </span>
      </button>
      <button
        type="button"
        className={`tkey tkey--square${props.playing ? ' tkey--latched' : ''}`}
        aria-pressed={props.playing}
        aria-label={props.playing ? 'Stop' : 'Play'}
        disabled={!props.canPlay}
        onClick={props.onToggle}
      >
        <span className="tkey__label">
          {props.playing ? (
            <>
              <span className="power--lit">ON</span>/OFF
            </>
          ) : (
            <>
              ON/<span className="power--lit">OFF</span>
            </>
          )}
        </span>
      </button>
    </section>
  )
}
