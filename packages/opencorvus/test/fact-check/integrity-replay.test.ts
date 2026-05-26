/**
 * Asserts integrity replay surfaces non-empty fact_check_attempt rows in
 * its prior-attempts section. Spec §6.1.2 step 7 / codex impl review §4.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineTaskTable, EngineSpecSnapshotTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import {
  buildIntegrityReplayContext,
  buildSpecSnapshotLineage,
  renderIntegrityReplayContextPrompt,
} from "../../src/integrity/replay-context"
import { recordFactCheckAttempt } from "../../src/fact-check/persist"
import type { FactCheckReport } from "../../src/fact-check/schema"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

function seedTaskAndSpec(projectID: string, taskID: string, specID: string, now: number) {
  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: "D:/tmp/fc-replay",
        name: "FC replay test",
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
        title: "FC replay task",
        request: "Run the thing",
        kind: "workflow",
        priority: "normal",
        time_created: now,
        time_updated: now,
        time_started: now,
      })
      .run()
    db.insert(EngineSpecSnapshotTable)
      .values({
        id: specID,
        task_id: taskID,
        version: 1,
        status: "ready",
        summary: "test snapshot",
        content: "(content)",
        scope: "",
        time_created: now,
        time_updated: now,
      })
      .run()
  })
}

function reportFixture(verdict: FactCheckReport["overall_verdict"]): FactCheckReport {
  return {
    scope: {
      target_session_id: "ses_target_R",
      target_agent: "build",
      target_message_id: "msg_target_R",
      target_message_content_hash: "hash_R",
      items_total: 3,
      items_inspected: 3,
    },
    verified: [],
    corrected: [
      {
        claim: "Asserted API behaviour was outdated",
        correction: "API renamed in v2; use new method",
        severity: "material",
        evidence: [{ kind: "web", pointer: "https://docs.example.com/changelog", excerpt: "Renamed" }],
        recommended_action: "modify_goal",
      },
    ],
    unresolved: [],
    overall_verdict: verdict,
  }
}

describe("integrity replay surfaces prior fact_check_attempt rows", () => {
  beforeEach(() => resetDatabase())
  afterEach(async () => {
    await Instance.disposeAll()
  })

  test("non-empty fact-check attempts appear in renderIntegrityReplayContextPrompt", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        seedTaskAndSpec("proj_fc_R", "tsk_fc_R", "spec_fc_R", now)
        recordFactCheckAttempt({
          taskID: "tsk_fc_R",
          factCheckSessionID: "ses_fc_R_1",
          targetSessionID: "ses_target_R",
          targetAgent: "build",
          targetMessageID: "msg_target_R",
          targetMessageContentHash: "hash_R",
          invokedByOrchestratorSessionID: "ses_orch_R",
          report: reportFixture("needs_orchestrator_action"),
          timeStarted: now - 1000,
          outcome: "completed",
        })

        const lineage = buildSpecSnapshotLineage({ taskID: "tsk_fc_R", activeSpecSnapshotID: "spec_fc_R" })
        const ctx = buildIntegrityReplayContext({
          taskID: "tsk_fc_R",
          lineage,
          phase: "post_build",
          goals: [],
          buildRecords: [],
          goalRuns: [],
        })

        expect(ctx.priorFactCheckAttempts.length).toBe(1)
        expect(ctx.priorFactCheckAttempts[0].verdict).toBe("needs_orchestrator_action")
        expect(ctx.priorFactCheckAttempts[0].correctedCount).toBe(1)

        const rendered = renderIntegrityReplayContextPrompt(ctx)
        expect(rendered).toContain("Prior fact-check attempts on this task")
        expect(rendered).toContain("[needs_orchestrator_action/completed]")
        expect(rendered).toContain("target=build")
      },
    })
  })

  test("empty fact-check artifacts → no prior-attempts section", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        seedTaskAndSpec("proj_fc_R2", "tsk_fc_R2", "spec_fc_R2", now)
        const lineage = buildSpecSnapshotLineage({ taskID: "tsk_fc_R2", activeSpecSnapshotID: "spec_fc_R2" })
        const ctx = buildIntegrityReplayContext({
          taskID: "tsk_fc_R2",
          lineage,
          phase: "post_build",
          goals: [],
          buildRecords: [],
          goalRuns: [],
        })
        expect(ctx.priorFactCheckAttempts.length).toBe(0)
        expect(renderIntegrityReplayContextPrompt(ctx)).not.toContain("Prior fact-check attempts")
      },
    })
  })
})
