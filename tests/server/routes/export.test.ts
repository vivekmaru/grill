import { describe, it, expect } from 'bun:test'
import { buildTestApp } from './_helpers'

describe('GET /api/sessions/:id/export.pdf', () => {
  it('returns 501 with stub message', async () => {
    const { fetch } = buildTestApp()
    const res = await fetch(
      new Request('http://localhost/api/sessions/1/export.pdf'),
    )
    expect(res.status).toBe(501)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('export_unavailable')
  })
})
