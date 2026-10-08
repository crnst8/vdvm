// Reference and value checks that JSON Schema cannot express. Pure: no IO.
// Used by scripts/catalog/validate.ts and defensively by the app loader.
import type { CatalogIndex, KitManifest } from './types'
import { isSafeRelativeUrl } from './urls'
import { resolveRedirect } from './redirects'

export function checkIndex(index: CatalogIndex): string[] {
  const errors: string[] = []
  const machineIds = new Set<string>()
  for (const m of index.machines) {
    if (machineIds.has(m.id)) errors.push(`duplicate machine id ${m.id}`)
    machineIds.add(m.id)
    for (const art of [m.logo, m.photo]) {
      if (art && !isSafeRelativeUrl(art.url)) errors.push(`machine ${m.id}: unsafe asset url ${art.url}`)
    }
  }
  const kitIds = new Set<string>()
  for (const k of index.kits) {
    if (kitIds.has(k.id)) errors.push(`duplicate kit id ${k.id}`)
    kitIds.add(k.id)
    if (!machineIds.has(k.machineId)) errors.push(`kit ${k.id}: unknown machine ${k.machineId}`)
    if (!isSafeRelativeUrl(k.url)) errors.push(`kit ${k.id}: unsafe url ${k.url}`)
  }
  if (!isSafeRelativeUrl(index.creditsUrl)) errors.push(`unsafe creditsUrl ${index.creditsUrl}`)
  for (const kind of ['machines', 'kits', 'samples'] as const) {
    const map = index.redirects[kind]
    for (const from of Object.keys(map)) {
      const to = resolveRedirect(map, from)
      if (to === null) errors.push(`redirects.${kind}: cycle through ${from}`)
      else if (kind === 'machines' && !machineIds.has(to)) errors.push(`redirects.machines: ${from} -> unknown ${to}`)
      else if (kind === 'kits' && !kitIds.has(to)) errors.push(`redirects.kits: ${from} -> unknown ${to}`)
      if (kind === 'machines' && machineIds.has(from)) errors.push(`redirects.machines: live id ${from} is also redirected`)
      if (kind === 'kits' && kitIds.has(from)) errors.push(`redirects.kits: live id ${from} is also redirected`)
    }
  }
  return errors
}

export function checkKit(kit: KitManifest, entry?: { id: string; machineId: string; revision: string }): string[] {
  const errors: string[] = []
  const where = `kit ${kit.id}`
  if (entry) {
    if (entry.id !== kit.id) errors.push(`${where}: index entry id ${entry.id} mismatch`)
    if (entry.machineId !== kit.machineId) errors.push(`${where}: machineId differs from index`)
    if (entry.revision !== kit.revision) errors.push(`${where}: revision differs from index`)
  }
  const samples = new Map<string, KitManifest['samples'][number]>()
  for (const s of kit.samples) {
    if (samples.has(s.id)) errors.push(`${where}: duplicate sample id ${s.id}`)
    samples.set(s.id, s)
    if (!isSafeRelativeUrl(s.url)) errors.push(`${where}: sample ${s.id} unsafe url`)
    if (!(s.bytes > 0) || !(s.durationSec > 0)) errors.push(`${where}: sample ${s.id} non-positive size/duration`)
    if (!Number.isFinite(s.gainDb)) errors.push(`${where}: sample ${s.id} gain not finite`)
  }
  const slotIds = new Set<string>()
  const used = new Set<string>()
  for (const slot of kit.slots) {
    if (slotIds.has(slot.id)) errors.push(`${where}: duplicate slot ${slot.id}`)
    slotIds.add(slot.id)
    if (!slot.sampleIds.includes(slot.defaultSampleId)) {
      errors.push(`${where}: slot ${slot.id} default ${slot.defaultSampleId} not in sampleIds`)
    }
    for (const id of slot.sampleIds) {
      if (!samples.has(id)) errors.push(`${where}: slot ${slot.id} references missing sample ${id}`)
      used.add(id)
    }
  }
  for (const id of samples.keys()) {
    if (!used.has(id)) errors.push(`${where}: sample ${id} not used by any slot`)
  }
  return errors
}
