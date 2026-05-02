import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { Session } from '@/orchestrator/session'
import { respondWithError } from '@/server/errors'
import type { AppDeps } from '@/server/deps'

export function critiqueRoutes(deps: AppDeps): Hono {
  const router = new Hono()

  router.post('/:id/critique', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) {
      return c.json(
        { error: { code: 'validation', message: 'id must be a positive integer' } },
        400,
      )
    }

    let session: Session
    try {
      session = Session.load(deps.db, deps.adapter, id)
    } catch (e) {
      return respondWithError(c, e)
    }

    return streamSSE(c, async (stream) => {
      const ac = new AbortController()
      stream.onAbort(() => ac.abort())

      try {
        for await (const evt of session.runCritique({ signal: ac.signal })) {
          await stream.writeSSE({
            event: evt.type,
            data: JSON.stringify(evt),
          })
          if (evt.type === 'done' || evt.type === 'error') break
        }
      } catch (e) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            code: 'internal',
            message: (e as Error).message,
          }),
        })
      }
    })
  })

  return router
}
