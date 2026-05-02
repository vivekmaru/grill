import type { ProviderAdapter, SessionHandle } from '@/prompts/adapters/types'

/**
 * Per-call configuration: either a value to return (parsed against the schema)
 * or an error to throw. Tests build an array of these and pass to createStubAdapter.
 *
 * The array on the returned StubAdapter is mutable — tests can `responses.push(...)`
 * lazily after observing earlier calls (e.g., to thread bulletIds that only
 * become known after the ingest call lands).
 */
export type StubResponse =
  | { type: 'ok'; value: unknown; sessionId?: string | null }
  | { type: 'error'; error: Error }

export interface StubAdapter {
  adapter: ProviderAdapter
  /** Captured calls in invocation order. Mutable for assertions. */
  calls: StubCall[]
  /** Mutable response queue. Tests can push after observing calls. */
  responses: StubResponse[]
}

export interface StubCall {
  systemPrompt: string
  userPrompt: string
  tier: 'main' | 'verifier'
  sessionHandle: SessionHandle
  /** Tokens passed to onToken, if any. */
  tokens: string[]
}

/**
 * Build a ProviderAdapter that returns scripted responses. Each call shifts
 * the next response off the front of the queue. Schema validation is performed
 * against the call's schema so tests verify structural correctness implicitly.
 */
export function createStubAdapter(
  initialResponses: StubResponse[],
  options?: { name?: 'claude' | 'codex' | 'gemini' },
): StubAdapter {
  const calls: StubCall[] = []
  const responses: StubResponse[] = [...initialResponses]
  let callCounter = 0

  const adapter: ProviderAdapter = {
    name: options?.name ?? 'claude',
    async callInSession({
      systemPrompt,
      userPrompt,
      tier,
      sessionHandle,
      schema,
      onToken,
    }) {
      const tokens: string[] = []
      const callRecord: StubCall = {
        systemPrompt,
        userPrompt,
        tier,
        sessionHandle,
        tokens,
      }
      calls.push(callRecord)

      const response = responses.shift()
      callCounter++
      if (!response) {
        throw new Error(
          `stubAdapter: no response queued for call #${callCounter}`,
        )
      }

      if (response.type === 'error') {
        throw response.error
      }

      // If onToken is provided, deliver a single fake token so tests that
      // care about streaming can observe the callback path.
      if (onToken) {
        const fake = '[stub]'
        tokens.push(fake)
        onToken(fake)
      }

      const result = schema.parse(response.value)
      return {
        result,
        sessionHandle: response.sessionId ?? `stub-session-${callCounter}`,
      }
    },
  }

  return { adapter, calls, responses }
}
