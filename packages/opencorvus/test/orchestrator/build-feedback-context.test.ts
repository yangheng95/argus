import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ProjectTable } from "../../src/project/project.sql"
import { Instance } from "../../src/project/instance"
import { Database } from "../../src/storage/db"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { composeLatestDeliveryFeedbackForBuild } from "../../src/orchestrator/tools"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import type { DeliveryEvidenceManifest } from "../../src/delivery/manifest"

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

  test("hydrates build retry feedback directly from persisted delivery artifacts", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const suffix = now.toString(16)
        const projectID = `proj_feedback_${suffix}`
        const taskID = `tsk_feedback_${suffix}`
        const runID = `run_feedback_${suffix}`
        const deliveryID = `del_feedback_${suffix}`
        const verdictID = `art_verdict_${suffix}`
        const manifestID = `art_manifest_${suffix}`
        const goalID = `gol_feedback_${suffix}`

        const manifest: DeliveryEvidenceManifest = {
          id: manifestID,
          taskId: taskID,
          runId: runID,
          deliveryId: deliveryID,
          iteration: 2,
          requiredChecks: [],
          checkResults: [],
          goalCoverage: [],
          requirementCoverage: [],
          runtimeFlows: [
            {
              id: "runtime:web:.",
              name: "Web runtime render",
              status: "failed",
              evidence: [
                "rendered body.innerText length=100 < threshold 120",
                "DOM descendants count is 43, below required threshold 50",
              ],
              screenshotPath: "D:/tmp/rendered.png",
              dom: {
                textLength: 100,
                nodeCount: 43,
                hasBodyChildren: true,
                isEmptyRootShell: false,
              },
            },
          ],
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
          finalGate: {
            status: "failed",
            summary: "Delivery evidence gate failed.",
            failedCheckIds: [],
            failedCoverageIds: [],
            failedRuntimeFlowIds: ["runtime:web:."],
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
              request: "fix rejected delivery",
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
              delivery_id: deliveryID,
              kind: "delivery_evidence_manifest",
              label: "delivery-evidence-manifest",
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
              delivery_id: deliveryID,
              kind: "verdict",
              label: "delivery-agent-verdict",
              payload: {
                verdict: "rejected",
                summary: "Calculator render rejected by host gates.",
                rejection_details: [
                  {
                    goal_id: goalID,
                    category: "runtime",
                    error: "dom_too_thin: textLength=100 nodeCount=43",
                    file: "src/index.html",
                    suggestion: "Expose the exact DOM evidence to the executor.",
                  },
                  {
                    category: "review",
                    error: "contract audit found a missing exported surface",
                    suggestion: "Route the delivery contract failure directly into build feedback.",
                  },
                ],
              },
              time_created: now + 1,
              time_updated: now + 1,
            })
            .run()
        })

        const taskScopeFeedback = await composeLatestDeliveryFeedbackForBuild({ taskID })
        expect(taskScopeFeedback).toContain("Delivery agent rejected the integrated deliverable")
        expect(taskScopeFeedback).toContain("Canonical delivery feedback packet")
        expect(taskScopeFeedback).toContain("runtime:web:.")
        expect(taskScopeFeedback).toContain("review:contract_audit")
        expect(taskScopeFeedback).toContain("dom_too_thin: textLength=100 nodeCount=43")
        expect(taskScopeFeedback).toContain('all_rejection_detail_count": 2')

        const goalScopeFeedback = await composeLatestDeliveryFeedbackForBuild({ taskID, goalID })
        expect(goalScopeFeedback).toContain(`"goal_id": "${goalID}"`)
        expect(goalScopeFeedback).toContain("dom_too_thin: textLength=100 nodeCount=43")
        expect(goalScopeFeedback).not.toContain("contract audit found a missing exported surface")
        expect(goalScopeFeedback).toContain("runtime:web:.")
      },
    })
  })
})
