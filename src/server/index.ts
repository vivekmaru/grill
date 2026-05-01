import { Hono } from 'hono'
import packageJson from '../../package.json' with { type: 'json' }

export function createApp(): Hono {
  const app = new Hono()

  app.get('/healthz', (c) =>
    c.json({ ok: true, version: packageJson.version }),
  )

  return app
}

// Bun entry point — only runs when this file is executed directly.
if (import.meta.main) {
  const app = createApp()
  const port = Number(Bun.env.PORT ?? 4321)
  console.log(`resume-builder listening on http://127.0.0.1:${port}`)
  Bun.serve({
    port,
    hostname: '127.0.0.1',
    fetch: app.fetch,
  })
}
