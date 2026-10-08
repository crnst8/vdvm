// Shell service worker. Generated into dist/sw.js by vite.config.ts, which
// fills in the version and precache list. Handles the app shell only: catalog
// JSON and audio are cached by the page (src/data/cache.ts).
const VERSION = '__VERSION__'
const SHELL = `drums-shell-${VERSION}`
const PRECACHE = __PRECACHE__
const scope = new URL(self.registration.scope)
// The shell is cached under the scope URL ('./'), never 'index.html': hosts such
// as Cloudflare Pages redirect /index.html to /, and Safari refuses to serve a
// redirected response to a navigation ("Response served by service worker has
// redirections"). unredirect() is the second guard for any response that slips in.
const SHELL_URL = scope.href
// Precached files at the scope root (manifest, icons): served from the cache like assets.
const ROOT_FILES = new Set(PRECACHE.filter((p) => !p.includes('/') && p !== './').map((p) => new URL(p, scope).pathname))
const unredirect = (r) =>
  r && r.redirected ? r.blob().then((body) => new Response(body, { status: r.status, statusText: r.statusText, headers: r.headers })) : r

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE.map((p) => new URL(p, scope).href))))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('drums-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return
  if (req.mode === 'navigate') {
    // Network first so updates arrive; cached shell when offline.
    event.respondWith(
      fetch(req)
        .catch(() => caches.open(SHELL).then((c) => c.match(SHELL_URL)))
        .then(unredirect)
        .then((r) => r || Response.error()),
    )
    return
  }
  if (url.pathname.startsWith(`${scope.pathname}assets/`) || ROOT_FILES.has(url.pathname)) {
    event.respondWith(caches.open(SHELL).then((c) => c.match(req).then((hit) => unredirect(hit) || fetch(req))))
  }
})
