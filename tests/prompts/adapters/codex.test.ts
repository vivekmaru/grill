import { describe, it, expect } from 'bun:test'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import {
  createCodexAdapter,
  type CodexAdapterConfig,
  type SpawnFn,
  type SubprocessLike,
} from '@/prompts/adapters/codex'
import { Resume } from '@/schema/resume'

const baseConfig: CodexAdapterConfig = {
  bin: 'codex',
  mainModel: 'gpt-5',
  verifierModel: 'gpt-4.1-nano',
}

const Sample = z.object({ ok: z.boolean(), value: z.number() })
const UrlSample = z.object({
  url: z.string().url().optional(),
  email: z.string().email().optional(),
})

interface CapturedCall {
  cmd: string[]
  stdinBuffer: string
  killed: boolean
}

function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.close()
    },
  })
}

function textStream(text = ''): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      if (text) controller.enqueue(encoder.encode(text))
      controller.close()
    },
  })
}

function scriptSpawn(
  scripts: Array<{
    exitCode?: number
    output?: string
    stdout?: string
    stderr?: string
    beforeExit?: (cmd: string[]) => Promise<void>
  }>,
): { spawn: SpawnFn; calls: CapturedCall[] } {
  const calls: CapturedCall[] = []
  let idx = 0
  const spawn: SpawnFn = (cmd) => {
    const script = scripts[idx++]
    if (!script) throw new Error(`unexpected spawn: ${JSON.stringify(cmd)}`)
    const call: CapturedCall = { cmd: [...cmd], stdinBuffer: '', killed: false }
    calls.push(call)

    const exited = (async () => {
      const outputIdx = cmd.indexOf('--output-last-message')
      const outputPath = outputIdx === -1 ? null : cmd[outputIdx + 1]
      if (script.beforeExit) await script.beforeExit(cmd)
      if (outputPath && script.output !== undefined) {
        await writeFile(outputPath, script.output)
      }
      return script.exitCode ?? 0
    })()

    return {
      stdin: {
        write(s: string) {
          call.stdinBuffer += s
        },
        end() {},
      },
      stdout: script.stdout === undefined ? emptyStream() : textStream(script.stdout),
      stderr: script.stderr === undefined ? emptyStream() : textStream(script.stderr),
      exited,
      kill() {
        call.killed = true
      },
    } satisfies SubprocessLike
  }
  return { spawn, calls }
}

