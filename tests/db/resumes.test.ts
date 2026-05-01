import { describe, it, expect, beforeEach } from 'bun:test'
import { createDb } from '@/server/db/client'
import { createResumeRepo, type ResumeRepo } from '@/server/db/repositories/resumes'
import type { Resume } from '@/schema/resume'

const sample: Resume = {
  version: 1,
  contact: { name: 'V', links: [] },
  roles: [],
  education: [],
  projects: [],
  skills: { categories: [] },
  certifications: [],
}

describe('ResumeRepo', () => {
  let repo: ResumeRepo

  beforeEach(() => {
    const db = createDb(':memory:')
    repo = createResumeRepo(db)
  })

  it('creates and reads back a resume', () => {
    const id = repo.create({ resume: sample, versionName: 'v1' })
    const fetched = repo.get(id)
    expect(fetched?.resume.contact.name).toBe('V')
    expect(fetched?.versionName).toBe('v1')
  })

  it('returns null for missing id', () => {
    expect(repo.get(999)).toBeNull()
  })

  it('updates an existing resume', () => {
    const id = repo.create({ resume: sample, versionName: 'v1' })
    const next: Resume = { ...sample, contact: { ...sample.contact, name: 'V2' } }
    repo.update(id, { resume: next, versionName: 'v1.1' })
    expect(repo.get(id)?.resume.contact.name).toBe('V2')
    expect(repo.get(id)?.versionName).toBe('v1.1')
  })
})
