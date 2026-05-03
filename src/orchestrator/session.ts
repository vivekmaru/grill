import { join } from 'node:path'
import type { Database } from 'bun:sqlite'
import { z } from 'zod'
import type { ProviderAdapter } from '@/prompts/adapters/types'
import type { Event } from '@/schema/events'
import { Resume } from '@/schema/resume'
import type { TargetContext } from '@/schema/target'
import { render } from '@/prompts/render'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { FlagInstance } from '@/schema/flags'
import { reduce } from '@/state/reducer'
import { replay } from '@/state/replay'
import type { State } from '@/state/states'
import { CritiqueScanOutput, RewriteOutput, FinalReviewOutput } from './outputs'
import type { FlagType, Severity } from '@/schema/flags'
import { buildPersonaSystemPrompt } from './personaPrompt'
import {
  createSessionRepo,
  type SessionRepo,
  type ProviderName,
} from '@/server/db/repositories/sessions'
import {
  createResumeRepo,
  type ResumeRepo,
} from '@/server/db/repositories/resumes'
import {
  createHistoryRepo,
  type HistoryRepo,
} from '@/server/db/repositories/history'
import {
  createModelCallsRepo,
  type ModelCallsRepo,
} from '@/server/db/repositories/modelCalls'
import {
  createBudgetEnforcer,
  type BudgetEnforcer,
} from './budget'
import { GatherTurnsRepo } from '@/server/db/repositories/gatherTurns'
import { extractNumbers } from './verifier/numbers'
import { MAX_MODEL_CALLS_PER_SESSION } from '@/config/critique'

// ---------------------------------------------------------------------------
// Gather schemas + constants
// ---------------------------------------------------------------------------

const MAX_FOLLOWUPS_PER_ROLE = 2

const GatherBroadOutput = z.object({ question: z.string().min(1) })

const GatherFollowupOutput = z.discriminatedUnion('done', [
  z.object({ done: z.literal(true), reason: z.string() }),
  z.object({
    done: z.literal(false),
    followUp: z.string().min(1),
    trigger: z.enum(['scope', 'outcome', 'time', 'context']),
  }),
])

export class EvidencedFlagNotSupportedError extends Error {
  constructor(public readonly flag: FlagType) {
    super(
      `Flag '${flag}' requires evidenced rewrite (sub-plan 3). ` +
        'Use editBullet for v2 manual editing.',
    )
    this.name = 'EvidencedFlagNotSupportedError'
  }
}

const WORDSMITHING_FLAGS: ReadonlySet<FlagType> = new Set<FlagType>([
  'vague',
  'passive',
  'length',
  'jargon',
])

const EVIDENCE_FLAGS: ReadonlySet<FlagType> = new Set<FlagType>([
  'unverified',
  'no-impact',
  'inflated',
  'stale',
])

export class BlockingFlagsError extends Error {
  constructor(
    public readonly blockers: ReadonlyArray<{
      bulletId: string
      flag: FlagType
      severity: Severity
    }>,
  ) {
    super(
      `Cannot finish interrogation: ${blockers.length} unresolved blocking flags ` +
        `(severity ≥ 2) remain. Triage them via accept/skip/dismiss first.`,
    )
    this.name = 'BlockingFlagsError'
  }
}

export class VerifierFailedError extends Error {
  constructor(
    public readonly invented: ReadonlyArray<string>,
    public readonly flag: FlagType,
  ) {
    super(
      `Rewrite verifier rejected candidate: introduces numbers not in evidence (${invented.join(', ')}). ` +
        `Flag '${flag}' needs more concrete answers in the gather phase.`,
    )
    this.name = 'VerifierFailedError'
  }
}

export type CritiqueEvent =
  | { type: 'started'; sessionId: number; timestamp: number }
  | {
      type: 'flag'
      bulletId: string
      flag: FlagInstance
    }
  | {
      type: 'pass-summary'
      bulletsScanned: number
      bulletsFlagged: number
      topConcern: string
    }
  | {
      type: 'done'
      flagCount: number
      durationMs: number
    }
  | { type: 'error'; message: string }

export interface SessionSnapshot {
  id: number
  state: State
  provider: ProviderName | null
  modelCallsMade: number
  modelCallsBudget: number
  allowExtraUsage: boolean
}

export class Session {
  private state: State
  private readonly sessions: SessionRepo
  private readonly resumes: ResumeRepo
  private readonly history: HistoryRepo
  private readonly modelCalls: ModelCallsRepo
  private readonly budget: BudgetEnforcer
  private readonly gatherTurns: GatherTurnsRepo
  private lastFinalReview: FinalReviewOutput | null = null

  private constructor(
    private readonly id: number,
    private readonly db: Database,
    private readonly adapter: ProviderAdapter,
    initialState: State,
    budget: BudgetEnforcer,
  ) {
    this.state = initialState
    this.sessions = createSessionRepo(db)
    this.resumes = createResumeRepo(db)
    this.history = createHistoryRepo(db)
    this.modelCalls = createModelCallsRepo(db)
    this.budget = budget
    this.gatherTurns = new GatherTurnsRepo(db)
  }

