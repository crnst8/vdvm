import type { RedirectMap } from './types'

/** Follow a redirect chain to the current ID. Returns null on a cycle. */
export function resolveRedirect(map: RedirectMap | undefined, id: string): string | null {
  if (!map) return id
  const seen = new Set<string>()
  let cur = id
  while (Object.prototype.hasOwnProperty.call(map, cur)) {
    if (seen.has(cur)) return null
    seen.add(cur)
    cur = map[cur]
  }
  return cur
}
