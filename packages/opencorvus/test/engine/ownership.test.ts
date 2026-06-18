import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { Ownership } from "../../src/engine/ownership"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"

let rootDir = ""

async function tempDir(label: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `ownership-${label}-`))
  return dir
}

beforeEach(async () => {
  rootDir = await tempDir("primary")
})

afterEach(async () => {
  await fs.rm(rootDir, { recursive: true, force: true }).catch(() => undefined)
})

describe("Ownership.Worktree", () => {
  test("record + list round-trips marker fields", async () => {
    const worktreeDir = path.join(rootDir, ".opencorvus", "worktrees", "demo")
    await fs.mkdir(worktreeDir, { recursive: true })

    await Ownership.Worktree.record({
      primaryWorktreeDir: rootDir,
      worktreeDir,
      taskID: "task_abc",
      sessionID: "sess_xyz",
      goalID: "goal_1",
      runID: "run_1",
    })

    const items = await Ownership.Worktree.list(rootDir)
    expect(items.length).toBe(1)
    const m = items[0].marker
    expect(m.taskID).toBe("task_abc")
    expect(m.sessionID).toBe("sess_xyz")
    expect(m.goalID).toBe("goal_1")
    expect(m.runID).toBe("run_1")
    expect(m.cwd).toBe(worktreeDir)
    expect(m.kind).toBe("worktree")
    expect(m.ownerPid).toBe(process.pid)
  })

  test("clear removes a previously recorded marker", async () => {
    const worktreeDir = path.join(rootDir, ".opencorvus", "worktrees", "demo2")
    await fs.mkdir(worktreeDir, { recursive: true })
    await Ownership.Worktree.record({
      primaryWorktreeDir: rootDir,
      worktreeDir,
      taskID: "task_clear",
      sessionID: "sess_clear",
    })
    expect((await Ownership.Worktree.list(rootDir)).length).toBe(1)
    await Ownership.Worktree.clear({ primaryWorktreeDir: rootDir, worktreeDir })
    expect((await Ownership.Worktree.list(rootDir)).length).toBe(0)
  })

  test("orphans: detects dead-owner, missing-target, unparseable", async () => {
    const liveWorktree = path.join(rootDir, ".opencorvus", "worktrees", "alive")
    const deadWorktree = path.join(rootDir, ".opencorvus", "worktrees", "dead")
    const ghostWorktree = path.join(rootDir, ".opencorvus", "worktrees", "gone")
    await fs.mkdir(liveWorktree, { recursive: true })
    await fs.mkdir(deadWorktree, { recursive: true })
    // ghostWorktree intentionally not created — simulates "marker records a
    // dir that was already deleted underneath us."

    await Ownership.Worktree.record({
      primaryWorktreeDir: rootDir,
      worktreeDir: liveWorktree,
      taskID: "task_live",
      sessionID: "sess_live",
    })
    await Ownership.Worktree.record({
      primaryWorktreeDir: rootDir,
      worktreeDir: deadWorktree,
      taskID: "task_dead",
      sessionID: "sess_dead",
      ownerPid: 999_999_998, // Won't exist; see isPidAlive stub below.
    })
    await Ownership.Worktree.record({
      primaryWorktreeDir: rootDir,
      worktreeDir: ghostWorktree,
      taskID: "task_ghost",
      sessionID: "sess_ghost",
    })

    // Drop a bad marker: simulate a partially-written marker file.
    const badMarkerPath = path.join(ProjectRuntimePaths.ownershipRoot(rootDir), "w", "garbage.json")
    await fs.mkdir(path.dirname(badMarkerPath), { recursive: true })
    await fs.writeFile(badMarkerPath, "{not-json}\n", { encoding: "utf8" })

    const orphans = await Ownership.Worktree.orphans({
      primaryWorktreeDir: rootDir,
      isPidAlive: (pid) => pid === process.pid,
    })

    const byReason = Object.fromEntries(orphans.map((o) => [o.reason, o]))

    expect(byReason["owner-process-dead"]).toBeDefined()
    expect(byReason["owner-process-dead"].marker.taskID).toBe("task_dead")
    expect(byReason["owner-process-dead"].worktreeDir).toBe(deadWorktree)

    expect(byReason["target-missing"]).toBeDefined()
    expect(byReason["target-missing"].marker.taskID).toBe("task_ghost")

    expect(byReason["marker-unparseable"]).toBeDefined()
    expect(byReason["marker-unparseable"].markerPath).toBe(badMarkerPath)

    // The live entry is not orphan.
    expect(orphans.find((o) => o.marker.taskID === "task_live")).toBeUndefined()
  })
})