  static create(db: Database, adapter: ProviderAdapter): Session {
    const sessions = createSessionRepo(db)
    const id = sessions.create({ state: 'ingest' })
    sessions.lockProvider(id, adapter.name)
    const budget = createBudgetEnforcer({
      max: MAX_MODEL_CALLS_PER_SESSION,
      made: 0,
      allowExtraUsage: false,
    })
    return new Session(id, db, adapter, 'ingest', budget)
  }

  static load(db: Database, adapter: ProviderAdapter, id: number): Session {
    const sessions = createSessionRepo(db)
    const row = sessions.get(id)
    if (!row) {
      throw new Error(`Session not found: id=${id}`)
    }
    const history = createHistoryRepo(db)
    const events = history.listForSession(id).map((r) => r.event)
    const state = replay(events)
    const budget = createBudgetEnforcer({
      max: MAX_MODEL_CALLS_PER_SESSION,
      made: row.modelCallsMade,
      allowExtraUsage: row.allowExtraUsage,
    })
    return new Session(id, db, adapter, state, budget)
  }

  snapshot(): SessionSnapshot {
    const row = this.sessions.get(this.id)
    if (!row) {
      throw new Error(`Session row vanished: id=${this.id}`)
    }
    return {
      id: this.id,
      state: this.state,
      provider: row.provider,
      modelCallsMade: row.modelCallsMade,
      modelCallsBudget: this.budget.snapshot().max,
      allowExtraUsage: row.allowExtraUsage,
    }
  }

  /**
   * Apply an event: validate against the reducer, append to history,
   * update state row, all in one transaction. Updates the cached state.
   */
  protected applyEvent(event: Event, extraWrites?: () => void): void {
    const newState = reduce(this.state, event)
    this.db.transaction(() => {
      this.history.append({ sessionId: this.id, role: 'user', event })
      if (newState !== this.state) {
        this.sessions.setState(this.id, newState)
      }
      if (extraWrites) extraWrites()
    })()
    this.state = newState
  }

  // --- Methods stubbed for later tasks ---

  async ingestResume(input:
    | { kind: 'markdown'; text: string }
    | { kind: 'blank' }
    | { kind: 'pdf'; data: string }
  ): Promise<Resume> {
    let resume: Resume

    if (input.kind === 'pdf') {
      // Extract text via unpdf, then re-enter the markdown branch.
      const { extractText, getDocumentProxy } = await import('unpdf')
      const buf = Uint8Array.from(atob(input.data), (c) => c.charCodeAt(0))
      const pdf = await getDocumentProxy(buf)
      const { text } = await extractText(pdf, { mergePages: true })
      const merged = Array.isArray(text) ? text.join('\n\n') : text
      if (!merged.trim()) {
        throw new Error(
          'PDF parsing returned empty text — the file may be a scanned image. ' +
            'Paste the resume as markdown instead.',
        )
      }
      input = { kind: 'markdown', text: merged }
    }

    if (input.kind === 'blank') {
      // Empty resume scaffold
      resume = stampIds(Resume.parse({
        version: 1,
        contact: { name: '', links: [] },
        roles: [],
        education: [],
        projects: [],
        skills: { categories: [] },
        certifications: [],
      }))
      this.applyEvent({ type: 'START_BLANK' })
    } else {
      const markdown = input.text
      const template = await loadIngestTemplate()
      const userPrompt = render(template, {
        markdown,
        output_schema: JSON.stringify(zodToJsonSchema(Resume)),
      })

      this.budget.recordCall()
      const startMs = Date.now()
      let result!: Resume
      try {
        const out = await this.adapter.callInSession({
          sessionHandle: null,
          tier: 'main',
          systemPrompt:
            'You convert markdown resumes into structured JSON. Return ONLY JSON.',
          userPrompt,
          schema: Resume,
        })
        result = out.result as Resume
      } finally {
        // Best-effort telemetry write (outside any transaction)
        try {
          this.modelCalls.record({
            sessionId: this.getId(),
            templateName: 'ingest-markdown',
            provider: this.adapter.name,
            tier: 'main',
            tokensInEstimate: null,
            tokensOutEstimate: null,
            latencyMs: Date.now() - startMs,
            validationFailures: 0,
            verifierRejections: 0,
          })
          this.sessions.incrementCalls(this.getId())
        } catch (e) {
          console.warn(`[session] telemetry write failed: ${(e as Error).message}`)
        }
      }

      resume = stampIds(result!)
      this.applyEvent({ type: 'UPLOAD_RESUME', markdown })
    }

    // Persist the resume and link it to the session
    const resumeId = this.resumes.create({ resume, versionName: 'ingest' })
    this.sessions.setActiveResume(this.getId(), resumeId)

    this.applyEvent({ type: 'CONFIRM_INGEST' })
    return resume
  }

  setTarget(ctx: TargetContext): void {
    this.db.transaction(() => {
      this.sessions.setTargetContext(this.getId(), ctx)
      this.sessions.setPersona(this.getId(), ctx.persona)
    })()
    this.applyEvent({ type: 'SET_TARGET', ctx })
    this.applyEvent({ type: 'CONFIRM_PERSONA' })
    if (this.sessions.getGatherEnabled(this.getId())) {
      // Stay in 'gather'; client will drive nextGatherQuestion calls.
    } else {
      this.applyEvent({ type: 'BEGIN_CRITIQUE' })
    }
  }

