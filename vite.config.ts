import { defineConfig, type Plugin } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Web app manifest and install icons, served from the app root (src/pwa/).
const PWA_DIR = 'src/pwa'
const PWA_FILES = readdirSync(PWA_DIR).filter((f) => !f.startsWith('.')).sort()

/** Serves src/pwa/ at the root in dev, emits it into the build, and adds the manifest and icon tags. */
function webAppManifest(): Plugin {
  return {
    name: 'drums-pwa',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = (req.url ?? '').split('?')[0].slice(1)
        if (!PWA_FILES.includes(name)) return next()
        res.setHeader('Content-Type', name.endsWith('.webmanifest') ? 'application/manifest+json' : 'image/png')
        res.end(readFileSync(`${PWA_DIR}/${name}`))
      })
    },
    generateBundle() {
      for (const name of PWA_FILES) this.emitFile({ type: 'asset', fileName: name, source: readFileSync(`${PWA_DIR}/${name}`) })
    },
    transformIndexHtml() {
      return [
        { tag: 'link', attrs: { rel: 'manifest', href: 'manifest.webmanifest' }, injectTo: 'head' },
        { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '32x32', href: 'favicon-32.png' }, injectTo: 'head' },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: 'apple-touch-icon.png' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: 'V.D.V.M' }, injectTo: 'head' },
      ]
    },
  }
}

/** Emits dist/sw.js with a precache list of the built shell and src/pwa/ files (not catalog or media). */
function shellServiceWorker(): Plugin {
  return {
    name: 'drums-shell-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => f.startsWith('assets/'))
      const precache = ['./', ...files.sort(), ...PWA_FILES]
      const hash = createHash('sha256').update(precache.join('\n'))
      for (const name of PWA_FILES) hash.update(readFileSync(`${PWA_DIR}/${name}`))
      const version = hash.digest('hex').slice(0, 12)
      const source = readFileSync('src/sw/sw-template.js', 'utf8')
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace('__PRECACHE__', JSON.stringify(precache))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

/** Adds the Umami analytics tag when VITE_UMAMI_WEBSITE_ID is set (only .env.pages sets it). */
function umami(websiteId: string | undefined): Plugin {
  return {
    name: 'drums-umami',
    apply: 'build',
    transformIndexHtml() {
      if (!websiteId) return []
      return [{ tag: 'script', attrs: { defer: true, src: 'https://stats.crnst8.com/script.js', 'data-website-id': websiteId }, injectTo: 'head' }]
    },
  }
}

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }

export default defineConfig(({ mode }) => ({
  base: './',
  // The plugin build (vite build --mode plugin) swaps the browser platform for the native bridge.
  resolve: {
    alias: {
      '@platform': fileURLToPath(new URL(mode === 'plugin' ? './src/platform/native.ts' : './src/platform/web.ts', import.meta.url)),
    },
  },
  // Pages mode ships the shell only: catalog and media come from VITE_CATALOG_BASE (media.re20.one),
  // so the 1.1 GB public/ output stays out of the upload and deploy/pages supplies _headers.
  publicDir: mode === 'pages' ? 'deploy/pages' : mode === 'plugin' ? false : 'public',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react(), ...(mode === 'plugin' ? [] : [webAppManifest(), shellServiceWorker()]), umami(loadEnv(mode, process.cwd(), 'VITE_').VITE_UMAMI_WEBSITE_ID)],
  test: {
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
}))
