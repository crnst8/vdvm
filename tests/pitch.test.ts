import { describe, it, expect } from 'vitest'
import { formatSemitones, semitonesToCents } from '../src/ui/PitchKnob'

describe('pitch formatting', () => {
  it('shows signed semitones with units and keeps exact cents visible', () => {
    expect(formatSemitones(0)).toBe('0.0 st')
    expect(formatSemitones(200)).toBe('+2.0 st')
    expect(formatSemitones(-50)).toBe('−0.5 st')
    expect(formatSemitones(123)).toBe('+1.23 st')
    expect(formatSemitones(-1200)).toBe('−12.0 st')
    expect(formatSemitones(200, false)).toBe('+2.0')
  })
  it('parses a semitone field to integer cents, returning null when not finite', () => {
    expect(semitonesToCents('2')).toBe(200)
    expect(semitonesToCents('-0.5')).toBe(-50)
    expect(semitonesToCents('−0.5')).toBe(-50)
    expect(semitonesToCents('-0,5')).toBe(-50)
    expect(semitonesToCents('1.23')).toBe(123)
    expect(semitonesToCents('')).toBeNull()
    expect(semitonesToCents('abc')).toBeNull()
    expect(semitonesToCents('99')).toBe(1200)
  })
})
