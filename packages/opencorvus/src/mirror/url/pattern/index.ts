/**
 * URL pattern-analysis entry.
 *
 * `analyzePage(page) → ProjectScaffold` is the only public function this
 * module exports for consumption by skills. Internal helpers
 * (`detectPatterns`, `extractTokenSystem`, `generateScaffold`,
 * `scaffoldToPlan`, …) are re-exported for completeness but skills are
 * expected to go through `analyzePage`.
 *
 * Ported from `mirror/src/infra/pattern/index.ts`. Includes the same
 * `optimizeTree` pre-step that collapses wrapper divs and drops zero-height
 * empties before analysis.
 */

import type { ExtractedElement, ExtractedPage } from "../../ir/extracted-page"
import type { ProjectScaffold } from "../../ir/scaffold"

import { detectPatterns } from "./detect"
import { extractTokenSystem } from "./tokens"
import { generateScaffold, generateSurfaceCandidates } from "./contract"

// Re-export for test / skill introspection.
export { detectPatterns, extractTokenSystem, generateScaffold, generateSurfaceCandidates }
export {
  scaffoldToPlan,
  generateTokensFile,
  generateAppViewFile,
  generateViewSourceFiles,
  materializeScaffoldForReactSource,
  buildSharedContext,
} from "../../shared/scaffold-helpers"
export {
  fingerprint,
  fingerprintBounded,
  fingerprintSimilarity,
  collectFingerprints,
  countElements,
} from "./fingerprint"

// ─── Tree optimisation pre-step ──────────────────────────────────────────

/**
 * Collapse single-child wrapper `<div>`s and drop zero-height empty elements.
 * Returns `null` when the element should be removed entirely.
 *
 * This pre-step prevents bloated section IR and false pattern matches on
 * meaningless wrappers.
 */
function optimizeTree(el: ExtractedElement): ExtractedElement | null {
  if (el.bounds && el.bounds.h === 0 && !el.text && (!el.children || el.children.length === 0)) {
    return null
  }

  const children = el.children
    ?.map(optimizeTree)
    .filter((c): c is ExtractedElement => c !== null)

  if (
    el.tag === "div" &&
    !el.text &&
    !el.imageSrc &&
    !el.role &&
    children &&
    children.length === 1
  ) {
    return children[0]
  }

  if (children && children.length !== (el.children?.length ?? 0)) {
    return { ...el, children }
  }

  return el
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Full deterministic analysis: `ExtractedPage` → `ProjectScaffold`.
 *
 * Pre-processes the tree (`optimizeTree`), extracts design tokens,
 * detects reusable patterns, and generates the project scaffold.
 *
 * Zero LLM, O(N), same input → same output.
 */
export function analyzePage(page: ExtractedPage): ProjectScaffold {
  const optimizedTree = page.tree
    .map(optimizeTree)
    .filter((el): el is ExtractedElement => el !== null)
  const optimizedPage: ExtractedPage = { ...page, tree: optimizedTree }

  const tokens = extractTokenSystem(optimizedPage)
  const catalog = detectPatterns(optimizedPage)
  return generateScaffold(optimizedPage, catalog, tokens)
}
