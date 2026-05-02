import { describe, it, expect } from 'bun:test'
import { buildTestApp, jsonRequest } from './_helpers'
import { sampleResumeJson, sampleTarget } from './_fixtures'

async function setupWithFlag(): Promise<{
  app: ReturnType<typeof buildTestApp>
  id: number
  bulletId: string
}> {
  const app = buildTestApp()
  app.stub.responses.push({ type: 'ok', value: sampleResumeJson })
  const created = await app.fetch(
    jsonRequest('POST', '/api/sessions', {
      resume: { kind: 'markdown', text: '# Hi' },
      target: sampleTarget,
    }),
  )
  const { id, resume } = (await created.json()) as {
    id: number
    resume: { roles: Array<{ bullets: Array<{ id: string }> }> }
  }
  const bulletId = resume.roles[0]!.bullets[0]!.id

  app.stub.responses.push({
    type: 'ok',
    value: {
      flags: [
        {
          bulletId,
          flag: 'vague',
          severity: 2,
          span: 'CI pipeline',
          why: 'Generic.',
          suggestedQuestion: 'What changed?',
        },
      ],
      passSummary: { bulletsScanned: 1, bulletsFlagged: 1, topConcern: 'one' },
    },
  })

  // Drain the critique stream
  const critRes = await app.fetch(
    new Request(`http://localhost/api/sessions/${id}/critique`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
  )
  const reader = critRes.body!.getReader()
  while (!(await reader.read()).done) {
    /* drain */
  }

  return { app, id, bulletId }
}

describe('flag mutation routes', () => {
  it('POST .../accept changes bullet text and status', async () => {
    const { app, id, bulletId } = await setupWithFlag()
    const res = await app.fetch(
      jsonRequest(
        'POST',
        `/api/sessions/${id}/bullets/${bulletId}/flags/0/accept`,
        { newText: 'Built a 6-stage CI pipeline that cut flake from 18% to 2%' },
      ),
    )
    expect(res.status).toBe(200)

    const get = await app.fetch(new Request(`http://localhost/api/sessions/${id}`))
    const body = (await get.json()) as {
      resume: { roles: Array<{ bullets: Array<{ text: string; status: string }> }> }
    }
    expect(body.resume.roles[0]!.bullets[0]!.status).toBe('refined')
    expect(body.resume.roles[0]!.bullets[0]!.text).toContain('CI pipeline')
  })

  it('POST .../skip marks status accepted', async () => {
    const { app, id, bulletId } = await setupWithFlag()
    const res = await app.fetch(
      jsonRequest('POST', `/api/sessions/${id}/bullets/${bulletId}/flags/0/skip`),
    )
    expect(res.status).toBe(200)

    const get = await app.fetch(new Request(`http://localhost/api/sessions/${id}`))
    const body = (await get.json()) as {
      resume: { roles: Array<{ bullets: Array<{ status: string }> }> }
    }
    expect(body.resume.roles[0]!.bullets[0]!.status).toBe('accepted')
  })

  it('POST .../dismiss marks flag dismissed', async () => {
    const { app, id, bulletId } = await setupWithFlag()
    const res = await app.fetch(
      jsonRequest(
        'POST',
        `/api/sessions/${id}/bullets/${bulletId}/flags/0/dismiss`,
        {},
      ),
    )
    expect(res.status).toBe(200)

    const get = await app.fetch(new Request(`http://localhost/api/sessions/${id}`))
    const body = (await get.json()) as {
      resume: {
        roles: Array<{ bullets: Array<{ flags: Array<{ dismissed: boolean }> }> }>
      }
    }
    expect(body.resume.roles[0]!.bullets[0]!.flags[0]!.dismissed).toBe(true)
  })

  it('POST .../rewrite returns 2 candidates', async () => {
    const { app, id, bulletId } = await setupWithFlag()
    app.stub.responses.push({
      type: 'ok',
      value: {
        candidates: [
          { text: 'Rewrite A', evidenceMap: [{ span: 'A', source: 'original' }] },
          { text: 'Rewrite B', evidenceMap: [{ span: 'B', source: 'original' }] },
        ],
      },
    })

    const res = await app.fetch(
      jsonRequest(
        'POST',
        `/api/sessions/${id}/bullets/${bulletId}/flags/0/rewrite`,
        {},
      ),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { candidates: Array<{ text: string }> }
    expect(body.candidates).toHaveLength(2)
  })

  it('POST .../rewrite returns 422 for evidence flag', async () => {
    // Build a session with an unverified flag instead
    const app = buildTestApp()
    app.stub.responses.push({ type: 'ok', value: sampleResumeJson })
    const created = await app.fetch(
      jsonRequest('POST', '/api/sessions', {
        resume: { kind: 'markdown', text: '# Hi' },
        target: sampleTarget,
      }),
    )
    const { id, resume } = (await created.json()) as {
      id: number
      resume: { roles: Array<{ bullets: Array<{ id: string }> }> }
    }
    const bulletId = resume.roles[0]!.bullets[0]!.id

    app.stub.responses.push({
      type: 'ok',
      value: {
        flags: [
          {
            bulletId,
            flag: 'unverified',
            severity: 3,
            span: 'CI pipeline',
            why: 'No metric.',
            suggestedQuestion: 'What was the throughput?',
          },
        ],
        passSummary: { bulletsScanned: 1, bulletsFlagged: 1, topConcern: '' },
      },
    })
    const critRes = await app.fetch(
      new Request(`http://localhost/api/sessions/${id}/critique`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    )
    const reader = critRes.body!.getReader()
    while (!(await reader.read()).done) {
      /* drain */
    }

    const res = await app.fetch(
      jsonRequest(
        'POST',
        `/api/sessions/${id}/bullets/${bulletId}/flags/0/rewrite`,
        {},
      ),
    )
    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('evidenced_flag_not_supported')
  })
})
