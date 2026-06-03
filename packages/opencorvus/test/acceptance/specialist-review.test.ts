import { afterEach, describe, expect, test } from "bun:test"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { ProjectTable } from "../../src/project/project.sql"
import { Database, eq } from "../../src/storage/db"
import {
  createAcceptanceSpecialistReview,
  findAcceptanceSpecialistReviews,
  persistAcceptanceSpecialistReview,
  requiredReviewersForSurfaces,
  validateAcceptanceSpecialistReview,
} from "../../src/acceptance/specialist-review"

const projectIds: string[] = []

afterEach(() => {
  for (const projectId of projectIds.splice(0)) {
    Database.use((db) => db.delete(ProjectTable).where(eq(ProjectTable.id, projectId)).run())
  }
})

describe("acceptance specialist review contract", () => {
  test("creates scoped evidence-only specialist reviews without a final verdict field", () => {
    const review = createAcceptanceSpecialistReview({
      taskId: "tsk_specialist_contract",
      runId: "run_specialist_contract",
      acceptanceId: "dlv_specialist_contract",
      reviewer: "backend_api",
      executionStatus: "completed",
      summary: "Route checks completed.",
      findings: [
        {
          proposedSeverity: "blocking",
          category: "contract",
          claim: "GET /users returns the wrong shape.",
          evidence: [
            {
              kind: "api_response",
              ref: "probe:/users",
              excerpt: "status=200 body={items:null}",
            },
          ],
          affectedRequirementIDs: ["REQ-users"],
          suggestedOwnerGoalID: "gol_backend",
        },
      ],
      evidenceRefs: ["probe:/users"],
      reviewedSurfaces: ["backend_api"],
    })

    expect(review.id).toStartWith("art_")
    expect(review.timeCreated).toBeGreaterThan(0)
    expect("verdict" in review).toBe(false)
  })

  test("rejects findings without evidence and payloads that try to include a verdict", () => {
    expect(() =>
      validateAcceptanceSpecialistReview({
        id: "artifact_missing_evidence",
        taskId: "tsk_specialist_contract",
        runId: "run_specialist_contract",
        acceptanceId: "dlv_specialist_contract",
        reviewer: "test_integration",
        executionStatus: "completed",
        summary: "Tests inspected.",
        findings: [
          {
            proposedSeverity: "blocking",
            category: "test_quality",
            claim: "Tests are empty.",
            evidence: [],
            affectedRequirementIDs: ["REQ-tests"],
          },
        ],
        evidenceRefs: ["tests/app.test.ts"],
        reviewedSurfaces: ["test_integration"],
        timeCreated: Date.now(),
      }),
    ).toThrow("Too small")

    expect(() =>
      validateAcceptanceSpecialistReview({
        id: "artifact_verdict_field",
        taskId: "tsk_specialist_contract",
        runId: "run_specialist_contract",
        acceptanceId: "dlv_specialist_contract",
        reviewer: "backend_api",
        executionStatus: "completed",
        summary: "Looks good.",
        findings: [],
        evidenceRefs: ["dom:home"],
        reviewedSurfaces: ["backend_api"],
        timeCreated: Date.now(),
        verdict: "accepted",
      }),
    ).toThrow("Unrecognized key")
  })

  test("rejects cross-surface specialist output before arbitration", () => {
    expect(() =>
      validateAcceptanceSpecialistReview({
        id: "artifact_cross_surface",
        taskId: "tsk_specialist_contract",
        runId: "run_specialist_contract",
        acceptanceId: "dlv_specialist_contract",
        reviewer: "backend_api",
        executionStatus: "completed",
        summary: "Reviewed backend and security together.",
        findings: [],
        evidenceRefs: ["src/api.ts"],
        reviewedSurfaces: ["backend_api", "security_data"],
        timeCreated: Date.now(),
      }),
    ).toThrow("may only cover its own surface")
  })

  test("derives mandatory reviewers directly from the surface manifest surfaces", () => {
    expect(
      requiredReviewersForSurfaces({
        surfaces: ["client_contract", "backend_api", "backend_api", "security_data"],
      }),
    ).toEqual(["backend_api", "client_contract", "security_data"])
  })

  test("persists specialist reviews as evidence artifacts instead of verdict artifacts", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectId = `project_specialist_${stamp}`
    const taskId = `tsk_specialist_${stamp}`
    const runId = `run_specialist_${stamp}`
    const acceptanceId = `dlv_specialist_${stamp}`
    seedTask({ projectId, taskId, now })
    const review = createAcceptanceSpecialistReview({
      taskId,
      runId,
      acceptanceId,
      reviewer: "security_data",
      executionStatus: "completed",
      summary: "Auth and data access inspected.",
      findings: [],
      evidenceRefs: ["src/auth/session.ts"],
      reviewedSurfaces: ["security_data"],
    })

    persistAcceptanceSpecialistReview({ review })

    const reviews = findAcceptanceSpecialistReviews({ acceptanceID: acceptanceId })
    expect(reviews).toHaveLength(1)
    expect(reviews[0]).toMatchObject({
      id: review.id,
      reviewer: "security_data",
      executionStatus: "completed",
    })
  })
})

function seedTask(input: { projectId: string; taskId: string; now: number }) {
  projectIds.push(input.projectId)
  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: input.projectId,
        worktree: process.cwd(),
        name: "Acceptance specialist review test",
        sandboxes: "[]",
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: input.taskId,
        project_id: input.projectId,
        source: "test",
        title: "Acceptance specialist review task",
        request: "Verify specialist review artifact persistence",
        priority: "normal",
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
  })
}
