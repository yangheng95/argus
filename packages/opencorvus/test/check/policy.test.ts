import { describe, expect, test } from "bun:test"
import { matchSelectors, selectorsSatisfied } from "../../src/check/policy"

describe("check policy", () => {
  test("lint selector does not match typecheck by name", () => {
    // inferFamily always returns "build", so "typecheck" is not in the "lint" family.
    // lint selector only matches checks literally named "lint" or "lint#N".
    const checks = [{ name: "typecheck", status: "passed" as const }]

    expect(matchSelectors(["lint"], checks)).toEqual([])
    expect(selectorsSatisfied(["lint"], checks)).toBe(false)
  })

  test("lint selector matches actual lint checks", () => {
    const checks = [{ name: "lint", status: "passed" as const }]
    expect(matchSelectors(["lint"], checks)).toEqual(checks)
    expect(selectorsSatisfied(["lint"], checks)).toBe(true)
  })

  test("keeps spec_check matching exact", () => {
    const checks = [{ name: "typecheck", status: "passed" as const }]

    expect(matchSelectors(["spec_check"], checks)).toEqual([])
    expect(selectorsSatisfied(["spec_check"], [{ name: "spec_check", status: "passed" }])).toBe(true)
  })

  test("unmatched selectors fail instead of silently passing", () => {
    // selector references a check that never ran → should NOT pass
    expect(selectorsSatisfied(["spec_check"], [{ name: "build", status: "passed" }])).toBe(false)

    // multiple selectors, none match → should NOT pass
    expect(
      selectorsSatisfied(
        ["spec_check", "code_review"],
        [
          { name: "build", status: "passed" },
          { name: "test", status: "passed" },
        ],
      ),
    ).toBe(false)
  })

  test("empty selectors always pass", () => {
    expect(selectorsSatisfied([], [{ name: "build", status: "passed" }])).toBe(true)
    expect(selectorsSatisfied([], [])).toBe(true)
  })

  test("mixed matched and unmatched selectors fail", () => {
    // "build" matches and passes, but "spec_check" has no matching check
    expect(selectorsSatisfied(["build", "spec_check"], [{ name: "build", status: "passed" }])).toBe(false)
  })
})
