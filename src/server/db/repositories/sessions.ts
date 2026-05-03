import type { Database } from 'bun:sqlite'

export type ProviderName = 'claude' | 'codex' | 'gemini'

export interface StoredSession {
  id: number
  state: string
  provider: ProviderName | null
  providerLockedAt: number | null
  activeResumeId: number | null
  modelCallsMade: number
  allowExtraUsage: boolean
  sessionHandle: string | null
  targetContext: unknown | null
  persona: unknown | null
  createdAt: number
  updatedAt: number
}

export interface SessionRepo {
  create(input: { state: string }): number
  get(id: number): StoredSession | null
  setState(id: number, state: string): void
  lockProvider(id: number, provider: ProviderName): void
  incrementCalls(id: number): void
  setAllowExtraUsage(id: number, value: boolean): void
  setSessionHandle(id: number, handle: string): void
  setActiveResume(id: number, resumeId: number): void
  setTargetContext(id: number, ctx: unknown): void
  setPersona(id: number, persona: unknown): void
  getGatherEnabled(id: number): boolean
  setGatherEnabled(id: number, enabled: boolean): void
}

interface SessionRow {
  id: number
  state: string
  provider: string | null
  provider_locked_at: number | null
  active_resume_id: number | null
  model_calls_made: number
  allow_extra_usage: number
  session_handle: string | null
  target_context_json: string | null
  persona_json: string | null
  created_at: number
  updated_at: number
}

function rowToSession(row: SessionRow): StoredSession {
  return {
    id: row.id,
    state: row.state,
    provider: (row.provider as ProviderName | null),
    providerLockedAt: row.provider_locked_at,
    activeResumeId: row.active_resume_id,
    modelCallsMade: row.model_calls_made,
    allowExtraUsage: Boolean(row.allow_extra_usage),
    sessionHandle: row.session_handle,
    targetContext: row.target_context_json ? JSON.parse(row.target_context_json) : null,
    persona: row.persona_json ? JSON.parse(row.persona_json) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function createSessionRepo(db: Database): SessionRepo {
  const insert = db.query<{ id: number }, [string, number, number]>(
    `INSERT INTO sessions (state, created_at, updated_at)
     VALUES (?, ?, ?) RETURNING id`,
  )
  const select = db.query<SessionRow, [number]>(
    `SELECT * FROM sessions WHERE id = ?`,
  )
  const updState = db.query<unknown, [string, number, number]>(
    `UPDATE sessions SET state = ?, updated_at = ? WHERE id = ?`,
  )
  const updProvider = db.query<unknown, [string, number, number, number]>(
    `UPDATE sessions SET provider = ?, provider_locked_at = ?, updated_at = ?
     WHERE id = ? AND provider IS NULL`,
  )
  const incCalls = db.query<unknown, [number, number]>(
    `UPDATE sessions SET model_calls_made = model_calls_made + 1, updated_at = ?
     WHERE id = ?`,
  )
  const updAllowExtra = db.query<unknown, [number, number, number]>(
    `UPDATE sessions SET allow_extra_usage = ?, updated_at = ? WHERE id = ?`,
  )
  const updHandle = db.query<unknown, [string, number, number]>(
    `UPDATE sessions SET session_handle = ?, updated_at = ? WHERE id = ?`,
  )
  const updActiveResume = db.query<unknown, [number, number, number]>(
    `UPDATE sessions SET active_resume_id = ?, updated_at = ? WHERE id = ?`,
  )
  const updTargetContext = db.query<unknown, [string, number, number]>(
    `UPDATE sessions SET target_context_json = ?, updated_at = ? WHERE id = ?`,
  )
  const updPersona = db.query<unknown, [string, number, number]>(
    `UPDATE sessions SET persona_json = ?, updated_at = ? WHERE id = ?`,
  )

  return {
    create({ state }) {
      const now = Date.now()
      const row = insert.get(state, now, now)
      if (!row) throw new Error('insert returned no row')
      return row.id
    },
    get(id) {
      const row = select.get(id)
      return row ? rowToSession(row) : null
    },
    setState(id, state) {
      updState.run(state, Date.now(), id)
    },
    lockProvider(id, provider) {
      const now = Date.now()
      const result = updProvider.run(provider, now, now, id)
      if (result.changes === 0) {
        throw new Error(`session ${id} already has a locked provider`)
      }
    },
    incrementCalls(id) {
      incCalls.run(Date.now(), id)
    },
    setAllowExtraUsage(id, value) {
      updAllowExtra.run(value ? 1 : 0, Date.now(), id)
    },
    setSessionHandle(id, handle) {
      updHandle.run(handle, Date.now(), id)
    },
    setActiveResume(id, resumeId) {
      updActiveResume.run(resumeId, Date.now(), id)
    },
    setTargetContext(id, ctx) {
      updTargetContext.run(JSON.stringify(ctx), Date.now(), id)
    },
    setPersona(id, persona) {
      updPersona.run(JSON.stringify(persona), Date.now(), id)
    },
    getGatherEnabled(id) {
      const row = db
        .prepare(`SELECT gather_enabled AS g FROM sessions WHERE id = ?`)
        .get(id) as { g: number } | null
      if (!row) throw new Error(`Session not found: ${id}`)
      return row.g === 1
    },
    setGatherEnabled(id, enabled) {
      db.prepare(`UPDATE sessions SET gather_enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id)
    },
  }
}
