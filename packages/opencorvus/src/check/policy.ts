import { z } from "zod"

export const CheckSelector = z.enum([
  "build",
  "test",
  "lint",
  "verify_cmd",
  "ui_review",
  "code_quality",
  "code_review",
  "dead_code_review",
  "startup",
  "spec_check",
])
export type CheckSelector = z.infer<typeof CheckSelector>

export const CheckFamily = z.enum(["build", "test", "lint", "verify_cmd"])
export type CheckFamily = z.infer<typeof CheckFamily>

export function inferSelectors(text: string): CheckSelector[] {
  const lower = text.toLowerCase()
  const selectors = new Set<CheckSelector>()
  if (lower.includes("build")) selectors.add("build")
  if (lower.includes("test") || lower.includes("regression") || lower.includes("coverage")) selectors.add("test")
  if (lower.includes("lint")) selectors.add("lint")
  if (lower.includes("verify")) selectors.add("verify_cmd")
  if (/(ui|ux|design|layout|页面|界面|交互|体验|accessibility)/.test(lower)) selectors.add("ui_review")
  if (/(code quality|maintain|readab|review|refactor|代码质量|可维护|可读)/.test(lower)) selectors.add("code_quality")
  if (/\bcr\b|code review|审查|代码评审|review finding|review comment/.test(lower)) selectors.add("code_review")
  if (/(dead code|unused code|unused export|obsolete|stale branch|死代码|无用代码|废弃分支|清理旧代码)/.test(lower))
    selectors.add("dead_code_review")
  if (/(startup|start normally|starts normally|boot|launch|serve|server|启动|运行起来|正常启动)/.test(lower))
    selectors.add("startup")
  return [...selectors]
}

export function inferFamily(key: string): CheckFamily {
  const lower = key.toLowerCase()
  if (lower.includes("test") || lower.includes("pytest")) return "test"
  if (lower.includes("lint") || lower.includes("type") || lower.includes("ruff") || lower.includes("mypy"))
    return "lint"
  if (lower.includes("verify")) return "verify_cmd"
  return "build"
}

export function matchSelectors<T extends { name: string; status: string }>(
  selectors: string[],
  checks: T[],
): T[] {
  return checks.filter((check) =>
    selectors.some((selector) => matches(selector, check.name)),
  )
}

export function selectorsSatisfied(
  selectors: string[],
  checks: Array<{ name: string; status: string }>,
): boolean {
  // Exclude skipped checks — a skipped check provides no evidence that the
  // check actually ran, so it should not block goal completion. This prevents
  // meta-checks like "evaluation_config: skipped" (emitted when no commands
  // are configured) from falsely matching family selectors like "build" via
  // inferFamily's fallback and causing goals to stay "pending".
  const activeChecks = checks.filter((check) => check.status !== "skipped")
  const relevant = selectors.filter((selector) =>
    activeChecks.some((check) => matches(selector, check.name)),
  )
  if (relevant.length === 0) return true
  return relevant.every((selector) =>
    activeChecks.some(
      (check) =>
        matches(selector, check.name) && check.status === "passed",
    ),
  )
}

function matches(selector: string, name: string) {
  if (name === selector || name.startsWith(`${selector}#`)) return true
  if (!CheckFamily.safeParse(selector).success) return false
  return inferFamily(name) === selector
}

export function selectorList(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object") return []
  const value = (metadata as Record<string, unknown>).check_selector
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.length > 0)
}

export function verificationHints(selectors: string[], text: string): string[] {
  const lower = text.toLowerCase()
  const hints: string[] = []

  if (selectors.includes("build") || lower.includes("build") || lower.includes("tsc") || lower.includes("compile")) {
    hints.push("Check build output for compilation errors")
  }
  if (selectors.includes("test") || lower.includes("test") || lower.includes("bun test") || lower.includes("jest")) {
    hints.push("Check test output for assertion failures, read test file to understand what was expected")
  }
  if (selectors.includes("lint") || lower.includes("lint") || lower.includes("eslint")) {
    hints.push("Check lint output for violations")
  }
  if (
    selectors.includes("code_quality") ||
    selectors.includes("code_review") ||
    lower.includes("quality") ||
    lower.includes("review")
  ) {
    hints.push("Read changed files, check against preferences/conventions")
  }
  if (lower.includes("middleware") || lower.includes("中间件")) {
    hints.push("Read implementation to verify middleware chain pattern, read tests to verify behavior")
  }
  if (lower.includes("type") || lower.includes("export") || lower.includes("interface")) {
    hints.push("Read source file to verify type/export exists with correct signature")
  }

  if (hints.length === 0) {
    hints.push("Read related files and check output to verify criteria is met")
  }

  return hints
}
