import type { Database } from 'bun:sqlite'
import { createDb } from '@/server/db/client'
import { createApp } from '@/server/index'
import {
  createStubAdapter,
  type StubAdapter,
} from '../../orchestrator/_helpers/stubAdapter'

export interface TestApp {
  fetch: (req: Request) => Promise<Response>
  db: Database
  stub: StubAdapter
}

export function buildTestApp(): TestApp {
  const db = createDb(':memory:')
  const stub = createStubAdapter([], { name: 'codex' })
  const app = createApp({ db, adapter: stub.adapter })
  return {
    fetch: async (req) => app.fetch(req),
    db,
    stub,
  }
}

export function jsonRequest(
  method: string,
  url: string,
  body?: unknown,
): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