  async *runCritique(
    opts?: { signal?: AbortSignal },
  ): AsyncIterable<CritiqueEvent> {
    if (this.state !== 'critique') {
      throw new Error(
        `runCritique requires state 'critique', got '${this.state}'`,
      )
    }

    const startMs = Date.now()
    yield { type: 'started', sessionId: this.id, timestamp: startMs }

    const sessionRow = this.sessions.get(this.id)
    if (!sessionRow?.activeResumeId) {
      throw new Error('No active resume — call ingestResume first')
    }
    const stored = this.resumes.get(sessionRow.activeResumeId)
    if (!stored) {
      throw new Error(`Resume row missing: id=${sessionRow.activeResumeId}`)
    }
    const target = sessionRow.targetContext as TargetContext
    if (!target) {
      throw new Error('No target context — call setTarget first')
    }

    const personaPrompt = await buildPersonaSystemPrompt(target.persona, {
      jdOverlay: buildJdOverlay(target),
    })
    const template = await loadCritiqueTemplate()
    const rubricFlags = await loadRubricFlags()

    const dismissedBulletIds = [
      ...stored.resume.roles.flatMap((r) =>
        r.bullets
          .filter((b) => b.flags.some((f) => f.dismissed))
          .map((b) => b.id),
      ),
      ...stored.resume.projects.flatMap((p) =>
        p.bullets
          .filter((b) => b.flags.some((f) => f.dismissed))
          .map((b) => b.id),
      ),
    ]

    const userPrompt = render(template, {
      persona: '', // already in systemPrompt
      rubric_flags: rubricFlags,
      target_context: JSON.stringify(target),
      resume_json: JSON.stringify(stored.resume),
      dismissed_bullet_ids: JSON.stringify(dismissedBulletIds),
      output_schema: JSON.stringify(zodToJsonSchema(CritiqueScanOutput)),
    })

    this.budget.recordCall()
    const callStart = Date.now()
    let parsed
    try {
      const out = await this.adapter.callInSession({
        sessionHandle: null,
        tier: 'main',
        systemPrompt: personaPrompt,
        userPrompt,
        schema: CritiqueScanOutput,
        signal: opts?.signal,
      })
      parsed = out.result
    } catch (e) {
      yield { type: 'error', message: (e as Error).message }
      return
    } finally {
      try {
        this.modelCalls.record({
          sessionId: this.id,
          templateName: 'critique-scan',
          provider: this.adapter.name,
          tier: 'main',
          tokensInEstimate: null,
          tokensOutEstimate: null,
          latencyMs: Date.now() - callStart,
          validationFailures: 0,
          verifierRejections: 0,
        })
        this.sessions.incrementCalls(this.id)
      } catch (e) {
        console.warn(`[session] telemetry write failed: ${(e as Error).message}`)
      }
    }

    // Persist the flags onto the resume in one transaction
    const updatedResume: Resume = JSON.parse(JSON.stringify(stored.resume))
    for (const f of parsed.flags) {
      const located = this.findBullet(updatedResume, f.bulletId)
      if (!located.ok) continue
      const collection =
        located.role === 'role'
          ? updatedResume.roles[located.index]!.bullets
          : updatedResume.projects[located.index]!.bullets
      const bullet = collection[located.bulletIndex]!
      const flagInstance: FlagInstance = {
        flag: f.flag,
        severity: f.severity,
        span: f.span,
        why: f.why,
        suggestedQuestion: f.suggestedQuestion,
        dismissed: false,
        dismissedAt: null,
      }
      bullet.flags.push(flagInstance)
      bullet.status = 'flagged'
    }
    this.db.transaction(() => {
      this.resumes.update(sessionRow.activeResumeId!, {
        resume: updatedResume,
        versionName: stored.versionName,
      })
    })()

    // Synthesize per-flag events
    for (const f of parsed.flags) {
      const flagInstance: FlagInstance = {
        flag: f.flag,
        severity: f.severity,
        span: f.span,
        why: f.why,
        suggestedQuestion: f.suggestedQuestion,
        dismissed: false,
        dismissedAt: null,
      }
      yield { type: 'flag', bulletId: f.bulletId, flag: flagInstance }
    }

    yield {
      type: 'pass-summary',
      bulletsScanned: parsed.passSummary.bulletsScanned,
      bulletsFlagged: parsed.passSummary.bulletsFlagged,
      topConcern: parsed.passSummary.topConcern,
    }

    yield {
      type: 'done',
      flagCount: parsed.flags.length,
      durationMs: Date.now() - startMs,
    }
  }

  // ---------------------------------------------------------------------------
  // Gather methods
  // ---------------------------------------------------------------------------

