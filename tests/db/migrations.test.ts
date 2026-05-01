import { describe, it, expect } from 'vitest'
import { createDb } from '@/server/db/client'

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

  it('is idempotent — running migrations twice does not error', async () => {
    const db = createDb(':memory:')
    const { runMigrations } = await import('@/server/db/migrations')
    expect(() => runMigrations(db)).not.toThrow()
  })
})
