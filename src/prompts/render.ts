/**
 * Tiny prompt template engine. Supports `{{slot}}` substitution and
 * `{{#if slot}}…{{/if}}` conditional blocks. No nesting, no loops, no escaping.
 *
 * Empty string and `undefined` are equivalent — both treated as "missing".
 *
 * Conditionals are processed first so a `{{x}}` inside a `{{#if x}}` body
 * substitutes correctly when the block is kept.
 */
const CONDITIONAL = /\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g
const SLOT = /\{\{(\w+)\}\}/g

export function render(template: string, slots: Record<string, string>): string {
  return template
    .replace(CONDITIONAL, (_, key, body) => (slots[key] ? body : ''))
    .replace(SLOT, (_, key) => slots[key] ?? '')
}
