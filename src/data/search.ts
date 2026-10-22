// Machine search for the search sheet: ranks machines against what has been typed so far and
// offers the top hit's name as an inline completion. Pure; no React.
import type { CatalogIndex, Machine } from '../contract/types'
import { kitsOf, sortMachines } from './catalog'

export interface SearchHit {
  machine: Machine
  kits: number
  score: number
}

/** Lowercase letters and digits only, accents removed. */
const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
/** Letter and digit runs: "TR-909" → ["tr", "909"], "Mk II" stays two words. */
const words = (s: string) => fold(s).match(/[a-z]+|\d+/g) ?? []
const compact = (s: string) => words(s).join('')

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)))
    prev = cur
  }
  return prev[b.length]
}

/** Characters of `q` appear in order in `s`; the score favours tight matches. */
function subsequence(q: string, s: string): number {
  let best = 0
  for (let first = s.indexOf(q[0]); first >= 0; first = s.indexOf(q[0], first + 1)) {
    let at = first
    for (let i = 1; i < q.length && at >= 0; i++) at = s.indexOf(q[i], at + 1)
    if (at < 0) break
    best = Math.max(best, q.length / (at - first + 1))
  }
  return best
}

/** Relevance of one machine; 0 means no match. Bands: exact > model prefix > name prefix > words > substring > typo > loose. */
export function scoreMachine(m: Machine, query: string): number {
  const cq = compact(query)
  if (!cq) return 0
  const model = compact(m.model)
  const name = compact(m.displayName)
  const aliases = m.aliases.map(compact)
  if (cq === model || cq === name || aliases.includes(cq)) return 1000
  if (model.startsWith(cq)) return 900 - Math.min(50, model.length - cq.length)
  if (name.startsWith(cq)) return 850 - Math.min(50, name.length - cq.length)
  if (aliases.some((a) => a.startsWith(cq))) return 800
  // Every typed word starts a word of the machine (maker, model or alias), or starts the compact model.
  const qWords = words(query)
  const mWords = new Set([...words(m.manufacturer), ...words(m.model), ...m.aliases.flatMap(words)])
  const pool = [...mWords, model, ...aliases]
  if (qWords.length && qWords.every((w) => pool.some((x) => x.startsWith(w)))) return 700
  // Inside a word only from three characters on; two letters inside words match too much.
  if (cq.length >= 3 && (model.includes(cq) || name.includes(cq) || aliases.some((a) => a.includes(cq)))) return 500
  // One typo in the model (a maker typed in front must be spelled right, or every model of that maker would match).
  if (cq.length >= 4 && editDistance(cq, model.slice(0, cq.length), 1) <= 1) return 300
  if (cq.length >= 3) {
    const loose = subsequence(cq, name)
    if (loose >= 0.5) return 100 + Math.round(loose * 100)
  }
  return 0
}

/**
 * Ranked machines for a query. An empty query lists recent machines, then favourites, then the
 * rest of the library in order, so the list can be browsed with the arrow keys straight away.
 */
export function searchMachines(
  index: CatalogIndex,
  query: string,
  opts: { favourites: Set<string>; recents: string[] },
  limit = 60,
): SearchHit[] {
  const ordered = sortMachines(index.machines)
  const kitCount = (m: Machine) => kitsOf(index, m.id).length
  const recentIds: string[] = []
  for (const kitId of opts.recents) {
    const mid = index.kits.find((k) => k.id === kitId)?.machineId
    if (mid && !recentIds.includes(mid)) recentIds.push(mid)
  }
  if (!compact(query)) {
    const seen = new Set<string>()
    const out: SearchHit[] = []
    const add = (m: Machine | undefined) => {
      if (!m || seen.has(m.id) || out.length >= limit) return
      seen.add(m.id)
      out.push({ machine: m, kits: kitCount(m), score: 0 })
    }
    for (const id of recentIds) add(ordered.find((m) => m.id === id))
    for (const m of ordered) if (opts.favourites.has(m.id)) add(m)
    for (const m of ordered) add(m)
    return out
  }
  const rank = new Map(ordered.map((m, i) => [m.id, i]))
  return ordered
    .map((m) => {
      const base = scoreMachine(m, query)
      if (!base) return null
      const recent = recentIds.indexOf(m.id)
      const score = base + (opts.favourites.has(m.id) ? 20 : 0) + (recent >= 0 ? Math.max(1, 10 - recent) : 0)
      return { machine: m, kits: kitCount(m), score }
    })
    .filter((h): h is SearchHit => !!h)
    .sort((a, b) => b.score - a.score || rank.get(a.machine.id)! - rank.get(b.machine.id)!)
    .slice(0, limit)
}

/** The rest of the hit's name after what was typed, when the typed text is its start; else null. */
export function completionFor(query: string, hit: SearchHit | undefined): string | null {
  if (!hit || !query.trim()) return null
  for (const text of [hit.machine.displayName, hit.machine.model, ...hit.machine.aliases]) {
    if (text.length > query.length && text.toLowerCase().startsWith(query.toLowerCase())) return text.slice(query.length)
  }
  return null
}
