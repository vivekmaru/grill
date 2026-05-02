import { Hono } from 'hono'
import { Session } from '@/orchestrator/session'
import { EditBulletBody } from '@/server/schemas/routes'
import { respondWithError } from '@/server/errors'
import type { AppDeps } from '@/server/deps'

export function editRoutes(deps: AppDeps): Hono {
  const router = new Hono()

  router.post('/:id/edit', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: { code: 'validation' } }, 400)
    }
    let body: unknown
    try {
      body = await c.req.json()
    } catch (e) {
      return respondWithError(c, e)
    }
    const parsed = EditBulletBody.safeParse(body)
    if (!parsed.success) return respondWithError(c, parsed.error)

    try {
      const session = Session.load(deps.db, deps.adapter, id)
      session.editBullet({
        bulletId: parsed.data.bulletId,
        newText: parsed.data.newText,
      })
      return c.json({ ok: true })
    } catch (e) {
      return respondWithError(c, e)
    }
  })

  return router
}
