# Resume Builder — UI Design Spec

**For Claude Design.** This document specifies the complete visual redesign of the resume builder app. The codebase uses React 19 + Vite + Tailwind CSS + shadcn/ui. All shadcn components (`Select`, `Badge`, `Separator`, `Progress`, `Tooltip`, `Dialog`, `Tabs`) are available but not yet installed/used. Implement using those primitives.

---

## 0. Design language

**Theme:** Dark-mode first. Minimalist with precision. The product is for professionals; it should feel like a tool, not a marketing site.

**Palette:**
- Background: `zinc-950` (`#09090b`)
- Surface (cards, panels): `zinc-900` (`#18181b`)
- Surface raised (hover, active): `zinc-800` (`#27272a`)
- Border: `zinc-800` with 60% opacity
- Primary accent: `violet-500` (`#8b5cf6`) — used for CTAs, active states, progress
- Destructive/error: `red-500`
- Warning (severity 3 flags): `amber-500`
- Success/refined: `emerald-500`
- Text primary: `zinc-50`
- Text secondary: `zinc-400`
- Text muted: `zinc-600`

**Typography:**
- Font: `Inter` (system fallback: `ui-sans-serif`) — already standard in Tailwind
- Heading (h1): `text-2xl font-semibold tracking-tight`
- Subheading (h2): `text-base font-medium text-zinc-400`
- Body: `text-sm text-zinc-300`
- Label: `text-xs font-medium tracking-wide uppercase text-zinc-500`
- Monospace (bullet text): `font-mono text-sm`

**Radius:** `rounded-xl` for cards, `rounded-lg` for inputs and buttons, `rounded-full` for badges/pills.

**Shadows:** Subtle — `shadow-[0_0_0_1px_rgba(255,255,255,0.06)]` on cards. No drop shadows.

**Motion:** `transition-colors duration-150` on interactive elements. `transition-all duration-200` on flag cards entering/exiting.

---

## 1. Global shell

A single full-viewport layout. No sidebar navigation (single-purpose tool).

```
┌─────────────────────────────────────────────────────┐
│  ● resume builder          [provider badge]  [calls] │  ← topbar 48px
├─────────────────────────────────────────────────────┤
│                                                     │
│              <page content>                         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Topbar:**
- Left: `● resume builder` — the dot is `violet-500`, text is `zinc-300 text-sm font-medium`
- Right (session screen only): provider badge (`zinc-800` bg, `zinc-400` text, e.g. "codex") + model calls counter (`text-zinc-500 text-xs`, e.g. "3 / 60 calls")
- Background: `zinc-950` with a 1px bottom border `zinc-800/60`
- Height: `h-12`

---

## 2. Setup screen (`/setup`)

Full-page centered layout. Max width `680px`. Vertically centered in viewport.

### 2a. Page header

```
  Resume Interrogator
  Defend every bullet. Export what survives.
```

- Title: `text-3xl font-bold text-zinc-50 tracking-tight`
- Subtitle: `text-zinc-500 text-sm mt-1`
- Top margin from topbar: `mt-16`
- Below header: `mt-10` to the form

### 2b. Resume input section

**Label row:**
```
  RESUME INPUT                           [PDF] [Markdown] [Blank]
```

Three tab pills (`rounded-full px-3 py-1 text-xs font-medium`):
- Inactive: `bg-zinc-800 text-zinc-400`
- Active: `bg-violet-500/20 text-violet-400 border border-violet-500/40`

**PDF tab (active state):**

A drop zone card:
```
┌─────────────────────────────────────────────────────┐
│                                                     │
│   ↑   Drop your PDF here, or click to browse       │
│       .pdf up to 10 MB                             │
│                                                     │
└─────────────────────────────────────────────────────┘
```
- Background: `zinc-900`
- Border: `border-2 border-dashed border-zinc-700` → on hover/drag-over: `border-violet-500/60 bg-violet-500/5`
- Border radius: `rounded-xl`
- Height: `h-36`
- Icon: a simple upload arrow SVG in `zinc-600`, 24px, centered
- Primary text: `text-sm text-zinc-400`
- Sub text: `text-xs text-zinc-600 mt-1`
- When file is picked: replace content with filename chip
  ```
  ┌─────────────────────────────────────────────────────┐
  │  📄 vivek_resume.pdf    34 KB    [✕ Remove]         │
  └─────────────────────────────────────────────────────┘
  ```
  - Filename: `text-sm text-zinc-300 font-medium`
  - Size: `text-xs text-zinc-600`
  - Remove button: `text-xs text-zinc-500 hover:text-red-400 transition-colors`

**Markdown tab (active state):**

A textarea with `font-mono text-sm text-zinc-300` on `zinc-900` background. Placeholder text shows a truncated resume example in `zinc-700`. Height: `min-h-[180px]`.

**Blank tab:** Just shows a helper note: `"You'll build your resume from scratch during the session."` in `text-sm text-zinc-500 italic`.

### 2c. Target context

Two columns:
```
  Target role [________________________]   Seniority [▾ senior      ]
