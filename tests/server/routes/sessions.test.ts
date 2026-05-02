import { describe, it, expect } from 'bun:test'
import { buildTestApp } from './_helpers'

describe('createApp', () => {
  it('returns a Hono app and accepts AppDeps', async () => {
    const { fetch } = buildTestApp()
    const res = await fetch(new Request('http://localhost/healthz'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})
