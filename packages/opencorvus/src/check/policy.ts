export function selectorsSatisfied(
  selectors: string[],
  checks: Array<{ name: string; status: string }>,
): boolean {
  // Exclude skipped checks — a skipped check provides no evidence that the
  // check actually ran, so it should not block goal completion.
  const activeChecks = checks.filter((check) => check.status !== "skipped")
  const relevant = selectors.filter((selector) =>
    activeChecks.some((check) => matches(selector, check.name)),
  )
  if (relevant.length === 0) {
    // If selectors matched checks in the original list but all were skipped,
    // treat as unsatisfied rather than vacuously passing
    const hadRelevant = selectors.some((selector) =>
      checks.some((check) => matches(selector, check.name)),
    )
    return !hadRelevant
  }
  return relevant.every((selector) =>
    activeChecks.some(
      (check) =>
        matches(selector, check.name) && check.status === "passed",
    ),
  )
}

function matches(selector: string, name: string) {
  if (name === selector || name.startsWith(`${selector}#`)) return true
  return false
}

export function selectorList(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object") return []
  const value = (metadata as Record<string, unknown>).check_selector
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.length > 0)
}

export function verificationHints(selectors: string[], _text: string): string[] {
  const hints: string[] = []

  if (selectors.includes("build")) {
    hints.push("Check build output for compilation errors")
  }
  if (selectors.includes("test")) {
    hints.push("Check test output for assertion failures, read test file to understand what was expected")
  }
  if (selectors.includes("lint")) {
    hints.push("Check lint output for violations")
  }
  if (selectors.includes("verify_cmd")) {
    hints.push("Check verification command output for failing assertions")
  }
  if (selectors.includes("ui_review")) {
    hints.push("Read the changed UI paths and verify the requested interaction or layout behavior")
  }
  if (selectors.includes("startup")) {
    hints.push("Check startup evidence and confirm the expected runtime entrypoint can boot")
  }
  if (selectors.includes("code_quality") || selectors.includes("code_review") || selectors.includes("dead_code_review")) {
    hints.push("Read changed files, check against preferences/conventions")
  }

  if (hints.length === 0) {
    hints.push("Read related files and explicit QA evidence to verify the goal contract is met")
  }

  return hints
}
