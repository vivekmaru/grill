import { describe, it, expect } from 'bun:test'
import { z } from 'zod'
import { Hono } from 'hono'
import { respondWithError } from '@/server/errors'
import { BudgetExceededError } from '@/orchestrator/budget'
import { EvidencedFlagNotSupportedError } from '@/orchestrator/session'

async function invokeWith(
  error: unknown,
): Promise<{ status: number; body: { error: { code: string; [k: string]: unknown } } }> {
  const app = new Hono()
  app.get('/x', (c) => respondWithError(c, error))
  const res = await app.fetch(new Request('http://localhost/x'))
  return {
    status: res.status,
    body: (await res.json()) as { error: { code: string } },
  }
}

describe('respondWithError', () => {
  it('maps ZodError to 400 with issues', async () => {
    const result = z.object({ a: z.string() }).safeParse({})
    if (result.success) throw new Error('expected ZodError')
    const { status, body } = await invokeWith(result.error)
    expect(status).toBe(400)
    expect(body.error.code).toBe('validation')
    expect(Array.isArray(body.error.issues)).toBe(true)
  })

  it('maps BudgetExceededError to 429', async () => {
    const { status, body } = await invokeWith(new BudgetExceededError(3, 3))
    expect(status).toBe(429)
    expect(body.error.code).toBe('budget_exceeded')
    expect(body.error.made).toBe(3)
    expect(body.error.max).toBe(3)
  })

  it('maps EvidencedFlagNotSupportedError to 422', async () => {
    const { status, body } = await invokeWith(
      new EvidencedFlagNotSupportedError('unverified'),
    )
    expect(status).toBe(422)
    expect(body.error.code).toBe('evidenced_flag_not_supported')
    expect(body.error.flag).toBe('unverified')
  })

  it('maps "not allowed" reducer error to 409', async () => {
    const { status, body } = await invokeWith(
      new Error('event FOO not allowed in state ingest'),
    )
    expect(status).toBe(409)
    expect(body.error.code).toBe('state_conflict')
  })

  it('maps "Session not found" to 404', async () => {
    const { status, body } = await invokeWith(
      new Error('Session not found: id=99'),
    )
    expect(status).toBe(404)
    expect(body.error.code).toBe('session_not_found')
  })

  it('maps unknown error to 500', async () => {
    const { status, body } = await invokeWith(new Error('whatever'))
    expect(status).toBe(500)
    expect(body.error.code).toBe('internal')
  })

  it('maps non-Error throwable to 500', async () => {
    const { status, body } = await invokeWith('plain string')
    expect(status).toBe(500)
    expect(body.error.code).toBe('internal')
  })
})
