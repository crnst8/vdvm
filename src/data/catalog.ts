// Catalog loader. Fixture and full catalogs use this same code; only the base URL differs.
import type { CatalogIndex, KitEntry, KitManifest, Machine } from '../contract/types'
import { SUPPORTED_SCHEMA_MAJOR } from '../contract/canonical'
import { checkIndex, checkKit } from '../contract/semantic'
import { resolveCatalogUrl } from '../contract/urls'
import { resolveRedirect } from '../contract/redirects'

export const CATALOG_BASE: string = (() => {
  const b = (import.meta.env.VITE_CATALOG_BASE as string | undefined) ?? import.meta.env.BASE_URL
  return b.endsWith('/') ? b : `${b}/`
})()

export class CatalogError extends Error {}

const machineCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Display order for machines: manufacturer then model, natural numeric order. Used by the library and kit arrows. */
export function sortMachines(machines: Machine[]): Machine[] {
  // Manufacturer first, then model: comparing "maker model" strings would interleave makers that share a prefix.
  return [...machines].sort(
    (a, b) => machineCollator.compare(a.manufacturer, b.manufacturer) || machineCollator.compare(a.model, b.model) || (a.id < b.id ? -1 : 1),
  )
}

/** Every kit in library order: machines sorted, then each machine's kits in index order. */
export function kitOrder(index: CatalogIndex): KitEntry[] {
  return sortMachines(index.machines).flatMap((m) => index.kits.filter((k) => k.machineId === m.id))
}

/** A machine's kits in index order. */
export const kitsOf = (index: CatalogIndex, machineId: string) => index.kits.filter((k) => k.machineId === machineId)

/**
 * Machine `dir` steps from `fromMachineId` in library order, wrapping. With
 * `include`, only matching machines are candidates; from a non-candidate the
 * nearest candidate in that direction is chosen.
 */
export function neighbourMachine(
  index: CatalogIndex,
  fromMachineId: string,
  dir: -1 | 1,
  include?: (m: Machine) => boolean,
): Machine | null {
  const order = sortMachines(index.machines).filter((m) => kitsOf(index, m.id).length > 0)
  const n = order.length
  const ok = include ?? (() => true)
  const from = order.findIndex((m) => m.id === fromMachineId)
  const start = from < 0 ? (dir === 1 ? -1 : 0) : from
  for (let step = 1; step <= n; step++) {
    const m = order[(((start + dir * step) % n) + n) % n]
    if (ok(m) && m.id !== fromMachineId) return m
  }
  return null
}

/** The kit to load for a machine: the most recently used one, else its first kit. */
export function preferredKit(index: CatalogIndex, machineId: string, recents: string[]): KitEntry | null {
  const kits = kitsOf(index, machineId)
  let best: KitEntry | null = null
  let bestAt = Infinity
  for (const k of kits) {
    const at = recents.indexOf(k.id)
    if (at >= 0 && at < bestAt) [best, bestAt] = [k, at]
  }
  return best ?? kits[0] ?? null
}

/**
 * Short labels for a machine's kits, for the kit keys under the logo. Labels
 * follow "Source — Variant"; the variant part is used, prefixed with the source
 * when variants collide, then numbered if still identical.
 */
export function shortKitLabels(machine: Machine, kits: KitEntry[]): Map<string, string> {
  const maker = machine.manufacturer.toLowerCase()
  const strip = (s: string) => (s.toLowerCase().startsWith(`${maker} `) ? s.slice(maker.length + 1) : s).trim()
  const parts = kits.map((k) => {
    const [head, ...rest] = k.label.split(' — ')
    const tail = rest.join(' — ').trim()
    const variant = tail ? tail.replace(/^archive variants$/i, 'archive') : ''
    const source = strip(head)
    return { k, source, variant }
  })
  const out = new Map<string, string>()
  const count = (xs: string[], x: string) => xs.filter((y) => y === x).length
  const firstPass = parts.map((p) => p.variant || (p.source === machine.model || p.source === machine.displayName ? 'Main' : p.source))
  const second = parts.map((p, i) => (count(firstPass, firstPass[i]) > 1 && p.variant ? `${p.source} ${p.variant}` : firstPass[i]))
  const seen = new Map<string, number>()
  parts.forEach((p, i) => {
    const base = second[i]
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    out.set(p.k.id, count(second, base) > 1 ? `${base} ${n}` : base)
  })
  return out
}

