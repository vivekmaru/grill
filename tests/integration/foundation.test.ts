import { describe, it, expect } from 'bun:test'
import { createDb } from '@/server/db/client'
import { createSessionRepo } from '@/server/db/repositories/sessions'
import { createHistoryRepo } from '@/server/db/repositories/history'
import { createModelCallsRepo } from '@/server/db/repositories/modelCalls'
import { replay } from '@/state/replay'
import type { Event } from '@/schema/events'

describe('foundation: end-to-end persistence and replay', () => {
  it('persists a session, appends events, and reconstructs state via replay', () => {
    const db = createDb(':memory:')
    const sessions = createSessionRepo(db)
    const history = createHistoryRepo(db)
    const calls = createModelCallsRepo(db)

    const sessionId = sessions.create({ state: 'ingest' })
    sessions.lockProvider(sessionId, 'claude')

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

    for (const e of events) {
      history.append({ sessionId, role: 'user', event: e })
    }

    calls.record({
      sessionId,
      templateName: 'persona-propose',
      provider: 'claude',
      tier: 'main',
      tokensInEstimate: 800,
      tokensOutEstimate: 120,
      latencyMs: 1500,
      validationFailures: 0,
      verifierRejections: 0,
    })

    const persisted = history.listForSession(sessionId).map((r) => r.event)
    const finalState = replay(persisted)

    expect(finalState).toBe('gather')
    expect(calls.totalsForSession(sessionId).count).toBe(1)
    expect(sessions.get(sessionId)?.provider).toBe('claude')
  })
})
