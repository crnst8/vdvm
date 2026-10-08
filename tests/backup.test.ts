import { describe, it, expect } from 'vitest'
import { makeBackup, parseBackup, patternsToImport } from '../src/data/backup'
import type { Pattern } from '../src/contract/types'

const pat = (id: string, updatedAt: string) =>
  ({ schemaVersion: 1, id, name: id, kitId: 'k', kitRevision: 'r', bpm: 120, tracks: [], createdAt: updatedAt, updatedAt }) as unknown as Pattern

describe('backup', () => {
  it('round-trips patterns and favourites', () => {
    const b = makeBackup([pat('a', '2026-01-01')], ['m1'])
    expect(b.format).toBe('vdvm-backup')
    const back = parseBackup(JSON.stringify(b))
    expect(back.patterns.map((p) => p.id)).toEqual(['a'])
    expect(back.favourites).toEqual(['m1'])
  })
  it('rejects other files and drops malformed patterns', () => {
    expect(() => parseBackup('nope')).toThrow(/not JSON/)
    expect(() => parseBackup('{"format":"x"}')).toThrow(/not a V\.D\.V\.M backup/)
    // Backups from before the product was named V.D.V.M still import.
    const b = parseBackup(JSON.stringify({ format: 'drums-backup', version: 1, patterns: [pat('a', '1'), { id: 3 }] }))
    expect(b.patterns).toHaveLength(1)
    expect(b.favourites).toEqual([])
  })
  it('keeps pattern pitch fields through export and import', () => {
    const withPitch = { ...pat('a', '2026-01-01'), pitchCents: 300,
      tracks: [{ slotId: 'kick', sampleId: 'k', steps: new Array(16).fill(false), stepPitchCents: new Array(16).fill(0).map((_, i) => (i === 2 ? -400 : 0)) }] } as unknown as Pattern
    const back = parseBackup(JSON.stringify(makeBackup([withPitch], [])))
    expect(back.patterns[0].pitchCents).toBe(300)
    expect(back.patterns[0].tracks[0].stepPitchCents![2]).toBe(-400)
  })
  it('imports new patterns and newer copies only', () => {
    const local = [pat('a', '2026-02-01'), pat('b', '2026-02-01')]
    const incoming = [pat('a', '2026-01-01'), pat('b', '2026-03-01'), pat('c', '2026-01-01')]
    expect(patternsToImport(local, incoming).map((p) => p.id)).toEqual(['b', 'c'])
  })
})
