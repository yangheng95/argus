/**
 * Check-selector inference — single source of truth.
 *
 * Used by planner/service.ts (plan-time) and orchestrator/transition.ts
 * (goal compilation). Consolidates the duplicated regex-based selector
 * matching that was previously spread across 3 files.
 */

// ---------------------------------------------------------------------------
// Selector rule definitions
// ---------------------------------------------------------------------------

interface SelectorRule {
  /** Selector name as used by evaluator check definitions */
  name: string
  /** Regex pattern tested against lowercased text */
  pattern: RegExp
}

/**
 * Default selectors that are always included for request-level inference.
 * Goal-level inference does NOT include these by default — it only adds
 * selectors that are explicitly mentioned in the goal text.
 */
export const DEFAULT_SELECTORS = ["build", "test", "lint", "verify_cmd"] as const

/**
 * Optional selector rules — checked via regex match on the input text.
 * Shared between `inferSelectors` (request-level) and `inferGoalSelectors`
 * (goal-level).
 */
const SELECTOR_RULES: SelectorRule[] = [
  { name: "ui_review",       pattern: /(ui|ux|design|layout|页面|界面|交互|体验|accessibility)/ },
  { name: "code_quality",    pattern: /(code quality|maintain|readab|review|refactor|代码质量|可维护|可读)/ },
  { name: "code_review",     pattern: /\bcr\b|code review|审查|代码评审|review finding|review comment/ },
  { name: "dead_code_review", pattern: /(dead code|unused code|unused export|obsolete|stale branch|死代码|无用代码|废弃分支|清理旧代码)/ },
  { name: "startup",         pattern: /(startup|start normally|starts normally|boot|launch|serve|server|启动|运行起来|正常启动)/ },
]

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Infer check selectors from a user request string.
 * Always includes the DEFAULT_SELECTORS plus any matched optional rules.
 */
export function inferSelectors(request: string): string[] {
  const lower = request.toLowerCase()
  const selectors = new Set<string>(DEFAULT_SELECTORS)
  for (const rule of SELECTOR_RULES) {
    if (rule.pattern.test(lower)) selectors.add(rule.name)
  }
  return [...selectors]
}

/**
 * Infer check selectors from a goal's description and criteria.
 * Does NOT include default selectors — only adds selectors explicitly
 * mentioned in the goal text. Also checks for simple keyword matches
 * ("build", "test", "lint", "verify") that the regex rules don't cover.
 *
 * Returns `{ check_selector: string[] }` or `undefined` if nothing matched.
 */
export function inferGoalSelectors(
  description: string,
  criteria: string,
): { check_selector: string[] } | undefined {
  const text = `${description} ${criteria}`.toLowerCase()
  const selectors = new Set<string>()

  // Simple keyword checks for core selectors
  if (text.includes("build")) selectors.add("build")
  if (text.includes("test")) selectors.add("test")
  if (text.includes("lint")) selectors.add("lint")
  if (text.includes("verify")) selectors.add("verify_cmd")

  // Optional selector rules
  for (const rule of SELECTOR_RULES) {
    if (rule.pattern.test(text)) selectors.add(rule.name)
  }

  if (selectors.size === 0) return undefined
  return { check_selector: [...selectors] }
}
