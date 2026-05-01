# Interrogator Prompt Design

- **Date:** 2026-05-01
- **Status:** Approved (pending user review of this written spec)
- **Scope:** The "Skeptical Interviewer" persona — the prompt strategy that drives gather, critique, and rewrite phases of the AI-powered resume builder. This is the core IP of the product.
- **Stack assumed:** TypeScript on Bun, SQLite, Vite + React 19 frontend (per the stack revision in `PRD.md`).
- **Out of scope:** the Resume JSON schema and the state machine (designed in the same brainstorming session, summarized in §A and §B for context but specified separately).

---

## 1. Context

The product's differentiator is shifting AI from "helpful assistant" to **skeptical interviewer**. Every prompt below exists to make that shift real: detect vague language, demand evidence for claims, never invent metrics, and give the user agency to override interrogator opinion.

This spec defines:

1. The shape of the persona system prompt.
2. The flag taxonomy (what the interrogator looks for).
3. Severity-based calibration (how much pressure is applied).
4. Per-template prompt designs for gather, critique, rewrite, and final-review phases.
5. Anti-hallucination guards (tiered verifier).
6. JD-grounded web overlay.
7. Provider adapters (Claude / Codex / Gemini), with capability differences.
8. Cost / quota guardrails.
9. How prompts plug into the state machine.

---

## 2. Decisions log

Five foundational decisions made during brainstorming. Each shapes multiple downstream sections.

### D1 — Grounding source: thin baseline rubric + per-session JD web overlay

**Choice:** Hand-curated rubric (the baseline) is always loaded. When the user provides a JD, an additional one-shot web search distills 1–3 role-specific standards that augment the rubric for that session only.

**Rejected:** RAG over a curated corpus (overkill for v1; quality-of-source problem); web grounding for every session regardless of JD (slow, expensive, low ROI).

### D2 — Cross-provider portability: thin per-provider adapters

**Choice:** A `ProviderAdapter` interface with `claude.ts`, `gemini.ts`, `openai.ts` implementations. Each plays to its provider's strengths (native schema enforcement on Claude/Codex, file-based system prompt on Gemini, etc.). User picks provider per session via UI dropdown; environment variables hold defaults.

**Rejected:** lowest-common-denominator single prompt (loses Claude's `--json-schema` and Codex's `--output-schema`); Claude-first with degraded fallback (rules out Gemini-subscription users by design).

### D3 — Strictness calibration: severity gate + hard cap, persona tone shapes language only

**Choice:**
- Each flag has severity 1–3.
- Default surfaces severity 2+; severity 1 hidden behind a "deeper review" toggle.
- Hard cap of 8 flags surfaced per critique pass.
- Persona tone (`skeptical | curious | adversarial | coaching`) influences question *language*, not flag thresholds.

**Rejected:** open-ended flagging (overwhelms users); tone-as-strictness-knob (couples concerns badly).

### D4 — Rewrite policy: propose 2 candidates with tiered safety

**Choice:**
- For low-risk flags (`vague`, `passive`, `jargon`, `length`): AI proposes 2 candidates immediately, restricted to rearranging existing words.
- For evidence flags (`unverified`, `no-impact`, `inflated`): AI must ask the user a question first, then rewrite using only the user's answer + the original bullet.
- Verifier is tiered: deterministic regex for numbers/percentages/currency (Tier 1), cheap-model LLM call for named entities (Tier 2).

**Rejected:** question-only mode (kills the magic); free rewrites without verifier (catastrophic on invented metrics).

### D5 — Gather phase: 1 broad question + max 2 targeted follow-ups per role

**Choice:** Adaptive funnel. One open question per role, then up to 2 follow-ups *only* if the user's answer is thin (missing scope, outcome, time, or context). Force-stop after 2 follow-ups; unanswered thin spots become flags for critique to pick up later. Cap is configurable.

**Rejected:** STAR-scaffolded forms (formulaic, redundant with critique); skip-gather-entirely (loses bullets the user forgot to list).

### D6 — Cross-cutting UX guardrail: never hard-block (added during section review)

The interrogator's opinion never wins over the user's agency. Severity-3 flags surface prominently with a one-click "I stand by this" confirmation, but the user always has the final say. Dismissed flags are recorded but not re-surfaced in subsequent passes.

---

## 3. Architecture

### 3.1 Approach chosen: templates with named slots

