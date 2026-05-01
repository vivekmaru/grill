import { describe, it, expect } from 'bun:test'
import { loadEnv } from '@/lib/env'

describe('loadEnv', () => {
  it('parses a complete env block', () => {
    const env = loadEnv({
      AI_PROVIDER: 'claude',
      CLAUDE_BIN: 'claude',
      GEMINI_BIN: 'gemini',
      OPENAI_BIN: 'codex',
      ANTHROPIC_MAIN_MODEL: 'claude-opus-4-7',
      ANTHROPIC_VERIFIER_MODEL: 'claude-haiku-4-5-20251001',
      GEMINI_MAIN_MODEL: 'gemini-2.5-pro',
      GEMINI_VERIFIER_MODEL: 'gemini-flash-latest',
      OPENAI_MAIN_MODEL: 'gpt-5',
      OPENAI_VERIFIER_MODEL: 'gpt-4.1-nano',
      CLAUDE_BARE_MODE: 'true',
      PORT: '4321',
      NODE_ENV: 'development',
      MAX_MODEL_CALLS_PER_SESSION: '60',
    })
    expect(env.AI_PROVIDER).toBe('claude')
    expect(env.PORT).toBe(4321)
    expect(env.CLAUDE_BARE_MODE).toBe(true)
    expect(env.MAX_MODEL_CALLS_PER_SESSION).toBe(60)
  })

  it('applies defaults for unset values', () => {
    const env = loadEnv({})
    expect(env.AI_PROVIDER).toBe('claude')
    expect(env.PORT).toBe(4321)
    expect(env.NODE_ENV).toBe('development')
    expect(env.CLAUDE_BARE_MODE).toBe(true)
  })

  it('rejects an unknown AI_PROVIDER', () => {
    expect(() => loadEnv({ AI_PROVIDER: 'cohere' })).toThrow()
  })

  it('rejects a non-numeric PORT', () => {
    expect(() => loadEnv({ PORT: 'abc' })).toThrow()
  })
})
