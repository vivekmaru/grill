Thirteen flag types may apply to any bullet. Each has a severity from 1 to 3 — higher is more serious. The first eight are evidence flags (the bullet's claims need grounding); the last five are wording flags (sentence-craft issues that don't need new facts).

**Evidence flags** — claim quality, not sentence quality.

| Flag | Severity | What to look for | Default question |
|---|---|---|---|
| `unverified` | 3 | A specific number, percentage, dollar amount, headcount, or named outcome with no supporting evidence in the conversation. | "Where does the [X] number come from? Can you confirm it?" |
| `no-impact` | 3 | The bullet describes activity (verbs of doing) with no outcome (verbs of effect). Example: "Built a CI pipeline." | "What changed because of this? Time saved? Reliability? Adoption?" |
| `inflated` | 3 | A scale claim that doesn't match seniority or role context. Example: a 2-year IC claiming "led a 50-person org". | "How many people reported to you, directly and indirectly, when you did this?" |
| `metric-risk` | 3 | A metric that, if asked about in the interview, would expose a fragile claim — e.g., a percentage with no denominator, "millions" used loosely, or a deceptively framed delta. | "Walk me through the math behind [metric] — what was the baseline?" |
| `seniority-mismatch` | 2 | The verbs and ownership claimed don't match the title/tenure: a senior IC writing only "supported" verbs, or a staff hire describing only execution work. | "At your level, what was the call you made here that someone more junior couldn't have made?" |
| `jd-mismatch` | 2 | A bullet that doesn't pull weight for the target role's evaluation criteria — even if true. Surface only when JD context is available. | "How would you frame this for a hiring manager who cares mostly about [JD signal]?" |
| `specificity` | 2 | Activity is named but the *what* is generic — "various initiatives", "key projects", "multiple teams" — when one or two named anchors would land harder. | "Which initiative are you proudest of from this list? Lead with that one." |
| `stale` | 1 | A bullet older than 5 years that's longer than ~10 words and not load-bearing for the target role. | "This is from a while back — is it still differentiating, or can we trim it?" |

**Wording flags** — sentence craft, no new evidence required.

| Flag | Severity | What to look for | Default question |
|---|---|---|---|
| `vague` | 2 | Resume-ghosting words: *collaborated, leveraged, results-driven, passionate, spearheaded, drove* with no specifics attached. | "What did [vague verb] actually look like — what were you doing day to day?" |
| `passive` | 2 | "Was responsible for", "tasked with", "involved in". Removes agency, hides the actual contribution. | "What did *you* do here, specifically? Were you the one who decided/built/led?" |
| `wording-weakness` | 2 | Awkward phrasing, mixed tense, weak openers ("Helped to..."), or doubled-up verbs ("led and managed"). The claim is fine; the sentence is not. | "Can we tighten this so the strongest verb does the work?" |
| `length` | 2 | Bullet is over ~25 words; usually a run-on or carrying multiple claims that should be split. | "This bullet is doing two jobs — want to split it, or trim?" |
| `jargon` | 1 | An acronym or internal-only term unlikely to be understood by an outside reader. | "Will an outside reader know what [term] means? Want to expand it?" |

Severity guidance:
- **Severity 3** flags are the highest priority. Surface them first.
- **Severity 2** flags are surfaced by default once severity-3 flags are exhausted.
- **Severity 1** flags are hidden behind a "deeper review" toggle.

Cap each critique pass at 8 flags total. If more than 8 qualify, surface the highest-severity 8 (break ties by impact on hireability for the target role).

**Choosing between similar flags.** When a bullet looks like both `vague` and `specificity`, prefer `specificity` if the candidate could clearly name the missing anchor and prefer `vague` if the verb itself is the problem. When a bullet looks like both `unverified` and `metric-risk`, use `unverified` for "this number isn't grounded yet" and `metric-risk` for "this number is grounded but the framing is fragile under scrutiny".
