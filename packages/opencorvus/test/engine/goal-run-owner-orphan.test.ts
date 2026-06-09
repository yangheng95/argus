import { afterEach, describe, expect, test } from "bun:test"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { isGoalRunOrphaned, isRunOrphan, observeOrphanRuns } from "../../src/engine/orphan"
import { describeGoal, goalStatusByID, renderTaskDescription } from "../../src/engine/describe"
import { processOwner } from "../../src/engine/lease"
import type { GoalRunRow } from "../../src/engine/store"
import { Instance } from "../../src/project/instance"
import { Database } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const FOREIGN_OWNER = "12345:zzzz:dead00" // owner stamp from a different process
const DEAD_OWNER = "999999:zzzz:dead00" // owner stamp whose PID (process identifier) is not alive

function baseGoalRun(overrides: Partial<GoalRunRow>): GoalRunRow {
  return {
    id: "gr_x",
    task_id: "tsk_x",
    goal_id: "gol_x",
    plan_node_id: null,
    coordinator_run_id: "run_x",
    session_id: "ses_x",
    status: "running",
    retry_count: 0,
    blocking_reason: null,
    error: null,
    workspace_dir: null,
    workspace_branch: null,
    workspace_base_ref: null,
    base_ref: null,
    merge_ref: null,
    supersede_of: null,
    superseded_reason: null,
    superseded_at: null,
    metadata: null,
    owner: FOREIGN_OWNER,
    time_started: 1,
    time_completed: null,
    time_created: 1,
    time_updated: 1,
    ...overrides,
  }
}

describe("isGoalRunOrphaned — owner-stamp orphan predicate", () => {
  test("live status + foreign owner with dead PID ⇒ orphaned", () => {
    expect(
      isGoalRunOrphaned(baseGoalRun({ status: "running", owner: FOREIGN_OWNER }), processOwner(), () => false),
    ).toBe(true)
    expect(
      isGoalRunOrphaned(baseGoalRun({ status: "planning", owner: FOREIGN_OWNER }), processOwner(), () => false),
    ).toBe(true)
    expect(
      isGoalRunOrphaned(baseGoalRun({ status: "blocked", owner: FOREIGN_OWNER }), processOwner(), () => false),
    ).toBe(true)
  })

  test("live status + foreign owner with live PID ⇒ NOT orphaned", () => {
    const liveForeignOwner = `${process.pid}:other:alive0`
    expect(isGoalRunOrphaned(baseGoalRun({ status: "running", owner: liveForeignOwner }))).toBe(false)
    expect(isGoalRunOrphaned(baseGoalRun({ status: "planning", owner: liveForeignOwner }))).toBe(false)
    expect(isGoalRunOrphaned(baseGoalRun({ status: "blocked", owner: liveForeignOwner }))).toBe(false)
  })

  test("live status + current process owner ⇒ NOT orphaned (long-running same-process goal)", () => {
    expect(isGoalRunOrphaned(baseGoalRun({ status: "running", owner: processOwner() }))).toBe(false)
  })

  test("foreign owner but TERMINAL status ⇒ NOT orphaned (only live rows are flagged)", () => {
    expect(isGoalRunOrphaned(baseGoalRun({ status: "completed", owner: DEAD_OWNER }))).toBe(false)
    expect(isGoalRunOrphaned(baseGoalRun({ status: "failed", owner: DEAD_OWNER }))).toBe(false)
    expect(isGoalRunOrphaned(baseGoalRun({ status: "aborted", owner: DEAD_OWNER }))).toBe(false)
  })

  test("never-dispatched / owner-less live row ⇒ NOT orphaned", () => {
    expect(isGoalRunOrphaned(baseGoalRun({ status: "queued", owner: null }))).toBe(false)
    expect(isGoalRunOrphaned(baseGoalRun({ status: "running", owner: null }))).toBe(false)
  })
})

function seedTaskRun(taskID: string, runID: string, now: number) {
  Database.use((db) => {
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: Instance.project.id,
        source: "test",
        title: "Owner orphan",
        request: "build x",
        priority: "normal",
        time_created: now,
        time_updated: now,
        time_started: now,
      } as any)
      .run()
    db.insert(EngineArtifactTable)
      .values({
        id: runID,
        task_id: taskID,
        run_id: runID,
        kind: "run",
        label: "run-running",
        payload: {
          plan_version_id: null,
          session_id: null,
          executor: "opencorvus",
          status: "running",
          phase: "dispatch",
          blocking_reason: null,
          error: null,
          retry_count: 0,
          executor_ref: null,
          metadata: null,
          time_started: now,
          time_completed: null,
        },
        time_created: now,
        time_updated: now,
      } as any)
      .run()
  })
}

