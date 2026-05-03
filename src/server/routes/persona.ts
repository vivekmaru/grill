import { Hono } from 'hono'
import { z } from 'zod'
import { join } from 'node:path'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { render } from '@/prompts/render'
import { PersonaProposeOutput } from '@/orchestrator/outputs'
import { Seniority } from '@/schema/target'
import { respondWithError } from '@/server/errors'
import type { AppDeps } from '@/server/deps'

export const PersonaProposeBody = z.object({
  targetRole: z.string().min(1),
  targetSeniority: Seniority,
  industry: z.string().optional(),
  jobDescription: z.string().optional(),
})

const PROMPTS_DIR = join(import.meta.dir, '..', '..', 'prompts')

let cachedTemplate: string | null = null
async function loadTemplate(): Promise<string> {
  if (cachedTemplate) return cachedTemplate
  cachedTemplate = await Bun.file(
    join(PROMPTS_DIR, 'templates/persona-propose.md'),
  ).text()
  return cachedTemplate
}

export function personaRoutes(deps: AppDeps): Hono {
  const router = new Hono()

  router.post('/propose', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch (e) {
      return respondWithError(c, e)
    }
    const parsed = PersonaProposeBody.safeParse(body)
    if (!parsed.success) return respondWithError(c, parsed.error)

    try {
      const template = await loadTemplate()
      const userPrompt = render(template, {
        target_role: parsed.data.targetRole,
        target_seniority: parsed.data.targetSeniority,
        industry: parsed.data.industry ?? '(not specified)',
        job_description: parsed.data.jobDescription ?? '(not provided)',
        output_schema: JSON.stringify(zodToJsonSchema(PersonaProposeOutput)),
      })
      const out = await deps.adapter.callInSession({
        sessionHandle: null,
        tier: 'main',
        systemPrompt:
          'You are a calibration assistant choosing the best Skeptical Interviewer persona. Be concise.',
        userPrompt,
        schema: PersonaProposeOutput,
      })
      return c.json(out.result)
    } catch (e) {
      return respondWithError(c, e)
    }
  })

  return router
}
