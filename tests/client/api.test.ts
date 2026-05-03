import { describe, it, expect, afterEach } from 'bun:test'
import { ensureDom } from './_dom'

ensureDom()

import { createSession } from '@/client/lib/api'
import { sampleResumeJson } from '../server/routes/_fixtures'

const realFetch = globalThis.fetch

describe('createSession', () => {
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('POSTs JSON to /api/sessions and returns parsed response', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(
        JSON.stringify({
          id: 7,
          snapshot: { state: 'critique', modelCallsMade: 1 },
          resume: sampleResumeJson,
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    const res = await createSession({
      resume: { kind: 'markdown', text: '# hi' },
      target: {
        targetRole: 'Engineer',
        targetSeniority: 'senior',
        persona: { archetype: 'engineering-manager', tone: 'skeptical' },
      },
    })

    expect(captured!.url).toBe('/api/sessions')
    expect(captured!.init.method).toBe('POST')
    expect(res.id).toBe(7)
    expect(res.snapshot.state).toBe('critique')
  })

  it('throws ApiError with status + code on 4xx', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { code: 'validation', message: 'bad' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch

    await expect(
      createSession({
        resume: { kind: 'markdown', text: '# placeholder' },
        target: {
          targetRole: 'Engineer',
          targetSeniority: 'senior',
          persona: { archetype: 'engineering-manager', tone: 'skeptical' },
        },
      }),
    ).rejects.toMatchObject({ status: 400, code: 'validation' })
  })
})
