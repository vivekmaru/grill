# Technical PRD: AI-Powered Local Resume Builder (v1.1)

> **Revision note (2026-05-01):** Stack revised from Go to TypeScript/Bun after design review. Prompt strategy specified separately in [`docs/superpowers/specs/2026-05-01-interrogator-prompt-design.md`](docs/superpowers/specs/2026-05-01-interrogator-prompt-design.md).

## 0. Product Vision & Philosophy
**"From Resume Editing to Resume Interrogation."**

Most resume builders are passive templates. This tool is built on the belief that a resume shouldn't just be *written*; it should be *defended*. By transforming the AI from a helpful assistant into a **Skeptical Interviewer**, we shift the focus from "what sounds good" to "what proves impact."

The goal is to eliminate "resume ghosting"—the use of vague, empty adjectives that recruiters ignore—and replace it with hard evidence and clear signals. This is a tool for professionals who value privacy, control, and high-density information, leveraging the power of their local environment to create world-class results without a cloud-service middleman.

---

## 1. Project Overview
A privacy-first, local-first web application designed to build and refine professional resumes using an "Interviewer Persona" feedback loop. The application leverages a user's existing local AI CLI installations (Claude Code, Codex, Gemini CLI) to avoid API costs and keep data on the local machine.

### Core Objectives
*   **Privacy:** No cloud hosting; all data stays in a local SQLite database.
*   **Cost Efficiency:** Harnesses local CLI subscriptions; per-session budget with overage opt-in.
*   **Quality:** Uses a specialized "Interviewer" persona to eliminate "fluff" and unverified claims.
*   **User Agency:** The interrogator surfaces concerns but never blocks the user — every flag can be dismissed.
*   **Design:** Modern, professional UI with multiple resume templates rendered deterministically from structured data.

---

## 2. System Architecture

### Backend (TypeScript on Bun)
*   **Runtime:** `Bun` for fast startup and single-binary distribution via `bun build --compile`.
*   **Framework:** `Hono` (tiny, fast, Node-compatible HTTP server).
*   **Database:** `bun:sqlite` (built-in, zero-dependency).
*   **Validation:** `Zod` — single source of truth for resume schema, shared with the frontend.
*   **Orchestration:** `Bun.spawn` to invoke local CLI tools (`claude`, `codex`, `gemini`) in headless mode with native JSON / stream-JSON output.
*   **PDF parsing:** `unpdf` (pure JS, no native deps) for ingestion.
*   **PDF export:** `@react-pdf/renderer` — renders React templates directly to PDF without Chromium or LaTeX.
*   **DOCX export:** `docx` npm package — generates `.docx` directly from structured data.

### Frontend (TypeScript)
*   **Framework:** `Vite` + `React 19` SPA, embedded into the Bun binary at build time.
*   **State:** TanStack Query for server sync, Zustand for client state.
*   **UI Library:** `Tailwind CSS` + `shadcn/ui`. Glassmorphism / minimalist treatments per template.
*   **Editor:** `CodeMirror` for inline Markdown editing of bullet text with live preview.

### Why this stack (vs. the original Go proposal)
*   The app is I/O-bound (CLI orchestration, SQLite, SSE streaming) — Node/Bun's event loop fits naturally.
*   Shared Zod schema between frontend and backend — biggest pragmatic win for a local app.
*   `@react-pdf/renderer` removes the LaTeX dependency cliff; `unpdf` removes the poppler dependency.
*   `bun build --compile` provides Go-equivalent single-binary distribution.

---

## 3. Product Features (V1)

### Phase 1: Ingestion, Target, & Persona
1.  **Ingestion:** Upload a PDF/Markdown resume or start blank. Parsing is deterministic (no LLM).
2.  **Target Context:** User specifies target role, seniority, optional industry, optional Job Description. The JD is the highest-value input — it triggers per-session web grounding (see §5).
3.  **Persona Assignment:** AI proposes a relevant interviewer archetype (e.g., "Engineering Manager", "VP Product") and tone (`skeptical | curious | adversarial | coaching`). User can accept the proposal, override the archetype/tone via dropdown, or write a fully custom persona prompt. Both fast and explicit paths are surfaced.
4.  **Provider Lock:** The user picks an AI provider (Claude / Codex / Gemini) before the session starts. Once gather begins, the provider is locked for the duration of the session — switching providers loses CLI-side conversational state. Documented prominently in onboarding.

