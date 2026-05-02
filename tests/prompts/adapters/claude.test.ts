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
