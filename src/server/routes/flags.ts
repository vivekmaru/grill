import { Hono } from 'hono'
import { Session } from '@/orchestrator/session'
import {
  AcceptFlagBody,
  DismissFlagBody,
} from '@/server/schemas/routes'
import { respondWithError } from '@/server/errors'
import type { AppDeps } from '@/server/deps'
import type { Context } from 'hono'

function parseRouteIds(
  c: Context,
):
  | { ok: true; id: number; bulletId: string; flagIdx: number }
  | { ok: false; reason: string } {
  const idStr = c.req.param('id')
  const bulletId = c.req.param('bulletId')
  const flagIdxStr = c.req.param('flagIdx')
  const id = Number(idStr)
  const flagIdx = Number(flagIdxStr)
  if (!Number.isInteger(id) || id <= 0) return { ok: false, reason: 'id' }
  if (!bulletId) return { ok: false, reason: 'bulletId' }
  if (!Number.isInteger(flagIdx) || flagIdx < 0) {
    return { ok: false, reason: 'flagIdx' }
  }
  return { ok: true, id, bulletId, flagIdx }
}

export function flagsRoutes(deps: AppDeps): Hono {
  const router = new Hono()

  router.post('/:id/bullets/:bulletId/flags/:flagIdx/accept', async (c) => {
    const ids = parseRouteIds(c)
    if (!ids.ok) {
      return c.json({ error: { code: 'validation', message: ids.reason } }, 400)
    }
    let body: unknown
    try {
      body = await c.req.json()
    } catch (e) {
      return respondWithError(c, e)
    }
    const parsed = AcceptFlagBody.safeParse(body)
    if (!parsed.success) return respondWithError(c, parsed.error)

    try {
      const session = Session.load(deps.db, deps.adapter, ids.id)
      session.acceptFlag({
        bulletId: ids.bulletId,
        flagIndex: ids.flagIdx,
        newText: parsed.data.newText,
      })
      return c.json({ ok: true })
    } catch (e) {
      return respondWithError(c, e)
    }
  })

  router.post('/:id/bullets/:bulletId/flags/:flagIdx/skip', async (c) => {
    const ids = parseRouteIds(c)
    if (!ids.ok) {
      return c.json({ error: { code: 'validation', message: ids.reason } }, 400)
    }
    try {
      const session = Session.load(deps.db, deps.adapter, ids.id)
      session.skipFlag({ bulletId: ids.bulletId, flagIndex: ids.flagIdx })
      return c.json({ ok: true })
    } catch (e) {
      return respondWithError(c, e)
    }
  })

  router.post('/:id/bullets/:bulletId/flags/:flagIdx/dismiss', async (c) => {
    const ids = parseRouteIds(c)
    if (!ids.ok) {
      return c.json({ error: { code: 'validation', message: ids.reason } }, 400)
    }
    let body: unknown = {}
    try {
      body = await c.req.json()
    } catch {
      /* allow empty body */
    }
    const parsed = DismissFlagBody.safeParse(body)
    if (!parsed.success) return respondWithError(c, parsed.error)
    try {
      const session = Session.load(deps.db, deps.adapter, ids.id)
      session.dismissFlag({
        bulletId: ids.bulletId,
        flagIndex: ids.flagIdx,
        reason: parsed.data.reason,
        confirmSeverity3: parsed.data.confirmSeverity3,
      })
      return c.json({ ok: true })
    } catch (e) {
      return respondWithError(c, e)
    }
  })

  router.post('/:id/bullets/:bulletId/flags/:flagIdx/rewrite', async (c) => {
    const ids = parseRouteIds(c)
    if (!ids.ok) {
      return c.json({ error: { code: 'validation', message: ids.reason } }, 400)
    }
    try {
      const session = Session.load(deps.db, deps.adapter, ids.id)
      const result = await session.proposeRewrites({
        bulletId: ids.bulletId,
        flagIndex: ids.flagIdx,
      })
      return c.json(result)
    } catch (e) {
      return respondWithError(c, e)
    }
  })

  return router
}
