# Phase 2e — `/setup` screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `/setup` screen — paste a resume, fill target context, submit → land on a "session created" placeholder showing the session ID and snapshot. Demoable end-to-end via `bun run dev`.

**Architecture:** Bun HTML imports (no Vite, per project `CLAUDE.md`). React 19 + Tailwind v4 + shadcn-style primitives copied into the repo. The existing `createApp({ db, adapter })` factory remains framework-pure; a new `src/server/dev.ts` entry composes deps and starts `Bun.serve()` with the HTML import on `/` and Hono's `app.fetch` as the fall-through. Form schemas import directly from `src/server/schemas/routes.ts` so client/server validation cannot drift.

**Tech Stack:** Bun HTML imports + bundler, React 19, Tailwind v4 (`bun-plugin-tailwind`), React Hook Form + Zod (`@hookform/resolvers`), TanStack Query v5, lucide-react, happy-dom for component tests. No Vite, no Webpack, no shadcn CLI.

---

## Design decisions (resolved before tasks)

### D1. Bun HTML imports, not Vite

Project `CLAUDE.md` mandates `Bun.serve()` + HTML imports and explicitly forbids Vite. Bun's bundler handles `.tsx`, `.css`, and CSS-via-Tailwind through `bun-plugin-tailwind`. Single dev process, single port, single build pipeline.

### D2. Tailwind v4 via `bun-plugin-tailwind`

Tailwind v4 is the current stable line and integrates with Bun via the official plugin. Configured in `bunfig.toml` (the `[serve.static]` plugin slot) so the HTML import bundle picks up `@import 'tailwindcss'` in `styles.css`.

### D3. shadcn primitives copied manually — no CLI

The shadcn CLI assumes Vite or Next paths and writes `components.json` referencing those. We need 5 primitives only (Button, Input, Textarea, Label, Card). Copy them from the registry source into `src/client/components/ui/` and adjust imports to use the `@/*` path alias. Skip `components.json` entirely.

### D4. Path alias

The frontend reuses the existing `tsconfig.json` `@/*` → `src/*` alias. Bun's bundler honours `tsconfig` paths natively. `@/server/schemas/routes` resolves the same in both client and server code, so the form's Zod schema is literally the same object validated server-side.

### D5. Dev composition entry: `src/server/dev.ts`

`src/server/index.ts` keeps its `import.meta.main` guard and stays framework-pure (just `createApp`). A new `src/server/dev.ts` is the `bun run dev` entry. It:

1. Constructs `db = createDb(env.DATABASE_FILE ?? './dev.db')`
2. Constructs the adapter (stub for now; phase 2h wires the real Claude adapter behind an env flag)
3. Calls `createApp({ db, adapter })`
4. Starts `Bun.serve({ routes: { '/': index }, fetch: (req) => app.fetch(req), development: { hmr: true, console: true } })`

The HTML route is handled by Bun.serve directly (so the bundler runs); everything else falls through to Hono.

### D6. One screen, no client routing

Phase 2e is a single screen. No React Router, no client-side routing. After successful submit, the SetupScreen swaps its own internal state from `'form'` to `'created'` and renders the placeholder. Phase 2f introduces routing when there's a second screen to route to.

### D7. Adapter for dev: stub with a canned ingest response

The real Claude adapter requires an API key path resolution that's a 2h concern. For 2e, `dev.ts` constructs a `StubAdapter` whose `responses[0]` is a small canned ingested resume. The user can submit the form and see the round-trip work without an LLM. A `// TODO 2h: wire createClaudeAdapter` comment marks the swap point.

### D8. File upload deferred

The setup form exposes only paste-as-markdown for v2e. The server's `CreateSessionBody` already accepts `kind: 'blank'`; the UI will not surface that branch yet either. PDF/DOCX file upload is a 2g concern (it needs server-side parsing).

### D9. Form schema: import the server schema, don't redefine

`SetupScreen` imports `CreateSessionBody` from `@/server/schemas/routes` and parses the assembled payload inside `mutationFn`. The form's TS type for the assembled object is `z.infer<typeof CreateSessionBody>`. Drift impossible by construction.

### D10. Component testing strategy

