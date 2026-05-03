import type { Context } from 'hono'
import { ZodError } from 'zod'
import { BudgetExceededError } from '@/orchestrator/budget'
import {
  EvidencedFlagNotSupportedError,
  VerifierFailedError,
  BlockingFlagsError,
} from '@/orchestrator/session'

export function respondWithError(c: Context, error: unknown): Response {
  if (error instanceof ZodError) {
    return c.json(
      { error: { code: 'validation', issues: error.issues } },
      400,
    )
  }
  if (error instanceof BudgetExceededError) {
    return c.json(
      {
        error: {
          code: 'budget_exceeded',
          made: error.made,
          max: error.max,
        },
      },
      429,
    )
  }
  if (error instanceof BlockingFlagsError) {
    return c.json(
      {
        error: {
          code: 'final_review_blocked',
          blockers: error.blockers,
          message: error.message,
        },
      },
      409,
    )
  }
  if (error instanceof VerifierFailedError) {
    return c.json(
      {
        error: {
          code: 'rewrite_verifier_failed',
          flag: error.flag,
          invented: error.invented,
        },
      },
      422,
    )
  }
  if (error instanceof EvidencedFlagNotSupportedError) {
    return c.json(
      {
        error: {
          code: 'evidenced_flag_not_supported',
          flag: error.flag,
        },
      },
      422,
    )
  }
  if (error instanceof Error) {
    if (/Session not found/.test(error.message)) {
      return c.json({ error: { code: 'session_not_found' } }, 404)
    }
    if (/severity-3/.test(error.message)) {
      return c.json(
        {
          error: {
            code: 'severity_3_confirmation_required',
            message: error.message,
          },
        },
        409,
      )
    }
    if (/not allowed/.test(error.message)) {
      return c.json(
        { error: { code: 'state_conflict', message: error.message } },
        409,
      )
    }
    return c.json(
      { error: { code: 'internal', message: error.message } },
      500,
    )
  }
  return c.json({ error: { code: 'internal', message: 'unknown' } }, 500)
}
