import { z } from 'zod'
import { TargetContext } from './target'

export const Event = z.discriminatedUnion('type', [
  z.object({ type: z.literal('UPLOAD_RESUME'), markdown: z.string() }),
  z.object({ type: z.literal('START_BLANK') }),
  z.object({ type: z.literal('CONFIRM_INGEST') }),
  z.object({ type: z.literal('SET_TARGET'), ctx: TargetContext }),
  z.object({ type: z.literal('CONFIRM_PERSONA') }),
  z.object({ type: z.literal('OVERRIDE_PERSONA'), prompt: z.string() }),
  z.object({ type: z.literal('USER_MESSAGE'), text: z.string() }),
  z.object({
    type: z.literal('ACCEPT_BULLET'),
    bulletId: z.string(),
    newText: z.string(),
  }),
  z.object({ type: z.literal('REJECT_BULLET'), bulletId: z.string() }),
  z.object({ type: z.literal('SKIP_BULLET'), bulletId: z.string() }),
  z.object({
    type: z.literal('DISMISS_FLAG'),
    bulletId: z.string(),
    flagIndex: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal('END_INTERROGATION') }),
  z.object({ type: z.literal('PROCEED_TO_GENERATE') }),
  z.object({ type: z.literal('PICK_TEMPLATE'), templateId: z.string() }),
  z.object({
    type: z.literal('EDIT_RESUME'),
    patch: z.array(z.unknown()), // RFC 6902 — refined when used
  }),
  z.object({ type: z.literal('EXPORT'), format: z.enum(['pdf', 'docx']) }),
])

export type Event = z.infer<typeof Event>
