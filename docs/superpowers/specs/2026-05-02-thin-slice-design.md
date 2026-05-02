# Thin Slice Design — Sub-plan 2

- **Date:** 2026-05-02
- **Status:** Approved (pending user review of this written spec)
- **Scope:** The first end-to-end usable cut of the resume builder. Takes the foundation (`v0.1.0-foundation`) and ships: Claude provider only, two prompt templates (`critique-scan`, `rewrite-wordsmith`), one PDF template (Gold Standard, ATS-ready), a two-screen UI (`/setup`, `/session/:id`).
- **Stack assumed:** Bun + Hono + bun:sqlite + Zod (existing), plus Vite + React 19 + Tailwind + shadcn/ui + `@react-pdf/renderer` + `zod-to-json-schema`.
- **Out of scope:** other providers, gather phase, evidenced rewrites, verifier, JD overlay, other PDF templates, DOCX, CodeMirror, session-restore UI. See §11.

---

## 1. Context and goal

The foundation provides schemas, persistence, a state machine, and a Hono server skeleton. None of it talks to a model yet. Sub-plan 2 turns that scaffolding into a product the author can run on his own resume and produce a PDF he'd actually consider submitting.

**The "thin slice" principle:** ship the smallest possible end-to-end path that exercises every architectural seam (provider adapter, orchestrator, streaming, prompts, persistence, frontend, PDF rendering, export). Subsequent sub-plans add depth, not new architectural surface.

---

## 2. Decisions log

Six decisions taken during brainstorming, each shaping multiple downstream sections.

### D1 — Dogfooding target: useful interrogation (Target B)

Critique runs against the user's bullets, surfaces flags, AI proposes rewrite candidates for the four "low-risk" flag types (`vague`, `passive`, `length`, `jargon`). The four "evidence" flags (`unverified`, `no-impact`, `inflated`, `stale`) surface but route to manual textbox editing.

**Rejected:** bare-minimum (no AI rewrites — feels like "ChatGPT with a worse UI"); full critique loop with gather (too thick for one sub-plan).

### D2 — Templates shipped: `critique-scan` + `rewrite-wordsmith` only

Six templates exist in the prompt-design spec; v2 ships two. `persona-propose` skipped — user picks archetype/tone from a dropdown. `gather-broad`/`gather-followup`/`rewrite-evidenced`/`final-review` deferred. Flag taxonomy ships in full (8 flags) since `critique-scan` covers all of them; only the rewrite path is truncated.

### D3 — Frontend stack: full PRD stack (Vite + React 19 + shadcn + Tailwind)

The frontend foundation work is one-time amortized cost. Doing it now means sub-plans 3–7 build *on* the stack rather than swapping it in mid-project.

**Rejected:** minimal React without shadcn (saves nothing material; sub-plan 6 would re-do all components); server-rendered HTML (entire UI gets rewritten in sub-plan 6).

### D4 — UI flow: two-screen split

`/setup` → `/session/:id`. No wizard. State-machine phases collapse into two visible screens; transitions are recorded internally but invisible to the user. Sub-plan 3+ refines *within* these two screens (gather between setup and critique, etc.) without flow redesign.

**Rejected:** multi-step wizard ("oh, what did I do on step 3" UX); single-page hub with progressive reveal (visually busy on first load).

### D5 — Critique screen layout: resume preview + flag inbox split

Layout B from the brainstorming mockups. Left pane: live PDF preview. Right pane: focused flag-card inbox, one flag at a time. Click a bullet on the left to jump to its flag. Advance via prev/next.

