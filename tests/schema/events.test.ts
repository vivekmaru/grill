import { describe, it, expect } from 'vitest'
import { Event } from '@/schema/events'

describe('Event', () => {
  it('parses START_BLANK', () => {
    expect(Event.parse({ type: 'START_BLANK' }).type).toBe('START_BLANK')
  })

  it('parses SET_TARGET with full target context', () => {
    const e = Event.parse({
      type: 'SET_TARGET',
      ctx: {
        targetRole: 'PM',
        targetSeniority: 'senior',
        persona: { archetype: 'vp-product', tone: 'curious' },
      },
    })
    expect(e.type).toBe('SET_TARGET')
  })

  it('parses ACCEPT_BULLET', () => {
    const e = Event.parse({
      type: 'ACCEPT_BULLET',
      bulletId: 'b1',
      newText: 'Shipped X to 10k users',
    })
    expect(e.type).toBe('ACCEPT_BULLET')
  })

  it('parses END_INTERROGATION', () => {
    expect(Event.parse({ type: 'END_INTERROGATION' }).type).toBe('END_INTERROGATION')
  })

  it('rejects unknown event type', () => {
    expect(() => Event.parse({ type: 'DELETE_EVERYTHING' })).toThrow()
  })
})
