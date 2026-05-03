import type { Database } from 'bun:sqlite'

const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS resumes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_json TEXT NOT NULL,
    version_name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_context_json TEXT,
    persona_json TEXT,
    provider TEXT,
    provider_locked_at INTEGER,
    active_resume_id INTEGER,
    state TEXT NOT NULL,
    model_calls_made INTEGER NOT NULL DEFAULT 0,
    allow_extra_usage INTEGER NOT NULL DEFAULT 0,
    session_handle TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (active_resume_id) REFERENCES resumes(id)
  )`,
  `CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    event_type TEXT NOT NULL,
    content_json TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_history_session ON history(session_id, timestamp)`,
  `CREATE TABLE IF NOT EXISTS model_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    template_name TEXT NOT NULL,
    provider TEXT NOT NULL,
    tier TEXT NOT NULL,
    tokens_in_estimate INTEGER,
    tokens_out_estimate INTEGER,
    latency_ms INTEGER,
    validation_failures INTEGER NOT NULL DEFAULT 0,
    verifier_rejections INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_modelcalls_session ON model_calls(session_id)`,
  `CREATE TABLE IF NOT EXISTS gather_turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    role_id TEXT NOT NULL,
    turn_kind TEXT NOT NULL CHECK (turn_kind IN ('broad', 'followup', 'skip', 'done')),
    question TEXT,
    answer TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_gather_turns_session_role
    ON gather_turns(session_id, role_id, created_at)`,
]

// ALTER TABLE statements that are idempotent via try/catch (SQLite has no IF NOT EXISTS for ADD COLUMN)
const ALTER_STATEMENTS: readonly string[] = [
  `ALTER TABLE sessions ADD COLUMN gather_enabled INTEGER NOT NULL DEFAULT 1`,
]

export function runMigrations(db: Database): void {
  for (const stmt of STATEMENTS) {
    db.run(stmt)
  }
  for (const stmt of ALTER_STATEMENTS) {
    try {
      db.run(stmt)
    } catch (e: unknown) {
      // Ignore "duplicate column" errors — column already exists from a prior migration run
      const msg = e instanceof Error ? e.message : String(e)
      if (!msg.includes('duplicate column')) throw e
    }
  }
}
