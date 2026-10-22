import { describe, expect, it } from 'vitest'
import { completionFor, scoreMachine, searchMachines } from '../src/data/search'
import type { CatalogIndex, Machine } from '../src/contract/types'

const machine = (id: string, manufacturer: string, model: string, aliases: string[] = []): Machine => ({
  id, manufacturer, model, displayName: `${manufacturer} ${model}`, aliases, kind: 'drum-machine', identityStatus: 'provisional', logo: null, photo: null, history: null,
} as Machine)

const machines = [
  machine('roland-tr-909', 'Roland', 'TR-909'),
  machine('roland-tr-808', 'Roland', 'TR-808'),
  machine('roland-tr-606', 'Roland', 'TR-606'),
  machine('casio-rz-1', 'Casio', 'RZ-1', ['RZ1']),
  machine('casio-ct-310', 'Casio', 'CT-310'),
  machine('linn-linndrum', 'Linn', 'LinnDrum'),
  machine('emu-drumulator', 'Emu', 'Drumulator'),
]
const index = {
  schemaVersion: 1, revision: 'x', creditsUrl: 'c', redirects: { machines: {}, kits: {}, samples: {} },
  machines,
  kits: machines.map((m) => ({ id: `${m.id}-main`, machineId: m.id, label: 'Main', revision: 'r', url: 'u' })),
} as unknown as CatalogIndex
const none = { favourites: new Set<string>(), recents: [] as string[] }
const ids = (q: string, opts = none) => searchMachines(index, q, opts).map((h) => h.machine.id)

describe('machine search', () => {
  it('ignores case, spaces and hyphens in model names', () => {
    expect(ids('tr909')[0]).toBe('roland-tr-909')
    expect(ids('TR 909')[0]).toBe('roland-tr-909')
    expect(ids('rz1')[0]).toBe('casio-rz-1')
  })
  it('ranks model prefixes above maker words, then library order', () => {
    expect(ids('tr')).toEqual(['roland-tr-606', 'roland-tr-808', 'roland-tr-909'])
    expect(ids('roland')).toEqual(['roland-tr-606', 'roland-tr-808', 'roland-tr-909'])
    expect(ids('casio 310')).toEqual(['casio-ct-310'])
    expect(ids('casio ct')).toEqual(['casio-ct-310'])
  })
  it('forgives one typo and loose abbreviations, and rejects unrelated text', () => {
    expect(ids('drumalator')[0]).toBe('emu-drumulator')
    expect(ids('lndrm')[0]).toBe('linn-linndrum')
    expect(ids('zzzz')).toEqual([])
    expect(scoreMachine(machines[0], '')).toBe(0)
  })
  it('lifts favourites and recent machines among equal matches', () => {
    expect(ids('tr', { favourites: new Set(['roland-tr-909']), recents: [] })[0]).toBe('roland-tr-909')
    expect(ids('tr', { favourites: new Set(), recents: ['roland-tr-808-main'] })[0]).toBe('roland-tr-808')
  })
  it('lists recents, then favourites, then the library for an empty query', () => {
    const list = ids('', { favourites: new Set(['linn-linndrum']), recents: ['casio-rz-1-main'] })
    expect(list.slice(0, 2)).toEqual(['casio-rz-1', 'linn-linndrum'])
    expect(list).toHaveLength(machines.length)
  })
  it('completes the top hit from what was typed, keeping the typed text', () => {
    const [hit] = searchMachines(index, 'roland tr-9', none)
    expect(completionFor('roland tr-9', hit)).toBe('09')
    expect(completionFor('Lin', searchMachines(index, 'Lin', none)[0])).toBe('n LinnDrum')
    expect(completionFor('tr909', searchMachines(index, 'tr909', none)[0])).toBeNull()
  })
})
