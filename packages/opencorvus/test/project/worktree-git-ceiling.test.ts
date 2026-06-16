import { describe, expect, test } from "bun:test"
import path from "path"
import { gitCeilingEnvForWorktree } from "../../src/worktree/git-ceiling"

describe("worktree git ceiling env", () => {
  test("prevents nested worktree sessions from falling through to the primary .git", () => {
    const cwd = path.join("D:", "project", ".opencorvus", "r", "w", "ab", "cdef12", "worktree")
    const env = gitCeilingEnvForWorktree(cwd)
    expect(env.GIT_CEILING_DIRECTORIES).toBe(path.join("D:", "project", ".opencorvus", "r"))
  })

  test("preserves an existing git ceiling entry", () => {
    const cwd = path.join("D:", "project", ".opencorvus", "r", "w", "ab", "cdef12", "worktree")
    const env = gitCeilingEnvForWorktree(cwd, { GIT_CEILING_DIRECTORIES: path.join("D:", "other") })
    expect(env.GIT_CEILING_DIRECTORIES).toBe(
      `${path.join("D:", "project", ".opencorvus", "r")}${path.delimiter}${path.join("D:", "other")}`,
    )
  })

  test("does not fence legacy runtime worktrees", () => {
    const cwd = path.join("D:", "project", ".opencorvus", "runtime", "worktrees", "goal-demo")
    const env = gitCeilingEnvForWorktree(cwd)
    expect(env).toEqual({})
  })

  test("does not alter non-worktree sessions", () => {
    expect(gitCeilingEnvForWorktree(path.join("D:", "project"))).toEqual({})
  })
})
