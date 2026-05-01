import { describe, it, expect } from 'bun:test'
import { FlagType, Severity, FlagInstance } from '@/schema/flags'

describe('FlagType', () => {
  it.each([
    'unverified', 'no-impact', 'inflated',
    'vague', 'passive', 'length',
    'jargon', 'stale',
  ])('accepts %s', (flag) => {
    expect(FlagType.parse(flag)).toBe(flag)
  })

  it('rejects unknown flag type', () => {
    expect(() => FlagType.parse('redundant')).toThrow()
  })
})

describe('Severity', () => {
  it('accepts 1, 2, 3', () => {
    expect(Severity.parse(2)).toBe(2)
  })
  it('rejects 0 and 4', () => {
    expect(() => Severity.parse(0)).toThrow()
    expect(() => Severity.parse(4)).toThrow()
  })
})

describe('FlagInstance', () => {
  it('parses a complete flag with defaults for dismissed fields', () => {
    const f = FlagInstance.parse({
      flag: 'vague',
      severity: 2,
      span: 'collaborated',
      why: 'Vague resume-ghosting word with no specifics.',
      suggestedQuestion: 'What did collaboration look like day to day?',
    })
    expect(f.dismissed).toBe(false)
    expect(f.dismissedAt).toBeNull()
  })
})
