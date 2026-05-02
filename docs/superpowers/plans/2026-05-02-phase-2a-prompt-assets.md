# Phase 2a — Prompt Assets + Adapter Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land all prompt-related assets and the provider-adapter scaffolding without any live model calls. After this phase, every prompt template can be rendered with synthetic slots, every flag/persona/rubric file is in place, the `BEGIN_CRITIQUE` state-machine event is wired, and the `ProviderAdapter` interface + JSON-island parser are tested in isolation. Phase 2b then ships the live Claude adapter on top of this foundation.

**Architecture:** Pure-function additions only. The renderer is ~10 lines of `{{slot}}` substitution. Markdown assets are inert data. The adapter `types.ts` exports an interface + error class; `parse.ts` exports `parseOrRetry` for use by future adapters. No process spawning, no HTTP, no I/O beyond reading the markdown assets in tests.

**Tech Stack:** TypeScript on Bun, Zod for schema, `bun:test`. No new dependencies.

**Branch:** `feat/phase2a-prompt-assets`. Merge to `main` when phase complete.

---

## File Structure

```
src/
├── prompts/                              # NEW DIRECTORY
│   ├── render.ts                         # {{slot}} + {{#if}} substitution
│   ├── rubric/
│   │   ├── core.md                       # baseline standards (placeholder; tuned in sub-plan 3)
│   │   └── flags.md                      # 8 flag types + severity definitions
│   ├── personas/
│   │   ├── archetypes.md                 # 7 archetype role descriptions
│   │   └── tones.md                      # 4 tones
│   ├── templates/
│   │   ├── critique-scan.md              # per spec §4 of thin-slice doc
│   │   └── rewrite-wordsmith.md          # per spec §4 of thin-slice doc
│   └── adapters/
│       ├── types.ts                      # ProviderAdapter interface + AdapterError
│       └── parse.ts                      # parseOrRetry helper
├── schema/events.ts                      # MODIFIED — add BEGIN_CRITIQUE
└── state/states.ts, reducer.ts           # MODIFIED — wire BEGIN_CRITIQUE

tests/
├── prompts/                              # NEW DIRECTORY
│   ├── render.test.ts
│   ├── templates.test.ts                 # integrity checks for the 2 templates
│   └── adapters/
│       └── parse.test.ts
├── schema/events.test.ts                 # MODIFIED — add BEGIN_CRITIQUE case
└── state/reducer.test.ts                 # MODIFIED — add gather→critique transition
```

**Why this layout:**

- `prompts/` is its own top-level concern, sibling to `schema/`, `state/`, `server/`, etc. Templates are *data*, the adapter interface is *contract*, the renderer is the *connector*. Keeping them grouped surfaces "everything about talking to models" in one place.
- `rubric/`, `personas/`, `templates/`, `adapters/` are sub-folders by *kind of asset*, not by lifecycle stage. Sub-plan 3 will add `rubric/jd-overlay-prompt.md` and `templates/gather-broad.md` etc. without restructuring.
- `adapters/types.ts` and `adapters/parse.ts` ship in 2a. `adapters/claude.ts` lands in 2b.

---

## Task 1: Add `BEGIN_CRITIQUE` event to schema

**Files:**
- Modify: `src/schema/events.ts`
- Modify: `tests/schema/events.test.ts`

`BEGIN_CRITIQUE` is the orchestrator-emitted event that drives `gather → critique`. v2 emits it immediately after `CONFIRM_PERSONA` (gather is skipped). Sub-plan 3 emits it after the gather funnel completes.

- [ ] **Step 1: Add failing test**

Append to `tests/schema/events.test.ts` (after the existing tests, before any closing block):

```ts
  it('parses BEGIN_CRITIQUE', () => {
    expect(Event.parse({ type: 'BEGIN_CRITIQUE' }).type).toBe('BEGIN_CRITIQUE')
  })
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/schema/events.test.ts
```

Expected: FAIL — `BEGIN_CRITIQUE` not a valid type literal.

- [ ] **Step 3: Add the event variant**

In `src/schema/events.ts`, add a new entry to the `discriminatedUnion` array. Place it immediately before the `END_INTERROGATION` entry so related events stay near each other:

```ts
  z.object({ type: z.literal('BEGIN_CRITIQUE') }),
  z.object({ type: z.literal('END_INTERROGATION') }),
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test tests/schema/events.test.ts
```

Expected: PASS.

- [ ] **Step 5: Confirm full suite still passes**

```bash
bun test
bun run type-check
```

Both must succeed.

- [ ] **Step 6: Commit**

