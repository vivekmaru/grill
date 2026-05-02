# Phase 2b — Claude Provider Adapter

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `src/prompts/adapters/claude.ts` — the live Claude CLI provider adapter — on top of the `ProviderAdapter` interface and `parseOrRetry` from phase 2a. After this phase, the orchestrator (built in 2c) can issue real model calls via `claude -p` and get back schema-validated structured output.

**Architecture:** The adapter is a factory function (`createClaudeAdapter`) that returns a `ProviderAdapter` implementation. It accepts an optional `spawn` injection point so tests can substitute a mock without touching `Bun.spawn`. Auth validation happens at construction time (fail-fast on missing `ANTHROPIC_API_KEY` when bare mode is on). Per-call flow: spawn the CLI with appropriate flags, pipe the user prompt to stdin, parse the stream-json output line-by-line, capture `session_id` from the `system/init` event, forward `stream_event` deltas to `onToken`, capture the final `result` event, hand the structured output (or extracted JSON island) to `parseOrRetry`. On schema failure, retry once with a corrective prompt — the new call uses the captured session id, so context is preserved across the retry.

**Tech Stack:** Bun (`Bun.spawn`), TypeScript, `bun:test`. Adds `zod-to-json-schema` (~5 KB pure JS, no native deps) to convert Zod schemas for Claude's `--json-schema` flag.

**Branch:** `feat/phase2b-claude-adapter`. Merge to `main` when phase complete.

---

## File Structure

```
src/prompts/adapters/
├── types.ts                   # existing (from 2a)
├── parse.ts                   # existing (from 2a)
└── claude.ts                  # NEW — factory for the Claude adapter

tests/prompts/adapters/
├── parse.test.ts              # existing (from 2a)
├── types.test.ts              # existing (from 2a)
├── claude.test.ts             # NEW — unit tests with mock spawn
├── claude.integration.test.ts # NEW — opt-in real-CLI smoke test
└── _helpers/
    └── mockSpawn.ts           # NEW — reusable spawn-mocking utility
```

**Why this layout:**

- The whole adapter ships in one file (`claude.ts`). It's ~180 lines of tightly-coupled CLI orchestration; splitting it would make navigation harder. Internal helpers stay private to the file.
- The mock-spawn helper lives in `_helpers/` so its test-only nature is obvious from the path. Sub-plan 4's Codex and Gemini adapters will reuse it.
- Two test files for `claude`: `claude.test.ts` runs unconditionally (mock-only); `claude.integration.test.ts` is gated by env vars and runs the actual CLI.
- `_helpers/` underscore prefix follows the convention that test fixtures and helpers go in underscore-prefixed directories so they don't get auto-imported anywhere else.

---

## Task 1: Add `zod-to-json-schema` dependency

**Files:**
- Modify: `package.json`

The Claude CLI's `--json-schema` flag takes a JSON Schema string. We have Zod schemas. `zod-to-json-schema` is the ~5 KB pure-JS converter.

- [ ] **Step 1: Install the package**

```bash
bun add zod-to-json-schema
```

Expected: `+ zod-to-json-schema@<version>` printed; `package.json` updated; `bun.lock` updated.

- [ ] **Step 2: Verify the dep is recorded**

```bash
grep zod-to-json-schema package.json
```

Expected: a line in `dependencies` with the version pinned (e.g., `"zod-to-json-schema": "^3.x.x"`).

- [ ] **Step 3: Sanity-import to confirm it loads in Bun**

```bash
bun -e "const { zodToJsonSchema } = await import('zod-to-json-schema'); const { z } = await import('zod'); console.log(JSON.stringify(zodToJsonSchema(z.object({ ok: z.boolean() }))))"
```

Expected: prints a JSON Schema object containing `"type": "object"` and an `ok` property of type `boolean`. If anything else, stop and investigate before committing.

- [ ] **Step 4: Confirm no test regressions**

```bash
bun test
bun run type-check
```

Expected: 119 tests pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock
git commit -m "chore(deps): add zod-to-json-schema for Claude --json-schema flag"
```

---

## Task 2: Mock-spawn test helper

**Files:**
- Create: `tests/prompts/adapters/_helpers/mockSpawn.ts`

A reusable utility that produces a `spawn`-compatible function and records each invocation. Drives all unit tests in this phase and is reused by sub-plan 4's Codex/Gemini adapter tests. Tested via the adapter tests themselves — no separate test file (the helper is dead-simple wiring; bugs surface immediately when adapter tests behave wrong).

The helper produces an object with:
- `spawn`: a function matching the shape `(cmd: string[], options) => Subprocess` that the adapter will accept in place of `Bun.spawn`.
- `calls`: an array of records (one per spawn invocation) capturing `cmd`, accumulated `stdinBuffer`, and `killed`.

Each `MockScript` represents one scripted subprocess run: an exit code, an array of stdout chunks (each emitted separately so streaming tests can verify per-chunk behavior), and optional stderr chunks.

- [ ] **Step 1: Create the helper**

Create `tests/prompts/adapters/_helpers/mockSpawn.ts`:

```ts
/**
 * Test helper that mocks `Bun.spawn`-like calls by returning a function with
 * the same shape. Each call dequeues the next `MockScript` and produces a
 * subprocess whose stdout/stderr emit the scripted chunks and whose `exited`
 * promise resolves to the scripted exit code.
 *
 * Captures cmd args and stdin writes for assertion in tests.
 */

export interface MockScript {
  /** Exit code the subprocess.exited promise resolves to. */
  exitCode: number
  /** Each entry is emitted as a separate stdout chunk. Useful for testing
   *  streaming behavior — put one stream-json line per chunk. */
  stdoutChunks: string[]
  /** Same for stderr. Defaults to empty. */
  stderrChunks?: string[]
  /** Optional delay (ms) between successive chunks. Defaults to 0. */
  chunkDelayMs?: number
}

export interface SpawnCall {
  cmd: string[]
  stdinBuffer: string
  killed: boolean
  options: unknown
}

export interface MockSpawn {
  spawn: (cmd: string[], options?: unknown) => MockSubprocess
  calls: SpawnCall[]
}

export interface MockSubprocess {
  stdin: { write(s: string): void; end(): void }
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  exited: Promise<number>
  kill: () => void
  killed: boolean
}

