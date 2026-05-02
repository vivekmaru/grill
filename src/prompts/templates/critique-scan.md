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
