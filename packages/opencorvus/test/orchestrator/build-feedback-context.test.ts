import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ProjectTable } from "../../src/project/project.sql"
import { Instance } from "../../src/project/instance"
import { Database } from "../../src/storage/db"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { composeLatestAcceptanceFeedbackForBuild } from "../../src/orchestrator/tools"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import type { AcceptanceEvidenceManifest } from "../../src/acceptance/manifest"

describe("orchestrator build feedback context", () => {
  let tmp: Awaited<ReturnType<typeof tmpdir>>

  beforeEach(async () => {
    await resetDatabase()
    tmp = await tmpdir()
  })

  afterEach(async () => {
    await resetDatabase()
    await tmp?.[Symbol.asyncDispose]?.()
  })

  test("hydrates build retry feedback directly from persisted acceptance artifacts", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const suffix = now.toString(16)
        const projectID = `proj_feedback_${suffix}`
        const taskID = `tsk_feedback_${suffix}`
        const runID = `run_feedback_${suffix}`
        const acceptanceID = `del_feedback_${suffix}`
        const verdictID = `art_verdict_${suffix}`
        const manifestID = `art_manifest_${suffix}`
        const goalID = `gol_feedback_${suffix}`

        const manifest: AcceptanceEvidenceManifest = {
          id: manifestID,
          taskId: taskID,
          runId: runID,
          acceptanceId: acceptanceID,
          iteration: 2,
          requiredChecks: [],
          checkResults: [],
          goalCoverage: [],
          requirementCoverage: [],
          reviewEvidence: [
            {
              id: "review:contract_audit",
              name: "Contract audit",
              status: "failed",
              verdict: "failed",
              evidence: ["missing exported contract consumed by the runtime surface"],
            },
          ],
          changedFiles: ["src/index.html"],
          evidenceDecision: {
            status: "failed",
            summary: "Acceptance evidence failed.",
            failedCheckIds: [],
            failedCoverageIds: [],
            failedReviewIds: ["review:contract_audit"],
          },
          timeCreated: now,
        }

        Database.use((db) => {
          db.insert(ProjectTable)
            .values({
              id: projectID,
              worktree: tmp.path,
              name: "Feedback context",
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
              title: "Feedback context",
              request: "fix rejected acceptance",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()
          db.insert(EngineArtifactTable)
            .values({
              id: manifestID,
              task_id: taskID,
              run_id: runID,
              acceptance_id: acceptanceID,
              kind: "acceptance_evidence_manifest",
              label: "acceptance-evidence-manifest",
              payload: manifest,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(EngineArtifactTable)
            .values({
              id: verdictID,
              task_id: taskID,
              run_id: runID,
              acceptance_id: acceptanceID,
              kind: "verdict",
              label: "acceptance-review-verdict",
              payload: {
                verdict: "rejected",
                summary: "Calculator render rejected by acceptance evidence.",
                rejection_details: [
                  {
                    goal_id: goalID,
                    category: "quality",
                    error: "missing exported contract consumed by the calculator surface",
                    file: "src/index.html",
                    suggestion: "Expose the exact contract evidence to the executor.",
                  },
                  {
                    category: "review",
                    error: "contract audit found a missing exported surface",
                    suggestion: "Route the acceptance contract failure directly into build feedback.",
                  },
                ],
              },
              time_created: now + 1,
              time_updated: now + 1,
            })
            .run()
        })

        const taskScopeFeedback = await composeLatestAcceptanceFeedbackForBuild({ taskID })
        expect(taskScopeFeedback).toContain("Acceptance review rejected the integrated deliverable")
        expect(taskScopeFeedback).toContain("review:contract_audit")
        expect(taskScopeFeedback).toContain("missing exported contract consumed by the calculator surface")
        expect(taskScopeFeedback).not.toContain("Canonical acceptance feedback packet")
        expect(taskScopeFeedback).not.toContain("all_rejection_detail_count")

        const goalScopeFeedback = await composeLatestAcceptanceFeedbackForBuild({ taskID, goalID })
        expect(goalScopeFeedback).toContain(`goal_id: ${goalID}`)
        expect(goalScopeFeedback).toContain("missing exported contract consumed by the calculator surface")
        expect(goalScopeFeedback).not.toContain("contract audit found a missing exported surface")
      },
    })
  })
})