  async nextGatherQuestion(args: { roleId: string }): Promise<
    | { kind: 'broad' | 'followup'; turnId: number; question: string }
    | { kind: 'done'; reason: string }
  > {
    if (this.state !== 'gather') throw new Error('not allowed: not in gather state')
    const role = this.findRole(args.roleId)
    if (!role) throw new Error(`Role not found: ${args.roleId}`)

    const existing = this.gatherTurns.forRole(this.getId(), args.roleId)
    const hasBroad = existing.some((t) => t.turnKind === 'broad')
    const followupCount = this.gatherTurns.countFollowups(this.getId(), args.roleId)

    if (!hasBroad) {
      // Broad question
      const tpl = await loadGatherBroadTemplate()
      const systemPrompt = await this.buildSystemPrompt()
      const userPrompt = render(tpl, {
        persona: systemPrompt,
        role_company: role.company,
        role_title: role.title,
        role_dates: `${role.startDate} – ${role.endDate ?? 'present'}`,
        existing_bullets: role.bullets.map((b) => `- ${b.text}`).join('\n') || '(none)',
        target_context: this.targetContextString(),
      })
      this.budget.recordCall()
      const callStart = Date.now()
      let out: { result: z.infer<typeof GatherBroadOutput> }
      try {
        out = await this.adapter.callInSession({
          sessionHandle: null,
          tier: 'main',
          systemPrompt,
          userPrompt,
          schema: GatherBroadOutput,
        })
      } finally {
        this.recordTelemetry('gather-broad', callStart)
      }
      const turnId = this.gatherTurns.insertQuestion({
        sessionId: this.getId(),
        roleId: args.roleId,
        turnKind: 'broad',
        question: out!.result.question,
      })
      return { kind: 'broad', turnId, question: out!.result.question }
    }

    // Cap check — return done without calling the adapter
    if (followupCount >= MAX_FOLLOWUPS_PER_ROLE) {
      const turnId = this.gatherTurns.insertQuestion({
        sessionId: this.getId(),
        roleId: args.roleId,
        turnKind: 'done',
        question: null,
      })
      void turnId
      return { kind: 'done', reason: 'follow-up cap reached' }
    }

    // Follow-up question
    const userAnswerSoFar = existing
      .filter((t) => t.answer)
      .map((t) => `Q: ${t.question}\nA: ${t.answer}`)
      .join('\n\n')
    const followupsAsked =
      existing
        .filter((t) => t.turnKind === 'followup')
        .map((t) => `- ${t.question}`)
        .join('\n') || '(none)'

    const tpl = await loadGatherFollowupTemplate()
    const systemPrompt = await this.buildSystemPrompt()
    const userPrompt = render(tpl, {
      persona: systemPrompt,
      role_company: role.company,
      role_title: role.title,
      user_answer_so_far: userAnswerSoFar || '(no answer yet)',
      followups_already_asked: followupsAsked,
    })
    this.budget.recordCall()
    const callStart = Date.now()
    let out: { result: z.infer<typeof GatherFollowupOutput> }
    try {
      out = await this.adapter.callInSession({
        sessionHandle: null,
        tier: 'main',
        systemPrompt,
        userPrompt,
        schema: GatherFollowupOutput,
      })
    } finally {
      this.recordTelemetry('gather-followup', callStart)
    }

    if (out!.result.done) {
      const turnId = this.gatherTurns.insertQuestion({
        sessionId: this.getId(),
        roleId: args.roleId,
        turnKind: 'done',
        question: null,
      })
      void turnId
      return { kind: 'done', reason: out!.result.reason }
    }

    const turnId = this.gatherTurns.insertQuestion({
      sessionId: this.getId(),
      roleId: args.roleId,
      turnKind: 'followup',
      question: out!.result.followUp,
    })
    return { kind: 'followup', turnId, question: out!.result.followUp }
  }

  recordGatherAnswer(args: { turnId: number; answer: string }): void {
    if (this.state !== 'gather') throw new Error('not allowed: not in gather state')
    this.db.transaction(() => {
      this.gatherTurns.recordAnswer(args.turnId, args.answer)
      this.applyEvent({ type: 'USER_MESSAGE', text: args.answer })
    })()
  }

  skipGatherRole(args: { roleId: string }): void {
    if (this.state !== 'gather') throw new Error('not allowed: not in gather state')
    this.gatherTurns.insertSkip({ sessionId: this.getId(), roleId: args.roleId })
  }

  endGather(): void {
    if (this.state !== 'gather') throw new Error('not allowed: not in gather state')
    this.applyEvent({ type: 'BEGIN_CRITIQUE' })
  }

  /** Delegate to the sessions repo — convenience for tests. */
  setGatherEnabled(enabled: boolean): void {
    this.sessions.setGatherEnabled(this.getId(), enabled)
  }

  acceptFlag(args: {
    bulletId: string
    flagIndex: number
    newText: string
  }): void {
    this.db.transaction(() => {
      this.mutateResume((r) => {
        const located = this.findBullet(r, args.bulletId)
        if (!located.ok) throw new Error(`Bullet not found: ${args.bulletId}`)
        const collection =
          located.role === 'role'
            ? r.roles[located.index]!.bullets
            : r.projects[located.index]!.bullets
        const bullet = collection[located.bulletIndex]!
        bullet.text = args.newText
        bullet.status = 'refined'
        return r
      })
      this.applyEvent({
        type: 'ACCEPT_BULLET',
        bulletId: args.bulletId,
        newText: args.newText,
      })
    })()
  }

