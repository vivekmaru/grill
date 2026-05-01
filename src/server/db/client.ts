import { Database } from 'bun:sqlite'
import { runMigrations } from './migrations'

export function createDb(path: string): Database {
  const db = new Database(path, { create: true })
  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA foreign_keys = ON')
  runMigrations(db)
  return db
}
