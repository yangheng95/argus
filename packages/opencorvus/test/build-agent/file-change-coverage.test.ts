import { $ } from "bun"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { fileChangeExplanationCoverageError, resolveGoalContributionBaseRef } from "../../src/build/agent"
import { tmpdir } from "../fixture/fixture"

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

  test("audits only this goal contribution after merge_back integrates sibling goal files", async () => {
    await using tmp = await tmpdir({ git: true })
    const baseRef = (await $`git rev-parse HEAD`.cwd(tmp.path).quiet().text()).trim()

    await $`git checkout -b goal-expression`.cwd(tmp.path).quiet()
    await Bun.write(path.join(tmp.path, "own.txt"), "expression engine\n")
    await $`git add own.txt`.cwd(tmp.path).quiet()
    await $`git commit -m "goal expression change"`.cwd(tmp.path).quiet()

    await $`git checkout master`.cwd(tmp.path).quiet()
    await Bun.write(path.join(tmp.path, "sibling.txt"), "build config\n")
    await $`git add sibling.txt`.cwd(tmp.path).quiet()
    await $`git commit -m "sibling build change"`.cwd(tmp.path).quiet()
    const primaryTip = (await $`git rev-parse HEAD`.cwd(tmp.path).quiet().text()).trim()

    await $`git checkout goal-expression`.cwd(tmp.path).quiet()
    await $`git merge --no-edit master`.cwd(tmp.path).quiet()

    const contributionBase = await resolveGoalContributionBaseRef(tmp.path, baseRef)
    expect(contributionBase).toBe(primaryTip)

    const files = (await $`git diff --name-only ${contributionBase} HEAD -- .`.cwd(tmp.path).quiet().text())
      .trim()
      .split("\n")
      .filter(Boolean)
    expect(files).toEqual(["own.txt"])
  })
})
