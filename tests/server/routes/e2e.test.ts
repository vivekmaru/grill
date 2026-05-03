import { describe, it, expect } from 'bun:test'
import { buildTestApp, jsonRequest } from './_helpers'
import { sampleResumeJson, sampleTarget } from './_fixtures'

describe('end-to-end: setup → critique → accept → edit → end', () => {
  it('walks the full happy path through every route', async () => {
    const { fetch, stub } = buildTestApp()

    // 1. Create session (ingest + setTarget atomic)
    stub.responses.push({ type: 'ok', value: sampleResumeJson })
    const createRes = await fetch(
      jsonRequest('POST', '/api/sessions', {
        resume: { kind: 'markdown', text: '# Hi' },
        target: sampleTarget,
      }),
    )
    expect(createRes.status).toBe(201)
    const { id, resume } = (await createRes.json()) as {
      id: number
      resume: { roles: Array<{ bullets: Array<{ id: string }> }> }
    }
    const bulletId = resume.roles[0]!.bullets[0]!.id

    // 2. Critique (one flag)
    stub.responses.push({
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
        passSummary: { bulletsScanned: 1, bulletsFlagged: 1, topConcern: '' },
      },
    })
    const critRes = await fetch(
      new Request(`http://localhost/api/sessions/${id}/critique`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    )
    expect(critRes.status).toBe(200)
    const reader = critRes.body!.getReader()
    while (!(await reader.read()).done) {
      /* drain */
    }

    // 3. Accept the flag
    const acc = await fetch(
      jsonRequest(
        'POST',
        `/api/sessions/${id}/bullets/${bulletId}/flags/0/accept`,
        { newText: 'Built CI pipeline cutting flake from 18% to 2%' },
      ),
    )
    expect(acc.status).toBe(200)

    // 4. Manual edit on the (now refined) bullet
    const edit = await fetch(
      jsonRequest('POST', `/api/sessions/${id}/edit`, {
        bulletId,
        newText: 'Final version after manual polish',
      }),
    )
    expect(edit.status).toBe(200)

    // 5. End interrogation
    const end = await fetch(jsonRequest('POST', `/api/sessions/${id}/end`, {}))
    expect(end.status).toBe(200)
    const endBody = (await end.json()) as {
      snapshot: { state: string; modelCallsMade: number }
    }
    expect(endBody.snapshot.state).toBe('generate')
    expect(endBody.snapshot.modelCallsMade).toBe(2) // ingest + critique

    // 6. Final GET shows the manual edit
    const get = await fetch(new Request(`http://localhost/api/sessions/${id}`))
    const getBody = (await get.json()) as {
      resume: { roles: Array<{ bullets: Array<{ text: string }> }> }
    }
    expect(getBody.resume.roles[0]!.bullets[0]!.text).toBe(
      'Final version after manual polish',
    )

    // 7. Export returns a real ATS PDF
    const exp = await fetch(
      new Request(`http://localhost/api/sessions/${id}/export.pdf`),
    )
    expect(exp.status).toBe(200)
    expect(exp.headers.get('content-type')).toBe('application/pdf')
    const header = new TextDecoder().decode(
      new Uint8Array(await exp.arrayBuffer()).slice(0, 8),
    )
    expect(header).toBe('%PDF-1.4')
  })
})
