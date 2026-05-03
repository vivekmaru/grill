import { describe, it, expect, afterEach } from 'bun:test'
import { ensureDom } from './_dom'

ensureDom()

// @ts-ignore React test environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SessionScreen } from '@/client/screens/SessionScreen'
import type { Resume } from '@/schema/resume'

const realFetch = globalThis.fetch

const resume: Resume = {
  version: 1,
  contact: { name: 'Jane Doe', email: 'jane@example.com', links: [] },
  summary: 'Senior engineer.',
  roles: [
    {
      id: 'r1',
      company: 'Acme',
      title: 'Senior Engineer',
      startDate: '2021-01',
      endDate: null,
      bullets: [
        {
          id: 'b1',
          text: 'Built CI pipeline',
          metrics: [],
          skills: [],
          flags: [],
          sourceTurnIds: [],
          status: 'draft',
        },
      ],
    },
  ],
  education: [],
  projects: [],
  skills: { categories: [] },
  certifications: [],
}

function sseResponse(): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const events = [
        {
          event: 'started',
          data: { type: 'started', sessionId: 1, timestamp: 1 },
        },
        {
          event: 'flag',
          data: {
            type: 'flag',
            bulletId: 'b1',
            flag: {
              flag: 'vague',
              severity: 2,
              span: 'CI pipeline',
              why: 'Generic.',
              suggestedQuestion: 'What changed?',
              dismissed: false,
              dismissedAt: null,
            },
          },
        },
        {
          event: 'done',
          data: { type: 'done', flagCount: 1, durationMs: 10 },
        },
      ]
      for (const evt of events) {
        controller.enqueue(
          encoder.encode(
            `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`,
          ),
        )
      }
      controller.close()
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

async function mount(): Promise<Root> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <SessionScreen sessionId={1} />
      </QueryClientProvider>,
    )
  })
  return root
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30))
  })
}

