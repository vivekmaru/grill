import { Hono } from 'hono'
import type { AppDeps } from '@/server/deps'

export function providersRoutes(deps: AppDeps): Hono {
  const router = new Hono()

  router.get('/', (c) => {
    return c.json({
      available: Object.keys(deps.adapters),
      default: 'codex',
    })
  })

  return router
}
