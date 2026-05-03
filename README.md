# Resume Builder

A privacy-first, local-first AI resume builder that interrogates your resume rather than just editing it.

> **Status:** Early development. See `PRD.md` for the product specification and `docs/superpowers/specs/` for design specs. Implementation plans live in `docs/superpowers/plans/`.

## Quick Start

> The full setup, build, and configuration guide will land in sub-plan 7. For now:

```bash
bun install
bun run test         # run the test suite
bun run type-check   # verify TypeScript
RESUME_BUILDER_MOCK_CODEX=1 bun run dev
```

Phase 2 runs through Codex by default. For real local model calls, install and
authenticate the Codex CLI, then run `bun run dev`. The mock flag above keeps
the UI smoke path local and deterministic.

## Architecture

- TypeScript on Bun
- Hono HTTP server
- bun:sqlite for local persistence
- Zod schemas as the single source of truth
- Event-sourced state machine
- Local CLI orchestration via Codex in Phase 2
- Claude adapter preserved and tested for future multi-provider work, but inactive in runtime wiring

See `PRD.md` §2 for the full architecture rationale.
