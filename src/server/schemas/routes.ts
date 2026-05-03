import { z } from 'zod'
import { TargetContext } from '@/schema/target'

export const CreateSessionBody = z.object({
  resume: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('markdown'), text: z.string().min(1) }),
    z.object({ kind: z.literal('blank') }),
  ]),
  target: TargetContext,
  gather: z.boolean().optional(),
})
export type CreateSessionBody = z.infer<typeof CreateSessionBody>

export const AcceptFlagBody = z.object({
  newText: z.string().min(1),
})
export type AcceptFlagBody = z.infer<typeof AcceptFlagBody>

export const SkipFlagBody = z.object({}).passthrough()
export type SkipFlagBody = z.infer<typeof SkipFlagBody>

export const DismissFlagBody = z.object({
  reason: z.string().optional(),
})
export type DismissFlagBody = z.infer<typeof DismissFlagBody>

export const RewriteFlagBody = z.object({}).passthrough()
export type RewriteFlagBody = z.infer<typeof RewriteFlagBody>

export const EditBulletBody = z.object({
  bulletId: z.string().min(1),
  newText: z.string().min(1),
})
export type EditBulletBody = z.infer<typeof EditBulletBody>

export const GatherAnswerBody = z.object({
  turnId: z.number().int().positive(),
  answer: z.string().min(1),
})
export type GatherAnswerBody = z.infer<typeof GatherAnswerBody>
