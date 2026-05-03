import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@/prompts/render'

const templatesDir = join(import.meta.dir, '..', '..', 'src', 'prompts', 'templates')

function readTemplate(name: string): string {
  return readFileSync(join(templatesDir, name), 'utf8')
}

describe('templates', () => {
  describe('critique-scan.md', () => {
    const tpl = readTemplate('critique-scan.md')

    it('contains all expected slots', () => {
      for (const slot of [
        '{{persona}}',
        '{{rubric_flags}}',
        '{{target_context}}',
        '{{resume_json}}',
        '{{dismissed_bullet_ids}}',
        '{{output_schema}}',
      ]) {
        expect(tpl).toContain(slot)
      }
    })

    it('contains the 8-flag cap hard rule', () => {
      expect(tpl).toContain('Maximum 8 flags surfaced')
    })

    it('contains the exact-substring rule for span', () => {
      expect(tpl.toLowerCase()).toContain('exact substring')
    })

    it('renders with synthetic slots producing non-empty output', () => {
      const out = render(tpl, {
        persona: 'P',
        rubric_flags: 'F',
        target_context: 'T',
        resume_json: '{}',
        dismissed_bullet_ids: '[]',
        output_schema: '{}',
      })
      expect(out.length).toBeGreaterThan(tpl.length / 2)
      // No unsubstituted slots remain
      expect(out).not.toMatch(/\{\{\w+\}\}/)
    })
  })

  describe('rewrite-wordsmith.md', () => {
    const tpl = readTemplate('rewrite-wordsmith.md')

    it('contains all expected slots', () => {
      for (const slot of [
        '{{persona}}',
        '{{original_bullet}}',
        '{{flag_type}}',
        '{{flag_reason}}',
        '{{user_clarification}}',
        '{{output_schema}}',
      ]) {
        expect(tpl).toContain(slot)
      }
    })

    it('lists the four supported flag types', () => {
      for (const flag of ['vague', 'passive', 'length', 'jargon']) {
        expect(tpl).toContain(flag)
      }
    })

    it('contains the no-new-metrics hard rule', () => {
      expect(tpl).toContain('MAY NOT introduce new metrics')
    })

    it('asks for exactly 2 candidates', () => {
      expect(tpl).toContain('exactly 2 candidates')
    })
  })

  describe('rewrite-evidenced.md', () => {
    const tpl = readTemplate('rewrite-evidenced.md')

    it('contains all expected slots', () => {
      for (const slot of [
        '{{persona}}',
        '{{original_bullet}}',
        '{{flag_type}}',
        '{{flag_reason}}',
        '{{evidence}}',
        '{{output_schema}}',
      ]) {
        expect(tpl).toContain(slot)
      }
    })

    it('lists the four evidence flag types', () => {
      for (const flag of ['unverified', 'no-impact', 'inflated', 'stale']) {
        expect(tpl).toContain(flag)
      }
    })

    it('forbids un-sourced numeric tokens', () => {
      expect(tpl).toContain('un-sourced numeric')
    })

    it('asks for exactly 2 candidates', () => {
      expect(tpl).toContain('exactly 2 candidates')
    })
  })

  describe('ingest-markdown.md', () => {
    const tpl = readTemplate('ingest-markdown.md')

    it('contains the expected slots', () => {
      expect(tpl).toContain('{{markdown}}')
      expect(tpl).toContain('{{output_schema}}')
    })

    it('contains the no-invention hard rule', () => {
      expect(tpl).toContain('Do NOT invent')
    })

    it('specifies ISO YYYY-MM date format', () => {
      expect(tpl).toContain('YYYY-MM')
    })

    it('sets default status to draft', () => {
      expect(tpl.toLowerCase()).toContain('"draft"')
    })
  })

  describe('persona-system.md', () => {
    const tpl = readTemplate('persona-system.md')

    it('contains all expected slots', () => {
      for (const slot of ['{{archetype}}', '{{tone}}', '{{rubric_core}}']) {
        expect(tpl).toContain(slot)
      }
    })

    it('contains the conditional jdOverlay block', () => {
      expect(tpl).toContain('{{#if jdOverlay}}')
      expect(tpl).toContain('{{jdOverlay}}')
      expect(tpl).toContain('{{/if}}')
    })

    it('contains the four hard rules', () => {
      expect(tpl).toContain('Never invent metrics')
      expect(tpl).toContain('you must ask, not assume')
      expect(tpl).toContain('Stay in role')
      expect(tpl).toContain('return ONLY the requested JSON')
    })
  })
})
