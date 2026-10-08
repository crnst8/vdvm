// Registers the shell service worker in production builds. Updates activate
// only while the transport is stopped; the new shell is used on next load.
import { transport } from '../audio/instance'

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  const url = `${import.meta.env.BASE_URL}sw.js`
  navigator.serviceWorker.register(url, { scope: import.meta.env.BASE_URL }).then((reg) => {
    const activateWhenStopped = () => {
      const waiting = reg.waiting
      if (!waiting) return
      if (!transport.getSnapshot().playing) waiting.postMessage({ type: 'SKIP_WAITING' })
    }
    activateWhenStopped()
    reg.addEventListener('updatefound', () => {
      reg.installing?.addEventListener('statechange', activateWhenStopped)
    })
    transport.subscribe(activateWhenStopped)
  }, () => {
    /* No service worker: the app still works online; media cache still works. */
  })
}
