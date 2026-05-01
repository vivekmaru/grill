import { describe, it, expect } from 'bun:test'
import { reduce } from '@/state/reducer'
import type { State } from '@/state/states'

describe('reduce', () => {
  it('moves ingest → target on CONFIRM_INGEST after START_BLANK', () => {
    let s: State = 'ingest'
    s = reduce(s, { type: 'START_BLANK' })
    expect(s).toBe('ingest') // start_blank stays in ingest until confirm
    s = reduce(s, { type: 'CONFIRM_INGEST' })
    expect(s).toBe('target')
  })

  it('moves target → persona on SET_TARGET', () => {
    const s = reduce('target', {
      type: 'SET_TARGET',
      ctx: {
        targetRole: 'PM',
        targetSeniority: 'senior',
        persona: { archetype: 'vp-product', tone: 'curious' },
      },
    })
    expect(s).toBe('persona')
  })

  it('moves persona → gather on CONFIRM_PERSONA', () => {
    expect(reduce('persona', { type: 'CONFIRM_PERSONA' })).toBe('gather')
  })

  it('keeps gather as gather on USER_MESSAGE', () => {
    expect(reduce('gather', { type: 'USER_MESSAGE', text: 'hi' })).toBe('gather')
  })

  it('END_INTERROGATION jumps directly to generate from any of gather/critique/finalReview', () => {
    expect(reduce('gather', { type: 'END_INTERROGATION' })).toBe('generate')
    expect(reduce('critique', { type: 'END_INTERROGATION' })).toBe('generate')
    expect(reduce('finalReview', { type: 'END_INTERROGATION' })).toBe('generate')
  })

  it('throws on disallowed event for current state', () => {
    expect(() =>
      reduce('ingest', { type: 'PROCEED_TO_GENERATE' }),
    ).toThrow(/not allowed/)
  })

  it('moves critique → finalReview on PROCEED_TO_GENERATE', () => {
    expect(reduce('critique', { type: 'PROCEED_TO_GENERATE' })).toBe('finalReview')
  })

  it('moves finalReview → generate on PROCEED_TO_GENERATE', () => {
    expect(reduce('finalReview', { type: 'PROCEED_TO_GENERATE' })).toBe('generate')
  })

  it('moves generate → edit on PICK_TEMPLATE', () => {
    expect(reduce('generate', { type: 'PICK_TEMPLATE', templateId: 'x' })).toBe('edit')
  })

  it('moves edit → export on EXPORT', () => {
    expect(reduce('edit', { type: 'EXPORT', format: 'pdf' })).toBe('export')
  })
})