```bash
git add src/schema/events.ts tests/schema/events.test.ts
git commit -m "feat(schema): add BEGIN_CRITIQUE event"
```

---

## Task 2: Wire `BEGIN_CRITIQUE` in the state machine

**Files:**
- Modify: `src/state/states.ts`
- Modify: `src/state/reducer.ts`
- Modify: `tests/state/states.test.ts`
- Modify: `tests/state/reducer.test.ts`

The reducer must accept `BEGIN_CRITIQUE` from the `gather` state and transition to `critique`.

- [ ] **Step 1: Add failing tests**

Append to `tests/state/states.test.ts` inside the existing `describe('State', ...)`:

```ts
  it('allows BEGIN_CRITIQUE from gather', () => {
    expect(allowedEventsFor('gather')).toContain('BEGIN_CRITIQUE')
  })
```

Append to `tests/state/reducer.test.ts` inside the existing `describe('reduce', ...)`:

```ts
  it('moves gather → critique on BEGIN_CRITIQUE', () => {
    expect(reduce('gather', { type: 'BEGIN_CRITIQUE' })).toBe('critique')
  })

  it('throws if BEGIN_CRITIQUE is fired outside gather', () => {
    expect(() =>
      reduce('ingest', { type: 'BEGIN_CRITIQUE' }),
    ).toThrow(/not allowed/)
  })
```

- [ ] **Step 2: Run tests to verify failure**

```bash
bun test tests/state/
```

Expected: FAIL — `BEGIN_CRITIQUE` not in the gather event list, reducer doesn't handle the transition.

- [ ] **Step 3: Update the allowed-events map**

In `src/state/states.ts`, add `'BEGIN_CRITIQUE'` to the `gather` entry of the `ALLOWED` record:

```ts
  gather:      ['USER_MESSAGE', 'BEGIN_CRITIQUE', 'END_INTERROGATION'],
```

- [ ] **Step 4: Update the reducer**

In `src/state/reducer.ts`, find the `case 'gather':` block and add the `BEGIN_CRITIQUE` handling. The block was previously:

```ts
    case 'gather':
      // gather→critique happens via the orchestrator emitting an internal
      // event after gather is complete (lands in sub-plan 3). For now, the
      // only user-facing exit from gather is END_INTERROGATION (handled above).
      return 'gather'
```

Replace it with:

```ts
    case 'gather':
      if (event.type === 'BEGIN_CRITIQUE') return 'critique'
      // The only other exit from gather is END_INTERROGATION (handled above).
      return 'gather'
```

- [ ] **Step 5: Run tests to verify pass**

```bash
bun test tests/state/
```

Expected: PASS.

- [ ] **Step 6: Confirm full suite still passes**

```bash
bun test
bun run type-check
```

Both must succeed.

- [ ] **Step 7: Commit**

```bash
git add src/state/states.ts src/state/reducer.ts tests/state/states.test.ts tests/state/reducer.test.ts
git commit -m "feat(state): wire BEGIN_CRITIQUE for gather → critique transition"
```

---

## Task 3: `render.ts` — `{{slot}}` substitution engine

**Files:**
- Create: `src/prompts/render.ts`
- Create: `tests/prompts/render.test.ts`

A ~10-line template engine. Two operations only: `{{key}}` substitution and `{{#if key}}…{{/if}}` conditional blocks. No nesting, no loops, no escaping. Belt-and-braces against future scope creep.

- [ ] **Step 1: Write failing tests**

Create `tests/prompts/render.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify failure**

```bash
bun test tests/prompts/render.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement render.ts**

Create `src/prompts/render.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify pass**

```bash
bun test tests/prompts/render.test.ts
```

Expected: PASS (9 tests).

- [ ] **Step 5: Confirm full suite + type-check**

```bash
bun test
bun run type-check
```

- [ ] **Step 6: Commit**

```bash
git add src/prompts/render.ts tests/prompts/render.test.ts
git commit -m "feat(prompts): add tiny {{slot}} + {{#if}} template renderer"
```

---

## Task 4: `rubric/core.md` — baseline rubric (placeholder content)

**Files:**
- Create: `src/prompts/rubric/core.md`

Per spec D1 and §4.1, the rubric core ships as **placeholder content** in v2. Sub-plan 3 has a dedicated rubric-tuning task. The content here just needs to be functional enough for a real critique pass.

- [ ] **Step 1: Create the file**

Create `src/prompts/rubric/core.md`:

```markdown
A bullet point should pass these tests:

