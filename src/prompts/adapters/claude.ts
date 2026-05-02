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
  onToken: ((chunk: string) => void) | undefined,
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
      } else if (evt.type === 'stream_event') {
        const text = evt.event?.delta?.text
        if (text && onToken) onToken(text)
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
      onToken,
    }) {
      const jsonSchema = zodToJsonSchema(schema as ZodSchema<unknown>)

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
