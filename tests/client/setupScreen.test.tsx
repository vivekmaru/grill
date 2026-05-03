import { describe, it, expect, afterEach } from 'bun:test'
import { ensureDom } from './_dom'

ensureDom()

// Required for React's act() to work in non-browser test environments
// @ts-ignore
globalThis.IS_REACT_ACT_ENVIRONMENT = true

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SetupScreen } from '@/client/screens/SetupScreen'
import { App } from '@/client/App'
import { CreateSessionBody } from '@/server/schemas/routes'

const realFetch = globalThis.fetch

// Native value setters needed to bypass React's own property descriptor
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  'value',
)?.set
const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  'value',
)?.set

// In happy-dom React's delegated event listeners don't fire from dispatched DOM events.
// Instead we set the native value then invoke the element's React onChange prop directly.
function fireReactChange(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  if (el instanceof HTMLTextAreaElement && nativeTextareaValueSetter) {
    nativeTextareaValueSetter.call(el, value)
  } else if (el instanceof HTMLInputElement && nativeInputValueSetter) {
    nativeInputValueSetter.call(el, value)
  } else {
    el.value = value
  }
  const propsKey = Object.keys(el).find((k) => k.startsWith('__reactProps$'))
  if (propsKey) {
    const props = (el as Record<string, any>)[propsKey] as Record<string, unknown>
    if (typeof props['onChange'] === 'function') {
      ;(props['onChange'] as (e: unknown) => void)({
        target: el,
        currentTarget: el,
        type: 'change',
        nativeEvent: new Event('change'),
      })
    }
  }
}

describe('<SetupScreen />', () => {
  afterEach(() => {
    globalThis.fetch = realFetch
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild)
  })

  async function mount(ui = <SetupScreen />): Promise<Root> {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          {ui}
        </QueryClientProvider>,
      )
    })
    return root
  }

  function setVal(id: string, value: string): void {
    const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement
    fireReactChange(el, value)
  }

  const stubResume = {
    version: 1,
    contact: { name: 'X', email: 'x@x.com', links: [] },
    roles: [],
    skills: { categories: [] },
    education: [],
    projects: [],
    certifications: [],
  }

  it('submits a payload that satisfies CreateSessionBody', async () => {
    let capturedBody: unknown = null
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(String(init.body))
      return new Response(
        JSON.stringify({
          id: 1,
          snapshot: { state: 'critique', modelCallsMade: 1 },
          resume: stubResume,
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    await mount()

    await act(async () => {
      setVal('resumeText', '# Jane Doe\nEngineer')
      setVal('targetRole', 'Staff Engineer')
    })

    await act(async () => {
      const btn = document.querySelector('button[type="submit"][form="setup-form"]') as HTMLButtonElement
      btn.click()
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(capturedBody).not.toBeNull()
    const parsed = CreateSessionBody.safeParse(capturedBody)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.resume).toEqual({ kind: 'markdown', text: '# Jane Doe\nEngineer' })
      expect(parsed.data.target.targetRole).toBe('Staff Engineer')
      expect(parsed.data.target.persona.archetype).toBe('engineering-manager')
      expect(parsed.data.target.persona.tone).toBe('skeptical')
    }
  })

  it('reaches the session screen after a successful response', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      const response = {
        id: 42,
        snapshot: { id: 42, state: 'critique', provider: 'codex', modelCallsMade: 1 },
        resume: {
            ...stubResume,
            roles: [
              {
                id: 'r1',
                company: 'C',
                title: 'T',
                startDate: '2020-01',
                endDate: null,
                bullets: [
                  {
                    id: 'b1',
                    text: 'x',
                    metrics: [],
                    skills: [],
                    flags: [],
                    sourceTurnIds: [],
                    status: 'draft',
                  },
                ],
              },
            ],
          },
      }
      if (url === '/api/sessions/42') {
        return new Response(JSON.stringify({ snapshot: response.snapshot, resume: response.resume }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(
        JSON.stringify(response),
        { status: 201, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    await mount(<App />)
    await act(async () => {
      setVal('resumeText', '# Hi')
      setVal('targetRole', 'Engineer')
    })
    await act(async () => {
      const btn = document.querySelector('button[type="submit"][form="setup-form"]') as HTMLButtonElement
      btn.click()
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(document.body.textContent).toContain('Session 42')
    expect(document.body.textContent).toContain('Resume Preview')
    expect(document.body.textContent).toContain('x')
  })
})
