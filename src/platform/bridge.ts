// Messages between the plugin's WebView and its C++ side (JUCE 8 native
// integration). Calls are asynchronous: a browser-to-native message is not
// sample accurate, and a pad audition sounds at the next audio block.
// Every native function answers with { ok, value?, error? }.

interface JuceBackend {
  emitEvent(eventId: string, payload: unknown): void
  addEventListener(eventId: string, fn: (payload: never) => void): unknown
  removeEventListener(token: unknown): void
}

declare global {
  interface Window {
    __JUCE__?: { backend: JuceBackend; initialisationData: Record<string, unknown[]> }
  }
}

interface Envelope<T> {
  ok: boolean
  value?: T
  error?: string
}

let nextPromiseId = 0
const pending = new Map<number, (result: unknown) => void>()
let installed = false

function backend(): JuceBackend {
  const b = window.__JUCE__?.backend
  if (!b) throw new Error('The plugin bridge is not available.')
  if (!installed) {
    installed = true
    b.addEventListener('__juce__complete', ({ promiseId, result }: { promiseId: number; result: unknown }) => {
      const resolve = pending.get(promiseId)
      if (!resolve) return
      pending.delete(promiseId)
      resolve(result)
    })
  }
  return b
}

export const bridgeAvailable = () => typeof window !== 'undefined' && !!window.__JUCE__?.backend

/** Call a native function; resolves with its value or rejects with its error message. */
export async function call<T = unknown>(name: string, arg?: unknown): Promise<T> {
  const b = backend()
  const promiseId = nextPromiseId++
  const result = await new Promise<unknown>((resolve) => {
    pending.set(promiseId, resolve)
    b.emitEvent('__juce__invoke', { name, params: arg === undefined ? [] : [arg], resultId: promiseId })
  })
  const env = result as Envelope<T> | null
  if (!env || typeof env !== 'object') throw new Error(`Native call ${name} returned nothing.`)
  if (!env.ok) throw new Error(env.error || `Native call ${name} failed.`)
  return env.value as T
}

/** Fire and forget (auditions, transport keys). Errors are logged, not thrown. */
export function send(name: string, arg?: unknown): void {
  call(name, arg).catch((e) => console.warn(`[drums] ${name}:`, e))
}

/** Listen to a native event. Returns an unsubscribe function. */
export function on<T>(event: string, fn: (payload: T) => void): () => void {
  const b = backend()
  const token = b.addEventListener(event, fn as (p: never) => void)
  return () => b.removeEventListener(token)
}
