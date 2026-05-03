import { describe, it, expect } from 'bun:test'
import { loadEnv } from '@/lib/env'
import {
  createDevAdapter,
  DEV_SERVER_IDLE_TIMEOUT_SECONDS,
} from '@/server/dev'

describe('createDevAdapter', () => {
  it('uses the Codex adapter by default', () => {
    const adapter = createDevAdapter(loadEnv({}))
    expect(adapter.name).toBe('codex')
  })

  it('uses the mock Codex stub when RESUME_BUILDER_MOCK_CODEX=1', () => {
    const adapter = createDevAdapter(loadEnv({}), {
      RESUME_BUILDER_MOCK_CODEX: '1',
    })
    expect(adapter.name).toBe('codex')
  })

  it('keeps dev connections open long enough for live Codex SSE calls', () => {
    expect(DEV_SERVER_IDLE_TIMEOUT_SECONDS).toBeGreaterThanOrEqual(120)
  })
})