`bun:test` + `happy-dom` for unit tests of pure components and the form's submit-handler logic. The full submit flow (mutation hits a real `app.fetch`) is exercised through one integration test that mounts `<SetupScreen />`, fills fields via `happy-dom`, and asserts a `fetch` mock is called with the right body. We do NOT test Tailwind class output or visual rendering — that's visual QA territory.

---

## File structure

**Created:**

```
bunfig.toml                                   # Tailwind plugin registration
tailwind.config.ts                            # content paths
src/client/index.html                         # HTML entry
src/client/main.tsx                           # React root + QueryClient
src/client/App.tsx                            # top-level (just SetupScreen for now)
src/client/styles.css                         # @import tailwindcss + theme tokens
src/client/lib/utils.ts                       # cn() helper
src/client/lib/queryClient.ts                 # singleton QueryClient
src/client/lib/api.ts                         # typed createSession()
src/client/components/ui/button.tsx           # shadcn Button
src/client/components/ui/input.tsx            # shadcn Input
src/client/components/ui/textarea.tsx         # shadcn Textarea
src/client/components/ui/label.tsx            # shadcn Label
src/client/components/ui/card.tsx             # shadcn Card
src/client/screens/SetupScreen.tsx            # the form + success placeholder
src/server/dev.ts                             # dev composition entry
tests/client/setupScreen.test.tsx             # component test (happy-dom)
tests/client/_dom.ts                          # happy-dom bootstrap helper
```

**Modified:**

```
package.json                                  # deps + dev script
docs/architecture-notes.md                    # append 2e notes
```

**Untouched (intentionally):**

- `src/server/index.ts` — stays framework-pure. Dev/prod composition is a separate file.
- `src/schema/*` — no changes.
- `src/orchestrator/*` — no changes.
- `src/server/routes/*` — no changes; the form posts to existing `POST /api/sessions`.

---

## Sequencing rationale

1. **T1 (deps):** establishes the React/Tailwind/Query toolchain so all later tasks compile.
2. **T2 (Tailwind config):** activates Tailwind processing for the bundler.
3. **T3 (shadcn primitives):** unblocks all UI tasks; once these exist, `SetupScreen` can be assembled.
4. **T4 (HTML entry + main.tsx + App):** minimum viable React mount, no form yet — verifies the bundler works.
5. **T5 (dev.ts composition):** lets `bun run dev` actually serve the page; the rest of the work happens in the browser.
6. **T6 (api.ts client):** isolated typed client + test.
7. **T7 (SetupScreen — form layer):** form fields + RHF wiring, full submit flow.
8. **T8 (component test):** locks the submit-payload contract.
9. **T9 (smoke test in browser):** visual + interactive verification.
10. **T10 (architecture notes):** document the dev composition + alias decisions for future phases.
11. **T11 (final verify):** type-check + full test run.

Each task ends with a commit (except T9 manual smoke and T11 verify-only). All commits build and type-check.

---

## Task 1: Add frontend dependencies and dev script

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install runtime + dev deps**

```bash
bun add react@^19 react-dom@^19 @tanstack/react-query@^5 react-hook-form@^7 @hookform/resolvers@^3 lucide-react@^0.460 class-variance-authority@^0.7 clsx@^2 tailwind-merge@^2
bun add -d @types/react@^19 @types/react-dom@^19 tailwindcss@^4 bun-plugin-tailwind@^0.0.15 happy-dom@^15
```

- [ ] **Step 2: Add `dev` script**

Edit `package.json` `scripts`:

```json
{
  "scripts": {
    "dev": "bun run --hot src/server/dev.ts",
    "test": "bun test",
    "test:watch": "bun test --watch",
    "type-check": "tsc --noEmit",
    "build": "echo 'see sub-plan 7' && exit 1"
  }
}
```

- [ ] **Step 3: Verify type-check still clean**

Run: `bun run type-check`
Expected: clean (no source code changed yet, only deps added).

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add frontend deps (react 19, tailwind v4, tanstack query, RHF)"
```

---

## Task 2: Tailwind config and global styles

**Files:**

- Create: `bunfig.toml`
- Create: `tailwind.config.ts`
- Create: `src/client/styles.css`

- [ ] **Step 1: `bunfig.toml`**

```toml
[serve.static]
plugins = ["bun-plugin-tailwind"]
```

- [ ] **Step 2: `tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss'

