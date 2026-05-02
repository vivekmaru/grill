export interface BudgetState {
  made: number
  max: number
  allowExtraUsage: boolean
}

export class BudgetExceededError extends Error {
  constructor(
    public readonly made: number,
    public readonly max: number,
  ) {
    super(`session quota reached (${made}/${max} calls)`)
    this.name = 'BudgetExceededError'
  }
}

export interface BudgetEnforcer {
  /** Increment the counter. Throws BudgetExceededError if at cap and overage off. */
  recordCall(): void
  /** Flip allowExtraUsage to true. Subsequent recordCall() calls won't throw. */
  allowOverage(): void
  /** Current state. */
  snapshot(): BudgetState
}

export function createBudgetEnforcer(initial: BudgetState): BudgetEnforcer {
  let made = initial.made
  let allowExtraUsage = initial.allowExtraUsage
  const max = initial.max

  return {
    recordCall() {
      if (made >= max && !allowExtraUsage) {
        throw new BudgetExceededError(made, max)
      }
      made++
    },
    allowOverage() {
      allowExtraUsage = true
    },
    snapshot() {
      return { made, max, allowExtraUsage }
    },
  }
}
