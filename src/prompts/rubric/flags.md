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
