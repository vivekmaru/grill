import { describe, it, expect } from 'vitest'
import { Archetype, Tone, Persona, TargetContext } from '@/schema/target'

describe('Archetype', () => {
  it.each([
    'engineering-manager',
    'director-of-engineering',
    'tech-recruiter',
    'vp-product',
    'founder',
    'staff-principal-ic',
    'department-head',
  ])('accepts %s', (a) => {
    expect(Archetype.parse(a)).toBe(a)
  })

  it('rejects "hiring-manager" (deferred)', () => {
    expect(() => Archetype.parse('hiring-manager')).toThrow()
  })
})

describe('Tone', () => {
  it('accepts the four documented tones', () => {
    for (const t of ['skeptical', 'curious', 'adversarial', 'coaching']) {
      expect(Tone.parse(t)).toBe(t)
    }
  })
})

describe('Persona', () => {
  it('parses a basic persona', () => {
    const p = Persona.parse({
      archetype: 'engineering-manager',
      tone: 'skeptical',
    })
    expect(p.overridePrompt).toBeUndefined()
  })
})

describe('TargetContext', () => {
  it('parses with JD provided', () => {
    const t = TargetContext.parse({
      targetRole: 'Staff Engineer',
      targetSeniority: 'staff',
      jobDescription: 'Looking for...',
      persona: { archetype: 'engineering-manager', tone: 'skeptical' },
    })
    expect(t.jobDescription).toBe('Looking for...')
  })

  it('rejects unknown seniority', () => {
    expect(() =>
      TargetContext.parse({
        targetRole: 'X',
        targetSeniority: 'godmode',
        persona: { archetype: 'founder', tone: 'curious' },
      }),
    ).toThrow()
  })
})
