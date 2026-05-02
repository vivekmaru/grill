import index from '../client/index.html'
import { createApp } from './index'
import { createDb } from './db/client'
import type { ProviderAdapter } from '@/prompts/adapters/types'
import type { Resume } from '@/schema/resume'

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

const stubAdapter: ProviderAdapter = {
  name: 'claude',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callInSession: async (_args): Promise<{ result: any; sessionHandle: null }> => ({
    result: sampleIngest,
    sessionHandle: null,
  }),
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
