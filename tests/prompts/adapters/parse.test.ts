import { describe, it, expect } from 'bun:test'
import { z } from 'zod'
import { parseOrRetry } from '@/prompts/adapters/parse'
import { AdapterError } from '@/prompts/adapters/types'

const Sample = z.object({ ok: z.boolean(), value: z.number() })

describe('parseOrRetry', () => {
  it('parses a clean JSON object on the first try', async () => {
    const retry = async () => { throw new Error('should not be called') }
    const result = await parseOrRetry('{"ok":true,"value":42}', Sample, retry)
    expect(result).toEqual({ ok: true, value: 42 })
  })

  it('strips ```json fences', async () => {
    const raw = '```json\n{"ok":true,"value":1}\n```'
    const retry = async () => { throw new Error('should not be called') }
    const result = await parseOrRetry(raw, Sample, retry)
    expect(result.ok).toBe(true)
  })

  it('strips bare ``` fences', async () => {
    const raw = '```\n{"ok":false,"value":7}\n```'
    const retry = async () => { throw new Error('should not be called') }
    const result = await parseOrRetry(raw, Sample, retry)
    expect(result.value).toBe(7)
  })

  it('extracts a JSON island from surrounding prose', async () => {
    const raw = 'Here is the answer: {"ok":true,"value":99} hope that helps.'
    const retry = async () => { throw new Error('should not be called') }
    const result = await parseOrRetry(raw, Sample, retry)
    expect(result.value).toBe(99)
  })

  it('handles nested braces inside string values', async () => {
    const raw = '{"ok":true,"value":1,"note":"contains } a brace"}'
    const Schema = z.object({ ok: z.boolean(), value: z.number(), note: z.string() })
    const retry = async () => { throw new Error('should not be called') }
    const result = await parseOrRetry(raw, Schema, retry)
    expect(result.note).toBe('contains } a brace')
  })

  it('retries once on schema mismatch and succeeds', async () => {
    let calls = 0
    const retry = async () => {
      calls++
      return '{"ok":true,"value":5}'
    }
    const result = await parseOrRetry('{"ok":"yes","value":"5"}', Sample, retry)
    expect(result).toEqual({ ok: true, value: 5 })
    expect(calls).toBe(1)
  })

  it('throws AdapterError(schema-failed) after one failed retry', async () => {
    let calls = 0
    const retry = async () => {
      calls++
      return '{"ok":"still wrong"}'
    }
    await expect(
      parseOrRetry('{"ok":"wrong"}', Sample, retry),
    ).rejects.toMatchObject({
      name: 'AdapterError',
      cause: 'schema-failed',
    })
    expect(calls).toBe(1)
  })

  it('throws AdapterError(parse-failed) when no JSON can be located', async () => {
    const retry = async () => 'still no JSON here'
    await expect(
      parseOrRetry('not JSON at all', Sample, retry),
    ).rejects.toMatchObject({
      name: 'AdapterError',
      cause: 'parse-failed',
    })
  })

  it('uses retry result and rejects parse-failed if retry also has no JSON', async () => {
    let calls = 0
    const retry = async () => {
      calls++
      return 'still no braces'
    }
    await expect(
      parseOrRetry('also no braces', Sample, retry),
    ).rejects.toBeInstanceOf(AdapterError)
    expect(calls).toBe(1)
  })
})
