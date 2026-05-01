# Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the non-AI core of the resume builder — Bun project skeleton, all Zod schemas, SQLite persistence layer, event-sourced state machine, env-validated config, and the Hono server skeleton — so every later plan has a tested, locked-in foundation to build on.

**Architecture:** Single Bun TypeScript project (frontend will be embedded later via Vite output). The state machine is a pure reducer over an append-only `history` event log; current state is reconstructed by replay. SQLite via `bun:sqlite` (zero-dep). All schemas are Zod-first; DB serializes them as JSON. No AI/provider/prompt code in this plan.

**Tech Stack:** Bun, TypeScript 5, Zod 3, Hono, bun:sqlite, Vitest.

---

## File Structure

```
resume-builder/
├── package.json                          # Bun workspace + scripts
├── tsconfig.json                         # strict mode + bundler resolution
├── bunfig.toml                           # Bun test config
├── .env.example                          # documented env vars
├── .gitignore                            # node_modules, data/, .env, dist/
├── README.md                             # stub (full version in sub-plan 7)
├── PRD.md                                # already exists
├── docs/                                 # already exists with specs/, plans/
└── src/
    ├── lib/
    │   └── env.ts                        # Zod-validated env loader
    ├── schema/
    │   ├── resume.ts                     # Resume, Role, Bullet, Education, Project
    │   ├── target.ts                     # TargetContext, Persona, Archetype, Tone
    │   ├── flags.ts                      # Flag, Severity, FlagInstance
    │   └── events.ts                     # State machine event union
    ├── state/
    │   ├── states.ts                     # State enum + allowed-events map
    │   ├── reducer.ts                    # pure (state, event) → state
    │   └── replay.ts                     # rebuild state from history rows
    ├── config/
    │   └── critique.ts                   # tunable constants
    └── server/
        ├── index.ts                      # Hono entry + /healthz
        └── db/
            ├── client.ts                 # bun:sqlite wrapper + migrations runner
            ├── migrations.ts             # CREATE TABLE statements
            └── repositories/
                ├── sessions.ts
                ├── resumes.ts
                ├── history.ts
                └── modelCalls.ts

tests/
├── schema/
│   ├── resume.test.ts
│   ├── target.test.ts
│   ├── flags.test.ts
│   └── events.test.ts
├── state/
│   ├── reducer.test.ts
│   └── replay.test.ts
├── db/
│   ├── migrations.test.ts
│   ├── sessions.test.ts
│   ├── resumes.test.ts
│   ├── history.test.ts
│   └── modelCalls.test.ts
├── lib/
│   └── env.test.ts
└── server/
    └── index.test.ts
```

**Why this layout:**

- `schema/` is split by domain (resume, target, flags, events) so files stay small and reviewable. Cross-imports go one direction (`resume.ts` ← `flags.ts`).
- `state/` separates the *what* (states.ts), the *how* (reducer.ts), and the *recovery* (replay.ts). Each file is unit-testable in isolation.
- `server/db/repositories/` mirrors the four tables 1:1 — each repo owns CRUD for one table, no cross-repo joins in this plan (state machine handles relationships).
- `lib/env.ts` is its own module so env validation can be imported by tests without booting the server.

---

## Task 1: Initialize Bun project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `bunfig.toml`
- Create: `.gitignore`

- [ ] **Step 1: Initialize the Bun project and install dependencies**

Run from the project root (`/Users/vivek/dev/claude-apps/resume-builder`):

```bash
bun init -y
bun add zod hono
bun add -d @types/bun typescript vitest
```

Expected: creates `package.json`, `bun.lockb`, `node_modules/`, and a starter `index.ts`. Delete the starter `index.ts` after.

```bash
rm index.ts
```

- [ ] **Step 2: Replace `package.json` with the project's actual scripts**

Overwrite `package.json` with:

```json
{
  "name": "resume-builder",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "bun run --hot src/server/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "type-check": "tsc --noEmit",
    "build": "echo 'see sub-plan 7' && exit 1"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUnusedLocals": true,
    "noImplicitAny": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowJs": false,
    "types": ["bun-types"],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist", "data"]
}
```

- [ ] **Step 4: Write `bunfig.toml`**

Create `bunfig.toml`:

```toml
[test]
preload = []
```

This is intentionally minimal — Vitest is the test runner; `bunfig.toml` exists so Bun's own resolver behaves predictably.

- [ ] **Step 5: Write `.gitignore`**

Create `.gitignore`:

```
node_modules/
dist/
data/
.env
.env.local
*.log
.DS_Store
```

- [ ] **Step 6: Verify TypeScript compiles**

Run:

```bash
bun run type-check
```

Expected: no output (success). Fix any errors before continuing.

- [ ] **Step 7: Commit**

```bash
cd /Users/vivek/dev/claude-apps/resume-builder
git init
git add package.json tsconfig.json bunfig.toml .gitignore
git commit -m "chore: initialize Bun project with TypeScript strict mode"
```

---