export default {
  content: ['./src/client/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
      },
    },
  },
  plugins: [],
} satisfies Config
```

- [ ] **Step 3: `src/client/styles.css`**

```css
@import 'tailwindcss';

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 222.2 84% 4.9%;
    --radius: 0.5rem;
  }

  body {
    @apply bg-background text-foreground;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  }
}
```

- [ ] **Step 4: Verify type-check**

Run: `bun run type-check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add bunfig.toml tailwind.config.ts src/client/styles.css
git commit -m "chore(client): tailwind v4 config + base theme tokens"
```

---

## Task 3: shadcn-style primitives + cn() helper

**Files:**

- Create: `src/client/lib/utils.ts`
- Create: `src/client/components/ui/button.tsx`
- Create: `src/client/components/ui/input.tsx`
- Create: `src/client/components/ui/textarea.tsx`
- Create: `src/client/components/ui/label.tsx`
- Create: `src/client/components/ui/card.tsx`

- [ ] **Step 1: `src/client/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 2: `src/client/components/ui/button.tsx`**

```tsx
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/client/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-muted hover:text-foreground',
        ghost: 'hover:bg-muted hover:text-foreground',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
)
Button.displayName = 'Button'
```

- [ ] **Step 3: `src/client/components/ui/input.tsx`**

```tsx
import * as React from 'react'
import { cn } from '@/client/lib/utils'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'
```

- [ ] **Step 4: `src/client/components/ui/textarea.tsx`**

```tsx
import * as React from 'react'
import { cn } from '@/client/lib/utils'

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'
```

- [ ] **Step 5: `src/client/components/ui/label.tsx`**

```tsx
import * as React from 'react'
import { cn } from '@/client/lib/utils'

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn('text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70', className)}
      {...props}
    />
  ),
)
Label.displayName = 'Label'
```

- [ ] **Step 6: `src/client/components/ui/card.tsx`**

```tsx
import * as React from 'react'
import { cn } from '@/client/lib/utils'

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('rounded-lg border bg-card text-card-foreground shadow-sm', className)} {...props} />
  ),
)
Card.displayName = 'Card'

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
  ),
)
CardHeader.displayName = 'CardHeader'

export const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-2xl font-semibold leading-none tracking-tight', className)} {...props} />
  ),
)
CardTitle.displayName = 'CardTitle'

export const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
  ),
)
CardDescription.displayName = 'CardDescription'

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
  ),
)
CardContent.displayName = 'CardContent'

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />
  ),
)
CardFooter.displayName = 'CardFooter'
```

- [ ] **Step 7: Verify type-check**

Run: `bun run type-check`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/client/lib/utils.ts src/client/components/ui/
git commit -m "feat(client): shadcn-style primitives (button, input, textarea, label, card)"
```

---

## Task 4: HTML entry + React mount + minimal App

**Files:**

- Create: `src/client/index.html`
- Create: `src/client/main.tsx`
- Create: `src/client/App.tsx`
- Create: `src/client/lib/queryClient.ts`
- Create: `src/client/screens/SetupScreen.tsx` (stub, replaced in T7)

- [ ] **Step 1: `src/client/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Resume Builder — Setup</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: `src/client/lib/queryClient.ts`**

```ts
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
})
```

- [ ] **Step 3: `src/client/main.tsx`**

```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import { queryClient } from './lib/queryClient'

const container = document.getElementById('root')
if (!container) throw new Error('#root not found')

createRoot(container).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
```

- [ ] **Step 4: `src/client/App.tsx`**

```tsx
import { SetupScreen } from './screens/SetupScreen'

export function App() {
  return (
    <main className="min-h-screen bg-background py-12">
      <SetupScreen />
    </main>
  )
}
```

- [ ] **Step 5: Stub `src/client/screens/SetupScreen.tsx`**

```tsx
export function SetupScreen() {
  return (
    <div className="mx-auto max-w-2xl px-4">
      <h1 className="text-3xl font-semibold">Resume Builder — Setup (stub)</h1>
    </div>
  )
}
```

- [ ] **Step 6: Verify type-check**

