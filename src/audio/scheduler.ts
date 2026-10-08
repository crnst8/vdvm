// Lookahead step scheduler driven by the audio clock (MDN "A tale of two clocks").
// Timer arrival only wakes the loop; step times advance from the previous
// intended timestamp, so timer jitter never accumulates.

export const TICK_MS = 25
export const LOOKAHEAD_SEC = 0.1
/**
 * Lookahead while the page is hidden or the screen is locked. Browsers throttle
 * background timers to about one wakeup per second, and nothing is edited while
 * hidden, so the scheduler queues further ahead and rewinds when visible again.
 */
export const BACKGROUND_LOOKAHEAD_SEC = 1.5
/** A step this far behind the clock is a missed window: skip it instead of bursting. */
export const LATE_LIMIT_SEC = 0.05
export const STEPS_PER_BAR = 16

export const sixteenthSec = (bpm: number) => 60 / bpm / 4
export const swungStepSec = (bpm: number, step: number, amount: number, grid: 8 | 16) =>
  sixteenthSec(bpm) * (step % (grid === 8 ? 4 : 2) < (grid === 8 ? 2 : 1) ? amount / 50 : (100 - amount) / 50)

export interface SchedulerDeps {
  now(): number
  getBpm(): number
  /** Loop length in steps (16, or 8 to repeat steps 1-8). Read per step, like tempo. */
  getLength?(): number
  getSwing?(): { amount: number; grid: 8 | 16 }
  /** Called once per step, in order, before its hits are due. Must be synchronous. */
  scheduleStep(step: number, when: number, generation: number): void
  /** Steps whose window passed before the timer woke; they are skipped silently, the grid keeps its phase. */
  onSkip?(count: number): void
  setTimer?: (cb: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export interface QueuedStep {
  step: number
  when: number
  /** Swing latch before this step was scheduled, so a rewind restores it. */
  latch: { swing: number; grid: 8 | 16 }
}

/**
 * Wake-up timer for the scheduler. A dedicated worker's timer keeps firing at
 * full rate in hidden tabs, where main-thread timers are throttled; without
 * Worker support it falls back to setInterval.
 */
export function workerTimer(): Pick<SchedulerDeps, 'setTimer' | 'clearTimer'> {
  let worker: Worker | null = null
  try {
    const src = 'let h=null;onmessage=(e)=>{clearInterval(h);h=e.data>0?setInterval(()=>postMessage(0),e.data):null}'
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })))
  } catch {
    worker = null
  }
  if (!worker) return {}
  const w = worker
  let fn: (() => void) | null = null
  w.onmessage = () => fn?.()
  return {
    setTimer: (cb, ms) => {
      fn = cb
      w.postMessage(ms)
      return w
    },
    clearTimer: () => {
      fn = null
      w.postMessage(0)
    },
  }
}

export class StepScheduler {
  private deps: SchedulerDeps
  private timer: unknown = null
  private nextStep = 0
  private nextTime = 0
  private _generation = 0
  private _running = false
  /** Recently scheduled steps for UI display; trimmed as time passes. */
  queue: QueuedStep[] = []
  maxLateness = 0
  /** Steps skipped because the timer woke too late (diagnostics). */
  skipped = 0
  private lookahead = LOOKAHEAD_SEC
  private pairSwing = 50
  private pairGrid: 8 | 16 = 16

  constructor(deps: SchedulerDeps) {
    this.deps = deps
  }

  get running() {
    return this._running
  }
  get generation() {
    return this._generation
  }

  /** Start from step 0 at audio time `at`. A second start while running is ignored. */
  start(at: number): number {
    if (this._running) return this._generation
    this._running = true
    this._generation++
    this.nextStep = 0
    this.nextTime = at
    this.queue = []
    this.maxLateness = 0
    this.skipped = 0
    this.pairSwing = 50
    this.pairGrid = 16
    this.tick()
    const set = this.deps.setTimer ?? ((cb, ms) => setInterval(cb, ms))
    this.timer = set(() => this.tick(), TICK_MS)
    return this._generation
  }

  stop(): void {
    if (this.timer !== null) {
      const clear = this.deps.clearTimer ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>))
      clear(this.timer)
      this.timer = null
    }
    this._running = false
    this._generation++
    this.queue = []
    this.nextStep = 0
  }

  /** Queue further ahead while the page is hidden (see BACKGROUND_LOOKAHEAD_SEC). */
  setBackground(on: boolean): void {
    this.lookahead = on ? BACKGROUND_LOOKAHEAD_SEC : LOOKAHEAD_SEC
  }

  tick(): void {
    if (!this._running) return
    const now = this.deps.now()
    const late = now - this.nextTime
    if (late > this.maxLateness) this.maxLateness = late
    if (late > LATE_LIMIT_SEC) {
      // Missed windows are skipped, not burst: advance on the grid until a step is still due.
      let n = 0
      while (now - this.nextTime > LATE_LIMIT_SEC) {
        this.advance(this.nextStep, this.nextTime)
        n++
      }
      this.skipped += n
      this.deps.onSkip?.(n)
    }
    const horizon = now + this.lookahead
    const gen = this._generation
    while (this.nextTime < horizon && this._running && gen === this._generation) {
      const step = this.nextStep
      const when = this.nextTime
      this.queue.push({ step, when, latch: { swing: this.pairSwing, grid: this.pairGrid } })
      this.deps.scheduleStep(step, when, gen)
      this.advance(step, when)
    }
    // Keep only what the UI can still need.
    const keepFrom = now - 1
    let i = 0
    while (i < this.queue.length - 1 && this.queue[i + 1].when < keepFrom) i++
    if (i > 0) this.queue.splice(0, i)
  }

  /** Move to the step after `step`, which sounds (or would have sounded) at `when`. */
  private advance(step: number, when: number) {
    // Tempo is read per step, so a change applies to the next unscheduled step.
    const swing = this.deps.getSwing?.() ?? { amount: 50, grid: 16 }
    // Both grids align every four steps; changing division there preserves the beat.
    if (step % 4 === 0) this.pairGrid = swing.grid
    const group = this.pairGrid === 8 ? 4 : 2
    // Latch for each pair so a live amount change cannot change its total duration.
    if (step % group === 0) this.pairSwing = swing.amount
    this.nextTime = when + swungStepSec(this.deps.getBpm(), step, this.pairSwing, this.pairGrid)
    const length = this.deps.getLength?.() ?? STEPS_PER_BAR
    // A shortened loop wraps at its end; a step already past the new end wraps too.
    this.nextStep = step + 1 >= length ? 0 : step + 1
  }

  /**
   * Forget queued steps due at or after `from` so they are scheduled again with
   * current state. Returns the time of the first forgotten step (the caller
   * cancels hits from there), or null when nothing was queued that late.
   */
  rewind(from: number): number | null {
    if (!this._running) return null
    const i = this.queue.findIndex((q) => q.when >= from)
    if (i < 0) return null
    const q = this.queue[i]
    this.queue.splice(i)
    this.nextStep = q.step
    this.nextTime = q.when
    this.pairSwing = q.latch.swing
    this.pairGrid = q.latch.grid
    return q.when
  }

  /** Step sounding at audio time `t`, or null before the first step. */
  stepAt(t: number): number | null {
    let found: number | null = null
    for (const q of this.queue) {
      if (q.when <= t) found = q.step
      else break
    }
    return found
  }
}
