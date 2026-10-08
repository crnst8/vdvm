// Builds the plugin's WebView frontend and packs it into plugin/build-ui/ui.zip,
// which CMake embeds in the plugin binary.
//   npm run plugin:ui
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.join(here, '../..')
const out = path.join(repo, 'plugin/build-ui')
const dist = path.join(out, 'dist')
const zip = path.join(out, 'ui.zip')

mkdirSync(out, { recursive: true })
execFileSync('npx', ['tsx', 'plugin/scripts/gen-shared.ts', '--check'], { cwd: repo, stdio: 'inherit' })
execFileSync('npx', ['vite', 'build', '--mode', 'plugin', '--outDir', dist, '--emptyOutDir'], { cwd: repo, stdio: 'inherit' })
if (!existsSync(path.join(dist, 'index.html'))) throw new Error('vite build produced no index.html')
rmSync(zip, { force: true })
if (process.platform === 'win32') {
  execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${dist}\\*' -DestinationPath '${zip}'`], { stdio: 'inherit' })
} else {
  // -X: no extra file attributes, so the archive depends only on the content.
  execFileSync('zip', ['-q', '-r', '-X', zip, ...readdirSync(dist)], { cwd: dist, stdio: 'inherit' })
}
console.log(`plugin UI packed: ${path.relative(repo, zip)}`)
