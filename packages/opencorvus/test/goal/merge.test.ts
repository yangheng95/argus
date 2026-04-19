import { describe, expect, test } from "bun:test"
import { validateOwnedPathsDetailed } from "../../src/goal/merge"

describe("validateOwnedPathsDetailed", () => {
  test("reports a concrete nested-path drift message", () => {
    const result = validateOwnedPathsDetailed(
      ["src/src/app/layout.tsx"],
      ["src/app/layout.tsx"],
    )

    expect(result.valid).toBe(false)
    expect(result.violations).toEqual(["src/src/app/layout.tsx"])
    expect(result.details).toEqual([{
      file: "src/src/app/layout.tsx",
      expected: "src/app/layout.tsx",
      message: "wrote src/src/app/layout.tsx but owned_paths declares src/app/layout.tsx",
    }])
  })

  test("keeps known shared files exempt from owned_paths drift", () => {
    const result = validateOwnedPathsDetailed(
      ["src/note-store.ts", "package.json"],
      ["src/note-store.ts"],
    )

    expect(result.valid).toBe(true)
    expect(result.violations).toEqual([])
    expect(result.details).toEqual([])
  })
})
