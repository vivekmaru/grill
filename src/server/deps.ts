import type { Database } from 'bun:sqlite'
import type { ProviderAdapter } from '@/prompts/adapters/types'

export interface AppDeps {
  db: Database
  adapter: ProviderAdapter
}