**Rejected:** single-column scroll with inline expansion (with max 8 flags surfaced per pass per spec calibration, focused-one-at-a-time matches how you'd actually do this work).

### D6 — Orchestrator architecture: `Session` class

A `Session` instance is created/loaded per HTTP request. Holds repo references and budget state. Methods like `runCritique()`, `acceptFlag()`, `endInterrogation()`. Hono handlers stay thin facades over `Session`. Threads `sessionHandle` (Claude's `--resume` ID) without per-call passing.

**Rejected:** stateless function library (per-route boilerplate proliferates); event bus / actor (overkill for single-user localhost).

---

## 3. Architecture

### 3.1 Repository layout (additions to foundation)

```
src/
├── prompts/                          # NEW
│   ├── render.ts                     # ~10-line {{slot}} substitution + {{#if}} blocks
│   ├── rubric/
│   │   ├── core.md                   # baseline standards (placeholder content; tuned in sub-plan 3)
│   │   └── flags.md                  # 8 flags + severity definitions
│   ├── personas/
│   │   ├── archetypes.md             # 7 archetype descriptions
│   │   └── tones.md                  # 4 tone descriptions
│   ├── templates/
│   │   ├── critique-scan.md
│   │   └── rewrite-wordsmith.md
│   └── adapters/
│       ├── types.ts                  # ProviderAdapter interface, AdapterError
│       ├── claude.ts                 # Claude CLI adapter
│       └── parse.ts                  # JSON-island extraction + Zod retry helper
├── orchestrator/                     # NEW
│   ├── session.ts                    # the Session class
│   ├── personaPrompt.ts              # buildPersonaSystemPrompt()
│   ├── budget.ts                     # MAX_MODEL_CALLS_PER_SESSION enforcement
│   └── verifier/
│       └── numbers.ts                # Tier-1 deterministic regex (sub-plan 2 unused, scaffolded)
└── server/
    ├── routes/                       # NEW
    │   ├── sessions.ts               # POST/GET /api/sessions
    │   ├── critique.ts               # POST /api/sessions/:id/critique (SSE)
    │   ├── flags.ts                  # accept | skip | dismiss | rewrite
    │   ├── edit.ts                   # POST /api/sessions/:id/edit
    │   └── export.ts                 # GET /api/sessions/:id/export.pdf
    └── static.ts                     # serve frontend dist/ in production

frontend/                              # NEW — sibling, not nested
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── components.json                    # shadcn config
├── public/
│   └── fonts/                         # self-hosted Source Serif Pro
└── src/
    ├── main.tsx
    ├── App.tsx                        # router
    ├── pages/
    │   ├── SetupPage.tsx
    │   └── SessionPage.tsx
    ├── components/
    │   ├── ResumePreview.tsx
    │   ├── FlagInbox.tsx
    │   ├── FlagCard.tsx
    │   ├── ProviderBadge.tsx
    │   └── PdfPreview.tsx
    ├── pdf/
    │   └── GoldStandard.tsx           # the React-PDF template
    └── lib/
        ├── api.ts                     # fetch wrapper (TanStack Query)
        └── sse.ts                     # SSE consumer

docs/
└── architecture-notes.md              # NEW — engineering decisions log; seeded with §10

tests/
├── prompts/                           # NEW
│   ├── render.test.ts
│   ├── adapters/
│   │   ├── parse.test.ts
│   │   └── claude.test.ts             # mocks Bun.spawn
│   └── verifier/
│       └── numbers.test.ts
├── orchestrator/                      # NEW
│   ├── session.test.ts
│   └── budget.test.ts
└── server/routes/                     # NEW
    ├── sessions.test.ts
    ├── critique.test.ts
    └── flags.test.ts
```

**Why this layout**

- `prompts/` and `orchestrator/` are siblings, not nested. Prompts are *how* we talk to models; the orchestrator is *what* we're trying to do. Mixing them produces grab-bag directories.
- Frontend in a sibling `frontend/` directory so its TS/Vite/Tailwind config is isolated from server-side code. Sub-plan 7's binary build glues them.
- Routes split per state-machine phase (setup, critique, flags, edit, export). One file per HTTP concern, ~50–100 lines each.

### 3.2 New schema event

One addition to `src/schema/events.ts`:

```ts
z.object({ type: z.literal('BEGIN_CRITIQUE') })
```

Emitted by the orchestrator (not the user) when transitioning from `gather` to `critique`. In v2, since gather is skipped, the orchestrator emits this immediately after `CONFIRM_PERSONA`. Reducer learns: `gather + BEGIN_CRITIQUE → critique`.

### 3.3 Template rendering pipeline

```ts
// src/prompts/render.ts (~10 lines)
const SLOT     = /\{\{(\w+)\}\}/g
const IFOPEN   = /\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g

export function render(template: string, slots: Record<string, string>): string {
  return template
    .replace(IFOPEN, (_, key, body) => slots[key] ? body : '')
    .replace(SLOT, (_, key) => slots[key] ?? '')
}
```

No nested conditionals, no loops, no escaping. If a future template needs more, we revisit; for v2's two templates this is plenty.

---

## 4. The `Session` class

Single domain object exposed to routes. Wraps existing repos, orchestrates prompt calls.

```ts
// src/orchestrator/session.ts
export class Session {
  constructor(
    private readonly id: number,
    private readonly db: Database,
    private readonly adapter: ProviderAdapter,
  ) {}

  static create(db: Database, adapter: ProviderAdapter): Session
  static load(db: Database, adapter: ProviderAdapter, id: number): Session

  // === Setup phase ===
  ingestResume(content: { kind: 'markdown' | 'blank'; text?: string }): Promise<Resume>
  setTarget(ctx: TargetContext): void

  // === Critique phase ===
  runCritique(opts?: { signal?: AbortSignal }): AsyncIterable<CritiqueEvent>
  acceptFlag(args: { bulletId: string; flagIndex: number; newText: string }): void
  skipFlag(args: { bulletId: string; flagIndex: number }): void
  dismissFlag(args: { bulletId: string; flagIndex: number; reason?: string }): void
  proposeRewrites(args: { bulletId: string; flagIndex: number }): Promise<RewriteCandidates>

  // === Generate / edit / export ===
  currentResume(): Resume
  editBullet(args: { bulletId: string; newText: string }): void

  // === Lifecycle ===
  endInterrogation(): void
  snapshot(): SessionSnapshot
}

export type CritiqueEvent =
  | { type: 'started' }
  | { type: 'flag'; flag: FlagInstance & { bulletId: string } }
  | { type: 'pass-summary'; bulletsScanned: number; bulletsFlagged: number; topConcern: string }
  | { type: 'done'; durationMs: number; tokensUsed: { in: number; out: number } }
  | { type: 'error'; message: string }

export interface RewriteCandidates {
  candidates: Array<{
    text: string
    evidenceMap: Array<{ span: string; source: 'original' | 'connective' }>
  }>
}

export interface SessionSnapshot {
  id: number
  state: string
  provider: 'claude' | 'codex' | 'gemini' | null
  modelCallsMade: number
  modelCallsBudget: number
  allowExtraUsage: boolean
}
```

### 4.1 Key design notes

1. **`runCritique` is `AsyncIterable<CritiqueEvent>`, not `Promise<...>`**. Lets routes pipe events directly to the SSE response. Each flag arrives at the UI as soon as the model emits it.
2. **`proposeRewrites` is on-demand, not pre-computed.** When the user advances to a flag, the route calls `proposeRewrites`. We don't burn calls generating rewrites for flags the user dismisses without looking at.
3. **Sub-plan 2 supports `vague`/`passive`/`length`/`jargon` rewrites only.** For `unverified`/`no-impact`/`inflated`/`stale`, `proposeRewrites` throws `EvidencedFlagNotSupportedError` — UI catches it and shows the "Edit my own" textbox seeded with the original.
4. **`ingestResume` makes one Claude call** to convert pasted markdown into structured Resume JSON. Counted against the budget. The adapter's `parseOrRetry` handles one schema-validation retry internally; `ingestResume` itself does not retry on top of that. Sub-plan 3 adds `'pdf-text'` as a third `kind` value; the rest of the pipeline reuses.

---

## 5. Provider adapter — interface + Claude implementation

### 5.1 Shared interface

```ts
// src/prompts/adapters/types.ts
export type ModelTier = 'main' | 'verifier'  // 'verifier' unused in v2
export type SessionHandle = string | null     // opaque per-provider context

export interface ProviderAdapter {
  readonly name: 'claude' | 'codex' | 'gemini'
  callInSession<T>(args: {
    sessionHandle: SessionHandle
    tier: ModelTier
    systemPrompt: string
    userPrompt: string
    schema: ZodSchema<T>
    onToken?: (chunk: string) => void
    signal?: AbortSignal
  }): Promise<{ result: T; sessionHandle: SessionHandle }>
}

export class AdapterError extends Error {
  constructor(
    message: string,
    readonly cause:
      | 'spawn-failed' | 'cli-error' | 'parse-failed'
      | 'schema-failed' | 'aborted' | 'auth-failed',
  ) { super(message) }
}
```

### 5.2 Claude adapter

Spawns `claude -p` via `Bun.spawn` with these flags:

```bash
claude -p \
  --bare                                    # iff CLAUDE_BARE_MODE=true
  --output-format stream-json
  --verbose
  --include-partial-messages
  --append-system-prompt "<persona prompt>"
  --json-schema '<JSON Schema from Zod>'
  --model "<env-configured model for tier>"
  --resume <session_id>                     # iff sessionHandle is set
```

Stream-json events processed:
- `{ type: 'system', subtype: 'init', session_id }` → capture as new `sessionHandle`.
- `{ type: 'stream_event', event: { delta: { text } } }` → forward to `onToken`.
- `{ type: 'result', result, structured_output? }` → final; run `parseOrRetry` on `structured_output` first, falling back to a JSON island extracted from `result`.
- `{ type: 'system', subtype: 'api_retry' }` → log to stderr, continue.

### 5.3 Bare-mode strict honoring

`CLAUDE_BARE_MODE` is read once at adapter construction. Both values strictly honored — the adapter never reads `~/.claude` directly:

| Mode | Auth source | What CLI loads per call |
|---|---|---|
| `true` (default) | `ANTHROPIC_API_KEY` env | Nothing — bare |
| `false` | CLI's own OAuth/keychain | hooks, skills, plugins, MCP, CLAUDE.md, auto memory |

If `CLAUDE_BARE_MODE=true` but `ANTHROPIC_API_KEY` is missing, the adapter throws `AdapterError('CLAUDE_BARE_MODE=true requires ANTHROPIC_API_KEY...', 'auth-failed')` at construction. Clear failure mode, never a silent confusion.

### 5.4 `parseOrRetry`

```ts
// src/prompts/adapters/parse.ts
export async function parseOrRetry<T>(
  raw: string,
  schema: ZodSchema<T>,
  retry: () => Promise<string>,
): Promise<T> {
  // 1. Strip ```json fences and leading/trailing prose
  // 2. Locate first '{' and matching '}' — extract JSON island
  // 3. schema.safeParse
  // 4. On failure: call retry() ONCE with corrective prompt appended
  // 5. On second failure: throw AdapterError(..., 'schema-failed')
}
```

### 5.5 Dependency addition

`zod-to-json-schema` (~5KB pure JS, no native deps). Used to convert Zod output schemas to JSON Schema for the `--json-schema` flag.

---

## 6. Streaming protocol (SSE)

Only `runCritique` streams. Everything else is plain JSON request/response.

### 6.1 Endpoint

```
POST /api/sessions/:id/critique
  Content-Type: application/json
  Body: {}
  Accept: text/event-stream
```

POST not GET because it mutates state. SSE on POST is unusual but valid; Hono supports it.

### 6.2 Event types

```
event: started
data: {"sessionId":42,"timestamp":1714600000000}

event: flag
data: {"bulletId":"b3","flag":{...FlagInstance...}}

event: pass-summary
data: {"bulletsScanned":18,"bulletsFlagged":5,"topConcern":"..."}

event: done
data: {"flagCount":5,"durationMs":4321,"tokensUsed":{"in":1800,"out":450}}

event: error
data: {"code":"adapter:schema-failed","message":"...","retryable":false}
```

Stream closes after `done` or `error`. After `error`, the client does NOT auto-retry.

### 6.3 Frontend consumption

`fetch` (not `EventSource` — EventSource is GET-only) with `getReader()` parsing complete `event:`/`data:` blocks. ~30 lines in `frontend/src/lib/sse.ts`.

### 6.4 Abort handling

Frontend's cleanup function calls `controller.abort()` on unmount or "Stop" click. The fetch's AbortSignal threads through `Bun.spawn`'s `signal:` option to kill the Claude CLI subprocess. Session state stays unchanged on abort — the critique pass simply didn't complete; the user can re-run.

### 6.5 No reconnect logic in v2

Engineering decision recorded in `docs/architecture-notes.md`. Rationale: localhost-only app, network drops shouldn't happen, real reconnect requires server-side replay of in-flight events.

### 6.6 Client-side flag sort

Flag events arrive in model-emission order, not document order. Frontend sorts client-side when rendering: severity descending, then bullet position. Recorded in `docs/architecture-notes.md`. Server-side sort would defeat streaming (must buffer entire pass first).

---

## 7. UI — two screens

### 7.1 `/setup`

Single form, no wizard. Submits → POST `/api/sessions` → redirects to `/session/:id`.

```
┌─ Resume Builder ──────────── Powered by [Claude ▼] ──┐
│  1. Your resume                                       │
│     [ Paste markdown ]  [ PDF ✗ ]  [ Blank ✗ ]        │
│     ┌─ textarea ────────────────────────────────┐    │
│     │                                            │    │
│     └────────────────────────────────────────────┘    │
│                                                        │
│  2. Target                                             │
│     Target role:        [_____________________]        │
│     Seniority:          [Staff ▼]                      │
│     Industry (optional):[_____________________]        │
│     Job description:    [greyed; sub-plan 3]           │
│                                                        │
│  3. Persona                                            │
│     Archetype:  [Engineering Manager ▼]                │
│     Tone:       [Skeptical ▼]                          │
│                                                        │
│                            [ Start critique → ]        │
└────────────────────────────────────────────────────────┘
```

**v2-specific behavior:**
- Only "Paste markdown" tab is enabled. "Upload PDF" and "Blank" are visible but disabled with tooltip pointing to sub-plan 3.
- Job-description field rendered greyed with tooltip ("JD-grounded standards land in sub-plan 3").
- Provider selector top-right has Claude as the only enabled option; Codex/Gemini disabled with sub-plan 4 tooltips.
- Submit creates the session, locks the provider, parses the resume markdown via Claude. On success redirects to `/session/:id`.

### 7.2 `/session/:id`

Layout B from the brainstorm, three regions:

```
┌─ Resume Builder ── Powered by Claude (locked) ── Calls: 2/60 ──┐
│  ┌─ Live PDF preview ──┬─ Flag inbox ──────────────────┐       │
│  │                     │  Flag 3 of 8 ▾▾                │       │
│  │  [PDFViewer:        │  ▲ vague (severity 2)          │       │
│  │   GoldStandard      │                                 │       │
│  │   template]         │  "Collaborated with team..."    │       │
│  │                     │                                 │       │
│  │  bullet just        │  An interviewer would ask:      │       │
│  │  accepted glows     │  "What did 'collaborate'        │       │
│  │  for 600ms          │   actually look like?"          │       │
│  │                     │                                 │       │
│  │                     │  ① "Led migration of..."        │       │
│  │                     │  ② "Drove technical..."         │       │
│  │                     │                                 │       │
│  │                     │  [Edit my own] [Skip] [Stand by]│       │
│  │                     │  ◀ prev    next ▶               │       │
│  └─────────────────────┴─────────────────────────────────┘      │
│  [ ✕ End interrogation ]               [ ↓ Export PDF ]         │
└─────────────────────────────────────────────────────────────────┘
```

**Key behavior:**
- Live PDF preview reflects the *current* Resume (all accepted/skipped/dismissed decisions applied). Updates on every mutation.
- Flag inbox shows one flag at a time. Prev/next navigates.
- `Stand by it` opens a confirmation modal; v2 uses the same modal for all severities (severity-1 light dismissal lands in sub-plan 6).
- `Edit my own` opens a `<textarea>` (CodeMirror in sub-plan 6) seeded with the original bullet text.
- Calls counter top-right is read-only. Hitting cap returns a plain error ("session quota reached"); full overage UX in sub-plan 6.
- Provider badge is read-only; tooltip explains the lock.
- Export PDF downloads directly. Template picker in sub-plan 5.

### 7.3 State-machine collapse

Foundation defines `critique → finalReview → generate → edit → export`. v2 collapses all of those into the single `/session/:id` page — the orchestrator transitions states correctly, but the user sees one screen. Sub-plan 3 surfaces `finalReview` as its own step; sub-plan 5 surfaces the template picker between `generate` and `edit`.

---

## 8. PDF rendering — Gold Standard template

### 8.1 Component

```tsx
// frontend/src/pdf/GoldStandard.tsx
import { Document, Page, View, Text, StyleSheet, Font } from '@react-pdf/renderer'
import type { Resume } from '@/schema/resume'

Font.register({
  family: 'Source Serif Pro',
  fonts: [
    { src: '/fonts/SourceSerifPro-Regular.ttf' },
    { src: '/fonts/SourceSerifPro-Bold.ttf', fontWeight: 700 },
    { src: '/fonts/SourceSerifPro-Italic.ttf', fontStyle: 'italic' },
  ],
})

const styles = StyleSheet.create({
  page: { padding: '0.5in', fontFamily: 'Source Serif Pro', fontSize: 10, lineHeight: 1.4 },
  header: { textAlign: 'center', borderBottomWidth: 1, paddingBottom: 4 },
  name: { fontSize: 16, fontWeight: 700, letterSpacing: 0.5 },
  contact: { fontSize: 8, color: '#444', marginTop: 2 },
  sectionTitle: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', borderBottomWidth: 0.5, marginTop: 10, paddingBottom: 1 },
  role: { marginTop: 4 },
  roleHeader: { flexDirection: 'row', justifyContent: 'space-between', fontSize: 10 },
  roleTitle: { fontWeight: 700 },
  roleMeta: { fontSize: 9, color: '#555', fontStyle: 'italic' },
  bullet: { flexDirection: 'row', marginTop: 2 },
  bulletDot: { width: 8, fontSize: 10 },
  bulletText: { flex: 1, fontSize: 9.5 },
})

export function GoldStandard({ resume }: { resume: Resume }) {
  return (
    <Document title={`${resume.contact.name} — Resume`} author={resume.contact.name}>
      <Page size="LETTER" style={styles.page}>
        {/* Header, Summary?, Experience, Education?, Skills?, Projects?, Certifications? */}
      </Page>
    </Document>
  )
}
```

### 8.2 Why these choices

- **Letter size, 0.5" margins.** US standard; ATS parsers handle Letter and A4 equivalently.
- **Source Serif Pro**, self-hosted from `/fonts/`. ~150KB across 3 weights. Same font for browser preview AND server-side render — guarantees byte-identical output.
- **No icons, no color, no graphics.** ATS parsers reject decorative content.
- **Linear flow, single column.** Two-column layouts confuse half the ATS parsers in production. The Gold Standard's job is to be safe.
- **Conditional sections.** Empty arrays don't render.

### 8.3 Same component, two consumers

```tsx
// frontend: in-app preview
<PDFViewer><GoldStandard resume={resume} /></PDFViewer>

// server: download endpoint via renderToStream
import { renderToStream } from '@react-pdf/renderer'
const stream = await renderToStream(<GoldStandard resume={resume} />)
return new Response(stream, { headers: { 'Content-Type': 'application/pdf', ... } })
```

Byte-identical. The PDF component lives in `frontend/src/pdf/` but is imported server-side via tsconfig path resolution. Recorded in `docs/architecture-notes.md`.

### 8.4 ATS validation as a sub-plan 2 task

After the template is implemented, an explicit dogfood task: upload a generated PDF to LinkedIn Easy Apply (or comparable ATS), confirm name/contact/roles/dates/bullets all extracted correctly. Sub-plan 2 does NOT ship until this passes. If it fails, debug fonts/format/PDF tags before merge.

---

## 9. Persistence model

### 9.1 What gets written, when

| Action | History event(s) | Other writes |
|---|---|---|
| `POST /api/sessions` (submit setup) | `START_BLANK`/`UPLOAD_RESUME`, `CONFIRM_INGEST`, `SET_TARGET`, `CONFIRM_PERSONA`, `BEGIN_CRITIQUE` | `sessions` row created, provider locked, `resumes` row created |
| `POST .../critique` (run pass) | none during stream; at completion: one `model_calls` row | `resumes` updated with flags; `sessions.model_calls_made` incremented |
| `POST .../flags/:idx/accept` | `ACCEPT_BULLET` | `resumes` updated: bullet text changed, status → `'refined'` |
| `POST .../flags/:idx/skip` | `SKIP_BULLET` | `resumes` updated: status → `'accepted'` |
| `POST .../flags/:idx/dismiss` | `DISMISS_FLAG` | `resumes` updated: flag.dismissed=true |
| `POST .../flags/:idx/rewrite` (request candidates) | none | one `model_calls` row, counter incremented |
| `POST .../edit` (manual textbox) | `EDIT_RESUME` | `resumes` updated |
| `POST .../end` (End interrogation) | `END_INTERROGATION` | `sessions.state` advanced |
| `GET .../export.pdf` | `EXPORT` (first call only) | none |

### 9.2 Atomicity

Every mutation wrapped in a SQLite transaction (`bun:sqlite`'s `db.transaction(fn)` returns a callable that runs `fn` inside `BEGIN`/`COMMIT`). The repos from the foundation do the writes:

```ts
db.transaction(() => {
  history.append({ sessionId, role: 'user', event })
  resumes.update(resumeId, updatedResume)
  sessions.setState(sessionId, newState)
})()
```

If a route handler crashes mid-mutation, *neither* persists. State machine and event log can never disagree.

### 9.3 Streaming-pass atomicity

1. Adapter streams `flag` events.
2. Route buffers flags in memory while forwarding each to SSE client (UX).
3. On adapter `done`: single transaction commits all flags onto resume + records model_calls + increments counter.
4. On adapter error mid-stream: nothing persists; client sees `error` event; user retries.

User sees flags appear progressively; database only sees the final committed set. No partial-state recovery problems.

Recorded in `docs/architecture-notes.md`.

### 9.4 Resume mutation: snapshot, not delta

Every flag accept rewrites the entire `resumes.content_json` blob. Simpler than diff-tracking; cheap (resumes are small). Recorded in `architecture-notes.md`.

### 9.5 `model_calls` writes are best-effort, NOT in the transaction

Telemetry shouldn't fail a user action. If telemetry write throws, log to stderr and continue. The session row's `model_calls_made` counter is the authoritative budget number; `model_calls` is descriptive metadata. Recorded in `architecture-notes.md`.

### 9.6 Crash recovery

Sub-plan 2 does NOT ship a session-restore UI. But the persistence model makes it free: load `sessions.id`, replay `history`, hydrate `resumes` row, you're back. Sub-plan 6 wires the UI.

If the server crashes mid-`runCritique`, the in-flight pass is lost (point 3 above). User re-runs critique. Acceptable: model calls aren't expensive.

---

## 10. `docs/architecture-notes.md` — entries to seed

Sub-plan 2 creates this file and seeds it with these decisions. Future sub-plans append.

1. **SSE: no reconnect logic.** Localhost-only app, network drops shouldn't happen, server-side replay of in-flight events is real engineering for a non-problem.
2. **Critique flags: client-side sort.** Streaming is preserved; server-side sort would require buffering entire pass before emitting first flag.
3. **Claude bare mode: default `true`.** Three tradeoffs of `false`: per-call startup cost (plugins/MCP/skills re-init each call); non-determinism (local config affects behavior); surprise interception (a user's PreToolUse hook could break our calls).
4. **Schema vs JSON Resume: don't conform internally.** Our `Bullet` carries `flags`/`status`/`sourceTurnIds` — the interrogation IP. JSON Resume's `highlights` is just a string. Map at the I/O boundary instead (sub-plan 5/6 task).
5. **Resume input v2: paste-markdown only.** PDF and blank-canvas land together in sub-plan 3.
6. **Markdown→Resume JSON via LLM call.** No regex parser; one Claude call per ingest. Counted against budget.
7. **PDF component cross-import.** Lives in `frontend/src/pdf/` but imported server-side via tsconfig paths. Sub-plan 7 binary build emits browser + server bundles from the same source.
8. **Resume mutation: snapshot, not delta.** Whole `content_json` rewritten on every accept. Simpler reasoning, cheap at this scale.
9. **`model_calls` writes outside the transaction.** Telemetry is best-effort; never fails a user action.
10. **Streaming-pass atomicity.** In-flight flags buffered in memory; commit only on `done`.

---

## 11. Deferred to future sub-plans

Single map. Implementation plans for sub-plans 3+ pull from this.

| Sub-plan | Items |
|---|---|
| **3 — richer prompts** | PDF upload via `unpdf`; blank-canvas mode; gather phase (broad + funnel follow-ups); `persona-propose` template; JD web overlay; evidenced rewrites (`rewrite-evidenced`); Tier-2 LLM verifier; rubric tuning task (calibrate severity thresholds against real model output); `final-review` template + UI surface |
| **4 — other providers** | Codex adapter; Gemini adapter; provider-lock UX (read-only badge after lock); CLI health check on app boot; provider-pick guidance UI |
| **5 — full export** | 4 remaining PDF templates (Modern Playful, Skills-Forward, Deep Tech, Minimalist); DOCX export via `docx` npm package; template picker UI; **stretch: JSON Resume import/export** (unlocks the JSON Resume themes ecosystem as additional rendering paths) |
| **6 — UI polish** | shadcn primitives applied throughout; severity-1 light dismissal flow; budget overage modal + live usage panel; CodeMirror inline editor; session-restore UI; optimistic UI updates if measured slow; multi-page PDF render debouncing; severity color coding refinement |
| **7 — distribution** | `bun build --compile` single binary; full README (covering bare-mode tradeoffs for end users, provider selection, env vars, data dir); AGENTS.md (coding instructions for future AI contributors); font registration packaging into binary; OS-specific data dir resolution (`~/Library/Application Support/...` etc.); CLI binary path config |

---

## 12. Dogfooding success criterion

Sub-plan 2 ships when the author can perform the following end-to-end on his own real resume:

1. **Setup.** Open `localhost:4321/setup`, paste real resume markdown, set target role + seniority + archetype + tone, click "Start critique".
2. **Conversion.** Resume markdown converts to structured Resume JSON via one Claude call. Roles, dates, bullets all correctly identified (acceptable: minor field misclassification noticeable in preview).
3. **Critique.** Within ~10 seconds, 3–8 flags appear progressively in the inbox via SSE. Each flag is meaningful — recruiter-voice critique, not generic "make this better" advice.
4. **Fix.** For at least 2 word-smithing flags (`vague`/`passive`/`length`/`jargon`), 2 candidate rewrites appear; user picks one or uses "Edit my own". PDF preview updates immediately on the left.
5. **Stand-by.** For at least 1 flag, user clicks "Stand by it", confirms the modal, flag dismisses and stops surfacing.
6. **Manual edit.** For at least 1 evidence flag (`unverified`/`no-impact`/`inflated`/`stale`), user uses "Edit my own" to write a better version. Preview updates.
7. **Export.** Click "Export PDF". Downloaded file matches in-app preview exactly. Upload to LinkedIn Easy Apply (or comparable ATS); name/contact/roles/dates/bullets all extracted correctly.
8. **Honesty check.** Reading the exported PDF, the user can identify at least one bullet genuinely *improved* over the input — not just rephrased, but more defensible.

If steps 1–8 all pass, sub-plan 2 ships. If step 8 fails ("no bullet genuinely improved"), the rubric/prompt needs tuning — fixed within sub-plan 2, not deferred.

---

## 13. Risks worth naming

1. **Markdown→Resume JSON conversion quality.** If Claude regularly mis-parses real resumes (jumbled dates, lost roles), critique becomes garbage-in/garbage-out. **Mitigation:** dogfood early — first task after orchestrator works is "paste resume, inspect parsed JSON". If first 3 real-world resumes don't parse cleanly, fix the prompt before continuing.

2. **`@react-pdf/renderer` live re-render performance.** A 2-page resume might re-render 50+ times in a session. Sluggish (>500ms) re-renders make the UX bad. **Mitigation:** measure during dogfood; if slow, debounce updates to 250ms.

3. **ATS upload validation.** If LinkedIn / a real ATS can't parse our PDF, the dogfood criterion fails on step 7. **Mitigation:** explicit task; on failure, inspect fonts (most common cause), simplify formatting, or enable `accessible: true` PDF tags.

---

## 14. Cross-cutting commitments

These are owed by future sub-plans. Recorded here so they don't slip:

- **Sub-plan 7 README** must cover bare-mode tradeoffs for end users (per §10 entry 3, phrased operationally not architecturally), provider selection, data location, env vars, build steps.
- **Sub-plan 5/6** evaluates JSON Resume import/export (per §10 entry 4).
- **Sub-plan 6** picks up the UI polish items in §11 row 6.
- **Sub-plan 3** rubric tuning is its own task (not bundled into prompt-template tasks).
- **Every sub-plan from 3 onward** appends new architectural decisions to `docs/architecture-notes.md`. If list grows past ~10 entries we promote to per-decision ADR files.

---

## 15. Approvals

- **2026-05-02:** All 9 design sections approved by user (vivek). Spec written to this file.