export function createMockSpawn(scripts: MockScript[]): MockSpawn {
  const calls: SpawnCall[] = []
  let scriptIndex = 0

  const spawn = (cmd: string[], options?: unknown): MockSubprocess => {
    const script = scripts[scriptIndex]
    scriptIndex++
    if (!script) {
      throw new Error(
        `mockSpawn: expected ${scripts.length} call(s) but got call #${scriptIndex}; ` +
          `cmd was: ${JSON.stringify(cmd)}`,
      )
    }

    const callRecord: SpawnCall = {
      cmd: [...cmd],
      stdinBuffer: '',
      killed: false,
      options,
    }
    calls.push(callRecord)

    const stdin = {
      write(s: string) {
        callRecord.stdinBuffer += s
      },
      end() {
        // no-op — chunk emission already begins on construction
      },
    }

    const encoder = new TextEncoder()
    const delayMs = script.chunkDelayMs ?? 0

    const buildStream = (chunks: string[] | undefined): ReadableStream<Uint8Array> =>
      new ReadableStream({
        async start(controller) {
          for (const chunk of chunks ?? []) {
            if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
            controller.enqueue(encoder.encode(chunk))
          }
          controller.close()
        },
      })

    const stdout = buildStream(script.stdoutChunks)
    const stderr = buildStream(script.stderrChunks)

    // exited resolves only after stdout has been fully drained — closer to
    // real subprocess semantics where exit happens after pipes close.
    let resolveExited: (code: number) => void
    const exited = new Promise<number>((resolve) => {
      resolveExited = resolve
    })

    // Resolve exited after the longest stream finishes. We use a timer that
    // outlasts the chunk emission delays so the streams have time to drain.
    const totalDelay = (script.stdoutChunks.length + (script.stderrChunks?.length ?? 0)) * delayMs
    setTimeout(() => resolveExited(script.exitCode), totalDelay + 1)

    const subproc: MockSubprocess = {
      stdin,
      stdout,
      stderr,
      exited,
      kill: () => {
        callRecord.killed = true
        subproc.killed = true
      },
      killed: false,
    }
    return subproc
  }

  return { spawn, calls }
}
```

- [ ] **Step 2: Confirm it type-checks**

```bash
bun run type-check
```

Expected: clean.

- [ ] **Step 3: Confirm no test regressions** (helper isn't imported yet, but adding files shouldn't break anything)

```bash
bun test
```

Expected: 119 tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/prompts/adapters/_helpers/mockSpawn.ts
git commit -m "test(prompts): add mockSpawn helper for adapter unit tests"
```

---

## Task 3: Adapter scaffold + auth-failed at construction

**Files:**
- Create: `src/prompts/adapters/claude.ts`
- Create: `tests/prompts/adapters/claude.test.ts`

The first slice: just `createClaudeAdapter(config)` returning an adapter shell. Validates auth at construction time. Throws `AdapterError('auth-failed')` when `bareMode=true` but `apiKey` is missing. No spawn yet; `callInSession` is stubbed to throw.

- [ ] **Step 1: Write failing tests**

Create `tests/prompts/adapters/claude.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { createClaudeAdapter, type ClaudeAdapterConfig } from '@/prompts/adapters/claude'
import { AdapterError } from '@/prompts/adapters/types'

const baseConfig: ClaudeAdapterConfig = {
  bin: 'claude',
  bareMode: true,
  apiKey: 'sk-ant-fake',
  mainModel: 'claude-opus-4-7',
  verifierModel: 'claude-haiku-4-5-20251001',
}

describe('createClaudeAdapter — construction', () => {
  it('returns an adapter named "claude"', () => {
    const a = createClaudeAdapter(baseConfig)
    expect(a.name).toBe('claude')
  })

  it('throws AdapterError(auth-failed) when bareMode=true and apiKey is missing', () => {
    expect(() =>
      createClaudeAdapter({ ...baseConfig, apiKey: undefined }),
    ).toThrow(AdapterError)

    try {
      createClaudeAdapter({ ...baseConfig, apiKey: undefined })
    } catch (e) {
      expect((e as AdapterError).cause).toBe('auth-failed')
      expect((e as AdapterError).message).toContain('ANTHROPIC_API_KEY')
    }
  })

  it('throws AdapterError(auth-failed) when bareMode=true and apiKey is empty string', () => {
    expect(() =>
      createClaudeAdapter({ ...baseConfig, apiKey: '' }),
    ).toThrow(AdapterError)
  })

  it('does not throw when bareMode=false even if apiKey is missing', () => {
    expect(() =>
      createClaudeAdapter({ ...baseConfig, bareMode: false, apiKey: undefined }),
    ).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
bun test tests/prompts/adapters/claude.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement scaffold**

Create `src/prompts/adapters/claude.ts`:

```ts
import type { ProviderAdapter } from './types'
import { AdapterError } from './types'

export interface ClaudeAdapterConfig {
  /** Path or name of the Claude CLI binary. Typically 'claude'. */
  bin: string
  /** When true, --bare flag is passed and ANTHROPIC_API_KEY is required. */
  bareMode: boolean
  /** Anthropic API key. Required when bareMode is true. */
  apiKey: string | undefined
  /** Model used when tier === 'main'. */
  mainModel: string
  /** Model used when tier === 'verifier'. */
  verifierModel: string
}

