import { Hono } from 'hono'
import { Session } from '@/orchestrator/session'
import { respondWithError } from '@/server/errors'
import type { AppDeps } from '@/server/deps'

export function endRoutes(deps: AppDeps): Hono {
  const router = new Hono()

  router.post('/:id/end', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: { code: 'validation' } }, 400)
    }
    try {
      const session = Session.load(deps.db, deps.adapter, id)
      const review = await session.endInterrogation()
      return c.json({ snapshot: session.snapshot(), review })
    } catch (e) {
      return respondWithError(c, e)
    }
  })

  return router
}
