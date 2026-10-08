// Resolve contract-relative URLs against the configured catalog base without
// allowing traversal outside it.

const SAFE = /^(?!\/)[A-Za-z0-9._~/-]+$/

export function isSafeRelativeUrl(rel: string): boolean {
  if (!SAFE.test(rel)) return false
  return !rel.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
}

/** base must end with '/'. Returns an absolute URL string or throws. */
export function resolveCatalogUrl(base: string, rel: string): string {
  if (!isSafeRelativeUrl(rel)) throw new Error(`Unsafe catalog URL: ${rel}`)
  const baseUrl = new URL(base, typeof location === 'undefined' ? 'http://localhost/' : location.href)
  const resolved = new URL(rel, baseUrl)
  if (!resolved.href.startsWith(baseUrl.href)) throw new Error(`Catalog URL escapes base: ${rel}`)
  return resolved.href
}