  skipFlag(args: { bulletId: string; flagIndex: number }): void {
    this.db.transaction(() => {
      this.mutateResume((r) => {
        const located = this.findBullet(r, args.bulletId)
        if (!located.ok) throw new Error(`Bullet not found: ${args.bulletId}`)
        const collection =
          located.role === 'role'
            ? r.roles[located.index]!.bullets
            : r.projects[located.index]!.bullets
        const bullet = collection[located.bulletIndex]!
        bullet.status = 'accepted'
        return r
      })
      this.applyEvent({ type: 'SKIP_BULLET', bulletId: args.bulletId })
    })()
  }

  dismissFlag(args: {
    bulletId: string
    flagIndex: number
    reason?: string
    confirmSeverity3?: boolean
  }): void {
    // Pre-check severity outside the transaction so we don't half-mutate
    const resume = this.currentResume()
    const located = this.findBullet(resume, args.bulletId)
    if (!located.ok) throw new Error(`Bullet not found: ${args.bulletId}`)
    const probeCollection =
      located.role === 'role'
        ? resume.roles[located.index]!.bullets
        : resume.projects[located.index]!.bullets
    const probeFlag = probeCollection[located.bulletIndex]!.flags[args.flagIndex]
    if (probeFlag && probeFlag.severity === 3 && !args.confirmSeverity3) {
      throw new Error(
        `Refusing to dismiss severity-3 flag without confirmation. ` +
          `Pass confirmSeverity3: true to acknowledge.`,
      )
    }

    this.db.transaction(() => {
      this.mutateResume((r) => {
        const located = this.findBullet(r, args.bulletId)
        if (!located.ok) throw new Error(`Bullet not found: ${args.bulletId}`)
        const collection =
          located.role === 'role'
            ? r.roles[located.index]!.bullets
            : r.projects[located.index]!.bullets
        const bullet = collection[located.bulletIndex]!
        const flag = bullet.flags[args.flagIndex]
        if (!flag) {
          throw new Error(
            `Flag index ${args.flagIndex} out of range on bullet ${args.bulletId}`,
          )
        }
        flag.dismissed = true
        flag.dismissedAt = Date.now()
        return r
      })
      this.applyEvent({
        type: 'DISMISS_FLAG',
        bulletId: args.bulletId,
        flagIndex: args.flagIndex,
      })
    })()
  }

  async proposeRewrites(args: {
    bulletId: string
    flagIndex: number
  }): Promise<RewriteOutput> {
    const row = this.sessions.get(this.id)
    if (!row?.activeResumeId) throw new Error('No active resume')
    const stored = this.resumes.get(row.activeResumeId)
    if (!stored) throw new Error('Resume row missing')
    const target = row.targetContext as TargetContext
    if (!target) throw new Error('No target context')

    const located = this.findBullet(stored.resume, args.bulletId)
    if (!located.ok) throw new Error(`Bullet not found: ${args.bulletId}`)
    const collection =
      located.role === 'role'
        ? stored.resume.roles[located.index]!.bullets
        : stored.resume.projects[located.index]!.bullets
    const bullet = collection[located.bulletIndex]!
    const flag = bullet.flags[args.flagIndex]
    if (!flag) {
      throw new Error(
        `Flag index ${args.flagIndex} out of range on bullet ${args.bulletId}`,
      )
    }

    const personaPrompt = await buildPersonaSystemPrompt(target.persona, {
      jdOverlay: buildJdOverlay(target),
    })

    if (WORDSMITHING_FLAGS.has(flag.flag)) {
      const template = await loadRewriteWordsmithTemplate()
      const userPrompt = render(template, {
        persona: '',
        original_bullet: bullet.text,
        flag_type: flag.flag,
        flag_reason: flag.why,
        user_clarification: '',
        output_schema: JSON.stringify(zodToJsonSchema(RewriteOutput)),
      })
      return this.callRewrite({
        templateName: 'rewrite-wordsmith',
        personaPrompt,
        userPrompt,
      })
    }

    if (EVIDENCE_FLAGS.has(flag.flag)) {
      // Find which role this bullet belongs to so we can pull gather answers.
      const roleId = located.role === 'role'
        ? stored.resume.roles[located.index]!.id
        : null
      const evidenceText = roleId ? this.formatEvidenceForRole(roleId) : ''
      const allowed = new Set<string>([
        ...extractNumbers(bullet.text),
        ...extractNumbers(evidenceText),
      ])

      const template = await loadRewriteEvidencedTemplate()
      const userPrompt = render(template, {
        persona: '',
        original_bullet: bullet.text,
        flag_type: flag.flag,
        flag_reason: flag.why,
        evidence: evidenceText || '(no gather answers recorded for this role)',
        output_schema: JSON.stringify(zodToJsonSchema(RewriteOutput)),
      })

      // First attempt
      let result = await this.callRewrite({
        templateName: 'rewrite-evidenced',
        personaPrompt,
        userPrompt,
      })
      let invented = findInventedNumbers(result, allowed)

      if (invented.length > 0) {
        // Retry once with verifier feedback inline
        const retryPrompt =
          userPrompt +
          `\n\nA previous attempt invented these numeric tokens not present in the original bullet or evidence: ${invented.join(', ')}. ` +
          `Re-issue the 2 candidates without those tokens. Tighten language only if the evidence is too thin.`
        result = await this.callRewrite({
          templateName: 'rewrite-evidenced',
          personaPrompt,
          userPrompt: retryPrompt,
          verifierRejection: 1,
        })
        invented = findInventedNumbers(result, allowed)
        if (invented.length > 0) {
          throw new VerifierFailedError(invented, flag.flag)
        }
      }

      return result
    }

    throw new EvidencedFlagNotSupportedError(flag.flag)
  }

