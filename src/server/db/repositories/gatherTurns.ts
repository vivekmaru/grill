import type { Database } from 'bun:sqlite'

export interface GatherTurnRow {
  id: number
  sessionId: number
  roleId: string
  turnKind: 'broad' | 'followup' | 'skip' | 'done'
  question: string | null
  answer: string | null
  createdAt: number
}

export class GatherTurnsRepo {
  constructor(private db: Database) {}

  insertQuestion(args: {
    sessionId: number
    roleId: string
    turnKind: 'broad' | 'followup' | 'done'
    question: string | null
  }): number {
    const now = Date.now()
    const row = this.db
      .prepare(
        `INSERT INTO gather_turns (session_id, role_id, turn_kind, question, answer, created_at)
         VALUES (?, ?, ?, ?, NULL, ?) RETURNING id`,
      )
      .get(args.sessionId, args.roleId, args.turnKind, args.question, now) as { id: number }
    return row.id
  }

  insertSkip(args: { sessionId: number; roleId: string }): number {
    const now = Date.now()
    const row = this.db
      .prepare(
        `INSERT INTO gather_turns (session_id, role_id, turn_kind, question, answer, created_at)
         VALUES (?, ?, 'skip', NULL, NULL, ?) RETURNING id`,
      )
      .get(args.sessionId, args.roleId, now) as { id: number }
    return row.id
  }

  recordAnswer(turnId: number, answer: string): void {
    this.db.prepare(`UPDATE gather_turns SET answer = ? WHERE id = ?`).run(answer, turnId)
  }

  forRole(sessionId: number, roleId: string): GatherTurnRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, session_id AS sessionId, role_id AS roleId, turn_kind AS turnKind,
                question, answer, created_at AS createdAt
         FROM gather_turns
         WHERE session_id = ? AND role_id = ?
         ORDER BY created_at ASC`,
      )
      .all(sessionId, roleId) as GatherTurnRow[]
    return rows
  }

  countFollowups(sessionId: number, roleId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM gather_turns
         WHERE session_id = ? AND role_id = ? AND turn_kind = 'followup'`,
      )
      .get(sessionId, roleId) as { n: number }
    return row.n
  }
}
