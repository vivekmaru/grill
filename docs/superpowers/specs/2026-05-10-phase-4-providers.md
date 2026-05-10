# Phase 4 — Multi-Provider Support Design

- **Date:** 2026-05-10
- **Status:** Approved
- **Scope:** Reactivate the Claude adapter, add a CLI health check on boot, expose available providers via API, and add a per-session provider picker to the UI. Gemini adapter is explicitly deferred.

---

## 1. Goals

- Each provider's adapter is constructed and made available when its CLI binary passes a `--version` probe on boot — provider routing is per-session via the UI, not via `AI_PROVIDER` in `.env`
- `AI_PROVIDER` env var is removed from `env.ts` — it is superseded by per-session selection
- Server probes available CLIs on boot and exposes the result via `GET /api/providers`
- SetupScreen shows a provider picker; only installed CLIs are enabled
- SessionScreen shows a read-only provider badge — locked for the session's lifetime
- All existing tests pass unchanged

---

## 2. Out of scope

- Gemini adapter (CLI lacks schema-constrained JSON output; deferred to a future phase)
- Auth verification (binary probe only — `--version` exit code, no real model call)
- Mid-session provider switching
- UI polish / shadcn ToggleGroup (wired with basic radio buttons; sub-plan 6 polishes)

---

## 3. Architecture

### 3.1 Adapter map replaces single adapter

`createApp` currently receives `{ db, adapter: ProviderAdapter }`. This changes to:

```ts
createApp({ db, adapters }: { db: Database; adapters: Record<string, ProviderAdapter> })
```

The `deps` context object threaded through all Hono route factories changes the same way. **`Session.create` and `Session.load` signatures are unchanged** — routes resolve the correct adapter before calling into Session, keeping Session decoupled from multi-provider routing.

### 3.2 Provider resolution for each request

**Session creation (`POST /api/sessions`):**
1. Body includes optional `provider` field (defaults to `'codex'`)
2. Pick adapter: `deps.adapters[provider] ?? deps.adapters['codex']`
3. Record the *actual* provider used (post-fallback) on the session row
4. Call `Session.create(db, resolvedAdapter)` — unchanged

**All subsequent session routes (critique, flags, rewrite, gather, end):**
```ts
const provider = getSessionProvider(db, sessionId)   // one SELECT
const adapter = deps.adapters[provider] ?? deps.adapters['codex']!
const session = await Session.load(db, adapter, id)
```

`getSessionProvider(db, id)` is a new thin helper: `SELECT provider FROM sessions WHERE id = ?`, throws `SessionNotFoundError` if missing. Lives alongside the existing repo helpers.

### 3.3 `sessions` table

No migration needed — `provider TEXT` and `provider_locked_at` columns already exist from Phase 2.

### 3.4 `dev.ts` boot sequence

`createDevAdapter` is replaced by `createDevAdapters` which:

1. Runs `probeCliAvailable(bin)` for each CLI in parallel via `Promise.all`
2. Constructs adapters only for CLIs that pass the probe
3. Always includes `codex` as the fallback (if codex probe fails, the server logs a warning but boots)
4. Returns `Record<string, ProviderAdapter>`

```ts
async function probeCliAvailable(bin: string): Promise<boolean> {
  try {
    const proc = Bun.spawn([bin, '--version'], { stdout: 'pipe', stderr: 'pipe' })
    return (await proc.exited) === 0
  } catch {
    return false
  }
}
```

Both probes run in parallel — no meaningful boot delay.

---

## 4. New API endpoint

### `GET /api/providers`

No authentication, no session required.

**Response:**
```json
{
  "available": ["codex", "claude"],
  "default": "codex"
}
```

`available` is the set of keys in the adapters map (i.e. providers whose CLI binary was found on boot). `default` is always `"codex"`. Gemini will appear as unavailable (not in the list) until a future phase adds the adapter.

**Route file:** `src/server/routes/providers.ts` — a new thin file, ~20 lines. Registered in `src/server/index.ts` as `app.route('/api/providers', providersRoutes(deps))`.

---

## 5. Schema change

**`CreateSessionBody`** gets one new optional field:

```ts
provider: z.enum(['claude', 'codex']).default('codex').optional()
```

`DismissFlagBody`, `AcceptFlagBody`, `EditBulletBody` — unchanged.

