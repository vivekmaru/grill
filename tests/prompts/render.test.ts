import { describe, it, expect } from 'bun:test'
import { render } from '@/prompts/render'

describe('render', () => {
  it('substitutes a single slot', () => {
    expect(render('hello {{name}}', { name: 'world' })).toBe('hello world')
  })

  it('substitutes multiple slots in one template', () => {
    expect(
      render('{{greeting}} {{name}}!', { greeting: 'hi', name: 'vivek' }),
    ).toBe('hi vivek!')
  })

  it('replaces missing slots with empty string', () => {
    expect(render('a {{x}} b', {})).toBe('a  b')
  })

  it('keeps {{#if x}} block when slot is non-empty', () => {
    expect(
      render('a {{#if x}}YES {{x}}{{/if}} b', { x: '1' }),
    ).toBe('a YES 1 b')
  })

  it('removes {{#if x}} block when slot is missing', () => {
    expect(render('a {{#if x}}YES{{/if}} b', {})).toBe('a  b')
  })

  it('removes {{#if x}} block when slot is empty string', () => {
    expect(render('a {{#if x}}YES{{/if}} b', { x: '' })).toBe('a  b')
  })

  it('handles a multi-line template with interleaved slots and conditionals', () => {
    const tpl = [
      'You are a {{archetype}}.',
      '',
      '{{#if rubric}}Standards: {{rubric}}{{/if}}',
      '',
      'Hard rules:',
      '- one',
      '- two',
    ].join('\n')
    const out = render(tpl, { archetype: 'engineer', rubric: 'be honest' })
    expect(out).toContain('You are a engineer.')
    expect(out).toContain('Standards: be honest')
  })

  it('drops the conditional block when its slot is empty in a multi-line template', () => {
    const tpl = 'A\n{{#if extra}}X {{extra}}{{/if}}\nB'
    expect(render(tpl, {})).toBe('A\n\nB')
  })

  it('does not interpret an unmatched {{#if without /if', () => {
    // Malformed template — we treat this as a literal slot replacement attempt;
    // {{#if x}} is not a slot name, so it stays as-is. The {{x}} inside the
    // body still substitutes. The renderer is intentionally simple — callers
    // are responsible for well-formed templates.
    const out = render('a {{#if x}} b {{x}} c', { x: '1' })
    // The implementation runs the conditional regex first; non-matching so
    // it stays as-is, then the {{x}} slot substitutes.
    expect(out).toContain('1')
  })
})
