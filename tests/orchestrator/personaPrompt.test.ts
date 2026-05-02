import { describe, it, expect } from 'bun:test'
import {
  parseHeaderedMarkdown,
  loadPersonaAssets,
  buildPersonaSystemPrompt,
} from '@/orchestrator/personaPrompt'

describe('parseHeaderedMarkdown', () => {
  it('splits markdown by H2 headers and returns body keyed by header text', () => {
    const md = [
      'Intro paragraph that should be ignored.',
      '',
      '## first-key',
      'Body of first.',
      '',
      'More body of first.',
      '',
      '## second-key',
      'Body of second.',
    ].join('\n')

    const result = parseHeaderedMarkdown(md)
    expect(result['first-key']).toContain('Body of first.')
    expect(result['first-key']).toContain('More body of first.')
    expect(result['second-key']).toBe('Body of second.')
    expect(result['intro']).toBeUndefined()
  })

  it('strips parenthetical suffixes from headers (e.g., "skeptical (default)")', () => {
    const md = '## skeptical (default)\nBody.\n## curious\nMore body.'
    const result = parseHeaderedMarkdown(md)
    expect(result['skeptical']).toBe('Body.')
    expect(result['curious']).toBe('More body.')
  })
})

describe('loadPersonaAssets', () => {
  it('returns archetypes, tones, rubricCore, rubricFlags from disk', async () => {
    const assets = await loadPersonaAssets()
    expect(assets.archetypes['engineering-manager']).toContain('Engineering Manager')
    expect(assets.archetypes['founder']).toContain('Founder')
    expect(assets.tones['skeptical']).toContain('professionally and directly')
    expect(assets.tones['adversarial']).toContain('press hard')
    expect(assets.rubricCore).toContain('Specificity')
    expect(assets.rubricFlags).toContain('unverified')
  })
})

describe('buildPersonaSystemPrompt', () => {
  it('builds a prompt for engineering-manager + skeptical with no JD overlay', async () => {
    const out = await buildPersonaSystemPrompt(
      { archetype: 'engineering-manager', tone: 'skeptical' },
      {},
    )
    expect(out).toContain('Engineering Manager')
    expect(out).toContain('professionally and directly')
    expect(out).toContain('Specificity')
    expect(out).toContain('Hard rules:')
    expect(out).toContain('Never invent metrics')
    expect(out).not.toContain('Standards specific to this role')
  })

  it('includes the JD overlay block when jdOverlay is provided', async () => {
    const out = await buildPersonaSystemPrompt(
      { archetype: 'vp-product', tone: 'curious' },
      { jdOverlay: 'This role explicitly asks for B2B SaaS metrics literacy.' },
    )
    expect(out).toContain('VP of Product')
    expect(out).toContain('Standards specific to this role')
    expect(out).toContain('B2B SaaS metrics literacy')
  })

  it('throws if the archetype key is unknown', async () => {
    await expect(
      buildPersonaSystemPrompt(
        // @ts-expect-error: unknown archetype
        { archetype: 'space-cowboy', tone: 'skeptical' },
        {},
      ),
    ).rejects.toThrow(/archetype/)
  })

  it('throws if the tone key is unknown', async () => {
    await expect(
      buildPersonaSystemPrompt(
        // @ts-expect-error: unknown tone
        { archetype: 'founder', tone: 'menacing' },
        {},
      ),
    ).rejects.toThrow(/tone/)
  })
})