Run: `bun run type-check`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/client/index.html src/client/main.tsx src/client/App.tsx src/client/lib/queryClient.ts src/client/screens/SetupScreen.tsx
git commit -m "feat(client): React entry + QueryClient provider + SetupScreen stub"
```

---

## Task 5: Dev composition entry — `src/server/dev.ts`

**Files:**

- Create: `src/server/dev.ts`
- Create (only if type-check fails): `src/types/html.d.ts`

- [ ] **Step 1: `src/server/dev.ts`**

```ts
import index from '../client/index.html'
import { createApp } from './index'
import { createDb } from './db/client'
import type { ProviderAdapter } from '@/orchestrator/adapter'
import type { Resume } from '@/schema/resume'

const sampleIngest: Resume = {
  candidate: { name: 'Sample User', headline: 'Engineer', contact: {} },
  summary: 'Replace with your real resume.',
  roles: [
    {
      id: 'r1',
      company: 'Sample Corp',
      title: 'Engineer',
      startDate: '2022-01',
      endDate: 'present',
      bullets: [
        { id: 'b1', text: 'Built a thing.', metrics: [], skills: [] },
      ],
    },
  ],
  skills: [],
  education: [],
}

const stubAdapter: ProviderAdapter = {
  name: 'stub-dev',
  callInSession: async () => ({ type: 'ok', value: sampleIngest }),
}

const db = createDb(process.env.DATABASE_FILE ?? './dev.db')
const app = createApp({ db, adapter: stubAdapter })

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: { '/': index },
  fetch: (req) => app.fetch(req),
  development: { hmr: true, console: true },
})

console.log(`▶ resume-builder dev server: http://localhost:${server.port}`)
console.log('  (using stub adapter — TODO 2h: wire createClaudeAdapter)')
```

- [ ] **Step 2: Verify the imports resolve**

Run: `bun run type-check`
Expected: clean. If `import index from '../client/index.html'` errors, create `src/types/html.d.ts`:

```ts
declare module '*.html' {
  const html: import('bun').HTMLBundle
  export default html
}
```

(Bun's `bun-types` may already declare this. Only create if needed.)

- [ ] **Step 3: Verify the actual `Resume` and `ProviderAdapter` shapes**

Before running, sanity-check:

```bash
grep -n "callInSession" src/orchestrator/adapter.ts
grep -n "candidate\|roles\|bullets" src/schema/resume.ts | head -20
```

Expected: confirms the field names used in `sampleIngest` match. If the `ProviderAdapter` interface has additional required fields beyond `name` and `callInSession`, add them to the stub. (As of phase 2c the interface is exactly these two.)

- [ ] **Step 4: Smoke-test the dev server**

Run: `bun run dev`
Expected: console logs the URL. Open in a browser; confirm the stub heading "Resume Builder — Setup (stub)" renders. Stop with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add src/server/dev.ts
# (and src/types/html.d.ts if created)
git commit -m "feat(server): dev composition entry with stub adapter"
```

---

## Task 6: Typed API client — `createSession()`

**Files:**

- Create: `src/client/lib/api.ts`
- Create: `tests/client/_dom.ts`
- Create: `tests/client/api.test.ts`

- [ ] **Step 1: `src/client/lib/api.ts`**

```ts
import type { CreateSessionBody } from '@/server/schemas/routes'
import type { Resume } from '@/schema/resume'

export interface CreateSessionResponse {
  id: number
  snapshot: { state: string; modelCallsMade: number }
  resume: Resume
}

export interface ApiError extends Error {
  status: number
  code?: string
}

export async function createSession(body: CreateSessionBody): Promise<CreateSessionResponse> {
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null
    const err: ApiError = Object.assign(new Error(errBody?.error?.message ?? `HTTP ${res.status}`), {
      status: res.status,
      code: errBody?.error?.code,
    })
    throw err
  }
  return (await res.json()) as CreateSessionResponse
}
```

- [ ] **Step 2: `tests/client/_dom.ts`**

```ts
import { GlobalRegistrator } from 'happy-dom/lib/global-registrator/GlobalRegistrator.js'

let registered = false
export function ensureDom(): void {
  if (registered) return
  GlobalRegistrator.register()
  registered = true
}
```

- [ ] **Step 3: `tests/client/api.test.ts`**

