# Sub-plan 3a — Gather phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Land the "gather" phase between target-setting and critique. The Skeptical Interviewer asks one broad question per role + up to 2 targeted follow-ups, captures the user's text answers, and attaches the captured turns to the role for use during critique.

**Architecture:** New `gather_turns` table keyed by `(sessionId, roleId)`. Two new templates (`gather-broad.md`, `gather-followup.md`). State machine already has a `gather` state with the right events; current code auto-transitions through it via `BEGIN_CRITIQUE` in `setTarget()` — this plan removes that auto-transition and adds the orchestrator/route/UI surface that lives in the gather state. Per-role flow: ask broad → user answers → AI decides done-or-followup (max 2) → next role. User can `/skip` a role or `/end` gather at any time (UX guardrail D6: never hard-block).

**Tech stack:** Bun, Hono, bun:sqlite, React 19, TanStack Query, codex adapter (already wired). No new deps.

---

## Design decisions (resolved before tasks)

### D1. Persist gather turns in their own table, not on the resume blob

A new `gather_turns(id INTEGER PRIMARY KEY, session_id INTEGER, role_id TEXT, turn_kind TEXT, question TEXT, answer TEXT, created_at INTEGER)` table. Two reasons:
1. Resume blob churn is already high (every flag-accept rewrites the whole `content_json`). Gather adds 1–3 turns × N roles of text — that bloats the resume diff for no rendering reason.
2. The bullets' existing `sourceTurnIds` field uses turn IDs, which only make sense as integers in a separate table. Putting them in a sibling table makes the FK relationship explicit.

The original spec hand-waved over storage; this is the locked decision.

### D2. One question at a time, server-driven

The orchestrator exposes `Session.nextGatherQuestion(roleId)` which returns either a broad-or-followup question OR `{ done: true, reason }`. The frontend never decides; it just renders whatever question the server gave it. The server tracks `MAX_FOLLOWUPS_PER_ROLE = 2` and stops on cap. This keeps the UI dumb and the server authoritative.

### D3. Roles are processed in resume order

Frontend walks `resume.roles` top-to-bottom. Projects are excluded from gather in 3a (gather is about flesh-on-the-bones for paid work; projects are deferred to a future iteration if real-world dogfooding shows they need it).

### D4. Per-role and per-session gather skip

Two skip levels:
- **Skip role:** advance to next role without recording answers for the current role. Records a single `gather_turns` row with `turn_kind = 'skip'` so the audit trail is complete.
- **End gather:** stop entirely and transition to critique, even if roles remain.

Both wired through the same `/end` route; "skip role" is a client-side advance with no special server route — the next role is just whatever the client asks about next.

### D5. No streaming for gather questions

Gather is a request-response loop, not streaming. Each `POST .../ask` returns one question synchronously. SSE was the right call for critique (8 flags streamed in over seconds); gather is "give me one Q, wait for human", so streaming adds latency without value.

### D6. Auto-transition removal: opt-in to legacy by env flag

Removing the auto-`BEGIN_CRITIQUE` from `setTarget()` is a behavior-breaking change for the existing thin-slice tests. To keep them green during transition, gate the new behavior on a session-level flag (`gather_enabled` column on `sessions` table, default `false`). When `false`, `setTarget` keeps emitting `BEGIN_CRITIQUE` immediately. When `true`, it stops at the `gather` state. New sessions created via `POST /api/sessions` with `target.gather === true` (or omitted with default `true` in 3a — see step) get `gather_enabled = 1`. Old tests passing `target` without the flag stay green by passing `gather_enabled = 0`.

> **Rationale:** Avoids a thrash-rewrite of every `Session.create()` test. The flag is removed in a follow-up cleanup commit once gather is dogfooded; no plan to keep the flag long-term.

### D7. Frontend lives inside `SessionScreen`, not a new screen

`SessionScreen.tsx` already handles `state === 'critique'`. Add a branch for `state === 'gather'` that mounts a `<GatherStep />` sub-component. Avoids URL routing changes; gather and critique share the same `/session/:id` URL. The backend's snapshot tells the client which view to render.

---

## File structure

**Created:**

```
src/prompts/templates/gather-broad.md
src/prompts/templates/gather-followup.md
src/server/db/migrations/0002_gather_turns.sql           # if migrations are file-based; else inline in client.ts
src/server/db/repos/gatherTurns.ts                       # repo for the new table
src/orchestrator/gather.ts                               # gather-only Session helpers (or add to session.ts; see D8)
src/server/routes/gather.ts                              # 3 routes: /ask, /answer, /end-or-begin
src/client/components/GatherStep.tsx                     # the per-role Q&A UI
tests/orchestrator/gather.test.ts
tests/server/routes/gather.test.ts
tests/client/gatherStep.test.tsx
```

**Modified:**

```
src/schema/events.ts            # add 'BEGIN_GATHER' if not present (verify)
src/state/states.ts             # ensure target/persona allow BEGIN_GATHER, gather allows BEGIN_CRITIQUE; verify current shape
src/server/db/client.ts         # add gather_turns table + gather_enabled column on sessions (or migration script)
src/server/db/repos/sessions.ts # gather_enabled getter/setter
src/orchestrator/session.ts     # gate setTarget auto-transition behind gather_enabled
src/server/schemas/routes.ts    # GatherAskBody / GatherAnswerBody / etc.
src/server/index.ts             # mount gatherRoutes
src/client/lib/api.ts           # askGatherQuestion / recordGatherAnswer / endGather
src/client/screens/SessionScreen.tsx  # render <GatherStep /> when state === 'gather'
docs/architecture-notes.md      # D1, D2, D6 entries
```

