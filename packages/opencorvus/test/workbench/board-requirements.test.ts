import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  EngineArtifactTable,
  EngineGoalTable,
  EngineRequirementTable,
  EngineSpecSnapshotTable,
  EngineTaskTable,
} from "../../src/engine/engine.sql"
import { compileBoard, boardTag } from "../../src/workbench/board"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

function seedGoalRun(input: {
  taskID: string
  runID: string
  goalID: string
  status: "completed" | "failed" | "running"
  now: number
}) {
  const goalRunID = `${input.goalID}_run`
  Database.use((db) => {
    db.insert(EngineArtifactTable)
      .values({
        id: goalRunID,
        task_id: input.taskID,
        run_id: input.runID,
        goal_run_id: goalRunID,
        kind: "goal_run_attempt",
        label: `attempt-${input.status}`,
        payload: {
          goal_id: input.goalID,
          status: input.status,
          retry_count: 0,
          time_started: input.now,
          time_completed: input.status === "running" ? null : input.now,
        },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
  })
}

describe("workbench board requirements", () => {
  let tmp: Awaited<ReturnType<typeof tmpdir>>

  beforeEach(async () => {
    await resetDatabase()
    tmp = await tmpdir()
  })

  afterEach(async () => {
    await resetDatabase()
    await tmp?.[Symbol.asyncDispose]?.()
  })

  test("projects requirement completion from linked goal status and changes the board tag", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const stamp = now.toString(16)
        const projectID = `proj_req_${stamp}`
        const taskID = `tsk_req_${stamp}`
        const runID = `run_req_${stamp}`
        const specID = `spec_req_${stamp}`
        const goalOneID = `gol_req_1_${stamp}`
        const goalTwoID = `gol_req_2_${stamp}`

        Database.use((db) => {
          db.insert(ProjectTable)
            .values({
              id: projectID,
              worktree: tmp.path,
              name: "Requirement board projection",
              sandboxes: [],
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: projectID,
              source: "test",
              title: "Requirement progress",
              request: "show requirement progress",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()
          db.insert(EngineArtifactTable)
            .values({
              id: runID,
              task_id: taskID,
              run_id: runID,
              kind: "run",
              label: "run-running",
              payload: {
                status: "running",
                phase: "execute",
                retry_count: 0,
                time_started: now,
              },
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(EngineSpecSnapshotTable)
            .values({
              id: specID,
              task_id: taskID,
              version: 1,
              status: "ready",
              summary: "two requirements",
              content: "spec",
              scope: "REQ-1; REQ-2",
              time_created: now,
              time_updated: now,
            })
            .run()
          for (const [index, sourceRequirementID] of ["REQ-1", "REQ-2"].entries()) {
            db.insert(EngineRequirementTable)
              .values({
                id: `req_${index + 1}_${stamp}`,
                task_id: taskID,
                spec_snapshot_id: specID,
                title: sourceRequirementID,
                description: `Requirement ${index + 1}`,
                status: "pending",
                priority: "blocking",
                acceptance: "",
                metadata: { source_requirement_id: sourceRequirementID },
                order_index: index,
                time_created: now,
                time_updated: now,
              })
              .run()
          }
          db.insert(EngineGoalTable)
            .values({
              id: goalOneID,
              task_id: taskID,
              spec_snapshot_id: specID,
              title: "Goal one",
              slug: "goal-one",
              objective: "Satisfy REQ-1",
              acceptance_specs: [],
              owned_paths: [],
              depends_on: [],
              exports: [],
              imports: [],
              kind: "feature",
              requirement_ids: ["REQ-1"],
              priority: "blocking",
              source: "test",
              order_index: 0,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(EngineGoalTable)
            .values({
              id: goalTwoID,
              task_id: taskID,
              spec_snapshot_id: specID,
              title: "Goal two",
              slug: "goal-two",
              objective: "Satisfy REQ-2",
              acceptance_specs: [],
              owned_paths: [],
              depends_on: [],
              exports: [],
              imports: [],
              kind: "feature",
              requirement_ids: ["REQ-2"],
              priority: "blocking",
              source: "test",
              order_index: 1,
              time_created: now,
              time_updated: now,
            })
            .run()
        })

        seedGoalRun({ taskID, runID, goalID: goalOneID, status: "completed", now })
        const first = compileBoard({ taskID }) as any
        const firstTag = boardTag({ taskID })

        expect(first.requirements.map((item: any) => item.status)).toEqual(["passed", "pending"])

        seedGoalRun({ taskID, runID, goalID: goalTwoID, status: "completed", now: now + 1 })
        const second = compileBoard({ taskID }) as any
        const secondTag = boardTag({ taskID })

        expect(second.requirements.map((item: any) => item.status)).toEqual(["passed", "passed"])
        expect(secondTag).not.toBe(firstTag)
      },
    })
  })

  test("shows requirements only from the active spec snapshot", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const stamp = now.toString(16)
        const projectID = `proj_req_active_${stamp}`
        const taskID = `tsk_req_active_${stamp}`
        const runID = `run_req_active_${stamp}`
        const oldGoalID = `gol_req_old_${stamp}`
        const oldSpecID = `spec_req_old_${stamp}`
        const activeSpecID = `spec_req_active_${stamp}`

        Database.use((db) => {
          db.insert(ProjectTable)
            .values({
              id: projectID,
              worktree: tmp.path,
              name: "Active requirement projection",
              sandboxes: [],
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: projectID,
              source: "test",
              title: "Active requirements",
              request: "show only active requirements",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()
          db.insert(EngineSpecSnapshotTable)
            .values({
              id: oldSpecID,
              task_id: taskID,
              version: 1,
              status: "superseded",
              summary: "old requirements",
              content: "old spec",
              scope: "old",
              time_created: now,
              time_updated: now + 1,
            })
            .run()
          db.insert(EngineSpecSnapshotTable)
            .values({
              id: activeSpecID,
              task_id: taskID,
              version: 1,
              status: "ready",
              summary: "active requirements",
              content: "active spec",
              scope: "active",
              time_created: now + 2,
              time_updated: now + 2,
            })
            .run()

          for (const [specID, prefix] of [
            [oldSpecID, "old"],
            [activeSpecID, "active"],
          ] as const) {
            for (const index of [1, 2]) {
              db.insert(EngineRequirementTable)
                .values({
                  id: `req_${prefix}_${index}_${stamp}`,
                  task_id: taskID,
                  spec_snapshot_id: specID,
                  title: `${prefix.toUpperCase()}-${index}`,
                  description: `${prefix} requirement ${index}`,
                  status: "pending",
                  priority: "blocking",
                  acceptance: "",
                  metadata: { source_requirement_id: `REQ-${index}` },
                  order_index: index - 1,
                  time_created: now + index,
                  time_updated: now + index,
                })
                .run()
            }
          }
          db.insert(EngineGoalTable)
            .values({
              id: oldGoalID,
              task_id: taskID,
              spec_snapshot_id: oldSpecID,
              title: "Old goal",
              slug: "old-goal",
              objective: "Satisfy old REQ-1",
              acceptance_specs: [],
              owned_paths: [],
              depends_on: [],
              exports: [],
              imports: [],
              kind: "feature",
              requirement_ids: ["REQ-1"],
              priority: "blocking",
              source: "test",
              order_index: 0,
              time_created: now,
              time_updated: now,
            })
            .run()
        })
        seedGoalRun({ taskID, runID, goalID: oldGoalID, status: "completed", now: now + 3 })

        const board = compileBoard({ taskID }) as any

        expect(board.requirements.map((item: any) => item.description)).toEqual([
          "active requirement 1",
          "active requirement 2",
        ])
        expect(board.requirements.map((item: any) => item.status)).toEqual(["pending", "pending"])
      },
    })
  })
})
