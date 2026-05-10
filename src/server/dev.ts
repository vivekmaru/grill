import index from '../client/index.html'
import { createApp } from './index'
import { createDb } from './db/client'
import { loadEnv, type Env } from '@/lib/env'
import { createCodexAdapter } from '@/prompts/adapters/codex'
import { createClaudeAdapter } from '@/prompts/adapters/claude'
import type { ProviderAdapter } from '@/prompts/adapters/types'
import type { Resume } from '@/schema/resume'

export const DEV_SERVER_IDLE_TIMEOUT_SECONDS = 255

const sampleIngest: Resume = {
  version: 1,
  contact: {
    name: 'Sample User',
    email: 'sample@example.com',
    links: [],
  },
  summary: 'Replace with your real resume.',
  roles: [
    {
      id: 'r1',
      company: 'Sample Corp',
      title: 'Engineer',
      startDate: '2022-01',
      endDate: null,
      bullets: [
        {
          id: 'b1',
          text: 'Built a thing.',
          metrics: [],
          skills: [],
          flags: [],
          sourceTurnIds: [],
          status: 'draft',
        },
      ],
    },
  ],
  skills: { categories: [] },
  education: [],
  projects: [],
  certifications: [],
}

function firstBulletIdFromPrompt(prompt: string): string {
  return prompt.match(/"bullets"\s*:\s*\[\s*\{[^}]*"id"\s*:\s*"([^"]+)"/)?.[1] ?? 'b1'
}

function createMockCodexAdapter(): ProviderAdapter {
  return {
    name: 'codex',
    async callInSession({ userPrompt, schema }) {
      let result: unknown
      if (userPrompt.includes('Return exactly 2 candidates')) {
        result = {
          candidates: [
            {
              text: 'Built a reliable CI pipeline for engineering releases.',
              evidenceMap: [
                { span: 'Built', source: 'original' },
                { span: 'reliable', source: 'connective' },
              ],
            },
            {
              text: 'Improved the CI pipeline used by the engineering team.',
              evidenceMap: [
                { span: 'CI pipeline', source: 'original' },
                { span: 'improved', source: 'connective' },
              ],
            },
          ],
        }
      } else if (userPrompt.includes('Resume to critique')) {
        const bulletId = firstBulletIdFromPrompt(userPrompt)
        result = {
          flags: [
            {
              bulletId,
              flag: 'vague',
              severity: 2,
              span: 'Built a thing.',
              why: 'A hiring manager will ask what changed and why it mattered.',
              suggestedQuestion: 'What measurable outcome did this work create?',
            },
          ],
          passSummary: {
            bulletsScanned: 1,
            bulletsFlagged: 1,
            topConcern: 'The resume needs sharper impact evidence.',
          },
        }
      } else {
        result = sampleIngest
      }
      return { result: schema.parse(result), sessionHandle: null }
    },
  }
}

async function probeCliAvailable(bin: string): Promise<boolean> {
  try {
    const proc = Bun.spawn([bin, '--version'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    return (await proc.exited) === 0
  } catch {
    return false
  }
}

export async function createDevAdapters(
  env: Env,
  processEnv: Record<string, string | undefined> = process.env,
): Promise<Record<string, ProviderAdapter>> {
  if (processEnv.RESUME_BUILDER_MOCK_CODEX === '1') {
    const mock = createMockCodexAdapter()
    return { codex: mock, claude: mock }
  }

  const [codexAvailable, claudeAvailable] = await Promise.all([
    probeCliAvailable(env.OPENAI_BIN),
    probeCliAvailable(env.CLAUDE_BIN),
  ])

  const adapters: Record<string, ProviderAdapter> = {}

  // Codex is always included as the default — even if the probe failed,
  // we still construct it so the server boots; runtime errors surface naturally.
  adapters['codex'] = createCodexAdapter({
    bin: env.OPENAI_BIN,
    mainModel: env.OPENAI_MAIN_MODEL,
    verifierModel: env.OPENAI_VERIFIER_MODEL,
  })

  if (claudeAvailable) {
    try {
      adapters['claude'] = createClaudeAdapter({
        bin: env.CLAUDE_BIN,
        bareMode: env.CLAUDE_BARE_MODE,
        apiKey: processEnv.ANTHROPIC_API_KEY,
        mainModel: env.ANTHROPIC_MAIN_MODEL,
        verifierModel: env.ANTHROPIC_VERIFIER_MODEL,
      })
    } catch (e) {
      console.warn(`[dev] Claude adapter skipped: ${(e as Error).message}`)
    }
  }

  if (!codexAvailable) {
    console.warn(`[dev] codex binary not found at "${env.OPENAI_BIN}" — sessions may fail`)
  }

  return adapters
}

if (import.meta.main) {
  const env = loadEnv(process.env)
  const db = createDb(process.env.DATABASE_FILE ?? './dev.db')
  const adapters = await createDevAdapters(env)
  const app = createApp({ db, adapters })

  const server = Bun.serve({
    port: Number(process.env.PORT ?? env.PORT),
    routes: { '/': index },
    fetch: (req) => app.fetch(req),
    idleTimeout: DEV_SERVER_IDLE_TIMEOUT_SECONDS,
    development: { hmr: true, console: true },
  })

  const providerList = Object.keys(adapters).join(', ')
  console.log(`resume-builder dev server: http://localhost:${server.port}`)
  console.log(
    process.env.RESUME_BUILDER_MOCK_CODEX === '1'
      ? 'using mock adapter (both providers)'
      : `available providers: ${providerList}`,
  )
}
