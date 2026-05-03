import { describe, it, expect, afterEach } from 'bun:test'
import { ensureDom } from './_dom'

ensureDom()

import {
  askGatherQuestion,
  recordGatherAnswer,
  skipGatherRole,
  endGather,
} from '@/client/lib/api'

const realFetch = globalThis.fetch

describe('gather API client', () => {
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('askGatherQuestion POSTs to .../ask and parses the response', async () => {
    const captured = { url: '', method: '' }
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured.url = url
      captured.method = init?.method ?? ''
      return new Response(
        JSON.stringify({ kind: 'broad', turnId: 5, question: 'q?' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    const res = await askGatherQuestion({ sessionId: 1, roleId: 'r1' })
    expect(captured.url).toBe('/api/sessions/1/gather/role/r1/ask')
    expect(captured.method).toBe('POST')
    expect(res.kind).toBe('broad')
  })

  it('recordGatherAnswer POSTs body to .../answer', async () => {
    const captured: { url: string; body: unknown } = { url: '', body: null }
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured.url = url
      captured.body = JSON.parse(String(init.body))
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    await recordGatherAnswer({ sessionId: 1, roleId: 'r1', turnId: 5, answer: 'hello' })
    expect(captured.url).toBe('/api/sessions/1/gather/role/r1/answer')
    expect(captured.body).toEqual({ turnId: 5, answer: 'hello' })
  })

  it('skipGatherRole POSTs to .../skip', async () => {
    let captured = ''
    globalThis.fetch = (async (url: string) => {
      captured = url
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    await skipGatherRole({ sessionId: 1, roleId: 'r1' })
    expect(captured).toBe('/api/sessions/1/gather/role/r1/skip')
  })

  it('endGather POSTs to .../end and returns snapshot', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ snapshot: { id: 1, state: 'critique', provider: 'codex', modelCallsMade: 1 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch

    const res = await endGather({ sessionId: 1 })
    expect(res.snapshot.state).toBe('critique')
  })

  it('throws ApiError on non-2xx', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { code: 'state_conflict', message: 'not in gather' } }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch

    await expect(askGatherQuestion({ sessionId: 1, roleId: 'r1' })).rejects.toMatchObject({
      status: 409,
      code: 'state_conflict',
    })
  })
})
