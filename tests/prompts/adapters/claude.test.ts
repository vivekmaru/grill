import { describe, it, expect } from 'bun:test'
import { createClaudeAdapter, type ClaudeAdapterConfig } from '@/prompts/adapters/claude'
import { AdapterError } from '@/prompts/adapters/types'
import { z } from 'zod'
import { createMockSpawn } from './_helpers/mockSpawn'

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