1. **Specificity.** Names a concrete project, system, or outcome — not "various initiatives" or "key projects".
2. **Action with ownership.** Uses an active verb that the candidate themselves did, not a passive construction or a team-level "we".
3. **Outcome.** States what changed because of the action: a metric moved, a problem went away, a capability arrived. Activity without outcome is filler.
4. **Scope match.** The scale claimed (team size, budget, geography, blast radius) is consistent with the candidate's title and tenure for that role.
5. **Defensibility in 30 seconds.** A hiring manager could ask "tell me more about that" and the candidate could give a coherent answer without inventing details.
6. **No resume-ghosting.** Words like *collaborated, leveraged, results-driven, passionate, spearheaded, drove* are weak unless backed by specifics in the same bullet.
7. **No invented metrics.** Numbers, percentages, dollar figures, and headcounts must be real. If the candidate cannot remember the exact figure, drop the metric — never round up.

These standards are the floor, not the ceiling. The candidate's target role and seniority may demand more (e.g., staff+ engineers should show technical depth and influence beyond their immediate team).
```

- [ ] **Step 2: Verify the file exists with non-empty content**

```bash
test -s src/prompts/rubric/core.md && echo OK
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add src/prompts/rubric/core.md
git commit -m "feat(prompts): seed rubric/core.md (placeholder; tuned in sub-plan 3)"
```

---

## Task 5: `rubric/flags.md` — flag taxonomy + severity

**Files:**
- Create: `src/prompts/rubric/flags.md`

Per spec §5 of the prompt-design doc — 8 flags with severity, definition, and a default question phrasing. Injected into `critique-scan.md` via the `{{rubric_flags}}` slot.

- [ ] **Step 1: Create the file**

Create `src/prompts/rubric/flags.md`:

```markdown
Eight flag types may apply to any bullet. Each has a severity from 1 to 3 — higher is more serious.

| Flag | Severity | What to look for | Default question |
|---|---|---|---|
| `unverified` | 3 | A specific number, percentage, dollar amount, headcount, or named outcome with no supporting evidence in the conversation. | "Where does the [X] number come from? Can you confirm it?" |
| `no-impact` | 3 | The bullet describes activity (verbs of doing) with no outcome (verbs of effect). Example: "Built a CI pipeline." | "What changed because of this? Time saved? Reliability? Adoption?" |
| `inflated` | 3 | A scale claim that doesn't match seniority or role context. Example: a 2-year IC claiming "led a 50-person org". | "How many people reported to you, directly and indirectly, when you did this?" |
| `vague` | 2 | Resume-ghosting words: *collaborated, leveraged, results-driven, passionate, spearheaded, drove* with no specifics attached. | "What did [vague verb] actually look like — what were you doing day to day?" |
| `passive` | 2 | "Was responsible for", "tasked with", "involved in". Removes agency, hides the actual contribution. | "What did *you* do here, specifically? Were you the one who decided/built/led?" |
| `length` | 2 | Bullet is over ~25 words; usually a run-on or carrying multiple claims that should be split. | "This bullet is doing two jobs — want to split it, or trim?" |
| `jargon` | 1 | An acronym or internal-only term unlikely to be understood by an outside reader. | "Will an outside reader know what [term] means? Want to expand it?" |
| `stale` | 1 | A bullet older than 5 years that's longer than ~10 words and not load-bearing for the target role. | "This is from a while back — is it still differentiating, or can we trim it?" |

Severity guidance:
- **Severity 3** flags are the highest priority. Surface them first.
- **Severity 2** flags are surfaced by default once severity-3 flags are exhausted.
- **Severity 1** flags are hidden behind a "deeper review" toggle.

Cap each critique pass at 8 flags total. If more than 8 qualify, surface the highest-severity 8 (break ties by impact on hireability for the target role).
```

- [ ] **Step 2: Verify the file**

```bash
test -s src/prompts/rubric/flags.md && echo OK
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add src/prompts/rubric/flags.md
git commit -m "feat(prompts): add rubric/flags.md with 8-flag taxonomy"
```

---

## Task 6: `personas/archetypes.md` — 7 archetype descriptions

**Files:**
- Create: `src/prompts/personas/archetypes.md`

Per spec §4.2 of the prompt-design doc — 7 archetypes, no adjectives. Each gets ~3 sentences describing what *that role* tends to focus on when reading a resume.

- [ ] **Step 1: Create the file**

Create `src/prompts/personas/archetypes.md`:

```markdown
Each archetype represents a role a hiring manager or interviewer might play. The orchestrator selects one based on the user's choice, and the persona system prompt embeds its description.

## engineering-manager

