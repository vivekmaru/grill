import { describe, it, expect } from 'bun:test'
import { buildTestApp, jsonRequest } from './_helpers'
import { sampleResumeJson, sampleTarget } from './_fixtures'

describe('POST /api/sessions/:id/end', () => {
  it('transitions to generate state', async () => {
    const { fetch, stub } = buildTestApp()
    stub.responses.push({ type: 'ok', value: sampleResumeJson })
    const created = await fetch(
      jsonRequest('POST', '/api/sessions', {
        resume: { kind: 'markdown', text: '# Hi' },
        target: sampleTarget,
      }),
    )
    const { id } = (await created.json()) as { id: number }

    const res = await fetch(jsonRequest('POST', `/api/sessions/${id}/end`, {}))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { snapshot: { state: string } }
    expect(body.snapshot.state).toBe('generate')
  })

  it('returns 409 if state does not allow end', async () => {
    const { fetch, stub } = buildTestApp()
    stub.responses.push({ type: 'ok', value: sampleResumeJson })
    const created = await fetch(
      jsonRequest('POST', '/api/sessions', {
        resume: { kind: 'markdown', text: '# Hi' },
        target: sampleTarget,
      }),
    )
    const { id } = (await created.json()) as { id: number }

    await fetch(jsonRequest('POST', `/api/sessions/${id}/end`, {}))
    const res = await fetch(jsonRequest('POST', `/api/sessions/${id}/end`, {}))
    expect(res.status).toBe(409)
  })

  it('returns 404 for missing session', async () => {
    const { fetch } = buildTestApp()
    const res = await fetch(jsonRequest('POST', '/api/sessions/9999/end', {}))
    expect(res.status).toBe(404)
  })
})