### D8. Gather logic on `Session` directly, not a separate class

`Session.askBroad`, `Session.askFollowup`, `Session.recordAnswer`, `Session.endGather` are methods on `Session` (not a separate `GatherEngine` class). Reasoning: `Session` already aggregates the orchestration concerns (budget, adapter, transactions). A sibling class would re-import all of those. The methods are colocated and well-named. The file approaches the size where it might split — if it crosses 700 lines after this work, follow-up commit can extract.

---

## Sequencing rationale

1. **T1 (schema migration):** new table + column unblock everything else.
2. **T2 (templates):** files-on-disk; no logic, fast.
3. **T3 (orchestrator):** `Session.nextGatherQuestion`, `recordAnswer`, `endGather`, plus `setTarget` behavior gate. Tested against the codex stub adapter.
4. **T4 (HTTP routes):** thin protocol-translation seam over T3.
5. **T5 (client API helpers):** typed `askGather`/`answerGather`/`endGather`.
6. **T6 (GatherStep component):** UI walks roles, renders one Q at a time.
7. **T7 (SessionScreen wire-up):** branch on `snapshot.state` to mount GatherStep.
8. **T8 (e2e test):** full happy-path through gather → critique via the HTTP layer.
9. **T9 (architecture notes):** decisions document.
10. **T10 (verify):** type-check + full test run.

Each task ends with a commit; all commits build and type-check.

---

## Task 1: Schema — `gather_turns` table + `sessions.gather_enabled` column

**Files:**

- Modify: `src/server/db/client.ts` (or a new migration if migrations are file-based — VERIFY current pattern first)
- Modify: `src/server/db/repos/sessions.ts`
- Create: `src/server/db/repos/gatherTurns.ts`

### Pre-flight

```bash
cat src/server/db/client.ts | head -80
ls src/server/db/migrations/ 2>/dev/null
ls src/server/db/repos/
```

Determine whether tables are inline (in `client.ts`) or file-based migrations. **Match the existing pattern.** If file-based, add `0002_gather_turns.sql`. If inline, extend the bootstrap SQL in `client.ts`.

- [ ] **Step 1: Add the table + column**

Schema:
```sql
ALTER TABLE sessions ADD COLUMN gather_enabled INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS gather_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  role_id TEXT NOT NULL,
  turn_kind TEXT NOT NULL CHECK (turn_kind IN ('broad', 'followup', 'skip', 'done')),
  question TEXT,
  answer TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gather_turns_session_role
  ON gather_turns(session_id, role_id, created_at);
```

`turn_kind`: `'broad'` = the opening broad Q, `'followup'` = funnel follow-up, `'skip'` = role skipped, `'done'` = AI decided no more follow-ups.

`gather_enabled` defaults to `1` (new sessions opt-in to gather). Existing test sessions construct via `Session.create` which now picks up the default. Tests that need the legacy behavior pass `gather_enabled: 0` explicitly via a setter — see T3.

- [ ] **Step 2: `src/server/db/repos/gatherTurns.ts`**

```ts
import type { Database } from 'bun:sqlite'

export interface GatherTurnRow {
  id: number
  sessionId: number
  roleId: string
  turnKind: 'broad' | 'followup' | 'skip' | 'done'
  question: string | null
  answer: string | null
  createdAt: number
}

export class GatherTurnsRepo {
  constructor(private db: Database) {}

  insertQuestion(args: {
    sessionId: number
    roleId: string
    turnKind: 'broad' | 'followup' | 'done'
    question: string | null
  }): number {
    const now = Date.now()
    const stmt = this.db.query<{ id: number }, []>(
      `INSERT INTO gather_turns (session_id, role_id, turn_kind, question, answer, created_at)
       VALUES (?, ?, ?, ?, NULL, ?) RETURNING id`,
    )
    const row = this.db
      .prepare(
        `INSERT INTO gather_turns (session_id, role_id, turn_kind, question, answer, created_at)
         VALUES (?, ?, ?, ?, NULL, ?) RETURNING id`,
      )
      .get(args.sessionId, args.roleId, args.turnKind, args.question, now) as { id: number }
    return row.id
  }

  insertSkip(args: { sessionId: number; roleId: string }): number {
    const now = Date.now()
    const row = this.db
      .prepare(
        `INSERT INTO gather_turns (session_id, role_id, turn_kind, question, answer, created_at)
         VALUES (?, ?, 'skip', NULL, NULL, ?) RETURNING id`,
      )
      .get(args.sessionId, args.roleId, now) as { id: number }
    return row.id
  }

  recordAnswer(turnId: number, answer: string): void {
    this.db.prepare(`UPDATE gather_turns SET answer = ? WHERE id = ?`).run(answer, turnId)
  }

  forRole(sessionId: number, roleId: string): GatherTurnRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, session_id AS sessionId, role_id AS roleId, turn_kind AS turnKind,
                question, answer, created_at AS createdAt
         FROM gather_turns
         WHERE session_id = ? AND role_id = ?
         ORDER BY created_at ASC`,
      )
      .all(sessionId, roleId) as GatherTurnRow[]
    return rows
  }

  countFollowups(sessionId: number, roleId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM gather_turns
         WHERE session_id = ? AND role_id = ? AND turn_kind = 'followup'`,
      )
      .get(sessionId, roleId) as { n: number }
    return row.n
  }
}
```

(The duplicated `stmt` line is intentional removal — only the second prepare/get is needed; delete the first `this.db.query` block when implementing. The agent should drop it.)

- [ ] **Step 3: `sessions.ts` repo additions**

Add two methods to the existing `SessionsRepo`:
```ts
getGatherEnabled(id: number): boolean {
  const row = this.db.prepare(`SELECT gather_enabled AS g FROM sessions WHERE id = ?`).get(id) as { g: number } | null
  if (!row) throw new Error(`Session not found: ${id}`)
  return row.g === 1
}

setGatherEnabled(id: number, enabled: boolean): void {
  this.db.prepare(`UPDATE sessions SET gather_enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id)
}
```

- [ ] **Step 4: Migration test**

Create `tests/server/db/gatherTurns.test.ts`:
```ts
import { describe, it, expect } from 'bun:test'
import { createDb } from '@/server/db/client'
import { GatherTurnsRepo } from '@/server/db/repos/gatherTurns'

