import { PAGE_SIZE } from '../state/pattern'
import { useHold } from './hooks'

export function StepBank(props: {
  steps: boolean[]
  page: number
  playStep: number | null
  trackLabel: string
  silent: boolean
  /** Steps at or beyond this index are outside the loop (kept, not played). */
  loopLength: number
  desktop?: boolean
  onToggle: (step: number) => void
  onHoldStep: (step: number) => void
}) {
  const { steps, page, playStep } = props
  const bind = useHold()
  const rows = [0, 1].map((r) => Array.from({ length: props.desktop ? 8 : 4 }, (_, c) => props.desktop ? r * 8 + c : page * PAGE_SIZE + r * 4 + c))
  const outside = !props.desktop && page * PAGE_SIZE >= props.loopLength
  return (
    <section
      className={`bank${outside ? ' bank--outside' : ''}`}
      aria-label={`Steps ${props.desktop ? '1 to 16' : `${page * 8 + 1} to ${page * 8 + 8}`} for ${props.trackLabel}${outside ? ', outside the 8-step loop' : ''}`}
    >
      {rows.map((row, r) => (
        <div className="bank__row" key={r}>
          <div className="bar" aria-hidden="true">
            {row.map((step) => (
              <span key={step} className={`bar__cell${playStep === step ? ' bar__cell--on' : ''}`} />
            ))}
          </div>
          <div className="bank__keys">
            {row.map((step) => {
              const on = steps[step]
              return (
                <button
                  key={step}
                  id={`step-${step}`}
                  type="button"
                  className={`step${on ? ' step--on' : ''}${props.silent ? ' step--silent' : ''}${step >= props.loopLength ? ' step--outside' : ''}`}
                  aria-pressed={on}
                  aria-label={`Step ${step + 1}`}
                  aria-description="Hold, right-click or press V for step volume"
                  {...bind({ onTap: () => props.onToggle(step), onHold: () => props.onHoldStep(step) })}
                >
                  <span className="step__num" aria-hidden="true">{step + 1}</span>
                  <span className="step__led" aria-hidden="true" />
                  <span className="step__cap" aria-hidden="true" />
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </section>
  )
}
