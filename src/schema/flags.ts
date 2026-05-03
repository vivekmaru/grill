import { z } from 'zod'

export const FlagType = z.enum([
  'unverified',
  'no-impact',
  'inflated',
  'specificity',
  'seniority-mismatch',
  'jd-mismatch',
  'metric-risk',
  'wording-weakness',
  'vague',
  'passive',
  'length',
  'jargon',
  'stale',
])

export const Severity = z.union([z.literal(1), z.literal(2), z.literal(3)])

export const FlagInstance = z.object({
  flag: FlagType,
  severity: Severity,
  span: z.string(),
  why: z.string(),
  suggestedQuestion: z.string(),
  dismissed: z.boolean().default(false),
  dismissedAt: z.number().nullable().default(null), // unix ms
})

export type FlagType = z.infer<typeof FlagType>
export type Severity = z.infer<typeof Severity>
export type FlagInstance = z.infer<typeof FlagInstance>
