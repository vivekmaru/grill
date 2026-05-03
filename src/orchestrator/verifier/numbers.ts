/**
 * Extract numeric tokens from text. Returns a Set of normalized tokens.
 *
 * Used by the Tier-1 deterministic verifier in sub-plan 3 to detect when a
 * rewrite has invented numbers not present in the source. Unused in v2 (the
 * rewrite-wordsmith path forbids new numbers by prompt rule alone).
 */

const PATTERNS: ReadonlyArray<RegExp> = [
  /\$\d+(?:\.\d+)?[KMB]\b/gi,       // $1.2M, $500k, $10B
  /\$\d+(?:,\d{3})*(?:\.\d+)?\b/g,  // $250, $1,200, $1,234.56
  /\b\d+(?:\.\d+)?\s*%/g,           // 30%, 2.5%, 30 %
  /\b\d+(?:\.\d+)?x\b/gi,           // 10x, 2.5X
  /\b\d+(?:,\d{3})+\b/g,            // 1,200, 1,000,000
  /\b\d{3,}\b/g,                    // 100, 1234 — 3+ digits stand alone
  /\b\d+(?=\s+(?:engineer|engineers|team|teams|service|services|user|users|customer|customers|report|reports|people|person|month|months|year|years|week|weeks|day|days)\b)/gi,
]

export function extractNumbers(text: string): Set<string> {
  const out = new Set<string>()
  for (const pattern of PATTERNS) {
    const matches = text.match(pattern)
    if (!matches) continue
    for (const m of matches) {
      // Normalize: remove spaces, lowercase
      const normalized = m.replace(/\s+/g, '').toLowerCase()
      out.add(normalized)
    }
  }
  return out
}
