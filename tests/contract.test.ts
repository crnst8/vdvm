import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { canonicalJson } from '../src/contract/canonical'
import { isSafeRelativeUrl, resolveCatalogUrl } from '../src/contract/urls'
import { resolveRedirect } from '../src/contract/redirects'
import { checkIndex, checkKit } from '../src/contract/semantic'
import { readWavInfo } from '../src/contract/wav'
import type { CatalogIndex, KitManifest } from '../src/contract/types'

const index = (): CatalogIndex => JSON.parse(readFileSync('public/fixture/catalog/index.json', 'utf8'))
const kit = (i: CatalogIndex, id: string): KitManifest =>
  JSON.parse(readFileSync(`public/fixture/${i.kits.find((k) => k.id === id)!.url}`, 'utf8'))

describe('contract', () => {
  it('canonical JSON sorts keys recursively, keeps array order and drops root revision only', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }, 3], revision: 'x' })).toBe('{"a":[{"c":2,"d":1},3],"b":1}')
    expect(canonicalJson({ nested: { revision: 'kept' } })).toBe('{"nested":{"revision":"kept"}}')
  })
  it('rejects traversal and absolute URLs', () => {
    for (const bad of ['../x.wav', 'a/../../b', '/abs.wav', 'http://evil/x', 'a//b', './x', 'a\\b', 'a?b']) {
      expect(isSafeRelativeUrl(bad), bad).toBe(false)
    }
    expect(isSafeRelativeUrl('media/audio/abc.wav')).toBe(true)
    expect(resolveCatalogUrl('http://h/app/fixture/', 'catalog/index.json')).toBe('http://h/app/fixture/catalog/index.json')
    expect(() => resolveCatalogUrl('http://h/app/', '../x')).toThrow()
  })
  it('follows redirect chains and detects cycles', () => {
    expect(resolveRedirect({ a: 'b', b: 'c' }, 'a')).toBe('c')
    expect(resolveRedirect({ a: 'b', b: 'a' }, 'a')).toBeNull()
    expect(resolveRedirect({}, 'z')).toBe('z')
  })
  it('fixture index and kits pass semantic checks', () => {
    const i = index()
    expect(checkIndex(i)).toEqual([])
    for (const e of i.kits) expect(checkKit(kit(i, e.id), e)).toEqual([])
  })
  it('test kit A has the five planned slots with both hats in the hi-hat choke group', () => {
    const k = kit(index(), 'test-tones-a')
    expect(k.slots.map((s) => s.id)).toEqual(['kick', 'snare', 'hat-closed', 'hat-open', 'crash'])
    expect(k.slots.filter((s) => s.chokeGroup === 'hi-hat').map((s) => s.id)).toEqual(['hat-closed', 'hat-open'])
  })
  it('semantic checks catch broken references', () => {
    const i = index()
    const k = kit(i, 'test-tones-a')
    k.slots[0].defaultSampleId = 'nope'
    expect(checkKit(k).join()).toMatch(/default nope not in sampleIds/)
    i.kits[0].machineId = 'ghost'
    i.redirects.kits = { old: 'missing' }
    const errs = checkIndex(i).join('\n')
    expect(errs).toMatch(/unknown machine ghost/)
    expect(errs).toMatch(/old -> unknown missing/)
  })
  it('reads WAV headers from a fixture file', () => {
    const k = kit(index(), 'test-tones-a')
    const s = k.samples[0]
    const info = readWavInfo(new Uint8Array(readFileSync(`public/fixture/${s.url}`)))
    expect(info.channels).toBe(s.channels)
    expect(info.sampleRate).toBe(44100)
    expect(info.durationSec).toBeCloseTo(s.durationSec, 5)
  })
})