function seedGoalRun(
  taskID: string,
  runID: string,
  goalRunID: string,
  goalID: string,
  owner: string | null,
  now: number,
) {
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id: `${goalRunID}_${now}`,
        task_id: taskID,
        run_id: runID,
        goal_run_id: goalRunID,
        kind: "goal_run_attempt",
        label: "goal-run-running",
        payload: {
          goal_id: goalID,
          session_id: "ses_build",
          status: "running",
          retry_count: 0,
          blocking_reason: null,
          error: null,
          workspace_dir: null,
          owner,
          time_started: now,
          time_completed: null,
        },
        time_created: now,
        time_updated: now,
      } as any)
      .run(),
  )
}

function fakeGoal(goalID: string) {
  return {
    id: goalID,
    title: "Build the thing",
    kind: "feature",
    priority: "blocking",
    objective: "implement the thing",
    acceptance_specs: [],
    requirement_ids: [],
    owned_paths: [],
    depends_on: [],
  } as any
}

describe("owner-orphan derivation across describe / orphan (restart scenario)", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("a live goal_run stamped by a FOREIGN (restarted) process is derived dead", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = `tsk_orphan_${now}`
        const runID = `run_orphan_${now}`
        seedTaskRun(taskID, runID, now)
        seedGoalRun(taskID, runID, "grun_orphan", "gol_orphan", DEAD_OWNER, now + 1)

        // describeGoal: running status but foreign owner → not running, orphaned.
        const desc = describeGoal(fakeGoal("gol_orphan"))
        expect(desc.is_running).toBe(false)
        expect(desc.is_orphaned).toBe(true)

        // Overlay/board path: goalStatusByID (deriveGoalStatus) must also be
        // owner-aware so the goal card stops spinning after a restart.
        expect(goalStatusByID("gol_orphan")).toBe("failed")

        // run-level orphan: the run's only "live" goal_run is owner-orphaned,
        // so the run itself reads as orphan (lost its executor context).
        expect(isRunOrphan(Instance.project.id, runID)).toBe(true)
        expect(observeOrphanRuns(Instance.project.id).map((r) => r.id)).toContain(runID)

        // The orchestrator-facing markdown surfaces the orphan + redispatch hint.
        const md = renderTaskDescription({
          id: taskID,
          title: "Owner orphan",
          kind: "workflow",
          status: "active",
          request: "build x",
          goals: [desc],
          budget: { runs_used: 1, fix_count: 0, max_executor_groups: 3 },
          iterations_count: 0,
        } as any)
        expect(md).toContain("ORPHANED")
      },
    })
  })

  test("a live goal_run stamped by THIS process is still alive (no false positive)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = `tsk_live_${now}`
        const runID = `run_live_${now}`
        seedTaskRun(taskID, runID, now)
        seedGoalRun(taskID, runID, "grun_live", "gol_live", processOwner(), now + 1)

        const desc = describeGoal(fakeGoal("gol_live"))
        expect(desc.is_running).toBe(true)
        expect(desc.is_orphaned).toBe(false)
        expect(goalStatusByID("gol_live")).toBe("running")

        expect(isRunOrphan(Instance.project.id, runID)).toBe(false)
        expect(observeOrphanRuns(Instance.project.id).map((r) => r.id)).not.toContain(runID)
      },
    })
  })

  test("a live goal_run stamped by another live owner remains running", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = `tsk_live_foreign_${now}`
        const runID = `run_live_foreign_${now}`
        seedTaskRun(taskID, runID, now)
        seedGoalRun(taskID, runID, "grun_live_foreign", "gol_live_foreign", `${process.pid}:other:alive0`, now + 1)

        const desc = describeGoal(fakeGoal("gol_live_foreign"))
        expect(desc.is_running).toBe(true)
        expect(desc.is_orphaned).toBe(false)
        expect(goalStatusByID("gol_live_foreign")).toBe("running")

        expect(isRunOrphan(Instance.project.id, runID)).toBe(false)
        expect(observeOrphanRuns(Instance.project.id).map((r) => r.id)).not.toContain(runID)
      },
    })
  })
})
