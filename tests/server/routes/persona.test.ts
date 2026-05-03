import { describe, it, expect } from 'bun:test'
import { buildTestApp, jsonRequest } from './_helpers'

describe('POST /api/persona/propose', () => {
  it('returns archetype/tone/rationale from the adapter', async () => {
    const { fetch, stub } = buildTestApp()
    stub.responses.push({
      type: 'ok',
      value: {
        archetype: 'engineering-manager',
        tone: 'skeptical',
        rationale: 'Backend infra hire — pushback should focus on systems thinking.',
      },
    })

    const res = await fetch(
      jsonRequest('POST', '/api/persona/propose', {
        targetRole: 'Staff Engineer',
        targetSeniority: 'staff',
        industry: 'fintech',
        jobDescription: 'You will own the platform team.',
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      archetype: string
      tone: string
      rationale: string
    }
    expect(body.archetype).toBe('engineering-manager')
    expect(body.tone).toBe('skeptical')
    expect(body.rationale).toContain('systems thinking')

    expect(stub.calls).toHaveLength(1)
    expect(stub.calls[0]!.userPrompt).toContain('Staff Engineer')
    expect(stub.calls[0]!.userPrompt).toContain('fintech')
    expect(stub.calls[0]!.userPrompt).toContain('platform team')
  })

  it('returns 400 on missing targetRole', async () => {
    const { fetch } = buildTestApp()
    const res = await fetch(
      jsonRequest('POST', '/api/persona/propose', {
        targetSeniority: 'senior',
      }),
    )
    expect(res.status).toBe(400)
  })

  it('rejects unknown seniority', async () => {
    const { fetch } = buildTestApp()
    const res = await fetch(
      jsonRequest('POST', '/api/persona/propose', {
        targetRole: 'Staff Engineer',
        targetSeniority: 'overlord',
      }),
    )
    expect(res.status).toBe(400)
  })
})
