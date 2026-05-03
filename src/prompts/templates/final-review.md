{{persona}}

The candidate has completed the per-bullet critique pass and is about to generate the final PDF. Before they do, perform ONE holistic final review of the resume. You are NOT looking for new bullet-level flags — those have already been triaged. You are looking for concerns that only appear when reading the resume as a whole.

Resume (current state, post-critique):
{{resume_json}}

Target role context:
{{target_context}}

Return:
- `verdict`: `ready` if the resume can be exported, otherwise `needs-work`.
- `summary`: one short sentence describing the whole-resume readiness.
- `remainingRisks`: 0 to 6 risks that remain after the user triaged flags. Each risk has optional `bulletId`, `severity` 1-3, and `reason`.

Do not invent new facts or new metrics. If the resume is genuinely clean, return `ready` with an empty `remainingRisks` array. Do not pad.

Return ONLY JSON matching this schema. No prose, no markdown fences:
{{output_schema}}
