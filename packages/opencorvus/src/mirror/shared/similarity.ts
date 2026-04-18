/**
 * Bigram overlap (Dice coefficient) similarity.
 * Ported from mirror/src/infra/utils/similarity.ts.
 *
 * Used as a regression guard: repairs/refines with similarity below the
 * adaptive threshold are rejected to prevent destructive edits.
 */

import { Log } from "@/util/log"

const log = Log.create({ service: "mirror.similarity" })

/** Bigram Dice coefficient in [0, 1]. Returns 1 for identical strings, 0 for strings shorter than 2 chars. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0

  const bigrams = (s: string) => {
    const set = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2)
      set.set(bg, (set.get(bg) ?? 0) + 1)
    }
    return set
  }

  const aGrams = bigrams(a)
  const bGrams = bigrams(b)
  let overlap = 0
  for (const [bg, count] of aGrams) {
    overlap += Math.min(count, bGrams.get(bg) ?? 0)
  }

  return (2 * overlap) / (a.length - 1 + b.length - 1)
}

/** Minimum similarity for files >= 2000 chars. */
export const MIN_SIMILARITY = 0.4

/**
 * Adaptive threshold — smaller files tolerate larger bigram divergence.
 *   < 500 chars  → 0.15 (very lenient)
 *   < 2000 chars → 0.25 (moderate)
 *   >= 2000 chars → 0.40 (standard)
 */
export function adaptiveMinSimilarity(originalLength: number): number {
  if (originalLength < 500) return 0.15
  if (originalLength < 2000) return 0.25
  return MIN_SIMILARITY
}

export interface SimilarityGuardResult {
  accepted: boolean
  code: string
  similarity: number
  threshold: number
}

/**
 * Reject modifications whose bigram similarity to the original is below the
 * adaptive threshold. On rejection returns the original code unchanged.
 *
 * Callers get `{ accepted, code, similarity, threshold }` so they can report
 * a structured rejection event. `filePath` and `tag` are only used for logging.
 */
export function similarityGuard(
  original: string,
  modified: string,
  filePath: string,
  tag: string,
): SimilarityGuardResult {
  const sim = similarity(original, modified)
  const threshold = adaptiveMinSimilarity(original.length)
  if (sim < threshold) {
    log.warn("similarity guard rejected modification", {
      tag,
      filePath,
      similarity: sim,
      threshold,
      originalLength: original.length,
    })
    return { accepted: false, code: original, similarity: sim, threshold }
  }
  return { accepted: true, code: modified, similarity: sim, threshold }
}