```

Use shadcn `Input` for Target role. Use shadcn `Select` (not a raw `<select>`) for Seniority.

Below: `Industry (optional)` — single `Input`, full width.

Below: `Job description (optional)` — a `Textarea` `min-h-[100px]` with placeholder text `"Paste the job posting to calibrate the interviewer's standards..."`.

### 2d. Persona section

**Header row:**
```
  INTERVIEWER PERSONA                    [✦ Suggest from JD]
```
- Section label style (SCREAMING_SNAKE rendered as uppercase): `text-xs font-medium tracking-widest text-zinc-600 uppercase`
- Suggest button: `variant="ghost"` in `text-violet-400 hover:text-violet-300 text-sm`, with a sparkle icon (✦ or equivalent SVG)
- Disabled state when no target role entered: `opacity-40 cursor-not-allowed`
- Loading state: spinner + `"Analyzing JD…"`

Two shadcn `Select` pickers side by side:

**Archetype picker** — options with descriptions shown in the dropdown:
```
  engineering-manager   ─  Focused on delivery, team, outcomes
  director-of-eng       ─  Scale, org design, cross-functional
  tech-recruiter        ─  Keywords, ATS patterns, signals
  vp-product            ─  Narrative, strategy, user impact
  founder               ─  Speed, leverage, ROI
  staff-ic              ─  Technical depth, systems thinking
  department-head       ─  Budget, headcount, cross-org
```
Each option shows `key` in `zinc-200` + description in `zinc-500 text-xs` below it.

**Tone picker:**
```
  skeptical     ─  Default. Challenges vague claims.
  curious       ─  Probes to understand, not attack.
  adversarial   ─  Hardening mode. Assumes the worst.
  coaching      ─  Constructive. Focuses on improvement.
```

When persona is AI-suggested, show a `Badge` below the pickers:
```
  ✦ AI suggested: "Engineering Manager + skeptical"
  "Based on the JD's emphasis on delivery and cross-team work."
```
Badge: `bg-violet-500/10 border border-violet-500/30 text-violet-400 text-xs px-2 py-1 rounded-full`

### 2e. Submit

One full-width primary button: `"Start interrogation →"` — `bg-violet-600 hover:bg-violet-500 text-white rounded-lg h-11 text-sm font-medium`

Loading state: `"Setting up session…"` with a spinner replacing the arrow.

Error state: a `text-red-400 text-sm` error message above the button (not a toast).

---

## 3. Session screen — Gather phase

This screen appears after session creation when gather is enabled, before critique runs.

Max width `560px`, centered. Shows one role at a time.

```
  ┌─────────────────────────────────────────────────────┐
  │  Step 1 of 3: Senior Engineer at Acme Corp          │
  │  ──────────────────────────────────────────────     │
  │                                                     │
  │  The interviewer asks:                              │
  │                                                     │
  │  "What was the most impactful project you           │
  │   shipped at Acme? Walk me through the scope        │
  │   and the outcome."                                 │
  │                                                     │
  │  [_______________________________________________]  │
  │  [_______________________________________________]  │
  │  [_______________________________________________]  │
  │                                                     │
  │  [Skip this role]              [Submit answer →]   │
  └─────────────────────────────────────────────────────┘