describe('GatherTurnsRepo', () => {
  it('inserts and retrieves turns by role', () => {
    const db = createDb(':memory:')
    // pre-create a session row that the FK references
    db.prepare(
      `INSERT INTO sessions (id, state, persona_archetype, persona_tone, target_role, target_seniority, allow_extra_usage, model_calls_made, gather_enabled, created_at)
       VALUES (1, 'gather', 'engineering-manager', 'skeptical', 'X', 'senior', 0, 0, 1, 0)`,
    ).run()

    const repo = new GatherTurnsRepo(db)
    const id1 = repo.insertQuestion({ sessionId: 1, roleId: 'r1', turnKind: 'broad', question: 'tell me' })
    repo.recordAnswer(id1, 'I built X')
    const id2 = repo.insertQuestion({ sessionId: 1, roleId: 'r1', turnKind: 'followup', question: 'how big' })
    repo.recordAnswer(id2, 'team of 5')

    const turns = repo.forRole(1, 'r1')
    expect(turns).toHaveLength(2)
    expect(turns[0]!.question).toBe('tell me')
    expect(turns[0]!.answer).toBe('I built X')
    expect(turns[1]!.turnKind).toBe('followup')
    expect(repo.countFollowups(1, 'r1')).toBe(1)
  })
})
```

> The `INSERT INTO sessions` literal above is illustrative — adjust column names/values to match the actual `sessions` table shape after the `gather_enabled` column was added. **Read `src/server/db/client.ts` first to get the current sessions schema** and produce a literal that satisfies all NOT NULL columns.

- [ ] **Step 5: Run tests + commit**

```bash
bun test tests/server/db/gatherTurns.test.ts
bun run type-check
git add -A src/server/db/ tests/server/db/gatherTurns.test.ts
git commit -m "feat(db): gather_turns table + sessions.gather_enabled column"
```

---

## Task 2: Gather templates

**Files:**

- Create: `src/prompts/templates/gather-broad.md`
- Create: `src/prompts/templates/gather-followup.md`

- [ ] **Step 1: `gather-broad.md`**

```md
{{persona}}

You are interviewing the candidate about ONE role on their resume:

Company: {{role_company}}
Title: {{role_title}}
Dates: {{role_dates}}
Existing bullets:
{{existing_bullets}}

Target context:
{{target_context}}

Your job is to ask ONE open-ended question — at most 2 sentences — that gets the candidate to talk about something specific to this role that ISN'T already on the resume. Don't ask "tell me about your work" — anchor the question to the company, the title, the dates, or a gap you notice in the bullets.

Output strictly as JSON conforming to:
{
  "question": string  // your question, ≤2 sentences
}
```

- [ ] **Step 2: `gather-followup.md`**

```md
{{persona}}

You are mid-interview about this role:

Company: {{role_company}}
Title: {{role_title}}

The candidate's running answer so far:
{{user_answer_so_far}}

Follow-ups already asked (do not repeat):
{{followups_already_asked}}

Thin-spot triggers to look for:
- A leadership/ownership claim with no scope (no team size, budget, timeline)
- A project mentioned by name with no outcome
- Vague time qualifiers ("for a while", "eventually")
- A skill mentioned without context of use ("worked with Kafka")

Decide whether ONE more follow-up question is worth asking. If a thin spot is genuinely there and the candidate hasn't addressed it, ask it. Otherwise return done.

Hard rule: at most 2 follow-ups per role. If 2 have already been asked, you must return done.

Output JSON conforming to one of:
{
  "done": true,
  "reason": string  // why you're stopping
}
OR
{
  "done": false,
  "followUp": string,            // your next question
  "trigger": "scope" | "outcome" | "time" | "context"
}
```

- [ ] **Step 3: Template integrity test**

Add `tests/prompts/gather-templates.test.ts`:
```ts
import { describe, it, expect } from 'bun:test'

