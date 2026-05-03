# Architecture notes

A running log of engineering decisions whose rationale isn't obvious from the code. Entries are append-only — older decisions are not edited unless they're explicitly reversed (in which case the original entry stays and a new one supersedes it). If this file grows past ~20 entries, promote each one to its own `docs/adr/NNNN-title.md` file and link from here.

For each entry: what we decided, why we decided it, and (where useful) what we considered and rejected. Entries are dated and tied to the phase they were taken in.

---

## 2026-05-02 — SSE: no reconnect logic in v2

**Decision:** The critique-pass SSE stream does not implement reconnect via `Last-Event-ID` headers. If the stream drops mid-pass, the client surfaces an error and the user clicks "Run critique" again.

**Why:** This is a localhost-only app on `127.0.0.1`. Real network drops shouldn't happen. Implementing reconnect correctly requires server-side replay of in-flight events, which is genuine engineering for a non-problem.

**When this would change:** if we ever ship a hosted deployment, reconnect becomes worth the work.

Phase: 2 (spec).

---

## 2026-05-02 — Critique flags: client-side sort

**Decision:** `flag` events stream from the model in emission order, which often doesn't match document order. The frontend sorts client-side when rendering the inbox: severity descending, then bullet position.

**Why:** Server-side sort would defeat streaming — we'd have to buffer the entire pass before emitting the first flag, breaking the progressive-feedback UX.

Phase: 2 (spec).

---

## 2026-05-02 — Claude bare mode default = `true`

**Decision:** `CLAUDE_BARE_MODE=true` is the default. Users can override to `false` to use OAuth/subscription auth.

**Why bare-mode default:** deterministic behavior. Bare mode skips hooks, MCP, plugins, CLAUDE.md, auto-memory — the per-machine config that makes the same prompt behave differently on different installations.

**Tradeoffs of `false`:**
1. **Per-call startup cost.** Plugins/MCP/skills re-initialize on every call. For an interrogation session with 10–15 calls, this adds up.
2. **Non-determinism.** What runs depends on the user's local config — a hook in `~/.claude/hooks` could intercept our prompts.
3. **Surprise interception.** A `PreToolUse` hook that blocks bash could break our otherwise-pristine model calls.

The README (sub-plan 7) covers the same tradeoffs phrased for end users.

Phase: 2 (spec).

---

## 2026-05-02 — Resume schema is NOT JSON Resume internally

**Decision:** Our `Bullet` type carries `flags[]`, `status`, `sourceTurnIds[]`, `metrics[]` — the interrogation IP. JSON Resume's `highlights[]` is just strings. We don't conform to JSON Resume internally.

**Where we DO map:** at the I/O boundary. Sub-plan 5 or 6 will add JSON Resume import (their `highlights` strings → our `Bullet { text, status: 'draft', flags: [], … }`) and export (our `Bullet[]` → their `highlights[]`, dropping the metadata). This unlocks the JSON Resume themes ecosystem as bonus rendering paths.

**Why not align:** flattening `Bullet` to a string would lose everything that makes the product a product.

**Why we still expose interop:** users with existing JSON Resume files get free import; we get free fallback renderers from JSON Resume themes if `@react-pdf/renderer` ever fights us.

Phase: 2 (spec).

---

## 2026-05-02 — Resume input v2: paste-markdown only

**Decision:** Sub-plan 2's `/setup` screen accepts only "Paste markdown". PDF upload and "Blank" mode land together in sub-plan 3.

**Why:** PDF parsing requires `unpdf` integration plus a review-and-correct UX (extracted text is messy). Bundling it with blank-canvas mode in 3 lets both share the same review UI. Shipping markdown-only in 2 is a small but real subset.

Phase: 2 (spec).

---

## 2026-05-02 — Markdown → Resume JSON via LLM call