~6 markdown templates (one per state-machine phase that calls a model), each with `{{slot}}` substitution. Templates live as files (versioned, diffable, copy-pasteable into a model playground for hand-tuning). Slots filled by the orchestrator at call time.

Rejected alternatives:

- **Monolithic per-phase prompts:** simple, but hard to A/B test parts independently.
- **Composable fragment library:** most flexible, premature for v1.

### 3.2 Repository layout

```
src/prompts/
├── rubric/
│   ├── core.md                 # baseline rubric (D1)
│   └── flags.md                # flag taxonomy + severity definitions
├── personas/
│   ├── archetypes.md           # 7 named role archetypes (no adjectives)
│   └── tones.md                # 4 tones reshaping question language
├── templates/
│   ├── persona-propose.md      # propose archetype from resume + target
│   ├── gather-broad.md         # one open question per role
│   ├── gather-followup.md      # targeted funnel follow-up
│   ├── critique-scan.md        # flag bullets + assign severity
│   ├── rewrite-wordsmith.md    # safe rewrites (vague/passive/jargon/length)
│   ├── rewrite-evidenced.md    # rewrites grounded in user's answer
│   └── final-review.md         # holistic pass over the whole resume
├── adapters/
│   ├── types.ts                # ProviderAdapter interface
│   ├── claude.ts
│   ├── gemini.ts
│   ├── openai.ts
│   └── parse.ts                # shared schema-validate-or-retry helper
├── grounding/
│   └── jd-overlay.ts           # web search → 1–3 distilled standards
└── render.ts                   # template + slots → string

src/config/
└── critique.ts                 # tunable constants (caps, budgets)
```

### 3.3 Prompt-rendering pipeline

```ts
// src/prompts/render.ts
export async function renderTemplate(
  templateName: TemplateName,
  slots: Record<string, unknown>,
): Promise<string> {
  const raw = await readTemplateFile(templateName)
  return mustacheLite(raw, slots)  // {{x}} + {{#if x}}…{{/if}}
}
```

No templating engine — `{{slot}}` substitution and `{{#if x}}…{{/if}}` blocks cover all needs. Templates remain readable as plain markdown in any editor.

---

## 4. Persona system prompt

Composed once per session and reused for every model call until that session ends. Lives in the `system` slot of every template.

### 4.1 Structure

```
You are interviewing a candidate about their resume in the role of a {{archetype}}.

Your job is not to be helpful or polite. Your job is to surface weak claims so the
candidate can either back them up or remove them. A bullet point that cannot be
defended in 30 seconds in a real interview should not be on the resume.

Standards you apply:
{{rubric.core}}

{{#if jdOverlay}}
Standards specific to this role, derived from the job description:
{{jdOverlay}}
{{/if}}

How you speak:
{{tones[selectedTone]}}

Hard rules:
- Never invent metrics, percentages, dollar figures, team sizes, or outcomes.
- If a claim cannot be supported by what the candidate has told you or what is
  written in the resume, you must ask, not assume.
- Stay in role. Do not break character to give meta-commentary about resumes,
  the process, or yourself.
- When asked for structured output, return ONLY the requested JSON. No prose.
```

### 4.2 Archetypes (`personas/archetypes.md`)

Seven role names, no adjectives. Each gets ~3 sentences describing what *that role* tends to focus on.

1. **Engineering Manager** — probes scope, tradeoffs, team dynamics, whether decisions are owned or rubber-stamped.
2. **Director of Engineering** — probes cross-team coordination, headcount/budget, organizational outcomes.
3. **Tech Recruiter** — probes credentials, brand-name signals, tenure patterns, skills-keywords match.
4. **VP Product** — probes outcome over output, customer impact, prioritization decisions.
5. **Founder** — probes scrappiness, ownership beyond title, range across functions.
6. **Staff/Principal IC** — probes technical depth, influence-without-authority, hard problems solved.
7. **Department Head (non-tech)** — probes business outcomes, stakeholder management, P&L exposure.

### 4.3 Tones (`personas/tones.md`)

Four tones, each ~2 sentences defining language register. The flag/severity is fixed; only language flexes.

- **Skeptical** (default) — professional, direct, doesn't flatter.
- **Curious** — lots of "why" and "how"; treats vagueness as a research opportunity.
- **Adversarial** — presses hard, doesn't accept first answers; uses "really?" and "but" frequently.
- **Coaching** — softens critique with suggestions; pairs every flag with a "have you tried…" alternative.

### 4.4 Rationale

