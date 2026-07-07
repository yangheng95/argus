import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Project } from "../../src/project/project"
import { tmpdir } from "../fixture/fixture"

describe("Project.localGitDirectory", () => {
  test("returns the local .git directory for a normal repository", async () => {
    await using project = await tmpdir({ git: true })

    expect(await Project.localGitDirectory(project.path)).toBe(path.join(project.path, ".git"))
  })

  test("resolves a worktree .git file target", async () => {
    await using project = await tmpdir()
    const target = path.join(project.path, "git-storage", "worktrees", "child")
    await fs.mkdir(target, { recursive: true })
    await fs.writeFile(path.join(project.path, ".git"), `gitdir: ${path.relative(project.path, target)}\n`)

    expect(await Project.localGitDirectory(project.path)).toBe(target)
  })
})
