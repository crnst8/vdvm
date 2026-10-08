// Builds runtime catalog output.
//   --mode fixture: the synthesised test kits (test-kit.ts) plus any source
//   records in fixtures/sources/*.json (see from-folder.ts); writes
//   public/fixture/{catalog,media}/.
//   --mode full: the curated catalog, built by scripts/catalog/full.ts, which
//   is not part of this repository.
// Output is deterministic: identical inputs give identical bytes and revisions.
import { readFile, writeFile, mkdir, readdir, rm, copyFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { readWavInfo } from '../../src/contract/wav.ts'
import type { CatalogIndex, KitManifest, Machine, Sample, Slot, Credits } from '../../src/contract/types.ts'
import { sha256, revisionOf, stableJson, peakDbfs, parseArgs, OUTPUT_ROOTS } from './lib.ts'
import { TEST_KITS, writeTestAudio, type SourceRecord } from './test-kit.ts'

const args = parseArgs(process.argv.slice(2))
const mode = args.mode ?? 'fixture'
if (mode === 'full') {
  const full = new URL('./full.ts', import.meta.url)
  if (!existsSync(full)) {
    console.error('catalog:build --mode full needs scripts/catalog/full.ts and the curated catalog/, which are not in this repository.')
    process.exit(2)
  }
  await import(full.href)
  process.exit(0)
}
if (mode !== 'fixture') {
  console.error(`catalog:build --mode ${mode}: unknown mode (fixture or full).`)
  process.exit(2)
}

const root = OUTPUT_ROOTS.fixture
const srcDir = 'fixtures/sources'
await rm(root, { recursive: true, force: true })
await mkdir(path.join(root, 'catalog/kits'), { recursive: true })
await mkdir(path.join(root, 'media/audio'), { recursive: true })

await writeTestAudio()
const files = existsSync(srcDir) ? (await readdir(srcDir)).filter((f) => f.endsWith('.json')).sort() : []
const records: SourceRecord[] = [...TEST_KITS]
for (const file of files) records.push(JSON.parse(await readFile(path.join(srcDir, file), 'utf8')))
const machines: Machine[] = []
const kitEntries: CatalogIndex['kits'] = []
const blobs = new Set<string>()

for (const rec of records) {
  const { id, manufacturer, model, displayName, aliases, kind, identityStatus, logo, photo, history } = rec.machine
  if (!machines.some((m) => m.id === id)) {
    machines.push({ id, manufacturer, model, displayName, aliases, kind, identityStatus, logo, photo, history: history ?? null })
  }
  const samples: Sample[] = []
  const slots: Slot[] = []
  for (const s of rec.slots) {
    const ids: string[] = []
    for (const src of s.samples) {
      const bytes = new Uint8Array(await readFile(src.source))
      const hash = sha256(bytes)
      const info = readWavInfo(bytes)
      const url = `media/audio/${hash}.wav`
      if (!blobs.has(hash)) {
        blobs.add(hash)
        await copyFile(src.source, path.join(root, url))
      }
      const sampleId = `${rec.kit.id}-${src.suffix}`
      ids.push(sampleId)
      samples.push({
        id: sampleId,
        ...(src.label ? { label: src.label } : {}),
        blobSha256: hash,
        url,
        bytes: bytes.byteLength,
        durationSec: Math.round(info.durationSec * 1e6) / 1e6,
        channels: info.channels,
        sampleRate: info.sampleRate,
        gainDb: 0,
        peakDbfs: peakDbfs(bytes),
      })
    }
    slots.push({
      id: s.id, label: s.label, category: s.category, icon: s.icon,
      defaultSampleId: ids[0], sampleIds: ids as [string, ...string[]],
      chokeGroup: s.chokeGroup, gainDb: s.gainDb,
    })
  }
  const kitBody = { schemaVersion: 1 as const, id: rec.kit.id, machineId: rec.kit.machineId, label: rec.kit.label, slots, samples }
  const revision = revisionOf(kitBody)
  const kit = { ...kitBody, revision } as KitManifest
  const kitUrl = `catalog/kits/${kit.id}/${revision}.json`
  await mkdir(path.dirname(path.join(root, kitUrl)), { recursive: true })
  await writeFile(path.join(root, kitUrl), stableJson(kit))
  kitEntries.push({ id: kit.id, machineId: kit.machineId, label: kit.label, revision, url: kitUrl })
}

const credits: Credits = { schemaVersion: 1, credits: {} }
await writeFile(path.join(root, 'catalog/credits.json'), stableJson(credits))

machines.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
kitEntries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
const indexBody = {
  schemaVersion: 1 as const,
  machines,
  kits: kitEntries,
  redirects: { machines: {}, kits: {}, samples: {} },
  creditsUrl: 'catalog/credits.json',
}
const index: CatalogIndex = { ...indexBody, revision: revisionOf(indexBody) }
await writeFile(path.join(root, 'catalog/index.json'), stableJson(index))

let total = 0
for (const h of blobs) total += (await stat(path.join(root, `media/audio/${h}.wav`))).size
console.log(`fixture: ${machines.length} machines, ${kitEntries.length} kits, ${blobs.size} audio blobs (${total} bytes), index ${index.revision}`)