export function createClaudeAdapter(config: ClaudeAdapterConfig): ProviderAdapter {
  if (config.bareMode && !config.apiKey) {
    throw new AdapterError(
      'CLAUDE_BARE_MODE=true requires ANTHROPIC_API_KEY. ' +
        'Set the env var or set CLAUDE_BARE_MODE=false.',
      'auth-failed',
    )
  }

  return {
    name: 'claude',
    async callInSession() {
      throw new AdapterError('not implemented yet', 'cli-error')
    },
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
bun test tests/prompts/adapters/claude.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Confirm full suite + type-check**

```bash
bun test
bun run type-check
```

Total: 119 + 4 = 123.

- [ ] **Step 6: Commit**

```bash
git add src/prompts/adapters/claude.ts tests/prompts/adapters/claude.test.ts
git commit -m "feat(prompts): scaffold Claude adapter with auth-failed at construction"
```

---

## Task 4: Happy path — call CLI, parse `structured_output`, return result + session handle

**Files:**
- Modify: `src/prompts/adapters/claude.ts`
- Modify: `tests/prompts/adapters/claude.test.ts`

Implements the basic call flow: spawn the CLI, write the user prompt to stdin, consume the stream-json stream, capture `session_id` from `system/init`, capture the final `result` event's `structured_output`, parse against the Zod schema, return.

This task does NOT yet handle: onToken streaming, retry, abort, JSON-island fallback. Those land in subsequent tasks.

- [ ] **Step 1: Write failing tests**

Append to `tests/prompts/adapters/claude.test.ts` (after the existing `describe` block):

```ts
import { z } from 'zod'
import { createMockSpawn } from './_helpers/mockSpawn'

const Sample = z.object({ ok: z.boolean(), value: z.number() })

describe('createClaudeAdapter — happy path', () => {
  it('passes the expected CLI flags and parses structured_output', async () => {
    const mock = createMockSpawn([
      {
        exitCode: 0,
        stdoutChunks: [
          JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-123' }) + '\n',
          JSON.stringify({
            type: 'result',
            result: 'ignored when structured_output present',
            structured_output: { ok: true, value: 42 },
          }) + '\n',
        ],
      },
    ])

    const adapter = createClaudeAdapter(baseConfig, mock.spawn)
    const out = await adapter.callInSession({
      sessionHandle: null,
      tier: 'main',
      systemPrompt: 'You are a thing.',
      userPrompt: 'do the thing',
      schema: Sample,
    })

    expect(out.result).toEqual({ ok: true, value: 42 })
    expect(out.sessionHandle).toBe('sess-123')

    expect(mock.calls).toHaveLength(1)
    const call = mock.calls[0]!
    expect(call.cmd[0]).toBe('claude')
    expect(call.cmd).toContain('-p')
    expect(call.cmd).toContain('--output-format')
    expect(call.cmd).toContain('stream-json')
    expect(call.cmd).toContain('--verbose')
    expect(call.cmd).toContain('--include-partial-messages')
    expect(call.cmd).toContain('--bare')
    expect(call.cmd).toContain('--append-system-prompt')
    expect(call.cmd).toContain('You are a thing.')
    expect(call.cmd).toContain('--model')
    expect(call.cmd).toContain('claude-opus-4-7')
    expect(call.cmd).toContain('--json-schema')
    expect(call.stdinBuffer).toBe('do the thing')
  })

  it('uses verifierModel when tier is "verifier"', async () => {
    const mock = createMockSpawn([
      {
        exitCode: 0,
        stdoutChunks: [
          JSON.stringify({ type: 'system', subtype: 'init', session_id: 's' }) + '\n',
          JSON.stringify({
            type: 'result',
            structured_output: { ok: true, value: 1 },
          }) + '\n',
        ],
      },
    ])
    const adapter = createClaudeAdapter(baseConfig, mock.spawn)
    await adapter.callInSession({
      sessionHandle: null,
      tier: 'verifier',
      systemPrompt: 's',
      userPrompt: 'u',
      schema: Sample,
    })
    expect(mock.calls[0]!.cmd).toContain('claude-haiku-4-5-20251001')
  })

  it('omits --bare when bareMode is false', async () => {
    const mock = createMockSpawn([
      {
        exitCode: 0,
        stdoutChunks: [
          JSON.stringify({ type: 'system', subtype: 'init', session_id: 's' }) + '\n',
          JSON.stringify({
            type: 'result',
            structured_output: { ok: true, value: 1 },
          }) + '\n',
        ],
      },
    ])
    const adapter = createClaudeAdapter(
      { ...baseConfig, bareMode: false, apiKey: undefined },
      mock.spawn,
    )
    await adapter.callInSession({
      sessionHandle: null,
      tier: 'main',
      systemPrompt: 's',
      userPrompt: 'u',
      schema: Sample,
    })
    expect(mock.calls[0]!.cmd).not.toContain('--bare')
  })

  it('passes --json-schema with the converted Zod schema', async () => {
    const mock = createMockSpawn([
      {
        exitCode: 0,
        stdoutChunks: [
          JSON.stringify({ type: 'system', subtype: 'init', session_id: 's' }) + '\n',
          JSON.stringify({
            type: 'result',
            structured_output: { ok: true, value: 1 },
          }) + '\n',
        ],
      },
    ])
    const adapter = createClaudeAdapter(baseConfig, mock.spawn)
    await adapter.callInSession({
      sessionHandle: null,
      tier: 'main',
      systemPrompt: 's',
      userPrompt: 'u',
      schema: Sample,
    })
    const schemaIdx = mock.calls[0]!.cmd.indexOf('--json-schema')
    expect(schemaIdx).toBeGreaterThan(-1)
    const schemaArg = mock.calls[0]!.cmd[schemaIdx + 1]!
    const parsed = JSON.parse(schemaArg)
    expect(parsed.type).toBe('object')
    expect(parsed.properties).toBeDefined()
    expect(parsed.properties.ok).toBeDefined()
    expect(parsed.properties.value).toBeDefined()
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

```bash
bun test tests/prompts/adapters/claude.test.ts
```

Expected: FAIL — `callInSession` throws "not implemented yet" or `createMockSpawn` not exported correctly.

- [ ] **Step 3: Replace `claude.ts` with the full happy-path implementation**

Replace the entire contents of `src/prompts/adapters/claude.ts`:

```ts
import type { ZodSchema } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ProviderAdapter, ModelTier, SessionHandle } from './types'
import { AdapterError } from './types'
import { parseOrRetry } from './parse'

export interface ClaudeAdapterConfig {
  bin: string
  bareMode: boolean
  apiKey: string | undefined
  mainModel: string
  verifierModel: string
}

/** A subprocess shape that matches both Bun.spawn and our mock. */
export interface SubprocessLike {
  stdin: { write(s: string): void; end(): void }
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  exited: Promise<number>
  kill: () => void
}

/** Spawn function shape that takes a cmd array and returns a SubprocessLike. */
export type SpawnFn = (cmd: string[], options?: unknown) => SubprocessLike

interface ClaudeStreamEvent {
  type?: string
  subtype?: string
  session_id?: string
  event?: { delta?: { type?: string; text?: string } }
  result?: string
  structured_output?: unknown
}

function modelForTier(config: ClaudeAdapterConfig, tier: ModelTier): string {
  return tier === 'main' ? config.mainModel : config.verifierModel
}

function buildArgs(
  config: ClaudeAdapterConfig,
  tier: ModelTier,
  systemPrompt: string,
  jsonSchema: unknown,
  resumeId: SessionHandle,
): string[] {
  const args: string[] = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--append-system-prompt', systemPrompt,
    '--json-schema', JSON.stringify(jsonSchema),
    '--model', modelForTier(config, tier),
  ]
  if (config.bareMode) args.push('--bare')
  if (resumeId) args.push('--resume', resumeId)
  return args
}

interface CallResult {
  raw: string
  sessionId: string | null
}

async function consumeStream(
  proc: SubprocessLike,
): Promise<CallResult> {
  let sessionId: string | null = null
  let resultText = ''
  let structuredOutput: unknown = undefined
  let buffer = ''

  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let evt: ClaudeStreamEvent
      try {
        evt = JSON.parse(trimmed)
      } catch {
        continue
      }
      if (evt.type === 'system' && evt.subtype === 'init' && evt.session_id) {
        sessionId = evt.session_id
      } else if (evt.type === 'system' && evt.subtype === 'api_retry') {
        console.warn(`[claude adapter] api_retry: ${trimmed}`)
      } else if (evt.type === 'result') {
        if (evt.structured_output !== undefined) {
          structuredOutput = evt.structured_output
        }
        if (typeof evt.result === 'string') {
          resultText = evt.result
        }
      }
    }
  }

  const raw =
    structuredOutput !== undefined ? JSON.stringify(structuredOutput) : resultText
  return { raw, sessionId }
}

