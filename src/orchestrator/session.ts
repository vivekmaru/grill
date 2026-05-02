import type { Database } from 'bun:sqlite'
import type { ProviderAdapter } from '@/prompts/adapters/types'
import type { Event } from '@/schema/events'
import type { Resume } from '@/schema/resume'
import type { TargetContext } from '@/schema/target'
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
  // used by subsequent tasks (ingestResume, etc.)
  // @ts-ignore TS6138 — populated now, consumed in later task methods
  private readonly resumes: ResumeRepo
  private readonly history: HistoryRepo
  // @ts-ignore TS6138 — populated now, consumed in later task methods
  private readonly modelCalls: ModelCallsRepo
  private readonly budget: BudgetEnforcer

  private constructor(
    private readonly id: number,
    private readonly db: Database,
    // @ts-ignore TS6138 — used in subsequent task methods
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

  ingestResume(_input: {
    kind: 'markdown' | 'blank'
    text?: string
  }): Promise<Resume> {
    throw new Error('not yet implemented')
  }

  setTarget(_ctx: TargetContext): void {
    throw new Error('not yet implemented')
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
