import { describe, it, expect } from 'bun:test'
import { createDb } from '@/server/db/client'
import { GatherTurnsRepo } from '@/server/db/repositories/gatherTurns'

describe('GatherTurnsRepo', () => {
  it('inserts and retrieves turns by role', () => {
    const db = createDb(':memory:')
    // pre-create a session row that the FK references
    // actual sessions schema: id, state, created_at, updated_at are NOT NULL; rest are nullable or have defaults
    db.prepare(
      `INSERT INTO sessions (id, state, created_at, updated_at)
       VALUES (1, 'gather', 0, 0)`,
    ).run()

    const repo = new GatherTurnsRepo(db)
    const id1 = repo.insertQuestion({ sessionId: 1, roleId: 'r1', turnKind: 'broad', question: 'tell me' })
    repo.recordAnswer(id1, 'I built X')
    const id2 = repo.insertQuestion({ sessionId: 1, roleId: 'r1', turnKind: 'followup', question: 'how big' })
    repo.recordAnswer(id2, 'team of 5')

    const turns = repo.forRole(1, 'r1')
    expect(turns).toHaveLength(2)
    expect(turns[0]!.question).toBe('tell me')
    expect(turns[0]!.answer).toBe('I built X')
    expect(turns[1]!.turnKind).toBe('followup')
    expect(repo.countFollowups(1, 'r1')).toBe(1)
  })

  it('insertSkip creates a skip turn with no question or answer', () => {
    const db = createDb(':memory:')
    db.prepare(
      `INSERT INTO sessions (id, state, created_at, updated_at)
       VALUES (1, 'gather', 0, 0)`,
    ).run()

    const repo = new GatherTurnsRepo(db)
    const skipId = repo.insertSkip({ sessionId: 1, roleId: 'r2' })
    const turns = repo.forRole(1, 'r2')
    expect(turns).toHaveLength(1)
    expect(turns[0]!.id).toBe(skipId)
    expect(turns[0]!.turnKind).toBe('skip')
    expect(turns[0]!.question).toBeNull()
    expect(turns[0]!.answer).toBeNull()
  })

  it('countFollowups counts only followup turns', () => {
    const db = createDb(':memory:')
    db.prepare(
      `INSERT INTO sessions (id, state, created_at, updated_at)
       VALUES (1, 'gather', 0, 0)`,
    ).run()

    const repo = new GatherTurnsRepo(db)
    repo.insertQuestion({ sessionId: 1, roleId: 'r1', turnKind: 'broad', question: 'q0' })
    repo.insertQuestion({ sessionId: 1, roleId: 'r1', turnKind: 'followup', question: 'q1' })
    repo.insertQuestion({ sessionId: 1, roleId: 'r1', turnKind: 'followup', question: 'q2' })
    expect(repo.countFollowups(1, 'r1')).toBe(2)
  })

  it('forRole returns empty array when no turns exist', () => {
    const db = createDb(':memory:')
    db.prepare(
      `INSERT INTO sessions (id, state, created_at, updated_at)
       VALUES (1, 'gather', 0, 0)`,
    ).run()

    const repo = new GatherTurnsRepo(db)
    expect(repo.forRole(1, 'nonexistent')).toHaveLength(0)
  })
})
