import { describe, it, expect } from 'bun:test'
import { AdapterError } from '@/prompts/adapters/types'

describe('AdapterError', () => {
  it('is an Error subclass', () => {
    const e = new AdapterError('fail', 'cli-error')
    expect(e).toBeInstanceOf(Error)
    expect(e.message).toBe('fail')
  })

  it('carries a typed cause', () => {
    const e = new AdapterError('fail', 'schema-failed')
    expect(e.cause).toBe('schema-failed')
  })

  it.each([
    'spawn-failed',
    'cli-error',
    'parse-failed',
    'schema-failed',
    'aborted',
    'auth-failed',
  ] as const)('accepts %s as a valid cause', (cause) => {
    const e = new AdapterError('msg', cause)
    expect(e.cause).toBe(cause)
  })
})
