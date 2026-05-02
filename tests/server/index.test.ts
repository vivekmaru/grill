import { describe, it, expect } from 'bun:test'
import { createApp } from '@/server/index'
import { createDb } from '@/server/db/client'
import { createStubAdapter } from '../orchestrator/_helpers/stubAdapter'

function makeApp() {
  return createApp({ db: createDb(':memory:'), adapter: createStubAdapter([]).adapter })
}

describe('app', () => {
  it('responds 200 on /healthz with shape { ok: true, version: string }', async () => {
    const app = makeApp()
    const res = await app.request('/healthz')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; version: string }
    expect(body.ok).toBe(true)
    expect(typeof body.version).toBe('string')
  })

  it('returns 404 on unknown routes', async () => {
    const app = makeApp()
    const res = await app.request('/nope')
    expect(res.status).toBe(404)
  })
})