Splitting archetype from tone enables combinations like "Engineering Manager + coaching" for a friendly first pass and "Engineering Manager + adversarial" for a hardening pass — same domain knowledge, different pressure.

---

## 5. Flag taxonomy + severity

Lives in `rubric/flags.md`. Injected into the `{{rubric.flags}}` slot of `critique-scan.md`.

| Flag | Severity | What it catches | Default question |
|---|---|---|---|
| `unverified` | 3 | A specific number, percentage, $ amount, headcount, or named outcome with no evidence in the conversation. | "Where does the [X] number come from? Can you confirm it?" |
| `no-impact` | 3 | Bullet describes activity (verbs of doing) with no outcome (verbs of effect). | "What changed because of this? Time saved? Reliability? Adoption?" |
| `inflated` | 3 | Scale claim that doesn't match seniority/role context. | "How many people reported to you, directly and indirectly, when you did this?" |
| `vague` | 2 | Resume-ghosting words (*collaborated, leveraged, results-driven, passionate, spearheaded, drove*) with no specifics attached. | "What did [vague verb] actually look like — what were you doing day to day?" |
| `passive` | 2 | "Was responsible for", "tasked with", "involved in". | "What did *you* do here, specifically? Were you the one who decided/built/led?" |
| `length` | 2 | Bullet over ~25 words; usually run-on or carrying multiple claims. | "This bullet is doing two jobs — want to split it, or trim?" |
| `jargon` | 1 | Acronym or internal-only term unlikely to be understood by an outside reader. | "Will an outside [archetype] know what [term] means? Want to expand it?" |
| `stale` | 1 | Bullet older than 5 years, longer than ~10 words, not load-bearing for the target role. | "This is from a while back — is it still differentiating, or can we trim it?" |

The default question phrasing is rewritten by the active **tone** at generation time; `coaching` softens, `adversarial` sharpens.

**Deferred to v2:**

