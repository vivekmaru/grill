import { Hono } from 'hono'
import packageJson from '../../package.json' with { type: 'json' }
import type { AppDeps } from './deps'
import { sessionsRoutes } from './routes/sessions'
import { critiqueRoutes } from './routes/critique'
import { flagsRoutes } from './routes/flags'

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()

  app.get('/healthz', (c) =>
    c.json({ ok: true, version: packageJson.version }),
  )

  app.route('/api/sessions', sessionsRoutes(deps))
  app.route('/api/sessions', critiqueRoutes(deps))
  app.route('/api/sessions', flagsRoutes(deps))

  return app
}

export type { AppDeps } from './deps'

if (import.meta.main) {
  throw new Error(
    'Direct execution disabled — production composition arrives in phase 2h.',
  )
}
