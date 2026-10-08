// Canonical JSON for revision hashing: compact UTF-8, object keys sorted
// recursively, array order preserved, root `revision` omitted.
// Hash with SHA-256 and keep the first 16 hex chars (see revisionOf in scripts).

export function canonicalJson(value: unknown, omitRootRevision = true): string {
  return encode(value, omitRootRevision)
}

function encode(value: unknown, omitRevision: boolean): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('canonicalJson: non-finite number')
    }
    if (value === undefined) throw new Error('canonicalJson: undefined value')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => encode(v, false)).join(',')}]`
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined && !(omitRevision && k === 'revision'))
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${encode(obj[k], false)}`).join(',')}}`
}

export const SUPPORTED_SCHEMA_MAJOR = 1
export const REVISION_HEX_LENGTH = 16
