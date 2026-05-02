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
