import { Hono } from 'hono'
import packageJson from '../../package.json' with { type: 'json' }
import type { AppDeps } from './deps'

export function createApp(_deps: AppDeps): Hono {
  const app = new Hono()

  app.get('/healthz', (c) =>
    c.json({ ok: true, version: packageJson.version }),
  )

  return app
}

export type { AppDeps } from './deps'

if (import.meta.main) {
  throw new Error(
    'Direct execution disabled — production composition arrives in phase 2h.',
  )
}
