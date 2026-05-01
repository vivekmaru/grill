# Resume Builder

A privacy-first, local-first AI resume builder that interrogates your resume rather than just editing it.

> **Status:** Early development. See `PRD.md` for the product specification and `docs/superpowers/specs/` for design specs. Implementation plans live in `docs/superpowers/plans/`.

## Quick Start

> The full setup, build, and configuration guide will land in sub-plan 7. For now:

```bash
bun install
bun run test         # run the test suite
bun run type-check   # verify TypeScript
bun run dev          # start the server (work-in-progress)
```

## Architecture

- TypeScript on Bun
- Hono HTTP server
- bun:sqlite for local persistence
- Zod schemas as the single source of truth
- Event-sourced state machine
- Local CLI orchestration (Claude / Codex / Gemini) — wired up in sub-plan 2

See `PRD.md` §2 for the full architecture rationale.
