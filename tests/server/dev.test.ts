import { describe, it, expect } from 'bun:test'
import { loadEnv } from '@/lib/env'
import {
  createDevAdapters,
  DEV_SERVER_IDLE_TIMEOUT_SECONDS,
} from '@/server/dev'

describe('createDevAdapters', () => {
  it('always includes the codex adapter', async () => {
    const adapters = await createDevAdapters(loadEnv({}), {
      RESUME_BUILDER_MOCK_CODEX: '1',
    })
    expect(adapters['codex']).toBeDefined()
    expect(adapters['codex']!.name).toBe('codex')
  })

  it('includes both codex and claude when RESUME_BUILDER_MOCK_CODEX=1', async () => {
    const adapters = await createDevAdapters(loadEnv({}), {
      RESUME_BUILDER_MOCK_CODEX: '1',
    })
    expect(adapters['codex']).toBeDefined()
    expect(adapters['claude']).toBeDefined()
  })

  it('keeps dev connections open long enough for live Codex SSE calls', () => {
    expect(DEV_SERVER_IDLE_TIMEOUT_SECONDS).toBeGreaterThanOrEqual(120)
  })
})