**Decision:** When the user submits the setup form, the orchestrator makes one model call to convert pasted markdown into structured `Resume` JSON. No regex parser. The call is counted against the session budget. Originally this was written against Claude; the 2026-05-03 Phase 2 runtime entry supersedes the provider choice to Codex.

**Why not regex:** real resumes deviate from any strict markdown convention. A regex parser would break on the first user who uses `**` instead of `###` for role headers. LLM is robust to formatting drift.

**Cost:** ~1 model call per session start; exact cost and latency depend on the configured Codex model.

**Risk:** if the LLM mis-parses (lost roles, jumbled dates), the critique becomes garbage-in/garbage-out. Mitigation: explicit dogfood task in sub-plan 2 — verify parsed JSON on the user's actual resume before continuing.

Phase: 2 (spec).

---

## 2026-05-02 — PDF component: same source, browser preview AND server export

**Decision:** `frontend/src/pdf/GoldStandard.tsx` is imported both client-side (by `PdfPreview` for `<PDFViewer>`) and server-side (by `routes/export.ts` for `renderToStream`). Same React component, same `@react-pdf/renderer` runtime, byte-identical output.

**Why this works:** `@react-pdf/renderer` is pure JS with its own layout engine (Yoga). It runs in Node/Bun and in the browser identically. No Chromium, no LaTeX, no diff between preview and export.

**Cross-import gotcha:** the file lives in `frontend/src/pdf/` but Hono imports it server-side. Resolved via tsconfig path aliases in dev. In sub-plan 7's binary build, the bundler emits both browser and server bundles from the same source.

**Font caveat:** any font used must be `Font.register()`'d in BOTH contexts — frontend boot and the route handler's first request.

Phase: 2 (spec).

---

## 2026-05-02 — Resume mutation: snapshot, not delta

**Decision:** Every flag accept/skip/dismiss/edit rewrites the entire `resumes.content_json` blob in SQLite. We don't track diffs.

**Why:** simpler reasoning, no rollback logic, cheap at this scale (resumes are ~10KB JSON). No multi-writer scenario to worry about — single-user localhost.

**When this would change:** multi-user collaboration would need real OT/CRDT or per-bullet delta tracking. Not applicable.

Phase: 2 (spec).

---

## 2026-05-02 — `model_calls` writes are best-effort, NOT in the transaction

**Decision:** When a route mutates session state inside a SQLite transaction, the `model_calls` telemetry insert sits OUTSIDE that transaction. If the telemetry write throws, we log to stderr and continue — the user action still succeeds.

**Why:** telemetry should never fail a user action. The session row's `model_calls_made` counter (incremented inside the transaction) is the authoritative budget number. The `model_calls` table is descriptive metadata for prompt tuning.

**Implication:** if `model_calls` writes start failing silently, you'll notice missing telemetry but the budget enforcement stays correct.

Phase: 2 (spec).

---

## 2026-05-02 — Streaming-pass atomicity

**Decision:** During `runCritique`, the SSE route buffers `flag` events in memory as they stream from the adapter (and forwards each to the SSE client immediately for UX). On the adapter's `done` event, the route opens a single SQLite transaction: writes all flags onto the resume, increments `model_calls_made`, commits.

**Why:** the user sees flags appear progressively, but the database only sees the final committed set. Eliminates partial-state recovery problems entirely.

**Failure mode:** if the adapter errors mid-stream, no flags persist. The SSE client gets the `error` event, the user re-runs critique. Acceptable: model calls aren't expensive, and "run again" is a better UX than "your session is half-corrupted, click here to recover."

Phase: 2 (spec).

---

## 2026-05-02 — Claude adapter abort race

**Decision:** `callOnce` in `src/prompts/adapters/claude.ts` uses `Promise.race([consumeStream, proc.exited.then(() => null)])` to surface aborts that fire while `consumeStream` is still reading.

**Why this exists:** when `AbortSignal` fires, we want to short-circuit the stdout reader. Closing the underlying ReadableStream's controller from outside is not part of the Web Streams API surface we expose, so we race against `proc.exited` (which the adapter and mock both reject on abort).