describe('gather templates', () => {
  it('gather-broad has required slots', async () => {
    const text = await Bun.file('src/prompts/templates/gather-broad.md').text()
    for (const slot of ['{{persona}}', '{{role_company}}', '{{role_title}}', '{{role_dates}}', '{{existing_bullets}}', '{{target_context}}']) {
      expect(text).toContain(slot)
    }
  })

  it('gather-followup has required slots', async () => {
    const text = await Bun.file('src/prompts/templates/gather-followup.md').text()
    for (const slot of ['{{persona}}', '{{role_company}}', '{{role_title}}', '{{user_answer_so_far}}', '{{followups_already_asked}}']) {
      expect(text).toContain(slot)
    }
  })
})
```

- [ ] **Step 4: Run tests + commit**

```bash
bun test tests/prompts/gather-templates.test.ts
git add src/prompts/templates/gather-broad.md src/prompts/templates/gather-followup.md tests/prompts/gather-templates.test.ts
git commit -m "feat(prompts): add gather-broad and gather-followup templates"
```

---

## Task 3: Orchestrator — `Session` gather methods

**Files:**

- Modify: `src/orchestrator/session.ts`
- Create: `tests/orchestrator/gather.test.ts`

### Schemas to add (inline in session.ts or a new file `outputs.ts`)

```ts
const GatherBroadOutput = z.object({ question: z.string().min(1) })
const GatherFollowupOutput = z.discriminatedUnion('done', [
  z.object({ done: z.literal(true), reason: z.string() }),
  z.object({
    done: z.literal(false),
    followUp: z.string().min(1),
    trigger: z.enum(['scope', 'outcome', 'time', 'context']),
  }),
])
```

### New methods on `Session`

```ts
async nextGatherQuestion(args: { roleId: string }): Promise<
  | { kind: 'broad' | 'followup'; turnId: number; question: string }
  | { kind: 'done'; reason: string }
> {
  if (this.state !== 'gather') throw new Error('not allowed: not in gather state')
  const role = this.findRole(args.roleId)
  if (!role) throw new Error(`Role not found: ${args.roleId}`)

  const existing = this.gatherTurns.forRole(this.getId(), args.roleId)
  const hasBroad = existing.some((t) => t.turnKind === 'broad')
  const followupCount = this.gatherTurns.countFollowups(this.getId(), args.roleId)

  if (!hasBroad) {
    // Broad question
    const tpl = await loadGatherBroadTemplate()
    const userPrompt = render(tpl, {
      persona: this.systemPrompt(),
      role_company: role.company,
      role_title: role.title,
      role_dates: `${role.startDate} – ${role.endDate ?? 'present'}`,
      existing_bullets: role.bullets.map((b) => `- ${b.text}`).join('\n') || '(none)',
      target_context: this.targetContextString(),
    })
    this.budget.recordCall()
    const out = await this.adapter.callInSession({
      sessionHandle: null,
      tier: 'main',
      systemPrompt: this.systemPrompt(),
      userPrompt,
      schema: GatherBroadOutput,
    })
    this.recordTelemetry('gather-broad')
    const turnId = this.gatherTurns.insertQuestion({
      sessionId: this.getId(),
      roleId: args.roleId,
      turnKind: 'broad',
      question: out.result.question,
    })
    return { kind: 'broad', turnId, question: out.result.question }
  }

  // Cap check
  if (followupCount >= MAX_FOLLOWUPS_PER_ROLE) {
    const turnId = this.gatherTurns.insertQuestion({
      sessionId: this.getId(),
      roleId: args.roleId,
      turnKind: 'done',
      question: null,
    })
    void turnId
    return { kind: 'done', reason: 'follow-up cap reached' }
  }

  // Follow-up question
  const userAnswerSoFar = existing
    .filter((t) => t.answer)
    .map((t) => `Q: ${t.question}\nA: ${t.answer}`)
    .join('\n\n')
  const followupsAsked = existing
    .filter((t) => t.turnKind === 'followup')
    .map((t) => `- ${t.question}`)
    .join('\n') || '(none)'

  const tpl = await loadGatherFollowupTemplate()
  const userPrompt = render(tpl, {
    persona: this.systemPrompt(),
    role_company: role.company,
    role_title: role.title,
    user_answer_so_far: userAnswerSoFar || '(no answer yet)',
    followups_already_asked: followupsAsked,
  })
  this.budget.recordCall()
  const out = await this.adapter.callInSession({
    sessionHandle: null,
    tier: 'main',
    systemPrompt: this.systemPrompt(),
    userPrompt,
    schema: GatherFollowupOutput,
  })
  this.recordTelemetry('gather-followup')

  if (out.result.done) {
    const turnId = this.gatherTurns.insertQuestion({
      sessionId: this.getId(),
      roleId: args.roleId,
      turnKind: 'done',
      question: null,
    })
    void turnId
    return { kind: 'done', reason: out.result.reason }
  }

  const turnId = this.gatherTurns.insertQuestion({
    sessionId: this.getId(),
    roleId: args.roleId,
    turnKind: 'followup',
    question: out.result.followUp,
  })
  return { kind: 'followup', turnId, question: out.result.followUp }
}

recordGatherAnswer(args: { turnId: number; answer: string }): void {
  if (this.state !== 'gather') throw new Error('not allowed: not in gather state')
  this.db.transaction(() => {
    this.gatherTurns.recordAnswer(args.turnId, args.answer)
    this.applyEvent({ type: 'USER_MESSAGE', text: args.answer })
  })()
}

