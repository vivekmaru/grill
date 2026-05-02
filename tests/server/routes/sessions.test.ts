import { describe, it, expect } from 'bun:test'
import { buildTestApp, jsonRequest } from './_helpers'
import { sampleResumeJson, sampleTarget } from './_fixtures'

describe('createApp', () => {
  it('returns a Hono app and accepts AppDeps', async () => {
    const { fetch } = buildTestApp()
    const res = await fetch(new Request('http://localhost/healthz'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})

describe('POST /api/sessions', () => {
  it('creates a session, ingests resume, sets target — returns snapshot + resume', async () => {
    const { fetch, stub } = buildTestApp()
    stub.responses.push({ type: 'ok', value: sampleResumeJson })

    const res = await fetch(
      jsonRequest('POST', '/api/sessions', {
        resume: { kind: 'markdown', text: '# Hi' },
        target: sampleTarget,
      }),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      id: number
      snapshot: { state: string; provider: string }
      resume: { roles: Array<{ bullets: unknown[] }> }
    }
    expect(body.id).toBeGreaterThan(0)
    expect(body.snapshot.state).toBe('critique')
    expect(body.snapshot.provider).toBe('claude')
    expect(body.resume.roles).toHaveLength(1)
  })

  it('returns 400 on invalid body', async () => {
    const { fetch } = buildTestApp()
    const res = await fetch(jsonRequest('POST', '/api/sessions', { resume: {} }))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('validation')
  })

  it('returns 500 if adapter fails during ingest', async () => {
    const { fetch, stub } = buildTestApp()
    stub.responses.push({ type: 'error', error: new Error('adapter down') })
    const res = await fetch(
      jsonRequest('POST', '/api/sessions', {
        resume: { kind: 'markdown', text: '# Hi' },
        target: sampleTarget,
      }),
    )
    expect(res.status).toBe(500)
  })
})

describe('GET /api/sessions/:id', () => {
  it('returns snapshot + resume for an existing session', async () => {
    const { fetch, stub } = buildTestApp()
    stub.responses.push({ type: 'ok', value: sampleResumeJson })
    const created = await fetch(
      jsonRequest('POST', '/api/sessions', {
        resume: { kind: 'markdown', text: '# Hi' },
        target: sampleTarget,
      }),
    )
    const { id } = (await created.json()) as { id: number }

    const res = await fetch(new Request(`http://localhost/api/sessions/${id}`))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { snapshot: { id: number }; resume: unknown }
    expect(body.snapshot.id).toBe(id)
    expect(body.resume).toBeDefined()
  })

  it('returns 404 for missing session', async () => {
    const { fetch } = buildTestApp()
    const res = await fetch(new Request('http://localhost/api/sessions/9999'))
    expect(res.status).toBe(404)
  })

  it('returns 400 for non-numeric id', async () => {
    const { fetch } = buildTestApp()
    const res = await fetch(new Request('http://localhost/api/sessions/abc'))
    expect(res.status).toBe(400)
  })
})
