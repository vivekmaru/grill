import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ZodSchema } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { parseOrRetry } from './parse'
import type { ModelTier, ProviderAdapter } from './types'
import { AdapterError } from './types'

export interface CodexAdapterConfig {
  bin: string
  mainModel: string
  verifierModel: string
}

export interface SubprocessLike {
  stdin: { write(s: string): void; end(): void }
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  exited: Promise<number>
  kill: () => void
}

export type SpawnFn = (cmd: string[], options?: unknown) => SubprocessLike

function modelForTier(config: CodexAdapterConfig, tier: ModelTier): string {
  return tier === 'main' ? config.mainModel : config.verifierModel
}

function buildArgs(args: {
  schemaPath: string
  outputPath: string
  model: string
  cwdPath: string
}): string[] {
  return [
    'exec',
    '-',
    '--json',
    '--output-schema',
    args.schemaPath,
    '--output-last-message',
    args.outputPath,
    '--model',
    args.model,
    '--sandbox',
    'read-only',
    '--ephemeral',
    '--skip-git-repo-check',
    '--ignore-rules',
    '--cd',
    args.cwdPath,
  ]
}

function combinePrompts(systemPrompt: string, userPrompt: string): string {
  if (!systemPrompt.trim()) return userPrompt
  if (!userPrompt.trim()) return systemPrompt
  return `${systemPrompt}\n\n${userPrompt}`
}

async function drainText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let out = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  out += decoder.decode()
  return out
}

function diagnosticTail(stdout: string, stderr: string): string {
  const diagnostic = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n')
  if (!diagnostic) return ''
  const maxLength = 2000
  const tail =
    diagnostic.length > maxLength
      ? `...${diagnostic.slice(diagnostic.length - maxLength)}`
      : diagnostic
  return `: ${tail}`
}

function stripUnsupportedSchemaFormats(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUnsupportedSchemaFormats)
  if (!value || typeof value !== 'object') return value

  const out: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'format') continue
    out[key] = stripUnsupportedSchemaFormats(nested)
  }
  return out
}

export function createCodexAdapter(
  config: CodexAdapterConfig,
  spawn?: SpawnFn,
): ProviderAdapter {
  const spawnFn: SpawnFn =
    spawn ??
    ((cmd: string[], options?: unknown) =>
      Bun.spawn(
        cmd,
        options as Parameters<typeof Bun.spawn>[1],
      ) as unknown as SubprocessLike)

  return {
    name: 'codex',

    async callInSession({
      tier,
      systemPrompt,
      userPrompt,
      schema,
      signal,
    }) {
      if (signal?.aborted) {
        throw new AdapterError('call aborted by signal', 'aborted')
      }

      const jsonSchema = stripUnsupportedSchemaFormats(
        zodToJsonSchema(schema as ZodSchema<unknown>, {
          target: 'openAi',
          $refStrategy: 'none',
        }),
      )

      const callOnce = async (prompt: string): Promise<string> => {
        const rootDir = await mkdtemp(join(tmpdir(), 'resume-builder-codex-'))
        const cwdPath = join(rootDir, 'cwd')
        const schemaPath = join(rootDir, 'schema.json')
        const outputPath = join(rootDir, 'last-message.txt')
        await mkdir(cwdPath)
        await writeFile(schemaPath, JSON.stringify(jsonSchema))

        const cmd = [
          config.bin,
          ...buildArgs({
            schemaPath,
            outputPath,
            model: modelForTier(config, tier),
            cwdPath,
          }),
        ]

        let proc: SubprocessLike
        try {
          proc = spawnFn(cmd, {
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
            signal,
          })
        } catch (e) {
          await rm(rootDir, { recursive: true, force: true })
          throw new AdapterError(
            `failed to spawn ${config.bin}: ${(e as Error).message}`,
            'spawn-failed',
          )
        }

        try {
          proc.stdin.write(combinePrompts(systemPrompt, prompt))
          proc.stdin.end()
        } catch {
          // If an abort closes stdin first, the exit handling below maps it.
        }

        try {
          const stdoutPromise = drainText(proc.stdout).catch(() => '')
          const stderrPromise = drainText(proc.stderr).catch(() => '')
          const exitCode = await proc.exited
          const stdout = await stdoutPromise
          const stderr = await stderrPromise
          if (signal?.aborted) {
            throw new AdapterError('call aborted by signal', 'aborted')
          }
          if (exitCode !== 0) {
            throw new AdapterError(
              `codex CLI exited with code ${exitCode}${diagnosticTail(stdout, stderr)}`,
              'cli-error',
            )
          }
          return await readFile(outputPath, 'utf8')
        } catch (e) {
          if (signal?.aborted) {
            try {
              proc.kill()
            } catch {}
            throw new AdapterError('call aborted by signal', 'aborted')
          }
          if (e instanceof AdapterError) throw e
          throw new AdapterError(
            `unexpected error: ${(e as Error).message}`,
            'cli-error',
          )
        } finally {
          await rm(rootDir, { recursive: true, force: true })
        }
      }

      const firstRaw = await callOnce(userPrompt)
      const retry = async (): Promise<string> => {
        const correctivePrompt =
          userPrompt +
          '\n\nYour previous response did not match the required schema. ' +
          'Return ONLY valid JSON matching the schema. No prose, no fences.'
        return callOnce(correctivePrompt)
      }

      const result = (await parseOrRetry(firstRaw, schema, retry)) as unknown
      return {
        result: result as never,
        sessionHandle: null,
      }
    },
  }
}
