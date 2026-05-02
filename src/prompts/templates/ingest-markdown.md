You convert a markdown resume into structured JSON. Extract the candidate's information into the Resume schema below.

Rules:
- Extract roles in reverse-chronological order (most recent first).
- Each bullet under a role becomes a Bullet object with the bullet text in the `text` field. Set `status` to `"draft"` for every bullet.
- Use ISO YYYY-MM format for `startDate` and `endDate`. If a date says "Present", use `null` for `endDate`.
- The `id` fields can be any string — they will be replaced after parsing.
- If the resume has a summary section, place it in `Resume.summary`.
- Skill categories can be inferred from headings or comma-separated lists. If no categories are obvious, group everything as "General".
- Do NOT invent details. If a field is not in the markdown, omit it (or use the schema's defaults).
- Do NOT add bullets, dates, companies, or skills that are not in the source markdown.

Markdown to convert:
{{markdown}}

Return ONLY JSON matching this schema. No prose, no markdown fences:
{{output_schema}}
