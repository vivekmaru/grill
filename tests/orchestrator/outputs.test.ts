import { describe, it, expect } from 'bun:test'
import {
  CritiqueScanOutput,
  FinalReviewOutput,
  RewriteOutput,
} from '@/orchestrator/outputs'

describe('CritiqueScanOutput', () => {
  it('parses a complete critique-scan response', () => {
    const result = CritiqueScanOutput.parse({
      flags: [
        {
          bulletId: 'b1',
          flag: 'jd-mismatch',
          severity: 2,
          span: 'collaborated',
          why: 'A hiring manager for this role will ask why this maps to the JD.',
          suggestedQuestion: 'Which JD requirement does this prove?',
        },
      ],
      passSummary: {
        bulletsScanned: 18,
        bulletsFlagged: 1,
        topConcern: '1 bullet uses resume-ghosting language.',
      },
    })
    expect(result.flags).toHaveLength(1)
    expect(result.passSummary.bulletsScanned).toBe(18)
  })

  it('rejects an unknown flag type', () => {
    expect(() =>
      CritiqueScanOutput.parse({
        flags: [
          {
            bulletId: 'b1',
            flag: 'redundant',
            severity: 2,
            span: 'x',
            why: 'y',
            suggestedQuestion: 'z',
          },
        ],
        passSummary: { bulletsScanned: 1, bulletsFlagged: 1, topConcern: '' },
      }),
    ).toThrow()
  })

  it('rejects a severity outside 1..3', () => {
    expect(() =>
      CritiqueScanOutput.parse({
        flags: [
          {
            bulletId: 'b1',
            flag: 'vague',
            severity: 4,
            span: 'x',
            why: 'y',
            suggestedQuestion: 'z',
          },
        ],
        passSummary: { bulletsScanned: 1, bulletsFlagged: 1, topConcern: '' },
      }),
    ).toThrow()
  })
})

describe('FinalReviewOutput', () => {
  it('parses a final-review response with remaining risks', () => {
    const result = FinalReviewOutput.parse({
      verdict: 'ready',
      summary: 'The resume is ready for the selected target.',
      remainingRisks: [
        {
          bulletId: 'b1',
          severity: 1,
          reason: 'One internal acronym remains but it is low risk.',
        },
      ],
    })
    expect(result.verdict).toBe('ready')
    expect(result.remainingRisks[0]!.bulletId).toBe('b1')
  })
})

describe('RewriteOutput', () => {
  it('parses a 2-candidate rewrite response', () => {
    const result = RewriteOutput.parse({
      candidates: [
        {
          text: 'Led migration of 12-service monolith to microservices.',
          evidenceMap: [
            { span: 'Led migration of', source: 'connective' },
            { span: '12-service monolith to microservices', source: 'original' },
          ],
        },
        {
          text: 'Drove migration of 12 services from monolith to microservices.',
          evidenceMap: [
            { span: 'Drove migration of', source: 'connective' },
            { span: '12 services from monolith to microservices', source: 'original' },
          ],
        },
      ],
    })
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates[0]!.evidenceMap[0]!.source).toBe('connective')
  })

  it('rejects an unknown evidence source', () => {
    expect(() =>
      RewriteOutput.parse({
        candidates: [
          {
            text: 'x',
            evidenceMap: [{ span: 'x', source: 'fabricated' }],
          },
        ],
      }),
    ).toThrow()
  })
})
