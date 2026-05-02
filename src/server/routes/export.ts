import { Hono } from 'hono'
import type { AppDeps } from '@/server/deps'

export function exportRoutes(_deps: AppDeps): Hono {
  const router = new Hono()

  router.get('/:id/export.pdf', (c) =>
    c.json(
      {
        error: {
          code: 'export_unavailable',
          message: 'PDF export lands in phase 2g',
        },
      },
      501,
    ),
  )

  return router
}
