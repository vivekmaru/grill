import { describe, it, expect } from 'bun:test'
import { buildTestApp } from './_helpers'

describe('GET /api/providers', () => {
  it('returns available providers and default', async () => {
    const app = buildTestApp()
    const res = await app.fetch(new Request('http://localhost/api/providers'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { available: string[]; default: string }
    expect(body.available).toContain('codex')
    expect(body.available).toContain('claude')
    expect(body.default).toBe('codex')
  })

  it('available list reflects what is in the adapters map', async () => {
    const app = buildTestApp()
    const res = await app.fetch(new Request('http://localhost/api/providers'))
    const body = (await res.json()) as { available: string[] }
    expect(body.available).toHaveLength(2)
  })
})