describe("Ownership.Process", () => {
  test("record + list round-trips marker fields", async () => {
    await Ownership.Process.record({
      primaryWorktreeDir: rootDir,
      pid: 12345,
      cwd: rootDir,
      taskID: "task_process",
      sessionID: "sess_process",
    })
    const items = await Ownership.Process.list(rootDir)
    expect(items.length).toBe(1)
    expect(items[0].marker.ownerPid).toBe(12345)
    expect(items[0].marker.kind).toBe("process")
  })

  test("orphans: dead PIDs are reported, live PIDs are not", async () => {
    await Ownership.Process.record({
      primaryWorktreeDir: rootDir,
      pid: 999_999_999,
      cwd: rootDir,
      taskID: "task_dead_process",
      sessionID: "sess_process",
    })
    await Ownership.Process.record({
      primaryWorktreeDir: rootDir,
      pid: process.pid,
      cwd: rootDir,
      taskID: "task_live_process",
      sessionID: "sess_process",
    })

    const orphans = await Ownership.Process.orphans({
      primaryWorktreeDir: rootDir,
      isPidAlive: (pid) => pid === process.pid,
    })
    expect(orphans.length).toBe(1)
    expect(orphans[0].marker.taskID).toBe("task_dead_process")
    expect(orphans[0].reason).toBe("owner-process-dead")
  })
})

describe("Ownership.cleanup", () => {
  test("removes dead-owner dirs, clears all orphan markers, preserves live markers", async () => {
    const liveDir = path.join(rootDir, ".opencorvus", "worktrees", "live")
    const deadDir = path.join(rootDir, ".opencorvus", "worktrees", "dead")
    await fs.mkdir(liveDir, { recursive: true })
    await fs.mkdir(deadDir, { recursive: true })

    await Ownership.Worktree.record({
      primaryWorktreeDir: rootDir,
      worktreeDir: liveDir,
      taskID: "task_live",
      sessionID: "sess_live",
    })
    await Ownership.Worktree.record({
      primaryWorktreeDir: rootDir,
      worktreeDir: deadDir,
      taskID: "task_dead",
      sessionID: "sess_dead",
      ownerPid: 999_999_997,
    })
    await Ownership.Process.record({
      primaryWorktreeDir: rootDir,
      pid: 999_999_996,
      cwd: rootDir,
      taskID: "task_dead_proc",
      sessionID: "sess_dead_proc",
    })

    const removeCalls: string[] = []
    const result = await Ownership.cleanup({
      primaryWorktreeDir: rootDir,
      isPidAlive: (pid) => pid === process.pid,
      removeWorktreeDir: async (dir) => {
        removeCalls.push(dir)
        await fs.rm(dir, { recursive: true, force: true })
      },
    })

    expect(removeCalls).toEqual([deadDir])
    expect(result.worktreeDirsRemoved).toBe(1)
    expect(result.worktreeMarkersRemoved).toBe(1)
    expect(result.processMarkersRemoved).toBe(1)

    // Live marker is preserved.
    const surviving = await Ownership.Worktree.list(rootDir)
    expect(surviving.length).toBe(1)
    expect(surviving[0].marker.taskID).toBe("task_live")

    // Live directory was not touched by cleanup.
    expect(await Bun.file(path.join(liveDir, ".keep")).exists()).toBe(false)
    const liveExists = await fs
      .stat(liveDir)
      .then(() => true)
      .catch(() => false)
    expect(liveExists).toBe(true)

    // Process markers dir is empty afterwards.
    const procMarkers = await Ownership.Process.list(rootDir)
    expect(procMarkers.length).toBe(0)
  })

  test("cleanup on an empty root is a no-op", async () => {
    const result = await Ownership.cleanup({ primaryWorktreeDir: rootDir })
    expect(result.worktreeOrphans).toEqual([])
    expect(result.processOrphans).toEqual([])
    expect(result.worktreeDirsRemoved).toBe(0)
  })
})
