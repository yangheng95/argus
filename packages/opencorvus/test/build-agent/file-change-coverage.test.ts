import { describe, expect, test } from "bun:test"
import { fileChangeExplanationCoverageError } from "../../src/build/agent"

describe("build file-change collaboration report", () => {
  test("passes when every actual diff has one build-agent explanation", () => {
    const error = fileChangeExplanationCoverageError({
      diffs: [{ file: "src/App.tsx" }, { file: "src/feature.ts" }],
      reported: [{ path: "./src/App.tsx" }, { path: "src\\feature.ts" }],
    })
    expect(error).toBeUndefined()
  })

  test("fails when a changed file is not explained", () => {
    const error = fileChangeExplanationCoverageError({
      diffs: [{ file: "src/App.tsx" }, { file: "src/feature.ts" }],
      reported: [{ path: "src/App.tsx" }],
    })
    expect(error).toContain("missing explanations for changed files: src/feature.ts")
  })

  test("fails when the report claims a file that git did not change", () => {
    const error = fileChangeExplanationCoverageError({
      diffs: [{ file: "src/App.tsx" }],
      reported: [{ path: "src/App.tsx" }, { path: "src/phantom.ts" }],
    })
    expect(error).toContain("reported files not present in git diff: src/phantom.ts")
  })
})