skipGatherRole(args: { roleId: string }): void {
  if (this.state !== 'gather') throw new Error('not allowed: not in gather state')
  this.gatherTurns.insertSkip({ sessionId: this.getId(), roleId: args.roleId })
}

endGather(): void {
  if (this.state !== 'gather') throw new Error('not allowed: not in gather state')
  this.applyEvent({ type: 'BEGIN_CRITIQUE' })
}

private targetContextString(): string {
  const ctx = this.sessions.getTargetContext(this.getId())
  if (!ctx) return ''
  return JSON.stringify(ctx, null, 2)
}

private findRole(roleId: string): Resume['roles'][number] | null {
  return this.currentResume().roles.find((r) => r.id === roleId) ?? null
}
```

Plus a constant: `const MAX_FOLLOWUPS_PER_ROLE = 2`.

### setTarget gating change

```ts
setTarget(ctx: TargetContext): void {
  this.db.transaction(() => {
    this.sessions.setTargetContext(this.getId(), ctx)
    this.sessions.setPersona(this.getId(), ctx.persona)
  })()
  this.applyEvent({ type: 'SET_TARGET', ctx })
  this.applyEvent({ type: 'CONFIRM_PERSONA' })
  if (this.sessions.getGatherEnabled(this.getId())) {
    // Stay in 'gather'; client will drive nextGatherQuestion calls.
  } else {
    this.applyEvent({ type: 'BEGIN_CRITIQUE' })
  }
}
```

`Session` constructor needs to receive a `GatherTurnsRepo` alongside the existing repos. Wire it in `Session.create` and `Session.load`.

### Template loaders

Mirror `loadIngestTemplate` / `loadCritiqueTemplate`:
```ts
let cachedGatherBroad: string | null = null
async function loadGatherBroadTemplate(): Promise<string> {
  if (cachedGatherBroad) return cachedGatherBroad
  cachedGatherBroad = await Bun.file(join(PROMPTS_DIR, 'templates/gather-broad.md')).text()
  return cachedGatherBroad
}