## Task 2: Set up Vitest with a sanity test

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/sanity.test.ts`

- [ ] **Step 1: Write Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

- [ ] **Step 2: Write a failing sanity test**

Create `tests/sanity.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('sanity', () => {
  it('runs Vitest', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 3: Run the test**

```bash
bun run test
```

Expected: `1 passed`. If Vitest can't find Bun types, ensure `node_modules/@types/bun` is installed (re-run `bun install`).

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts tests/sanity.test.ts
git commit -m "chore: add Vitest with sanity test"
```

---

## Task 3: Stub README and .env.example

**Files:**
- Create: `README.md`
- Create: `.env.example`

- [ ] **Step 1: Write the stub README**

Create `README.md`:

```markdown
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
```

- [ ] **Step 2: Write `.env.example`**

Create `.env.example`:

```bash
# === Provider selection ===
# Default provider chosen at session start. Users can override in the UI.
AI_PROVIDER=claude              # claude | codex | gemini

# === CLI binary paths (override if your install names differ) ===
CLAUDE_BIN=claude
GEMINI_BIN=gemini
OPENAI_BIN=codex

# === Models per provider (filled in by sub-plan 2) ===
ANTHROPIC_MAIN_MODEL=claude-opus-4-7
ANTHROPIC_VERIFIER_MODEL=claude-haiku-4-5-20251001
GEMINI_MAIN_MODEL=gemini-2.5-pro
GEMINI_VERIFIER_MODEL=gemini-flash-latest
OPENAI_MAIN_MODEL=gpt-5
OPENAI_VERIFIER_MODEL=gpt-4.1-nano

# === Claude bare-mode toggle ===
# true  = use ANTHROPIC_API_KEY, skip ~/.claude config (recommended for clean runs)
# false = use OAuth/subscription auth, picks up local Claude config
CLAUDE_BARE_MODE=true

# === Server ===
PORT=4321                       # localhost only, no external binding
NODE_ENV=development            # development | test | production

# === Session budget ===
MAX_MODEL_CALLS_PER_SESSION=60  # default cap; user can opt-in to overage in UI

# === App data directory ===
# If unset, defaults to OS-appropriate app data dir (resolved at runtime in sub-plan 7).
# DATA_DIR=/absolute/path/to/data
```

- [ ] **Step 3: Commit**

```bash
git add README.md .env.example
git commit -m "docs: add stub README and .env.example"
```

---

## Task 4: Resume schema — basic types

**Files:**
- Create: `src/schema/resume.ts`
- Create: `tests/schema/resume.test.ts`

- [ ] **Step 1: Write failing test for ImpactMetric and Bullet (with status, but no flags yet)**

Create `tests/schema/resume.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Bullet, ImpactMetric } from '@/schema/resume'

describe('ImpactMetric', () => {
  it('parses a verified percentage metric', () => {
    const result = ImpactMetric.parse({
      value: '30%',
      unit: 'percent',
      verified: true,
    })
    expect(result.value).toBe('30%')
    expect(result.unit).toBe('percent')
    expect(result.verified).toBe(true)
    expect(result.baseline).toBeUndefined()
  })

  it('rejects an unknown unit', () => {
    expect(() =>
      ImpactMetric.parse({ value: '5', unit: 'lightyears', verified: false }),
    ).toThrow()
  })
})

describe('Bullet', () => {
  it('parses a minimal bullet with defaults', () => {
    const b = Bullet.parse({
      id: 'b1',
      text: 'Built a thing',
      status: 'draft',
    })
    expect(b.metrics).toEqual([])
    expect(b.skills).toEqual([])
    expect(b.flags).toEqual([])
    expect(b.sourceTurnIds).toEqual([])
  })

  it('rejects status outside the allowed set', () => {
    expect(() =>
      Bullet.parse({ id: 'b1', text: 'x', status: 'finished' }),
    ).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun run test tests/schema/resume.test.ts
```

Expected: FAIL with "Cannot find module '@/schema/resume'".

- [ ] **Step 3: Implement Resume schema (basic, no flags yet)**

Create `src/schema/resume.ts`:

```ts
import { z } from 'zod'

export const ImpactMetric = z.object({
  value: z.string(),
  unit: z.enum(['percent', 'currency', 'count', 'time', 'other']),
  baseline: z.string().optional(),
  verified: z.boolean(),
})

// FlagInstance schema is added in Task 6 once flags.ts exists.
// For now, Bullet carries an empty-array placeholder typed as unknown[].
const FlagInstancePlaceholder = z.array(z.unknown())

export const Bullet = z.object({
  id: z.string(),
  text: z.string(),
  metrics: z.array(ImpactMetric).default([]),
  skills: z.array(z.string()).default([]),
  impactScore: z.number().min(0).max(10).optional(),
  flags: FlagInstancePlaceholder.default([]),
  sourceTurnIds: z.array(z.string()).default([]),
  status: z.enum(['draft', 'flagged', 'refined', 'accepted']),
})

export type Bullet = z.infer<typeof Bullet>
export type ImpactMetric = z.infer<typeof ImpactMetric>
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun run test tests/schema/resume.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schema/resume.ts tests/schema/resume.test.ts
git commit -m "feat(schema): add ImpactMetric and Bullet"
```

---

## Task 5: Resume schema — Role, Education, Project, top-level Resume

**Files:**
- Modify: `src/schema/resume.ts`
- Modify: `tests/schema/resume.test.ts`

- [ ] **Step 1: Add failing tests for Role and the top-level Resume**

Append to `tests/schema/resume.test.ts`:

```ts
import { Resume, Role, Project, Education } from '@/schema/resume'

describe('Role', () => {
  it('parses a current role with null endDate', () => {
    const r = Role.parse({
      id: 'r1',
      company: 'Acme',
      title: 'Engineer',
      startDate: '2022-01',
      endDate: null,
      bullets: [],
    })
    expect(r.endDate).toBeNull()
  })
})

describe('Education', () => {
  it('parses with optional fields omitted', () => {
    const e = Education.parse({
      id: 'e1',
      institution: 'MIT',
      degree: 'BSc',
    })
    expect(e.highlights).toEqual([])
  })
})

describe('Project', () => {
  it('rejects a malformed url', () => {
    expect(() =>
      Project.parse({
        id: 'p1',
        name: 'X',
        url: 'not-a-url',
        description: 'd',
        bullets: [],
      }),
    ).toThrow()
  })
})

describe('Resume', () => {
  it('parses a minimal resume', () => {
    const r = Resume.parse({
      version: 1,
      contact: { name: 'Vivek' },
      roles: [],
    })
    expect(r.education).toEqual([])
    expect(r.projects).toEqual([])
    expect(r.skills).toEqual({ categories: [] })
    expect(r.certifications).toEqual([])
  })

  it('rejects a wrong version literal', () => {
    expect(() =>
      Resume.parse({ version: 2, contact: { name: 'x' }, roles: [] }),
    ).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify failures**

```bash
bun run test tests/schema/resume.test.ts
```

Expected: FAIL — `Role`, `Education`, `Project`, `Resume` not exported.

- [ ] **Step 3: Add the missing schemas**

Append to `src/schema/resume.ts`:

```ts
export const Role = z.object({
  id: z.string(),
  company: z.string(),
  title: z.string(),
  location: z.string().optional(),
  startDate: z.string(), // ISO yyyy-mm
  endDate: z.string().nullable(), // null = present
  summary: z.string().optional(),
  bullets: z.array(Bullet),
})

export const Education = z.object({
  id: z.string(),
  institution: z.string(),
  degree: z.string(),
  field: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  highlights: z.array(z.string()).default([]),
})

export const Project = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().url().optional(),
  description: z.string(),
  bullets: z.array(Bullet),
  techStack: z.array(z.string()).default([]),
})

export const SkillCategory = z.object({
  name: z.string(),
  items: z.array(z.string()),
})

export const Resume = z.object({
  version: z.literal(1),
  contact: z.object({
    name: z.string(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    location: z.string().optional(),
    links: z.array(z.object({
      label: z.string(),
      url: z.string().url(),
    })).default([]),
  }),
  summary: z.string().optional(),
  roles: z.array(Role),
  education: z.array(Education).default([]),
  projects: z.array(Project).default([]),
  skills: z.object({
    categories: z.array(SkillCategory),
  }).default({ categories: [] }),
  certifications: z.array(z.object({
    name: z.string(),
    issuer: z.string(),
    date: z.string().optional(),
  })).default([]),
})

export type Resume = z.infer<typeof Resume>
export type Role = z.infer<typeof Role>
export type Education = z.infer<typeof Education>
export type Project = z.infer<typeof Project>
```

- [ ] **Step 4: Run tests**

```bash
bun run test tests/schema/resume.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/schema/resume.ts tests/schema/resume.test.ts
git commit -m "feat(schema): add Role, Education, Project, top-level Resume"
```

---

## Task 6: Flags schema and integration into Bullet

**Files:**
- Create: `src/schema/flags.ts`
- Create: `tests/schema/flags.test.ts`
- Modify: `src/schema/resume.ts` (replace placeholder)
- Modify: `tests/schema/resume.test.ts`

- [ ] **Step 1: Write failing tests for flag types**

Create `tests/schema/flags.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { FlagType, Severity, FlagInstance } from '@/schema/flags'

describe('FlagType', () => {
  it.each([
    'unverified', 'no-impact', 'inflated',
    'vague', 'passive', 'length',
    'jargon', 'stale',
  ])('accepts %s', (flag) => {
    expect(FlagType.parse(flag)).toBe(flag)
  })

  it('rejects unknown flag type', () => {
    expect(() => FlagType.parse('redundant')).toThrow()
  })
})

describe('Severity', () => {
  it('accepts 1, 2, 3', () => {
    expect(Severity.parse(2)).toBe(2)
  })
  it('rejects 0 and 4', () => {
    expect(() => Severity.parse(0)).toThrow()
    expect(() => Severity.parse(4)).toThrow()
  })
})

describe('FlagInstance', () => {
  it('parses a complete flag with defaults for dismissed fields', () => {
    const f = FlagInstance.parse({
      flag: 'vague',
      severity: 2,
      span: 'collaborated',
      why: 'Vague resume-ghosting word with no specifics.',
      suggestedQuestion: 'What did collaboration look like day to day?',
    })
    expect(f.dismissed).toBe(false)
    expect(f.dismissedAt).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
bun run test tests/schema/flags.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement flags schema**

Create `src/schema/flags.ts`:

```ts
import { z } from 'zod'

export const FlagType = z.enum([
  'unverified',
  'no-impact',
  'inflated',
  'vague',
  'passive',
  'length',
  'jargon',
  'stale',
])

export const Severity = z.union([z.literal(1), z.literal(2), z.literal(3)])

export const FlagInstance = z.object({
  flag: FlagType,
  severity: Severity,
  span: z.string(),
  why: z.string(),
  suggestedQuestion: z.string(),
  dismissed: z.boolean().default(false),
  dismissedAt: z.number().nullable().default(null), // unix ms
})

export type FlagType = z.infer<typeof FlagType>
export type Severity = z.infer<typeof Severity>
export type FlagInstance = z.infer<typeof FlagInstance>
```

- [ ] **Step 4: Replace Bullet's flag placeholder with the real type**

In `src/schema/resume.ts`:

Replace the lines:

```ts
// FlagInstance schema is added in Task 6 once flags.ts exists.
// For now, Bullet carries an empty-array placeholder typed as unknown[].
const FlagInstancePlaceholder = z.array(z.unknown())
```

with:

```ts
import { FlagInstance } from './flags'
```

(Place the import at the top of the file, beneath the existing `import { z } from 'zod'`.)

Then in the `Bullet` definition replace:

```ts
flags: FlagInstancePlaceholder.default([]),
```

with:

```ts
flags: z.array(FlagInstance).default([]),
```

- [ ] **Step 5: Add a regression test in resume.test.ts**

Append to `tests/schema/resume.test.ts`:

```ts
describe('Bullet with flags', () => {
  it('parses a flagged bullet', () => {
    const b = Bullet.parse({
      id: 'b1',
      text: 'collaborated with team',
      status: 'flagged',
      flags: [{
        flag: 'vague',
        severity: 2,
        span: 'collaborated',
        why: 'Vague verb.',
        suggestedQuestion: 'What did collaboration look like?',
      }],
    })
    expect(b.flags[0]?.dismissed).toBe(false)
  })
})
```

- [ ] **Step 6: Run all schema tests**

```bash
bun run test tests/schema/
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/schema/flags.ts src/schema/resume.ts tests/schema/flags.test.ts tests/schema/resume.test.ts
git commit -m "feat(schema): add FlagType, Severity, FlagInstance and integrate into Bullet"
```

---

## Task 7: TargetContext and Persona schema

**Files:**
- Create: `src/schema/target.ts`
- Create: `tests/schema/target.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/schema/target.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Archetype, Tone, Persona, TargetContext } from '@/schema/target'

describe('Archetype', () => {
  it.each([
    'engineering-manager',
    'director-of-engineering',
    'tech-recruiter',
    'vp-product',
    'founder',
    'staff-principal-ic',
    'department-head',
  ])('accepts %s', (a) => {
    expect(Archetype.parse(a)).toBe(a)
  })

  it('rejects "hiring-manager" (deferred)', () => {
    expect(() => Archetype.parse('hiring-manager')).toThrow()
  })
})

describe('Tone', () => {
  it('accepts the four documented tones', () => {
    for (const t of ['skeptical', 'curious', 'adversarial', 'coaching']) {
      expect(Tone.parse(t)).toBe(t)
    }
  })
})

describe('Persona', () => {
  it('parses a basic persona', () => {
    const p = Persona.parse({
      archetype: 'engineering-manager',
      tone: 'skeptical',
    })
    expect(p.overridePrompt).toBeUndefined()
  })
})

describe('TargetContext', () => {
  it('parses with JD provided', () => {
    const t = TargetContext.parse({
      targetRole: 'Staff Engineer',
      targetSeniority: 'staff',
      jobDescription: 'Looking for...',
      persona: { archetype: 'engineering-manager', tone: 'skeptical' },
    })
    expect(t.jobDescription).toBe('Looking for...')
  })

  it('rejects unknown seniority', () => {
    expect(() =>
      TargetContext.parse({
        targetRole: 'X',
        targetSeniority: 'godmode',
        persona: { archetype: 'founder', tone: 'curious' },
      }),
    ).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
bun run test tests/schema/target.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement target.ts**

Create `src/schema/target.ts`:

```ts
import { z } from 'zod'

export const Archetype = z.enum([
  'engineering-manager',
  'director-of-engineering',
  'tech-recruiter',
  'vp-product',
  'founder',
  'staff-principal-ic',
  'department-head',
])

export const Tone = z.enum([
  'skeptical',
  'curious',
  'adversarial',
  'coaching',
])

export const Seniority = z.enum([
  'junior', 'mid', 'senior', 'staff', 'principal', 'director', 'exec',
])

export const Persona = z.object({
  archetype: Archetype,
  tone: Tone,
  overridePrompt: z.string().optional(),
})

export const TargetContext = z.object({
  jobDescription: z.string().optional(),
  targetRole: z.string(),
  targetSeniority: Seniority,
  industry: z.string().optional(),
  persona: Persona,
})

export type Archetype = z.infer<typeof Archetype>
export type Tone = z.infer<typeof Tone>
export type Seniority = z.infer<typeof Seniority>
export type Persona = z.infer<typeof Persona>
export type TargetContext = z.infer<typeof TargetContext>
```

- [ ] **Step 4: Run tests**

```bash
bun run test tests/schema/target.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schema/target.ts tests/schema/target.test.ts
git commit -m "feat(schema): add Archetype, Tone, Persona, TargetContext"
```

---

## Task 8: State machine event schema

**Files:**
- Create: `src/schema/events.ts`
- Create: `tests/schema/events.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/schema/events.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Event } from '@/schema/events'

describe('Event', () => {
  it('parses START_BLANK', () => {
    expect(Event.parse({ type: 'START_BLANK' }).type).toBe('START_BLANK')
  })

  it('parses SET_TARGET with full target context', () => {
    const e = Event.parse({
      type: 'SET_TARGET',
      ctx: {
        targetRole: 'PM',
        targetSeniority: 'senior',
        persona: { archetype: 'vp-product', tone: 'curious' },
      },
    })
    expect(e.type).toBe('SET_TARGET')
  })

  it('parses ACCEPT_BULLET', () => {
    const e = Event.parse({
      type: 'ACCEPT_BULLET',
      bulletId: 'b1',
      newText: 'Shipped X to 10k users',
    })
    expect(e.type).toBe('ACCEPT_BULLET')
  })

  it('parses END_INTERROGATION', () => {
    expect(Event.parse({ type: 'END_INTERROGATION' }).type).toBe('END_INTERROGATION')
  })

  it('rejects unknown event type', () => {
    expect(() => Event.parse({ type: 'DELETE_EVERYTHING' })).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
bun run test tests/schema/events.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement events.ts**

Create `src/schema/events.ts`:

```ts
import { z } from 'zod'
import { TargetContext } from './target'

export const Event = z.discriminatedUnion('type', [
  z.object({ type: z.literal('UPLOAD_RESUME'), markdown: z.string() }),
  z.object({ type: z.literal('START_BLANK') }),
  z.object({ type: z.literal('CONFIRM_INGEST') }),
  z.object({ type: z.literal('SET_TARGET'), ctx: TargetContext }),
  z.object({ type: z.literal('CONFIRM_PERSONA') }),
  z.object({ type: z.literal('OVERRIDE_PERSONA'), prompt: z.string() }),
  z.object({ type: z.literal('USER_MESSAGE'), text: z.string() }),
  z.object({
    type: z.literal('ACCEPT_BULLET'),
    bulletId: z.string(),
    newText: z.string(),
  }),
  z.object({ type: z.literal('REJECT_BULLET'), bulletId: z.string() }),
  z.object({ type: z.literal('SKIP_BULLET'), bulletId: z.string() }),
  z.object({
    type: z.literal('DISMISS_FLAG'),
    bulletId: z.string(),
    flagIndex: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal('END_INTERROGATION') }),
  z.object({ type: z.literal('PROCEED_TO_GENERATE') }),
  z.object({ type: z.literal('PICK_TEMPLATE'), templateId: z.string() }),
  z.object({
    type: z.literal('EDIT_RESUME'),
    patch: z.array(z.unknown()), // RFC 6902 — refined when used
  }),
  z.object({ type: z.literal('EXPORT'), format: z.enum(['pdf', 'docx']) }),
])

export type Event = z.infer<typeof Event>
```

- [ ] **Step 4: Run tests**

```bash
bun run test tests/schema/events.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schema/events.ts tests/schema/events.test.ts
git commit -m "feat(schema): add discriminated-union Event for state machine"
```

---

## Task 9: Tunable critique config

**Files:**
- Create: `src/config/critique.ts`
- Create: `tests/config/critique.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/config/critique.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  MAX_FLAGS_PER_PASS,
  MAX_FOLLOWUPS_PER_ROLE,
  DEFAULT_SEVERITY_FLOOR,
  MAX_REWRITE_RETRIES,
  MAX_REWRITE_CANDIDATES,
  JD_OVERLAY_MAX_STANDARDS,
} from '@/config/critique'

describe('critique config', () => {
  it('matches the spec defaults', () => {
    expect(MAX_FLAGS_PER_PASS).toBe(8)
    expect(MAX_FOLLOWUPS_PER_ROLE).toBe(2)
    expect(DEFAULT_SEVERITY_FLOOR).toBe(2)
    expect(MAX_REWRITE_RETRIES).toBe(1)
    expect(MAX_REWRITE_CANDIDATES).toBe(2)
    expect(JD_OVERLAY_MAX_STANDARDS).toBe(3)
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
bun run test tests/config/critique.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement config**

Create `src/config/critique.ts`:

```ts
// Tunable constants for critique calibration. Spec §10.1.
// Centralized so a future "deep mode" toggle is a single-file change.

export const MAX_FLAGS_PER_PASS = 8
export const MAX_FOLLOWUPS_PER_ROLE = 2
export const DEFAULT_SEVERITY_FLOOR = 2 as 1 | 2 | 3
export const MAX_REWRITE_RETRIES = 1
export const MAX_REWRITE_CANDIDATES = 2
export const JD_OVERLAY_MAX_STANDARDS = 3
```

- [ ] **Step 4: Run tests**

```bash
bun run test tests/config/critique.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/critique.ts tests/config/critique.test.ts
git commit -m "feat(config): add critique calibration constants"
```

---

## Task 10: Env loader with Zod validation

**Files:**
- Create: `src/lib/env.ts`
- Create: `tests/lib/env.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/env.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { loadEnv } from '@/lib/env'

describe('loadEnv', () => {
  it('parses a complete env block', () => {
    const env = loadEnv({
      AI_PROVIDER: 'claude',
      CLAUDE_BIN: 'claude',
      GEMINI_BIN: 'gemini',
      OPENAI_BIN: 'codex',
      ANTHROPIC_MAIN_MODEL: 'claude-opus-4-7',
      ANTHROPIC_VERIFIER_MODEL: 'claude-haiku-4-5-20251001',
      GEMINI_MAIN_MODEL: 'gemini-2.5-pro',
      GEMINI_VERIFIER_MODEL: 'gemini-flash-latest',
      OPENAI_MAIN_MODEL: 'gpt-5',
      OPENAI_VERIFIER_MODEL: 'gpt-4.1-nano',
      CLAUDE_BARE_MODE: 'true',
      PORT: '4321',
      NODE_ENV: 'development',
      MAX_MODEL_CALLS_PER_SESSION: '60',
    })
    expect(env.AI_PROVIDER).toBe('claude')
    expect(env.PORT).toBe(4321)
    expect(env.CLAUDE_BARE_MODE).toBe(true)
    expect(env.MAX_MODEL_CALLS_PER_SESSION).toBe(60)
  })

  it('applies defaults for unset values', () => {
    const env = loadEnv({})
    expect(env.AI_PROVIDER).toBe('claude')
    expect(env.PORT).toBe(4321)
    expect(env.NODE_ENV).toBe('development')
    expect(env.CLAUDE_BARE_MODE).toBe(true)
  })

  it('rejects an unknown AI_PROVIDER', () => {
    expect(() => loadEnv({ AI_PROVIDER: 'cohere' })).toThrow()
  })

  it('rejects a non-numeric PORT', () => {
    expect(() => loadEnv({ PORT: 'abc' })).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
bun run test tests/lib/env.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement env.ts**

Create `src/lib/env.ts`:

```ts
import { z } from 'zod'

const numericString = (defaultValue: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? defaultValue : Number(v)))
    .refine((n) => Number.isFinite(n), { message: 'must be a finite number' })

const booleanString = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return defaultValue
      if (v === 'true' || v === '1') return true
      if (v === 'false' || v === '0') return false
      throw new Error(`invalid boolean: ${v}`)
    })

const EnvSchema = z.object({
  AI_PROVIDER: z.enum(['claude', 'codex', 'gemini']).default('claude'),
  CLAUDE_BIN: z.string().default('claude'),
  GEMINI_BIN: z.string().default('gemini'),
  OPENAI_BIN: z.string().default('codex'),
  ANTHROPIC_MAIN_MODEL: z.string().default('claude-opus-4-7'),
  ANTHROPIC_VERIFIER_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  GEMINI_MAIN_MODEL: z.string().default('gemini-2.5-pro'),
  GEMINI_VERIFIER_MODEL: z.string().default('gemini-flash-latest'),
  OPENAI_MAIN_MODEL: z.string().default('gpt-5'),
  OPENAI_VERIFIER_MODEL: z.string().default('gpt-4.1-nano'),
  CLAUDE_BARE_MODE: booleanString(true),
  PORT: numericString(4321),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MAX_MODEL_CALLS_PER_SESSION: numericString(60),
  DATA_DIR: z.string().optional(),
})

export type Env = z.infer<typeof EnvSchema>

/**
 * Parse an env-vars-shaped object. In production, callers pass `process.env`.
 * Tests pass synthetic objects directly — never read real env in unit tests.
 */
export function loadEnv(source: Record<string, string | undefined>): Env {
  return EnvSchema.parse(source)
}
```

- [ ] **Step 4: Run tests**

```bash
bun run test tests/lib/env.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/env.ts tests/lib/env.test.ts
git commit -m "feat(lib): add Zod-validated env loader"
```

---

## Task 11: SQLite client + migrations

**Files:**
- Create: `src/server/db/migrations.ts`
- Create: `src/server/db/client.ts`
- Create: `tests/db/migrations.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/db/migrations.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createDb } from '@/server/db/client'

describe('migrations', () => {
  it('creates all four tables on a fresh in-memory db', () => {
    const db = createDb(':memory:')
    const rows = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
    const names = rows.map((r) => r.name)
    expect(names).toContain('sessions')
    expect(names).toContain('resumes')
    expect(names).toContain('history')
    expect(names).toContain('model_calls')
  })

  it('is idempotent — running migrations twice does not error', () => {
    const db = createDb(':memory:')
    // createDb already ran migrations once. Run again via the exported runner.
    const { runMigrations } = require('@/server/db/migrations')
    expect(() => runMigrations(db)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
bun run test tests/db/migrations.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement migrations**

Create `src/server/db/migrations.ts`:

```ts
import type { Database } from 'bun:sqlite'

const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS resumes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_json TEXT NOT NULL,
    version_name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_context_json TEXT,
    persona_json TEXT,
    provider TEXT,
    provider_locked_at INTEGER,
    active_resume_id INTEGER,
    state TEXT NOT NULL,
    model_calls_made INTEGER NOT NULL DEFAULT 0,
    allow_extra_usage INTEGER NOT NULL DEFAULT 0,
    session_handle TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (active_resume_id) REFERENCES resumes(id)
  )`,
  `CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    event_type TEXT NOT NULL,
    content_json TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_history_session ON history(session_id, timestamp)`,
  `CREATE TABLE IF NOT EXISTS model_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    template_name TEXT NOT NULL,
    provider TEXT NOT NULL,
    tier TEXT NOT NULL,
    tokens_in_estimate INTEGER,
    tokens_out_estimate INTEGER,
    latency_ms INTEGER,
    validation_failures INTEGER NOT NULL DEFAULT 0,
    verifier_rejections INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_modelcalls_session ON model_calls(session_id)`,
]

export function runMigrations(db: Database): void {
  for (const stmt of STATEMENTS) {
    db.run(stmt)
  }
}
```

- [ ] **Step 4: Implement client.ts**

Create `src/server/db/client.ts`:

```ts
import { Database } from 'bun:sqlite'
import { runMigrations } from './migrations'

export function createDb(path: string): Database {
  const db = new Database(path, { create: true })
  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA foreign_keys = ON')
  runMigrations(db)
  return db
}
```

- [ ] **Step 5: Run tests**

```bash
bun run test tests/db/migrations.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/db/client.ts src/server/db/migrations.ts tests/db/migrations.test.ts
git commit -m "feat(db): add SQLite client and migrations for 4 core tables"
```

---

## Task 12: Resumes repository

**Files:**
- Create: `src/server/db/repositories/resumes.ts`
- Create: `tests/db/resumes.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/db/resumes.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createDb } from '@/server/db/client'
import { createResumeRepo, type ResumeRepo } from '@/server/db/repositories/resumes'
import type { Resume } from '@/schema/resume'

const sample: Resume = {
  version: 1,
  contact: { name: 'V', links: [] },
  roles: [],
  education: [],
  projects: [],
  skills: { categories: [] },
  certifications: [],
}

describe('ResumeRepo', () => {
  let repo: ResumeRepo

  beforeEach(() => {
    const db = createDb(':memory:')
    repo = createResumeRepo(db)
  })

  it('creates and reads back a resume', () => {
    const id = repo.create({ resume: sample, versionName: 'v1' })
    const fetched = repo.get(id)
    expect(fetched?.resume.contact.name).toBe('V')
    expect(fetched?.versionName).toBe('v1')
  })

  it('returns null for missing id', () => {
    expect(repo.get(999)).toBeNull()
  })

  it('updates an existing resume', () => {
    const id = repo.create({ resume: sample, versionName: 'v1' })
    const next: Resume = { ...sample, contact: { ...sample.contact, name: 'V2' } }
    repo.update(id, { resume: next, versionName: 'v1.1' })
    expect(repo.get(id)?.resume.contact.name).toBe('V2')
    expect(repo.get(id)?.versionName).toBe('v1.1')
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
bun run test tests/db/resumes.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the repo**

Create `src/server/db/repositories/resumes.ts`:

```ts
import type { Database } from 'bun:sqlite'
import { Resume } from '@/schema/resume'

export interface StoredResume {
  id: number
  resume: Resume
  versionName: string
  createdAt: number
}

export interface ResumeRepo {
  create(input: { resume: Resume; versionName: string }): number
  get(id: number): StoredResume | null
  update(id: number, input: { resume: Resume; versionName: string }): void
}

interface ResumeRow {
  id: number
  content_json: string
  version_name: string
  created_at: number
}

export function createResumeRepo(db: Database): ResumeRepo {
  const insert = db.query<{ id: number }, [string, string, number]>(
    `INSERT INTO resumes (content_json, version_name, created_at)
     VALUES (?, ?, ?) RETURNING id`,
  )
  const select = db.query<ResumeRow, [number]>(
    `SELECT id, content_json, version_name, created_at FROM resumes WHERE id = ?`,
  )
  const update = db.query<unknown, [string, string, number]>(
    `UPDATE resumes SET content_json = ?, version_name = ? WHERE id = ?`,
  )

  return {
    create({ resume, versionName }) {
      const parsed = Resume.parse(resume)
      const row = insert.get(JSON.stringify(parsed), versionName, Date.now())
      if (!row) throw new Error('insert returned no row')
      return row.id
    },
    get(id) {
      const row = select.get(id)
      if (!row) return null
      return {
        id: row.id,
        resume: Resume.parse(JSON.parse(row.content_json)),
        versionName: row.version_name,
        createdAt: row.created_at,
      }
    },
    update(id, { resume, versionName }) {
      const parsed = Resume.parse(resume)
      update.run(JSON.stringify(parsed), versionName, id)
    },
  }
}
```

- [ ] **Step 4: Run tests**

```bash
bun run test tests/db/resumes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/repositories/resumes.ts tests/db/resumes.test.ts
git commit -m "feat(db): add ResumeRepo with create/get/update"
```

---

## Task 13: Sessions repository

**Files:**
- Create: `src/server/db/repositories/sessions.ts`
- Create: `tests/db/sessions.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/db/sessions.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createDb } from '@/server/db/client'
import { createSessionRepo, type SessionRepo } from '@/server/db/repositories/sessions'

describe('SessionRepo', () => {
  let repo: SessionRepo

  beforeEach(() => {
    const db = createDb(':memory:')
    repo = createSessionRepo(db)
  })

  it('creates a session in the ingest state with no provider', () => {
    const id = repo.create({ state: 'ingest' })
    const s = repo.get(id)
    expect(s?.state).toBe('ingest')
    expect(s?.provider).toBeNull()
    expect(s?.modelCallsMade).toBe(0)
    expect(s?.allowExtraUsage).toBe(false)
  })

  it('locks a provider exactly once', () => {
    const id = repo.create({ state: 'ingest' })
    repo.lockProvider(id, 'claude')
    const s = repo.get(id)
    expect(s?.provider).toBe('claude')
    expect(s?.providerLockedAt).not.toBeNull()
  })

  it('refuses to overwrite a locked provider', () => {
    const id = repo.create({ state: 'ingest' })
    repo.lockProvider(id, 'claude')
    expect(() => repo.lockProvider(id, 'gemini')).toThrow(/locked/)
  })

  it('increments modelCallsMade atomically', () => {
    const id = repo.create({ state: 'ingest' })
    repo.incrementCalls(id)
    repo.incrementCalls(id)
    expect(repo.get(id)?.modelCallsMade).toBe(2)
  })

  it('updates state', () => {
    const id = repo.create({ state: 'ingest' })
    repo.setState(id, 'gather')
    expect(repo.get(id)?.state).toBe('gather')
  })

  it('sets allowExtraUsage', () => {
    const id = repo.create({ state: 'ingest' })
    repo.setAllowExtraUsage(id, true)
    expect(repo.get(id)?.allowExtraUsage).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
bun run test tests/db/sessions.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the repo**

Create `src/server/db/repositories/sessions.ts`:

```ts
import type { Database } from 'bun:sqlite'

export type ProviderName = 'claude' | 'codex' | 'gemini'

export interface StoredSession {
  id: number
  state: string
  provider: ProviderName | null
  providerLockedAt: number | null
  activeResumeId: number | null
  modelCallsMade: number
  allowExtraUsage: boolean
  sessionHandle: string | null
  createdAt: number
  updatedAt: number
}

export interface SessionRepo {
  create(input: { state: string }): number
  get(id: number): StoredSession | null
  setState(id: number, state: string): void
  lockProvider(id: number, provider: ProviderName): void
  incrementCalls(id: number): void
  setAllowExtraUsage(id: number, value: boolean): void
  setSessionHandle(id: number, handle: string): void
  setActiveResume(id: number, resumeId: number): void
}

interface SessionRow {
  id: number
  state: string
  provider: string | null
  provider_locked_at: number | null
  active_resume_id: number | null
  model_calls_made: number
  allow_extra_usage: number
  session_handle: string | null
  created_at: number
  updated_at: number
}

function rowToSession(row: SessionRow): StoredSession {
  return {
    id: row.id,
    state: row.state,
    provider: (row.provider as ProviderName | null),
    providerLockedAt: row.provider_locked_at,
    activeResumeId: row.active_resume_id,
    modelCallsMade: row.model_calls_made,
    allowExtraUsage: Boolean(row.allow_extra_usage),
    sessionHandle: row.session_handle,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function createSessionRepo(db: Database): SessionRepo {
  const insert = db.query<{ id: number }, [string, number, number]>(
    `INSERT INTO sessions (state, created_at, updated_at)
     VALUES (?, ?, ?) RETURNING id`,
  )
  const select = db.query<SessionRow, [number]>(
    `SELECT * FROM sessions WHERE id = ?`,
  )
  const updState = db.query<unknown, [string, number, number]>(
    `UPDATE sessions SET state = ?, updated_at = ? WHERE id = ?`,
  )
  const updProvider = db.query<unknown, [string, number, number, number]>(
    `UPDATE sessions SET provider = ?, provider_locked_at = ?, updated_at = ?
     WHERE id = ? AND provider IS NULL`,
  )
  const incCalls = db.query<unknown, [number, number]>(
    `UPDATE sessions SET model_calls_made = model_calls_made + 1, updated_at = ?
     WHERE id = ?`,
  )
  const updAllowExtra = db.query<unknown, [number, number, number]>(
    `UPDATE sessions SET allow_extra_usage = ?, updated_at = ? WHERE id = ?`,
  )
  const updHandle = db.query<unknown, [string, number, number]>(
    `UPDATE sessions SET session_handle = ?, updated_at = ? WHERE id = ?`,
  )
  const updActiveResume = db.query<unknown, [number, number, number]>(
    `UPDATE sessions SET active_resume_id = ?, updated_at = ? WHERE id = ?`,
  )

  return {
    create({ state }) {
      const now = Date.now()
      const row = insert.get(state, now, now)
      if (!row) throw new Error('insert returned no row')
      return row.id
    },
    get(id) {
      const row = select.get(id)
      return row ? rowToSession(row) : null
    },
    setState(id, state) {
      updState.run(state, Date.now(), id)
    },
    lockProvider(id, provider) {
      const now = Date.now()
      const result = updProvider.run(provider, now, now, id)
      if (result.changes === 0) {
        throw new Error(`session ${id} already has a locked provider`)
      }
    },
    incrementCalls(id) {
      incCalls.run(Date.now(), id)
    },
    setAllowExtraUsage(id, value) {
      updAllowExtra.run(value ? 1 : 0, Date.now(), id)
    },
    setSessionHandle(id, handle) {
      updHandle.run(handle, Date.now(), id)
    },
    setActiveResume(id, resumeId) {
      updActiveResume.run(resumeId, Date.now(), id)
    },
  }
}
```

- [ ] **Step 4: Run tests**

```bash
bun run test tests/db/sessions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/repositories/sessions.ts tests/db/sessions.test.ts
git commit -m "feat(db): add SessionRepo with provider-lock semantics"
```

---

## Task 14: History repository

**Files:**
- Create: `src/server/db/repositories/history.ts`
- Create: `tests/db/history.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/db/history.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createDb } from '@/server/db/client'
import { createHistoryRepo, type HistoryRepo } from '@/server/db/repositories/history'
import { createSessionRepo } from '@/server/db/repositories/sessions'

describe('HistoryRepo', () => {
  let repo: HistoryRepo
  let sessionId: number

  beforeEach(() => {
    const db = createDb(':memory:')
    sessionId = createSessionRepo(db).create({ state: 'ingest' })
    repo = createHistoryRepo(db)
  })

  it('appends events and returns them in order', () => {
    repo.append({
      sessionId,
      role: 'user',
      event: { type: 'START_BLANK' },
    })
    repo.append({
      sessionId,
      role: 'user',
      event: { type: 'CONFIRM_INGEST' },
    })
    const rows = repo.listForSession(sessionId)
    expect(rows.map((r) => r.event.type)).toEqual([
      'START_BLANK',
      'CONFIRM_INGEST',
    ])
  })

  it('rejects events that do not match the Event schema', () => {
    expect(() =>
      repo.append({
        sessionId,
        role: 'user',
        // @ts-expect-error: invalid event type for test
        event: { type: 'NUKE' },
      }),
    ).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
bun run test tests/db/history.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the repo**

Create `src/server/db/repositories/history.ts`:

```ts
import type { Database } from 'bun:sqlite'
import { Event } from '@/schema/events'

export type Role = 'user' | 'ai'

export interface StoredHistoryRow {
  id: number
  sessionId: number
  role: Role
  event: Event
  timestamp: number
}

export interface HistoryRepo {
  append(input: { sessionId: number; role: Role; event: Event }): number
  listForSession(sessionId: number): StoredHistoryRow[]
}

interface HistoryRow {
  id: number
  session_id: number
  role: string
  event_type: string
  content_json: string
  timestamp: number
}

export function createHistoryRepo(db: Database): HistoryRepo {
  const insert = db.query<
    { id: number },
    [number, string, string, string, number]
  >(
    `INSERT INTO history (session_id, role, event_type, content_json, timestamp)
     VALUES (?, ?, ?, ?, ?) RETURNING id`,
  )
  const list = db.query<HistoryRow, [number]>(
    `SELECT * FROM history WHERE session_id = ? ORDER BY timestamp ASC, id ASC`,
  )

  return {
    append({ sessionId, role, event }) {
      const parsed = Event.parse(event)
      const row = insert.get(
        sessionId,
        role,
        parsed.type,
        JSON.stringify(parsed),
        Date.now(),
      )
      if (!row) throw new Error('insert returned no row')
      return row.id
    },
    listForSession(sessionId) {
      return list.all(sessionId).map((r) => ({
        id: r.id,
        sessionId: r.session_id,
        role: r.role as Role,
        event: Event.parse(JSON.parse(r.content_json)),
        timestamp: r.timestamp,
      }))
    },
  }
}
```

- [ ] **Step 4: Run tests**

```bash
bun run test tests/db/history.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/repositories/history.ts tests/db/history.test.ts
git commit -m "feat(db): add HistoryRepo for event-sourced state-machine log"
```

---

## Task 15: ModelCalls repository

**Files:**
- Create: `src/server/db/repositories/modelCalls.ts`
- Create: `tests/db/modelCalls.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/db/modelCalls.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createDb } from '@/server/db/client'
import { createModelCallsRepo, type ModelCallsRepo } from '@/server/db/repositories/modelCalls'
import { createSessionRepo } from '@/server/db/repositories/sessions'

describe('ModelCallsRepo', () => {
  let repo: ModelCallsRepo
  let sessionId: number

  beforeEach(() => {
    const db = createDb(':memory:')
    sessionId = createSessionRepo(db).create({ state: 'ingest' })
    repo = createModelCallsRepo(db)
  })

  it('records a call with all fields', () => {
    repo.record({
      sessionId,
      templateName: 'gather-broad',
      provider: 'claude',
      tier: 'main',
      tokensInEstimate: 1200,
      tokensOutEstimate: 250,
      latencyMs: 4321,
      validationFailures: 0,
      verifierRejections: 0,
    })
    expect(repo.totalsForSession(sessionId).count).toBe(1)
    expect(repo.totalsForSession(sessionId).tokensIn).toBe(1200)
  })

  it('aggregates totals across calls', () => {
    for (const t of [100, 200, 300]) {
      repo.record({
        sessionId,
        templateName: 'critique-scan',
        provider: 'claude',
        tier: 'main',
        tokensInEstimate: t,
        tokensOutEstimate: 50,
        latencyMs: 1000,
        validationFailures: 0,
        verifierRejections: 0,
      })
    }
    const t = repo.totalsForSession(sessionId)
    expect(t.count).toBe(3)
    expect(t.tokensIn).toBe(600)
    expect(t.tokensOut).toBe(150)
  })

  it('returns zeroes for a session with no calls', () => {
    const t = repo.totalsForSession(sessionId)
    expect(t).toEqual({ count: 0, tokensIn: 0, tokensOut: 0 })
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
bun run test tests/db/modelCalls.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the repo**

Create `src/server/db/repositories/modelCalls.ts`:

```ts
import type { Database } from 'bun:sqlite'
import type { ProviderName } from './sessions'

export type Tier = 'main' | 'verifier'

export interface ModelCallInput {
  sessionId: number
  templateName: string
  provider: ProviderName
  tier: Tier
  tokensInEstimate: number | null
  tokensOutEstimate: number | null
  latencyMs: number | null
  validationFailures: number
  verifierRejections: number
}

export interface SessionTotals {
  count: number
  tokensIn: number
  tokensOut: number
}

export interface ModelCallsRepo {
  record(input: ModelCallInput): void
  totalsForSession(sessionId: number): SessionTotals
}

export function createModelCallsRepo(db: Database): ModelCallsRepo {
  const insert = db.query<
    unknown,
    [number, string, string, string, number | null, number | null, number | null, number, number, number]
  >(
    `INSERT INTO model_calls
     (session_id, template_name, provider, tier,
      tokens_in_estimate, tokens_out_estimate, latency_ms,
      validation_failures, verifier_rejections, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const totals = db.query<
    { count: number; tokens_in: number | null; tokens_out: number | null },
    [number]
  >(
    `SELECT
       COUNT(*) AS count,
       COALESCE(SUM(tokens_in_estimate), 0) AS tokens_in,
       COALESCE(SUM(tokens_out_estimate), 0) AS tokens_out
     FROM model_calls WHERE session_id = ?`,
  )

  return {
    record(input) {
      insert.run(
        input.sessionId,
        input.templateName,
        input.provider,
        input.tier,
        input.tokensInEstimate,
        input.tokensOutEstimate,
        input.latencyMs,
        input.validationFailures,
        input.verifierRejections,
        Date.now(),
      )
    },
    totalsForSession(sessionId) {
      const row = totals.get(sessionId)
      return {
        count: row?.count ?? 0,
        tokensIn: row?.tokens_in ?? 0,
        tokensOut: row?.tokens_out ?? 0,
      }
    },
  }
}
```

- [ ] **Step 4: Run tests**

```bash
bun run test tests/db/modelCalls.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/repositories/modelCalls.ts tests/db/modelCalls.test.ts
git commit -m "feat(db): add ModelCallsRepo with per-session totals"
```

---

## Task 16: State machine — states + allowed-events map

**Files:**
- Create: `src/state/states.ts`
- Create: `tests/state/states.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/state/states.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { State, allowedEventsFor } from '@/state/states'

describe('State', () => {
  it('lists all expected states', () => {
    const all: State[] = [
      'ingest', 'target', 'persona', 'gather',
      'critique', 'finalReview', 'generate', 'edit', 'export',
    ]
    for (const s of all) {
      expect(allowedEventsFor(s)).toBeDefined()
    }
  })

  it('only allows START_BLANK and UPLOAD_RESUME from ingest', () => {
    const events = allowedEventsFor('ingest')
    expect(events).toContain('START_BLANK')
    expect(events).toContain('UPLOAD_RESUME')
    expect(events).not.toContain('PROCEED_TO_GENERATE')
  })

  it('always allows END_INTERROGATION from gather/critique/finalReview', () => {
    expect(allowedEventsFor('gather')).toContain('END_INTERROGATION')
    expect(allowedEventsFor('critique')).toContain('END_INTERROGATION')
    expect(allowedEventsFor('finalReview')).toContain('END_INTERROGATION')
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
bun run test tests/state/states.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement states.ts**

Create `src/state/states.ts`:

```ts
import type { Event } from '@/schema/events'

export type State =
  | 'ingest'
  | 'target'
  | 'persona'
  | 'gather'
  | 'critique'
  | 'finalReview'
  | 'generate'
  | 'edit'
  | 'export'

type EventType = Event['type']

const ALLOWED: Record<State, readonly EventType[]> = {
  ingest:      ['UPLOAD_RESUME', 'START_BLANK', 'CONFIRM_INGEST'],
  target:      ['SET_TARGET'],
  persona:     ['CONFIRM_PERSONA', 'OVERRIDE_PERSONA'],
  gather:      ['USER_MESSAGE', 'END_INTERROGATION'],
  critique:    [
    'USER_MESSAGE', 'ACCEPT_BULLET', 'REJECT_BULLET', 'SKIP_BULLET',
    'DISMISS_FLAG', 'END_INTERROGATION', 'PROCEED_TO_GENERATE',
  ],
  finalReview: ['USER_MESSAGE', 'PROCEED_TO_GENERATE', 'END_INTERROGATION'],
  generate:    ['PICK_TEMPLATE'],
  edit:        ['EDIT_RESUME', 'USER_MESSAGE', 'EXPORT'],
  export:      ['EXPORT'],
}

export function allowedEventsFor(state: State): readonly EventType[] {
  return ALLOWED[state]
}
```

- [ ] **Step 4: Run tests**

```bash
bun run test tests/state/states.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/states.ts tests/state/states.test.ts
git commit -m "feat(state): add State enum and allowed-events map"
```

---

## Task 17: State machine — pure reducer

**Files:**
- Create: `src/state/reducer.ts`
- Create: `tests/state/reducer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/state/reducer.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { reduce } from '@/state/reducer'
import type { State } from '@/state/states'

describe('reduce', () => {
  it('moves ingest → target on CONFIRM_INGEST after START_BLANK', () => {
    let s: State = 'ingest'
    s = reduce(s, { type: 'START_BLANK' })
    expect(s).toBe('ingest') // start_blank stays in ingest until confirm
    s = reduce(s, { type: 'CONFIRM_INGEST' })
    expect(s).toBe('target')
  })

  it('moves target → persona on SET_TARGET', () => {
    const s = reduce('target', {
      type: 'SET_TARGET',
      ctx: {
        targetRole: 'PM',
        targetSeniority: 'senior',
        persona: { archetype: 'vp-product', tone: 'curious' },
      },
    })
    expect(s).toBe('persona')
  })

  it('moves persona → gather on CONFIRM_PERSONA', () => {
    expect(reduce('persona', { type: 'CONFIRM_PERSONA' })).toBe('gather')
  })

  it('moves gather → critique once user signals via PROCEED_TO_GENERATE? no — via USER_MESSAGE in gather stays in gather', () => {
    expect(reduce('gather', { type: 'USER_MESSAGE', text: 'hi' })).toBe('gather')
  })

  it('END_INTERROGATION jumps directly to generate from any of gather/critique/finalReview', () => {
    expect(reduce('gather', { type: 'END_INTERROGATION' })).toBe('generate')
    expect(reduce('critique', { type: 'END_INTERROGATION' })).toBe('generate')
    expect(reduce('finalReview', { type: 'END_INTERROGATION' })).toBe('generate')
  })

  it('throws on disallowed event for current state', () => {
    expect(() =>
      reduce('ingest', { type: 'PROCEED_TO_GENERATE' }),
    ).toThrow(/not allowed/)
  })

  it('moves critique → finalReview on PROCEED_TO_GENERATE (handled in finalReview, not direct to generate)', () => {
    // The state machine deliberately routes critique → finalReview to give the
    // user an explicit "one final pass" step.
    expect(reduce('critique', { type: 'PROCEED_TO_GENERATE' })).toBe('finalReview')
  })

  it('moves finalReview → generate on PROCEED_TO_GENERATE', () => {
    expect(reduce('finalReview', { type: 'PROCEED_TO_GENERATE' })).toBe('generate')
  })

  it('moves generate → edit on PICK_TEMPLATE', () => {
    expect(reduce('generate', { type: 'PICK_TEMPLATE', templateId: 'x' })).toBe('edit')
  })

  it('moves edit → export on EXPORT', () => {
    expect(reduce('edit', { type: 'EXPORT', format: 'pdf' })).toBe('export')
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
bun run test tests/state/reducer.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement reducer**

Create `src/state/reducer.ts`:

```ts
import type { Event } from '@/schema/events'
import { allowedEventsFor, type State } from './states'

/**
 * Pure (state, event) → state. No I/O. Throws on illegal transitions so
 * callers (the orchestrator + tests) catch state-machine bugs loudly.
 */
export function reduce(state: State, event: Event): State {
  if (!allowedEventsFor(state).includes(event.type)) {
    throw new Error(
      `event ${event.type} not allowed in state ${state}`,
    )
  }

  // END_INTERROGATION is the universal escape hatch from gather/critique/finalReview.
  if (event.type === 'END_INTERROGATION') {
    return 'generate'
  }

  switch (state) {
    case 'ingest':
      if (event.type === 'CONFIRM_INGEST') return 'target'
      return 'ingest'
    case 'target':
      if (event.type === 'SET_TARGET') return 'persona'
      return 'target'
    case 'persona':
      if (event.type === 'CONFIRM_PERSONA' || event.type === 'OVERRIDE_PERSONA') {
        return 'gather'
      }
      return 'persona'
    case 'gather':
      // gather→critique happens via the orchestrator emitting CONFIRM_INGEST-like
      // internal event after gather is complete. For now, the only user-facing
      // exit from gather is END_INTERROGATION (handled above).
      return 'gather'
    case 'critique':
      if (event.type === 'PROCEED_TO_GENERATE') return 'finalReview'
      return 'critique'
    case 'finalReview':
      if (event.type === 'PROCEED_TO_GENERATE') return 'generate'
      return 'finalReview'
    case 'generate':
      if (event.type === 'PICK_TEMPLATE') return 'edit'
      return 'generate'
    case 'edit':
      if (event.type === 'EXPORT') return 'export'
      return 'edit'
    case 'export':
      return 'export'
  }
}
```

- [ ] **Step 4: Run tests**

```bash
bun run test tests/state/reducer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/reducer.ts tests/state/reducer.test.ts
git commit -m "feat(state): add pure reducer with universal END_INTERROGATION exit"
```

> Note: a `gather → critique` transition will be added in sub-plan 3 when the orchestrator emits an internal `BEGIN_CRITIQUE` event after gather completes. Tests for that transition will land with that event.

---

## Task 18: State machine — replay from history

**Files:**
- Create: `src/state/replay.ts`
- Create: `tests/state/replay.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/state/replay.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { replay } from '@/state/replay'
import type { Event } from '@/schema/events'

describe('replay', () => {
  it('returns ingest for an empty history', () => {
    expect(replay([])).toBe('ingest')
  })

  it('reaches gather after a typical opening sequence', () => {
    const events: Event[] = [
      { type: 'START_BLANK' },
      { type: 'CONFIRM_INGEST' },
      {
        type: 'SET_TARGET',
        ctx: {
          targetRole: 'PM',
          targetSeniority: 'senior',
          persona: { archetype: 'vp-product', tone: 'curious' },
        },
      },
      { type: 'CONFIRM_PERSONA' },
    ]
    expect(replay(events)).toBe('gather')
  })

  it('reaches generate after END_INTERROGATION mid-gather', () => {
    const events: Event[] = [
      { type: 'START_BLANK' },
      { type: 'CONFIRM_INGEST' },
      {
        type: 'SET_TARGET',
        ctx: {
          targetRole: 'PM',
          targetSeniority: 'senior',
          persona: { archetype: 'vp-product', tone: 'curious' },
        },
      },
      { type: 'CONFIRM_PERSONA' },
      { type: 'END_INTERROGATION' },
    ]
    expect(replay(events)).toBe('generate')
  })

  it('throws on the first illegal event', () => {
    const events: Event[] = [
      { type: 'START_BLANK' },
      { type: 'PROCEED_TO_GENERATE' }, // illegal from ingest
    ]
    expect(() => replay(events)).toThrow(/not allowed/)
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
bun run test tests/state/replay.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement replay**

Create `src/state/replay.ts`:

```ts
import type { Event } from '@/schema/events'
import { reduce } from './reducer'
import type { State } from './states'

export function replay(events: readonly Event[]): State {
  let state: State = 'ingest'
  for (const e of events) {
    state = reduce(state, e)
  }
  return state
}
```

- [ ] **Step 4: Run tests**

```bash
bun run test tests/state/replay.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/replay.ts tests/state/replay.test.ts
git commit -m "feat(state): add history replay to recover state from event log"
```

---

## Task 19: Hono server skeleton with /healthz

**Files:**
- Create: `src/server/index.ts`
- Create: `tests/server/index.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/server/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createApp } from '@/server/index'

describe('app', () => {
  it('responds 200 on /healthz with shape { ok: true, version: string }', async () => {
    const app = createApp()
    const res = await app.request('/healthz')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; version: string }
    expect(body.ok).toBe(true)
    expect(typeof body.version).toBe('string')
  })

  it('returns 404 on unknown routes', async () => {
    const app = createApp()
    const res = await app.request('/nope')
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
bun run test tests/server/index.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the Hono app**

Create `src/server/index.ts`:

```ts
import { Hono } from 'hono'
import packageJson from '../../package.json' with { type: 'json' }

export function createApp(): Hono {
  const app = new Hono()

  app.get('/healthz', (c) =>
    c.json({ ok: true, version: packageJson.version }),
  )

  return app
}

// Bun entry point — only runs when this file is executed directly.
if (import.meta.main) {
  const app = createApp()
  const port = Number(Bun.env.PORT ?? 4321)
  console.log(`resume-builder listening on http://127.0.0.1:${port}`)
  Bun.serve({
    port,
    hostname: '127.0.0.1',
    fetch: app.fetch,
  })
}
```

- [ ] **Step 4: Run tests**

```bash
bun run test tests/server/index.test.ts
```

Expected: PASS.

- [ ] **Step 5: Smoke-test the dev server**

```bash
bun run dev
```

Then in another terminal:

```bash
curl -s http://127.0.0.1:4321/healthz
```

Expected: `{"ok":true,"version":"0.1.0"}`

Stop the dev server with Ctrl-C.

- [ ] **Step 6: Commit**

```bash
git add src/server/index.ts tests/server/index.test.ts
git commit -m "feat(server): add Hono app with /healthz"
```

---

## Task 20: Integration test — wire everything end-to-end

**Files:**
- Create: `tests/integration/foundation.test.ts`

- [ ] **Step 1: Write the integration test**

Create `tests/integration/foundation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createDb } from '@/server/db/client'
import { createSessionRepo } from '@/server/db/repositories/sessions'
import { createHistoryRepo } from '@/server/db/repositories/history'
import { createModelCallsRepo } from '@/server/db/repositories/modelCalls'
import { replay } from '@/state/replay'
import type { Event } from '@/schema/events'

describe('foundation: end-to-end persistence and replay', () => {
  it('persists a session, appends events, and reconstructs state via replay', () => {
    const db = createDb(':memory:')
    const sessions = createSessionRepo(db)
    const history = createHistoryRepo(db)
    const calls = createModelCallsRepo(db)

    const sessionId = sessions.create({ state: 'ingest' })
    sessions.lockProvider(sessionId, 'claude')

    const events: Event[] = [
      { type: 'START_BLANK' },
      { type: 'CONFIRM_INGEST' },
      {
        type: 'SET_TARGET',
        ctx: {
          targetRole: 'PM',
          targetSeniority: 'senior',
          persona: { archetype: 'vp-product', tone: 'curious' },
        },
      },
      { type: 'CONFIRM_PERSONA' },
    ]

    for (const e of events) {
      history.append({ sessionId, role: 'user', event: e })
    }

    calls.record({
      sessionId,
      templateName: 'persona-propose',
      provider: 'claude',
      tier: 'main',
      tokensInEstimate: 800,
      tokensOutEstimate: 120,
      latencyMs: 1500,
      validationFailures: 0,
      verifierRejections: 0,
    })

    const persisted = history.listForSession(sessionId).map((r) => r.event)
    const finalState = replay(persisted)

    expect(finalState).toBe('gather')
    expect(calls.totalsForSession(sessionId).count).toBe(1)
    expect(sessions.get(sessionId)?.provider).toBe('claude')
  })
})
```

- [ ] **Step 2: Run all tests**

```bash
bun run test
```

Expected: every test in every file passes.

- [ ] **Step 3: Type-check the whole tree**

```bash
bun run type-check
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/foundation.test.ts
git commit -m "test(integration): end-to-end persistence + state replay"
```

---

## Task 21: Final foundation commit + tag

- [ ] **Step 1: Verify the working tree is clean**

```bash
git status
```

Expected: `nothing to commit, working tree clean`.

- [ ] **Step 2: Tag the foundation milestone**

```bash
git tag -a v0.1.0-foundation -m "Foundation: schema, db, state machine, server skeleton"
```

- [ ] **Step 3: Confirm tests + type-check pass on a clean checkout**

```bash
bun run test && bun run type-check
```

Expected: all green.

---

## Self-review

Reviewed against the original brief. Coverage check:

- ✅ Repository scaffolding (single Bun project, Tasks 1–3).
- ✅ Resume + TargetContext Zod schemas (Tasks 4–7).
- ✅ State machine reducer + history/event log persistence (Tasks 8, 14, 16–18).
- ✅ Telemetry `model_calls` table (Tasks 11, 15).
- ✅ Hono server skeleton (Task 19).
- ✅ Stub README + `.env.example` (Task 3) — full README deferred to sub-plan 7 as discussed.
- ✅ Integration smoke test (Task 20).

Out of scope (correctly deferred):

- Provider adapters → sub-plan 2.
- Prompt templates + verifier → sub-plans 2/3.
- React PDF templates + DOCX → sub-plan 5.
- CodeMirror editor + budget UI + provider-lock UI → sub-plan 6.
- `bun build --compile` + full README → sub-plan 7.

Type consistency checked: `ProviderName`, `Tier`, `State`, `Event`, `Resume`, `Bullet`, `FlagInstance`, `TargetContext` are referenced consistently across all tasks. `createDb`, `createSessionRepo`, `createHistoryRepo`, `createModelCallsRepo`, `createResumeRepo`, `replay`, `reduce` signatures match across their definitions and call sites.

No placeholders. No "implement later" steps. Every code step shows actual code; every test step shows actual assertions.

---

## Sequencing notes for sub-plans 2–7

After this plan executes cleanly, the next plan (sub-plan 2: thin slice) builds on:

- The `Resume` / `Bullet` / `FlagInstance` schemas as-is.
- The `Event` discriminated union — new internal events (`BEGIN_CRITIQUE`, `MODEL_TURN`) added there, not here.
- The `SessionRepo.lockProvider` / `incrementCalls` / `setSessionHandle` API.
- The `reduce` reducer, extended with the gather→critique transition once the corresponding event exists.
- The `model_calls` table for telemetry on first real model invocations.

Sub-plan 2's first task will be: implement the Claude adapter behind the shared `ProviderAdapter` interface (which lives in `src/prompts/adapters/types.ts` — created in sub-plan 2, not here).
