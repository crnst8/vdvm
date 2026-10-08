import { describe, it, expect } from 'vitest'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { readFileSync, readdirSync } from 'node:fs'

const ajv = new Ajv2020({ allErrors: true, strict: true })
for (const f of readdirSync('catalog/schema').filter((f) => f.endsWith('.schema.json'))) {
  ajv.addSchema(JSON.parse(readFileSync(`catalog/schema/${f}`, 'utf8')))
}
const validMachine = ajv.getSchema('machine.schema.json')!
const validPattern = ajv.getSchema('pattern.schema.json')!

const machine = (history: unknown) => ({
  id: 'x-y', manufacturer: 'X', model: 'Y', displayName: 'X Y', aliases: [], kind: 'drum-machine',
  identityStatus: 'provisional', logo: null, photo: null, history,
})

describe('machine schema: history', () => {
  it('accepts null and a text + sources object', () => {
    expect(validMachine(machine(null))).toBe(true)
    expect(validMachine(machine({ text: 'A drum machine.', sources: [{ title: 'Manual', url: 'https://example.org/m.pdf' }] }))).toBe(true)
  })
  it('requires the field and at least one http(s) source', () => {
    const { history: _omit, ...noHistory } = machine(null)
    expect(validMachine(noHistory)).toBe(false)
    expect(validMachine(machine({ text: 'A drum machine.', sources: [] }))).toBe(false)
    expect(validMachine(machine({ text: 'A drum machine.', sources: [{ title: 'x', url: 'ftp://x' }] }))).toBe(false)
  })
})

describe('pattern schema: groove', () => {
  const pattern = { schemaVersion: 1, id: 'p', name: 'TEST', kitId: 'x-y', kitRevision: '0123456789abcdef', bpm: 120, tracks: [], updatedAt: '2026-09-30T00:00:00Z' }
  it('keeps old patterns valid and restricts swing and grid to supported values', () => {
    expect(validPattern(pattern)).toBe(true)
    expect(validPattern({ ...pattern, swing: 63, swingGrid: 8 })).toBe(true)
    expect(validPattern({ ...pattern, swing: 75, swingGrid: 16 })).toBe(true)
    expect(validPattern({ ...pattern, swing: 80 })).toBe(false)
    expect(validPattern({ ...pattern, swing: 49 })).toBe(false)
    expect(validPattern({ ...pattern, swing: 63.5 })).toBe(false)
    expect(validPattern({ ...pattern, swingGrid: 12 })).toBe(false)
  })
})

describe('pattern schema: pitch', () => {
  const track = { slotId: 'kick', sampleId: 'x-y-kick', steps: new Array(16).fill(false) }
  const pattern = { schemaVersion: 1, id: 'p', name: 'TEST', kitId: 'x-y', kitRevision: '0123456789abcdef', bpm: 120, tracks: [track], updatedAt: '2026-09-30T00:00:00Z' }
  it('accepts integer overall pitch within ±1200 and rejects out-of-range or fractional values', () => {
    expect(validPattern(pattern)).toBe(true)
    expect(validPattern({ ...pattern, pitchCents: 0 })).toBe(true)
    expect(validPattern({ ...pattern, pitchCents: 1200 })).toBe(true)
    expect(validPattern({ ...pattern, pitchCents: -1200 })).toBe(true)
    expect(validPattern({ ...pattern, pitchCents: 1201 })).toBe(false)
    expect(validPattern({ ...pattern, pitchCents: -1201 })).toBe(false)
    expect(validPattern({ ...pattern, pitchCents: 12.5 })).toBe(false)
    expect(validPattern({ ...pattern, pitchCents: '100' })).toBe(false)
  })
  it('accepts exactly 16 bounded integer step offsets and rejects the wrong length or bounds', () => {
    const steps = new Array(16).fill(0)
    expect(validPattern({ ...pattern, tracks: [{ ...track, stepPitchCents: steps }] })).toBe(true)
    expect(validPattern({ ...pattern, tracks: [{ ...track, stepPitchCents: new Array(15).fill(0) }] })).toBe(false)
    expect(validPattern({ ...pattern, tracks: [{ ...track, stepPitchCents: new Array(17).fill(0) }] })).toBe(false)
    expect(validPattern({ ...pattern, tracks: [{ ...track, stepPitchCents: new Array(16).fill(1201) }] })).toBe(false)
    expect(validPattern({ ...pattern, tracks: [{ ...track, stepPitchCents: new Array(16).fill(-1201) }] })).toBe(false)
    expect(validPattern({ ...pattern, tracks: [{ ...track, stepPitchCents: new Array(16).fill(1.5) }] })).toBe(false)
  })
})
