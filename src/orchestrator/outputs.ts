import { z } from 'zod'
import { FlagType, Severity } from '@/schema/flags'

/**
 * Output schema for the critique-scan template. The orchestrator parses
 * this from the adapter's response and emits per-flag CritiqueEvents.
 */
export const CritiqueScanOutput = z.object({
  flags: z.array(
    z.object({
      bulletId: z.string(),
      flag: FlagType,
      severity: Severity,
      span: z.string(),
      why: z.string(),
      suggestedQuestion: z.string(),
    }),
  ),
  passSummary: z.object({
    bulletsScanned: z.number().int().nonnegative(),
    bulletsFlagged: z.number().int().nonnegative(),
    topConcern: z.string(),
  }),
})

export type CritiqueScanOutput = z.infer<typeof CritiqueScanOutput>

/**
 * Output schema for the rewrite-wordsmith template. Returns 2 candidates
 * with token-level evidence tagging so the verifier can validate that no
 * unsourced content slipped in.
 */
export const RewriteOutput = z.object({
  candidates: z.array(
    z.object({
      text: z.string(),
      evidenceMap: z.array(
        z.object({
          span: z.string(),
          source: z.enum(['original', 'user', 'connective']),
        }),
      ),
    }),
  ),
})

export type RewriteOutput = z.infer<typeof RewriteOutput>
