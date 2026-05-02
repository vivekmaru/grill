import { describe, it, expect } from 'bun:test'
import { extractNumbers } from '@/orchestrator/verifier/numbers'

describe('extractNumbers', () => {
  it('extracts percentages', () => {
    const tokens = extractNumbers('Reduced latency by 30% and improved 2.5% throughput')
    expect(tokens).toContain('30%')
    expect(tokens).toContain('2.5%')
  })

  it('extracts dollar amounts with K/M/B suffixes', () => {
    const tokens = extractNumbers('Drove $1.2M in revenue, saved $500K, raised $10B')
    expect(tokens).toContain('$1.2M')
    expect(tokens).toContain('$500K')
    expect(tokens).toContain('$10B')
  })

  it('extracts plain dollar amounts', () => {
    const tokens = extractNumbers('Recovered $250 in costs')
    expect(tokens).toContain('$250')
  })

  it('extracts multipliers like 10x and 2.5x', () => {
    const tokens = extractNumbers('Scaled throughput 10x and reduced cost 2.5x')
    expect(tokens).toContain('10x')
    expect(tokens).toContain('2.5x')
  })

  it('extracts headcount tokens', () => {
    const tokens = extractNumbers('Led 30 engineers across 4 teams managing 12 services')
    expect(tokens).toContain('30')
    expect(tokens).toContain('4')
    expect(tokens).toContain('12')
  })

  it('returns an empty set for prose with no numbers', () => {
    const tokens = extractNumbers('led the team and shipped good code')
    expect(tokens.size).toBe(0)
  })

  it('deduplicates repeated tokens', () => {
    const tokens = extractNumbers('30% then again 30% then once more 30%')
    expect(tokens.size).toBe(1)
    expect(tokens).toContain('30%')
  })
})