/** Loader IO. The app passes network-first fetches with an offline fallback; tests pass plain fetch. */
export interface CatalogIO {
  fetchJson(url: string, opts: { revalidate: boolean }): Promise<Response>
  remember?(url: string, value: unknown): Promise<void>
}
const plainIO: CatalogIO = { fetchJson: (url, o) => fetch(url, o.revalidate ? { cache: 'no-cache' } : undefined) }

const ICONS = new Set(['kick', 'snare', 'hat-closed', 'hat-open', 'cymbal', 'tom', 'clap', 'rim', 'percussion'])
/** Consumers render unfamiliar enum values with the percussion fallback. */
export const iconFor = (icon: string) => (ICONS.has(icon) ? icon : 'percussion')

export class Catalog {
  readonly base: string
  readonly index: CatalogIndex
  private kits = new Map<string, KitManifest>()

  private io: CatalogIO

  constructor(base: string, index: CatalogIndex, io: CatalogIO = plainIO) {
    this.base = base
    this.index = index
    this.io = io
  }

  static async load(base = CATALOG_BASE, io: CatalogIO = plainIO): Promise<Catalog> {
    const url = resolveCatalogUrl(base, 'catalog/index.json')
    let res: Response
    try {
      res = await io.fetchJson(url, { revalidate: true })
    } catch {
      throw new CatalogError('Could not reach the catalog. Check the connection and retry.')
    }
    if (!res.ok) throw new CatalogError(`Catalog index returned HTTP ${res.status}.`)
    const index = (await res.json()) as CatalogIndex
    if (index.schemaVersion !== SUPPORTED_SCHEMA_MAJOR) {
      throw new CatalogError(`Catalog format version ${String(index.schemaVersion)} is not supported by this app version.`)
    }
    const problems = checkIndex(index)
    if (problems.length) throw new CatalogError(`Catalog index is inconsistent: ${problems[0]}`)
    await io.remember?.(url, index)
    return new Catalog(base, index, io)
  }

  url(rel: string) {
    return resolveCatalogUrl(this.base, rel)
  }

  machine(id: string): Machine | undefined {
    const cur = resolveRedirect(this.index.redirects.machines, id)
    return cur ? this.index.machines.find((m) => m.id === cur) : undefined
  }

  kitEntry(id: string): KitEntry | undefined {
    const cur = resolveRedirect(this.index.redirects.kits, id)
    return cur ? this.index.kits.find((k) => k.id === cur) : undefined
  }

  resolveSampleId(id: string): string {
    return resolveRedirect(this.index.redirects.samples, id) ?? id
  }

  cachedKit(id: string) {
    return this.kits.get(id)
  }

  async loadKit(id: string): Promise<KitManifest> {
    const entry = this.kitEntry(id)
    if (!entry) throw new CatalogError(`Kit ${id} is not in the catalog.`)
    const cached = this.kits.get(entry.id)
    if (cached) return cached
    const url = this.url(entry.url)
    let res: Response
    try {
      res = await this.io.fetchJson(url, { revalidate: false })
    } catch {
      throw new CatalogError(`Kit ${entry.label} is not available offline. Connect and retry.`)
    }
    if (!res.ok) throw new CatalogError(`Kit ${entry.label} returned HTTP ${res.status}.`)
    const kit = (await res.json()) as KitManifest
    if (kit.schemaVersion !== SUPPORTED_SCHEMA_MAJOR) throw new CatalogError(`Kit ${entry.label} uses an unsupported format.`)
    const problems = checkKit(kit, entry)
    if (problems.length) throw new CatalogError(`Kit ${entry.label} is inconsistent: ${problems[0]}`)
    this.kits.set(kit.id, kit)
    await this.io.remember?.(url, kit)
    return kit
  }
}
