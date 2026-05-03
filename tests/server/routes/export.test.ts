import { describe, it, expect } from 'bun:test'
import { buildTestApp, jsonRequest } from './_helpers'
import { sampleResumeJson, sampleTarget } from './_fixtures'

describe('GET /api/sessions/:id/export.pdf', () => {
  it('returns an ATS PDF for an existing session', async () => {
    const { fetch, stub } = buildTestApp()
    stub.responses.push({ type: 'ok', value: sampleResumeJson })
    const created = await fetch(
      jsonRequest('POST', '/api/sessions', {
        resume: { kind: 'markdown', text: '# Hi' },
        target: sampleTarget,
      }),
    )
    const { id } = (await created.json()) as { id: number }

    const res = await fetch(
      new Request(`http://localhost/api/sessions/${id}/export.pdf`),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    const bytes = new Uint8Array(await res.arrayBuffer())
    const header = new TextDecoder().decode(bytes.slice(0, 8))
    expect(header).toBe('%PDF-1.4')
  })

  it('returns existing mapped error behavior for a missing session', async () => {
    const { fetch } = buildTestApp()
    const res = await fetch(
      new Request('http://localhost/api/sessions/1/export.pdf'),
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('session_not_found')
  })
})
