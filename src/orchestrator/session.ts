import { join } from 'node:path'
import type { Database } from 'bun:sqlite'
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
import { MAX_MODEL_CALLS_PER_SESSION } from '@/config/critique'

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

  async ingestResume(input: {
    kind: 'markdown' | 'blank'
    text?: string
  }): Promise<Resume> {
    let resume: Resume

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
      const markdown = input.text ?? ''
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
    this.applyEvent({ type: 'BEGIN_CRITIQUE' })
  }

  runCritique(): AsyncIterable<unknown> {
    throw new Error('not yet implemented')
  }

  acceptFlag(_args: {
    bulletId: string
    flagIndex: number
    newText: string
  }): void {
    throw new Error('not yet implemented')
  }

  skipFlag(_args: { bulletId: string; flagIndex: number }): void {
    throw new Error('not yet implemented')
  }

  dismissFlag(_args: {
    bulletId: string
    flagIndex: number
    reason?: string
  }): void {
    throw new Error('not yet implemented')
  }

  proposeRewrites(_args: {
    bulletId: string
    flagIndex: number
  }): Promise<unknown> {
    throw new Error('not yet implemented')
  }

  currentResume(): Resume {
    throw new Error('not yet implemented')
  }

  editBullet(_args: { bulletId: string; newText: string }): void {
    throw new Error('not yet implemented')
  }

  endInterrogation(): void {
    throw new Error('not yet implemented')
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
