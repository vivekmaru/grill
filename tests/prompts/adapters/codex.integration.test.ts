import { describe, it, expect } from 'bun:test'
import { z } from 'zod'
import { loadEnv } from '@/lib/env'
import { createCodexAdapter } from '@/prompts/adapters/codex'

const shouldRun = process.env.RESUME_BUILDER_REAL_CODEX === '1'

describe.skipIf(!shouldRun)('createCodexAdapter - integration (real CLI)', () => {
  it('does one schema-constrained call and returns no session handle', async () => {
    const env = loadEnv(process.env)
    const adapter = createCodexAdapter({
      bin: env.OPENAI_BIN,
      mainModel: env.OPENAI_MAIN_MODEL,
      verifierModel: env.OPENAI_VERIFIER_MODEL,
    })

    const Schema = z.object({
      status: z.literal('ok'),
      provider: z.literal('codex'),
    })

    const out = await adapter.callInSession({
      sessionHandle: null,
      tier: 'main',
      systemPrompt: 'Return only JSON matching the supplied schema.',
      userPrompt: 'Return {"status":"ok","provider":"codex"} and nothing else.',
      schema: Schema,
    })

    expect(out.result).toEqual({ status: 'ok', provider: 'codex' })
    expect(out.sessionHandle).toBeNull()
  }, 120_000)
})

