import { describe, it, expect, beforeEach } from 'bun:test'
import { createDb } from '@/server/db/client'
import { createSessionRepo, type SessionRepo } from '@/server/db/repositories/sessions'

describe('SessionRepo', () => {
  let repo: SessionRepo

  beforeEach(() => {
    const db = createDb(':memory:')
    repo = createSessionRepo(db)
  })

  it('creates a session in the ingest state with no provider', () => {
    const id = repo.create({ state: 'ingest' })
    const s = repo.get(id)
    expect(s?.state).toBe('ingest')
    expect(s?.provider).toBeNull()
    expect(s?.modelCallsMade).toBe(0)
    expect(s?.allowExtraUsage).toBe(false)
  })

  it('locks a provider exactly once', () => {
    const id = repo.create({ state: 'ingest' })
    repo.lockProvider(id, 'claude')
    const s = repo.get(id)
    expect(s?.provider).toBe('claude')
    expect(s?.providerLockedAt).not.toBeNull()
  })

  it('refuses to overwrite a locked provider', () => {
    const id = repo.create({ state: 'ingest' })
    repo.lockProvider(id, 'claude')
    expect(() => repo.lockProvider(id, 'gemini')).toThrow(/locked/)
  })

  it('increments modelCallsMade atomically', () => {
    const id = repo.create({ state: 'ingest' })
    repo.incrementCalls(id)
    repo.incrementCalls(id)
    expect(repo.get(id)?.modelCallsMade).toBe(2)
  })

  it('updates state', () => {
    const id = repo.create({ state: 'ingest' })
    repo.setState(id, 'gather')
    expect(repo.get(id)?.state).toBe('gather')
  })

  it('sets allowExtraUsage', () => {
    const id = repo.create({ state: 'ingest' })
    repo.setAllowExtraUsage(id, true)
    expect(repo.get(id)?.allowExtraUsage).toBe(true)
  })

  it('setTargetContext stores and retrieves the JSON blob', () => {
    const id = repo.create({ state: 'ingest' })
    const ctx = {
      targetRole: 'Staff Engineer',
      targetSeniority: 'staff',
      persona: { archetype: 'engineering-manager', tone: 'skeptical' },
    }
    repo.setTargetContext(id, ctx)
    expect(repo.get(id)?.targetContext).toEqual(ctx)
  })

  it('setPersona stores and retrieves the persona', () => {
    const id = repo.create({ state: 'ingest' })
    const persona = { archetype: 'vp-product', tone: 'curious' }
    repo.setPersona(id, persona)
    expect(repo.get(id)?.persona).toEqual(persona)
  })

  it('initial get returns null for targetContext and persona', () => {
    const id = repo.create({ state: 'ingest' })
    const s = repo.get(id)
    expect(s?.targetContext).toBeNull()
    expect(s?.persona).toBeNull()
  })
})
