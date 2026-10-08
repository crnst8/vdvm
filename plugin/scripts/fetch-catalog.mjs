// Downloads a published catalog (index, kits, credits, audio, logos, photos)
// into a folder, for building the bundled installer without a local catalog.
//   node plugin/scripts/fetch-catalog.mjs <base url> <out dir>
// Files already present with the expected size are kept. plugin/package.sh
// validates the result (hashes, WAV headers, references) before packaging.
import { mkdir, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'

const [base, out] = process.argv.slice(2)
if (!base || !out) {
  console.error('usage: fetch-catalog.mjs <base url> <out dir>')
  process.exit(1)
}
const url = (rel) => new URL(rel, base.endsWith('/') ? base : base + '/').href

async function get(rel, attempts = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url(rel))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return new Uint8Array(await res.arrayBuffer())
    } catch (e) {
      if (i >= attempts) throw new Error(`${rel}: ${e.message}`)
      await new Promise((r) => setTimeout(r, 1000 * i))
    }
  }
}

async function save(rel, bytes) {
  const file = path.join(out, rel)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, bytes, { mode: 0o644 })
}

const json = async (rel) => {
  const bytes = await get(rel)
  await save(rel, bytes)
  return JSON.parse(new TextDecoder().decode(bytes))
}

const index = await json('catalog/index.json')
await json(index.creditsUrl)
const files = new Map() // rel -> expected bytes, or null when unknown
for (const m of index.machines) for (const art of [m.logo, m.photo]) if (art) files.set(art.url, art.bytes ?? null)
for (const k of index.kits) {
  const kit = await json(k.url)
  for (const s of kit.samples) files.set(s.url, s.bytes)
}

let done = 0
const queue = [...files]
async function worker() {
  for (let next = queue.shift(); next; next = queue.shift()) {
    const [rel, bytes] = next
    const have = await stat(path.join(out, rel)).then((s) => s.size, () => -1)
    if (bytes === null || have !== bytes) await save(rel, await get(rel))
    if (++done % 1000 === 0) console.log(`  ${done}/${files.size}`)
  }
}
await Promise.all(Array.from({ length: 16 }, worker))
console.log(`catalog ${index.revision}: ${index.kits.length} kits, ${files.size} media files in ${out}`)
