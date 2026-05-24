import { afterEach, describe, expect, mock, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  EngineArtifactTable,
  EngineGoalTable,
  EngineRequirementTable,
  EngineSpecSnapshotTable,
  EngineTaskTable,
} from "../../src/engine/engine.sql"
import { findLatestIntegrityAttemptArtifact } from "../../src/engine/store"
import { buildIntegrityReplayContext, buildSpecSnapshotLineage } from "../../src/integrity/replay-context"
import { ProjectTable } from "../../src/project/project.sql"
import { Instance } from "../../src/project/instance"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"

let capturedReviewInput: any
let requirementStatusRows: any[] = []

mock.module("@/integrity", () => ({
  reviewIntegrity: async (input: any) => {
    capturedReviewInput = input
    return {
      verdict: "pass",
      summary: "Delivery-triggered integrity accepted replay evidence",
      teamReportMarkdown: "Delivery-triggered integrity accepted replay evidence.",
      reviewers: [
        {
          reviewerID: "requirements_surface",
          scope: "Requirement surface",
          verdict: "pass",
          summary: "REQ-1 remains covered.",
          evidence: ["REQ-1 status is satisfied."],
          findings: [],
          openQuestions: [],
        },
        {
          reviewerID: "delivery_surface",
          scope: "Delivery changed files",
          verdict: "pass",
          summary: "Delivery changed files are present in replay context.",
          evidence: ["src/delivery-output.ts changed in delivery evidence."],
          findings: [],
          openQuestions: [],
        },
      ],
      findings: [],
      rounds: [],
      requiredRepairs: [],
      unresolvedDisagreements: [],
      sessionID: "ses_delivery_integrity_replay",
    }
  },
  computeRequirementStatusSnapshot: () => requirementStatusRows,
  buildIntegrityReplayContext,
  buildSpecSnapshotLineage,
}))

afterEach(async () => {
  capturedReviewInput = undefined
  requirementStatusRows = []
  await resetDatabase()
})

