/**
 * Check definitions registry — single source of truth.
 *
 * Defines all built-in check names, labels, families, and classification.
 * Used by evaluator/service.ts (execution) and orchestrator/checks.ts
 * (selection/merging).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckDef {
  name: string
  label: string
  family: string
}

// ---------------------------------------------------------------------------
// Definitions (order matters for BUILTIN_CHECK_INDEX ordering)
// ---------------------------------------------------------------------------

/** Core checks — always present in default selector sets */
export const CORE_CHECK_NAMES = ["build", "test", "lint", "verify_cmd"] as const

export const CORE_CHECK_DEFS = [
  { name: "build", label: "Build", family: "build" },
  { name: "test", label: "Unit Tests", family: "test" },
  { name: "lint", label: "Lint", family: "lint" },
  { name: "verify_cmd", label: "Verify Command", family: "verify_cmd" },
] as const satisfies readonly CheckDef[]

/** LLM-based review checks */
export const REVIEW_CHECK_NAMES = ["spec_check"] as const

/** Runtime checks (need live process or browser) */
export const RUNTIME_CHECK_NAMES = ["startup", "visual", "puppeteer"] as const

// Full ordered list of optional check names
export const OPTIONAL_CHECK_NAMES = [
  "startup", "artifact", "visual", "puppeteer",
  ...REVIEW_CHECK_NAMES,
] as const

// ---------------------------------------------------------------------------
// Index (name → metadata)
// ---------------------------------------------------------------------------

export const BUILTIN_CHECK_INDEX = new Map<string, { label: string; family: string; order: number }>()

// Populated at module load from the canonical CORE + OPTIONAL lists
const ALL_CHECK_DEFS: CheckDef[] = [
  ...CORE_CHECK_DEFS,
  { name: "startup", label: "Startup", family: "runtime" },
  { name: "artifact", label: "Artifacts", family: "artifact" },
  { name: "visual", label: "Visual Check", family: "runtime" },
  { name: "puppeteer", label: "Puppeteer", family: "runtime" },
  { name: "spec_check", label: "Spec Check", family: "acceptance" },
]

for (let i = 0; i < ALL_CHECK_DEFS.length; i++) {
  const def = ALL_CHECK_DEFS[i]
  BUILTIN_CHECK_INDEX.set(def.name, { label: def.label, family: def.family, order: i })
}

// ---------------------------------------------------------------------------
// Classification helpers (used by orchestrator/checks.ts)
// ---------------------------------------------------------------------------

const CORE_SET = new Set<string>(CORE_CHECK_NAMES)
const REVIEW_SET = new Set<string>(REVIEW_CHECK_NAMES)
const RUNTIME_SET = new Set<string>(RUNTIME_CHECK_NAMES)

/** Returns true if `name` is a core check (build/test/lint/verify_cmd). */
export function isCoreCheck(name: string) { return CORE_SET.has(name) }

/** Returns true if `name` is a review/acceptance check that supports `enabled` flag. */
export function isReviewCheck(name: string) { return REVIEW_SET.has(name) }

/** Returns true if `name` is a runtime check (startup/visual/puppeteer). */
export function isRuntimeCheck(name: string) { return RUNTIME_SET.has(name) }

/** Look up a check definition by name. */
export function getCheckDef(name: string) { return BUILTIN_CHECK_INDEX.get(name) }