### Phase 2: Content Refinement (Gather → Critique)
5.  **Gather (per role):** AI asks one open question per role anchored to specifics (company, dates, title). Up to two targeted follow-ups *only* when the user's answer is thin (no scope, no outcome, vague time, missing context). Capped to keep the experience manageable.
6.  **Critique Loop:** A "scan" pass flags weak bullets against a fixed taxonomy (`unverified`, `no-impact`, `inflated`, `vague`, `passive`, `length`, `jargon`, `stale`). Severity 2+ surfaces by default; severity 1 hidden behind "deeper review". Maximum 8 flags per pass.
7.  **Per-bullet refinement:**
    *   For low-risk flags (`vague`, `passive`, `jargon`, `length`): AI proposes 2 rewrite candidates restricted to existing words.
    *   For evidence flags (`unverified`, `no-impact`, `inflated`): AI must ask the user a question first, then rewrite using only the user's answer + the original bullet.
    *   Every rewrite passes a tiered verifier: deterministic regex catches invented numbers; cheap-LLM call catches invented entities. Failures regenerate once, then fall back to user-writes-it-themselves.
8.  **User agency:** Severity-3 flags surface prominently with a one-click "I stand by this" confirmation. The user always has the final say. Dismissed flags are recorded but not re-surfaced.
9.  **Final Review:** A holistic pass over the post-critique resume. User can act on remaining concerns (one more critique round) or proceed to generation.
10. **End interrogation anytime:** A persistent "Skip the rest" / "Stop critique" / "Generate now" button lets the user exit the loop at any state.

### Phase 3: Generation & Export
11. **Format Generation:** The structured resume JSON is rendered into 5 deterministic React templates (no LLM involved in rendering):
    *   **The Gold Standard:** High-compatibility reverse-chronological (ATS-ready).
    *   **Modern Playful:** Glassmorphism-inspired with vibrant accents and rounded layouts.
    *   **The Skills-Forward:** Hybrid layout for specialists.
    *   **The Deep Tech:** Focuses on project impact and tech stacks.
    *   **The Minimalist:** High-end typography and generous whitespace.
12. **Inline Editing:** User can edit bullet text in CodeMirror with live preview, or ask the AI to make targeted updates (which routes through the same `rewrite-evidenced` template + verifier).
13. **Multi-Format Export:** One-click export to **PDF** (via `@react-pdf/renderer`) and **Microsoft Word** (via `docx` npm package). No external binaries required.

---

## 4. Prompt Architecture

The interrogator's prompt strategy is the core IP of the product. Designed in detail in [`docs/superpowers/specs/2026-05-01-interrogator-prompt-design.md`](docs/superpowers/specs/2026-05-01-interrogator-prompt-design.md). Summary:

*   **Templates with named slots** — six markdown templates (one per state-machine phase that calls a model), filled at runtime with a tiny mustache-style renderer. No fragment library, no template engine.
*   **Persona = archetype + tone**, decoupled. 7 archetypes (Engineering Manager, Director of Engineering, Tech Recruiter, VP Product, Founder, Staff/Principal IC, Department Head). 4 tones. Combinations like "Engineering Manager + coaching" for friendly first pass; same archetype + adversarial for hardening.
*   **Grounding:** thin hand-curated baseline rubric, augmented per-session with 1–3 high-confidence standards distilled from a single web search keyed off the JD. Falls back silently to baseline if grounding fails.
*   **Provider adapters:** thin per-provider files (`codex.ts`, `claude.ts`, `gemini.ts`) playing to each CLI's strengths. Phase 2 runtime is Codex-only; the Claude adapter is preserved and tested but inactive until future multi-provider work.
*   **Anti-hallucination:** every rewrite passes a tiered verifier — deterministic regex for numbers (Tier 1, always runs after evidence rewrites), cheap-LLM call for named entities (Tier 2, only when Tier 1 passes).

---

## 5. Technical Specifications

### Data Schema (SQLite)
*   **`resumes`**: `id`, `content_json` (structured Resume from Zod schema), `version_name`, `created_at`.
*   **`sessions`**: `id`, `target_context_json`, `persona_json`, `provider`, `provider_locked_at`, `active_resume_id`, `model_calls_made`, `allow_extra_usage`, `created_at`.
*   **`history`**: `id`, `session_id`, `role` (user/ai), `event_type`, `content`, `timestamp`. State-machine event log; replayable.
*   **`model_calls`**: `id`, `session_id`, `template_name`, `provider`, `tier` (main/verifier), `tokens_in_estimate`, `tokens_out_estimate`, `latency_ms`, `validation_failures`, `verifier_rejections`. Local telemetry for prompt tuning.