describe("delivery-triggered integrity replay context", () => {
  test("passes delivery and goal-run evidence to reviewIntegrity", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencorvus-delivery-integrity-replay-"))
    try {
      await Instance.provide({
        directory: dir,
        fn: async () => {
          const now = Date.now()
          const ids = {
            projectID: `project_delivery_replay_${now}`,
            taskID: `tsk_delivery_replay_${now}`,
            specID: `spec_delivery_replay_${now}`,
            goalID: `goal_delivery_replay_${now}`,
            runID: `run_delivery_replay_${now}`,
            goalRunID: `glr_delivery_replay_${now}`,
            deliveryID: `dlv_delivery_replay_${now}`,
          }
          seedDeliveryIntegrityTask({ ...ids, directory: dir, now })
          requirementStatusRows = [
            {
              requirementID: "REQ-1",
              status: "satisfied",
              claimingGoals: [{ goalID: ids.goalID, runStatus: "completed" }],
            },
          ]

          const { createDeliveryTools } = await import("../../src/delivery/tools")
          const tools = createDeliveryTools({
            taskID: ids.taskID,
            sessionID: "ses_delivery_parent",
          })
          const result = await tools.run_integrity_review.execute!(
            { reason: "delivery evidence needs semantic review now" },
            {} as any,
          ) as string
          const parsed = JSON.parse(result)

          expect(parsed.phase).toBe("post_build")
          expect(parsed.verdict).toBe("pass")
          expect(capturedReviewInput.replayContext).toMatchObject({
            attemptNumber: 1,
            buildEvidenceSinceLastReview: {
              changedFiles: ["src/delivery-output.ts", "src/secondary.ts"],
              diffs: [
                {
                  file: "src/delivery-output.ts",
                  status: "modified",
                  additions: 12,
                  deletions: 1,
                },
              ],
              deliverySummaries: ["Delivery changed replay-aware output."],
              goalRuns: [expect.objectContaining({ goalID: ids.goalID, goalRunID: ids.goalRunID, status: "completed" })],
            },
            scaleSignals: {
              phase: "post_build",
              priorAttempts: 0,
              changedFilesSinceLastReview: 2,
              changedFilesTotal: 2,
            },
          })

          const artifact = findLatestIntegrityAttemptArtifact({ taskID: ids.taskID, specSnapshotID: ids.specID })
          const payload = artifact?.payload as Record<string, any> | undefined
          expect(payload?.attempts).toBe(1)
          expect(payload?.team_report_markdown).toContain("Delivery-triggered integrity accepted replay evidence")
        },
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

function seedDeliveryIntegrityTask(input: {
  projectID: string
  taskID: string
  specID: string
  goalID: string
  runID: string
  goalRunID: string
  deliveryID: string
  directory: string
  now: number
}) {
  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: input.projectID,
        worktree: input.directory,
        name: "Delivery replay project",
        sandboxes: "[]",
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: input.taskID,
        project_id: input.projectID,
        source: "test",
        title: "Delivery replay task",
        request: "Ensure delivery-triggered integrity sees replay evidence",
        kind: "workflow",
        priority: "normal",
        attachments: [],
        design_specs: [],
        time_created: input.now,
        time_updated: input.now,
        time_started: input.now,
      })
      .run()
    db.insert(EngineSpecSnapshotTable)
      .values({
        id: input.specID,
        task_id: input.taskID,
        version: 1,
        status: "ready",
        summary: "Delivery replay spec",
        content: "# Delivery replay spec",
        scope: "Delivery replay scope",
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    db.insert(EngineRequirementTable)
      .values({
        id: `req_${input.specID}`,
        task_id: input.taskID,
        spec_snapshot_id: input.specID,
        title: "REQ-1",
        description: "Delivery output must be replay-visible.",
        status: "passed",
        priority: "blocking",
        acceptance: "Delivery evidence includes changed files.",
        metadata: { source_requirement_id: "REQ-1" },
        order_index: 0,
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    db.insert(EngineGoalTable)
      .values({
        id: input.goalID,
        task_id: input.taskID,
        spec_snapshot_id: input.specID,
        title: "Produce delivery replay output",
        slug: "produce-delivery-replay-output",
        objective: "Create output that delivery-triggered integrity can inspect.",
        acceptance_specs: [{ id: "AS-1", text: "Changed delivery output exists." }],
        owned_paths: ["src/delivery-output.ts"],
        depends_on: [],
        requirement_ids: ["REQ-1"],
        kind: "feature",
        priority: "blocking",
        source: "test",
        order_index: 0,
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    db.insert(EngineArtifactTable)
      .values({
        id: `artifact_graph_${input.taskID}`,
        task_id: input.taskID,
        run_id: null,
        goal_run_id: null,
        kind: "architect_contract_graph",
        label: "architect-contract-graph",
        payload: { version: 1, contracts: [], dependency_contracts: [] },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    db.insert(EngineArtifactTable)
      .values({
        id: `artifact_goal_run_${input.goalRunID}`,
        task_id: input.taskID,
        run_id: input.runID,
        goal_run_id: input.goalRunID,
        kind: "goal_run_attempt",
        label: "attempt-completed",
        payload: {
          goal_id: input.goalID,
          plan_node_id: null,
          session_id: "ses_goal_run_delivery_replay",
          status: "completed",
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
          time_started: input.now + 1,
          time_completed: input.now + 2,
        },
        time_created: input.now + 2,
        time_updated: input.now + 2,
      })
      .run()
    db.insert(EngineArtifactTable)
      .values({
        id: `artifact_delivery_${input.deliveryID}`,
        task_id: input.taskID,
        run_id: input.runID,
        goal_run_id: input.goalRunID,
        delivery_id: input.deliveryID,
        kind: "delivery",
        label: "candidate-delivery",
        payload: {
          status: "delivered",
          summary: "Delivery changed replay-aware output.",
          result: {
            changed_files: ["src/delivery-output.ts"],
            changedFiles: ["src/secondary.ts"],
            diffs: [
              {
                file: "src/delivery-output.ts",
                status: "modified",
                additions: 12,
                deletions: 1,
              },
            ],
          },
        },
        time_created: input.now + 3,
        time_updated: input.now + 3,
      })
      .run()
  })
}
