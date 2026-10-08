// Standalone contract validator. Does not import app UI code.
//   npm run catalog:validate -- --mode fixture|full   (or --root <dir>)
// Checks: JSON Schema, references, revisions, served bytes/hashes/WAV headers,
// URL safety, and that the output holds no unreferenced media.
import { Ajv2020 } from 'ajv/dist/2020.js'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { checkIndex, checkKit } from '../../src/contract/semantic.ts'
import { readWavInfo } from '../../src/contract/wav.ts'
import { SUPPORTED_SCHEMA_MAJOR } from '../../src/contract/canonical.ts'
import { isSafeRelativeUrl } from '../../src/contract/urls.ts'
import type { CatalogIndex, KitManifest } from '../../src/contract/types.ts'
import { sha256, revisionOf, parseArgs, OUTPUT_ROOTS } from './lib.ts'

const args = parseArgs(process.argv.slice(2))
const root = args.root ?? OUTPUT_ROOTS[(args.mode ?? 'fixture') as keyof typeof OUTPUT_ROOTS]
const full = args.mode === 'full'
if (!root) throw new Error(`unknown mode ${args.mode}`)

const schemaDir = 'catalog/schema'
const ajv = new Ajv2020({ allErrors: true, strict: true })
for (const f of (await readdir(schemaDir)).filter((f) => f.endsWith('.schema.json'))) {
  ajv.addSchema(JSON.parse(await readFile(path.join(schemaDir, f), 'utf8')))
}

const errors: string[] = []
const fail = (msg: string) => errors.push(msg)
const readJson = async (rel: string) => JSON.parse(await readFile(path.join(root, rel), 'utf8'))
const schemaCheck = (schemaId: string, data: unknown, where: string) => {
  const validate = ajv.getSchema(schemaId)!
  if (!validate(data)) for (const e of validate.errors ?? []) fail(`${where}${e.instancePath}: ${e.message}`)
}

const indexRel = args.index ?? 'catalog/index.json'
if (!isSafeRelativeUrl(indexRel)) throw new Error('unsafe index URL')
if (!existsSync(path.join(root, indexRel))) {
  console.error(`no ${indexRel} under ${root}; build it first`)
  process.exit(1)
}
const index: CatalogIndex = await readJson(indexRel)
if (index.schemaVersion !== SUPPORTED_SCHEMA_MAJOR) {
  console.error(`unsupported schemaVersion ${index.schemaVersion}`)
  process.exit(1)
}
schemaCheck('index.schema.json', index, 'index')
errors.push(...checkIndex(index).map((e) => `index: ${e}`))
if (revisionOf(index) !== index.revision) fail(`index: revision ${index.revision} != computed ${revisionOf(index)}`)

if (!isSafeRelativeUrl(index.creditsUrl)) throw new Error('unsafe credits URL')
const referenced = new Set<string>([indexRel, index.creditsUrl])
if (existsSync(path.join(root, index.creditsUrl))) {
  const credits = await readJson(index.creditsUrl)
  schemaCheck('credits.schema.json', credits, 'credits')
  for (const m of index.machines) {
    for (const art of [m.logo, m.photo]) {
      if (art && !credits.credits?.[art.creditId]) fail(`machine ${m.id}: creditId ${art.creditId} missing from credits`)
    }
  }
} else fail(`missing credits file ${index.creditsUrl}`)

const checkBlob = async (url: string, hash: string, where: string) => {
  if (!isSafeRelativeUrl(url)) { fail(`${where}: unsafe URL ${url}`); return null }
  referenced.add(url)
  const file = path.join(root, url)
  if (!existsSync(file)) return fail(`${where}: missing file ${url}`), null
  const bytes = new Uint8Array(await readFile(file))
  if (sha256(bytes) !== hash) fail(`${where}: sha256 mismatch for ${url}`)
  return bytes
}

for (const m of index.machines) {
  for (const art of [m.logo, m.photo]) {
    if (!art) continue
    const bytes = await checkBlob(art.url, art.sha256, `machine ${m.id} asset ${art.id}`)
    if (bytes && art === m.logo) {
      const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      if (!png) fail(`machine ${m.id}: logo is not a PNG`)
    }
  }
}

