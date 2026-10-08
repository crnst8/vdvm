/** Fit a single row; reserve two 44px arrows and their gaps only when paging is needed. */
export function instrumentCapacity(width: number, count: number, desktop: boolean) {
  const tile = desktop ? 68 : 44
  const gap = desktop ? 8 : 6
  const all = Math.max(1, Math.floor((width + gap) / (tile + gap)))
  if (count <= all) return Math.max(1, count)
  return Math.max(1, Math.floor((width - 88 - gap * 2 + gap) / (tile + gap)))
}
