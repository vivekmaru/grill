import { describe, it, expect } from 'bun:test'
import { buildTestApp, jsonRequest } from './_helpers'
import { sampleResumeJson, sampleTarget } from './_fixtures'
import { Session } from '@/orchestrator/session'

async function setupSessionInGather(app: ReturnType<typeof buildTestApp>) {
  app.stub.responses.push({ type: 'ok', value: sampleResumeJson })
  const session = Session.create(app.db, app.stub.adapter)
  await session.ingestResume({ kind: 'markdown', text: '# x' })
  session.setTarget(sampleTarget)
  expect(session.snapshot().state).toBe('gather')
  const id = session.snapshot().id
  const roleId = session.currentResume().roles[0]!.id
  return { id, roleId }
}

describe('POST /api/sessions/:id/gather/role/:roleId/ask', () => {
  it('returns a broad question for a fresh role', async () => {
    const app = buildTestApp()
    const { id, roleId } = await setupSessionInGather(app)
    app.stub.responses.push({ type: 'ok', value: { question: 'What did you build at Acme?' } })

    const res = await app.fetch(
      jsonRequest('POST', `/api/sessions/${id}/gather/role/${roleId}/ask`),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { kind: string; question: string; turnId: number }
    expect(body.kind).toBe('broad')
    expect(body.question).toBe('What did you build at Acme?')
    expect(body.turnId).toBeGreaterThan(0)
  })

  it('returns 409 when session is not in gather state', async () => {
    const app = buildTestApp()
    const { id, roleId } = await setupSessionInGather(app)
    // End gather → state moves to 'critique'
    await app.fetch(jsonRequest('POST', `/api/sessions/${id}/gather/end`))

    const res = await app.fetch(
      jsonRequest('POST', `/api/sessions/${id}/gather/role/${roleId}/ask`),
    )
    expect(res.status).toBe(409)
  })

  it('returns 404 for missing session', async () => {
    const app = buildTestApp()
    const res = await app.fetch(
      jsonRequest('POST', `/api/sessions/9999/gather/role/r1/ask`),
    )
    expect(res.status).toBe(404)
  })
})

describe('POST /api/sessions/:id/gather/role/:roleId/answer', () => {
  it('records the answer and returns ok', async () => {
    const app = buildTestApp()
    const { id, roleId } = await setupSessionInGather(app)
    app.stub.responses.push({ type: 'ok', value: { question: 'broad q' } })
    const askRes = await app.fetch(
      jsonRequest('POST', `/api/sessions/${id}/gather/role/${roleId}/ask`),
    )
    const ask = (await askRes.json()) as { turnId: number }

    const res = await app.fetch(
      jsonRequest('POST', `/api/sessions/${id}/gather/role/${roleId}/answer`, {
        turnId: ask.turnId,
        answer: 'I led a team of 5',
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  it('returns 400 for invalid body', async () => {
    const app = buildTestApp()
    const { id, roleId } = await setupSessionInGather(app)
    const res = await app.fetch(
      jsonRequest('POST', `/api/sessions/${id}/gather/role/${roleId}/answer`, {}),
    )
    expect(res.status).toBe(400)
  })
})

describe('POST /api/sessions/:id/gather/role/:roleId/skip', () => {
  it('returns ok without invoking the adapter', async () => {
    const app = buildTestApp()
    const { id, roleId } = await setupSessionInGather(app)
    const beforeCalls = app.stub.calls.length

    const res = await app.fetch(
      jsonRequest('POST', `/api/sessions/${id}/gather/role/${roleId}/skip`),
    )
    expect(res.status).toBe(200)
    expect(app.stub.calls.length).toBe(beforeCalls) // no adapter call
  })
})

describe('POST /api/sessions/:id/gather/end', () => {
  it('transitions state to critique', async () => {
    const app = buildTestApp()
    const { id } = await setupSessionInGather(app)

    const res = await app.fetch(jsonRequest('POST', `/api/sessions/${id}/gather/end`))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { snapshot: { state: string } }
    expect(body.snapshot.state).toBe('critique')
  })

  it('returns 409 when not in gather state', async () => {
    const app = buildTestApp()
    const { id } = await setupSessionInGather(app)
    await app.fetch(jsonRequest('POST', `/api/sessions/${id}/gather/end`))

    const res = await app.fetch(jsonRequest('POST', `/api/sessions/${id}/gather/end`))
    expect(res.status).toBe(409)
  })
})
