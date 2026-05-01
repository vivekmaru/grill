import { describe, it, expect } from 'vitest'
import { Bullet, ImpactMetric } from '@/schema/resume'

describe('ImpactMetric', () => {
  it('parses a verified percentage metric', () => {
    const result = ImpactMetric.parse({
      value: '30%',
      unit: 'percent',
      verified: true,
    })
    expect(result.value).toBe('30%')
    expect(result.unit).toBe('percent')
    expect(result.verified).toBe(true)
    expect(result.baseline).toBeUndefined()
  })

  it('rejects an unknown unit', () => {
    expect(() =>
      ImpactMetric.parse({ value: '5', unit: 'lightyears', verified: false }),
    ).toThrow()
  })
})

describe('Bullet', () => {
  it('parses a minimal bullet with defaults', () => {
    const b = Bullet.parse({
      id: 'b1',
      text: 'Built a thing',
      status: 'draft',
    })
    expect(b.metrics).toEqual([])
    expect(b.skills).toEqual([])
    expect(b.flags).toEqual([])
    expect(b.sourceTurnIds).toEqual([])
  })

  it('rejects status outside the allowed set', () => {
    expect(() =>
      Bullet.parse({ id: 'b1', text: 'x', status: 'finished' }),
    ).toThrow()
  })
})
