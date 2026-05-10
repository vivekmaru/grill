# Phase 4 — Multi-Provider Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire an adapter map into the app so each session can use either the Claude or Codex CLI, selected per-session in the UI with Codex as the default fallback.

**Architecture:** Replace the single `ProviderAdapter` in `AppDeps` with `Record<string, ProviderAdapter>`. Boot probes each CLI binary with `--version` and constructs adapters only for available CLIs. Routes look up the stored session provider, resolve the right adapter, then call `Session.load` unchanged. `AI_PROVIDER` env var is removed.

**Tech Stack:** Bun, bun:sqlite, Hono, Zod, React 19 + TanStack Query, existing `ProviderAdapter` interface.

---

## File map

| Action | File | Responsibility |
|---|---|---|
| Modify | `src/server/deps.ts` | `adapter` → `adapters` map; add `resolveAdapter` helper |
| Modify | `src/lib/env.ts` | Remove `AI_PROVIDER` field |
| Modify | `src/server/dev.ts` | `createDevAdapter` → async `createDevAdapters`; add `probeCliAvailable` |
| Create | `src/server/routes/providers.ts` | `GET /api/providers` |
| Modify | `src/server/index.ts` | Register providers route |
| Modify | `src/server/schemas/routes.ts` | Add `provider` field to `CreateSessionBody` |
| Modify | `src/server/db/repositories/sessions.ts` | Add `getSessionProvider` export |
| Modify | `src/server/routes/sessions.ts` | Resolve adapter from map; Session.create uses resolved adapter |
| Modify | `src/server/routes/critique.ts` | `getSessionProvider` + `resolveAdapter` before Session.load |
| Modify | `src/server/routes/flags.ts` | Same pattern |
| Modify | `src/server/routes/gather.ts` | Same pattern |
| Modify | `src/server/routes/end.ts` | Same pattern |
| Modify | `src/server/routes/edit.ts` | Same pattern |
| Modify | `src/server/routes/export.ts` | Same pattern |
| Modify | `src/server/routes/persona.ts` | Use `resolveAdapter(deps.adapters, 'codex')` (stateless route) |
| Modify | `src/client/lib/api.ts` | Add `getProviders()` |
| Modify | `src/client/screens/SetupScreen.tsx` | Provider picker |
| Modify | `src/client/screens/SessionScreen.tsx` | Provider lock badge |
| Modify | `tests/server/routes/_helpers.ts` | Pass `adapters` map instead of single adapter |
| Create | `tests/server/routes/providers.test.ts` | `GET /api/providers` tests |
| Create | `tests/server/db/sessionProvider.test.ts` | `getSessionProvider` tests |

---

## Task 1: Refactor `AppDeps` — adapter → adapters map

**Files:**
- Modify: `src/server/deps.ts`
- Modify: `tests/server/routes/_helpers.ts`

- [ ] **Step 1: Update `deps.ts`**

Replace the file entirely:

```ts
// src/server/deps.ts
import type { Database } from 'bun:sqlite'
import type { ProviderAdapter } from '@/prompts/adapters/types'

export interface AppDeps {
  db: Database
  adapters: Record<string, ProviderAdapter>
}

/**
 * Pick the adapter for the given provider name, falling back to codex.
 * Always returns something — codex is guaranteed to be in the map.
 */
export function resolveAdapter(
  adapters: Record<string, ProviderAdapter>,
  provider: string,
): ProviderAdapter {
  return adapters[provider] ?? adapters['codex']!
}
```

- [ ] **Step 2: Update `_helpers.ts`** to pass an adapters map

```ts
// tests/server/routes/_helpers.ts
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
  // Both 'codex' and 'claude' point to the same stub so tests that
  // specify provider: 'claude' still hit the same response queue.
  const app = createApp({ db, adapters: { codex: stub.adapter, claude: stub.adapter } })
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
```

- [ ] **Step 3: Run type check to see the cascade of errors (expected)**

```bash
bun run tsc --noEmit 2>&1 | grep "error TS" | head -20
```

Expected: errors in all route files referencing `deps.adapter`. These will be fixed in Task 6.

- [ ] **Step 4: Commit the foundation change**

```bash
git add src/server/deps.ts tests/server/routes/_helpers.ts
git commit -m "refactor(deps): adapter → adapters map in AppDeps"
```

---

