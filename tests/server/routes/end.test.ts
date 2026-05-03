import { describe, it, expect } from 'bun:test'
import { buildTestApp, jsonRequest } from './_helpers'
import { sampleResumeJson, sampleTarget } from './_fixtures'

describe('POST /api/sessions/:id/end', () => {
  it('transitions to generate state', async () => {
    const { fetch, stub } = buildTestApp()
    stub.responses.push({ type: 'ok', value: sampleResumeJson })
    stub.responses.push({
      type: 'ok',
      value: { verdict: 'ready', summary: 'Ready to export.', remainingRisks: [] },
    })
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
    stub.responses.push({
      type: 'ok',
      value: { verdict: 'ready', summary: 'Ready to export.', remainingRisks: [] },
    })
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

  it('returns 409 while blocking flags are unresolved', async () => {
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
    stub.responses.push({
      type: 'ok',
      value: {
        flags: [
          {
            bulletId,
            flag: 'vague',
            severity: 2,
            span: 'CI pipeline',
            why: 'Generic.',
            suggestedQuestion: 'What changed?',
          },
        ],
        passSummary: { bulletsScanned: 1, bulletsFlagged: 1, topConcern: '' },
      },
    })
    const critique = await fetch(
      jsonRequest('POST', `/api/sessions/${id}/critique`, {}),
    )
    const reader = critique.body!.getReader()
    while (!(await reader.read()).done) {
      /* drain */
    }

    const res = await fetch(jsonRequest('POST', `/api/sessions/${id}/end`, {}))
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('final_review_blocked')
  })

  it('returns 404 for missing session', async () => {
    const { fetch } = buildTestApp()
    const res = await fetch(jsonRequest('POST', '/api/sessions/9999/end', {}))
    expect(res.status).toBe(404)
  })
})