```

- Card background: `zinc-900` with `rounded-2xl`
- Step indicator: `text-xs text-zinc-600 font-medium tracking-wide` above the separator
- Question text: `text-base text-zinc-200 leading-relaxed`
- Textarea: `min-h-[120px]` with `font-mono`
- Skip: `variant="ghost" text-zinc-500`
- Submit: primary violet

Progress bar across the top of the card (shadcn `Progress`): fills as roles complete. `bg-violet-600` fill on `zinc-800` track.

---

## 4. Session screen — Critique phase

**Two-pane layout.** This is the core of the product.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Session 12  ·  critique                [Export PDF]  [End session]  │
├───────────────────────────────┬──────────────────────────────────────┤
│                               │                                      │
│  RESUME PREVIEW               │  FLAG INBOX  (3 remaining)           │
│  ─────────────────────────    │  ─────────────────────────           │
│                               │                                      │
│  Jane Doe                     │  ┌────────────────────────────────┐  │
│  jane@example.com             │  │  ◈ vague · severity 2          │  │
│                               │  │  ─────────────────────────     │  │
│  Senior Engineer at Acme      │  │  "Led improvements to the CI    │  │
│  2022–2024                    │  │  pipeline"                      │  │
│  • [highlighted] Led          │  │                                 │  │
│    improvements to the CI     │  │  The interviewer says:          │  │
│    pipeline                   │  │  "What specifically changed?    │  │
│  • Worked with a team of 5    │  │  'Led improvements' could mean  │  │
│    to redesign the onboarding │  │  anything from writing a doc    │  │
│                               │  │  to rewriting the runtime."     │  │
│  Product Manager at Beta      │  │                                 │  │
│  2019–2022                    │  │  [Rewrite]  [Edit myself]       │  │
│  • ...                        │  │  [Stand by it ↓]                │  │
│                               │  └────────────────────────────────┘  │
│                               │                                      │
│                               │  ← 1/3 →                             │
│                               │                                      │
│                               │  [Run critique]                      │
└───────────────────────────────┴──────────────────────────────────────┘
```

**Left pane — Resume preview:**
- `flex-1 min-w-0` — takes remaining space
- Background: `zinc-950` (same as page)
- Content: structured resume rendered as clean text (NOT a PDF preview iframe — it's a styled HTML representation matching the Gold Standard template's typography hierarchy)
- Bullet being flagged: highlight with `bg-violet-500/10 border-l-2 border-violet-500 pl-2 -ml-2 rounded-sm`
- All other bullets: dimmed slightly when a flag card is active (`opacity-60 transition-opacity`)
- Clicking a bullet jumps the flag inbox to that flag

**Right pane — Flag inbox:**
- Width: `w-[380px] shrink-0`
- Background: `zinc-900`
- Border left: `border-l border-zinc-800`
- Padding: `p-5`

**Section header row:**
```
  FLAG INBOX   3 remaining            [◀] [▶]
```
- Label: uppercase micro label style
- Count: `text-zinc-500 text-xs`
- Prev/next: `IconButton` `h-7 w-7 rounded-md bg-zinc-800 text-zinc-400`

**Flag card (the focused one):**

```
┌────────────────────────────────┐
│  ◈ vague                  ●●○  │   ← flag type + severity dots
│  ────────────────────────────  │
│                                │
│  "Led improvements to the CI   │
│  pipeline"                     │   ← original span, zinc-400 italic
│                                │
│  The interviewer says:         │   ← zinc-600 label
│  "What specifically changed?   │   ← zinc-200 body text
│  ..."                          │
│                                │
│  ────────────────────────────  │
│  [✦ Rewrite]  [✎ Edit myself] │
│  [Stand by it ▾]               │
└────────────────────────────────┘
```

- Card: `bg-zinc-800/60 rounded-xl border border-zinc-700/60 p-4`
- Flag type label: `text-sm font-semibold text-zinc-200`
- Severity dots: 3 dots, filled = `bg-violet-500`, empty = `bg-zinc-700`, `w-2 h-2 rounded-full`
  - Severity 3: amber dots instead of violet
- Span text: `text-sm text-zinc-500 italic`
- Interviewer label: `text-xs text-zinc-600 uppercase tracking-wide mt-3`
- Interviewer text: `text-sm text-zinc-200 leading-relaxed`

