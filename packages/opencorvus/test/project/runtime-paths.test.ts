import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Identifier } from "../../src/id/id"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"

describe("ProjectRuntimePaths short runtime layout", () => {
  function fanout(key: string): [string, string] {
    return [key.slice(0, 2), key.slice(2)]
  }

  test("task runtime paths use .opencorvus/r/t plus an 8-character directory key", () => {
    const root = "C:\\repo"
    const taskID = Identifier.create("task", false, 1700000000000)
    const taskKey = Identifier.directoryKey(taskID)

    expect(taskKey).toMatch(/^[0-9A-Za-z]{8}$/)
    expect(ProjectRuntimePaths.taskRoot(root, taskID)).toBe(
      path.join(root, ".opencorvus", "r", "t", ...fanout(taskKey)),
    )
    expect(ProjectRuntimePaths.intentPaths(root, taskID).relative).toBe(
      path.posix.join(".opencorvus", "r", "t", ...fanout(taskKey), "intent", "request.md"),
    )
  })

  test("goal worktree paths are flat under the short worktree root", () => {
    const root = "C:\\repo"
    const taskID = Identifier.create("task", false, 1700000000000)
    const goalID = Identifier.create("goal", false, 1700000000001)
    const runID = Identifier.create("run", false, 1700000000002)

    const actual = ProjectRuntimePaths.worktreeDir(root, taskID, goalID, runID)
    expect(actual).toBe(
      path.join(
        root,
        ".opencorvus",
        "r",
        "w",
        ...fanout(Identifier.scopedDirectoryKey("goal-run", `${taskID}:${goalID}:${runID}`)),
        "worktree",
      ),
    )
    expect(actual).not.toContain("runtime")
    expect(actual).not.toContain("tasks")
    expect(actual).not.toContain("goals")
    expect(actual).not.toContain("runs")
    expect(actual).not.toContain(taskID)
    expect(actual).not.toContain(goalID)
    expect(actual).not.toContain(runID)
  })

  test("session runtime paths are flat under the short session root", () => {
    const root = "C:\\repo"
    const taskID = Identifier.create("task", false, 1700000000000)
    const sessionID = Identifier.create("session", false, 1700000000001)

    const actual = ProjectRuntimePaths.tracePath(root, taskID, sessionID)
    expect(actual).toBe(
      path.join(
        root,
        ".opencorvus",
        "r",
        "s",
        ...fanout(Identifier.scopedDirectoryKey("task-session", `${taskID}:${sessionID}`)),
        "trace.jsonl",
      ),
    )
    expect(actual).not.toContain(taskID)
    expect(actual).not.toContain(sessionID)
  })

  test("read candidate helpers expose only the new single path", () => {
    const runtimeRoot = "C:\\repo\\.opencorvus\\r"
    const taskID = Identifier.create("task", false, 1700000000000)
    const sessionID = Identifier.create("session", false, 1700000000001)

    expect(ProjectRuntimePaths.tracePathReadCandidatesFromRuntimeRoot(runtimeRoot, taskID, sessionID)).toEqual([
      path.join(
        runtimeRoot,
        "s",
        ...fanout(Identifier.scopedDirectoryKey("task-session", `${taskID}:${sessionID}`)),
        "trace.jsonl",
      ),
    ])
  })

  test("runtime filters reject exact runtime roots and descendants", () => {
    expect(ProjectRuntimePaths.isInternalRuntimeRelativePath(".opencorvus/r")).toBe(true)
    expect(ProjectRuntimePaths.isInternalRuntimeRelativePath(".opencorvus/r/")).toBe(true)
    expect(ProjectRuntimePaths.isInternalRuntimeRelativePath(".opencorvus/r/t/ab/cdef12")).toBe(true)
    expect(ProjectRuntimePaths.isInternalRuntimeRelativePath(".opencorvus/runtime")).toBe(true)
    expect(ProjectRuntimePaths.isInternalRuntimeRelativePath(".opencorvus/worktrees")).toBe(true)
    expect(ProjectRuntimePaths.isInternalRuntimeRelativePath(".opencorvus-worktrees")).toBe(true)
    expect(ProjectRuntimePaths.isInternalRuntimeRelativePath(".opencorvus/opencorvus.jsonc")).toBe(false)
  })

  test("internalRuntimeRelativePaths keeps only host-owned runtime paths", () => {
    expect(
      ProjectRuntimePaths.internalRuntimeRelativePaths([
        "./.opencorvus/r/t/ab/cdef12/stage1/evidence-manifest-prd.md",
        ".opencorvus\\runtime\\tasks\\legacy\\frontend-design\\frontend-template.md",
        ".opencorvus/opencorvus.jsonc",
        "docs/reference/world-economy/stage1/evidence-manifest-prd.md",
      ]),
    ).toEqual([
      "./.opencorvus/r/t/ab/cdef12/stage1/evidence-manifest-prd.md",
      ".opencorvus\\runtime\\tasks\\legacy\\frontend-design\\frontend-template.md",
    ])
  })

  test("mission roots use git-style fanout under the short runtime root", () => {
    const root = "C:\\repo"
    const missionID = "tv-replay"
    const key = Identifier.scopedDirectoryKey("mission", missionID)
    expect(ProjectRuntimePaths.missionRoot(root, missionID)).toBe(
      path.join(root, ".opencorvus", "r", "m", ...fanout(key)),
    )
  })

  test("goal worktree directory plus branch naming shortens paths materially", () => {
    const root = "C:\\repo"
    const taskID = Identifier.create("task", false, 1700000000000)
    const goalID = Identifier.create("goal", false, 1700000000001)
    const runID = Identifier.create("run", false, 1700000000002)
    const oldDirectory = path.join(
      root,
      ".opencorvus",
      "runtime",
      "tasks",
      taskID,
      "goals",
      goalID,
      "runs",
      runID,
      "worktree",
    )
    const oldBranch = `opencorvus/task/${taskID.slice(0, 16)}/goal/${goalID.slice(0, 16)}/run/${runID.slice(0, 16)}`

    const newDirectory = ProjectRuntimePaths.worktreeDir(root, taskID, goalID, runID)
    const newBranch = ProjectRuntimePaths.worktreeBranch({ taskID, goalID, runID })

    expect(oldDirectory.length + oldBranch.length - (newDirectory.length + newBranch.length)).toBeGreaterThanOrEqual(
      120,
    )
  })

  test("goal worktree paths do not collide for same-millisecond goal IDs", () => {
    const root = "C:\\repo"
    const taskID = Identifier.create("task", false, 1779604252000)
    const runID = Identifier.create("run", false, 1779604253000)
    const goals = Array.from({ length: 512 }, () => Identifier.create("goal", false, 1779604254000))

    const directories = goals.map((goalID) => ProjectRuntimePaths.worktreeDir(root, taskID, goalID, runID))
    const branches = goals.map((goalID) => ProjectRuntimePaths.worktreeBranch({ taskID, goalID, runID }))

    expect(new Set(directories).size).toBe(goals.length)
    expect(new Set(branches).size).toBe(goals.length)
  })
})
