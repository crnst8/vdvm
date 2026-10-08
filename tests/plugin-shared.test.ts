// The native plugin reads circuit timing, GM notes and engine constants from
// plugin/source/core/generated/shared.json. It must match the browser source.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { sharedData } from '../plugin/scripts/shared-data'

describe('plugin shared data', () => {
  it('generated/shared.json matches src/ (npm run plugin:shared to refresh)', () => {
    const file = JSON.parse(readFileSync('plugin/source/core/generated/shared.json', 'utf8'))
    expect(file).toEqual(JSON.parse(JSON.stringify(sharedData())))
  })
})
