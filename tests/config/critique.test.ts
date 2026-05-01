import { describe, it, expect } from 'vitest'
import {
  MAX_FLAGS_PER_PASS,
  MAX_FOLLOWUPS_PER_ROLE,
  DEFAULT_SEVERITY_FLOOR,
  MAX_REWRITE_RETRIES,
  MAX_REWRITE_CANDIDATES,
  JD_OVERLAY_MAX_STANDARDS,
} from '@/config/critique'

describe('critique config', () => {
  it('matches the spec defaults', () => {
    expect(MAX_FLAGS_PER_PASS).toBe(8)
    expect(MAX_FOLLOWUPS_PER_ROLE).toBe(2)
    expect(DEFAULT_SEVERITY_FLOOR).toBe(2)
    expect(MAX_REWRITE_RETRIES).toBe(1)
    expect(MAX_REWRITE_CANDIDATES).toBe(2)
    expect(JD_OVERLAY_MAX_STANDARDS).toBe(3)
  })
})
