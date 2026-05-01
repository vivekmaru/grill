import type { Database } from 'bun:sqlite'
import { Resume } from '@/schema/resume'

export interface StoredResume {
  id: number
  resume: Resume
  versionName: string
  createdAt: number
}

export interface ResumeRepo {
  create(input: { resume: Resume; versionName: string }): number
  get(id: number): StoredResume | null
  update(id: number, input: { resume: Resume; versionName: string }): void
}

interface ResumeRow {
  id: number
  content_json: string
  version_name: string
  created_at: number
}

export function createResumeRepo(db: Database): ResumeRepo {
  const insert = db.query<{ id: number }, [string, string, number]>(
    `INSERT INTO resumes (content_json, version_name, created_at)
     VALUES (?, ?, ?) RETURNING id`,
  )
  const select = db.query<ResumeRow, [number]>(
    `SELECT id, content_json, version_name, created_at FROM resumes WHERE id = ?`,
  )
  const update = db.query<unknown, [string, string, number]>(
    `UPDATE resumes SET content_json = ?, version_name = ? WHERE id = ?`,
  )

  return {
    create({ resume, versionName }) {
      const parsed = Resume.parse(resume)
      const row = insert.get(JSON.stringify(parsed), versionName, Date.now())
      if (!row) throw new Error('insert returned no row')
      return row.id
    },
    get(id) {
      const row = select.get(id)
      if (!row) return null
      return {
        id: row.id,
        resume: Resume.parse(JSON.parse(row.content_json)),
        versionName: row.version_name,
        createdAt: row.created_at,
      }
    },
    update(id, { resume, versionName }) {
      const parsed = Resume.parse(resume)
      update.run(JSON.stringify(parsed), versionName, id)
    },
  }
}
