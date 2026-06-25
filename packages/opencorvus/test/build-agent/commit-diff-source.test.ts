import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "node:fs/promises"
import path from "node:path"
import { collectGoalContributionDiffs, resolveGoalContributionRefs } from "../../src/build/agent"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { tmpdir } from "../fixture/fixture"

describe("build agent commit diff source", () => {
  test("does not treat nested runtime files from the parent repo as goal commit diffs", async () => {
    await using tmp = await tmpdir({ git: true })
    const baseRef = (await $`git rev-parse HEAD`.cwd(tmp.path).text()).trim()
    const worktreeDir = ProjectRuntimePaths.directBuildWorktreeDir(tmp.path, "tsk_commit_diff", "ses_commit_diff")
    const runtimeFile = path.join(worktreeDir, "package.json")
    const relativeRuntimeFile = path.relative(tmp.path, runtimeFile).replaceAll("\\", "/")

    await fs.mkdir(worktreeDir, { recursive: true })
    await fs.writeFile(runtimeFile, '{"version":"1.0.0"}\n')
    await $`git add -f ${relativeRuntimeFile}`.cwd(tmp.path).quiet()
    await $`git commit -m "force-track runtime worktree file"`.cwd(tmp.path).quiet()
    await fs.writeFile(runtimeFile, '{"version":"1.0.1"}\n')
    await $`git add -f ${relativeRuntimeFile}`.cwd(tmp.path).quiet()
    await $`git commit -m "modify runtime worktree file"`.cwd(tmp.path).quiet()

    const diffs = await collectGoalContributionDiffs(worktreeDir, baseRef)
    expect(diffs).toEqual([])
  })

  test("filters host-provided evidence input directories from goal diffs", async () => {
    await using tmp = await tmpdir({ git: true })
    const baseRef = (await $`git rev-parse HEAD`.cwd(tmp.path).text()).trim()

    await fs.mkdir(path.join(tmp.path, "web-clone-source"), { recursive: true })
    await fs.writeFile(path.join(tmp.path, "web-clone-source", "README.md"), "evidence\n")
    await fs.writeFile(path.join(tmp.path, "app.ts"), "export const value = 1\n")
    await $`git add app.ts web-clone-source/README.md`.cwd(tmp.path).quiet()
    await $`git commit -m "goal changes"`.cwd(tmp.path).quiet()

    const diffs = await collectGoalContributionDiffs(tmp.path, baseRef)
    expect(diffs.map((diff) => diff.file)).toEqual(["app.ts"])
  })

  test("captures full content for added goal files", async () => {
    await using tmp = await tmpdir({ git: true })
    const baseRef = (await $`git rev-parse HEAD`.cwd(tmp.path).text()).trim()

    await fs.writeFile(path.join(tmp.path, "new-added.ts"), "export const added = true\n")
    await $`git add new-added.ts`.cwd(tmp.path).quiet()
    await $`git commit -m "add goal file"`.cwd(tmp.path).quiet()

    const diffs = await collectGoalContributionDiffs(tmp.path, baseRef)
    expect(diffs).toContainEqual({
      file: "new-added.ts",
      before: "",
      after: "export const added = true\n",
      additions: 1,
      deletions: 0,
      status: "added",
    })
  })

  test("reports contribution refs separately from merge publication refs", async () => {
    await using tmp = await tmpdir({ git: true })
    const baseRef = (await $`git rev-parse HEAD`.cwd(tmp.path).text()).trim()
    const primaryBranch = (await $`git branch --show-current`.cwd(tmp.path).text()).trim()

    await $`git checkout -b goal-branch`.cwd(tmp.path).quiet()
    await fs.writeFile(path.join(tmp.path, "goal.md"), "goal contribution\n")
    await $`git add goal.md`.cwd(tmp.path).quiet()
    await $`git commit -m "goal contribution"`.cwd(tmp.path).quiet()
    const goalCommit = (await $`git rev-parse HEAD`.cwd(tmp.path).text()).trim()

    await $`git checkout ${primaryBranch}`.cwd(tmp.path).quiet()
    await fs.writeFile(path.join(tmp.path, "primary.md"), "primary contribution\n")
    await $`git add primary.md`.cwd(tmp.path).quiet()
    await $`git commit -m "primary moved"`.cwd(tmp.path).quiet()
    const primaryCommit = (await $`git rev-parse HEAD`.cwd(tmp.path).text()).trim()

    await $`git checkout goal-branch`.cwd(tmp.path).quiet()
    await $`git merge --no-edit ${primaryBranch}`.cwd(tmp.path).quiet()
    const mergeCommit = (await $`git rev-parse HEAD`.cwd(tmp.path).text()).trim()

    const refs = await resolveGoalContributionRefs(tmp.path, baseRef)
    expect(refs.contributionCommitRef).toBe(goalCommit)
    expect(refs.diffBaseRef).toBe(primaryCommit)
    expect(refs.diffHeadRef).toBe(mergeCommit)

    const diffs = await collectGoalContributionDiffs(tmp.path, baseRef)
    expect(diffs.map((diff) => diff.file)).toEqual(["goal.md"])
  })
})
