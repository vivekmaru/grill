import { describe, it, expect } from 'vitest'
import { Bullet, ImpactMetric, Resume, Role, Project, Education } from '@/schema/resume'

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

describe('Role', () => {
  it('parses a current role with null endDate', () => {
    const r = Role.parse({
      id: 'r1',
      company: 'Acme',
      title: 'Engineer',
      startDate: '2022-01',
      endDate: null,
      bullets: [],
    })
    expect(r.endDate).toBeNull()
  })
})

describe('Education', () => {
  it('parses with optional fields omitted', () => {
    const e = Education.parse({
      id: 'e1',
      institution: 'MIT',
      degree: 'BSc',
    })
    expect(e.highlights).toEqual([])
  })
})

describe('Project', () => {
  it('rejects a malformed url', () => {
    expect(() =>
      Project.parse({
        id: 'p1',
        name: 'X',
        url: 'not-a-url',
        description: 'd',
        bullets: [],
      }),
    ).toThrow()
  })
})

describe('Resume', () => {
  it('parses a minimal resume', () => {
    const r = Resume.parse({
      version: 1,
      contact: { name: 'Vivek' },
      roles: [],
    })
    expect(r.education).toEqual([])
    expect(r.projects).toEqual([])
    expect(r.skills).toEqual({ categories: [] })
    expect(r.certifications).toEqual([])
  })

  it('rejects a wrong version literal', () => {
    expect(() =>
      Resume.parse({ version: 2, contact: { name: 'x' }, roles: [] }),
    ).toThrow()
  })
})

describe('Bullet with flags', () => {
  it('parses a flagged bullet', () => {
    const b = Bullet.parse({
      id: 'b1',
      text: 'collaborated with team',
      status: 'flagged',
      flags: [{
        flag: 'vague',
        severity: 2,
        span: 'collaborated',
        why: 'Vague verb.',
        suggestedQuestion: 'What did collaboration look like?',
      }],
    })
    expect(b.flags[0]?.dismissed).toBe(false)
  })
})
