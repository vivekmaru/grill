import { Hono } from 'hono'
import { z } from 'zod'
import { Session } from '@/orchestrator/session'
import { GatherAnswerBody } from '@/server/schemas/routes'
import { respondWithError } from '@/server/errors'
import type { AppDeps } from '@/server/deps'

const SessionIdParam = z.coerce.number().int().positive()

function parseSessionId(idStr: string | undefined): number {
  return SessionIdParam.parse(idStr)
}

export function gatherRoutes(deps: AppDeps): Hono {
  const router = new Hono()

  router.post('/:id/gather/role/:roleId/ask', async (c) => {
    try {
      const id = parseSessionId(c.req.param('id'))
      const roleId = c.req.param('roleId')
      const session = Session.load(deps.db, deps.adapter, id)
      const result = await session.nextGatherQuestion({ roleId })
      return c.json(result)
    } catch (e) {
      return respondWithError(c, e)
    }
  })

  router.post('/:id/gather/role/:roleId/answer', async (c) => {
    try {
      const id = parseSessionId(c.req.param('id'))
      let body: unknown
      try {
        body = await c.req.json()
      } catch (e) {
        return respondWithError(c, e)
      }
      const parsed = GatherAnswerBody.safeParse(body)
      if (!parsed.success) return respondWithError(c, parsed.error)
      const session = Session.load(deps.db, deps.adapter, id)
      session.recordGatherAnswer(parsed.data)
      return c.json({ ok: true })
    } catch (e) {
      return respondWithError(c, e)
    }
  })

  router.post('/:id/gather/role/:roleId/skip', (c) => {
    try {
      const id = parseSessionId(c.req.param('id'))
      const roleId = c.req.param('roleId')
      const session = Session.load(deps.db, deps.adapter, id)
      session.skipGatherRole({ roleId })
      return c.json({ ok: true })
    } catch (e) {
      return respondWithError(c, e)
    }
  })

  router.post('/:id/gather/end', (c) => {
    try {
      const id = parseSessionId(c.req.param('id'))
      const session = Session.load(deps.db, deps.adapter, id)
      session.endGather()
      return c.json({ snapshot: session.snapshot() })
    } catch (e) {
      return respondWithError(c, e)
    }
  })

  return router
}
