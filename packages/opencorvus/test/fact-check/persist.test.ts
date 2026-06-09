import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { recordFactCheckAttempt, findFactCheckAttempt, listFactCheckAttempts } from "../../src/fact-check/persist"
import type { FactCheckReport } from "../../src/fact-check/schema"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const stubReport: FactCheckReport = {
  scope: {
    target_session_id: "ses_target_1",
    target_agent: "build",
    target_message_id: "msg_latest_1",
    target_message_content_hash: "hash_a",
    items_total: 2,
    items_inspected: 2,
  },
  verified: [],
  corrected: [],
  unresolved: [],
  overall_verdict: "clean",
}

function seedTask(projectID: string, taskID: string, now: number) {
  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: "D:/tmp/fc-test",
        name: "FC Persist Test",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        session_id: null,
        source: "test",
        title: "FC Task",
        request: "Run fact check",
        kind: "workflow",
        priority: "normal",
        time_created: now,
        time_updated: now,
        time_started: now,
      })
      .run()
  })
}

describe("fact-check persist", () => {
  beforeEach(() => resetDatabase())
  afterEach(async () => {
    await Instance.disposeAll()
  })

  test("recordFactCheckAttempt writes a fact_check_attempt artifact", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedTask("proj_fc_1", "tsk_fc_1", Date.now())
        const id = recordFactCheckAttempt({
          taskID: "tsk_fc_1",
          factCheckSessionID: "ses_fc_session_1",
          targetSessionID: "ses_target_1",
          targetAgent: "build",
          targetMessageID: "msg_latest_1",
          targetMessageContentHash: "hash_a",
          invokedByOrchestratorSessionID: "ses_orch_1",
          report: stubReport,
          timeStarted: Date.now() - 1000,
          outcome: "completed",
        })
        expect(id).toMatch(/^art_/)

        const rows = listFactCheckAttempts("tsk_fc_1")
        expect(rows.length).toBe(1)
        expect(rows[0].payload.target_session_id).toBe("ses_target_1")
        expect(rows[0].payload.outcome).toBe("completed")
      },
    })
  })

  test("findFactCheckAttempt returns the cached row by idempotency key", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedTask("proj_fc_2", "tsk_fc_2", Date.now())
        recordFactCheckAttempt({
          taskID: "tsk_fc_2",
          factCheckSessionID: "ses_fc_session_2",
          targetSessionID: "ses_target_2",
          targetAgent: "build",
          targetMessageID: "msg_latest_2",
          targetMessageContentHash: "hash_b",
          invokedByOrchestratorSessionID: "ses_orch_2",
          report: stubReport,
          timeStarted: Date.now() - 1000,
          outcome: "completed",
        })

        const hit = findFactCheckAttempt({
          invokedByOrchestratorSessionID: "ses_orch_2",
          targetSessionID: "ses_target_2",
          targetMessageID: "msg_latest_2",
          targetMessageContentHash: "hash_b",
        })
        expect(hit).toBeDefined()
        expect(hit!.payload.target_session_id).toBe("ses_target_2")

        // Wrong hash → miss
        const miss = findFactCheckAttempt({
          invokedByOrchestratorSessionID: "ses_orch_2",
          targetSessionID: "ses_target_2",
          targetMessageID: "msg_latest_2",
          targetMessageContentHash: "hash_DIFFERENT",
        })
        expect(miss).toBeUndefined()
      },
    })
  })

  test("aborted attempts are NOT returned as cache hits", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedTask("proj_fc_3", "tsk_fc_3", Date.now())
        recordFactCheckAttempt({
          taskID: "tsk_fc_3",
          factCheckSessionID: "ses_fc_session_3",
          targetSessionID: "ses_target_3",
          targetAgent: "build",
          targetMessageID: "msg_latest_3",
          targetMessageContentHash: "hash_c",
          invokedByOrchestratorSessionID: "ses_orch_3",
          report: stubReport,
          timeStarted: Date.now() - 1000,
          outcome: "aborted",
        })

        const hit = findFactCheckAttempt({
          invokedByOrchestratorSessionID: "ses_orch_3",
          targetSessionID: "ses_target_3",
          targetMessageID: "msg_latest_3",
          targetMessageContentHash: "hash_c",
        })
        expect(hit).toBeUndefined()

        // listFactCheckAttempts still surfaces it for read_context / replay
        const all = listFactCheckAttempts("tsk_fc_3")
        expect(all.length).toBe(1)
        expect(all[0].payload.outcome).toBe("aborted")
      },
    })
  })
})
