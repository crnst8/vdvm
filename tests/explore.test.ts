import { describe, it, expect } from 'vitest'
import { addTap, emptyTaps } from '../src/state/tapTempo'
import { clampBpm } from '../src/state/pattern'
import { neighbourMachine, kitOrder, preferredKit, shortKitLabels } from '../src/data/catalog'
import { pushRecent, toggleIn, RECENTS_MAX } from '../src/data/prefs'
import type { CatalogIndex } from '../src/contract/types'

describe('tap tempo', () => {
  const tap = (times: number[]) => {
    let s = emptyTaps()
    let bpm: number | null = null
    for (const t of times) ({ state: s, bpm } = addTap(s, t, clampBpm))
    return bpm
  }
  it('needs two taps and measures the interval', () => {
    expect(tap([0])).toBeNull()
    expect(tap([0, 500])).toBe(120)
    expect(tap([0, 600, 1200, 1800])).toBe(100)
  })
  it('uses the median so one stray tap does not swing the tempo', () => {
    expect(tap([0, 500, 1000, 1700, 2200, 2700])).toBe(120)
  })
  it('restarts after a pause and clamps to 40–240', () => {
    expect(tap([0, 500, 5000, 5250])).toBe(240)
    expect(tap([0, 1900])).toBe(40)
  })
})

describe('favourites and recents', () => {
  it('toggles membership and keeps recents unique, newest first, capped', () => {
    expect(toggleIn(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleIn(['a', 'b'], 'a')).toEqual(['b'])
    let r: string[] = []
    for (let i = 0; i < 12; i++) r = pushRecent(r, `k${i % 10}`)
    expect(r[0]).toBe('k1')
    expect(new Set(r).size).toBe(r.length)
    expect(r.length).toBe(RECENTS_MAX)
  })
})

describe('kit stepping', () => {
  const m = (id: string, manufacturer: string, model: string) => ({
    id, manufacturer, model, displayName: `${manufacturer} ${model}`, aliases: [], kind: 'drum-machine' as const,
    identityStatus: 'provisional' as const, logo: null, photo: null, history: null,
  })
  const index = {
    schemaVersion: 1, revision: '0123456789abcdef', creditsUrl: 'c.json', redirects: { machines: {}, kits: {}, samples: {} },
    machines: [m('r909', 'Roland', 'TR-909'), m('c1', 'Casio', 'RZ-1'), m('r808', 'Roland', 'TR-808'), m('l1', 'Linn', 'LinnDrum')],
    kits: ['r909', 'c1', 'r808', 'l1'].map((id) => ({ id: `${id}-k`, machineId: id, label: id, revision: '0123456789abcdef', url: 'x.json' })),
  } as unknown as CatalogIndex
  it('orders by manufacturer then model and steps machines, wrapping', () => {
    expect(kitOrder(index).map((k) => k.machineId)).toEqual(['c1', 'l1', 'r808', 'r909'])
    expect(neighbourMachine(index, 'r909', 1)!.id).toBe('c1')
    expect(neighbourMachine(index, 'c1', -1)!.id).toBe('r909')
  })
  it('steps through favourites only, from a non-favourite to the nearest one', () => {
    const favs = new Set(['c1', 'r909'])
    const only = (m: { id: string }) => favs.has(m.id)
    expect(neighbourMachine(index, 'c1', 1, only)!.id).toBe('r909')
    expect(neighbourMachine(index, 'r909', 1, only)!.id).toBe('c1')
    expect(neighbourMachine(index, 'l1', 1, only)!.id).toBe('r909')
    expect(neighbourMachine(index, 'l1', -1, only)!.id).toBe('c1')
    expect(neighbourMachine(index, 'c1', 1, (m) => m.id === 'c1')).toBeNull()
  })
  it('prefers the most recently used kit of a machine', () => {
    const idx = { ...index, kits: [...index.kits, { id: 'c1-b', machineId: 'c1', label: 'b', revision: '0123456789abcdef', url: 'y.json' }] } as CatalogIndex
    expect(preferredKit(idx, 'c1', [])!.id).toBe('c1-k')
    expect(preferredKit(idx, 'c1', ['r909-k', 'c1-b', 'c1-k'])!.id).toBe('c1-b')
  })
  it('makes short, distinct kit labels', () => {
    const mach = m('casio-rz-1', 'Casio', 'RZ-1')
    const k = (id: string, label: string) => ({ id, machineId: 'casio-rz-1', label, revision: '0123456789abcdef', url: 'x' })
    const labels = shortKitLabels(mach, [
      k('a', 'Casio RZ1 — archive variants'), k('b', 'Casio RZ1 — archive variants'), k('c', 'Casio RZ-1 — archive variants'), k('d', 'RZ-1'),
    ])
    expect([...labels.values()]).toEqual(['RZ1 archive 1', 'RZ1 archive 2', 'RZ-1 archive', 'Main'])
    const juno = shortKitLabels(m('j', 'Roland', 'Juno-D'), [k('x', 'Roland Juno-D — 03. 808 & 909 Kit'), k('y', 'Roland Juno-D — 04. Hip-Hop Kit')])
    expect([...juno.values()]).toEqual(['03. 808 & 909 Kit', '04. Hip-Hop Kit'])
  })
})

describe('machine sort', () => {
  it('keeps each manufacturer contiguous even when names share a prefix', async () => {
    const { sortMachines } = await import('../src/data/catalog')
    const mk = (manufacturer: string, model: string) => ({ id: `${manufacturer}-${model}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'), manufacturer, model }) as never
    const out = sortMachines([mk('Linn', 'LM-1'), mk('Linn Electronics', 'LinnDrum'), mk('Linn', '9000')]).map((m: { manufacturer: string }) => m.manufacturer)
    expect(out).toEqual(['Linn', 'Linn', 'Linn Electronics'])
  })
})
