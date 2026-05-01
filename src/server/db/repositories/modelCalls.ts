import type { Database } from 'bun:sqlite'
import type { ProviderName } from './sessions'

export type Tier = 'main' | 'verifier'

export interface ModelCallInput {
  sessionId: number
  templateName: string
  provider: ProviderName
  tier: Tier
  tokensInEstimate: number | null
  tokensOutEstimate: number | null
  latencyMs: number | null
  validationFailures: number
  verifierRejections: number
}

export interface SessionTotals {
  count: number
  tokensIn: number
  tokensOut: number
}

export interface ModelCallsRepo {
  record(input: ModelCallInput): void
  totalsForSession(sessionId: number): SessionTotals
}

export function createModelCallsRepo(db: Database): ModelCallsRepo {
  const insert = db.query<
    unknown,
    [number, string, string, string, number | null, number | null, number | null, number, number, number]
  >(
    `INSERT INTO model_calls
     (session_id, template_name, provider, tier,
      tokens_in_estimate, tokens_out_estimate, latency_ms,
      validation_failures, verifier_rejections, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const totals = db.query<
    { count: number; tokens_in: number | null; tokens_out: number | null },
    [number]
  >(
    `SELECT
       COUNT(*) AS count,
       COALESCE(SUM(tokens_in_estimate), 0) AS tokens_in,
       COALESCE(SUM(tokens_out_estimate), 0) AS tokens_out
     FROM model_calls WHERE session_id = ?`,
  )

  return {
    record(input) {
      insert.run(
        input.sessionId,
        input.templateName,
        input.provider,
        input.tier,
        input.tokensInEstimate,
        input.tokensOutEstimate,
        input.latencyMs,
        input.validationFailures,
        input.verifierRejections,
        Date.now(),
      )
    },
    totalsForSession(sessionId) {
      const row = totals.get(sessionId)
      return {
        count: row?.count ?? 0,
        tokensIn: row?.tokens_in ?? 0,
        tokensOut: row?.tokens_out ?? 0,
      }
    },
  }
}
