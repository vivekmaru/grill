import type { ZodSchema } from 'zod'
import { AdapterError } from './types'

/**
 * Locate the first balanced JSON object in a string. Walks brace depth
 * while ignoring braces inside string literals (handles backslash-escaped
 * quotes). Returns the substring including outer braces, or null if none.
 *
 * Object-only — does not extract top-level arrays. All our adapter
 * outputs are objects, by schema design.
 */
function extractJsonIsland(s: string): string | null {
  const start = s.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escape = false

  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (escape) { escape = false; continue }
    if (inString) {
      if (c === '\\') { escape = true; continue }
      if (c === '"') inString = false
      continue
    }
    if (c === '"') { inString = true; continue }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

/**
 * Try multiple strategies in order. Return the parsed value or null.
 */
function tryExtract(raw: string): unknown | null {
  // Strategy 1: trimmed direct parse
  const trimmed = raw.trim()
  try { return JSON.parse(trimmed) } catch {}

  // Strategy 2: strip a ```json or ``` fenced block
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced && fenced[1]) {
    try { return JSON.parse(fenced[1].trim()) } catch {}
  }

  // Strategy 3: locate first balanced { … } island
  const island = extractJsonIsland(trimmed)
  if (island) {
    try { return JSON.parse(island) } catch {}
  }

  return null
}

/**
 * Extract a JSON object from `raw`, validate it against `schema`. On schema
 * failure, call `retry()` ONCE for a corrective response and re-validate.
 *
 * Throws `AdapterError`:
 * - `parse-failed` if neither `raw` nor the retry response yields parseable JSON.
 * - `schema-failed` if the JSON parses but doesn't satisfy `schema` after one retry.
 *
 * The retry function is provided by the adapter — typically it issues a new
 * model call with a corrective prompt appended.
 */
export async function parseOrRetry<T>(
  raw: string,
  schema: ZodSchema<T>,
  retry: () => Promise<string>,
): Promise<T> {
  const first = tryExtract(raw)
  if (first !== null) {
    const r = schema.safeParse(first)
    if (r.success) return r.data
    // Schema failure → retry once
    const retryRaw = await retry()
    const second = tryExtract(retryRaw)
    if (second === null) {
      throw new AdapterError(
        'retry response did not contain parseable JSON',
        'parse-failed',
      )
    }
    const r2 = schema.safeParse(second)
    if (r2.success) return r2.data
    throw new AdapterError(
      `schema validation failed after retry: ${r2.error.message}`,
      'schema-failed',
    )
  }

  // Initial parse failure → still try retry once
  const retryRaw = await retry()
  const second = tryExtract(retryRaw)
  if (second === null) {
    throw new AdapterError(
      'no parseable JSON in initial response or retry',
      'parse-failed',
    )
  }
  const r = schema.safeParse(second)
  if (r.success) return r.data
  throw new AdapterError(
    `schema validation failed on retry: ${r.error.message}`,
    'schema-failed',
  )
}