export function createClaudeAdapter(
  config: ClaudeAdapterConfig,
  spawn?: SpawnFn,
): ProviderAdapter {
  if (config.bareMode && !config.apiKey) {
    throw new AdapterError(
      'CLAUDE_BARE_MODE=true requires ANTHROPIC_API_KEY. ' +
        'Set the env var or set CLAUDE_BARE_MODE=false.',
      'auth-failed',
    )
  }

  const spawnFn: SpawnFn =
    spawn ?? ((cmd: string[], options?: unknown) => Bun.spawn(cmd, options as Parameters<typeof Bun.spawn>[1]) as unknown as SubprocessLike)

  return {
    name: 'claude',

    async callInSession({
      sessionHandle,
      tier,
      systemPrompt,
      userPrompt,
      schema,
    }) {
      const jsonSchema = zodToJsonSchema(schema as ZodSchema<unknown>)

      const callOnce = async (
        prompt: string,
        resumeId: SessionHandle,
      ): Promise<CallResult> => {
        const args = buildArgs(config, tier, systemPrompt, jsonSchema, resumeId)
        const proc = spawnFn([config.bin, ...args], {
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
        })
        proc.stdin.write(prompt)
        proc.stdin.end()

        const drained = await consumeStream(proc)
        const exitCode = await proc.exited
        if (exitCode !== 0) {
          throw new AdapterError(
            `claude CLI exited with code ${exitCode}`,
            'cli-error',
          )
        }
        return drained
      }

      const first = await callOnce(userPrompt, sessionHandle)
      let lastSessionId = first.sessionId

      const retry = async (): Promise<string> => {
        const correctivePrompt =
          userPrompt +
          '\n\nYour previous response did not match the required schema. ' +
          'Return ONLY valid JSON matching the schema. No prose, no fences.'
        const second = await callOnce(correctivePrompt, first.sessionId)
        lastSessionId = second.sessionId
        return second.raw
      }

      const result = (await parseOrRetry(first.raw, schema, retry)) as unknown
      return {
        result: result as never,
        sessionHandle: lastSessionId,
      }
    },
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
bun test tests/prompts/adapters/claude.test.ts
```

Expected: PASS (4 + 4 = 8 tests in this file).

- [ ] **Step 5: Confirm full suite + type-check**

```bash
bun test
bun run type-check
```

Total: 123 + 4 = 127.

- [ ] **Step 6: Commit**

```bash
git add src/prompts/adapters/claude.ts tests/prompts/adapters/claude.test.ts
git commit -m "feat(prompts): claude adapter happy path with structured_output"
```

---

## Task 5: JSON-island fallback when `structured_output` is absent

**Files:**
- Modify: `tests/prompts/adapters/claude.test.ts`

The adapter ALREADY supports this case in Task 4's implementation (when `structured_output` is undefined, `consumeStream` returns `result.result` text, which `parseOrRetry` then handles via JSON-island extraction). This task adds a test to lock the behavior in.

- [ ] **Step 1: Write failing test**

Append to `tests/prompts/adapters/claude.test.ts`, inside (or just below) the existing `describe('createClaudeAdapter — happy path', …)` block. New `describe`:

```ts
describe('createClaudeAdapter — JSON-island fallback', () => {
  it('extracts JSON from result text when structured_output is absent', async () => {
    const mock = createMockSpawn([
      {
        exitCode: 0,
        stdoutChunks: [
          JSON.stringify({ type: 'system', subtype: 'init', session_id: 's' }) + '\n',
          JSON.stringify({
            type: 'result',
            // No structured_output. Result text contains prose-wrapped JSON.
            result: 'Here you go: {"ok":true,"value":7} hope that helps.',
          }) + '\n',
        ],
      },
    ])
    const adapter = createClaudeAdapter(baseConfig, mock.spawn)
    const out = await adapter.callInSession({
      sessionHandle: null,
      tier: 'main',
      systemPrompt: 's',
      userPrompt: 'u',
      schema: Sample,
    })
    expect(out.result).toEqual({ ok: true, value: 7 })
  })

  it('extracts JSON from a markdown code fence in result text', async () => {
    const mock = createMockSpawn([
      {
        exitCode: 0,
        stdoutChunks: [
          JSON.stringify({ type: 'system', subtype: 'init', session_id: 's' }) + '\n',
          JSON.stringify({
            type: 'result',
            result: '```json\n{"ok":false,"value":3}\n```',
          }) + '\n',
        ],
      },
    ])
    const adapter = createClaudeAdapter(baseConfig, mock.spawn)
    const out = await adapter.callInSession({
      sessionHandle: null,
      tier: 'main',
      systemPrompt: 's',
      userPrompt: 'u',
      schema: Sample,
    })
    expect(out.result).toEqual({ ok: false, value: 3 })
  })
})
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
bun test tests/prompts/adapters/claude.test.ts
```

Expected: PASS — these tests exercise existing behavior.

If they FAIL, investigate: the implementation may not be returning `result.result` correctly when `structured_output` is missing. Re-check Task 4's `consumeStream`.

- [ ] **Step 3: Confirm full suite**

```bash
bun test
bun run type-check
```

Total: 127 + 2 = 129.

- [ ] **Step 4: Commit**

```bash
git add tests/prompts/adapters/claude.test.ts
git commit -m "test(prompts): claude adapter falls back to JSON-island extraction"
```

---

## Task 6: `onToken` streaming via `stream_event` deltas

**Files:**
- Modify: `src/prompts/adapters/claude.ts`
- Modify: `tests/prompts/adapters/claude.test.ts`

When `onToken` is provided, the adapter forwards each `stream_event.event.delta.text` chunk to it as it arrives. This is what powers the SSE flag-by-flag UX in the orchestrator.

- [ ] **Step 1: Write failing tests**

Append to `tests/prompts/adapters/claude.test.ts`:

```ts
describe('createClaudeAdapter — onToken streaming', () => {
  it('forwards each stream_event delta text to onToken in order', async () => {
    const mock = createMockSpawn([
      {
        exitCode: 0,
        stdoutChunks: [
          JSON.stringify({ type: 'system', subtype: 'init', session_id: 's' }) + '\n',
          JSON.stringify({
            type: 'stream_event',
            event: { delta: { type: 'text_delta', text: 'Hel' } },
          }) + '\n',
          JSON.stringify({
            type: 'stream_event',
            event: { delta: { type: 'text_delta', text: 'lo ' } },
          }) + '\n',
          JSON.stringify({
            type: 'stream_event',
            event: { delta: { type: 'text_delta', text: 'world' } },
          }) + '\n',
          JSON.stringify({
            type: 'result',
            structured_output: { ok: true, value: 1 },
          }) + '\n',
        ],
      },
    ])
    const tokens: string[] = []
    const adapter = createClaudeAdapter(baseConfig, mock.spawn)
    await adapter.callInSession({
      sessionHandle: null,
      tier: 'main',
      systemPrompt: 's',
      userPrompt: 'u',
      schema: Sample,
      onToken: (chunk) => tokens.push(chunk),
    })
    expect(tokens).toEqual(['Hel', 'lo ', 'world'])
  })

  it('does not call onToken if not provided (no error)', async () => {
    const mock = createMockSpawn([
      {
        exitCode: 0,
        stdoutChunks: [
          JSON.stringify({ type: 'system', subtype: 'init', session_id: 's' }) + '\n',
          JSON.stringify({
            type: 'stream_event',
            event: { delta: { type: 'text_delta', text: 'x' } },
          }) + '\n',
          JSON.stringify({
            type: 'result',
            structured_output: { ok: true, value: 1 },
          }) + '\n',
        ],
      },
    ])
    const adapter = createClaudeAdapter(baseConfig, mock.spawn)
    await expect(
      adapter.callInSession({
        sessionHandle: null,
        tier: 'main',
        systemPrompt: 's',
        userPrompt: 'u',
        schema: Sample,
        // no onToken
      }),
    ).resolves.toBeDefined()
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

```bash
bun test tests/prompts/adapters/claude.test.ts
```

Expected: FAIL on first test — `tokens` is empty because the adapter doesn't forward stream_event deltas yet.

- [ ] **Step 3: Modify `consumeStream` to accept and call `onToken`**

In `src/prompts/adapters/claude.ts`, modify the `consumeStream` function signature and add the `stream_event` branch.

Replace this:

```ts
async function consumeStream(
  proc: SubprocessLike,
): Promise<CallResult> {
```

with:

```ts
async function consumeStream(
  proc: SubprocessLike,
  onToken: ((chunk: string) => void) | undefined,
): Promise<CallResult> {
```

Inside the same function, find the if-else chain and add a `stream_event` branch. The existing chain looks like:

```ts
      if (evt.type === 'system' && evt.subtype === 'init' && evt.session_id) {
        sessionId = evt.session_id
      } else if (evt.type === 'system' && evt.subtype === 'api_retry') {
        console.warn(`[claude adapter] api_retry: ${trimmed}`)
      } else if (evt.type === 'result') {
```

Add a `stream_event` clause between `api_retry` and `result`:

```ts
      if (evt.type === 'system' && evt.subtype === 'init' && evt.session_id) {
        sessionId = evt.session_id
      } else if (evt.type === 'system' && evt.subtype === 'api_retry') {
        console.warn(`[claude adapter] api_retry: ${trimmed}`)
      } else if (evt.type === 'stream_event') {
        const text = evt.event?.delta?.text
        if (text && onToken) onToken(text)
      } else if (evt.type === 'result') {
```

Now update the call site of `consumeStream` inside `callOnce`. Find:

```ts
        const drained = await consumeStream(proc)
```

and replace with:

```ts
        const drained = await consumeStream(proc, onToken)
```

**Important:** `onToken` is a parameter on the outer `callInSession` method's input object. `callOnce` is defined inside `callInSession` and closes over the input scope, so `onToken` is in scope. Verify the destructure at the top of `callInSession` includes `onToken`. Currently it's:

```ts
    async callInSession({
      sessionHandle,
      tier,
      systemPrompt,
      userPrompt,
      schema,
    }) {
```

Add `onToken` to the destructure:

```ts
    async callInSession({
      sessionHandle,
      tier,
      systemPrompt,
      userPrompt,
      schema,
      onToken,
    }) {
```

- [ ] **Step 4: Run tests to verify pass**

```bash
bun test tests/prompts/adapters/claude.test.ts
```

Expected: PASS (now 13 tests in this file).

- [ ] **Step 5: Confirm full suite + type-check**

```bash
bun test
bun run type-check
```

Total: 129 + 2 = 131.

- [ ] **Step 6: Commit**

```bash
git add src/prompts/adapters/claude.ts tests/prompts/adapters/claude.test.ts
git commit -m "feat(prompts): claude adapter forwards stream_event deltas to onToken"
```

---

## Task 7: Session resume — thread `sessionHandle` via `--resume`

**Files:**
- Modify: `tests/prompts/adapters/claude.test.ts`

The `--resume <session_id>` flag is already added by `buildArgs` when `resumeId` is truthy (Task 4). This task adds a test confirming the behavior and the new sessionHandle returned by a resumed call.

- [ ] **Step 1: Write failing tests** (note: should pass already — locking in behavior)

Append to `tests/prompts/adapters/claude.test.ts`:

```ts
describe('createClaudeAdapter — session resume', () => {
  it('omits --resume on first call when sessionHandle is null', async () => {
    const mock = createMockSpawn([
      {
        exitCode: 0,
        stdoutChunks: [
          JSON.stringify({ type: 'system', subtype: 'init', session_id: 's-new' }) + '\n',
          JSON.stringify({ type: 'result', structured_output: { ok: true, value: 1 } }) + '\n',
        ],
      },
    ])
    const adapter = createClaudeAdapter(baseConfig, mock.spawn)
    const out = await adapter.callInSession({
      sessionHandle: null,
      tier: 'main',
      systemPrompt: 's',
      userPrompt: 'u',
      schema: Sample,
    })
    expect(mock.calls[0]!.cmd).not.toContain('--resume')
    expect(out.sessionHandle).toBe('s-new')
  })

  it('passes --resume <sessionHandle> on subsequent calls', async () => {
    const mock = createMockSpawn([
      {
        exitCode: 0,
        stdoutChunks: [
          JSON.stringify({ type: 'system', subtype: 'init', session_id: 's-resumed' }) + '\n',
          JSON.stringify({ type: 'result', structured_output: { ok: true, value: 2 } }) + '\n',
        ],
      },
    ])
    const adapter = createClaudeAdapter(baseConfig, mock.spawn)
    const out = await adapter.callInSession({
      sessionHandle: 'sess-from-earlier',
      tier: 'main',
      systemPrompt: 's',
      userPrompt: 'u',
      schema: Sample,
    })
    const cmd = mock.calls[0]!.cmd
    expect(cmd).toContain('--resume')
    const resumeIdx = cmd.indexOf('--resume')
    expect(cmd[resumeIdx + 1]).toBe('sess-from-earlier')
    expect(out.sessionHandle).toBe('s-resumed')
  })
})
```

- [ ] **Step 2: Run tests to verify pass**

```bash
bun test tests/prompts/adapters/claude.test.ts
```

Expected: PASS — these tests verify existing behavior.

If they FAIL: re-check `buildArgs` in `claude.ts`. The `if (resumeId) args.push('--resume', resumeId)` line should be there.

- [ ] **Step 3: Confirm full suite**

```bash
bun test
bun run type-check
```

Total: 131 + 2 = 133.

- [ ] **Step 4: Commit**

```bash
git add tests/prompts/adapters/claude.test.ts
git commit -m "test(prompts): claude adapter threads sessionHandle via --resume"
```

---

## Task 8: Schema-retry path

**Files:**
- Modify: `tests/prompts/adapters/claude.test.ts`

The retry path is already implemented in Task 4 (via `parseOrRetry`). This task locks in that:

1. When the first call's structured output fails schema validation, the adapter makes a SECOND call with a corrective prompt.
2. The retry call uses the FIRST call's session ID (so context is preserved).
3. If the retry succeeds, the returned sessionHandle is the SECOND call's session id.
4. If the retry also fails, an `AdapterError(schema-failed)` is thrown.

- [ ] **Step 1: Write failing tests**

Append to `tests/prompts/adapters/claude.test.ts`:

```ts
describe('createClaudeAdapter — schema retry', () => {
  it('retries with corrective prompt and uses retry sessionId on success', async () => {
    const mock = createMockSpawn([
      // First call: schema fails — `value` is a string instead of number
      {
        exitCode: 0,
        stdoutChunks: [
          JSON.stringify({ type: 'system', subtype: 'init', session_id: 's-1' }) + '\n',
          JSON.stringify({
            type: 'result',
            structured_output: { ok: true, value: 'forty-two' },
          }) + '\n',
        ],
      },
      // Retry call: succeeds
      {
        exitCode: 0,
        stdoutChunks: [
          JSON.stringify({ type: 'system', subtype: 'init', session_id: 's-2' }) + '\n',
          JSON.stringify({
            type: 'result',
            structured_output: { ok: true, value: 42 },
          }) + '\n',
        ],
      },
    ])

    const adapter = createClaudeAdapter(baseConfig, mock.spawn)
    const out = await adapter.callInSession({
      sessionHandle: null,
      tier: 'main',
      systemPrompt: 's',
      userPrompt: 'do the thing',
      schema: Sample,
    })

    expect(out.result).toEqual({ ok: true, value: 42 })
    expect(out.sessionHandle).toBe('s-2')

    expect(mock.calls).toHaveLength(2)
    // Retry uses the first call's sessionId via --resume
    const retryCmd = mock.calls[1]!.cmd
    expect(retryCmd).toContain('--resume')
    expect(retryCmd[retryCmd.indexOf('--resume') + 1]).toBe('s-1')
    // Retry stdin contains the corrective prompt
    expect(mock.calls[1]!.stdinBuffer).toContain('do the thing')
    expect(mock.calls[1]!.stdinBuffer).toContain('did not match the required schema')
  })

  it('throws AdapterError(schema-failed) when retry also fails', async () => {
    const mock = createMockSpawn([
      // First call: schema fails
      {
        exitCode: 0,
        stdoutChunks: [
          JSON.stringify({ type: 'system', subtype: 'init', session_id: 's-1' }) + '\n',
          JSON.stringify({
            type: 'result',
            structured_output: { ok: 'still wrong' },
          }) + '\n',
        ],
      },
      // Retry call: ALSO fails
      {
        exitCode: 0,
        stdoutChunks: [
          JSON.stringify({ type: 'system', subtype: 'init', session_id: 's-2' }) + '\n',
          JSON.stringify({
            type: 'result',
            structured_output: { ok: 'still wrong on retry' },
          }) + '\n',
        ],
      },
    ])
    const adapter = createClaudeAdapter(baseConfig, mock.spawn)
    await expect(
      adapter.callInSession({
        sessionHandle: null,
        tier: 'main',
        systemPrompt: 's',
        userPrompt: 'u',
        schema: Sample,
      }),
    ).rejects.toMatchObject({
      name: 'AdapterError',
      cause: 'schema-failed',
    })
  })
})
```

- [ ] **Step 2: Run tests to verify pass**

```bash
bun test tests/prompts/adapters/claude.test.ts
```

Expected: PASS — these exercise existing behavior. If they FAIL, check Task 4's `retry` closure: it must reuse `first.sessionId`, append the corrective prompt, and update `lastSessionId`.

- [ ] **Step 3: Confirm full suite**

```bash
bun test
bun run type-check
```

Total: 133 + 2 = 135.

- [ ] **Step 4: Commit**

```bash
git add tests/prompts/adapters/claude.test.ts
git commit -m "test(prompts): claude adapter retries on schema failure with corrective prompt"
```

---

## Task 9: Spawn-failed and CLI error paths

**Files:**
- Modify: `src/prompts/adapters/claude.ts`
- Modify: `tests/prompts/adapters/claude.test.ts`

Two failure modes:
- `spawn-failed`: the `spawn()` call itself throws (e.g., binary not found, ENOENT). The adapter wraps in `AdapterError(spawn-failed)`.
- `cli-error`: spawn succeeds but the CLI exits non-zero. Already handled in Task 4; lock in with a test.

- [ ] **Step 1: Write failing tests**

Append to `tests/prompts/adapters/claude.test.ts`:

```ts
describe('createClaudeAdapter — error paths', () => {
  it('throws AdapterError(spawn-failed) when spawn itself throws', async () => {
    const throwingSpawn: SpawnFn = () => {
      throw new Error('ENOENT: no such file or directory')
    }
    const adapter = createClaudeAdapter(baseConfig, throwingSpawn)
    await expect(
      adapter.callInSession({
        sessionHandle: null,
        tier: 'main',
        systemPrompt: 's',
        userPrompt: 'u',
        schema: Sample,
      }),
    ).rejects.toMatchObject({
      name: 'AdapterError',
      cause: 'spawn-failed',
    })
  })

  it('throws AdapterError(cli-error) when subprocess exits non-zero', async () => {
    const mock = createMockSpawn([
      {
        exitCode: 1,
        stdoutChunks: [],
        stderrChunks: ['fatal: invalid model\n'],
      },
    ])
    const adapter = createClaudeAdapter(baseConfig, mock.spawn)
    await expect(
      adapter.callInSession({
        sessionHandle: null,
        tier: 'main',
        systemPrompt: 's',
        userPrompt: 'u',
        schema: Sample,
      }),
    ).rejects.toMatchObject({
      name: 'AdapterError',
      cause: 'cli-error',
    })
  })
})
```

The first test imports `SpawnFn` — make sure the test file imports it. Add `SpawnFn` to the existing import line at the top of the test file:

```ts
import { createClaudeAdapter, type ClaudeAdapterConfig, type SpawnFn } from '@/prompts/adapters/claude'
```

- [ ] **Step 2: Run tests to verify failure**

```bash
bun test tests/prompts/adapters/claude.test.ts
```

Expected: the spawn-failed test fails (the adapter doesn't catch spawn exceptions yet); the cli-error test passes.

- [ ] **Step 3: Wrap the spawn call in a try/catch in `claude.ts`**

In `src/prompts/adapters/claude.ts`, find the `callOnce` function. Currently:

```ts
      const callOnce = async (
        prompt: string,
        resumeId: SessionHandle,
      ): Promise<CallResult> => {
        const args = buildArgs(config, tier, systemPrompt, jsonSchema, resumeId)
        const proc = spawnFn([config.bin, ...args], {
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
        })
        proc.stdin.write(prompt)
        proc.stdin.end()

        const drained = await consumeStream(proc, onToken)
        const exitCode = await proc.exited
        if (exitCode !== 0) {
          throw new AdapterError(
            `claude CLI exited with code ${exitCode}`,
            'cli-error',
          )
        }
        return drained
      }
```

Wrap the `spawnFn(...)` call in try/catch. Replace with:

```ts
      const callOnce = async (
        prompt: string,
        resumeId: SessionHandle,
      ): Promise<CallResult> => {
        const args = buildArgs(config, tier, systemPrompt, jsonSchema, resumeId)
        let proc: SubprocessLike
        try {
          proc = spawnFn([config.bin, ...args], {
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
          })
        } catch (e) {
          throw new AdapterError(
            `failed to spawn ${config.bin}: ${(e as Error).message}`,
            'spawn-failed',
          )
        }
        proc.stdin.write(prompt)
        proc.stdin.end()

        const drained = await consumeStream(proc, onToken)
        const exitCode = await proc.exited
        if (exitCode !== 0) {
          throw new AdapterError(
            `claude CLI exited with code ${exitCode}`,
            'cli-error',
          )
        }
        return drained
      }
```

- [ ] **Step 4: Run tests to verify pass**

```bash
bun test tests/prompts/adapters/claude.test.ts
```

Expected: PASS.

- [ ] **Step 5: Confirm full suite + type-check**

```bash
bun test
bun run type-check
```

Total: 135 + 2 = 137.

- [ ] **Step 6: Commit**

```bash
git add src/prompts/adapters/claude.ts tests/prompts/adapters/claude.test.ts
git commit -m "feat(prompts): claude adapter wraps spawn failure as AdapterError(spawn-failed)"
```

---

## Task 10: Abort signal — kill subprocess on abort

**Files:**
- Modify: `src/prompts/adapters/claude.ts`
- Modify: `tests/prompts/adapters/claude.test.ts`
- Modify: `tests/prompts/adapters/_helpers/mockSpawn.ts`

When the caller passes an `AbortSignal` and aborts mid-call, the adapter must:
1. Kill the subprocess (so the CLI process doesn't keep running).
2. Throw `AdapterError(aborted)` instead of returning normally.

- [ ] **Step 1: Add an abort hook to the mock**

The current mock doesn't honor `AbortSignal`. Add support so we can simulate an abort. In `tests/prompts/adapters/_helpers/mockSpawn.ts`, modify the `spawn` function to honor the optional `signal` field of `options`.

Find the `spawn` function and replace its body. Currently:

```ts
  const spawn = (cmd: string[], options?: unknown): MockSubprocess => {
    const script = scripts[scriptIndex]
    scriptIndex++
    if (!script) {
      throw new Error(
        `mockSpawn: expected ${scripts.length} call(s) but got call #${scriptIndex}; ` +
          `cmd was: ${JSON.stringify(cmd)}`,
      )
    }

    const callRecord: SpawnCall = {
      cmd: [...cmd],
      stdinBuffer: '',
      killed: false,
      options,
    }
    calls.push(callRecord)
```

Right after `calls.push(callRecord)`, add abort handling. Insert:

```ts
    // Honor AbortSignal: when aborted, the subprocess.exited promise rejects
    // (matching real Bun.spawn behavior with signal). Tests check
    // callRecord.killed to confirm kill() was called.
    const signal = (options as { signal?: AbortSignal } | undefined)?.signal
```

Then later in the same function, modify the `exited` resolution. Find:

```ts
    let resolveExited: (code: number) => void
    const exited = new Promise<number>((resolve) => {
      resolveExited = resolve
    })

    // Resolve exited after the longest stream finishes. We use a timer that
    // outlasts the chunk emission delays so the streams have time to drain.
    const totalDelay = (script.stdoutChunks.length + (script.stderrChunks?.length ?? 0)) * delayMs
    setTimeout(() => resolveExited(script.exitCode), totalDelay + 1)
```

Replace with:

```ts
    let resolveExited: (code: number) => void
    let rejectExited: (err: Error) => void
    const exited = new Promise<number>((resolve, reject) => {
      resolveExited = resolve
      rejectExited = reject
    })

    const totalDelay = (script.stdoutChunks.length + (script.stderrChunks?.length ?? 0)) * delayMs
    const exitTimer = setTimeout(() => resolveExited(script.exitCode), totalDelay + 1)

    if (signal) {
      const onAbort = () => {
        clearTimeout(exitTimer)
        callRecord.killed = true
        subprocRef.killed = true
        rejectExited(new Error('aborted'))
      }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
```

Right before `const subproc: MockSubprocess = {`, add:

```ts
    // Forward declaration so the abort handler above can flip subproc.killed.
    // We assign subprocRef.value at the end of this function.
    const subprocRef: { killed: boolean } = { killed: false }
```

And modify the final `subproc` construction to keep `subprocRef.killed` in sync. Replace:

```ts
    const subproc: MockSubprocess = {
      stdin,
      stdout,
      stderr,
      exited,
      kill: () => {
        callRecord.killed = true
        subproc.killed = true
      },
      killed: false,
    }
    return subproc
```

with:

```ts
    const subproc: MockSubprocess = {
      stdin,
      stdout,
      stderr,
      exited,
      kill: () => {
        callRecord.killed = true
        subprocRef.killed = true
      },
      get killed() {
        return subprocRef.killed
      },
      set killed(v: boolean) {
        subprocRef.killed = v
      },
    } as MockSubprocess
    return subproc
```

The `MockSubprocess` interface declares `killed: boolean`. The getter/setter pair satisfies that.

- [ ] **Step 2: Write failing test**

Append to `tests/prompts/adapters/claude.test.ts`:

```ts
describe('createClaudeAdapter — abort', () => {
  it('throws AdapterError(aborted) when AbortSignal fires mid-call', async () => {
    const mock = createMockSpawn([
      {
        exitCode: 0,
        stdoutChunks: [
          JSON.stringify({ type: 'system', subtype: 'init', session_id: 's' }) + '\n',
          JSON.stringify({
            type: 'result',
            structured_output: { ok: true, value: 1 },
          }) + '\n',
        ],
        chunkDelayMs: 50,
      },
    ])
    const adapter = createClaudeAdapter(baseConfig, mock.spawn)
    const ctrl = new AbortController()

    // Fire abort after 5 ms — well before the 50 ms chunk delay completes.
    setTimeout(() => ctrl.abort(), 5)

    await expect(
      adapter.callInSession({
        sessionHandle: null,
        tier: 'main',
        systemPrompt: 's',
        userPrompt: 'u',
        schema: Sample,
        signal: ctrl.signal,
      }),
    ).rejects.toMatchObject({
      name: 'AdapterError',
      cause: 'aborted',
    })

    expect(mock.calls[0]!.killed).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify failure**

```bash
bun test tests/prompts/adapters/claude.test.ts
```

Expected: FAIL — adapter doesn't currently forward signal or convert abort errors.

- [ ] **Step 4: Forward signal in `claude.ts` and convert abort errors**

In `src/prompts/adapters/claude.ts`, the `callInSession` destructure needs to include `signal`. Find:

```ts
    async callInSession({
      sessionHandle,
      tier,
      systemPrompt,
      userPrompt,
      schema,
      onToken,
    }) {
```

Add `signal`:

```ts
    async callInSession({
      sessionHandle,
      tier,
      systemPrompt,
      userPrompt,
      schema,
      onToken,
      signal,
    }) {
```

Then in `callOnce`, pass signal through to `spawnFn`. Find the `try { proc = spawnFn(...) }` block and update the options object:

```ts
        try {
          proc = spawnFn([config.bin, ...args], {
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
            signal,
          })
        } catch (e) {
```

Now wrap the rest of `callOnce` so abort-related errors become `AdapterError(aborted)`. Find:

```ts
        proc.stdin.write(prompt)
        proc.stdin.end()

        const drained = await consumeStream(proc, onToken)
        const exitCode = await proc.exited
        if (exitCode !== 0) {
          throw new AdapterError(
            `claude CLI exited with code ${exitCode}`,
            'cli-error',
          )
        }
        return drained
      }
```

Replace with:

```ts
        try {
          proc.stdin.write(prompt)
          proc.stdin.end()
        } catch {
          // stdin may already be closed if abort raced — ignore
        }

        try {
          const drained = await consumeStream(proc, onToken)
          const exitCode = await proc.exited
          if (signal?.aborted) {
            throw new AdapterError('call aborted by signal', 'aborted')
          }
          if (exitCode !== 0) {
            throw new AdapterError(
              `claude CLI exited with code ${exitCode}`,
              'cli-error',
            )
          }
          return drained
        } catch (e) {
          if (signal?.aborted) {
            try { proc.kill() } catch {}
            throw new AdapterError('call aborted by signal', 'aborted')
          }
          if (e instanceof AdapterError) throw e
          throw new AdapterError(
            `unexpected error: ${(e as Error).message}`,
            'cli-error',
          )
        }
      }
```

- [ ] **Step 5: Run test to verify pass**

```bash
bun test tests/prompts/adapters/claude.test.ts
```

Expected: PASS.

- [ ] **Step 6: Confirm full suite + type-check**

```bash
bun test
bun run type-check
```

Total: 137 + 1 = 138.

- [ ] **Step 7: Commit**

```bash
git add src/prompts/adapters/claude.ts tests/prompts/adapters/claude.test.ts tests/prompts/adapters/_helpers/mockSpawn.ts
git commit -m "feat(prompts): claude adapter honors AbortSignal, throws AdapterError(aborted)"
```

---

## Task 11: Optional gated integration test

**Files:**
- Create: `tests/prompts/adapters/claude.integration.test.ts`

A real-CLI smoke test that runs ONE actual `claude -p` call to verify the adapter's wire compatibility — flags accepted, stream-json output parseable, session_id captured.

Gated: only runs when both `CLAUDE_BIN` and `ANTHROPIC_API_KEY` env vars are set. In all other cases the test file's tests are skipped. CI can enable by setting both env vars; default `bun test` just skips.

This test costs one real model call — keep it cheap (no `--include-partial-messages`, smallest possible prompt, smallest model).

- [ ] **Step 1: Write the integration test**

Create `tests/prompts/adapters/claude.integration.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { z } from 'zod'
import { createClaudeAdapter } from '@/prompts/adapters/claude'

const apiKey = process.env.ANTHROPIC_API_KEY
const claudeBin = process.env.CLAUDE_BIN ?? 'claude'

const shouldRun = Boolean(apiKey)

describe.skipIf(!shouldRun)('createClaudeAdapter — integration (real CLI)', () => {
  it('does one real call and captures session_id', async () => {
    const adapter = createClaudeAdapter({
      bin: claudeBin,
      bareMode: true,
      apiKey,
      mainModel: 'claude-haiku-4-5-20251001',
      verifierModel: 'claude-haiku-4-5-20251001',
    })

    const Schema = z.object({
      greeting: z.string(),
    })

    const out = await adapter.callInSession({
      sessionHandle: null,
      tier: 'main',
      systemPrompt: 'You return JSON exactly matching the schema. Nothing else.',
      userPrompt: 'Return {"greeting":"hi"} and nothing else.',
      schema: Schema,
    })

    expect(out.result.greeting).toBe('hi')
    expect(out.sessionHandle).toBeTruthy()
    expect(typeof out.sessionHandle).toBe('string')
  }, 30_000)  // 30s timeout — model latency
})
```

- [ ] **Step 2: Verify default behavior (skipped)**

Without `ANTHROPIC_API_KEY` set:

```bash
bun test tests/prompts/adapters/claude.integration.test.ts
```

Expected: the describe block is skipped (output shows `0 tests` or skipped).

- [ ] **Step 3: Confirm full suite still passes**

```bash
bun test
bun run type-check
```

Total: 138 + 0 (skipped) = 138 active tests.

- [ ] **Step 4: Optional — manually verify with real CLI**

If the user wants to verify, they can run:

```bash
ANTHROPIC_API_KEY=sk-ant-... bun test tests/prompts/adapters/claude.integration.test.ts
```

Expected: 1 test passes within ~10–20 seconds. This is a manual sanity check — not required for the phase to ship. If the test fails, debug at the wire level (run the same `claude` command manually, compare stream-json output to the adapter's parser).

- [ ] **Step 5: Commit**

```bash
git add tests/prompts/adapters/claude.integration.test.ts
git commit -m "test(prompts): add gated real-CLI integration smoke test for Claude adapter"
```

---

## Task 12: Phase 2b verification

**Files:** none — verification only.

- [ ] **Step 1: Verify the working tree is clean**

```bash
git status
```

Expected: `nothing to commit, working tree clean`.

- [ ] **Step 2: Run the full test suite**

```bash
bun test
```

Expected: 138 tests pass (119 from foundation + 2a, plus 19 added by this phase: 4 in Task 3 + 4 in Task 4 + 2 in Task 5 + 2 in Task 6 + 2 in Task 7 + 2 in Task 8 + 2 in Task 9 + 1 in Task 10).

- [ ] **Step 3: Type-check**

```bash
bun run type-check
```

Expected: no output.

- [ ] **Step 4: Confirm all phase 2b commits**

```bash
git log --oneline main..HEAD
```

Expected: 11 commits (Task 1 through Task 11).

- [ ] **Step 5: Spot-check the adapter file is well-formed**

```bash
wc -l src/prompts/adapters/claude.ts
```

Expected: ~180–220 lines.

```bash
bun -e "import('@/prompts/adapters/claude').then(m => console.log(typeof m.createClaudeAdapter))"
```

Expected: prints `function`.

---

## Self-review

**Spec coverage** (against thin-slice design §5):

- ✅ Auth-failed at construction with clear message — Task 3.
- ✅ All required CLI flags (`-p`, `--output-format stream-json`, `--verbose`, `--include-partial-messages`, `--append-system-prompt`, `--json-schema`, `--model`, `--bare`, `--resume`) — Task 4.
- ✅ Stream-json events handled: `system/init` (Task 4), `stream_event` deltas (Task 6), `result` (Task 4), `system/api_retry` (Task 4 — logs to stderr).
- ✅ Tier selection (`main` vs `verifier` model) — Task 4.
- ✅ Abort signal forwarded; `AdapterError(aborted)` raised — Task 10.
- ✅ Schema retry via `parseOrRetry` with corrective prompt; preserves session via `--resume` — Task 4 (impl) + Task 8 (test).
- ✅ JSON-island fallback when `structured_output` missing — Task 4 (free via `parseOrRetry`) + Task 5 (test).
- ✅ `zod-to-json-schema` for `--json-schema` — Task 1 + Task 4.
- ✅ Gated real-CLI integration test — Task 11.
- ✅ Mock-spawn helper reusable for sub-plan 4 — Task 2.

**Type consistency check:**

- `ClaudeAdapterConfig` shape — same across Task 3 (definition), Task 4 (uses), and tests.
- `SpawnFn`, `SubprocessLike` — defined once in claude.ts, imported by the abort-test in Task 10.
- `MockScript`, `SpawnCall`, `MockSpawn`, `MockSubprocess` — defined in Task 2's helper, used unchanged across Tasks 4–10.
- All `AdapterError` causes used (`auth-failed`, `spawn-failed`, `cli-error`, `aborted`, `schema-failed`, `parse-failed`) match the `AdapterErrorCause` union from phase 2a's `types.ts`.

**Placeholder scan:** none. Every step contains real code.

**Gaps:** none for the spec sections covered. Items deferred to later phases:
- `personaPrompt.ts` (the function that builds the persona system prompt from archetypes/tones) — phase 2c.
- `Session` class — phase 2c.
- `architecture-notes.md` seed entry about adapter retry behavior — phase 2h.

---

## Sequencing notes for phase 2c

Phase 2c will implement `src/orchestrator/session.ts`, `personaPrompt.ts`, `budget.ts`, and `verifier/numbers.ts` (scaffolded but unused in v2). It depends on:

- The `ProviderAdapter` interface from 2a (`types.ts`).
- `createClaudeAdapter` from this phase — but only via the `ProviderAdapter` interface, not the concrete factory. Phase 2c's tests will use a stub adapter that implements `ProviderAdapter` directly (reusing the mock-spawn helper would be over-engineering — the `Session` class doesn't care how the adapter does its work).
- The prompt templates and rubric/persona files from 2a (`personaPrompt.ts` reads them from disk).
- The Resume / TargetContext schemas from the foundation.
