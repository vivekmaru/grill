import { describe, it, expect } from 'bun:test'
import { buildTestApp, jsonRequest } from './_helpers'
import { sampleResumeJson, sampleTarget } from './_fixtures'

async function readSse(res: Response): Promise<Array<{ event: string; data: unknown }>> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const events: Array<{ event: string; data: unknown }> = []
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''
    for (const block of blocks) {
      if (!block.trim()) continue
      const lines = block.split('\n')
      const eventLine = lines.find((l) => l.startsWith('event:'))
      const dataLine = lines.find((l) => l.startsWith('data:'))
      if (!eventLine || !dataLine) continue
      events.push({
        event: eventLine.slice(6).trim(),
        data: JSON.parse(dataLine.slice(5).trim()),
      })
    }
  }
  return events
}

async function setup() {
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
  return { app, id, bulletId }
}

describe('POST /api/sessions/:id/critique', () => {
  it('streams started → flag → pass-summary → done', async () => {
    const { app, id, bulletId } = await setup()
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

    const res = await app.fetch(
      new Request(`http://localhost/api/sessions/${id}/critique`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const events = await readSse(res)
    const types = events.map((e) => e.event)
    expect(types).toEqual(['started', 'flag', 'pass-summary', 'done'])
  })

  it('returns 404 for missing session', async () => {
    const { fetch } = buildTestApp()
    const res = await fetch(
      new Request('http://localhost/api/sessions/9999/critique', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    )
    expect(res.status).toBe(404)
  })
})