## Task 2: Add `getSessionProvider` to session repository

**Files:**
- Modify: `src/server/db/repositories/sessions.ts`
- Create: `tests/server/db/sessionProvider.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/db/sessionProvider.test.ts
import { describe, it, expect } from 'bun:test'
import { createDb } from '@/server/db/client'
import { createSessionRepo } from '@/server/db/repositories/sessions'
import { getSessionProvider } from '@/server/db/repositories/sessions'

describe('getSessionProvider', () => {
  it('returns the stored provider for a locked session', () => {
    const db = createDb(':memory:')
    const repo = createSessionRepo(db)
    const id = repo.create({ state: 'ingest' })
    repo.lockProvider(id, 'claude')
    expect(getSessionProvider(db, id)).toBe('claude')
  })

  it('returns "codex" when provider is null (no provider locked yet)', () => {
    const db = createDb(':memory:')
    const repo = createSessionRepo(db)
    // create a session but don't lock provider
    const id = db
      .query<{ id: number }, [string, number, number]>(
        'INSERT INTO sessions (state, created_at, updated_at) VALUES (?, ?, ?) RETURNING id',
      )
      .get('ingest', Date.now(), Date.now())!.id
    expect(getSessionProvider(db, id)).toBe('codex')
  })

  it('throws "Session not found" for a missing id', () => {
    const db = createDb(':memory:')
    expect(() => getSessionProvider(db, 9999)).toThrow('Session not found')
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

```bash
bun test tests/server/db/sessionProvider.test.ts
```

Expected: FAIL — `getSessionProvider` is not exported yet.

- [ ] **Step 3: Add `getSessionProvider` to the sessions repo file**

Add this export at the bottom of `src/server/db/repositories/sessions.ts` (after `createSessionRepo`):

```ts
/**
 * Quick single-column read used by route handlers to resolve the right
 * adapter before calling Session.load. Returns 'codex' if the provider
 * column is NULL (shouldn't happen post-creation, but safe fallback).
 * Throws if the session row doesn't exist.
 */
