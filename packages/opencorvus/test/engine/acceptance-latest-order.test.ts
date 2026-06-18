import { afterEach, describe, expect, test } from "bun:test"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import {
  findAcceptanceByGoalRun,
  findAcceptanceByRun,
  findDeliveriesForTask,
  findLatestAcceptanceForRun,
} from "../../src/engine/store"
import { markAcceptancePublishing } from "../../src/engine/persist"
import { ProjectTable } from "../../src/project/project.sql"
import { Database, eq } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"

afterEach(async () => {
  await resetDatabase()
})

describe("acceptance latest artifact ordering", () => {
  test.serial("same-time task acceptance rows use the highest artifact id as latest", () => {
    const now = Date.now()
    const projectID = "proj_acceptance_latest_order_task"
    const taskID = "tsk_acceptance_latest_order_task"
    const runID = "run_acceptance_latest_order_task"
    const acceptanceID = "acc_acceptance_latest_order_task"

    seedTask({ projectID, taskID, now })
    insertAcceptanceArtifact({
      id: "art_acceptance_latest_order_task_a",
      taskID,
      runID,
      acceptanceID,
      status: "candidate",
      summary: "stale candidate",
      now,
    })
    insertAcceptanceArtifact({
      id: "art_acceptance_latest_order_task_z",
      taskID,
      runID,
      acceptanceID,
      status: "delivered",
      summary: "final delivered",
      now,
    })

    expect(findAcceptanceByRun(runID)?.status).toBe("delivered")
    expect(findLatestAcceptanceForRun(runID)?.status).toBe("delivered")
    expect(findDeliveriesForTask(taskID).map((row) => [row.id, row.status, row.summary])).toEqual([
      [acceptanceID, "delivered", "final delivered"],
    ])
  })

  test.serial("same-time goal-run acceptance rows use the highest artifact id as latest", () => {
    const now = Date.now()
    const projectID = "proj_acceptance_latest_order_goal"
    const taskID = "tsk_acceptance_latest_order_goal"
    const runID = "run_acceptance_latest_order_goal"
    const goalRunID = "gr_acceptance_latest_order_goal"
    const acceptanceID = "acc_acceptance_latest_order_goal"

    seedTask({ projectID, taskID, now })
    insertAcceptanceArtifact({
      id: "art_acceptance_latest_order_goal_a",
      taskID,
      runID,
      goalRunID,
      acceptanceID,
      status: "candidate",
      summary: "stale goal candidate",
      now,
    })
    insertAcceptanceArtifact({
      id: "art_acceptance_latest_order_goal_z",
      taskID,
      runID,
      goalRunID,
      acceptanceID,
      status: "delivered",
      summary: "final goal delivered",
      now,
    })

    expect(findAcceptanceByGoalRun(goalRunID)?.status).toBe("delivered")
    expect(findLatestAcceptanceForRun(runID)?.status).toBe("delivered")
    expect(findDeliveriesForTask(taskID).map((row) => [row.id, row.status, row.summary])).toEqual([
      [acceptanceID, "delivered", "final goal delivered"],
    ])
  })

  test.serial("acceptance lifecycle updates copy the same-time highest artifact id payload", () => {
    const now = Date.now()
    const projectID = "proj_acceptance_latest_order_publish"
    const taskID = "tsk_acceptance_latest_order_publish"
    const runID = "run_acceptance_latest_order_publish"
    const acceptanceID = "acc_acceptance_latest_order_publish"

    seedTask({ projectID, taskID, now })
    insertAcceptanceArtifact({
      id: "art_acceptance_latest_order_publish_a",
      taskID,
      runID,
      acceptanceID,
      status: "candidate",
      summary: "stale publish candidate",
      now,
    })
    insertAcceptanceArtifact({
      id: "art_acceptance_latest_order_publish_z",
      taskID,
      runID,
      acceptanceID,
      status: "delivered",
      summary: "final publish delivered",
      now,
    })

    markAcceptancePublishing(acceptanceID, now + 1)
    insertEvidenceForAcceptanceArtifacts({ taskID, runID, acceptanceID, now: now + 1 })

    const acceptance = findAcceptanceByRun(runID)
    expect(acceptance?.status).toBe("publishing")
    expect(acceptance?.summary).toBe("final publish delivered")
    expect(acceptance?.result?.summary).toBe("final publish delivered")
  })
})

function seedTask(input: { projectID: string; taskID: string; now: number }) {
  Database.transaction((db) => {
    db.insert(ProjectTable)
      .values({
        id: input.projectID,
        worktree: process.cwd(),
        name: input.projectID,
        sandboxes: [],
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: input.taskID,
        project_id: input.projectID,
        source: "test",
        title: input.taskID,
        request: input.taskID,
        priority: "normal",
        time_created: input.now,
        time_updated: input.now,
        time_started: input.now,
      })
      .run()
  })
}

function insertAcceptanceArtifact(input: {
  id: string
  taskID: string
  runID: string
  goalRunID?: string
  acceptanceID: string
  status: "candidate" | "delivered"
  summary: string
  now: number
}) {
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id: input.id,
        task_id: input.taskID,
        run_id: input.runID,
        goal_run_id: input.goalRunID,
        acceptance_id: input.acceptanceID,
        kind: "acceptance",
        label: input.goalRunID ? "acceptance-goal_run" : "acceptance-task",
        payload: {
          status: input.status,
          summary: input.summary,
          result: {
            summary: input.summary,
            commit_ref: null,
            changed_files: [],
            diffs: [],
            stats: { additions: 0, deletions: 0 },
            report: null,
          },
        },
        time_created: input.now,
        time_updated: input.now,
      })
      .run(),
  )
  insertEvidenceForAcceptanceArtifact({
    id: `ev_${input.id}`,
    taskID: input.taskID,
    runID: input.runID,
    goalRunID: input.goalRunID,
    acceptanceArtifactID: input.id,
    summary: input.summary,
    now: input.now,
  })
}

function insertEvidenceForAcceptanceArtifacts(input: {
  taskID: string
  runID: string
  acceptanceID: string
  now: number
}) {
  const acceptanceRows = Database.use((db) =>
    db
      .select({ id: EngineArtifactTable.id, goalRunID: EngineArtifactTable.goal_run_id })
      .from(EngineArtifactTable)
      .where(eq(EngineArtifactTable.acceptance_id, input.acceptanceID))
      .all(),
  )
  for (const row of acceptanceRows) {
    insertEvidenceForAcceptanceArtifact({
      id: `ev_${row.id}`,
      taskID: input.taskID,
      runID: input.runID,
      goalRunID: row.goalRunID ?? undefined,
      acceptanceArtifactID: row.id,
      summary: row.id,
      now: input.now,
    })
  }
}

function insertEvidenceForAcceptanceArtifact(input: {
  id: string
  taskID: string
  runID: string
  goalRunID?: string
  acceptanceArtifactID: string
  summary: string
  now: number
}) {
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id: input.id,
        task_id: input.taskID,
        run_id: input.runID,
        goal_run_id: input.goalRunID,
        acceptance_id: input.acceptanceArtifactID,
        kind: "verification-evidence",
        label: "evidence-acceptance",
        payload: {
          scope: "acceptance",
          status: "passed",
          verdict: "accepted",
          summary: input.summary,
          checks: [],
          time_completed: input.now,
        },
        time_created: input.now,
        time_updated: input.now,
      })
      .onConflictDoNothing()
      .run(),
  )
}
