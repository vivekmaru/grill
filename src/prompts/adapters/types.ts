import type { ZodSchema } from 'zod'

/**
 * Tier selects which model the adapter uses for a given call.
 * v2 only uses 'main'. 'verifier' is reserved for sub-plan 3's Tier-2
 * entity verifier (cheap small-model call after a rewrite).
 */
export type ModelTier = 'main' | 'verifier'

/**
 * Opaque per-provider session context. For Claude/Codex this is the
 * provider's session_id string (used with --resume). For Gemini, the
 * orchestrator manages a transcript array — see sub-plan 4.
 *
 * `null` means "no prior session". The adapter returns a fresh handle
 * the caller should pass to the next call to keep CLI-side context.
 */
export type SessionHandle = string | null

export interface ProviderAdapter {
  readonly name: 'claude' | 'codex' | 'gemini'

  /**
   * One-shot call. Streams partial text via `onToken` if provided.
   * Returns the parsed structured result and the (possibly new)
   * session handle.
   */
  callInSession<T>(args: {
    sessionHandle: SessionHandle
    tier: ModelTier
    systemPrompt: string
    userPrompt: string
    schema: ZodSchema<T>
    onToken?: (chunk: string) => void
    signal?: AbortSignal
  }): Promise<{ result: T; sessionHandle: SessionHandle }>
}

export type AdapterErrorCause =
  | 'spawn-failed'   // CLI binary not found / not executable
  | 'cli-error'      // CLI exited non-zero
  | 'parse-failed'   // JSON island couldn't be extracted
  | 'schema-failed'  // Zod parse failed even after one retry
  | 'aborted'        // signal triggered
  | 'auth-failed'    // detected from CLI stderr or missing env

export class AdapterError extends Error {
  readonly cause: AdapterErrorCause

  constructor(message: string, cause: AdapterErrorCause) {
    super(message)
    this.name = 'AdapterError'
    this.cause = cause
  }
}