export function getSessionProvider(db: Database, id: number): string {
  const row = db
    .query<{ provider: string | null }, [number]>(
      'SELECT provider FROM sessions WHERE id = ?',
    )
    .get(id)
  if (!row) throw new Error(`Session not found: ${id}`)
  return row.provider ?? 'codex'
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test tests/server/db/sessionProvider.test.ts
```

Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/repositories/sessions.ts tests/server/db/sessionProvider.test.ts
git commit -m "feat(db): add getSessionProvider helper to session repo"
```

---

## Task 3: Update `env.ts` and `dev.ts`

**Files:**
- Modify: `src/lib/env.ts`
- Modify: `src/server/dev.ts`

- [ ] **Step 1: Remove `AI_PROVIDER` from `env.ts`**

Remove the `AI_PROVIDER` line from the `EnvSchema` object in `src/lib/env.ts`:

```ts
// src/lib/env.ts  — remove this line:
AI_PROVIDER: z.enum(['claude', 'codex', 'gemini']).default('codex'),
```

The file after removal (only the schema object shown for clarity):

```ts
const EnvSchema = z.object({
  CLAUDE_BIN: z.string().default('claude'),
  GEMINI_BIN: z.string().default('gemini'),
  OPENAI_BIN: z.string().default('codex'),
  ANTHROPIC_MAIN_MODEL: z.string().default('claude-opus-4-7'),
  ANTHROPIC_VERIFIER_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  GEMINI_MAIN_MODEL: z.string().default('gemini-2.5-pro'),
  GEMINI_VERIFIER_MODEL: z.string().default('gemini-flash-latest'),
  OPENAI_MAIN_MODEL: z.string().default('gpt-5'),
  OPENAI_VERIFIER_MODEL: z.string().default('gpt-4.1-nano'),
  CLAUDE_BARE_MODE: booleanString(true),
  PORT: numericString(4321),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MAX_MODEL_CALLS_PER_SESSION: numericString(60),
  DATA_DIR: z.string().optional(),
})
```

- [ ] **Step 2: Rewrite `dev.ts`**

Replace the entire file:

```ts
// src/server/dev.ts
import index from '../client/index.html'
import { createApp } from './index'
import { createDb } from './db/client'
import { loadEnv, type Env } from '@/lib/env'
import { createCodexAdapter } from '@/prompts/adapters/codex'
import { createClaudeAdapter } from '@/prompts/adapters/claude'
import type { ProviderAdapter } from '@/prompts/adapters/types'
import type { Resume } from '@/schema/resume'

export const DEV_SERVER_IDLE_TIMEOUT_SECONDS = 255

const sampleIngest: Resume = {
  version: 1,
  contact: {
    name: 'Sample User',
    email: 'sample@example.com',
    links: [],
  },
  summary: 'Replace with your real resume.',
  roles: [
    {
      id: 'r1',
      company: 'Sample Corp',
      title: 'Engineer',
      startDate: '2022-01',
      endDate: null,
      bullets: [
        {
          id: 'b1',
          text: 'Built a thing.',
          metrics: [],
          skills: [],
          flags: [],
          sourceTurnIds: [],
          status: 'draft',
        },
      ],
    },
  ],
  skills: { categories: [] },
  education: [],
  projects: [],
  certifications: [],
}

function firstBulletIdFromPrompt(prompt: string): string {
  return prompt.match(/"bullets"\s*:\s*\[\s*\{[^}]*"id"\s*:\s*"([^"]+)"/)?.[1] ?? 'b1'
}

function createMockCodexAdapter(): ProviderAdapter {
  return {
    name: 'codex',
    async callInSession({ userPrompt, schema }) {
      let result: unknown
      if (userPrompt.includes('Return exactly 2 candidates')) {
        result = {
          candidates: [
            {
              text: 'Built a reliable CI pipeline for engineering releases.',
              evidenceMap: [
                { span: 'Built', source: 'original' },
                { span: 'reliable', source: 'connective' },
              ],
            },
            {
              text: 'Improved the CI pipeline used by the engineering team.',
              evidenceMap: [
                { span: 'CI pipeline', source: 'original' },
                { span: 'improved', source: 'connective' },
              ],
            },
          ],
        }
      } else if (userPrompt.includes('Resume to critique')) {
        const bulletId = firstBulletIdFromPrompt(userPrompt)
        result = {
          flags: [
            {
              bulletId,
              flag: 'vague',
              severity: 2,
              span: 'Built a thing.',
              why: 'A hiring manager will ask what changed and why it mattered.',
              suggestedQuestion: 'What measurable outcome did this work create?',
            },
          ],
          passSummary: {
            bulletsScanned: 1,
            bulletsFlagged: 1,
            topConcern: 'The resume needs sharper impact evidence.',
          },
        }
      } else {
        result = sampleIngest
      }
      return { result: schema.parse(result), sessionHandle: null }
    },
  }
}

async function probeCliAvailable(bin: string): Promise<boolean> {
  try {
    const proc = Bun.spawn([bin, '--version'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    return (await proc.exited) === 0
  } catch {
    return false
  }
}

export async function createDevAdapters(
  env: Env,
  processEnv: Record<string, string | undefined> = process.env,
): Promise<Record<string, ProviderAdapter>> {
  if (processEnv.RESUME_BUILDER_MOCK_CODEX === '1') {
    const mock = createMockCodexAdapter()
    return { codex: mock, claude: mock }
  }

  const [codexAvailable, claudeAvailable] = await Promise.all([
    probeCliAvailable(env.OPENAI_BIN),
    probeCliAvailable(env.CLAUDE_BIN),
  ])

  const adapters: Record<string, ProviderAdapter> = {}

  // Codex is always included as the default — even if the probe failed,
  // we still construct it so the server boots; runtime errors surface naturally.
  adapters['codex'] = createCodexAdapter({
    bin: env.OPENAI_BIN,
    mainModel: env.OPENAI_MAIN_MODEL,
    verifierModel: env.OPENAI_VERIFIER_MODEL,
  })

  if (claudeAvailable) {
    try {
      adapters['claude'] = createClaudeAdapter({
        bin: env.CLAUDE_BIN,
        bareMode: env.CLAUDE_BARE_MODE,
        apiKey: processEnv.ANTHROPIC_API_KEY,
        mainModel: env.ANTHROPIC_MAIN_MODEL,
        verifierModel: env.ANTHROPIC_VERIFIER_MODEL,
      })
    } catch (e) {
      console.warn(`[dev] Claude adapter skipped: ${(e as Error).message}`)
    }
  }

  if (!codexAvailable) {
    console.warn(`[dev] codex binary not found at "${env.OPENAI_BIN}" — sessions may fail`)
  }

  return adapters
}

if (import.meta.main) {
  const env = loadEnv(process.env)
  const db = createDb(process.env.DATABASE_FILE ?? './dev.db')
  const adapters = await createDevAdapters(env)
  const app = createApp({ db, adapters })

  const server = Bun.serve({
    port: Number(process.env.PORT ?? env.PORT),
    routes: { '/': index },
    fetch: (req) => app.fetch(req),
    idleTimeout: DEV_SERVER_IDLE_TIMEOUT_SECONDS,
    development: { hmr: true, console: true },
  })

  const providerList = Object.keys(adapters).join(', ')
  console.log(`resume-builder dev server: http://localhost:${server.port}`)
  console.log(
    process.env.RESUME_BUILDER_MOCK_CODEX === '1'
      ? 'using mock adapter (both providers)'
      : `available providers: ${providerList}`,
  )
}
```

- [ ] **Step 3: Run type check on modified files**

```bash
bun run tsc --noEmit 2>&1 | grep "env.ts\|dev.ts"
```

Expected: no errors on these two files (route errors still exist from Task 1).

- [ ] **Step 4: Commit**

```bash
git add src/lib/env.ts src/server/dev.ts
git commit -m "feat(dev): probeCliAvailable + createDevAdapters; remove AI_PROVIDER env var"
```

---

## Task 4: Create `GET /api/providers` route

**Files:**
- Create: `src/server/routes/providers.ts`
- Modify: `src/server/index.ts`
- Create: `tests/server/routes/providers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/routes/providers.test.ts
import { describe, it, expect } from 'bun:test'
import { buildTestApp } from './_helpers'

