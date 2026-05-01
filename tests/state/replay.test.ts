import { describe, it, expect } from 'bun:test'
import { replay } from '@/state/replay'
import type { Event } from '@/schema/events'

describe('replay', () => {
  it('returns ingest for an empty history', () => {
    expect(replay([])).toBe('ingest')
  })

  it('reaches gather after a typical opening sequence', () => {
    const events: Event[] = [
      { type: 'START_BLANK' },
      { type: 'CONFIRM_INGEST' },
      {
        type: 'SET_TARGET',
        ctx: {
          targetRole: 'PM',
          targetSeniority: 'senior',
          persona: { archetype: 'vp-product', tone: 'curious' },
        },
      },
      { type: 'CONFIRM_PERSONA' },
    ]
    expect(replay(events)).toBe('gather')
  })

  it('reaches generate after END_INTERROGATION mid-gather', () => {
    const events: Event[] = [
      { type: 'START_BLANK' },
      { type: 'CONFIRM_INGEST' },
      {
        type: 'SET_TARGET',
        ctx: {
          targetRole: 'PM',
          targetSeniority: 'senior',
          persona: { archetype: 'vp-product', tone: 'curious' },
        },
      },
      { type: 'CONFIRM_PERSONA' },
      { type: 'END_INTERROGATION' },
    ]
    expect(replay(events)).toBe('generate')
  })

  it('throws on the first illegal event', () => {
    const events: Event[] = [
      { type: 'START_BLANK' },
      { type: 'PROCEED_TO_GENERATE' }, // illegal from ingest
    ]
    expect(() => replay(events)).toThrow(/not allowed/)
  })
})
