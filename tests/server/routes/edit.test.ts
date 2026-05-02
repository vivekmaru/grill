import { describe, it, expect } from 'bun:test'
import { buildTestApp, jsonRequest } from './_helpers'
import { sampleResumeJson, sampleTarget } from './_fixtures'

describe('POST /api/sessions/:id/edit', () => {
  it('updates bullet text via manual edit', async () => {
    const { fetch, stub } = buildTestApp()
    stub.responses.push({ type: 'ok', value: sampleResumeJson })
    const created = await fetch(
      jsonRequest('POST', '/api/sessions', {
        resume: { kind: 'markdown', text: '# Hi' },
        target: sampleTarget,
      }),
    )
    const { id, resume } = (await created.json()) as {
      id: number
      resume: { roles: Array<{ bullets: Array<{ id: string }> }> }
    }
    const bulletId = resume.roles[0]!.bullets[0]!.id

    const res = await fetch(
      jsonRequest('POST', `/api/sessions/${id}/edit`, {
        bulletId,
        newText: 'Manually rewritten by user',
      }),
    )
    expect(res.status).toBe(200)

    const get = await fetch(new Request(`http://localhost/api/sessions/${id}`))
    const body = (await get.json()) as {
      resume: { roles: Array<{ bullets: Array<{ text: string }> }> }
    }
    expect(body.resume.roles[0]!.bullets[0]!.text).toBe(
      'Manually rewritten by user',
    )
  })

  it('returns 400 for missing fields', async () => {
    const { fetch } = buildTestApp()
    const res = await fetch(jsonRequest('POST', '/api/sessions/1/edit', {}))
    expect(res.status).toBe(400)
  })

  it('returns 404 for missing session', async () => {
    const { fetch } = buildTestApp()
    const res = await fetch(
      jsonRequest('POST', '/api/sessions/9999/edit', {
        bulletId: 'x',
        newText: 'y',
      }),
    )
    expect(res.status).toBe(404)
  })
})