**Action buttons:**

Primary row:
- `✦ Rewrite` — `bg-violet-600 hover:bg-violet-500 text-white rounded-lg` (if flag supports rewrite)
- `✎ Edit myself` — `variant="outline" border-zinc-700 text-zinc-300 hover:text-zinc-100`
- `✓ Accept` (after manual edit is saved) — `bg-emerald-600 hover:bg-emerald-500`

Secondary row:
- `Stand by it ▾` — ghost button, `text-zinc-500 hover:text-zinc-300` — expands a confirmation area below
  - For severity 3: `text-amber-500 hover:text-amber-400`
  - Expanded: shows `"Are you sure? This is a strong claim the interviewer finds unsupported."` + `[Yes, I stand by it]` button in amber

**Rewrite candidates panel** (appears below flag card when Rewrite is clicked):

```
┌────────────────────────────────┐
│  2 rewrites generated          │
│                                │
│  A  Built a 6-stage CI         │
│     pipeline that cut flake    │
│     from 18% to 2%             │
│                    [Use this]  │
│                                │
│  B  Redesigned the CI system   │
│     to eliminate flaky tests   │
│     entirely                   │
│                    [Use this]  │
│                                │
│  [✎ Edit a version instead]   │
└────────────────────────────────┘
```
- Candidate label (A/B): `text-xs font-bold text-zinc-500 w-4 shrink-0`
- Candidate text: `text-sm text-zinc-200 leading-relaxed`
- `Use this`: `text-xs text-violet-400 hover:text-violet-300 underline-offset-2 hover:underline`

**Edit myself panel** (appears when Edit is clicked):

```
┌────────────────────────────────┐
│  Edit this bullet              │
│                                │
│  [____________________________]│
│  [____________________________]│
│                                │
│              [Save and accept] │
└────────────────────────────────┘
```
- Textarea `font-mono text-sm min-h-[80px]` seeded with current bullet text

**Empty state** (no flags):
```
  ✓ No flags remaining
  Run another critique pass or end the session.
  
  [Run critique]
```
Center-aligned, `text-zinc-500 text-sm`

**After critique stream completes:**

A pass summary bar appears below the flag inbox:
```
  Scanned 14 bullets · Flagged 3 · Top concern: vague impact claims
```
`text-xs text-zinc-600 pt-3 border-t border-zinc-800 mt-3`

---

## 5. Session screen — Generate/Edit phase

Triggered after `End session` is confirmed.

Same two-pane layout, but:
- Left pane: same styled resume preview
- Right pane: shows the **final review summary**:

```
  FINAL REVIEW
  ────────────
  
  ✓ ready
  
  "14 bullets reviewed. 2 high-severity claims
  addressed. Resume is defensible for Staff
  Engineer roles."
  
  ┌───────────────────────────────┐
  │  ⚠ 1 remaining risk          │
  │  severity 2 · bullet b_07    │
  │  "Inflated scope — verify    │
  │  team size claim"            │
  └───────────────────────────────┘
  
  [Export PDF]   [Run another pass]
```

Verdict badge:
- `ready`: `bg-emerald-500/10 border-emerald-500/30 text-emerald-400`
- `needs-work`: `bg-amber-500/10 border-amber-500/30 text-amber-400`

---

## 6. Shared component patterns

### Flag type badge

```
  ┌──────────┐
  │  ◈ vague │
  └──────────┘
```
- Shape: `rounded-full px-2 py-0.5 text-xs font-medium`
- Colors by category:
  - Evidence flags (`unverified`, `no-impact`, `inflated`, `stale`, `specificity`, `seniority-mismatch`, `jd-mismatch`, `metric-risk`): `bg-amber-500/10 text-amber-400`
  - Wording flags (`vague`, `passive`, `length`, `jargon`, `wording-weakness`): `bg-violet-500/10 text-violet-400`
- Icon: `◈` for evidence, `◇` for wording

### Severity indicator

3 dots `w-2 h-2 rounded-full` inline:
- Sev 1: 1 filled violet, 2 empty zinc
- Sev 2: 2 filled violet, 1 empty zinc
- Sev 3: 3 filled amber

### Bullet status chip (in resume preview)