let cachedGatherFollowup: string | null = null
async function loadGatherFollowupTemplate(): Promise<string> {
  if (cachedGatherFollowup) return cachedGatherFollowup
  cachedGatherFollowup = await Bun.file(join(PROMPTS_DIR, 'templates/gather-followup.md')).text()
  return cachedGatherFollowup
}
```

### Tests: `tests/orchestrator/gather.test.ts`

Cover at minimum:
1. Fresh session with `gather_enabled = 1` (default) stays in `gather` after `setTarget`, doesn't auto-transition.
2. Session with `gather_enabled = 0` (legacy) transitions straight to `critique` after `setTarget` (regression guard).
3. First call to `nextGatherQuestion(roleId)` returns a `broad` question, persists a turn, increments budget by 1.
4. Calling `recordGatherAnswer` updates the turn's answer.
5. Second call to `nextGatherQuestion` (with one broad answered) returns either a `followup` or `done`. Stub the adapter to return `{ done: false, followUp: 'how big?', trigger: 'scope' }` and assert.
6. After 2 follow-ups, third call returns `{ kind: 'done', reason: 'follow-up cap reached' }` without calling the adapter (budget unchanged).
7. `endGather()` transitions to `critique`.

Use the existing `createStubAdapter` pattern with mutable `responses`.

- [ ] **Step 1: Add the GatherTurnsRepo wiring + new schemas + methods + template loaders**
- [ ] **Step 2: Update `setTarget` to gate on `gather_enabled`**
- [ ] **Step 3: Write the 7-case test file**
- [ ] **Step 4: Run tests + type-check + commit**

```bash
bun test tests/orchestrator/gather.test.ts
bun test  # full suite must still pass
bun run type-check
git add src/orchestrator/session.ts tests/orchestrator/gather.test.ts
git commit -m "feat(orchestrator): Session gather methods + setTarget gating"
```

> **Critical: full-suite green required before commit.** The `gather_enabled = 1` default will land most tests in the gather state instead of auto-advancing to critique. Tests that asserted `state === 'critique'` after `setTarget` either need `setGatherEnabled(false)` calls or need to add a `Session.endGather()` call. Audit `tests/orchestrator/session.test.ts` and `tests/server/routes/*.test.ts` and update each. **This is a real cleanup pass — budget time for it.** Each test that breaks gets one of two fixes:
> - **Best:** insert `session.skipGatherRole / endGather` in the test setup to traverse gather realistically.
> - **Acceptable:** call `setGatherEnabled(false)` on the session before `setTarget` (legacy path).
>
> Don't bypass with broader code changes.

---

## Task 4: HTTP routes — `gather`

**Files:**

- Create: `src/server/routes/gather.ts`
- Modify: `src/server/index.ts` (mount the router)
- Modify: `src/server/schemas/routes.ts` (request bodies)
- Create: `tests/server/routes/gather.test.ts`

### Routes

```
POST /api/sessions/:id/gather/role/:roleId/ask        → { kind, turnId?, question?, reason? }
POST /api/sessions/:id/gather/role/:roleId/answer     body: { turnId, answer } → { ok: true }
POST /api/sessions/:id/gather/role/:roleId/skip       → { ok: true }
POST /api/sessions/:id/gather/end                     → { snapshot }
```

### Schemas (`src/server/schemas/routes.ts` additions)

```ts
export const GatherAnswerBody = z.object({
  turnId: z.number().int().positive(),
  answer: z.string().min(1),
})
export type GatherAnswerBody = z.infer<typeof GatherAnswerBody>
```

### `src/server/routes/gather.ts`

```ts
import { Hono } from 'hono'
import type { AppDeps } from '../deps'
import { Session } from '@/orchestrator/session'
import { GatherAnswerBody } from '../schemas/routes'
import { respondWithError } from '../errors'

export function gatherRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  app.post('/:id/gather/role/:roleId/ask', async (c) => {
    try {
      const id = Number(c.req.param('id'))
      const roleId = c.req.param('roleId')
      const session = Session.load(deps.db, deps.adapter, id)
      const result = await session.nextGatherQuestion({ roleId })
      return c.json(result)
    } catch (e) {
      return respondWithError(c, e)
    }
  })

  app.post('/:id/gather/role/:roleId/answer', async (c) => {
    try {
      const id = Number(c.req.param('id'))
      const body = GatherAnswerBody.parse(await c.req.json())
      const session = Session.load(deps.db, deps.adapter, id)
      session.recordGatherAnswer(body)
      return c.json({ ok: true })
    } catch (e) {
      return respondWithError(c, e)
    }
  })

  app.post('/:id/gather/role/:roleId/skip', async (c) => {
    try {
      const id = Number(c.req.param('id'))
      const roleId = c.req.param('roleId')
      const session = Session.load(deps.db, deps.adapter, id)
      session.skipGatherRole({ roleId })
      return c.json({ ok: true })
    } catch (e) {
      return respondWithError(c, e)
    }
  })

  app.post('/:id/gather/end', async (c) => {
    try {
      const id = Number(c.req.param('id'))
      const session = Session.load(deps.db, deps.adapter, id)
      session.endGather()
      return c.json({ snapshot: session.snapshot() })
    } catch (e) {
      return respondWithError(c, e)
    }
  })

  return app
}
```

### `src/server/index.ts` mount

```ts
app.route('/api/sessions', gatherRoutes(deps))
```

### Tests: `tests/server/routes/gather.test.ts`

Cover:
1. POST `.../ask` returns a broad question for a fresh session in gather state.
2. POST `.../answer` with valid turnId persists and returns 200.
3. POST `.../answer` with invalid body returns 400.
4. POST `.../skip` returns 200 and inserts a skip turn.
5. POST `.../end` returns 200 with `snapshot.state === 'critique'`.
6. POST `.../ask` returns 409 when session is not in gather state (e.g., already ended).
7. POST `.../ask` returns 404 for missing session.

Use `_helpers.ts` `buildTestApp` and the canonical `_fixtures.ts`.

- [ ] **Step 1: Schemas + routes**
- [ ] **Step 2: Mount in index.ts**
- [ ] **Step 3: Write tests**
- [ ] **Step 4: Run tests + commit**

```bash
bun test tests/server/routes/gather.test.ts
bun test
bun run type-check
git add src/server/routes/gather.ts src/server/index.ts src/server/schemas/routes.ts tests/server/routes/gather.test.ts
git commit -m "feat(server): gather routes (ask/answer/skip/end)"
```

---

## Task 5: Client API helpers

**Files:**

- Modify: `src/client/lib/api.ts`
- Create: `tests/client/gatherApi.test.ts`

### `api.ts` additions

```ts
export type GatherQuestion =
  | { kind: 'broad' | 'followup'; turnId: number; question: string }
  | { kind: 'done'; reason: string }

export async function askGatherQuestion(args: { sessionId: number; roleId: string }): Promise<GatherQuestion> {
  const res = await fetch(`/api/sessions/${args.sessionId}/gather/role/${args.roleId}/ask`, { method: 'POST' })
  if (!res.ok) throw await toApiError(res)
  return (await res.json()) as GatherQuestion
}

export async function recordGatherAnswer(args: { sessionId: number; roleId: string; turnId: number; answer: string }): Promise<void> {
  const res = await fetch(`/api/sessions/${args.sessionId}/gather/role/${args.roleId}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ turnId: args.turnId, answer: args.answer }),
  })
  if (!res.ok) throw await toApiError(res)
}

export async function skipGatherRole(args: { sessionId: number; roleId: string }): Promise<void> {
  const res = await fetch(`/api/sessions/${args.sessionId}/gather/role/${args.roleId}/skip`, { method: 'POST' })
  if (!res.ok) throw await toApiError(res)
}

export async function endGather(args: { sessionId: number }): Promise<{ snapshot: { state: string; modelCallsMade: number } }> {
  const res = await fetch(`/api/sessions/${args.sessionId}/gather/end`, { method: 'POST' })
  if (!res.ok) throw await toApiError(res)
  return (await res.json()) as { snapshot: { state: string; modelCallsMade: number } }
}
```

If `toApiError` doesn't exist yet, factor the existing inline error-mapping in `createSession` into a shared helper:
```ts
async function toApiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
  return Object.assign(new Error(body?.error?.message ?? `HTTP ${res.status}`), {
    status: res.status,
    code: body?.error?.code,
  }) as ApiError
}
```

### Tests: `tests/client/gatherApi.test.ts`

Same pattern as existing `api.test.ts`: stub `globalThis.fetch`, assert URLs and request shapes for each helper.

- [ ] **Step 1: Implement helpers + extract `toApiError`**
- [ ] **Step 2: Tests**
- [ ] **Step 3: Run tests + commit**

```bash
bun test tests/client/gatherApi.test.ts
bun run type-check
git add src/client/lib/api.ts tests/client/gatherApi.test.ts
git commit -m "feat(client): gather API client helpers"
```

---

## Task 6: `<GatherStep />` component

**Files:**

- Create: `src/client/components/GatherStep.tsx`
- Create: `tests/client/gatherStep.test.tsx`

### Component contract

Props:
```ts
interface GatherStepProps {
  sessionId: number
  roles: Array<{ id: string; company: string; title: string }>
  onComplete: () => void  // called after endGather succeeds
}
```

Behavior:
- Walk roles in order. Track `currentRoleIndex` in component state.
- For current role: query `askGatherQuestion`. If `kind === 'done'`, advance role.
- Render question + textarea + "Send answer" button + "Skip role" button.
- After `recordGatherAnswer` succeeds, re-query `askGatherQuestion` for the same role (gets next followup or done).
- "End gather" button calls `endGather` then `onComplete()`.

Implementation sketch (full code in implementation):
```tsx
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { askGatherQuestion, recordGatherAnswer, skipGatherRole, endGather, type GatherQuestion } from '@/client/lib/api'
import { Button } from '@/client/components/ui/button'
import { Textarea } from '@/client/components/ui/textarea'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/client/components/ui/card'

export function GatherStep({ sessionId, roles, onComplete }: GatherStepProps) {
  const [idx, setIdx] = useState(0)
  const [answer, setAnswer] = useState('')
  const queryClient = useQueryClient()
  const role = roles[idx]

  const questionQuery = useQuery<GatherQuestion>({
    queryKey: ['gather', sessionId, role?.id],
    queryFn: () => {
      if (!role) throw new Error('no role')
      return askGatherQuestion({ sessionId, roleId: role.id })
    },
    enabled: !!role,
  })

  // Advance role when AI says done
  useEffect(() => {
    if (questionQuery.data?.kind === 'done') {
      setIdx((i) => i + 1)
      setAnswer('')
    }
  }, [questionQuery.data])

  const answerMut = useMutation({
    mutationFn: async () => {
      const q = questionQuery.data
      if (!q || q.kind === 'done' || !role) return
      await recordGatherAnswer({ sessionId, roleId: role.id, turnId: q.turnId, answer })
    },
    onSuccess: () => {
      setAnswer('')
      queryClient.invalidateQueries({ queryKey: ['gather', sessionId, role?.id] })
    },
  })

  const skipMut = useMutation({
    mutationFn: () => {
      if (!role) throw new Error('no role')
      return skipGatherRole({ sessionId, roleId: role.id })
    },
    onSuccess: () => {
      setIdx((i) => i + 1)
      setAnswer('')
    },
  })

  const endMut = useMutation({
    mutationFn: () => endGather({ sessionId }),
    onSuccess: () => onComplete(),
  })

  if (idx >= roles.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Gather complete</CardTitle>
          <CardDescription>All roles covered. Ready to start critique.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button onClick={() => endMut.mutate()} disabled={endMut.isPending}>
            {endMut.isPending ? 'Starting critique…' : 'Start critique'}
          </Button>
        </CardFooter>
      </Card>
    )
  }

  if (!role) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>{role.title} — {role.company}</CardTitle>
        <CardDescription>Role {idx + 1} of {roles.length}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {questionQuery.isLoading ? <p>Thinking…</p> : null}
        {questionQuery.data && questionQuery.data.kind !== 'done' ? (
          <>
            <p className="text-base">{questionQuery.data.question}</p>
            <Textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={6}
              placeholder="Your answer…"
            />
          </>
        ) : null}
      </CardContent>
      <CardFooter className="flex gap-2">
        <Button
          onClick={() => answerMut.mutate()}
          disabled={!answer.trim() || answerMut.isPending || questionQuery.data?.kind === 'done'}
        >
          {answerMut.isPending ? 'Sending…' : 'Send answer'}
        </Button>
        <Button variant="outline" onClick={() => skipMut.mutate()} disabled={skipMut.isPending}>
          Skip role
        </Button>
        <Button variant="ghost" onClick={() => endMut.mutate()} disabled={endMut.isPending}>
          End gather
        </Button>
      </CardFooter>
    </Card>
  )
}
```

### Tests

Cover at minimum (use `_dom.ts` + happy-dom):
1. On mount, shows "Thinking…" then renders the broad question after the fetch resolves.
2. Clicking "Send answer" with text in the textarea POSTs to `/answer` then re-asks.
3. Clicking "Skip role" advances to the next role's question.
4. After last role, shows the "Gather complete" card with a "Start critique" button.
5. Clicking "Start critique" calls `onComplete`.

Mock fetch as in `setupScreen.test.tsx`.

- [ ] **Step 1: Implement component**
- [ ] **Step 2: Tests**
- [ ] **Step 3: Run + commit**

```bash
bun test tests/client/gatherStep.test.tsx
bun run type-check
git add src/client/components/GatherStep.tsx tests/client/gatherStep.test.tsx
git commit -m "feat(client): GatherStep component (Q&A walk through roles)"
```

---

## Task 7: Wire `<GatherStep />` into `SessionScreen`

**Files:**

- Modify: `src/client/screens/SessionScreen.tsx`

`SessionScreen` already loads the session snapshot. Branch on `state`:

```tsx
if (snapshot.state === 'gather') {
  return (
    <GatherStep
      sessionId={sessionId}
      roles={resume.roles.map((r) => ({ id: r.id, company: r.company, title: r.title }))}
      onComplete={() => {
        queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
      }}
    />
  )
}
```

After `endGather` succeeds, the snapshot refetch flips `state` to `'critique'` and the existing critique UI takes over. No URL change.

- [ ] **Step 1: Add the branch + import**
- [ ] **Step 2: Smoke-check the existing tests for SessionScreen still pass (the Q&A flow is hidden behind `state === 'gather'` so existing tests setting state to 'critique' shouldn't trip)**

```bash
bun test tests/client/sessionScreen.test.tsx
bun run type-check
```

- [ ] **Step 3: Commit**

```bash
git add src/client/screens/SessionScreen.tsx
git commit -m "feat(client): SessionScreen renders GatherStep when state is gather"
```

---

## Task 8: End-to-end test

**Files:**

- Create: `tests/server/routes/gather.e2e.test.ts`

Walk a single session through:
1. POST `/api/sessions` (creates session in gather state, default `gather_enabled = 1`)
2. POST `.../gather/role/:roleId/ask` — asserts a broad question
3. POST `.../gather/role/:roleId/answer` — asserts ok
4. POST `.../gather/role/:roleId/ask` again — gets followup or done (stub adapter returns `{ done: true, reason: 'enough' }`)
5. POST `.../gather/end` — state flips to `critique`
6. POST `.../critique` — SSE smokes a single canned flag (just confirms critique still works post-gather)
7. GET `.../sessions/:id` — final snapshot

Use the existing `_helpers.ts` `buildTestApp`. Stub adapter responses for ingest, gather-broad, gather-followup, and critique.

- [ ] **Step 1: Write the test**
- [ ] **Step 2: Run + commit**

```bash
bun test tests/server/routes/gather.e2e.test.ts
git add tests/server/routes/gather.e2e.test.ts
git commit -m "test(server): e2e gather → critique happy path"
```

---

## Task 9: Architecture notes

**Files:**

- Modify: `docs/architecture-notes.md`

Append:

```md
## Sub-plan 3a — Gather phase

### Gather turns persisted in their own table

`gather_turns(session_id, role_id, turn_kind, question, answer, created_at)` — separate from the resume blob. Reasons: (a) resume blob is rewritten on every flag-accept, gather text doesn't need to ride along; (b) bullets' `sourceTurnIds` references integer turn IDs, which map cleanly to a sibling table.

### Server is authoritative on gather progression

`Session.nextGatherQuestion(roleId)` returns either the next question or `{ kind: 'done' }`. The frontend never decides which template to use, never tracks follow-up counts. UI just renders what the server says.

### Gather-enabled flag is a transitional gate

`sessions.gather_enabled` defaults to `1` for new sessions. Tests built before 3a explicitly disable it (`setGatherEnabled(false)`) to keep the legacy "auto-advance to critique" behavior. Plan: remove the flag once the column has been default-1 for two weeks of dogfooding without rollbacks.
```

- [ ] **Step 1: Append**
- [ ] **Step 2: Commit**

```bash
git add docs/architecture-notes.md
git commit -m "docs: append sub-plan 3a architecture notes"
```

---

## Task 10: Final verify (no commit)

- [ ] `bun run type-check` — clean
- [ ] `bun test` — full suite green; expected pass count = pre-3a + at least 18 new tests across the 6 new test files
- [ ] `bun run dev` — manual: create a session, walk through one role of gather (answer + follow-up), end gather, run critique. Confirm UI flips correctly. (Real Codex adapter, since dev.ts wires it.)

---

## Out of scope (deferred)

- Re-questioning a role you've already gathered on (no "back" button in 3a).
- Showing the user the running answer transcript inline as they answer (the textarea is single-shot for 3a; the running transcript is on the backend only).
- Gather for `projects[]`. Roles only in 3a.
- Persona-propose template. (3f.)
- Removing the `gather_enabled` flag. (Cleanup commit, separate from 3a.)

---

## Self-review notes

- **Spec coverage:** §6.1, §6.2, §6.3 from the prompt-design spec. ✓
- **Schema verification:** `gather_enabled` column needs to be added to the `sessions` table — T1 `INSERT INTO sessions` literal in tests must match actual schema. **Task 1 step 4 explicitly tells the implementer to read `client.ts` first.** ✓
- **Risk:** test-suite breakage from the `gather_enabled = 1` default is real. T3 step 4's note documents the cleanup pass. Budget time for it.
- **Risk:** `GatherTurnsRepo.insertQuestion` template includes a stale `this.db.query` block — flagged as "drop it" inline; implementer should remove the dead code before committing.

---

## Execution

Subagent-driven execution per superpowers:subagent-driven-development. Branch: `feat/sub-plan-3a-gather` (already created). Each task = one subagent + commit.