  /**
   * Stringify gather answers for a role into an evidence block.
   * Skips unanswered turns and skip markers.
   */
  private formatEvidenceForRole(roleId: string): string {
    const turns = this.gatherTurns.forRole(this.id, roleId)
    const lines: string[] = []
    for (const t of turns) {
      if (t.turnKind === 'skip' || t.turnKind === 'done') continue
      if (!t.question || !t.answer) continue
      lines.push(`Q: ${t.question}\nA: ${t.answer}`)
    }
    return lines.join('\n\n')
  }

  /**
   * Shared adapter-call helper for both rewrite flavors. Records telemetry
   * (best-effort) regardless of success.
   */
  private async callRewrite(args: {
    templateName: string
    personaPrompt: string
    userPrompt: string
    verifierRejection?: number
  }): Promise<RewriteOutput> {
    this.budget.recordCall()
    const callStart = Date.now()
    let result: RewriteOutput | undefined
    try {
      const out = await this.adapter.callInSession({
        sessionHandle: null,
        tier: 'main',
        systemPrompt: args.personaPrompt,
        userPrompt: args.userPrompt,
        schema: RewriteOutput,
      })
      result = out.result
      return result
    } finally {
      try {
        this.modelCalls.record({
          sessionId: this.id,
          templateName: args.templateName,
          provider: this.adapter.name,
          tier: 'main',
          tokensInEstimate: null,
          tokensOutEstimate: null,
          latencyMs: Date.now() - callStart,
          validationFailures: 0,
          verifierRejections: args.verifierRejection ?? 0,
        })
        this.sessions.incrementCalls(this.id)
      } catch (e) {
        console.warn(`[session] telemetry write failed: ${(e as Error).message}`)
      }
    }
  }

  currentResume(): Resume {
    const row = this.sessions.get(this.id)
    if (!row?.activeResumeId) {
      throw new Error('No active resume')
    }
    const stored = this.resumes.get(row.activeResumeId)
    if (!stored) {
      throw new Error(`Resume row missing: id=${row.activeResumeId}`)
    }
    return stored.resume
  }

  editBullet(args: { bulletId: string; newText: string }): void {
    this.db.transaction(() => {
      this.mutateResume((r) => {
        const located = this.findBullet(r, args.bulletId)
        if (!located.ok) throw new Error(`Bullet not found: ${args.bulletId}`)
        const collection =
          located.role === 'role'
            ? r.roles[located.index]!.bullets
            : r.projects[located.index]!.bullets
        const bullet = collection[located.bulletIndex]!
        bullet.text = args.newText
        bullet.status = 'refined'
        return r
      })
      this.applyEvent({ type: 'EDIT_RESUME', patch: [] })
    })()
  }

  /**
   * End the interrogation: run the holistic final-review pass and transition
   * critique → finalReview → generate. Refuses if any non-dismissed,
   * non-resolved severity-2+ flags remain (the candidate must triage them
   * first).
   *
   * `lastFinalReview` is exposed via {@link getLastFinalReview} so callers
   * can show the review notes after the transition.
   */
  async endInterrogation(): Promise<FinalReviewOutput> {
    if (this.state !== 'critique' && this.state !== 'gather') {
      throw new Error(
        `END_INTERROGATION not allowed in state '${this.state}'`,
      )
    }

    if (this.state === 'critique') {
      this.assertNoBlockingFlags()
    }

    const sessionRow = this.sessions.get(this.id)
    if (!sessionRow?.activeResumeId) throw new Error('No active resume')
    const stored = this.resumes.get(sessionRow.activeResumeId)
    if (!stored) throw new Error('Resume row missing')
    const target = sessionRow.targetContext as TargetContext
    if (!target) throw new Error('No target context')

    const personaPrompt = await buildPersonaSystemPrompt(target.persona, {
      jdOverlay: buildJdOverlay(target),
    })
    const template = await loadFinalReviewTemplate()
    const userPrompt = render(template, {
      persona: '',
      resume_json: JSON.stringify(stored.resume),
      target_context: JSON.stringify(target),
      output_schema: JSON.stringify(zodToJsonSchema(FinalReviewOutput)),
    })

    this.budget.recordCall()
    const callStart = Date.now()
    let result: FinalReviewOutput
    try {
      const out = await this.adapter.callInSession({
        sessionHandle: null,
        tier: 'main',
        systemPrompt: personaPrompt,
        userPrompt,
        schema: FinalReviewOutput,
      })
      result = out.result
    } finally {
      try {
        this.modelCalls.record({
          sessionId: this.id,
          templateName: 'final-review',
          provider: this.adapter.name,
          tier: 'main',
          tokensInEstimate: null,
          tokensOutEstimate: null,
          latencyMs: Date.now() - callStart,
          validationFailures: 0,
          verifierRejections: 0,
        })
        this.sessions.incrementCalls(this.id)
      } catch (e) {
        console.warn(`[session] telemetry write failed: ${(e as Error).message}`)
      }
    }

    this.lastFinalReview = result!
    this.applyEvent({ type: 'END_INTERROGATION' })
    return result!
  }

