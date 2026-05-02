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
  }, 30_000)
})
