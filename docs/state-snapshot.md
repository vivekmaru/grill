# Project State Snapshot (2026-05-11)

## Overall Goal
Build a local-first, AI-powered resume builder using a "Skeptical Interviewer" persona to critique and refine resumes via local LLM CLIs (Claude, Codex, Gemini), outputting to deterministic ATS-friendly PDFs.

## Active Constraints
- Local-first: `bun:sqlite`, no cloud hosting. Target single-binary via `bun build --compile`.
- Backend: Bun runtime, Hono for routing, Zod for shared schemas.
- Frontend: React 19, Tailwind v4, shadcn/ui. Bun HTML imports + `Bun.serve()` — no Vite.
- Export: `@react-pdf/renderer` for PDF, `docx` for Word.
- Testing: `bun:test` only (bun:sqlite incompatible with vitest).
- UX: AI never hard-blocks; all flags dismissable. Per-session budget enforced.
- Documentation: Append architectural decisions to `docs/architecture-notes.md`.

## Key Knowledge
- `bun:sqlite` requires `bun:test` — no vitest.
- React Hook Form testing in bun:test: use `fireReactChange` utility (accesses fiber props directly); `requestSubmit()` inside `act()`.
- `happy-dom@15` requires `@happy-dom/global-registrator` for DOM bootstrap.
- `StubAdapter` uses a mutable queue for dynamic ID threading in tests.
- `Bun.spawn([bin, '--version'])` is how `probeCliAvailable` checks CLI availability.
- `z.input<>` vs `z.infer<>`: export `CreateSessionInput` (`z.input<>`) for client code so `provider` is optional; use `z.infer<>` (output type) on the server where defaults are applied.
- Flag index bug (fixed in Phase 4): always map `bullet.flags` with original indices BEFORE filtering dismissed flags. Passing post-filter position to the server causes silent data corruption.

## Completed Phases

| Phase | What it built |
|---|---|
| 1 (Foundation) | Zod schemas, SQLite tables, state machine reducer, Hono skeleton |
| 2a-2d | Prompt assets, Claude CLI adapter (`--bare`), `Session` domain object, REST/SSE routes |
| 2e | Frontend: SetupScreen, React entry, typed API client, Tailwind, shadcn primitives |
| 3a | Gather phase: `gather_turns` table, `GatherStep` UI, `gather: true` in session body |
| 3b | Evidenced rewrites: `rewrite-evidenced.md` template, numbers verifier (`VerifierFailedError` → 422) |
| 3c | PDF ingest: `{kind:'pdf', data: base64}` via `unpdf` (pure-JS, Bun-compatible) |
| 3d | JD overlay: `buildJdOverlay()` fills `{{#if jdOverlay}}` in all prompt call sites |
| 3e | Final review in `endInterrogation`, severity-3 dismiss gate, flag taxonomy expanded to 13 types |
| 3f | Stateless `POST /api/persona/propose` + SetupScreen "Suggest persona" button |
| 3g | Rubric tuning: `flags.md` + `core.md` prompt-only update, no code change |
| 4 | Multi-provider: adapter map, boot probes, per-session picker UI, `GET /api/providers` |

## Current State (after Phase 4)
- 313 tests pass, 0 fail. Type check clean.
- Provider picker in SetupScreen (radio buttons, codex default, unavailable CLIs grayed).
- Provider badge in SessionScreen header.
- All session routes resolve adapter via `getSessionProvider` + `resolveAdapter`.
- `AI_PROVIDER` env var removed.
- Gemini adapter deferred (CLI lacks schema-constrained output).
- Bug fixes applied to `SessionScreen.tsx`: correct flag server indices, BulletEditor draft sync, acceptFlag sends rewrite candidate, stable `invalidate` ref.

## Next Up (Phase 5 / UI Redesign)
- UI redesign per `docs/design-spec.md` (dark theme, two-pane session layout, flag card inbox, PDF drop zone). Claude Design is working on this.
- Possible: Gemini adapter if CLI gains `--output-schema` support.
- Possible: Provider health check displayed on boot in the terminal (CLI UX).

## File System State
- Branch: `main`
- Key files:
  - `src/server/deps.ts` — `AppDeps` with `adapters` map + `resolveAdapter`
  - `src/server/dev.ts` — `createDevAdapters()` (async boot probes), `probeCliAvailable()`
  - `src/server/routes/providers.ts` — `GET /api/providers`
  - `src/server/db/repositories/sessions.ts` — `getSessionProvider(db, id)`
  - `src/client/lib/api.ts` — `getProviders()`, `CreateSessionInput` type
  - `src/client/screens/SetupScreen.tsx` — provider picker
  - `src/client/screens/SessionScreen.tsx` — provider badge, all 4 bug fixes
  - `docs/architecture-notes.md` — all decisions documented through Phase 4
  - `docs/design-spec.md` — UI redesign spec for Claude Design
