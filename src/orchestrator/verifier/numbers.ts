/**
 * Extract numeric tokens from text. Returns a Set of normalized tokens.
 *
 * Used by the Tier-1 deterministic verifier in sub-plan 3 to detect when a
 * rewrite has invented numbers not present in the source. Unused in v2 (the
 * rewrite-wordsmith path forbids new numbers by prompt rule alone).
 *
 * Patterns covered:
 *   - Percentages: "30%", "2.5%"
 *   - Currency: "$1.2M", "$500K", "$10B", "$250"
 *   - Multipliers: "10x", "2.5x"
 *   - Plain integers (3+ digits OR followed by a unit-shaped word)
 */

const PATTERNS: ReadonlyArray<RegExp> = [
  /\$\d+(?:\.\d+)?[KMB]\b/g,        // $1.2M, $500K, $10B
  /\$\d+(?:,\d{3})*(?:\.\d+)?\b/g,  // $250, $1,200, $1,234.56
  /\b\d+(?:\.\d+)?%/g,              // 30%, 2.5%
  /\b\d+(?:\.\d+)?x\b/g,            // 10x, 2.5x
  /\b\d{3,}\b/g,                    // 100, 1234 — 3+ digits stand alone
  /\b\d+(?=\s+(?:engineer|engineers|team|teams|service|services|user|users|customer|customers|report|reports|people|person|month|months|year|years|week|weeks|day|days)\b)/gi,
]

export function extractNumbers(text: string): Set<string> {
  const out = new Set<string>()
  for (const pattern of PATTERNS) {
    const matches = text.match(pattern)
    if (!matches) continue
    for (const m of matches) {
      out.add(m)
    }
  }
  return out
}
