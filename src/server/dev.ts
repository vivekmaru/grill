import index from '../client/index.html'
import { createApp } from './index'
import { createDb } from './db/client'
import { loadEnv, type Env } from '@/lib/env'
import { createCodexAdapter } from '@/prompts/adapters/codex'
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

export function createDevAdapter(
  env: Env,
  processEnv: Record<string, string | undefined> = process.env,
): ProviderAdapter {
  if (processEnv.RESUME_BUILDER_MOCK_CODEX === '1') {
    return createMockCodexAdapter()
  }
  if (env.AI_PROVIDER !== 'codex') {
    console.warn(
      `[dev] AI_PROVIDER=${env.AI_PROVIDER} is inactive in Phase 2; using codex.`,
    )
  }
  return createCodexAdapter({
    bin: env.OPENAI_BIN,
    mainModel: env.OPENAI_MAIN_MODEL,
    verifierModel: env.OPENAI_VERIFIER_MODEL,
  })
}

if (import.meta.main) {
  const env = loadEnv(process.env)
  const db = createDb(process.env.DATABASE_FILE ?? './dev.db')
  const adapter = createDevAdapter(env)
  const app = createApp({ db, adapter })

  const server = Bun.serve({
    port: Number(process.env.PORT ?? env.PORT),
    routes: { '/': index },
    fetch: (req) => app.fetch(req),
    idleTimeout: DEV_SERVER_IDLE_TIMEOUT_SECONDS,
    development: { hmr: true, console: true },
  })

  console.log(`resume-builder dev server: http://localhost:${server.port}`)
  console.log(
    process.env.RESUME_BUILDER_MOCK_CODEX === '1'
      ? 'using mock Codex adapter'
      : `using Codex adapter (${env.OPENAI_BIN}, ${env.OPENAI_MAIN_MODEL})`,
  )
}
