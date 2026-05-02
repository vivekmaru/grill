import { describe, it, expect, beforeEach } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { Session } from '@/orchestrator/session'
import { createDb } from '@/server/db/client'
import { createStubAdapter } from './_helpers/stubAdapter'

describe('Session — construction', () => {
  let db: Database

  beforeEach(() => {
    db = createDb(':memory:')
  })

  it('Session.create persists a session row in ingest state with provider locked', () => {
    const stub = createStubAdapter([])
    const session = Session.create(db, stub.adapter)
    const snap = session.snapshot()
    expect(snap.state).toBe('ingest')
    expect(snap.provider).toBe('claude')
    expect(snap.modelCallsMade).toBe(0)
    expect(snap.allowExtraUsage).toBe(false)
    expect(snap.id).toBeGreaterThan(0)
  })

  it('Session.load fetches an existing session and replays state from history', () => {
    const stub = createStubAdapter([])
    const created = Session.create(db, stub.adapter)
    const id = created.snapshot().id

    const loaded = Session.load(db, stub.adapter, id)
    expect(loaded.snapshot().id).toBe(id)
    expect(loaded.snapshot().state).toBe('ingest')
  })

  it('Session.load throws if the session does not exist', () => {
    const stub = createStubAdapter([])
    expect(() => Session.load(db, stub.adapter, 9999)).toThrow(/not found/)
  })
})