  getLastFinalReview(): FinalReviewOutput | null {
    return this.lastFinalReview
  }

  /**
   * Block ending interrogation when the candidate hasn't triaged severity-2+
   * critique flags. Severity-1 may slip through; severity-3 is permitted only
   * via explicit dismissal (see {@link dismissFlag}).
   *
   * A flag counts as "unresolved" when:
   *   - it is not dismissed AND
   *   - the bullet's status is still 'flagged' (not refined/accepted)
   */
  private assertNoBlockingFlags(): void {
    const resume = this.currentResume()
    const blockers: Array<{ bulletId: string; flag: FlagType; severity: Severity }> = []
    const collect = (bullets: Resume['roles'][number]['bullets']) => {
      for (const b of bullets) {
        if (b.status !== 'flagged') continue
        for (const f of b.flags) {
          if (f.dismissed) continue
          if (f.severity >= 2) blockers.push({ bulletId: b.id, flag: f.flag, severity: f.severity })
        }
      }
    }
    for (const r of resume.roles) collect(r.bullets)
    for (const p of resume.projects) collect(p.bullets)
    if (blockers.length > 0) {
      throw new BlockingFlagsError(blockers)
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Find a role by id in the current resume. */
  private findRole(roleId: string): Resume['roles'][number] | null {
    return this.currentResume().roles.find((r) => r.id === roleId) ?? null
  }

  /** Build the persona system prompt for the current session. */
  private async buildSystemPrompt(): Promise<string> {
    const row = this.sessions.get(this.id)
    const target = row?.targetContext as TargetContext | null
    if (!target) throw new Error('No target context — call setTarget first')
    return buildPersonaSystemPrompt(target.persona, {
      jdOverlay: buildJdOverlay(target),
    })
  }

  /** Serialize the current target context as a JSON string for template slots. */
  private targetContextString(): string {
    const row = this.sessions.get(this.id)
    if (!row?.targetContext) return ''
    return JSON.stringify(row.targetContext, null, 2)
  }

  /**
   * Best-effort telemetry write. Called in the `finally` block of adapter calls.
   * Matches the pattern in `runCritique` / `ingestResume`.
   */
  private recordTelemetry(templateName: string, callStartMs: number): void {
    try {
      this.modelCalls.record({
        sessionId: this.id,
        templateName,
        provider: this.adapter.name,
        tier: 'main',
        tokensInEstimate: null,
        tokensOutEstimate: null,
        latencyMs: Date.now() - callStartMs,
        validationFailures: 0,
        verifierRejections: 0,
      })
      this.sessions.incrementCalls(this.id)
    } catch (e) {
      console.warn(`[session] telemetry write failed: ${(e as Error).message}`)
    }
  }

  /** Locate a bullet across roles and projects by id. */
  private findBullet(
    resume: Resume,
    bulletId: string,
  ):
    | { ok: true; role: 'role' | 'project'; index: number; bulletIndex: number }
    | { ok: false } {
    for (let i = 0; i < resume.roles.length; i++) {
      const role = resume.roles[i]!
      for (let j = 0; j < role.bullets.length; j++) {
        if (role.bullets[j]!.id === bulletId) {
          return { ok: true, role: 'role', index: i, bulletIndex: j }
        }
      }
    }
    for (let i = 0; i < resume.projects.length; i++) {
      const proj = resume.projects[i]!
      for (let j = 0; j < proj.bullets.length; j++) {
        if (proj.bullets[j]!.id === bulletId) {
          return { ok: true, role: 'project', index: i, bulletIndex: j }
        }
      }
    }
    return { ok: false }
  }

  private mutateResume(mutator: (r: Resume) => Resume): void {
    const row = this.sessions.get(this.id)
    if (!row?.activeResumeId) throw new Error('No active resume')
    const stored = this.resumes.get(row.activeResumeId)
    if (!stored) throw new Error('Resume row missing')
    const updated = mutator(JSON.parse(JSON.stringify(stored.resume)))
    this.resumes.update(row.activeResumeId, {
      resume: updated,
      versionName: stored.versionName,
    })
  }

  getId(): number {
    return this.id
  }

  /** For tests: expose the underlying flag instances on the Resume. */
  getFlagsOnResume(): FlagInstance[] {
    throw new Error('not yet implemented')
  }
}

/**
 * Compose the JD-grounded overlay block when the user provided a job
 * description. Empty string disables the conditional in persona-system.md
 * (the {{#if jdOverlay}}…{{/if}} block is skipped entirely).
 *
 * Why a helper: every adapter call should ground the persona in the JD if
 * one is available, so this lives in one place rather than being inlined at
 * each call site. The wrapper also leaves room to add JD distillation later
 * (e.g. a precomputed "evaluation criteria" extraction) without touching
 * call sites.
 */
function buildJdOverlay(target: TargetContext): string {
  const jd = target.jobDescription?.trim()
  if (!jd) return ''
  const role = `${target.targetSeniority} ${target.targetRole}`.trim()
  const industry = target.industry ? ` in ${target.industry}` : ''
  return (
    `The candidate is targeting a ${role} role${industry}. ` +
    `Calibrate your standards and follow-ups to the requirements implied by this job description:\n\n` +
    `---\n${jd}\n---\n\n` +
    `When you flag a bullet, prefer concerns that matter for THIS role over generic resume hygiene.`
  )
}

/**
 * Return any numeric tokens present in a rewrite candidate's text but
 * absent from the allowed set (= original bullet numbers ∪ evidence numbers).
 * Returns the union across all candidates so the retry prompt sees everything.
 */
function findInventedNumbers(
  rewrite: RewriteOutput,
  allowed: ReadonlySet<string>,
): string[] {
  const invented = new Set<string>()
  for (const candidate of rewrite.candidates) {
    for (const tok of extractNumbers(candidate.text)) {
      if (!allowed.has(tok)) invented.add(tok)
    }
  }
  return Array.from(invented)
}

/**
 * Walk a Resume tree and replace every `id` field with a fresh crypto UUID.
 * Returns a deep copy with stamped IDs.
 */
function stampIds(resume: Resume): Resume {
  const copy: Resume = JSON.parse(JSON.stringify(resume))
  for (const role of copy.roles) {
    role.id = crypto.randomUUID()
    for (const bullet of role.bullets) {
      bullet.id = crypto.randomUUID()
    }
  }
  for (const edu of copy.education) {
    edu.id = crypto.randomUUID()
  }
  for (const project of copy.projects) {
    project.id = crypto.randomUUID()
    for (const bullet of project.bullets) {
      bullet.id = crypto.randomUUID()
    }
  }
  return copy
}

const PROMPTS_DIR = join(import.meta.dir, '..', 'prompts')
let cachedIngestTemplate: string | null = null
async function loadIngestTemplate(): Promise<string> {
  if (cachedIngestTemplate) return cachedIngestTemplate
  cachedIngestTemplate = await Bun.file(
    join(PROMPTS_DIR, 'templates/ingest-markdown.md'),
  ).text()
  return cachedIngestTemplate
}

let cachedCritiqueTemplate: string | null = null
async function loadCritiqueTemplate(): Promise<string> {
  if (cachedCritiqueTemplate) return cachedCritiqueTemplate
  cachedCritiqueTemplate = await Bun.file(
    join(PROMPTS_DIR, 'templates/critique-scan.md'),
  ).text()
  return cachedCritiqueTemplate
}

let cachedRubricFlags: string | null = null
async function loadRubricFlags(): Promise<string> {
  if (cachedRubricFlags) return cachedRubricFlags
  cachedRubricFlags = await Bun.file(
    join(PROMPTS_DIR, 'rubric/flags.md'),
  ).text()
  return cachedRubricFlags
}

let cachedRewriteTemplate: string | null = null
async function loadRewriteWordsmithTemplate(): Promise<string> {
  if (cachedRewriteTemplate) return cachedRewriteTemplate
  cachedRewriteTemplate = await Bun.file(
    join(PROMPTS_DIR, 'templates/rewrite-wordsmith.md'),
  ).text()
  return cachedRewriteTemplate
}

let cachedFinalReview: string | null = null
async function loadFinalReviewTemplate(): Promise<string> {
  if (cachedFinalReview) return cachedFinalReview
  cachedFinalReview = await Bun.file(
    join(PROMPTS_DIR, 'templates/final-review.md'),
  ).text()
  return cachedFinalReview
}

let cachedRewriteEvidenced: string | null = null
async function loadRewriteEvidencedTemplate(): Promise<string> {
  if (cachedRewriteEvidenced) return cachedRewriteEvidenced
  cachedRewriteEvidenced = await Bun.file(
    join(PROMPTS_DIR, 'templates/rewrite-evidenced.md'),
  ).text()
  return cachedRewriteEvidenced
}

let cachedGatherBroad: string | null = null
async function loadGatherBroadTemplate(): Promise<string> {
  if (cachedGatherBroad) return cachedGatherBroad
  cachedGatherBroad = await Bun.file(
    join(PROMPTS_DIR, 'templates/gather-broad.md'),
  ).text()
  return cachedGatherBroad
}

let cachedGatherFollowup: string | null = null
async function loadGatherFollowupTemplate(): Promise<string> {
  if (cachedGatherFollowup) return cachedGatherFollowup
  cachedGatherFollowup = await Bun.file(
    join(PROMPTS_DIR, 'templates/gather-followup.md'),
  ).text()
  return cachedGatherFollowup
}
