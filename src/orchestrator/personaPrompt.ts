import { join } from 'node:path'
import type { Persona } from '@/schema/target'
import { render } from '@/prompts/render'

const PROMPTS_DIR = join(import.meta.dir, '..', 'prompts')

export interface PersonaAssets {
  /** Map from archetype key (e.g. 'engineering-manager') to its description body. */
  archetypes: Record<string, string>
  /** Map from tone key (e.g. 'skeptical') to its description body. */
  tones: Record<string, string>
  /** Contents of rubric/core.md. */
  rubricCore: string
  /** Contents of rubric/flags.md. */
  rubricFlags: string
  /** Contents of templates/persona-system.md. */
  systemTemplate: string
}

/**
 * Parse a markdown document with H2-headed sections.
 * Returns a record keyed by the header text (lowercased, parenthetical suffixes
 * stripped). Body is everything between this H2 and the next H2 (or end of file).
 *
 * Example: "## skeptical (default)\nBody." → { 'skeptical': 'Body.' }
 */
export function parseHeaderedMarkdown(md: string): Record<string, string> {
  const result: Record<string, string> = {}
  const lines = md.split('\n')
  let currentKey: string | null = null
  let buf: string[] = []

  const flush = () => {
    if (currentKey) {
      result[currentKey] = buf.join('\n').trim()
    }
  }

  for (const line of lines) {
    const headerMatch = line.match(/^## (.+)$/)
    if (headerMatch) {
      flush()
      const raw = headerMatch[1]!.trim()
      // Strip parenthetical suffixes like " (default)"
      const key = raw.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase()
      currentKey = key
      buf = []
    } else if (currentKey) {
      buf.push(line)
    }
  }
  flush()
  return result
}

/**
 * Load all persona-related markdown assets from disk. Cached after first call
 * within a single process — assets don't change at runtime.
 */
let cachedAssets: PersonaAssets | null = null

export async function loadPersonaAssets(): Promise<PersonaAssets> {
  if (cachedAssets) return cachedAssets

  const [archetypesMd, tonesMd, rubricCore, rubricFlags, systemTemplate] = await Promise.all([
    Bun.file(join(PROMPTS_DIR, 'personas/archetypes.md')).text(),
    Bun.file(join(PROMPTS_DIR, 'personas/tones.md')).text(),
    Bun.file(join(PROMPTS_DIR, 'rubric/core.md')).text(),
    Bun.file(join(PROMPTS_DIR, 'rubric/flags.md')).text(),
    Bun.file(join(PROMPTS_DIR, 'templates/persona-system.md')).text(),
  ])

  cachedAssets = {
    archetypes: parseHeaderedMarkdown(archetypesMd),
    tones: parseHeaderedMarkdown(tonesMd),
    rubricCore,
    rubricFlags,
    systemTemplate,
  }
  return cachedAssets
}

/** Test-only: clear the cached assets so a test can reload them. */
export function _resetAssetsCacheForTesting(): void {
  cachedAssets = null
}

export interface BuildPersonaOptions {
  /** Optional JD-grounded standards block. When set, includes the conditional in the prompt. */
  jdOverlay?: string
}

/**
 * Assemble the persona system prompt by filling slots in the persona-system
 * template with the chosen archetype/tone and the rubric core text.
 */
export async function buildPersonaSystemPrompt(
  persona: Persona,
  options: BuildPersonaOptions,
): Promise<string> {
  const assets = await loadPersonaAssets()

  const archetype = assets.archetypes[persona.archetype]
  if (!archetype) {
    throw new Error(`Unknown archetype: ${persona.archetype}`)
  }
  const tone = assets.tones[persona.tone]
  if (!tone) {
    throw new Error(`Unknown tone: ${persona.tone}`)
  }

  return render(assets.systemTemplate, {
    archetype,
    tone,
    rubric_core: assets.rubricCore,
    jdOverlay: options.jdOverlay ?? '',
  })
}
