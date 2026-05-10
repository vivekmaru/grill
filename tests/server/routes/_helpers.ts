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
  // Build a claude-named adapter that shares the same response queue so tests
  // that specify provider: 'claude' hit the same stubs but get adapter.name === 'claude'.
  const claudeStub = createStubAdapter([], { name: 'claude' })
  // Share the response queue so pushes on stub.responses are visible to both.
  const claudeAdapter = { ...claudeStub.adapter }
  // Wrap callInSession to pull from the shared queue.
  const originalCall = stub.adapter.callInSession.bind(stub.adapter)
  claudeAdapter.callInSession = (args) => {
    // Delegate to the codex stub so it pulls from stub.responses
    return originalCall(args)
  }
  const app = createApp({ db, adapters: { codex: stub.adapter, claude: claudeAdapter } })
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
