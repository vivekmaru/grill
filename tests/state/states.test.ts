import { describe, it, expect } from 'bun:test'
import { allowedEventsFor, type State } from '@/state/states'

describe('State', () => {
  it('lists all expected states', () => {
    const all: State[] = [
      'ingest', 'target', 'persona', 'gather',
      'critique', 'finalReview', 'generate', 'edit', 'export',
    ]
    for (const s of all) {
      expect(allowedEventsFor(s)).toBeDefined()
    }
  })

  it('only allows START_BLANK and UPLOAD_RESUME from ingest', () => {
    const events = allowedEventsFor('ingest')
    expect(events).toContain('START_BLANK')
    expect(events).toContain('UPLOAD_RESUME')
    expect(events).not.toContain('PROCEED_TO_GENERATE')
  })

  it('always allows END_INTERROGATION from gather/critique/finalReview', () => {
    expect(allowedEventsFor('gather')).toContain('END_INTERROGATION')
    expect(allowedEventsFor('critique')).toContain('END_INTERROGATION')
    expect(allowedEventsFor('finalReview')).toContain('END_INTERROGATION')
  })
})