describe('GET /api/providers', () => {
  it('returns available providers and default', async () => {
    const app = buildTestApp()
    const res = await app.fetch(new Request('http://localhost/api/providers'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { available: string[]; default: string }
    expect(body.available).toContain('codex')
    expect(body.available).toContain('claude')
    expect(body.default).toBe('codex')
  })

  it('available list reflects what is in the adapters map', async () => {
    // buildTestApp sets up both codex and claude stubs
    const app = buildTestApp()
    const res = await app.fetch(new Request('http://localhost/api/providers'))
    const body = (await res.json()) as { available: string[] }
    expect(body.available).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

```bash
bun test tests/server/routes/providers.test.ts
```

Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Create `providers.ts` route**

```ts
// src/server/routes/providers.ts
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
```

- [ ] **Step 4: Register the route in `src/server/index.ts`**

Add the import and registration:

```ts
// src/server/index.ts
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
import { personaRoutes } from './routes/persona'
import { providersRoutes } from './routes/providers'

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()

  app.get('/healthz', (c) =>
    c.json({ ok: true, version: packageJson.version }),
  )

  app.route('/api/providers', providersRoutes(deps))
  app.route('/api/sessions', sessionsRoutes(deps))
  app.route('/api/sessions', gatherRoutes(deps))
  app.route('/api/sessions', critiqueRoutes(deps))
  app.route('/api/sessions', flagsRoutes(deps))
  app.route('/api/sessions', editRoutes(deps))
  app.route('/api/sessions', endRoutes(deps))
  app.route('/api/sessions', exportRoutes(deps))
  app.route('/api/persona', personaRoutes(deps))

  return app
}

export type { AppDeps } from './deps'

if (import.meta.main) {
  throw new Error(
    'Direct execution disabled — production composition arrives in phase 2h.',
  )
}
```

- [ ] **Step 5: Run the new tests**

```bash
bun test tests/server/routes/providers.test.ts
```

Expected: 2 pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/providers.ts src/server/index.ts tests/server/routes/providers.test.ts
git commit -m "feat(api): GET /api/providers returns available CLI adapters"
```

---

## Task 5: Add `provider` to `CreateSessionBody` and update sessions route

**Files:**
- Modify: `src/server/schemas/routes.ts`
- Modify: `src/server/routes/sessions.ts`

- [ ] **Step 1: Write the failing tests**

Add two new test cases to `tests/server/routes/e2e.test.ts` in the existing `describe` block (after the existing test):

```ts
// In tests/server/routes/e2e.test.ts — add inside describe block:

it('creates session with provider: claude and stores it', async () => {
  const { fetch, stub } = buildTestApp()
  stub.responses.push({ type: 'ok', value: sampleResumeJson })
  const res = await fetch(
    jsonRequest('POST', '/api/sessions', {
      resume: { kind: 'markdown', text: '# Hi' },
      target: sampleTarget,
      provider: 'claude',
    }),
  )
  expect(res.status).toBe(201)
  const body = (await res.json()) as { snapshot: { provider: string } }
  expect(body.snapshot.provider).toBe('claude')
})

it('falls back to codex when requested provider is not in adapters map', async () => {
  // Build an app with only codex adapter to simulate claude not installed
  const db = createDb(':memory:')
  const stub = createStubAdapter([], { name: 'codex' })
  const app = createApp({ db, adapters: { codex: stub.adapter } })
  stub.responses.push({ type: 'ok', value: sampleResumeJson })

  const res = await app.fetch(
    jsonRequest('POST', '/api/sessions', {
      resume: { kind: 'markdown', text: '# Hi' },
      target: sampleTarget,
      provider: 'claude',
    }),
  )
  expect(res.status).toBe(201)
  const body = (await res.json()) as { snapshot: { provider: string } }
  expect(body.snapshot.provider).toBe('codex')
})
```

Add the needed imports at the top of `tests/server/routes/e2e.test.ts`:

```ts
import { createDb } from '@/server/db/client'
import { createApp } from '@/server/index'
import { createStubAdapter } from '../../orchestrator/_helpers/stubAdapter'
```

- [ ] **Step 2: Run to confirm they fail**

```bash
bun test tests/server/routes/e2e.test.ts
```

Expected: the two new tests FAIL.

- [ ] **Step 3: Add `provider` field to `CreateSessionBody`**

In `src/server/schemas/routes.ts`, update `CreateSessionBody`:

```ts
export const CreateSessionBody = z.object({
  resume: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('markdown'), text: z.string().min(1) }),
    z.object({ kind: z.literal('blank') }),
    z.object({ kind: z.literal('pdf'), data: z.string().min(1) }),
  ]),
  target: TargetContext,
  gather: z.boolean().optional(),
  provider: z.enum(['claude', 'codex']).default('codex'),
})
```

- [ ] **Step 4: Update `sessions.ts` route**

Replace the file:

```ts
// src/server/routes/sessions.ts
import { Hono } from 'hono'
import { Session } from '@/orchestrator/session'
import { CreateSessionBody } from '@/server/schemas/routes'
import { respondWithError } from '@/server/errors'
import { resolveAdapter } from '@/server/deps'
import { getSessionProvider } from '@/server/db/repositories/sessions'
import type { AppDeps } from '@/server/deps'

export function sessionsRoutes(deps: AppDeps): Hono {
  const router = new Hono()

  router.post('/', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch (e) {
      return respondWithError(c, e)
    }
    const parsed = CreateSessionBody.safeParse(body)
    if (!parsed.success) return respondWithError(c, parsed.error)

    try {
      const adapter = resolveAdapter(deps.adapters, parsed.data.provider)
      const session = Session.create(deps.db, adapter)
      await session.ingestResume(parsed.data.resume)
      const enableGather = parsed.data.gather === true
      session.setGatherEnabled(enableGather)
      session.setTarget(parsed.data.target)
      const snapshot = session.snapshot()
      const resume = session.currentResume()
      return c.json({ id: snapshot.id, snapshot, resume }, 201)
    } catch (e) {
      return respondWithError(c, e)
    }
  })

  router.get('/:id', (c) => {
    const idStr = c.req.param('id')
    const id = Number(idStr)
    if (!Number.isInteger(id) || id <= 0) {
      return c.json(
        { error: { code: 'validation', message: 'id must be a positive integer' } },
        400,
      )
    }
    try {
      const provider = getSessionProvider(deps.db, id)
      const adapter = resolveAdapter(deps.adapters, provider)
      const session = Session.load(deps.db, adapter, id)
      const snapshot = session.snapshot()
      const resume = session.currentResume()
      return c.json({ snapshot, resume })
    } catch (e) {
      return respondWithError(c, e)
    }
  })

  return router
}
```

- [ ] **Step 5: Run the tests**

```bash
bun test tests/server/routes/e2e.test.ts
```

Expected: all tests pass including the two new ones.

- [ ] **Step 6: Commit**

```bash
git add src/server/schemas/routes.ts src/server/routes/sessions.ts tests/server/routes/e2e.test.ts
git commit -m "feat(sessions): per-session provider selection with codex fallback"
```

---

## Task 6: Update all remaining session routes

**Files:**
- Modify: `src/server/routes/critique.ts`
- Modify: `src/server/routes/flags.ts`
- Modify: `src/server/routes/gather.ts`
- Modify: `src/server/routes/end.ts`
- Modify: `src/server/routes/edit.ts`
- Modify: `src/server/routes/export.ts`
- Modify: `src/server/routes/persona.ts`

The pattern for every session route (except persona) is:

```ts
// Before
const session = Session.load(deps.db, deps.adapter, id)

// After
const provider = getSessionProvider(deps.db, id)
const session = Session.load(deps.db, resolveAdapter(deps.adapters, provider), id)
```

Add to imports in each file:
```ts
import { resolveAdapter } from '@/server/deps'
import { getSessionProvider } from '@/server/db/repositories/sessions'
```

- [ ] **Step 1: Update `critique.ts`**

```ts
// src/server/routes/critique.ts
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { Session } from '@/orchestrator/session'
import { respondWithError } from '@/server/errors'
import { resolveAdapter } from '@/server/deps'
import { getSessionProvider } from '@/server/db/repositories/sessions'
import type { AppDeps } from '@/server/deps'

export const CRITIQUE_SSE_KEEPALIVE_MS = 5_000

export function critiqueRoutes(deps: AppDeps): Hono {
  const router = new Hono()

  router.post('/:id/critique', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) {
      return c.json(
        { error: { code: 'validation', message: 'id must be a positive integer' } },
        400,
      )
    }

    let session: Session
    try {
      const provider = getSessionProvider(deps.db, id)
      session = Session.load(deps.db, resolveAdapter(deps.adapters, provider), id)
    } catch (e) {
      return respondWithError(c, e)
    }

    return streamSSE(c, async (stream) => {
      const ac = new AbortController()
      stream.onAbort(() => ac.abort())

      try {
        const iterator = session.runCritique({ signal: ac.signal })[
          Symbol.asyncIterator
        ]()

        while (!stream.aborted) {
          const next = iterator.next()
          let outcome = await Promise.race([
            next.then((result) => ({ type: 'event' as const, result })),
            stream
              .sleep(CRITIQUE_SSE_KEEPALIVE_MS)
              .then(() => ({ type: 'keepalive' as const })),
          ])

          while (outcome.type === 'keepalive' && !stream.aborted) {
            await stream.write(': keepalive\n\n')
            outcome = await Promise.race([
              next.then((result) => ({ type: 'event' as const, result })),
              stream
                .sleep(CRITIQUE_SSE_KEEPALIVE_MS)
                .then(() => ({ type: 'keepalive' as const })),
            ])
          }

          if (stream.aborted || outcome.type === 'keepalive') break
          if (outcome.result.done) break
          const evt = outcome.result.value
          await stream.writeSSE({
            event: evt.type,
            data: JSON.stringify(evt),
          })
          if (evt.type === 'done' || evt.type === 'error') break
        }
      } catch (e) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            code: 'internal',
            message: (e as Error).message,
          }),
        })
      }
    })
  })

  return router
}
```

- [ ] **Step 2: Update `flags.ts`**

Change all four `Session.load` calls:

```ts
// src/server/routes/flags.ts — add these imports
import { resolveAdapter } from '@/server/deps'
import { getSessionProvider } from '@/server/db/repositories/sessions'
```

Replace every occurrence of:
```ts
const session = Session.load(deps.db, deps.adapter, ids.id)
```

With:
```ts
const provider = getSessionProvider(deps.db, ids.id)
const session = Session.load(deps.db, resolveAdapter(deps.adapters, provider), ids.id)
```

There are 4 occurrences (accept, skip, dismiss, rewrite handlers).

- [ ] **Step 3: Update `gather.ts`**

Add imports:
```ts
import { resolveAdapter } from '@/server/deps'
import { getSessionProvider } from '@/server/db/repositories/sessions'
```

Replace every occurrence of:
```ts
const session = Session.load(deps.db, deps.adapter, id)
```

With:
```ts
const provider = getSessionProvider(deps.db, id)
const session = Session.load(deps.db, resolveAdapter(deps.adapters, provider), id)
```

There are 4 occurrences (ask, answer, skip, end handlers).

- [ ] **Step 4: Update `end.ts`**

```ts
// src/server/routes/end.ts
import { Hono } from 'hono'
import { Session } from '@/orchestrator/session'
import { respondWithError } from '@/server/errors'
import { resolveAdapter } from '@/server/deps'
import { getSessionProvider } from '@/server/db/repositories/sessions'
import type { AppDeps } from '@/server/deps'

