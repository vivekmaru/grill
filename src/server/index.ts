import { Hono } from 'hono'
import packageJson from '../../package.json' with { type: 'json' }
import type { AppDeps } from './deps'
import { sessionsRoutes } from './routes/sessions'
import { critiqueRoutes } from './routes/critique'
import { flagsRoutes } from './routes/flags'
import { editRoutes } from './routes/edit'
import { endRoutes } from './routes/end'
import { exportRoutes } from './routes/export'
import { gatherRoutes } from './routes/gather'

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()

  app.get('/healthz', (c) =>
    c.json({ ok: true, version: packageJson.version }),
  )

  app.route('/api/sessions', sessionsRoutes(deps))
  app.route('/api/sessions', gatherRoutes(deps))
  app.route('/api/sessions', critiqueRoutes(deps))
  app.route('/api/sessions', flagsRoutes(deps))
  app.route('/api/sessions', editRoutes(deps))
  app.route('/api/sessions', endRoutes(deps))
  app.route('/api/sessions', exportRoutes(deps))

  return app
}

export type { AppDeps } from './deps'

if (import.meta.main) {
  throw new Error(
    'Direct execution disabled — production composition arrives in phase 2h.',
  )
}