---

## 6. UI changes

### 6.1 SetupScreen — provider picker

A new row above the Submit button. On mount, fetches `GET /api/providers` via TanStack Query.

```
  PROVIDER
  ● codex    ○ claude    ○ gemini (not installed)
```

- Available providers: enabled radio buttons, default `'codex'` selected
- Unavailable providers: disabled with tooltip "Not installed"  
- Gemini always disabled this phase
- Selected value sent as `provider` in `POST /api/sessions` body

### 6.2 SessionScreen — provider lock badge

A read-only badge in the session header, sourced from `session.snapshot.provider`:

```
  Session 12  ·  critique    [codex]    [Export PDF]  [End session]
```

No switching UI. Badge is purely informational. No new API call — `snapshot.provider` is already returned by `GET /api/sessions/:id`.

---

## 7. Testing

### New test files

**`tests/server/routes/providers.test.ts`**
- `GET /api/providers` returns `available` array and `default: 'codex'`
- Works when only codex adapter is present

**Extended `tests/server/routes/e2e.test.ts`**
- Create session with `provider: 'claude'` — confirm `snapshot.provider === 'claude'`
- Create session with `provider: 'claude'` when adapters map only has codex — confirm fallback: `snapshot.provider === 'codex'`

**`tests/server/db/sessionProvider.test.ts`** (or inline with existing repo tests)
- `getSessionProvider` returns correct value
- Throws `SessionNotFoundError` for missing id

### Existing tests — zero changes needed

`buildTestApp()` in `tests/server/routes/_helpers.ts` changes to pass `{ adapters: { codex: stub, claude: stub } }` with both keys pointing at the same stub adapter. All 307 existing tests pass unchanged — their assertions don't inspect which adapter was picked.

### Not tested

`probeCliAvailable` — shells out to real binaries; covered implicitly by the `dev.ts` integration path. No mock needed.

---

## 8. File map

| Action | File |
|---|---|
| Modify | `src/server/index.ts` — `adapter` → `adapters` in `AppDeps`, register providers route |
| Modify | `src/lib/env.ts` — remove `AI_PROVIDER` field |
| Modify | `src/server/dev.ts` — `createDevAdapter` → `createDevAdapters`, add `probeCliAvailable` |
| Modify | `src/server/routes/sessions.ts` — add `provider` to body, resolve adapter, store post-fallback provider |
| Modify | `src/server/routes/critique.ts` — `getSessionProvider` + resolve adapter |
| Modify | `src/server/routes/flags.ts` — same |
| Modify | `src/server/routes/gather.ts` — same |
| Modify | `src/server/routes/end.ts` — same |
| Modify | `src/server/routes/edit.ts` — same |
| Modify | `src/server/schemas/routes.ts` — add `provider` to `CreateSessionBody` |
| Modify | `src/server/db/repos.ts` (or sibling) — add `getSessionProvider` helper |
| Create | `src/server/routes/providers.ts` — `GET /api/providers` |
| Modify | `src/client/screens/SetupScreen.tsx` — provider picker |
| Modify | `src/client/screens/SessionScreen.tsx` — provider badge |
| Modify | `src/client/lib/api.ts` — add `getProviders()` helper |
| Modify | `tests/server/routes/_helpers.ts` — adapters map in `buildTestApp` |
| Create | `tests/server/routes/providers.test.ts` |
| Create | `tests/server/db/sessionProvider.test.ts` |

---

## 9. Decisions log

1. **`AI_PROVIDER` env var removed.** Per-session UI selection replaces it. Boot probes all CLIs regardless and constructs adapters for whichever pass.
2. **Gemini deferred.** CLI lacks schema-constrained output. Deferred to a future phase.
2. **Binary probe only.** `--version` exit code determines availability. No auth call on boot.
3. **Codex default + fallback.** `provider` in session body defaults to `'codex'`. If the chosen provider isn't in the adapters map, falls back to codex silently; session records the actual provider used.
4. **Adapter map in `createApp`.** Both adapters constructed at boot, passed as `Record<string, ProviderAdapter>`. Routes resolve the right one before calling `Session.load`. Session remains decoupled.
5. **`getSessionProvider` helper.** Single SELECT before `Session.load` in every session route. Avoids threading provider through Session's public API.