export function endRoutes(deps: AppDeps): Hono {
  const router = new Hono()

  router.post('/:id/end', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: { code: 'validation' } }, 400)
    }
    try {
      const provider = getSessionProvider(deps.db, id)
      const session = Session.load(deps.db, resolveAdapter(deps.adapters, provider), id)
      const review = await session.endInterrogation()
      return c.json({ snapshot: session.snapshot(), review })
    } catch (e) {
      return respondWithError(c, e)
    }
  })

  return router
}
```

- [ ] **Step 5: Update `edit.ts`**

Add imports:
```ts
import { resolveAdapter } from '@/server/deps'
import { getSessionProvider } from '@/server/db/repositories/sessions'
```

Replace:
```ts
const session = Session.load(deps.db, deps.adapter, id)
```

With:
```ts
const provider = getSessionProvider(deps.db, id)
const session = Session.load(deps.db, resolveAdapter(deps.adapters, provider), id)
```

- [ ] **Step 6: Update `export.ts`**

Add imports:
```ts
import { resolveAdapter } from '@/server/deps'
import { getSessionProvider } from '@/server/db/repositories/sessions'
```

Replace:
```ts
const session = Session.load(deps.db, deps.adapter, id)
```

With:
```ts
const provider = getSessionProvider(deps.db, id)
const session = Session.load(deps.db, resolveAdapter(deps.adapters, provider), id)
```

- [ ] **Step 7: Update `persona.ts`**

The persona route is stateless — it calls the adapter directly without a session. Use the default (codex) adapter.

Add import:
```ts
import { resolveAdapter } from '@/server/deps'
```

Replace:
```ts
const out = await deps.adapter.callInSession({
```

With:
```ts
const out = await resolveAdapter(deps.adapters, 'codex').callInSession({
```

- [ ] **Step 8: Run the full test suite**

```bash
bun test
```

Expected: 307 pass, 2 skip, 0 fail. (All existing tests pass unchanged; the adapter map is transparent to test assertions.)

- [ ] **Step 9: Run type check**

```bash
bun run tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 10: Commit**

```bash
git add src/server/routes/critique.ts src/server/routes/flags.ts src/server/routes/gather.ts src/server/routes/end.ts src/server/routes/edit.ts src/server/routes/export.ts src/server/routes/persona.ts
git commit -m "refactor(routes): resolve adapter per-session via getSessionProvider"
```

---

## Task 7: Frontend — provider picker and session badge

**Files:**
- Modify: `src/client/lib/api.ts`
- Modify: `src/client/screens/SetupScreen.tsx`
- Modify: `src/client/screens/SessionScreen.tsx`

- [ ] **Step 1: Add `getProviders` to `api.ts`**

Add after the existing `getSession` function:

```ts
export interface ProvidersResponse {
  available: string[]
  default: string
}

export async function getProviders(): Promise<ProvidersResponse> {
  return requestJson<ProvidersResponse>('/api/providers')
}
```

- [ ] **Step 2: Add provider field to `FormValues` in `SetupScreen.tsx`**

Add `provider` to the `FormValues` type:

```ts
type FormValues = {
  resumeText: string
  targetRole: string
  targetSeniority: (typeof Seniority.options)[number]
  industry: string
  jobDescription: string
  archetype: (typeof Archetype.options)[number]
  tone: (typeof Tone.options)[number]
  provider: 'claude' | 'codex'
}
```

- [ ] **Step 3: Add `getProviders` import and query to `SetupScreen.tsx`**

Add import:
```ts
import { useQuery } from '@tanstack/react-query'
import {
  createSession,
  proposePersona,
  getProviders,
  type CreateSessionResponse,
  type ApiError,
} from '@/client/lib/api'
```

Add query inside the component (after the existing `proposeMut`):
```ts
const { data: providers } = useQuery({
  queryKey: ['providers'],
  queryFn: getProviders,
})
```

- [ ] **Step 4: Update `defaultValues` to include provider**

```ts
defaultValues: {
  resumeText: '',
  targetRole: '',
  targetSeniority: 'senior',
  industry: '',
  jobDescription: '',
  archetype: 'engineering-manager',
  tone: 'skeptical',
  provider: 'codex',
},
```

- [ ] **Step 5: Include `provider` in the session body**

In the `mutationFn`, update the body construction:

```ts
const body = {
  resume,
  target: {
    targetRole: values.targetRole,
    targetSeniority: values.targetSeniority,
    industry: values.industry || undefined,
    jobDescription: values.jobDescription || undefined,
    persona: { archetype: values.archetype, tone: values.tone },
  },
  gather: true,
  provider: values.provider,
}
```

- [ ] **Step 6: Add the provider picker UI to `SetupScreen.tsx`**

Add this block inside the form, just above the archetype/tone grid:

```tsx
<div className="space-y-2">
  <Label>Provider</Label>
  <div className="flex gap-6">
    {(['codex', 'claude'] as const).map((p) => {
      const available = providers?.available.includes(p) ?? p === 'codex'
      return (
        <label
          key={p}
          className={`flex items-center gap-2 cursor-pointer ${
            !available ? 'opacity-40 cursor-not-allowed' : ''
          }`}
        >
          <input
            type="radio"
            value={p}
            disabled={!available}
            data-testid={`provider-${p}`}
            {...form.register('provider')}
            className="accent-primary"
          />
          <span className="text-sm capitalize">{p}</span>
          {!available && (
            <span className="text-xs text-muted-foreground">(not installed)</span>
          )}
        </label>
      )
    })}
  </div>
</div>
```

- [ ] **Step 7: Add the provider badge to `SessionScreen.tsx`**

In the header row of `SessionScreen`, update the `<p>` tag that shows state + provider to make the provider a distinct badge:

```tsx
<div>
  <h1 className="text-2xl font-semibold">Session {sessionId}</h1>
  <div className="flex items-center gap-2 mt-0.5">
    <p className="text-sm text-muted-foreground">{displayState}</p>
    {session.data.snapshot.provider && (
      <span
        data-testid="provider-badge"
        className="inline-flex items-center rounded-full border border-input bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
      >
        {session.data.snapshot.provider}
      </span>
    )}
  </div>
</div>
```

- [ ] **Step 8: Run all tests**

```bash
bun test
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/client/lib/api.ts src/client/screens/SetupScreen.tsx src/client/screens/SessionScreen.tsx
git commit -m "feat(ui): per-session provider picker and session provider badge"
```

---

## Task 8: Verification

- [ ] **Step 1: Run full test suite**

```bash
bun test
```

Expected: ≥ 309 pass (307 existing + 2 new in providers.test.ts), 0 fail.

- [ ] **Step 2: Run type check**

```bash
bun run tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Verify schema test still covers the new `provider` field**

```bash
bun test tests/server/schemas/routes.test.ts
```

All existing tests should pass. The new `provider` field has a `.default('codex')` so existing test bodies without `provider` remain valid.

- [ ] **Step 4: Commit the spec and plan doc if not already committed**

```bash
git add docs/superpowers/specs/2026-05-10-phase-4-providers.md docs/superpowers/plans/2026-05-10-phase-4-providers.md
git commit -m "docs: Phase 4 providers spec and implementation plan"
```

---

## Self-review notes

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Each provider's adapter constructed on boot if CLI passes `--version` | Task 3 |
| `AI_PROVIDER` env var removed | Task 3 |
| `GET /api/providers` returns available + default | Task 4 |
| `CreateSessionBody` has `provider` field | Task 5 |
| Codex default + fallback when provider not in map | Task 5 |
| `getSessionProvider` helper throws `SessionNotFoundError` for missing id | Task 2 |
| All session routes resolve adapter via `getSessionProvider` | Task 6 |
| SetupScreen provider picker | Task 7 |
| SessionScreen provider badge | Task 7 |
| Existing 307 tests pass unchanged | Task 6 step 8 |
| `buildTestApp` passes adapters map | Task 1 |

All spec requirements covered.