Full Resume / TargetContext schema lives in `src/schema/resume.ts` (Zod).

### CLI Integration
The Bun backend invokes provider CLIs in headless mode. Each adapter handles the provider's specifics:

```bash
# Claude (default: bare mode, native JSON schema, native session resume)
claude -p --bare \
  --output-format json \
  --json-schema '<inline>' \
  --resume <session_id>

# Codex (Phase 2 runtime: file-based JSON schema, no resume continuity yet)
codex exec - --json \
  --output-schema /tmp/<turn>.schema.json \
  --output-last-message /tmp/<turn>.out

# Gemini (tolerant parser, orchestrator-managed transcript)
gemini -p "<full_prompt>" \
  --output-format json \
  -m $GEMINI_MAIN_MODEL
```

Phase 2 intentionally does not use Codex CLI resume continuity because the
installed resume subcommand does not expose the schema-constrained output path.

Configurable via `.env`:
```
AI_PROVIDER=claude                                  # default; user overridable per session
CLAUDE_BIN=claude
GEMINI_BIN=gemini
OPENAI_BIN=codex
ANTHROPIC_MAIN_MODEL=claude-opus-4-7
ANTHROPIC_VERIFIER_MODEL=claude-haiku-4-5-20251001
GEMINI_MAIN_MODEL=gemini-2.5-pro
GEMINI_VERIFIER_MODEL=gemini-flash-latest
OPENAI_MAIN_MODEL=gpt-5
OPENAI_VERIFIER_MODEL=gpt-4.1-nano
CLAUDE_BARE_MODE=true                               # set false to use OAuth/subscription
```

### Export Engine
*   **PDF:** `@react-pdf/renderer` — each template is a React component receiving the typed Resume JSON. No Chromium, no LaTeX.
*   **DOCX:** `docx` npm package — same Resume JSON, dedicated `.docx` builders per template style.

---

## 6. Privacy & Cost Controls

*   **Local-first:** all session data, history, and telemetry remain in SQLite on the user's machine. No cloud sync.
*   **Provider lock per session:** prevents accidental re-routing of conversation context to a different provider mid-session.
*   **Per-session budget:**
    ```
    maxModelCallsPerSession = 60         # default; configurable via .env
    warnAtPercent = 75                   # soft banner
    hardStopAtPercent = 100              # would block...
    allowExtraUsage = false              # ...unless toggled on
    ```
    At 100%, a modal asks the user whether to continue. On confirm, a live usage panel replaces the corner progress bar — showing model calls, estimated tokens, and a "Stop here" button. Models matter; users see what they're spending.
*   **Telemetry stays local:** `model_calls` table is for local prompt-tuning only. No external reporting.

---

## 7. Deployment Model

1.  **Local Binary:** Bun backend compiled to a single static binary (`bun build --compile`). Frontend assets embedded.
2.  **Zero Auth:** No login required; the server listens exclusively on `127.0.0.1`.
3.  **Local Files:** Application state and the SQLite database stored in the user's local app-data folder (`~/Library/Application Support/resume-builder/` on macOS, equivalent paths on Linux/Windows).
4.  **CLI dependency check:** On first launch, the app probes installed CLIs (`claude --version`, `codex --version`, `gemini --version`) and disables unavailable provider options in the UI with a tooltip pointing to install instructions.

---

## 8. Future Roadmap (V2+)

*   **`redundant` flag:** cross-bullet duplicate detection. Sometimes redundancy shows continuity, so opt-in.
*   **Folder Watching:** automatically ingest changes when a file in a watched directory is updated.
*   **Strength Scoring:** a 1–10 "Impact Score" per bullet to gamify improvement (already in the schema; needs UI surface).
*   **Mock Interview:** training mode where the AI asks behavioral questions based on the generated resume.
*   **Per-flag tone blending:** different tones for different flag types (coaching for `jargon`, adversarial for `unverified`).
*   **Direct API mode:** optional bypass of CLIs for users who prefer raw API keys (and for non-CLI environments).
*   **Multi-resume comparison:** brand the same career two ways for different roles, side-by-side.

---

## 9. Related Documents

*   [`docs/superpowers/specs/2026-05-01-interrogator-prompt-design.md`](docs/superpowers/specs/2026-05-01-interrogator-prompt-design.md) — full prompt architecture spec.
*   `src/schema/resume.ts` (planned) — canonical Zod schema for Resume, TargetContext, persona, flags.
