import type { Database } from 'bun:sqlite'
import type { ProviderAdapter } from '@/prompts/adapters/types'

export interface AppDeps {
  db: Database
  adapters: Record<string, ProviderAdapter>
}

/**
 * Pick the adapter for the given provider name, falling back to codex.
 * Always returns something — codex is guaranteed to be in the map.
 */
export function resolveAdapter(
  adapters: Record<string, ProviderAdapter>,
  provider: string,
): ProviderAdapter {
  const adapter = adapters[provider] ?? adapters['codex']
  if (!adapter) throw new Error(`No adapter for "${provider}" and codex fallback missing`)
  return adapter
}
