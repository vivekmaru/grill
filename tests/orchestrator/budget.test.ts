import { describe, it, expect } from 'bun:test'
import {
  createBudgetEnforcer,
  BudgetExceededError,
} from '@/orchestrator/budget'

describe('BudgetEnforcer', () => {
  it('snapshot reflects initial state', () => {
    const b = createBudgetEnforcer({ max: 60, made: 0, allowExtraUsage: false })
    expect(b.snapshot()).toEqual({ made: 0, max: 60, allowExtraUsage: false })
  })

  it('recordCall increments the counter', () => {
    const b = createBudgetEnforcer({ max: 60, made: 5, allowExtraUsage: false })
    b.recordCall()
    expect(b.snapshot().made).toBe(6)
    b.recordCall()
    expect(b.snapshot().made).toBe(7)
  })

  it('throws BudgetExceededError when at the cap and allowExtraUsage is false', () => {
    const b = createBudgetEnforcer({ max: 3, made: 3, allowExtraUsage: false })
    expect(() => b.recordCall()).toThrow(BudgetExceededError)
  })

  it('does not throw when at the cap if allowExtraUsage is true', () => {
    const b = createBudgetEnforcer({ max: 3, made: 3, allowExtraUsage: true })
    expect(() => b.recordCall()).not.toThrow()
    expect(b.snapshot().made).toBe(4)
  })

  it('allowOverage flips the flag and unblocks subsequent calls', () => {
    const b = createBudgetEnforcer({ max: 3, made: 3, allowExtraUsage: false })
    expect(() => b.recordCall()).toThrow(BudgetExceededError)
    b.allowOverage()
    expect(b.snapshot().allowExtraUsage).toBe(true)
    expect(() => b.recordCall()).not.toThrow()
  })

  it('BudgetExceededError carries max and made fields', () => {
    const b = createBudgetEnforcer({ max: 3, made: 3, allowExtraUsage: false })
    try {
      b.recordCall()
    } catch (e) {
      expect(e).toBeInstanceOf(BudgetExceededError)
      expect((e as BudgetExceededError).max).toBe(3)
      expect((e as BudgetExceededError).made).toBe(3)
    }
  })
})
