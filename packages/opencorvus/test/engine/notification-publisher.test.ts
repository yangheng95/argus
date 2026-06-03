import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { updateEvaluationFromAcceptanceVerdict } from "../../src/engine/persist"
import { ProtocolStore } from "../../src/protocol/store"
import { ProjectTable } from "../../src/project/project.sql"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"

let projectID = ""
let taskID = ""
let runID = ""
let acceptanceID = ""

beforeEach(async () => {
  await resetDatabase()
  const suffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  projectID = `project_notification_publish_${suffix}`
  taskID = `tsk_notification_publish_${suffix}`
  runID = `run_notification_publish_${suffix}`
  acceptanceID = `dlv_notification_publish_${suffix}`
  seedTask()
})

afterEach(async () => {
  mock.restore()
  await resetDatabase()
})

test("updateEvaluationFromAcceptanceVerdict emits one evaluation.completed event", async () => {
  seedEvidence(`art_notification_seed_${taskID}`)

  updateEvaluationFromAcceptanceVerdict({
    acceptanceID,
    verdict: "rejected",
    summary: "Acceptance rejected",
    now: 1000,
  })

  const event = await waitForEvent("evaluation.completed")
  expect(event?.payload).toMatchObject({
    taskID,
    runID,
    evaluationID: expect.stringMatching(/^art_/),
    status: "failed",
    verdict: "rejected",
    summary: "Acceptance rejected",
  })
  expect(ProtocolStore.listTaskEvents(taskID).filter((item) => item.type === "evaluation.completed")).toHaveLength(1)
})

function seedTask() {
  const now = Date.now()
  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: process.cwd(),
        name: "Notification Publisher Test",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "Notification publisher",
        request: "Verify notification publisher wiring",
        priority: "normal",
        time_created: now,
        time_updated: now,
      })
      .run()
  })
}

function seedEvidence(id: string) {
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id,
        task_id: taskID,
        run_id: runID,
        goal_run_id: null,
        acceptance_id: acceptanceID,
        kind: "verification-evidence",
        label: "evidence-acceptance",
        payload: {
          scope: "acceptance",
          status: "pending",
          verdict: "inconclusive",
          summary: "Pending evidence",
          checks: [],
          time_completed: null,
        },
        time_created: 900,
        time_updated: 900,
      })
      .run(),
  )
}

async function waitForEvent(type: string) {
  for (const _ of Array.from({ length: 25 })) {
    const event = ProtocolStore.listTaskEvents(taskID).find((item) => item.type === type)
    if (event) return event
    await Bun.sleep(20)
  }
  return ProtocolStore.listTaskEvents(taskID).find((item) => item.type === type)
}