**Latent edge case:** if `proc.exited` resolves *successfully* (exit code 0) before `consumeStream` finishes draining, `drained` becomes `null` and the caller crashes on `.sessionId` access. Won't happen in real `Bun.spawn` (`exited` fires after pipes close) and the mock's timing also makes it improbable, but it's structurally there.

**Cleaner pattern (deferred):** plumb the AbortSignal into a dedicated abort-promise that rejects on signal and let `consumeStream` race against THAT, not against `proc.exited`. Keeps the success path uncomplicated. Worth doing during a future cleanup pass.

Phase: 2b.

---

## 2026-05-02 — `EDIT_RESUME` permitted during critique

**Decision:** `EDIT_RESUME` was originally scoped to the `'edit'` state only (post-`PICK_TEMPLATE`). Added it to `'critique'`'s allowed events so `Session.editBullet` can fire it during the interrogation phase.

**Why:** spec §4 lets the user manually rewrite a bullet during critique (alongside accept/skip/dismiss). Previously the call site dropped the event to avoid the reducer throwing, which left the resume snapshot ahead of the event log — `Session.load → replay()` would lose the manual edit on reload. Allowing the event in `'critique'` keeps event-sourcing intact: the `resumes` row is the cache, the `history` table is the source of truth.

**Reducer behaviour:** `EDIT_RESUME` from `'critique'` falls through to `return 'critique'` (no transition). Same when fired from `'edit'`. This is intentional — `EDIT_RESUME` is a within-state mutation.

**`patch` field:** still empty `[]` in v2. Sub-plan 6 (CodeMirror) replaces this with RFC 6902 patches; until then `replay()` reconstructs the mutation by re-applying the persisted `resumes` row, not by walking patches. Acceptable while the snapshot is the canonical store.

Phase: 2c.

---

## 2026-05-02 — v2 ships pseudo-streaming critique

**Decision:** `Session.runCritique` calls the adapter once and gets the full `CritiqueScanOutput` back. It synthesizes per-flag SSE events from the parsed result (yielding `started`, then one `flag` per parsed flag, then `pass-summary`, then `done`). The adapter's `onToken` callback is plumbed through but not used to emit flag events progressively.

**Why:** real progressive streaming would require parsing flags out of the in-flight JSON before the model finishes — complex (partial JSON parser) and brittle (a flag boundary mid-token would break parsing). v2 accepts a slightly less impressive UX for a much simpler implementation.

**When this would change:** sub-plan 6 if user feedback says the all-at-once flag drop feels janky. The `CritiqueEvent` type and SSE protocol already support real progressive streaming — only the orchestrator's emission strategy would change.

Phase: 2c.

---

## 2026-05-02 — Session caches state in-memory

**Decision:** A `Session` instance keeps its current state machine state as a private field, updated after every `applyEvent`. `Session.load()` replays history once to compute the initial state.

**Why:** replaying history on every method call is correct but wasteful — sessions can have dozens of events. Caching is safe because no other process mutates the same session row (single-user localhost).

**When this would change:** if we ever add cross-process coordination (e.g., a background worker that runs critique passes), the cache would need invalidation. For now the assumption holds.

Phase: 2c.

---

## 2026-05-02 — IDs stamped after ingest

**Decision:** When `Session.ingestResume` parses a Resume from markdown via the LLM, the orchestrator overwrites every `id` field on Bullets, Roles, Educations, and Projects with `crypto.randomUUID()` before persisting.

**Why:** the LLM's generated IDs are not trustworthy — it can collide them, omit them, or generate duplicates across sections. Stamping fresh IDs guarantees uniqueness. The schema requires IDs to be strings; UUIDs are the obvious primitive.

**Side effect:** the `id` fields the LLM produces are entirely ignored. The ingest-markdown template tells the model that "id fields can be any string — they will be replaced after parsing."

Phase: 2c.

