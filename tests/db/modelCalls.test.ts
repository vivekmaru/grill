import { describe, it, expect, beforeEach } from 'bun:test'
import { createDb } from '@/server/db/client'
import { createModelCallsRepo, type ModelCallsRepo } from '@/server/db/repositories/modelCalls'
import { createSessionRepo } from '@/server/db/repositories/sessions'

describe('ModelCallsRepo', () => {
  let repo: ModelCallsRepo
  let sessionId: number

  beforeEach(() => {
    const db = createDb(':memory:')
    sessionId = createSessionRepo(db).create({ state: 'ingest' })
    repo = createModelCallsRepo(db)
  })

  it('records a call with all fields', () => {
    repo.record({
      sessionId,
      templateName: 'gather-broad',
      provider: 'claude',
      tier: 'main',
      tokensInEstimate: 1200,
      tokensOutEstimate: 250,
      latencyMs: 4321,
      validationFailures: 0,
      verifierRejections: 0,
    })
    expect(repo.totalsForSession(sessionId).count).toBe(1)
    expect(repo.totalsForSession(sessionId).tokensIn).toBe(1200)
  })

  it('aggregates totals across calls', () => {
    for (const t of [100, 200, 300]) {
      repo.record({
        sessionId,
        templateName: 'critique-scan',
        provider: 'claude',
        tier: 'main',
        tokensInEstimate: t,
        tokensOutEstimate: 50,
        latencyMs: 1000,
        validationFailures: 0,
        verifierRejections: 0,
      })
    }
    const t = repo.totalsForSession(sessionId)
    expect(t.count).toBe(3)
    expect(t.tokensIn).toBe(600)
    expect(t.tokensOut).toBe(150)
  })

  it('returns zeroes for a session with no calls', () => {
    const t = repo.totalsForSession(sessionId)
    expect(t).toEqual({ count: 0, tokensIn: 0, tokensOut: 0 })
  })
})