describe('<SessionScreen />', () => {
  afterEach(() => {
    globalThis.fetch = realFetch
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild)
  })

  it('fetches the session, consumes SSE critique events, and renders flags', async () => {
    const urls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      urls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url === '/api/sessions/1') {
        return new Response(
          JSON.stringify({
            snapshot: { id: 1, state: 'critique', provider: 'codex', modelCallsMade: 1 },
            resume,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url === '/api/sessions/1/critique') return sseResponse()
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch

    await mount()
    await flush()
    await act(async () => {
      ;(document.querySelector('button[data-testid="run-critique"]') as HTMLButtonElement).click()
    })
    await flush()

    expect(urls).toContain('GET /api/sessions/1')
    expect(urls).toContain('POST /api/sessions/1/critique')
    expect(document.body.textContent).toContain('Resume Preview')
    expect(document.body.textContent).toContain('Built CI pipeline')
    expect(document.body.textContent).toContain('Generic.')
  })

  it('calls accept, skip, dismiss, rewrite, edit, and end routes', async () => {
    const calls: Array<{ method: string; url: string }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      calls.push({ method, url })
      if (url === '/api/sessions/1') {
        return new Response(
          JSON.stringify({
            snapshot: { id: 1, state: 'critique', provider: 'codex', modelCallsMade: 1 },
            resume: {
              ...resume,
              roles: [
                {
                  ...resume.roles[0]!,
                  bullets: [
                    {
                      ...resume.roles[0]!.bullets[0]!,
                      flags: [
                        {
                          flag: 'vague',
                          severity: 2,
                          span: 'CI pipeline',
                          why: 'Generic.',
                          suggestedQuestion: 'What changed?',
                          dismissed: false,
                          dismissedAt: null,
                        },
                        {
                          flag: 'passive',
                          severity: 2,
                          span: 'Built',
                          why: 'Passive.',
                          suggestedQuestion: 'Who owned it?',
                          dismissed: false,
                          dismissedAt: null,
                        },
                        {
                          flag: 'length',
                          severity: 1,
                          span: 'Built CI pipeline',
                          why: 'Long.',
                          suggestedQuestion: 'Can it be shorter?',
                          dismissed: false,
                          dismissedAt: null,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/rewrite')) {
        return new Response(
          JSON.stringify({ candidates: [{ text: 'Rewrite A', evidenceMap: [] }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ ok: true, snapshot: { state: 'done' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    await mount()
    await flush()

    for (const id of [
      'rewrite-b1-0',
      'accept-b1-0',
      'skip-b1-1',
      'dismiss-b1-2',
      'edit-b1',
      'end-session',
    ]) {
      await act(async () => {
        ;(document.querySelector(`button[data-testid="${id}"]`) as HTMLButtonElement).click()
      })
      await flush()
    }

    expect(calls).toContainEqual({
      method: 'POST',
      url: '/api/sessions/1/bullets/b1/flags/0/accept',
    })
    expect(calls).toContainEqual({
      method: 'POST',
      url: '/api/sessions/1/bullets/b1/flags/1/skip',
    })
    expect(calls).toContainEqual({
      method: 'POST',
      url: '/api/sessions/1/bullets/b1/flags/2/dismiss',
    })
    expect(calls).toContainEqual({
      method: 'POST',
      url: '/api/sessions/1/bullets/b1/flags/0/rewrite',
    })
    expect(calls).toContainEqual({ method: 'POST', url: '/api/sessions/1/edit' })
    expect(calls).toContainEqual({ method: 'POST', url: '/api/sessions/1/end' })
  })

  it('hides processed flags and exposes PDF export', async () => {
    let getCount = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/sessions/1') {
        getCount++
        return new Response(
          JSON.stringify({
            snapshot: { id: 1, state: getCount > 1 ? 'generate' : 'critique', provider: 'codex', modelCallsMade: 1 },
            resume: {
              ...resume,
              roles: [
                {
                  ...resume.roles[0]!,
                  bullets: [
                    {
                      ...resume.roles[0]!.bullets[0]!,
                      flags: [
                        {
                          flag: 'vague',
                          severity: 2,
                          span: 'CI pipeline',
                          why: 'Generic.',
                          suggestedQuestion: 'What changed?',
                          dismissed: false,
                          dismissedAt: null,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ ok: true, snapshot: { state: 'generate' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    await mount()
    await flush()

    expect(document.querySelector('a[data-testid="export-pdf"]')?.getAttribute('href')).toBe(
      '/api/sessions/1/export.pdf',
    )
    expect(document.body.textContent).toContain('Generic.')

    await act(async () => {
      ;(document.querySelector('button[data-testid="accept-b1-0"]') as HTMLButtonElement).click()
    })
    await flush()

    expect(document.body.textContent).not.toContain('Generic.')

    await act(async () => {
      ;(document.querySelector('button[data-testid="end-session"]') as HTMLButtonElement).click()
    })
    await flush()

    expect(document.body.textContent).toContain('generate')
  })

  it('does not call rewrite for evidence-only flags', async () => {
    const calls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url === '/api/sessions/1') {
        return new Response(
          JSON.stringify({
            snapshot: { id: 1, state: 'critique', provider: 'codex', modelCallsMade: 1 },
            resume: {
              ...resume,
              roles: [
                {
                  ...resume.roles[0]!,
                  bullets: [
                    {
                      ...resume.roles[0]!.bullets[0]!,
                      flags: [
                        {
                          flag: 'no-impact',
                          severity: 3,
                          span: 'CI pipeline',
                          why: 'No outcome.',
                          suggestedQuestion: 'What changed?',
                          dismissed: false,
                          dismissedAt: null,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    await mount()
    await flush()

    expect(document.body.textContent).toContain('Manual edit only')
    expect(document.querySelector('button[data-testid="rewrite-b1-0"]')).toBeNull()
    expect(calls.some((c) => c.endsWith('/rewrite'))).toBe(false)
  })
})
