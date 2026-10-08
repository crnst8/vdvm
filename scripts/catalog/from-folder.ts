// Writes catalog source records for a folder of WAV one-shots, so a sample
// collection becomes a library without hand-written records.
//
//   npm run catalog:folder -- <folder> [--out fixtures/sources]
//   npm run catalog:build -- --mode fixture     (then npm run dev or npm run build)
//
// Layout: each folder that directly holds .wav files becomes one kit. The first
// folder below <folder> names the machine ("Roland TR-909" → manufacturer
// "Roland", model "TR-909"); deeper folders name the kit within it. Slot roles
// come from file names with the same rules as the plugin importer
// (plugin/source/core/Importer.cpp suggestRole); files that match no role go to
// a Percussion slot. Files the contract WAV reader rejects are skipped and
// listed. Records this script wrote earlier are replaced; hand-written records
// in --out are left alone.
import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { readWavInfo } from '../../src/contract/wav.ts'
import { parseArgs, stableJson } from './lib.ts'

const ROLES: [string, string][] = [
  ['kick', 'Kick'], ['snare', 'Snare'], ['hat-closed', 'Closed Hat'], ['hat-open', 'Open Hat'], ['clap', 'Clap'],
  ['rim', 'Rim'], ['tom-low', 'Low Tom'], ['tom-mid', 'Mid Tom'], ['tom-high', 'High Tom'], ['tom', 'Tom'],
  ['crash', 'Crash'], ['ride', 'Ride'], ['cymbal', 'Cymbal'], ['cowbell', 'Cowbell'], ['conga', 'Conga'],
  ['bongo', 'Bongo'], ['clave', 'Clave'], ['shaker', 'Shaker'], ['tambourine', 'Tambourine'], ['cabasa', 'Cabasa'],
  ['maracas', 'Maracas'], ['agogo', 'Agogo'], ['timbale', 'Timbale'], ['triangle', 'Triangle'],
  ['woodblock', 'Woodblock'], ['percussion', 'Percussion'], ['effects', 'Effects'],
]

/** Port of suggestRole in plugin/source/core/Importer.cpp; '' when nothing matches. */
export function suggestRole(fileName: string): string {
  const name = path.parse(fileName).name.toLowerCase()
  const s = ` ${name.replace(/[_\-.()[\]{}#,+&]/g, ' ')} `
  const has = (re: string) => new RegExp(re).test(s)
  if (has('open ?h(i ?)?h(at)?|(^| )o ?hh?( |\\d)|(^| )hh ?o( |\\d)|ohat|hat ?open|open') && has('hat|hh|(^| )oh')) return 'hat-open'
  if (has('(^| )oh\\d*( )')) return 'hat-open'
  if (has('hat|hihat|hi ?hat|(^| )c?hh\\d*( )|(^| )ch\\d*( )|closed')) return 'hat-closed'
  if (has('kick|kik|(^| )bd\\d*( )|bass ?drum|bassdrum')) return 'kick'
  if (has('snare|snr|(^| )sd\\d*( )|(^| )sn\\d*( )')) return 'snare'
  if (has('clap|(^| )cp\\d*( )|(^| )clp')) return 'clap'
  if (has('rim|(^| )rs\\d*( )|side ?stick|sidestick')) return 'rim'
  if (has('tom')) {
    if (has('lo|low|floor|(^| )lt')) return 'tom-low'
    if (has('mid|med|(^| )mt')) return 'tom-mid'
    if (has('hi|high|(^| )ht')) return 'tom-high'
    return 'tom'
  }
  if (has('crash|(^| )cr\\d*( )')) return 'crash'
  if (has('ride|(^| )rd\\d*( )')) return 'ride'
  if (has('cym|china|splash')) return 'cymbal'
  if (has('cowbell|cow ?bell|(^| )cb\\d*( )|(^| )cow')) return 'cowbell'
  if (has('conga')) return 'conga'
  if (has('bongo')) return 'bongo'
  if (has('clave|(^| )cl\\d*( )')) return 'clave'
  if (has('shaker|shake')) return 'shaker'
  if (has('tamb')) return 'tambourine'
  if (has('cabasa')) return 'cabasa'
  if (has('maraca')) return 'maracas'
  if (has('agogo')) return 'agogo'
  if (has('timbal')) return 'timbale'
  if (has('triangle|(^| )tri\\d*( )')) return 'triangle'
  if (has('wood ?block|(^| )block')) return 'woodblock'
  if (has('perc')) return 'percussion'
  if (has('(^| )fx|effect|sfx|noise|zap')) return 'effects'
  return ''
}