Small pill appended after bullet text:
- `draft`: `text-zinc-600 text-[10px]` — no chip shown
- `refined`: `bg-emerald-500/10 text-emerald-500 text-[10px] px-1.5 rounded-full` — "refined"
- `accepted`: `bg-zinc-700 text-zinc-500 text-[10px] px-1.5 rounded-full` — "kept"

### Model calls counter (topbar)

```
  [▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪] 3 / 60
```
A thin progress bar `h-1 rounded-full bg-zinc-800` with `bg-violet-500` fill. Width proportional to `made/max`. Changes to `bg-amber-500` at ≥75%.

---

## 7. Loading and streaming states

### Critique streaming

While `runCritiqueStream` is running, the flag inbox shows:

```
  SCANNING RESUME…
  
  ⠋  Analyzing bullet 4 of 14…
  
  Flag found:
  ┌────────────────────────────────┐
  │  ◈ vague · severity 2         │  ← slides in with fade+translate-y-2
  │  ...                           │
  └────────────────────────────────┘
```

Each flag card animates in: `opacity-0 translate-y-2 → opacity-100 translate-y-0 duration-200`.

Scanning label: animated ellipsis or spinner (`animate-spin` on an SVG), `text-zinc-500 text-sm`.

### Session creation (after setup submit)

Full-page centered loader:
```
  ⠋  Parsing your resume…
```
Then:
```
  ✓  Resume structured (14 bullets across 3 roles)
  ⠋  Starting gather phase…
```
Each step fades in sequentially, `text-sm text-zinc-400`.

---

## 8. Empty / error states

**No critique run yet (flag inbox):**
```
  Run a critique pass to surface issues.
  The interviewer will flag up to 8 concerns
  across your bullets.
  
  [Run critique →]
```
`text-center text-zinc-500 text-sm py-8`

**Critique error:**
```
  ✕  Critique failed
  codex exited with code 1
  
  [Try again]
```
`text-red-400 text-sm`

**Session not found:**
Full page centered:
```
  Session not found.
  [← Start a new session]
```

---

## 9. Responsive breakpoints

- **≥ 1024px (lg):** Two-pane session layout (resume left + flag inbox right)
- **< 1024px:** Stacked. Tabs at top: `[Resume]` `[Flags]` switch between panes. Flag inbox tab shows a badge count of unprocessed flags.

---

## 10. Existing component inventory (shadcn/ui — what to install/use)

All of these should be installed via `bunx shadcn add <name>` if not already present:

| shadcn component | Used where |
|---|---|
| `button` | All CTAs — already installed |
| `card` | Already installed |
| `input` | Target role, industry — already installed |
| `textarea` | Resume paste, edit panels — already installed |
| `label` | Form labels — already installed |
| `select` | Seniority, archetype, tone — **install and replace raw `<select>`** |
| `tabs` | PDF / Markdown / Blank switcher; mobile pane switcher |
| `badge` | Flag type, verdict, AI-suggested persona |
| `progress` | Model calls bar, gather progress |
| `separator` | Section dividers |
| `tooltip` | Disabled button explanations |
| `dialog` | Severity-3 stand-by confirmation |

---

## 11. What NOT to change

- All API calls and data fetching logic stay identical
- The `data-testid` attributes on buttons and inputs must be preserved exactly — tests depend on them
- Route structure (`/`, `/session/:id`) stays the same
- Form field names and registration stay the same (just style the wrappers)
- The topbar is new markup, but all buttons within it are wired to existing handlers

---

## 12. File locations

Current component files (modify in place):
- `src/client/screens/SetupScreen.tsx` — full visual rework
- `src/client/screens/SessionScreen.tsx` — full visual rework
- `src/client/components/GatherStep.tsx` — visual rework
- `src/client/styles.css` — add CSS vars if needed for dark theme
- `src/client/index.html` — add `class="dark"` to `<html>` if using shadcn dark mode

New component files to create:
- `src/client/components/FlagCard.tsx` — the focused flag card with all action states
- `src/client/components/ResumePreview.tsx` — styled HTML resume representation
- `src/client/components/ModelCallsBar.tsx` — topbar progress indicator
- `src/client/components/TopBar.tsx` — global shell topbar
