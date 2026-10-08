// Output volume for this device: cuts or boosts everything the app plays, relative
// to the default level. Opened from the speaker key in the header (both layouts).
// Stored in prefs, not in patterns; exports stay at the default level.
import { OUTPUT_GAIN_MAX_DB, OUTPUT_GAIN_MIN_DB } from '../audio/engine'
import { Sheet } from './Sheet'
import { SpeakerIcon } from './icons'
import { formatDb } from './VolumeSheet'

const SPAN = OUTPUT_GAIN_MAX_DB - OUTPUT_GAIN_MIN_DB

export function OutputSheet(props: {
  open: boolean
  onClose: () => void
  db: number
  onChange: (db: number) => void
  returnFocusId: string
}) {
  const pct = (props.db - OUTPUT_GAIN_MIN_DB) / SPAN
  const unity = -OUTPUT_GAIN_MIN_DB / SPAN
  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title="Output volume"
      closeLabel="Done"
      className="sheet--volume"
      returnFocusId={props.returnFocusId}
      icon={<SpeakerIcon className="sheet__icon" />}
    >
      <section className="vol__drum" aria-labelledby="out-level">
        <div className="vol__row">
          <h3 id="out-level">Level</h3>
          <output className="vol__value" htmlFor="out-gain">{formatDb(props.db)}</output>
        </div>
        <input
          id="out-gain"
          name="output-volume"
          className="fader fader--h"
          type="range"
          min={OUTPUT_GAIN_MIN_DB}
          max={OUTPUT_GAIN_MAX_DB}
          step={0.5}
          value={props.db}
          aria-valuetext={formatDb(props.db)}
          data-autofocus=""
          style={{ ['--fill' as string]: `${pct * 100}%`, ['--unity' as string]: `${unity * 100}%` }}
          onChange={(e) => props.onChange(Number(e.target.value))}
        />
        <div className="vol__scale" aria-hidden="true">
          <span>{OUTPUT_GAIN_MIN_DB}</span>
          <span style={{ left: `${unity * 100}%` }}>0 dB</span>
          <span>+{OUTPUT_GAIN_MAX_DB}</span>
        </div>
        <div className="vol__actions">
          <button type="button" onClick={() => props.onChange(0)} disabled={props.db === 0}>
            Set 0 dB
          </button>
        </div>
      </section>
    </Sheet>
  )
}
