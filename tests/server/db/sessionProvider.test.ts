import { describe, it, expect } from 'bun:test'
import { createDb } from '@/server/db/client'
import { createSessionRepo } from '@/server/db/repositories/sessions'
import { getSessionProvider } from '@/server/db/repositories/sessions'

describe('getSessionProvider', () => {
  it('returns the stored provider for a locked session', () => {
    const db = createDb(':memory:')
    const repo = createSessionRepo(db)
    const id = repo.create({ state: 'ingest' })
    repo.lockProvider(id, 'claude')
    expect(getSessionProvider(db, id)).toBe('claude')
  })

  it('returns "codex" when provider is null (no provider locked yet)', () => {
    const db = createDb(':memory:')
    const repo = createSessionRepo(db)
    // create a session but don't lock provider — insert directly to bypass lockProvider logic
    const id = db
      .query<{ id: number }, [string, number, number]>(
        'INSERT INTO sessions (state, created_at, updated_at) VALUES (?, ?, ?) RETURNING id',
      )
      .get('ingest', Date.now(), Date.now())!.id
    expect(getSessionProvider(db, id)).toBe('codex')
  })

  it('throws "Session not found" for a missing id', () => {
    const db = createDb(':memory:')
    expect(() => getSessionProvider(db, 9999)).toThrow('Session not found')
  })
})
