import { describe, expect, test } from "bun:test"
import { matchSelectors, selectorsSatisfied } from "../../src/check/policy"

describe("check policy", () => {
  test("matches lint selectors against typecheck-family checks", () => {
    const checks = [{ name: "typecheck", status: "passed" as const }]

    expect(matchSelectors(["lint"], checks)).toEqual(checks)
    expect(selectorsSatisfied(["lint"], checks)).toBe(true)
  })

  test("keeps spec_check matching exact", () => {
    const checks = [{ name: "typecheck", status: "passed" as const }]

    expect(matchSelectors(["spec_check"], checks)).toEqual([])
    expect(
      selectorsSatisfied(
        ["spec_check"],
        [{ name: "spec_check", status: "passed" }],
      ),
    ).toBe(true)
  })
})
