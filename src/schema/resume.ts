import { z } from 'zod'

export const ImpactMetric = z.object({
  value: z.string(),
  unit: z.enum(['percent', 'currency', 'count', 'time', 'other']),
  baseline: z.string().optional(),
  verified: z.boolean(),
})

// FlagInstance schema is added in Task 6 once flags.ts exists.
// For now, Bullet carries an empty-array placeholder typed as unknown[].
const FlagInstancePlaceholder = z.array(z.unknown())

export const Bullet = z.object({
  id: z.string(),
  text: z.string(),
  metrics: z.array(ImpactMetric).default([]),
  skills: z.array(z.string()).default([]),
  impactScore: z.number().min(0).max(10).optional(),
  flags: FlagInstancePlaceholder.default([]),
  sourceTurnIds: z.array(z.string()).default([]),
  status: z.enum(['draft', 'flagged', 'refined', 'accepted']),
})

export type Bullet = z.infer<typeof Bullet>
export type ImpactMetric = z.infer<typeof ImpactMetric>
