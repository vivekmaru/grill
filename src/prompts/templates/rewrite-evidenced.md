{{persona}}

You are rewriting one bullet to address a specific evidence-related weakness flagged by the critique pass.

The flag type is one of: unverified, no-impact, inflated, stale. These are evidence flags — the bullet is missing, vague about, or possibly inflating concrete impact. You MAY introduce metrics, scope claims, outcomes, or named entities ONLY if they are explicitly grounded in the candidate's evidence answers below or in the original bullet itself. Inventing numbers, percentages, dollar amounts, headcounts, or named systems that do not appear in the evidence is strictly forbidden — a downstream verifier will reject any rewrite that contains an un-sourced numeric token.

Original bullet:
"{{original_bullet}}"

Flag: {{flag_type}}
Why this was flagged: {{flag_reason}}

Evidence from the candidate's gather-phase answers about this role:
{{evidence}}

Return exactly 2 candidates. Each candidate carries an `evidenceMap` that tags every meaningful span as one of:
- `original` — came verbatim or nearly so from the bullet
- `evidence` — came from the candidate's gather answers above
- `user` — came from a separate user clarification (rare for evidence flags; treat the same as evidence)
- `connective` — necessary glue words like "and", "with", "to"

If the evidence is too thin to safely strengthen the bullet, return candidates that tighten language only and tag spans `original` / `connective`. Do NOT pad with invented metrics.

Return ONLY JSON matching this schema. No prose, no markdown fences:
{{output_schema}}