You are an Engineering Manager interviewing a candidate. You probe scope and tradeoffs: how big was the team, who owned what decision, what tradeoffs were considered, what got dropped. You are wary of bullets that describe activity without showing the candidate's own judgment. You distinguish between work the candidate led versus work they participated in.

## director-of-engineering

You are a Director of Engineering. You probe cross-team coordination, headcount, budget, and organizational outcomes. Single-team accomplishments matter less to you than evidence the candidate moved a larger system — multiple reports, partnership with other directors, or measurable business impact across teams. You ask about how the candidate handled disagreement at peer level.

## tech-recruiter

You are a Technical Recruiter screening the resume before it reaches the hiring manager. You probe credentials, brand-name signals, tenure patterns (job hopping, gaps), and skills-keyword match against the target role. You are not impressed by jargon you cannot evaluate; you are impressed by clear evidence the candidate has done the work the role requires.

## vp-product

You are a VP of Product reviewing an engineering candidate's resume from a product lens. You probe outcome over output: which customers benefited, which metrics moved, which decisions changed. Activity-flavored bullets ("built X", "shipped Y") feel hollow to you unless paired with what they enabled.

## founder

You are a Founder who has worn many hats. You probe scrappiness and ownership beyond title — did the candidate take initiative outside their formal scope, did they ship without process, did they understand the business reason for what they were building. You discount bullets that read like a job description; you reward stories of getting things done despite constraints.

## staff-principal-ic

You are a Staff or Principal IC. You probe technical depth, influence without authority, and the hard problems the candidate has solved. You want to see them name a non-trivial system, describe a real tradeoff, or articulate a technical direction they set. Generic bullets ("worked with Kafka") are noise; specific ones ("rebuilt the consumer group rebalancing protocol to cut cold-start time 60%") are signal.

## department-head

You are a non-engineering Department Head — Sales, Marketing, Operations, or Finance — interviewing for a leadership role. You probe business outcomes, stakeholder management, and P&L exposure. Engineering-flavored bullets without business context don't impress you. You ask "what did the business get?"
```

- [ ] **Step 2: Verify the file**

```bash
test -s src/prompts/personas/archetypes.md && echo OK
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add src/prompts/personas/archetypes.md
git commit -m "feat(prompts): add personas/archetypes.md with 7 role archetypes"
```

---

## Task 7: `personas/tones.md` — 4 tones

**Files:**
- Create: `src/prompts/personas/tones.md`

Per spec §4.3 of the prompt-design doc — 4 tones reshape the language register without changing flag thresholds.

- [ ] **Step 1: Create the file**

Create `src/prompts/personas/tones.md`:

```markdown
The tone shapes the language register the interviewer uses. The flag taxonomy and severity stay constant; only the phrasing of questions and explanations changes.

## skeptical (default)

You speak professionally and directly. You don't flatter and you don't soften. When something is unclear or unsupported, you say so plainly. Treat first answers as starting points, not ending points — but don't hammer. Default register for most candidates.

## curious

You ask "why" and "how" frequently. You treat vagueness as a research opportunity, not a failure. Where the skeptical tone says "this needs evidence", the curious tone says "tell me more about how that came together". Same flag, gentler entry point.

## adversarial

You press hard. You don't accept first answers. Use "really?" and "but" frequently. Where the skeptical tone says "what did 'collaborate' mean here", the adversarial tone says "really? You alone, or were you in a meeting room while someone else drove this?" Reserved for hardening passes — too sharp for a friendly first review.

## coaching

You soften every critique with a forward-looking suggestion. Where the skeptical tone says "this bullet has no measurable outcome", the coaching tone says "this would land harder if we could pair it with the result — what changed for the team?" Pair every flag with a "have you considered…" alternative.
```

- [ ] **Step 2: Verify the file**

```bash
test -s src/prompts/personas/tones.md && echo OK
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add src/prompts/personas/tones.md
git commit -m "feat(prompts): add personas/tones.md with 4 register tones"
```

---

## Task 8: `templates/critique-scan.md`

**Files:**
- Create: `src/prompts/templates/critique-scan.md`

Per spec §4 of the thin-slice doc, the body of `critique-scan.md`. Slot names: `{{persona}}`, `{{rubric_flags}}`, `{{target_context}}`, `{{resume_json}}`, `{{dismissed_bullet_ids}}`, `{{output_schema}}`.

The persona system prompt is built separately and injected via the `{{persona}}` slot at render time.

- [ ] **Step 1: Create the file**

Create `src/prompts/templates/critique-scan.md`:

```markdown
{{persona}}

You are scanning the candidate's resume for weaknesses against the standards above. Apply the flag taxonomy below.