---

## 2026-05-03 — App composition: single-adapter `createApp({ db, adapter })`

**Decision:** `createApp` accepts `{ db, adapter }` — one DB, one provider adapter, both built once at startup. Tests inject a stub adapter via the same shape.

**Why:** v2 ships a single active provider. A factory or per-request adapter would solve a problem we don't have. Restart the process to swap providers; sub-plan 4 introduces the adapter-pick UX. The 2026-05-03 Phase 2 runtime entry records that the active provider is Codex.

**When this would change:** sub-plan 4 if multiple providers are configured concurrently. The adapter would become `Map<ProviderName, ProviderAdapter>` and route handlers would pick by `session.provider`. Migration is mechanical.

Phase: 2d.

---

## 2026-05-03 — Per-request `Session.load`, no in-memory pool

**Decision:** Every route that operates on an existing session calls `Session.load(db, adapter, id)`. No process-wide cache of `Session` instances.

**Why:** localhost single-user; no concurrency hazard. `Session.load` is cheap (one DB read, one history replay). A pool would add cache-invalidation complexity (multi-tab sessions, stale state on background mutations) for no measurable win.

**When this would change:** if profiling shows replay cost dominating route latency on long histories, switch to a small per-process LRU keyed by session id with a write-through invalidation on every mutation.

Phase: 2d.

---

## 2026-05-03 — Route layer is a thin protocol-translation seam

**Decision:** Routes do four things only: (1) extract path/body params, (2) Zod-validate, (3) call exactly one Session method, (4) translate the result/exception to HTTP via `respondWithError`. No business logic in route handlers.

**Why:** the testing strategy depends on this. Session has its own integration tests against a stub adapter; routes have integration tests against an in-memory app. If routes did business logic, both layers would need to know about every domain rule. With the current split, route tests focus on wire format, Session tests focus on domain behavior.

**Implication:** if a route handler reaches for a repo or imports a schema from `@/orchestrator/outputs`, it's drifted from this shape. New domain logic goes in Session.

Phase: 2d.

---

## 2026-05-03 — Phase 2 runtime is Codex-only

**Decision:** Phase 2 runtime wiring uses Codex as the only active provider. `AI_PROVIDER` defaults to `codex`, `src/server/dev.ts` constructs `createCodexAdapter(loadEnv(process.env))`, and local UI smoke tests use `RESUME_BUILDER_MOCK_CODEX=1` to select a deterministic Codex-named stub.

**Claude state:** `src/prompts/adapters/claude.ts` remains in the repo, is unit-tested, and keeps its skipped real-CLI integration test. It is not wired into dev or Phase 2 runtime after this entry. The known abort-handling caveat from "Claude adapter abort race" remains documented for future provider work.

**Why:** the installed Codex CLI exposes schema-constrained `codex exec`, which is enough for the Phase 2 ingest, critique, and rewrite calls. Keeping only one active runtime provider avoids provider picker UI and mid-session switching behavior while the thin slice is still being completed.

**When this would change:** a later multi-provider phase can re-enable Claude and Gemini behind an explicit provider selection flow and health checks.

Phase: 2.

---

## 2026-05-03 — Codex resume continuity deferred

**Decision:** The Codex adapter treats `sessionHandle` as always `null` and never calls `codex exec resume` in Phase 2.

**Why:** the installed CLI exposes a resume subcommand, but not the `--output-schema` path on that subcommand. Phase 2 needs schema-constrained outputs more than provider-side conversation continuity, so every Codex call is a fresh `codex exec` invocation in an empty temporary directory with a read-only sandbox.

**Implication:** continuity comes from the orchestrator prompts and persisted session state, not from Codex CLI session memory. This is acceptable for Phase 2 because each prompt includes the current structured resume, target context, and flag context it needs.

**When this would change:** if Codex resume gains schema-constrained output support, the adapter can start returning and accepting a real handle without changing the HTTP API.

Phase: 2.
