import { describe, it, expect } from 'bun:test'

describe('gather templates', () => {
  it('gather-broad has required slots', async () => {
    const text = await Bun.file('src/prompts/templates/gather-broad.md').text()
    for (const slot of ['{{persona}}', '{{role_company}}', '{{role_title}}', '{{role_dates}}', '{{existing_bullets}}', '{{target_context}}']) {
      expect(text).toContain(slot)
    }
  })

  it('gather-followup has required slots', async () => {
    const text = await Bun.file('src/prompts/templates/gather-followup.md').text()
    for (const slot of ['{{persona}}', '{{role_company}}', '{{role_title}}', '{{user_answer_so_far}}', '{{followups_already_asked}}']) {
      expect(text).toContain(slot)
    }
  })
})