let sampleCount = 0
const sampleIds = new Set<string>()
for (const entry of index.kits) {
  if (!isSafeRelativeUrl(entry.url)) { fail(`kit ${entry.id}: unsafe manifest URL`); continue }
  referenced.add(entry.url)
  if (!existsSync(path.join(root, entry.url))) { fail(`kit ${entry.id}: missing manifest ${entry.url}`); continue }
  const kit: KitManifest = await readJson(entry.url)
  schemaCheck('kit.schema.json', kit, `kit ${entry.id}`)
  errors.push(...checkKit(kit, entry))
  if (revisionOf(kit) !== kit.revision) fail(`kit ${kit.id}: revision ${kit.revision} != computed ${revisionOf(kit)}`)
  if (entry.url !== `catalog/kits/${kit.id}/${kit.revision}.json`) fail(`kit ${kit.id}: url does not follow kits/<id>/<revision>.json`)
  for (const s of kit.samples ?? []) {
    if (sampleIds.has(s.id)) fail(`globally duplicate sample id ${s.id}`)
    sampleIds.add(s.id)
    sampleCount++
    const where = `kit ${kit.id} sample ${s.id}`
    if (s.url !== `media/audio/${s.blobSha256}.wav`) fail(`${where}: url does not follow media/audio/<sha256>.wav`)
    const bytes = await checkBlob(s.url, s.blobSha256, where)
    if (!bytes) continue
    if (bytes.byteLength !== s.bytes) fail(`${where}: bytes ${s.bytes} != served ${bytes.byteLength}`)
    try {
      const info = readWavInfo(bytes)
      if (info.channels !== s.channels) fail(`${where}: channels ${s.channels} != ${info.channels}`)
      if (info.sampleRate !== s.sampleRate) fail(`${where}: sampleRate ${s.sampleRate} != ${info.sampleRate}`)
      if (Math.abs(info.durationSec - s.durationSec) > 0.001) fail(`${where}: duration ${s.durationSec} != ${info.durationSec}`)
    } catch (e) {
      fail(`${where}: unreadable WAV (${(e as Error).message})`)
    }
  }
}
for (const from of Object.keys(index.redirects.samples)) {
  let to = from
  const seen = new Set<string>()
  while (index.redirects.samples[to]) {
    if (seen.has(to)) { to = ''; break }
    seen.add(to); to = index.redirects.samples[to]
  }
  if (to && !sampleIds.has(to)) fail(`sample redirect ${from} targets missing ${to}`)
  if (sampleIds.has(from)) fail(`live sample id ${from} is redirected`)
}

// Output must contain only referenced catalog/media files.
const walk = async (dir: string): Promise<string[]> => {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const d of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) out.push(...(await walk(p)))
    else if (d.name !== '.DS_Store') out.push(path.relative(root, p).split(path.sep).join('/'))
  }
  return out
}
for (const f of [...(await walk(path.join(root, 'catalog'))), ...(await walk(path.join(root, 'media')))]) {
  if (!referenced.has(f)) {
    // Full builds keep old immutable media/manifests for active/offline kits
    // and the last good index. Fixture/staging outputs remain strict.
    const retained = full && (['catalog/index.json', 'catalog/last-good.json', 'catalog/credits.json'].includes(f) || /^catalog\/credits\/[a-f0-9]{64}\.json$/.test(f) || /^catalog\/kits\/[a-z0-9-]+\/[a-f0-9]{16}\.json$/.test(f) || /^media\/audio\/[a-f0-9]{64}\.wav$/.test(f) || /^media\/(logos|photos)\/[a-z0-9-]+\/[a-f0-9]{64}\.(png|webp|jpe?g)$/.test(f))
    if (!retained) fail(`unreferenced output file ${f}`)
  }
}

if (errors.length) {
  if (full) {
    await mkdir(path.join(root, 'catalog'), { recursive: true })
    await writeFile(path.join(root, 'catalog/validation.json'), JSON.stringify({ root, indexRel, revision: index.revision, result: 'failed', errors }, null, 2) + '\n')
  }
  console.error(`catalog:validate FAILED (${root}): ${errors.length} error(s)`)
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}
if (full) execFileSync('python3', ['scripts/catalog/pipeline.py', 'verify', '--root', root, '--index', indexRel], { stdio: 'inherit' })
if (full) {
  await mkdir(path.join(root, 'catalog'), { recursive: true })
  await writeFile(path.join(root, 'catalog/validation.json'), JSON.stringify({ root, indexRel, revision: index.revision, result: 'passed', machines: index.machines.length, kits: index.kits.length, samples: sampleCount, checks: ['schemas', 'safe URLs', 'references/redirects', 'revisions', 'served hashes/bytes', 'WAV headers/decode', 'source hashes', 'history sentence evidence', 'artwork records'] }, null, 2) + '\n')
}
console.log(`catalog:validate OK (${root}): ${index.machines.length} machines, ${index.kits.length} kits, ${sampleCount} samples, index ${index.revision}`)
