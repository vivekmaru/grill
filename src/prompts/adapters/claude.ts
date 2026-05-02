import type { ProviderAdapter } from './types'
import { AdapterError } from './types'

export interface ClaudeAdapterConfig {
  /** Path or name of the Claude CLI binary. Typically 'claude'. */
  bin: string
  /** When true, --bare flag is passed and ANTHROPIC_API_KEY is required. */
  bareMode: boolean
  /** Anthropic API key. Required when bareMode is true. */
  apiKey: string | undefined
  /** Model used when tier === 'main'. */
  mainModel: string
  /** Model used when tier === 'verifier'. */
  verifierModel: string
}

export function createClaudeAdapter(config: ClaudeAdapterConfig): ProviderAdapter {
  if (config.bareMode && !config.apiKey) {
    throw new AdapterError(
      'CLAUDE_BARE_MODE=true requires ANTHROPIC_API_KEY. ' +
        'Set the env var or set CLAUDE_BARE_MODE=false.',
      'auth-failed',
    )
  }

  return {
    name: 'claude',
    async callInSession() {
      throw new AdapterError('not implemented yet', 'cli-error')
    },
  }
}
