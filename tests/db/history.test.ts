import { describe, it, expect, beforeEach } from 'bun:test'
import { createDb } from '@/server/db/client'
import { createHistoryRepo, type HistoryRepo } from '@/server/db/repositories/history'
import { createSessionRepo } from '@/server/db/repositories/sessions'

describe('HistoryRepo', () => {
  let repo: HistoryRepo
  let sessionId: number

  beforeEach(() => {
    const db = createDb(':memory:')
    sessionId = createSessionRepo(db).create({ state: 'ingest' })
    repo = createHistoryRepo(db)
  })

  it('appends events and returns them in order', () => {
    repo.append({
      sessionId,
      role: 'user',
      event: { type: 'START_BLANK' },
    })
    repo.append({
      sessionId,
      role: 'user',
      event: { type: 'CONFIRM_INGEST' },
    })
    const rows = repo.listForSession(sessionId)
    expect(rows.map((r) => r.event.type)).toEqual([
      'START_BLANK',
      'CONFIRM_INGEST',
    ])
  })

  it('rejects events that do not match the Event schema', () => {
    expect(() =>
      repo.append({
        sessionId,
        role: 'user',
        // @ts-expect-error: invalid event type for test
        event: { type: 'NUKE' },
      }),
    ).toThrow()
  })
})