```ts
import { describe, it, expect, afterEach } from 'bun:test'
import { ensureDom } from './_dom'

ensureDom()

import { createSession } from '@/client/lib/api'

const realFetch = globalThis.fetch

describe('createSession', () => {
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('POSTs JSON to /api/sessions and returns parsed response', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(
        JSON.stringify({
          id: 7,
          snapshot: { state: 'critique', modelCallsMade: 1 },
          resume: { candidate: { name: 'X', contact: {} }, roles: [], skills: [], education: [] },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch

    const res = await createSession({
      resume: { kind: 'markdown', text: '# hi' },
      target: {
        targetRole: 'Engineer',
        targetSeniority: 'senior',
        persona: { archetype: 'engineering-manager', tone: 'skeptical' },
      },
    })

    expect(captured?.url).toBe('/api/sessions')
    expect(captured?.init.method).toBe('POST')
    expect(res.id).toBe(7)
    expect(res.snapshot.state).toBe('critique')
  })

  it('throws ApiError with status + code on 4xx', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { code: 'validation', message: 'bad' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch

    await expect(
      createSession({
        resume: { kind: 'markdown', text: '' },
        target: {
          targetRole: 'Engineer',
          targetSeniority: 'senior',
          persona: { archetype: 'engineering-manager', tone: 'skeptical' },
        },
      }),
    ).rejects.toMatchObject({ status: 400, code: 'validation' })
  })
})
```

- [ ] **Step 4: Run the test**

```bash
bun test tests/client/api.test.ts
```

Expected: 2/2 pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/api.ts tests/client/_dom.ts tests/client/api.test.ts
git commit -m "feat(client): typed createSession API client + tests"
```

---

## Task 7: SetupScreen — full form + submit + success placeholder

**Files:**

- Modify: `src/client/screens/SetupScreen.tsx` (replace stub)

- [ ] **Step 1: Replace stub**

```tsx
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { CreateSessionBody } from '@/server/schemas/routes'
import { Archetype, Tone, Seniority } from '@/schema/target'
import { createSession, type CreateSessionResponse, type ApiError } from '@/client/lib/api'
import { Button } from '@/client/components/ui/button'
import { Input } from '@/client/components/ui/input'
import { Textarea } from '@/client/components/ui/textarea'
import { Label } from '@/client/components/ui/label'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/client/components/ui/card'

type FormValues = {
  resumeText: string
  targetRole: string
  targetSeniority: (typeof Seniority._def.values)[number]
  industry: string
  jobDescription: string
  archetype: (typeof Archetype._def.values)[number]
  tone: (typeof Tone._def.values)[number]
}