{{rubric_flags}}

Hard rules:
- Maximum 8 flags surfaced. If more qualify, return only the 8 highest-severity, breaking ties by impact on hireability for the target role.
- One flag per bullet maximum in this pass. Bullets needing multiple critiques surface them across rounds.
- The `span` field MUST be an exact substring of the bullet's text.
- The `why` field is in recruiter voice ("a hiring manager will ask…"), one sentence, ≤25 words.
- Skip any bullet whose id appears in the dismissed-flag list below.

Target context:
{{target_context}}

Resume to critique (structured JSON):
{{resume_json}}

Dismissed bullet IDs (do not flag these again):
{{dismissed_bullet_ids}}

Return ONLY JSON matching this schema. No prose, no markdown fences, no explanations:
{{output_schema}}
```

- [ ] **Step 2: Verify the file**

```bash
test -s src/prompts/templates/critique-scan.md && echo OK
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add src/prompts/templates/critique-scan.md
git commit -m "feat(prompts): add templates/critique-scan.md"
```

---

## Task 9: `templates/rewrite-wordsmith.md`

**Files:**
- Create: `src/prompts/templates/rewrite-wordsmith.md`

Per spec §4 of the thin-slice doc, the body of `rewrite-wordsmith.md`. Slot names: `{{persona}}`, `{{original_bullet}}`, `{{flag_type}}`, `{{flag_reason}}`, `{{user_clarification}}`, `{{output_schema}}`.

- [ ] **Step 1: Create the file**

Create `src/prompts/templates/rewrite-wordsmith.md`:

```markdown
{{persona}}

You are rewriting one bullet to address a specific weakness flagged by the critique pass.

The flag type is one of: vague, passive, length, jargon. These are word-smithing flags — you may rearrange, tighten, expand acronyms, or activate passive voice. You MAY NOT introduce new metrics, scope claims, outcomes, or named entities not already present in the original bullet or in the user's clarification (if any).

Original bullet:
"{{original_bullet}}"

Flag: {{flag_type}}
Why this was flagged: {{flag_reason}}

User's clarification (may be empty):
{{user_clarification}}

Return exactly 2 candidates. Each candidate carries an `evidenceMap` that tags every span as `original` (came from the bullet), `user` (came from the clarification), or `connective` (necessary glue words like "and", "with", "to").

Return ONLY JSON matching this schema. No prose, no markdown fences:
{{output_schema}}
```

- [ ] **Step 2: Verify the file**

```bash
test -s src/prompts/templates/rewrite-wordsmith.md && echo OK
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add src/prompts/templates/rewrite-wordsmith.md
git commit -m "feat(prompts): add templates/rewrite-wordsmith.md"
```

---

## Task 10: Template integrity tests

**Files:**
- Create: `tests/prompts/templates.test.ts`

A smoke test that catches accidental edits to the template files. Each template is read from disk, rendered with synthetic slots, and asserted to contain anchor strings (key hard rules from the spec). If someone deletes "Maximum 8 flags surfaced" from `critique-scan.md`, this test fails.

- [ ] **Step 1: Write the failing test**

Create `tests/prompts/templates.test.ts`:

```ts
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
})
```

- [ ] **Step 2: Run test to verify pass**

```bash
bun test tests/prompts/templates.test.ts
```

Expected: PASS (8 assertions across 8 test cases).

- [ ] **Step 3: Commit**

```bash
git add tests/prompts/templates.test.ts
git commit -m "test(prompts): add integrity tests for critique-scan and rewrite-wordsmith"
```

---

## Task 11: `adapters/types.ts` — `ProviderAdapter` interface + `AdapterError`

**Files:**
- Create: `src/prompts/adapters/types.ts`
- Create: `tests/prompts/adapters/types.test.ts`

The shared interface every provider adapter (Claude in 2b, Codex/Gemini in sub-plan 4) implements. Plus the typed error class.

- [ ] **Step 1: Write failing tests**

Create `tests/prompts/adapters/types.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { AdapterError } from '@/prompts/adapters/types'

