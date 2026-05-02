import { describe, it, expect, beforeEach } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { Session } from '@/orchestrator/session'
import { createDb } from '@/server/db/client'
import { createStubAdapter } from './_helpers/stubAdapter'
import type { TargetContext } from '@/schema/target'

describe('Session — construction', () => {
  let db: Database

  beforeEach(() => {
    db = createDb(':memory:')
  })

  it('Session.create persists a session row in ingest state with provider locked', () => {
    const stub = createStubAdapter([])
    const session = Session.create(db, stub.adapter)
    const snap = session.snapshot()
    expect(snap.state).toBe('ingest')
    expect(snap.provider).toBe('claude')
    expect(snap.modelCallsMade).toBe(0)
    expect(snap.allowExtraUsage).toBe(false)
    expect(snap.id).toBeGreaterThan(0)
  })

  it('Session.load fetches an existing session and replays state from history', () => {
    const stub = createStubAdapter([])
    const created = Session.create(db, stub.adapter)
    const id = created.snapshot().id

    const loaded = Session.load(db, stub.adapter, id)
    expect(loaded.snapshot().id).toBe(id)
    expect(loaded.snapshot().state).toBe('ingest')
  })

  it('Session.load throws if the session does not exist', () => {
    const stub = createStubAdapter([])
    expect(() => Session.load(db, stub.adapter, 9999)).toThrow(/not found/)
  })
})

const sampleResumeJson = {
  version: 1,
  contact: { name: 'Vivek Maru', email: 'vivek@example.com', links: [] },
  summary: 'Senior engineer.',
  roles: [
    {
      id: 'will-be-replaced',
      company: 'Acme',
      title: 'Senior Engineer',
      startDate: '2022-01',
      endDate: null,
      bullets: [
        {
          id: 'will-be-replaced',
          text: 'Built CI pipeline',
          status: 'draft',
          metrics: [],
          skills: [],
          flags: [],
          sourceTurnIds: [],
        },
      ],
    },
  ],
  education: [],
  projects: [],
  skills: { categories: [] },
  certifications: [],
}

const sampleTarget: TargetContext = {
  targetRole: 'Staff Engineer',
  targetSeniority: 'staff',
  persona: { archetype: 'engineering-manager', tone: 'skeptical' },
}

describe('Session — setup phase', () => {
  let db: Database

  beforeEach(() => {
    db = createDb(':memory:')
  })

  it('ingestResume parses markdown via adapter and stamps fresh ids', async () => {
    const stub = createStubAdapter([
      { type: 'ok', value: sampleResumeJson },
    ])
    const session = Session.create(db, stub.adapter)
    const resume = await session.ingestResume({
      kind: 'markdown',
      text: '# Vivek\n## Acme\n- Built CI pipeline',
    })
    expect(resume.roles[0]!.id).not.toBe('will-be-replaced')
    expect(resume.roles[0]!.bullets[0]!.id).not.toBe('will-be-replaced')
    expect(stub.calls).toHaveLength(1)
    expect(stub.calls[0]!.userPrompt).toContain('Built CI pipeline')
    expect(session.snapshot().state).toBe('target')
    expect(session.snapshot().modelCallsMade).toBe(1)
  })

  it('ingestResume with kind=blank fires START_BLANK and creates an empty resume', async () => {
    const stub = createStubAdapter([])
    const session = Session.create(db, stub.adapter)
    const resume = await session.ingestResume({ kind: 'blank' })
    expect(resume.roles).toEqual([])
    expect(stub.calls).toHaveLength(0)
    expect(session.snapshot().state).toBe('target')
  })

  it('setTarget persists context+persona and fast-forwards to critique', async () => {
    const stub = createStubAdapter([
      { type: 'ok', value: sampleResumeJson },
    ])
    const session = Session.create(db, stub.adapter)
    await session.ingestResume({ kind: 'markdown', text: '# x' })
    session.setTarget(sampleTarget)
    expect(session.snapshot().state).toBe('critique')
  })

  it('setTarget throws if called from the wrong state', () => {
    const stub = createStubAdapter([])
    const session = Session.create(db, stub.adapter)
    // state is 'ingest', not 'target' — SET_TARGET disallowed
    expect(() => session.setTarget(sampleTarget)).toThrow(/not allowed/)
  })
})
