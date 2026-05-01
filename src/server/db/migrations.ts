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
]

export function runMigrations(db: Database): void {
  for (const stmt of STATEMENTS) {
    db.run(stmt)
  }
}