describe('createCodexAdapter', () => {
  it('builds codex exec with schema/output files and parses final JSON', async () => {
    let schemaPath = ''
    let outputPath = ''
    let cwdPath = ''
    const mock = scriptSpawn([
      {
        output: '{"ok":true,"value":42}',
        beforeExit: async (cmd) => {
          schemaPath = cmd[cmd.indexOf('--output-schema') + 1]!
          outputPath = cmd[cmd.indexOf('--output-last-message') + 1]!
          cwdPath = cmd[cmd.indexOf('--cd') + 1]!
          const schema = JSON.parse(await readFile(schemaPath, 'utf8'))
          expect(schema.type).toBe('object')
          expect(schema.properties.ok).toBeDefined()
        },
      },
    ])

    const adapter = createCodexAdapter(baseConfig, mock.spawn)
    const out = await adapter.callInSession({
      sessionHandle: 'ignored-session',
      tier: 'main',
      systemPrompt: 'system rules',
      userPrompt: 'user task',
      schema: Sample,
    })

    expect(out.result).toEqual({ ok: true, value: 42 })
    expect(out.sessionHandle).toBeNull()
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0]!.cmd).toEqual([
      'codex',
      'exec',
      '-',
      '--json',
      '--output-schema',
      schemaPath,
      '--output-last-message',
      outputPath,
      '--model',
      'gpt-5',
      '--sandbox',
      'read-only',
      '--ephemeral',
      '--skip-git-repo-check',
      '--ignore-rules',
      '--cd',
      cwdPath,
    ])
    expect(mock.calls[0]!.stdinBuffer).toBe('system rules\n\nuser task')
    expect(schemaPath).toContain(tmpdir())
    expect(outputPath).toContain(tmpdir())
    expect(cwdPath).toContain(tmpdir())
  })

  it('uses verifierModel for verifier tier', async () => {
    const mock = scriptSpawn([{ output: '{"ok":true,"value":1}' }])
    const adapter = createCodexAdapter(baseConfig, mock.spawn)
    await adapter.callInSession({
      sessionHandle: null,
      tier: 'verifier',
      systemPrompt: 's',
      userPrompt: 'u',
      schema: Sample,
    })
    expect(mock.calls[0]!.cmd).toContain('gpt-4.1-nano')
  })

  it('strips JSON Schema format annotations unsupported by Codex structured output', async () => {
    const mock = scriptSpawn([
      {
        output: '{"url":null,"email":null}',
        beforeExit: async (cmd) => {
          const schemaPath = cmd[cmd.indexOf('--output-schema') + 1]!
          const schemaText = await readFile(schemaPath, 'utf8')
          const schema = JSON.parse(schemaText)
          expect(schemaText).not.toContain('"format"')
          expect(schema.required).toEqual(['url', 'email'])
          expect(schema.properties.url.anyOf).toContainEqual({ type: 'null' })
          expect(schema.properties.email.anyOf).toContainEqual({ type: 'null' })
        },
      },
    ])

    const adapter = createCodexAdapter(baseConfig, mock.spawn)
    const out = await adapter.callInSession({
      sessionHandle: null,
      tier: 'main',
      systemPrompt: 's',
      userPrompt: 'u',
      schema: UrlSample,
    })

    expect(out.result).toEqual({})
  })

  it('inlines repeated schemas instead of writing nested $ref references', async () => {
    const mock = scriptSpawn([
      {
        output: JSON.stringify({
          version: 1,
          contact: {
            name: 'Jane Doe',
            email: null,
            phone: null,
            location: null,
            links: [],
          },
          summary: null,
          roles: [],
          education: [],
          projects: [],
          skills: { categories: [] },
          certifications: [],
        }),
        beforeExit: async (cmd) => {
          const schemaPath = cmd[cmd.indexOf('--output-schema') + 1]!
          const schemaText = await readFile(schemaPath, 'utf8')
          expect(schemaText).not.toContain('"$ref"')
        },
      },
    ])

    const adapter = createCodexAdapter(baseConfig, mock.spawn)
    const out = await adapter.callInSession({
      sessionHandle: null,
      tier: 'main',
      systemPrompt: 's',
      userPrompt: 'u',
      schema: Resume,
    })

    expect(out.result.version).toBe(1)
  })

  it('retries once with a corrective prompt and still returns null sessionHandle', async () => {
    const mock = scriptSpawn([
      { output: '{"ok":true,"value":"wrong"}' },
      { output: '{"ok":true,"value":7}' },
    ])
    const adapter = createCodexAdapter(baseConfig, mock.spawn)
    const out = await adapter.callInSession({
      sessionHandle: 'previous',
      tier: 'main',
      systemPrompt: 's',
      userPrompt: 'u',
      schema: Sample,
    })

    expect(out.result).toEqual({ ok: true, value: 7 })
    expect(out.sessionHandle).toBeNull()
    expect(mock.calls).toHaveLength(2)
    expect(mock.calls[1]!.cmd).not.toContain('resume')
    expect(mock.calls[1]!.stdinBuffer).toContain('did not match the required schema')
  })

  it('maps spawn failures, non-zero exits, parse failures, schema failures, and aborts', async () => {
    const throwing = createCodexAdapter(baseConfig, (() => {
      throw new Error('ENOENT')
    }) as SpawnFn)
    await expect(
      throwing.callInSession({
        sessionHandle: null,
        tier: 'main',
        systemPrompt: 's',
        userPrompt: 'u',
        schema: Sample,
      }),
    ).rejects.toMatchObject({ name: 'AdapterError', cause: 'spawn-failed' })

    const nonZero = createCodexAdapter(
      baseConfig,
      scriptSpawn([{ exitCode: 2, output: '{"ok":true,"value":1}' }]).spawn,
    )
    await expect(
      nonZero.callInSession({
        sessionHandle: null,
        tier: 'main',
        systemPrompt: 's',
        userPrompt: 'u',
        schema: Sample,
      }),
    ).rejects.toMatchObject({ name: 'AdapterError', cause: 'cli-error' })

    const parseFail = createCodexAdapter(
      baseConfig,
      scriptSpawn([{ output: 'no json' }, { output: 'still no json' }]).spawn,
    )
    await expect(
      parseFail.callInSession({
        sessionHandle: null,
        tier: 'main',
        systemPrompt: 's',
        userPrompt: 'u',
        schema: Sample,
      }),
    ).rejects.toMatchObject({ name: 'AdapterError', cause: 'parse-failed' })

    const schemaFail = createCodexAdapter(
      baseConfig,
      scriptSpawn([
        { output: '{"ok":"wrong"}' },
        { output: '{"ok":"still wrong"}' },
      ]).spawn,
    )
    await expect(
      schemaFail.callInSession({
        sessionHandle: null,
        tier: 'main',
        systemPrompt: 's',
        userPrompt: 'u',
        schema: Sample,
      }),
    ).rejects.toMatchObject({ name: 'AdapterError', cause: 'schema-failed' })

    const ac = new AbortController()
    ac.abort()
    const aborting = createCodexAdapter(baseConfig, scriptSpawn([]).spawn)
    await expect(
      aborting.callInSession({
        sessionHandle: null,
        tier: 'main',
        systemPrompt: 's',
        userPrompt: 'u',
        schema: Sample,
        signal: ac.signal,
      }),
    ).rejects.toMatchObject({ name: 'AdapterError', cause: 'aborted' })
  })

  it('includes stdout JSON diagnostics when codex exits non-zero', async () => {
    const adapter = createCodexAdapter(
      baseConfig,
      scriptSpawn([
        {
          exitCode: 1,
          stdout: '{"type":"error","message":"schema rejected by cli"}\n',
        },
      ]).spawn,
    )

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
      message: expect.stringContaining('schema rejected by cli'),
    })
  })
})