- `redundant` (cross-bullet check; sometimes redundancy shows continuity, so it's not always a flag).

**Severity rules:**

- All severities surface with full visibility in their tier; nothing is hidden by default within sev 2–3.
- Severity-1 flags are hidden behind a user-toggled "deeper review" option.
- Severity-3 flags surface prominently but the user can always dismiss with a confirmation modal (per D6).

---

## 6. Gather-phase prompts

### 6.1 `gather-broad.md`

**Slots:** `{{persona}}`, `{{role}}` (company, title, dates), `{{existingBullets}}`, `{{targetContext}}`.

**Output contract:**

```ts
type GatherBroadOutput = { question: string }
```

**Behavior baked into the template:**

- Ask one open question, ≤2 sentences, anchored to something specific from the role (company, title, dates) — not generic "tell me about your work."
- If the role already has bullets, probe what's missing (stories behind bullets, projects not on resume, fights picked, things that flopped).
- If the role has no bullets (blank-canvas case), invite a chronological dump.
- Hard cap: 2 sentences. No multi-part questions.

### 6.2 `gather-followup.md`

**Slots:** `{{persona}}`, `{{role}}`, `{{userAnswerSoFar}}`, `{{followUpsAlreadyAsked}}`, `{{thinTriggers}}`.

**Output contract:**

```ts
type GatherFollowupOutput =
  | { done: true; reason: string }
  | { done: false; followUp: string; trigger: 'scope' | 'outcome' | 'time' | 'context' }
```

**Thin triggers (encoded in the rubric the template injects):**

- Leadership/ownership claim without scope (no team size, no budget, no timeline).
- Project mentioned by name with no outcome.
- Vague time qualifier ("for a while", "eventually").
- Skill mentioned without context of use ("worked with Kafka").

**Hard limits:**

- Max **2** follow-ups per role (configurable via `MAX_FOLLOWUPS_PER_ROLE`).
- After cap, force-stop and move on. Unanswered thin spots become flags for critique-scan to pick up.

### 6.3 What gather does NOT do

Gather never writes or rewrites bullets. Its only output is captured user text, attached to the role with `sourceTurnIds`. Critique is what turns that text into structured bullets. Keeping the phases pure simplifies prompts and the state machine.

---

## 7. Critique-phase prompts

### 7.1 `critique-scan.md`

**Slots:** `{{persona}}`, `{{rubric.flags}}`, `{{targetContext}}`, `{{resumeJson}}`, `{{dismissedFlagIds}}`.

**Output contract:**

```ts
type CritiqueScanOutput = {
  flags: Array<{
    bulletId: string
    flag: 'unverified' | 'no-impact' | 'vague' | 'passive' | 'jargon' | 'inflated' | 'stale' | 'length'
    severity: 1 | 2 | 3
    span: string             // exact substring of the bullet that triggered the flag
    why: string              // one sentence, recruiter voice, ≤25 words
    suggestedQuestion: string // toned per persona
  }>
  passSummary: {
    bulletsScanned: number
    bulletsFlagged: number
    topConcern: string
  }
}
```

**Hard rules in the template:**

- Cap of 8 flags surfaced (`MAX_FLAGS_PER_PASS`). If more qualify, return only the 8 highest-severity, breaking ties by impact on hireability for the target role.
- One flag per bullet maximum per pass. Bullets needing multiple critiques surface them across rounds.
- `span` must be an exact substring of the bullet text (verifier rejects if not).
- `why` is in recruiter voice ("a hiring manager will ask…"), not LLM voice ("this could be improved by…").
- `dismissedFlagIds` list is honored — those bullet/flag pairs are skipped.

### 7.2 `rewrite-wordsmith.md` (low-risk flags)

**Used for:** `vague`, `passive`, `jargon`, `length`.

**Slots:** `{{persona}}`, `{{originalBullet}}`, `{{flag}}`, `{{userClarification}}` (optional).

**Constraints:**

- Output 2 candidates (`MAX_REWRITE_CANDIDATES = 2`).
- May rearrange, tighten, expand acronyms, or activate passive voice.
- May NOT introduce new metrics, scope claims, outcomes, or named entities not already present.
- Each candidate carries an `evidenceMap` for the verifier and the UI.

**Output contract:**

```ts
type RewriteOutput = {
  candidates: Array<{
    text: string
    evidenceMap: Array<{
      span: string
      source: 'original' | 'user' | 'connective'
    }>
  }>
}
```

### 7.3 `rewrite-evidenced.md` (evidence flags)

**Used for:** `unverified`, `no-impact`, `inflated`.

Stricter rule: every numeric, named outcome, and scope claim must appear verbatim or as a direct paraphrase in `userClarification`. Same output contract as `rewrite-wordsmith.md`.

**Verifier flow:**

- **Always runs after `rewrite-evidenced`** — both Tier 1 (numbers) and Tier 2 (entities).
- **After `rewrite-wordsmith`** — only Tier 1 (numbers) runs. Tier 2 is skipped because the wordsmith template forbids new entities by rule, so an LLM entity check is wasted compute.

```
Tier 1 — deterministic, always runs:
  Extract numbers, currency, percentages from candidate via regex.
  Compare against {original ∪ userClarification} set.
  If any number in candidate is not in source → reject.

Tier 2 — cheap-LLM verifier, runs only if Tier 1 passes:
  Single small-model call:
    "Source: <X>. Rewrite: <Y>. List every named company, product,
     technology, person, or specific outcome in the rewrite. For each,
     mark whether it is supported by the source.
     Output JSON: { entities: [{ name, supported: bool }] }"
  Uses cheapest tier of the active provider, configured per provider in .env.
  If any unsupported entity → reject, regenerate once with corrective hint,
  then fall back to user-writes-it-themselves seeded with the original.
```

**Tiered design rationale:** invented numbers are catastrophic in interviews; invented entity names are rare and usually obvious to candidates on review. Spending compute on the higher-stakes class is the correct asymmetry.

### 7.4 `stale` flag

No rewrite. Only action: "trim or keep" — a one-click decision, no model call.

### 7.5 `final-review.md`

**Slots:** `{{persona}}`, `{{resumeJson}}` (post-critique), `{{dismissedFlagsSummary}}`, `{{targetContext}}`.

**Output contract:**

```ts
type FinalReviewOutput = {
  topLineImpressions: string[]    // 3–5 short observations
  remainingConcerns: Array<{
    bulletId: string
    concern: string
    severity: 1 | 2 | 3
  }>
  readyToShip: boolean
  rationale: string
}
```

This is the "one final pass" from the PRD. The user can choose to act on `remainingConcerns` (returning to critique for one more round) or proceed to `generate`.

---

## 8. JD-grounded web overlay

Implementation in `grounding/jd-overlay.ts`. Triggered only when the user provides a JD.

### 8.1 Flow

```
1. Local extraction (no model call):
     - Company name (regex against common JD headers)
     - Role title (the bolded line / first H1)
     - 3–5 concrete requirements (bullet points starting with action verbs)

2. Single web search via active provider's tool:
     - Claude: built-in web_search tool
     - Codex: enabled via sandbox + provider tool
     - Gemini: google_search grounding (default-on in headless)
   Query: "{company} {role title} interview rubric what hiring managers look for"

3. Single distillation call:
     Input: search results + extracted JD requirements
     Prompt: "From these sources, extract up to 3 standards a hiring manager
              at {company} for {role} would apply that are NOT general resume
              advice. Each standard must cite which source supports it. If you
              cannot find 3 specific things, return fewer or none. Never invent."

4. Cache for the session in SQLite. Never auto-refresh.
```

### 8.2 Output schema

```ts
type JdOverlay = {
  company: string | null
  role: string
  standards: Array<{
    text: string                    // ≤30 words, plain language
    sourceUrl: string               // shown in UI as "why are we checking this?"
    confidence: 'high' | 'medium'
  }>
  generatedAt: string
}
```

### 8.3 Behavior

- Injected into `{{jdOverlay}}` slot in persona and critique-scan prompts.
- Each standard appears in the session sidebar with source link and a checkbox to disable.
- Only `confidence: 'high'` standards influence severity scoring; `medium` are advisory.
- If web grounding fails (no internet, no useful results, distillation returns zero), the session falls back silently to baseline rubric. UI shows "Grounding: baseline only" badge.
- Mid-session JD edits do not auto-regenerate the overlay; user clicks a "re-derive standards" button.

### 8.4 Hard rule in distillation prompt

> Generic resume advice (e.g., "use action verbs", "quantify results") MUST NOT appear in the output. The baseline rubric already covers those. Only return things specific to this company, this role family, or this seniority level.

---

## 9. Provider adapters

### 9.1 Shared interface

```ts
// src/prompts/adapters/types.ts
export type ModelTier = 'main' | 'verifier'

export interface ProviderAdapter {
  name: 'claude' | 'gemini' | 'openai'

  callInSession<T>(args: {
    sessionHandle: SessionHandle | null   // opaque; provider-specific
    tier: ModelTier
    systemPrompt: string
    userPrompt: string
    schema: ZodSchema<T>
    onToken?: (chunk: string) => void
  }): Promise<{ result: T; sessionHandle: SessionHandle }>

  search(query: string): Promise<Array<{ title: string; url: string; snippet: string }>>
}
```

`SessionHandle` is opaque: a `session_id` string for Claude/Codex (native resume), an internal transcript array for Gemini (orchestrator-managed).

### 9.2 Capability matrix

| Capability | Claude | Codex (OpenAI) | Gemini |
|---|---|---|---|
| Headless command | `claude -p --bare` | `codex exec -` | `gemini -p` |
| System prompt | `--system-prompt` (replace) / `--append-system-prompt` | embedded in stdin with markers | `GEMINI_SYSTEM_MD` env or `.gemini/system.md` file |
| Structured output | `--output-format json --json-schema '<inline>'` | `--output-schema <file>` | `--output-format json` (no schema enforcement) |
| Streaming | `--output-format stream-json --verbose --include-partial-messages` | `--json` (JSONL on stdout) | not richly documented; buffer fallback |
| Session resume | `--resume <session_id>` ✅ | `codex exec resume <id>` ✅ | orchestrator-managed transcript ❌ |
| Web search | built-in tool, allow via `--allowedTools` | tool via sandbox | `google_search` default-on |
| Auth in headless | `ANTHROPIC_API_KEY` (bare mode) or OAuth (non-bare) | `CODEX_API_KEY` or login | `GEMINI_API_KEY` or `GOOGLE_APPLICATION_CREDENTIALS` |

### 9.3 Bare mode tradeoff (Claude)

`--bare` skips auto-discovery of hooks, skills, MCP servers, CLAUDE.md, and `~/.claude` config — the recommended mode for scripted/SDK use. **But** bare mode requires `ANTHROPIC_API_KEY` (skips OAuth/keychain).

**Default:** `--bare` with `ANTHROPIC_API_KEY` for clean, deterministic behavior.

**Override:** `CLAUDE_BARE_MODE=false` env flag for users who prefer their subscription auth and accept the local-config risk.

### 9.4 Provider-lock-per-session

- `sessions` table gains `provider TEXT NOT NULL` and `provider_locked_at INTEGER`.
- Set on the first model call; immutable thereafter for that session.
- UI: provider dropdown editable on the persona/target screen; once gather starts, becomes a read-only badge ("Powered by Claude — locked for this session") with a "Start a new session to switch" link.
- Documentation (README + onboarding tooltip): *"Pick a provider before you start. Switching providers mid-session would mean losing the conversational context that lives inside that provider's CLI session — so we lock it in."*

### 9.5 Configurable binaries

```
CLAUDE_BIN=claude       # default
GEMINI_BIN=gemini       # default
OPENAI_BIN=codex        # default
```

For users with wrappers or non-default install names.

### 9.6 Adapter health check

On app startup, the orchestrator probes each configured CLI (`<bin> --version`) and records availability. The provider dropdown disables unavailable options with a tooltip ("install the Gemini CLI to enable").

### 9.7 Verifier model env vars

```
ANTHROPIC_MAIN_MODEL=claude-opus-4-7
ANTHROPIC_VERIFIER_MODEL=claude-haiku-4-5-20251001
GEMINI_MAIN_MODEL=gemini-2.5-pro
GEMINI_VERIFIER_MODEL=gemini-flash-latest
OPENAI_MAIN_MODEL=gpt-5
OPENAI_VERIFIER_MODEL=gpt-4.1-nano
```

Documented in `.env.example` with rationale.

### 9.8 Shared parser/retry helper

```ts
// src/prompts/adapters/parse.ts
async function parseOrRetry<T>(
  raw: string,
  schema: ZodSchema<T>,
  retry: () => Promise<string>,
): Promise<T> {
  // 1. Strip markdown fences, leading/trailing prose
  // 2. Locate first `{` and matching `}` — extract JSON island
  // 3. Zod parse
  // 4. On failure: call retry() ONCE with a corrective system message
  //    appended ("Your last response did not match the schema. Field X
  //    failed because Y. Return only valid JSON.")
  // 5. On second failure: throw a typed AdapterError
}
```

---

## 10. Calibration + UX guardrails

### 10.1 Tunable constants

All exported from `src/config/critique.ts` for single-file mode-toggle changes.

| Constant | Default | Purpose |
|---|---|---|
| `MAX_FLAGS_PER_PASS` | 8 | Cap per critique-scan pass |
| `MAX_FOLLOWUPS_PER_ROLE` | 2 | Cap on gather follow-ups per role |
| `DEFAULT_SEVERITY_FLOOR` | 2 | Hide severity-1 unless deeper-review toggled |
| `MAX_REWRITE_RETRIES` | 1 | Verifier-rejected rewrites get one regen |
| `MAX_REWRITE_CANDIDATES` | 2 | Number of alternatives per rewrite |
| `JD_OVERLAY_MAX_STANDARDS` | 3 | Cap on web-derived standards |

### 10.2 Severity-3 dismissal flow

```
Bullet has severity-3 flag
  → UI shows: bullet text, flag chip with explanation, "answer" textbox
  → User options:
      [Answer & rewrite]   → triggers rewrite-evidenced
      [I stand by this]    → confirmation modal:
                              "This bullet has been flagged as <flag>.
                               <why>. Are you sure?"
                              [Yes, keep as-is]  [Cancel]
                            → on confirm:
                                bullet.flags[i].dismissed = true
                                bullet.flags[i].dismissedAt = now
      [Skip for now]       → flag remains visible in final review
```

Dismissed flags never re-surface in subsequent critique-scan passes. They DO appear once more in `final-review.md` as a one-line summary.

### 10.3 Session budget

```ts
type SessionBudget = {
  maxModelCallsPerSession: 60      // default; configurable in .env
  warnAtPercent: 75                // soft banner
  hardStopAtPercent: 100           // would normally block...
  allowExtraUsage: boolean         // ...unless this is true
}
```

**Behavior:**

- Default `allowExtraUsage = false`. At 100% the orchestrator pauses before the next model call and shows a modal: *"You've used the recommended quota for this session. Reviews can sometimes need a bit more — want to keep going? You'll see live usage from this point on."*
- User confirms → `session.allowExtraUsage = true` (persisted) → modal dismisses, the corner progress bar transforms into a **live usage panel** showing model calls made, estimated tokens (provider-reported when available), and a one-click "Stop here" button.
- Off by default because most sessions won't hit the cap; surfaced exactly when it matters; once on, the user gets full visibility instead of opaque consumption.

### 10.4 "I'm done" escape hatch

A persistent button visible from the moment gather starts. Label adapts to state: "Skip the rest" during gather, "Stop critique" during the critique loop, "Generate now" during final review. Clicking emits `END_INTERROGATION` to the state machine.

### 10.5 Worst-case session math

```
1 (persona-propose)
+ 4 (gather-broad × 4 roles avg)
+ 8 (gather-followup, ≤2 per role × 4)
+ 2 critique rounds × (1 scan + 8 flags × 2 calls/flag) = 34
+ 2 (JD overlay: search + distill)
+ 1 (final review)
+ 5 (ad-hoc edits)
≈ 55 calls
```

Comfortably under the 60-call default. A 6-role resume with heavy critique and overage enabled might hit 80–100; that's why `allowExtraUsage` exists.

---

## 11. State-machine integration

| State | Templates used | Provider calls |
|---|---|---|
| `ingest.review` | none (deterministic PDF→JSON via `unpdf`) | 0 |
| `target` | `grounding/jd-overlay.ts` (only if JD provided) | 1 search + 1 distill |
| `persona.propose` | `persona-propose.md` | 1 |
| `gather.broad` (per role) | `gather-broad.md` | 1 |
| `gather.followup` (per role, ≤2) | `gather-followup.md` | up to 2 |
| `critique.scan` (per round) | `critique-scan.md` | 1 |
| `critique.interrogate` (per flag) | `rewrite-wordsmith.md` OR `rewrite-evidenced.md` + verifier | 1–3 |
| `finalReview` | `final-review.md` | 1 |
| `generate` | none (deterministic React templates from JSON) | 0 |
| `edit` (AI-mediated edit) | `rewrite-evidenced.md` (reused) | 1–2 |

---

## 12. Telemetry

Local-only (this is a local-first app). Every model call logs to a `model_calls` SQLite table:

```sql
CREATE TABLE model_calls (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL,
  template_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  tier TEXT NOT NULL,                  -- 'main' | 'verifier'
  tokens_in_estimate INTEGER,
  tokens_out_estimate INTEGER,
  latency_ms INTEGER,
  validation_failures INTEGER DEFAULT 0,
  verifier_rejections INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
)
```

This is the dataset for tuning prompts later — which templates fail validation most, which flags get dismissed most. Never leaves the machine.

---

## 13. Open items / future work

1. **Gemini structured-output enforcement.** The CLI's `--output-format json` doesn't accept a schema. v1 relies on the tolerant parser + Zod + one retry. If retry-rate is high in telemetry, revisit (e.g., switch to direct API calls for Gemini sessions).
2. **`redundant` flag.** Deferred to v2; needs whole-resume context. Consider when adding cross-bullet analysis.
3. **Deeper-review toggle UI.** Severity-1 surfacing is in scope but UI affordance specifics (sidebar checkbox? modal? per-pass setting?) defer to frontend design.
4. **Multi-resume comparison.** Out of scope for v1. If added, the persona prompt would need a "compare candidate against alternative" branch.
5. **Tone-blending.** Currently exclusive (one tone per session). Future: per-flag tone selection (coaching for `jargon`, adversarial for `unverified`).

---

## A. Resume JSON schema (reference)

Designed in the same brainstorming session; specified separately. Summary:

- `Resume` — top-level (`contact`, `summary`, `roles[]`, `education[]`, `projects[]`, `skills`, `certifications[]`).
- `Bullet` — carries `id`, `text`, `metrics[]`, `skills[]`, `impactScore?`, `flags[]`, `sourceTurnIds[]`, `status`.
- `ImpactMetric` — `value`, `unit`, `baseline?`, `verified` (anti-hallucination guard).
- `TargetContext` — `jobDescription?`, `targetRole`, `targetSeniority`, `industry?`, `persona { archetype, tone, overridePrompt? }`.

Full schema in `src/schema/resume.ts`.

## B. State machine (reference)

```
ingest → target → persona → gather → critique ↻ → finalReview → generate → edit → export
```

- Per-bullet sub-loop in critique with ≤2 re-asks (auto-skip after).
- `END_INTERROGATION` event always wins.
- Each transition writes to `history` table; replay is just rehydrating the reducer.

Full event vocabulary in §B of the brainstorming notes; will be specified in the implementation plan.

---

## 14. Approvals

- **2026-05-01:** All 9 design sections approved by user (vivek). Spec written to this file.
