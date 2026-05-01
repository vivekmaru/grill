import { z } from 'zod'

const numericString = (defaultValue: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? defaultValue : Number(v)))
    .refine((n) => Number.isFinite(n), { message: 'must be a finite number' })

const booleanString = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return defaultValue
      if (v === 'true' || v === '1') return true
      if (v === 'false' || v === '0') return false
      throw new Error(`invalid boolean: ${v}`)
    })

const EnvSchema = z.object({
  AI_PROVIDER: z.enum(['claude', 'codex', 'gemini']).default('claude'),
  CLAUDE_BIN: z.string().default('claude'),
  GEMINI_BIN: z.string().default('gemini'),
  OPENAI_BIN: z.string().default('codex'),
  ANTHROPIC_MAIN_MODEL: z.string().default('claude-opus-4-7'),
  ANTHROPIC_VERIFIER_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  GEMINI_MAIN_MODEL: z.string().default('gemini-2.5-pro'),
  GEMINI_VERIFIER_MODEL: z.string().default('gemini-flash-latest'),
  OPENAI_MAIN_MODEL: z.string().default('gpt-5'),
  OPENAI_VERIFIER_MODEL: z.string().default('gpt-4.1-nano'),
  CLAUDE_BARE_MODE: booleanString(true),
  PORT: numericString(4321),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MAX_MODEL_CALLS_PER_SESSION: numericString(60),
  DATA_DIR: z.string().optional(),
})

export type Env = z.infer<typeof EnvSchema>

/**
 * Parse an env-vars-shaped object. In production, callers pass `process.env`.
 * Tests pass synthetic objects directly — never read real env in unit tests.
 */
export function loadEnv(source: Record<string, string | undefined>): Env {
  return EnvSchema.parse(source)
}
