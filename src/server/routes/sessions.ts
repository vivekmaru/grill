import { Hono } from 'hono'
import { Session } from '@/orchestrator/session'
import { CreateSessionBody } from '@/server/schemas/routes'
import { respondWithError } from '@/server/errors'
import type { AppDeps } from '@/server/deps'

export function sessionsRoutes(deps: AppDeps): Hono {
  const router = new Hono()

  router.post('/', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch (e) {
      return respondWithError(c, e)
    }
    const parsed = CreateSessionBody.safeParse(body)
    if (!parsed.success) return respondWithError(c, parsed.error)

    try {
      const session = Session.create(deps.db, deps.adapter)
      await session.ingestResume(parsed.data.resume)
      // Gather is not yet wired into this route (T4). Disable so setTarget
      // auto-transitions to critique, preserving pre-gather behaviour.
      session.setGatherEnabled(false)
      session.setTarget(parsed.data.target)
      const snapshot = session.snapshot()
      const resume = session.currentResume()
      return c.json({ id: snapshot.id, snapshot, resume }, 201)
    } catch (e) {
      return respondWithError(c, e)
    }
  })

  router.get('/:id', (c) => {
    const idStr = c.req.param('id')
    const id = Number(idStr)
    if (!Number.isInteger(id) || id <= 0) {
      return c.json(
        { error: { code: 'validation', message: 'id must be a positive integer' } },
        400,
      )
    }
    try {
      const session = Session.load(deps.db, deps.adapter, id)
      const snapshot = session.snapshot()
      const resume = session.currentResume()
      return c.json({ snapshot, resume })
    } catch (e) {
      return respondWithError(c, e)
    }
  })

  return router
}
