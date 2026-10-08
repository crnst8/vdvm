import { useCallback, useEffect, useRef } from 'react'

export const HOLD_DELAY_MS = 400
export const HOLD_INTERVAL_MS = 100

/**
 * Press-and-hold repeat for pointer input plus a single step for keyboard
 * activation. Returns props for a <button>.
 */
export function useHoldRepeat(action: () => void) {
  const ref = useRef(action)
  ref.current = action
  const timers = useRef<{ delay?: number; interval?: number }>({})
  const clear = useCallback(() => {
    window.clearTimeout(timers.current.delay)
    window.clearInterval(timers.current.interval)
    timers.current = {}
  }, [])
  useEffect(() => clear, [clear])
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return
      ref.current()
      clear()
      // The key disables itself at its limit and then receives no pointerup; stop on any release.
      window.addEventListener('pointerup', clear, { once: true })
      window.addEventListener('pointercancel', clear, { once: true })
      timers.current.delay = window.setTimeout(() => {
        timers.current.interval = window.setInterval(() => ref.current(), HOLD_INTERVAL_MS)
      }, HOLD_DELAY_MS)
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClick: (e: React.MouseEvent) => {
      // Pointer presses already acted on pointerdown; keyboard activation is a click with detail 0.
      if (e.detail === 0) ref.current()
    },
  }
}

/** Fires on pointerdown for pointer input, on click for keyboard, never twice. */
export function pressProps(action: () => void) {
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button === 0) action()
    },
    onClick: (e: React.MouseEvent) => {
      if (e.detail === 0) action()
    },
  }
}

export const isTextTarget = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

export const HOLD_OPEN_MS = 400
const MOVE_CANCEL_PX = 10

export interface HoldHandlers {
  /** Immediately on pointer down (e.g. select + audition). */
  onDown?: () => void
  /** Pointer released before the hold delay without moving, or keyboard activation. */
  onTap?: () => void
  /** Held for HOLD_OPEN_MS. Also reachable by right-click and the V key, so it is never hold-only. */
  onHold: () => void
}

/**
 * Tap vs hold on the same button. Returns a binder so one hook serves a row of
 * keys. Multi-touch safe (tracked per pointer); moving more than 10 px cancels.
 */
export function useHold(delay = HOLD_OPEN_MS) {
  const active = useRef(new Map<number, { timer: number; x: number; y: number; held: boolean }>())
  useEffect(() => {
    const map = active.current
    return () => map.forEach((st) => window.clearTimeout(st.timer))
  }, [])
  return useCallback(
    (h: HoldHandlers) => {
      const end = (id: number) => {
        const st = active.current.get(id)
        if (st) window.clearTimeout(st.timer)
        active.current.delete(id)
        return st
      }
      return {
        onPointerDown: (e: React.PointerEvent) => {
          if (e.button !== 0) return
          h.onDown?.()
          const st = { timer: 0, x: e.clientX, y: e.clientY, held: false }
          st.timer = window.setTimeout(() => {
            st.held = true
            navigator.vibrate?.(8)
            h.onHold()
          }, delay)
          active.current.set(e.pointerId, st)
        },
        onPointerMove: (e: React.PointerEvent) => {
          const st = active.current.get(e.pointerId)
          if (st && !st.held && Math.hypot(e.clientX - st.x, e.clientY - st.y) > MOVE_CANCEL_PX) end(e.pointerId)
        },
        onPointerUp: (e: React.PointerEvent) => {
          const st = end(e.pointerId)
          if (st && !st.held) h.onTap?.()
        },
        onPointerCancel: (e: React.PointerEvent) => void end(e.pointerId),
        onContextMenu: (e: React.MouseEvent) => {
          e.preventDefault()
          // Touch long-press also fires contextmenu while the pointer is down; the timer handles that case.
          if (active.current.size === 0) h.onHold()
        },
        onClick: (e: React.MouseEvent) => {
          if (e.detail === 0) h.onTap?.()
        },
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'v' || e.key === 'V') {
            e.preventDefault()
            e.stopPropagation()
            h.onHold()
          }
        },
      }
    },
    [delay],
  )
}

/**
 * Run at most once per `ms`, but always run the most recent call afterwards.
 * Used for audition previews so the last value of a drag is heard, not dropped.
 */
export function useThrottleLatest<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  const ref = useRef(fn)
  ref.current = fn
  const last = useRef(0)
  const timer = useRef<number | null>(null)
  const pending = useRef<A | null>(null)
  const run = useCallback(() => {
    last.current = performance.now()
    timer.current = null
    const args = pending.current
    pending.current = null
    if (args) ref.current(...args)
  }, [])
  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    pending.current = null
  }, [])
  useEffect(() => cancel, [cancel])
  const call = useCallback(
    (...args: A) => {
      pending.current = args
      const wait = ms - (performance.now() - last.current)
      if (wait <= 0) run()
      else if (timer.current === null) timer.current = window.setTimeout(run, wait)
    },
    [ms, run],
  )
  return { call, cancel }
}

/** Run at most once per `ms`, dropping calls in between. */
export function useThrottle(fn: () => void, ms: number) {
  const last = useRef(0)
  const ref = useRef(fn)
  ref.current = fn
  return useCallback(() => {
    const now = performance.now()
    if (now - last.current >= ms) {
      last.current = now
      ref.current()
    }
  }, [ms])
}
