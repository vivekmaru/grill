import { describe, it, expect, beforeEach } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { Session } from '@/orchestrator/session'
import { createDb } from '@/server/db/client'
import { createStubAdapter } from './_helpers/stubAdapter'
import type { TargetContext } from '@/schema/target'

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

async function setupSessionInGather(db: Database) {
  const stub = createStubAdapter([{ type: 'ok', value: sampleResumeJson }])
  const session = Session.create(db, stub.adapter)
  await session.ingestResume({ kind: 'markdown', text: '# x' })
  session.setTarget(sampleTarget)
  const roleId = session.currentResume().roles[0]!.id
  return { session, stub, roleId }
}

describe('Session — gather phase', () => {
  let db: Database

  beforeEach(() => {
    db = createDb(':memory:')
  })

  it('setTarget with default gather_enabled leaves session in gather state', async () => {
    const { session } = await setupSessionInGather(db)
    expect(session.snapshot().state).toBe('gather')
  })

  it('setTarget with gather_enabled=false fast-forwards to critique (legacy)', async () => {
    const stub = createStubAdapter([{ type: 'ok', value: sampleResumeJson }])
    const session = Session.create(db, stub.adapter)
    await session.ingestResume({ kind: 'markdown', text: '# x' })
    session.setGatherEnabled(false)
    session.setTarget(sampleTarget)
    expect(session.snapshot().state).toBe('critique')
  })

  it('first nextGatherQuestion returns a broad question and increments budget', async () => {
    const { session, stub, roleId } = await setupSessionInGather(db)
    const callsBefore = session.snapshot().modelCallsMade
    stub.responses.push({ type: 'ok', value: { question: 'What did you actually build at Acme?' } })

    const result = await session.nextGatherQuestion({ roleId })

    expect(result.kind).toBe('broad')
    if (result.kind === 'broad') {
      expect(result.question).toBe('What did you actually build at Acme?')
      expect(result.turnId).toBeGreaterThan(0)
    }
    expect(session.snapshot().modelCallsMade).toBe(callsBefore + 1)
  })

  it('recordGatherAnswer persists the answer onto the turn', async () => {
    const { session, stub, roleId } = await setupSessionInGather(db)
    stub.responses.push({ type: 'ok', value: { question: 'broad q' } })
    const broad = await session.nextGatherQuestion({ roleId })
    if (broad.kind !== 'broad') throw new Error('expected broad')

    session.recordGatherAnswer({ turnId: broad.turnId, answer: 'I led a team of 5' })

    // Next call must read prior answer back to render the followup prompt
    stub.responses.push({ type: 'ok', value: { done: false, followUp: 'how big was the team?', trigger: 'scope' } })
    const fu = await session.nextGatherQuestion({ roleId })
    expect(fu.kind).toBe('followup')
    expect(stub.calls.at(-1)!.userPrompt).toContain('I led a team of 5')
  })

  it('returns a followup when adapter says done=false', async () => {
    const { session, stub, roleId } = await setupSessionInGather(db)
    stub.responses.push({ type: 'ok', value: { question: 'broad q' } })
    const broad = await session.nextGatherQuestion({ roleId })
    if (broad.kind !== 'broad') throw new Error('expected broad')
    session.recordGatherAnswer({ turnId: broad.turnId, answer: 'short answer' })

    stub.responses.push({ type: 'ok', value: { done: false, followUp: 'how big?', trigger: 'scope' } })
    const fu = await session.nextGatherQuestion({ roleId })

    expect(fu.kind).toBe('followup')
    if (fu.kind === 'followup') {
      expect(fu.question).toBe('how big?')
    }
  })

  it('returns done after MAX_FOLLOWUPS_PER_ROLE without calling the adapter', async () => {
    const { session, stub, roleId } = await setupSessionInGather(db)
    // broad
    stub.responses.push({ type: 'ok', value: { question: 'broad q' } })
    const broad = await session.nextGatherQuestion({ roleId })
    if (broad.kind !== 'broad') throw new Error('expected broad')
    session.recordGatherAnswer({ turnId: broad.turnId, answer: 'a' })

    // followup 1
    stub.responses.push({ type: 'ok', value: { done: false, followUp: 'fu1', trigger: 'scope' } })
    const fu1 = await session.nextGatherQuestion({ roleId })
    if (fu1.kind !== 'followup') throw new Error('expected followup')
    session.recordGatherAnswer({ turnId: fu1.turnId, answer: 'b' })

    // followup 2 — at the cap
    stub.responses.push({ type: 'ok', value: { done: false, followUp: 'fu2', trigger: 'outcome' } })
    const fu2 = await session.nextGatherQuestion({ roleId })
    if (fu2.kind !== 'followup') throw new Error('expected followup')
    session.recordGatherAnswer({ turnId: fu2.turnId, answer: 'c' })

    const callsBeforeCapHit = session.snapshot().modelCallsMade
    const callCountBefore = stub.calls.length

    // Third call: cap reached — should return done without invoking adapter
    const done = await session.nextGatherQuestion({ roleId })

    expect(done.kind).toBe('done')
    if (done.kind === 'done') {
      expect(done.reason).toContain('cap')
    }
    expect(session.snapshot().modelCallsMade).toBe(callsBeforeCapHit) // budget unchanged
    expect(stub.calls.length).toBe(callCountBefore) // no adapter call
  })

  it('endGather transitions state to critique', async () => {
    const { session } = await setupSessionInGather(db)
    expect(session.snapshot().state).toBe('gather')
    session.endGather()
    expect(session.snapshot().state).toBe('critique')
  })

  it('skipGatherRole records a skip turn', async () => {
    const { session, roleId } = await setupSessionInGather(db)
    session.skipGatherRole({ roleId })
    // No direct getter exposed on Session for raw turns; verify via re-asking:
    // skipping does not satisfy the "hasBroad" check, so a follow-up ask should
    // still attempt a broad. We don't assert on internals beyond that calling
    // skip does not throw.
    expect(session.snapshot().state).toBe('gather')
  })

  it('nextGatherQuestion throws if not in gather state', async () => {
    const { session } = await setupSessionInGather(db)
    session.endGather()
    expect(session.nextGatherQuestion({ roleId: 'r1' })).rejects.toThrow(/not allowed/)
  })
})
