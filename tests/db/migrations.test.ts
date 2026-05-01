import { describe, it, expect } from 'bun:test'
import { createDb } from '@/server/db/client'
import { runMigrations } from '@/server/db/migrations'

describe('migrations', () => {
  it('creates all four tables on a fresh in-memory db', () => {
    const db = createDb(':memory:')
    const rows = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
    const names = rows.map((r) => r.name)
    expect(names).toContain('sessions')
    expect(names).toContain('resumes')
    expect(names).toContain('history')
    expect(names).toContain('model_calls')
  })

  it('is idempotent — running migrations twice does not error', () => {
    const db = createDb(':memory:')
    // createDb already ran migrations once; run again directly.
    expect(() => runMigrations(db)).not.toThrow()
  })
})
