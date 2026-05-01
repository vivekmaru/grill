import type { Database } from 'bun:sqlite'
import { Event } from '@/schema/events'

export type Role = 'user' | 'ai'

export interface StoredHistoryRow {
  id: number
  sessionId: number
  role: Role
  event: Event
  timestamp: number
}

export interface HistoryRepo {
  append(input: { sessionId: number; role: Role; event: Event }): number
  listForSession(sessionId: number): StoredHistoryRow[]
}

interface HistoryRow {
  id: number
  session_id: number
  role: string
  event_type: string
  content_json: string
  timestamp: number
}

export function createHistoryRepo(db: Database): HistoryRepo {
  const insert = db.query<
    { id: number },
    [number, string, string, string, number]
  >(
    `INSERT INTO history (session_id, role, event_type, content_json, timestamp)
     VALUES (?, ?, ?, ?, ?) RETURNING id`,
  )
  const list = db.query<HistoryRow, [number]>(
    `SELECT * FROM history WHERE session_id = ? ORDER BY timestamp ASC, id ASC`,
  )

  return {
    append({ sessionId, role, event }) {
      const parsed = Event.parse(event)
      const row = insert.get(
        sessionId,
        role,
        parsed.type,
        JSON.stringify(parsed),
        Date.now(),
      )
      if (!row) throw new Error('insert returned no row')
      return row.id
    },
    listForSession(sessionId) {
      return list.all(sessionId).map((r) => ({
        id: r.id,
        sessionId: r.session_id,
        role: r.role as Role,
        event: Event.parse(JSON.parse(r.content_json)),
        timestamp: r.timestamp,
      }))
    },
  }
}