/** Same mapping as categoryForRole / iconForRole in plugin/source/core/Contract.cpp. */
function category(role: string) {
  if (['kick', 'snare', 'clap', 'rim'].includes(role)) return role
  if (role.startsWith('hat')) return 'hat'
  if (['crash', 'ride', 'cymbal'].includes(role)) return 'cymbal'
  if (role === 'tom' || role.startsWith('tom-')) return 'tom'
  if (role === 'effects') return 'fx'
  return 'percussion'
}
function icon(role: string) {
  if (['kick', 'snare', 'clap', 'rim', 'hat-closed', 'hat-open'].includes(role)) return role
  const c = category(role)
  return c === 'cymbal' || c === 'tom' ? c : 'percussion'
}

const slug = (text: string) =>
  text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '') || 'kit'

async function wavFolders(dir: string, depth = 0): Promise<{ dir: string; files: string[] }[]> {
  if (depth > 12) return []
  const entries = (await readdir(dir, { withFileTypes: true })).filter((e) => !e.name.startsWith('.'))
  entries.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
  const files = entries.filter((e) => e.isFile() && /\.wav$/i.test(e.name)).map((e) => path.join(dir, e.name))
  const out = files.length ? [{ dir, files }] : []
  for (const e of entries) if (e.isDirectory()) out.push(...(await wavFolders(path.join(dir, e.name), depth + 1)))
  return out
}

const args = parseArgs(process.argv.slice(2))
const folder = process.argv.slice(2).find((a) => !a.startsWith('--') && a !== args.out)
if (!folder) {
  console.error('usage: npm run catalog:folder -- <folder> [--out fixtures/sources]')
  process.exit(2)
}
const root = path.resolve(folder)
const outDir = args.out ?? 'fixtures/sources'
const sourcePath = (file: string) => {
  const rel = path.relative(process.cwd(), file)
  return rel.startsWith('..') || path.isAbsolute(rel) ? file : rel
}

const kits = await wavFolders(root)
if (!kits.length) {
  console.error(`no .wav files under ${root}`)
  process.exit(1)
}
const GENERATED = 'Generated by scripts/catalog/from-folder.ts'
await mkdir(outDir, { recursive: true })
for (const name of await readdir(outDir)) {
  if (!name.endsWith('.json')) continue
  const file = path.join(outDir, name)
  const note = (JSON.parse(await readFile(file, 'utf8')) as { note?: string }).note
  if (note?.startsWith(GENERATED)) await unlink(file)
}

const usedKitIds = new Set<string>()
const skipped: string[] = []
let written = 0
for (const { dir, files } of kits) {
  const parts = path.relative(root, dir).split(path.sep).filter(Boolean)
  const machineName = parts[0] ?? path.basename(root)
  const kitName = parts.slice(1).join(' ') || machineName
  const words = machineName.trim().split(/\s+/)
  const manufacturer = words.length > 1 ? words[0] : machineName
  const model = words.length > 1 ? words.slice(1).join(' ') : machineName
  const machineId = slug(machineName)
  let kitId = parts.length > 1 ? slug(`${machineName} ${kitName}`) : `${machineId}-main`
  for (let n = 2; usedKitIds.has(kitId); n++) kitId = `${slug(`${machineName} ${kitName}`)}-${n}`
  usedKitIds.add(kitId)

  const byRole = new Map<string, { suffix: string; source: string; label: string }[]>()
  for (const file of files) {
    try {
      readWavInfo(new Uint8Array(await readFile(file)))
    } catch (err) {
      skipped.push(`${file}: ${(err as Error).message}`)
      continue
    }
    const role = suggestRole(path.basename(file)) || 'percussion'
    const list = byRole.get(role) ?? []
    list.push({ suffix: `${role}-${String(list.length + 1).padStart(2, '0')}`, source: sourcePath(file), label: path.parse(file).name })
    byRole.set(role, list)
  }
  const slots = ROLES.filter(([role]) => byRole.has(role)).map(([role, label]) => ({
    id: role,
    label,
    category: category(role),
    icon: icon(role),
    chokeGroup: role === 'hat-closed' || role === 'hat-open' ? 'hi-hat' : null,
    gainDb: 0,
    samples: byRole.get(role)!,
  }))
  if (!slots.length) continue
  const record = {
    note: `${GENERATED} from ${path.relative(root, dir) || '.'}. Identity is the folder name, not verified.`,
    machine: {
      id: machineId, manufacturer, model, displayName: machineName, aliases: [],
      kind: 'drum-machine', identityStatus: 'provisional', logo: null, photo: null, history: null,
    },
    kit: { id: kitId, machineId, label: kitName },
    slots,
  }
  await writeFile(path.join(outDir, `${kitId}.json`), stableJson(record))
  written++
  console.log(`${kitId}: ${slots.length} slots, ${slots.reduce((n, s) => n + s.samples.length, 0)} samples`)
}
for (const line of skipped) console.warn(`skipped ${line}`)
console.log(`${written} kit records in ${outDir}; next: npm run catalog:build -- --mode fixture`)