export function SetupScreen() {
  const [created, setCreated] = useState<CreateSessionResponse | null>(null)

  const form = useForm<FormValues>({
    defaultValues: {
      resumeText: '',
      targetRole: '',
      targetSeniority: 'senior',
      industry: '',
      jobDescription: '',
      archetype: 'engineering-manager',
      tone: 'skeptical',
    },
  })

  const mutation = useMutation<CreateSessionResponse, ApiError, FormValues>({
    mutationFn: async (values) => {
      const body = {
        resume: { kind: 'markdown' as const, text: values.resumeText },
        target: {
          targetRole: values.targetRole,
          targetSeniority: values.targetSeniority,
          industry: values.industry || undefined,
          jobDescription: values.jobDescription || undefined,
          persona: { archetype: values.archetype, tone: values.tone },
        },
      }
      const parsed = CreateSessionBody.parse(body)
      return createSession(parsed)
    },
    onSuccess: (res) => setCreated(res),
  })

  if (created) {
    const bulletCount = created.resume.roles.reduce((n, r) => n + r.bullets.length, 0)
    return (
      <div className="mx-auto max-w-2xl px-4">
        <Card>
          <CardHeader>
            <CardTitle>Session created</CardTitle>
            <CardDescription>
              Session ID: {created.id} — state: {created.snapshot.state}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              Ingested {created.resume.roles.length} role(s) with {bulletCount} bullet(s).
            </p>
            <p className="text-muted-foreground">Critique view arrives in phase 2f.</p>
          </CardContent>
          <CardFooter>
            <Button variant="outline" onClick={() => setCreated(null)}>
              Start over
            </Button>
          </CardFooter>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4">
      <Card>
        <CardHeader>
          <CardTitle>Start a critique session</CardTitle>
          <CardDescription>Paste your resume in markdown, choose a target, and submit.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            id="setup-form"
            className="space-y-6"
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
          >
            <div className="space-y-2">
              <Label htmlFor="resumeText">Resume (markdown)</Label>
              <Textarea
                id="resumeText"
                rows={10}
                placeholder="# Jane Doe&#10;Senior Engineer..."
                {...form.register('resumeText', { required: true, minLength: 1 })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="targetRole">Target role</Label>
                <Input
                  id="targetRole"
                  placeholder="Staff Engineer"
                  {...form.register('targetRole', { required: true })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="targetSeniority">Seniority</Label>
                <select
                  id="targetSeniority"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  {...form.register('targetSeniority')}
                >
                  {Seniority._def.values.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="industry">Industry (optional)</Label>
              <Input id="industry" placeholder="Fintech" {...form.register('industry')} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="jobDescription">Job description (optional)</Label>
              <Textarea id="jobDescription" rows={4} {...form.register('jobDescription')} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="archetype">Interviewer archetype</Label>
                <select
                  id="archetype"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  {...form.register('archetype')}
                >
                  {Archetype._def.values.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tone">Tone</Label>
                <select
                  id="tone"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  {...form.register('tone')}
                >
                  {Tone._def.values.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {mutation.isError ? (
              <p className="text-sm text-destructive">
                {mutation.error.code ?? 'error'}: {mutation.error.message}
              </p>
            ) : null}
          </form>
        </CardContent>
        <CardFooter>
          <Button type="submit" form="setup-form" disabled={mutation.isPending}>
            {mutation.isPending ? 'Creating session…' : 'Start critique'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
```

> **Why no `zodResolver(CreateSessionBody)`:** the form fields are flat (`resumeText`, `targetRole`, …) for layout reasons; `CreateSessionBody` is nested. Assembling and parsing inside `mutationFn` keeps the form layout independent of the wire schema while still validating against it on submit. A parse failure throws and surfaces via `mutation.error`.

- [ ] **Step 2: Verify type-check**

Run: `bun run type-check`
Expected: clean.

- [ ] **Step 3: Smoke-check the form renders**

Run: `bun run dev`. Open the page. All fields visible, button reads "Start critique". Don't submit yet — covered by T8/T9.

- [ ] **Step 4: Commit**

```bash
git add src/client/screens/SetupScreen.tsx
git commit -m "feat(client): SetupScreen form + submit + success placeholder"
```

---

## Task 8: Component test — submit payload contract

**Files:**

- Create: `tests/client/setupScreen.test.tsx`

This test mounts `SetupScreen`, fills required fields, submits, and asserts the `fetch` call body matches `CreateSessionBody`. It locks the contract between the form and the server schema.

- [ ] **Step 1: `tests/client/setupScreen.test.tsx`**

```tsx
import { describe, it, expect, afterEach } from 'bun:test'
import { ensureDom } from './_dom'

ensureDom()

import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SetupScreen } from '@/client/screens/SetupScreen'
import { CreateSessionBody } from '@/server/schemas/routes'

const realFetch = globalThis.fetch

describe('<SetupScreen />', () => {
  afterEach(() => {
    globalThis.fetch = realFetch
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild)
  })

  async function mount(): Promise<Root> {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <SetupScreen />
        </QueryClientProvider>,
      )
    })
    return root
  }

  function setVal(id: string, value: string): void {
    const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  it('submits a payload that satisfies CreateSessionBody', async () => {
    let capturedBody: unknown = null
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(String(init.body))
      return new Response(
        JSON.stringify({
          id: 1,
          snapshot: { state: 'critique', modelCallsMade: 1 },
          resume: { candidate: { name: 'X', contact: {} }, roles: [], skills: [], education: [] },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch

    await mount()

    await act(async () => {
      setVal('resumeText', '# Jane Doe\nEngineer')
      setVal('targetRole', 'Staff Engineer')
    })

    await act(async () => {
      const formEl = document.getElementById('setup-form') as HTMLFormElement
      formEl.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(capturedBody).not.toBeNull()
    const parsed = CreateSessionBody.safeParse(capturedBody)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.resume).toEqual({ kind: 'markdown', text: '# Jane Doe\nEngineer' })
      expect(parsed.data.target.targetRole).toBe('Staff Engineer')
      expect(parsed.data.target.persona.archetype).toBe('engineering-manager')
      expect(parsed.data.target.persona.tone).toBe('skeptical')
    }
  })

  it('shows the success card after a successful response', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          id: 42,
          snapshot: { state: 'critique', modelCallsMade: 1 },
          resume: {
            candidate: { name: 'X', contact: {} },
            roles: [
              {
                id: 'r1',
                company: 'C',
                title: 'T',
                startDate: '2020-01',
                endDate: 'present',
                bullets: [{ id: 'b1', text: 'x', metrics: [], skills: [] }],
              },
            ],
            skills: [],
            education: [],
          },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch

    await mount()
    await act(async () => {
      setVal('resumeText', '# Hi')
      setVal('targetRole', 'Engineer')
    })
    await act(async () => {
      const formEl = document.getElementById('setup-form') as HTMLFormElement
      formEl.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(document.body.textContent).toContain('Session created')
    expect(document.body.textContent).toContain('Session ID: 42')
  })
})
```

> **`act` import note:** React 19 moves `act` from `react-dom/test-utils` to `react`. If the import line errors on your Bun + React 19 install, swap to `import { act } from 'react-dom/test-utils'`. Run the import once with the React 19 path; only fall back if it fails.

- [ ] **Step 2: Run the test**

```bash
bun test tests/client/setupScreen.test.tsx
```

Expected: 2/2 pass.

- [ ] **Step 3: Run the full suite**

```bash
bun test
```

Expected: phase 2d's 235 + 1 skipped + new client tests all pass.

- [ ] **Step 4: Commit**

```bash
git add tests/client/setupScreen.test.tsx
git commit -m "test(client): SetupScreen submit payload contract + success state"
```

---

## Task 9: Browser smoke test (manual verify, no commit)

- [ ] **Step 1: Start dev server**

```bash
bun run dev
```

Expected: console prints `▶ resume-builder dev server: http://localhost:3000` and `(using stub adapter — TODO 2h: wire createClaudeAdapter)`.

- [ ] **Step 2: Verify GET /**

```bash
curl -s http://localhost:3000/ | head -5
```

Expected: HTML output starting with `<!doctype html>` and including `<div id="root">`.

- [ ] **Step 3: Verify GET /healthz**

```bash
curl -s http://localhost:3000/healthz
```

Expected: `{"ok":true,"version":"0.1.0"}`.

- [ ] **Step 4: Open the page**

Navigate to `http://localhost:3000/`. Verify:
- Card renders with title "Start a critique session".
- All form fields render.
- Tailwind styles apply (rounded corners, spacing, focus rings).

- [ ] **Step 5: Submit the form**

Fill:
- Resume: `# Jane Doe\nEngineer at FooCorp`
- Target role: `Staff Engineer`
- Defaults for the rest.

Click "Start critique". Expected:
- Success card replaces the form.
- "Session ID: 1" (or similar) and "state: critique".
- "Ingested 1 role(s) with 1 bullet(s)." (matches the stub adapter's canned response.)

- [ ] **Step 6: Stop the server**

`Ctrl+C`.

If anything in steps 1–5 fails, file a fix as a follow-up commit before continuing.

---

## Task 10: Architecture notes

**Files:**

- Modify: `docs/architecture-notes.md`

- [ ] **Step 1: Append three entries to the bottom of the file**

```md
## Phase 2e — Frontend composition

### Bun HTML imports as the single bundler

`src/client/index.html` is imported into `src/server/dev.ts` and mounted at `/` via `Bun.serve({ routes: { '/': index }, fetch: (req) => app.fetch(req) })`. Bun's bundler handles `.tsx`, `.css`, and Tailwind processing through `bun-plugin-tailwind` (configured in `bunfig.toml`). No Vite, no Webpack, no separate dev server, no proxy.

**Why:** Project `CLAUDE.md` mandates Bun-native tooling. Composing the HTML route under `Bun.serve` instead of inside Hono lets the bundler do its thing on the static asset while Hono retains full control of `/api/*`.

### Dev composition lives in `dev.ts`, not `index.ts`

`src/server/index.ts` exports `createApp({ db, adapter })` and nothing more — it stays framework-pure for both production composition (phase 2h) and tests (`buildTestApp`). `src/server/dev.ts` is the `bun run dev` entry that constructs concrete deps (sqlite db + stub adapter for now), serves the HTML bundle, and starts `Bun.serve`.

**Why:** Composition is environment-specific. Keeping `createApp` pure means tests don't pay any cost for prod-only concerns, and dev/prod can diverge cleanly.

### Form schema imports server schema directly

`SetupScreen` imports `CreateSessionBody` from `@/server/schemas/routes` and parses the assembled payload inside the mutation function. The form fields are flat (resumeText, targetRole, …) for layout reasons; the parse step assembles them into the nested wire shape and surfaces validation failures through `mutation.error`.

**Why:** A single Zod schema next to the route handler is the source of truth. Re-deriving a client schema would create drift potential. Bun honours `tsconfig` `paths`, so `@/server/...` resolves identically in client and server bundles.
```

- [ ] **Step 2: Commit**

```bash
git add docs/architecture-notes.md
git commit -m "docs: append phase 2e composition notes"
```

---

## Task 11: Final verification (no commit)

- [ ] **Step 1: Type-check**

```bash
bun run type-check
```

Expected: clean.

- [ ] **Step 2: Full test suite**

```bash
bun test
```

Expected: phase 2d's 235 + 1 skipped + new client tests (≥ 4) all pass.

- [ ] **Step 3: Build script**

`build` remains the placeholder `echo 'see sub-plan 7' && exit 1` from earlier phases. Do NOT change it here — production bundling is a phase 2g concern.

- [ ] **Step 4: Verify dev server one more time**

```bash
bun run dev
```

Open the page, submit the form, see the success card. Stop with Ctrl+C.

---

## Out of scope (deferred)

- **2f:** Critique screen — flag list, bullet diff view, accept/skip/dismiss/rewrite UI, SSE streaming wiring, client-side routing for `/sessions/:id`, navigation from setup→critique.
- **2g:** PDF export UI button + download flow; file upload (PDF/DOCX) on the setup screen.
- **2h:** Production composition (`src/server/prod.ts`), real Claude adapter wiring with API key resolution, env validation, `bun build` for the client bundle.
- **2i:** Auth, persistent users, session list UI.

---

## Self-review notes

- **Spec coverage:** Spec §7.1 calls for paste-resume + target-context form on `/setup`. Covered by T7. Spec §9.2 wire format `POST /api/sessions` exists from 2d; this plan only consumes it. ✓
- **Placeholder scan:** No "TBD"/"TODO" steps in task bodies; all code is concrete. The `// TODO 2h:` marker in `dev.ts` is intentional and labels a future phase boundary. ✓
- **Type consistency:** `CreateSessionBody`, `Archetype`, `Tone`, `Seniority` references match `src/server/schemas/routes.ts` and `src/schema/target.ts` verified before writing. `ProviderAdapter` interface match (`name` + `callInSession`) verified against `src/orchestrator/adapter.ts`. `Resume` shape in `dev.ts`'s `sampleIngest` matches the schema (id strings, `metrics`/`skills` arrays, `startDate`/`endDate`, `candidate.contact` object). ✓
- **Risks:**
  1. `bun-plugin-tailwind` is pre-1.0 (`0.0.x`). If `bunfig.toml`'s `[serve.static].plugins` form doesn't pick it up, fallback is registering the plugin in `Bun.serve({ ..., development: { plugins: [tailwindPlugin()] } })` directly. T9 step 4 (visual verification) catches this; if Tailwind classes don't apply, retry with the inline-plugin form before continuing.
  2. React 19 + `act` import — T8 documents the fallback path.
  3. The stub adapter in `dev.ts` returns the same canned resume regardless of input. Acceptable for 2e; users testing the stream path in 2f will need a richer stub or the real adapter.

---

## Execution handoff

After saving this plan and committing it:

1. **Subagent-driven execution (recommended):** one subagent per task, two-stage review.
2. **Inline executing-plans:** if context budget is tight.

Plan complete. Next: dispatch implementer for Task 1.
