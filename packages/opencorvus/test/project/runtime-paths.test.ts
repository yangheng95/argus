import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Identifier } from "../../src/id/id"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"

describe("ProjectRuntimePaths short ID segments", () => {
  test("goal worktree paths use short task, goal, and run segments", () => {
    const root = "C:\\repo"
    const taskID = Identifier.create("task", false, 1700000000000)
    const goalID = Identifier.create("goal", false, 1700000000001)
    const runID = Identifier.create("run", false, 1700000000002)

    const actual = ProjectRuntimePaths.worktreeDir(root, taskID, goalID, runID)
    expect(actual).toBe(
      path.join(
        root,
        ".opencorvus",
        "runtime",
        "tasks",
        Identifier.shortPath(taskID),
        "goals",
        Identifier.shortPath(goalID),
        "runs",
        Identifier.shortPath(runID),
        "worktree",
      ),
    )
    expect(actual).not.toContain(taskID)
    expect(actual).not.toContain(goalID)
    expect(actual).not.toContain(runID)
  })

  test("session runtime paths use short task and session segments", () => {
    const root = "C:\\repo"
    const taskID = Identifier.create("task", false, 1700000000000)
    const sessionID = Identifier.create("session", false, 1700000000001)

    const actual = ProjectRuntimePaths.tracePath(root, taskID, sessionID)
    expect(actual).toContain(
      path.join("tasks", Identifier.shortPath(taskID), "sessions", Identifier.shortPath(sessionID)),
    )
    expect(actual).not.toContain(taskID)
    expect(actual).not.toContain(sessionID)
  })

  test("read candidates include short path first and grandfathered full path second", () => {
    const runtimeRoot = "C:\\repo\\.opencorvus\\runtime"
    const taskID = Identifier.create("task", false, 1700000000000)
    const sessionID = Identifier.create("session", false, 1700000000001)

    expect(ProjectRuntimePaths.tracePathReadCandidatesFromRuntimeRoot(runtimeRoot, taskID, sessionID)).toEqual([
      path.join(
        runtimeRoot,
        "tasks",
        Identifier.shortPath(taskID),
        "sessions",
        Identifier.shortPath(sessionID),
        "trace.jsonl",
      ),
      path.join(
        runtimeRoot,
        "tasks",
        Identifier.shortPath(taskID),
        "sessions",
        Identifier.legacyShortPath(sessionID),
        "trace.jsonl",
      ),
      path.join(runtimeRoot, "tasks", Identifier.shortPath(taskID), "sessions", sessionID, "trace.jsonl"),
      path.join(
        runtimeRoot,
        "tasks",
        Identifier.legacyShortPath(taskID),
        "sessions",
        Identifier.shortPath(sessionID),
        "trace.jsonl",
      ),
      path.join(
        runtimeRoot,
        "tasks",
        Identifier.legacyShortPath(taskID),
        "sessions",
        Identifier.legacyShortPath(sessionID),
        "trace.jsonl",
      ),
      path.join(runtimeRoot, "tasks", Identifier.legacyShortPath(taskID), "sessions", sessionID, "trace.jsonl"),
      path.join(runtimeRoot, "tasks", taskID, "sessions", Identifier.shortPath(sessionID), "trace.jsonl"),
      path.join(runtimeRoot, "tasks", taskID, "sessions", Identifier.legacyShortPath(sessionID), "trace.jsonl"),
      path.join(runtimeRoot, "tasks", taskID, "sessions", sessionID, "trace.jsonl"),
    ])
  })

  test("goal worktree directory plus branch naming still materially shortens paths", () => {
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

    expect(oldDirectory.length + oldBranch.length - (newDirectory.length + newBranch.length)).toBeGreaterThanOrEqual(40)
  })

  test("goal worktree paths do not collide for same-millisecond goal IDs", () => {
    const root = "C:\\repo"
    const taskID = Identifier.create("task", false, 1779604252000)
    const runID = Identifier.create("run", false, 1779604253000)
    const goals = Array.from({ length: 32 }, () => Identifier.create("goal", false, 1779604254000))

    const directories = goals.map((goalID) => ProjectRuntimePaths.worktreeDir(root, taskID, goalID, runID))
    const branches = goals.map((goalID) => ProjectRuntimePaths.worktreeBranch({ taskID, goalID, runID }))

    expect(new Set(directories).size).toBe(goals.length)
    expect(new Set(branches).size).toBe(goals.length)
  })
})