describe('AdapterError', () => {
  it('is an Error subclass', () => {
    const e = new AdapterError('fail', 'cli-error')
    expect(e).toBeInstanceOf(Error)
    expect(e.message).toBe('fail')
  })

  it('carries a typed cause', () => {
    const e = new AdapterError('fail', 'schema-failed')
    expect(e.cause).toBe('schema-failed')
  })

  it.each([
    'spawn-failed',
    'cli-error',
    'parse-failed',
    'schema-failed',
    'aborted',
    'auth-failed',
  ] as const)('accepts %s as a valid cause', (cause) => {
    const e = new AdapterError('msg', cause)
    expect(e.cause).toBe(cause)
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
bun test tests/prompts/adapters/types.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement types.ts**

Create `src/prompts/adapters/types.ts`:

```ts
import type { ZodSchema } from 'zod'

/**
 * Tier selects which model the adapter uses for a given call.
 * v2 only uses 'main'. 'verifier' is reserved for sub-plan 3's Tier-2
 * entity verifier (cheap small-model call after a rewrite).
 */
export type ModelTier = 'main' | 'verifier'

/**
 * Opaque per-provider session context. For Claude/Codex this is the
 * provider's session_id string (used with --resume). For Gemini, the
 * orchestrator manages a transcript array — see sub-plan 4.
 *
 * `null` means "no prior session". The adapter returns a fresh handle
 * the caller should pass to the next call to keep CLI-side context.
 */
export type SessionHandle = string | null

export interface ProviderAdapter {
  readonly name: 'claude' | 'codex' | 'gemini'

  /**
   * One-shot call. Streams partial text via `onToken` if provided.
   * Returns the parsed structured result and the (possibly new)
   * session handle.
   */
  callInSession<T>(args: {
    sessionHandle: SessionHandle
    tier: ModelTier
    systemPrompt: string
    userPrompt: string
    schema: ZodSchema<T>
    onToken?: (chunk: string) => void
    signal?: AbortSignal
  }): Promise<{ result: T; sessionHandle: SessionHandle }>
}

export type AdapterErrorCause =
  | 'spawn-failed'   // CLI binary not found / not executable
  | 'cli-error'      // CLI exited non-zero
  | 'parse-failed'   // JSON island couldn't be extracted
  | 'schema-failed'  // Zod parse failed even after one retry
  | 'aborted'        // signal triggered
  | 'auth-failed'    // detected from CLI stderr or missing env

export class AdapterError extends Error {
  readonly cause: AdapterErrorCause

  constructor(message: string, cause: AdapterErrorCause) {
    super(message)
    this.name = 'AdapterError'
    this.cause = cause
  }
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
bun test tests/prompts/adapters/types.test.ts
```

Expected: PASS (8 assertions).

- [ ] **Step 5: Confirm full suite + type-check**

```bash
bun test
bun run type-check
```

- [ ] **Step 6: Commit**

```bash
git add src/prompts/adapters/types.ts tests/prompts/adapters/types.test.ts
git commit -m "feat(prompts): add ProviderAdapter interface and AdapterError"
```

---

## Task 12: `adapters/parse.ts` — `parseOrRetry`

**Files:**
- Create: `src/prompts/adapters/parse.ts`
- Create: `tests/prompts/adapters/parse.test.ts`

The schema-validate-or-retry helper used by every adapter. Strips markdown fences, locates JSON islands, validates against Zod, retries once on schema failure (caller supplies the retry function), throws typed `AdapterError` on second failure.

- [ ] **Step 1: Write failing tests**

Create `tests/prompts/adapters/parse.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { z } from 'zod'
import { parseOrRetry } from '@/prompts/adapters/parse'
import { AdapterError } from '@/prompts/adapters/types'

const Sample = z.object({ ok: z.boolean(), value: z.number() })

describe('parseOrRetry', () => {
  it('parses a clean JSON object on the first try', async () => {
    const retry = async () => { throw new Error('should not be called') }
    const result = await parseOrRetry('{"ok":true,"value":42}', Sample, retry)
    expect(result).toEqual({ ok: true, value: 42 })
  })

  it('strips ```json fences', async () => {
    const raw = '```json\n{"ok":true,"value":1}\n```'
    const retry = async () => { throw new Error('should not be called') }
    const result = await parseOrRetry(raw, Sample, retry)
    expect(result.ok).toBe(true)
  })

  it('strips bare ``` fences', async () => {
    const raw = '```\n{"ok":false,"value":7}\n```'
    const retry = async () => { throw new Error('should not be called') }
    const result = await parseOrRetry(raw, Sample, retry)
    expect(result.value).toBe(7)
  })

  it('extracts a JSON island from surrounding prose', async () => {
    const raw = 'Here is the answer: {"ok":true,"value":99} hope that helps.'
    const retry = async () => { throw new Error('should not be called') }
    const result = await parseOrRetry(raw, Sample, retry)
    expect(result.value).toBe(99)
  })

  it('handles nested braces inside string values', async () => {
    const raw = '{"ok":true,"value":1,"note":"contains } a brace"}'
    const Schema = z.object({ ok: z.boolean(), value: z.number(), note: z.string() })
    const retry = async () => { throw new Error('should not be called') }
    const result = await parseOrRetry(raw, Schema, retry)
    expect(result.note).toBe('contains } a brace')
  })

  it('retries once on schema mismatch and succeeds', async () => {
    let calls = 0
    const retry = async () => {
      calls++
      return '{"ok":true,"value":5}'
    }
    const result = await parseOrRetry('{"ok":"yes","value":"5"}', Sample, retry)
    expect(result).toEqual({ ok: true, value: 5 })
    expect(calls).toBe(1)
  })

  it('throws AdapterError(schema-failed) after one failed retry', async () => {
    let calls = 0
    const retry = async () => {
      calls++
      return '{"ok":"still wrong"}'
    }
    await expect(
      parseOrRetry('{"ok":"wrong"}', Sample, retry),
    ).rejects.toMatchObject({
      name: 'AdapterError',
      cause: 'schema-failed',
    })
    expect(calls).toBe(1)
  })

  it('throws AdapterError(parse-failed) when no JSON can be located', async () => {
    const retry = async () => 'still no JSON here'
    await expect(
      parseOrRetry('not JSON at all', Sample, retry),
    ).rejects.toMatchObject({
      name: 'AdapterError',
      cause: 'parse-failed',
    })
  })

  it('uses retry result and rejects parse-failed if retry also has no JSON', async () => {
    let calls = 0
    const retry = async () => {
      calls++
      return 'still no braces'
    }
    await expect(
      parseOrRetry('also no braces', Sample, retry),
    ).rejects.toBeInstanceOf(AdapterError)
    expect(calls).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
bun test tests/prompts/adapters/parse.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement parse.ts**

Create `src/prompts/adapters/parse.ts`:

```ts
import type { ZodSchema } from 'zod'
import { AdapterError } from './types'

/**
 * Locate the first balanced JSON object in a string. Walks brace depth
 * while ignoring braces inside string literals (handles backslash-escaped
 * quotes). Returns the substring including outer braces, or null if none.
 *
 * Object-only — does not extract top-level arrays. All our adapter
 * outputs are objects, by schema design.
 */
function extractJsonIsland(s: string): string | null {
  const start = s.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escape = false

  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (escape) { escape = false; continue }
    if (inString) {
      if (c === '\\') { escape = true; continue }
      if (c === '"') inString = false
      continue
    }
    if (c === '"') { inString = true; continue }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

/**
 * Try multiple strategies in order. Return the parsed value or null.
 */
function tryExtract(raw: string): unknown | null {
  // Strategy 1: trimmed direct parse
  const trimmed = raw.trim()
  try { return JSON.parse(trimmed) } catch {}

  // Strategy 2: strip a ```json or ``` fenced block
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced && fenced[1]) {
    try { return JSON.parse(fenced[1].trim()) } catch {}
  }

  // Strategy 3: locate first balanced { … } island
  const island = extractJsonIsland(trimmed)
  if (island) {
    try { return JSON.parse(island) } catch {}
  }

  return null
}

/**
 * Extract a JSON object from `raw`, validate it against `schema`. On schema
 * failure, call `retry()` ONCE for a corrective response and re-validate.
 *
 * Throws `AdapterError`:
 * - `parse-failed` if neither `raw` nor the retry response yields parseable JSON.
 * - `schema-failed` if the JSON parses but doesn't satisfy `schema` after one retry.
 *
 * The retry function is provided by the adapter — typically it issues a new
 * model call with a corrective prompt appended.
 */
export async function parseOrRetry<T>(
  raw: string,
  schema: ZodSchema<T>,
  retry: () => Promise<string>,
): Promise<T> {
  const first = tryExtract(raw)
  if (first !== null) {
    const r = schema.safeParse(first)
    if (r.success) return r.data
    // Schema failure → retry once
    const retryRaw = await retry()
    const second = tryExtract(retryRaw)
    if (second === null) {
      throw new AdapterError(
        'retry response did not contain parseable JSON',
        'parse-failed',
      )
    }
    const r2 = schema.safeParse(second)
    if (r2.success) return r2.data
    throw new AdapterError(
      `schema validation failed after retry: ${r2.error.message}`,
      'schema-failed',
    )
  }

  // Initial parse failure → still try retry once
  const retryRaw = await retry()
  const second = tryExtract(retryRaw)
  if (second === null) {
    throw new AdapterError(
      'no parseable JSON in initial response or retry',
      'parse-failed',
    )
  }
  const r = schema.safeParse(second)
  if (r.success) return r.data
  throw new AdapterError(
    `schema validation failed on retry: ${r.error.message}`,
    'schema-failed',
  )
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
bun test tests/prompts/adapters/parse.test.ts
```

Expected: PASS (9 tests).

- [ ] **Step 5: Confirm full suite + type-check**

```bash
bun test
bun run type-check
```

- [ ] **Step 6: Commit**

```bash
git add src/prompts/adapters/parse.ts tests/prompts/adapters/parse.test.ts
git commit -m "feat(prompts): add parseOrRetry helper with JSON-island extraction"
```

---

## Task 13: Phase 2a verification

**Files:** none — verification only.

- [ ] **Step 1: Verify the working tree is clean**

```bash
git status
```

Expected: `nothing to commit, working tree clean`.

- [ ] **Step 2: Run the full test suite**

```bash
bun test
```

Expected: all tests pass. Total count = 81 (foundation) + new tests added across tasks 1-12.

Specifically:
- Task 1 added 1 test (BEGIN_CRITIQUE event)
- Task 2 added 3 tests (states map + 2 reducer transitions)
- Task 3 added 9 tests (render)
- Task 10 added 8 tests (templates integrity)
- Task 11 added 8 tests (AdapterError)
- Task 12 added 9 tests (parseOrRetry)

= 81 + 38 = **119 tests across ~20 files**.

- [ ] **Step 3: Type-check the whole tree**

```bash
bun run type-check
```

Expected: no output.

- [ ] **Step 4: Confirm all expected files exist**

```bash
for f in \
  src/prompts/render.ts \
  src/prompts/rubric/core.md \
  src/prompts/rubric/flags.md \
  src/prompts/personas/archetypes.md \
  src/prompts/personas/tones.md \
  src/prompts/templates/critique-scan.md \
  src/prompts/templates/rewrite-wordsmith.md \
  src/prompts/adapters/types.ts \
  src/prompts/adapters/parse.ts \
  ; do
  test -s "$f" && echo "OK: $f" || echo "MISSING: $f"
done
```

Expected: all 9 files print `OK: …`.

- [ ] **Step 5: Show all phase 2a commits for the merge to main**

```bash
git log --oneline main..HEAD
```

Expected: one commit per task (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12) — 12 commits.

---

## Self-review

Reviewed against the spec sections relevant to phase 2a (§3, §4, §5, §10 cross-cutting).

**Spec coverage:**
- ✅ `src/prompts/render.ts` (§3.3)
- ✅ rubric files (§3.1 — `rubric/core.md`, `rubric/flags.md` — placeholder content acknowledged in §10 entry 1 of architecture-notes seed)
- ✅ personas files (§3.1 — `archetypes.md`, `tones.md`)
- ✅ templates (`critique-scan.md` per §3.1, `rewrite-wordsmith.md` per §3.1)
- ✅ adapter `types.ts` (§5.1) and `parse.ts` (§5.4)
- ✅ `BEGIN_CRITIQUE` event added to schema and reducer (§3.2)

**Out of scope for 2a (correctly deferred):**
- `claude.ts` adapter implementation → 2b
- `personaPrompt.ts` orchestrator helper → 2c
- `Session` class, `budget.ts`, `verifier/numbers.ts` → 2c
- `architecture-notes.md` seeding → 2h (after enough decisions are concrete)
- HTTP routes → 2d
- Frontend → 2e/2f/2g
- ATS validation, integration test → 2h

**Type consistency check:**
- `ProviderAdapter` interface (`callInSession<T>`) signature matches across types.ts (Task 11) and the spec.
- `AdapterError` cause union matches across types.ts and parse.ts (`'parse-failed'`, `'schema-failed'`).
- `BEGIN_CRITIQUE` event literal consistent across schema (Task 1), reducer (Task 2), and tests.

**Placeholder scan:** none. Every step contains real content.

---

## Sequencing notes for phase 2b

Phase 2b implements `src/prompts/adapters/claude.ts`. It builds on:

- The `ProviderAdapter` interface from `types.ts` (Task 11).
- `parseOrRetry` from `parse.ts` (Task 12).
- The rendered persona prompt — but `personaPrompt.ts` lands in 2c, so 2b's tests will pass synthetic system prompts directly.

Phase 2b will need to add `zod-to-json-schema` as a dependency (used to convert Zod schemas for the `--json-schema` flag).

Phase 2b's first task: scaffold the spawn-and-stream infrastructure with mocked `Bun.spawn`, then add an opt-in real-CLI integration test gated by an env var (skip if `CLAUDE_BIN` not present or `ANTHROPIC_API_KEY` missing).
