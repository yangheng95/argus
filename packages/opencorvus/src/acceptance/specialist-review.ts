import { Identifier } from "@/id/id"
import { Database, and, desc, eq } from "@/storage/db"
import { EngineArtifactTable } from "@/engine/engine.sql"
import z from "zod"

export const AcceptanceSpecialistReviewer = z.enum([
  "backend_api",
  "client_contract",
  "test_integration",
  "security_data",
])

export const AcceptanceReviewFindingEvidence = z
  .object({
    kind: z.enum(["file", "command", "screenshot", "dom", "network", "api_response", "log"]),
    ref: z.string().min(1),
    excerpt: z.string().min(1).optional(),
  })
  .strict()

export const AcceptanceReviewFinding = z
  .object({
    proposedSeverity: z.enum(["blocking", "major", "minor"]),
    category: z.enum([
      "startup",
      "runtime",
      "functional",
      "contract",
      "visual",
      "test_quality",
      "evidence_quality",
      "security",
      "data_integrity",
      "user_intent",
    ]),
    claim: z.string().min(1),
    evidence: z.array(AcceptanceReviewFindingEvidence).min(1),
    affectedRequirementIDs: z.array(z.string().min(1)),
    suggestedOwnerGoalID: z.string().min(1).optional(),
  })
  .strict()

export const AcceptanceSpecialistReview = z
  .object({
    id: z.string().min(1),
    taskId: z.string().min(1),
    runId: z.string().min(1),
    acceptanceId: z.string().min(1),
    goalRunId: z.string().min(1).optional(),
    reviewer: AcceptanceSpecialistReviewer,
    executionStatus: z.enum(["completed", "tool_failed", "evidence_missing"]),
    summary: z.string().min(1),
    findings: z.array(AcceptanceReviewFinding),
    evidenceRefs: z.array(z.string().min(1)).min(1),
    reviewedSurfaces: z.array(AcceptanceSpecialistReviewer).min(1),
    timeCreated: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((review, ctx) => {
    if (!review.reviewedSurfaces.includes(review.reviewer)) {
      ctx.addIssue({
        code: "custom",
        path: ["reviewedSurfaces"],
        message: "reviewedSurfaces must include reviewer.",
      })
    }
    for (const surface of review.reviewedSurfaces) {
      if (surface !== review.reviewer) {
        ctx.addIssue({
          code: "custom",
          path: ["reviewedSurfaces"],
          message: "specialist review may only cover its own surface.",
        })
        break
      }
    }
  })

export type AcceptanceSpecialistReviewer = z.infer<typeof AcceptanceSpecialistReviewer>
export type AcceptanceReviewFinding = z.infer<typeof AcceptanceReviewFinding>
export type AcceptanceSpecialistReview = z.infer<typeof AcceptanceSpecialistReview>

export function createAcceptanceSpecialistReview(
  input: Omit<AcceptanceSpecialistReview, "id" | "timeCreated">,
): AcceptanceSpecialistReview {
  return AcceptanceSpecialistReview.parse({
    ...input,
    id: Identifier.ascending("artifact"),
    timeCreated: Date.now(),
  })
}

export function validateAcceptanceSpecialistReview(input: unknown): AcceptanceSpecialistReview {
  return AcceptanceSpecialistReview.parse(input)
}

export function persistAcceptanceSpecialistReview(input: { review: AcceptanceSpecialistReview }) {
  const review = validateAcceptanceSpecialistReview(input.review)
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id: review.id,
        task_id: review.taskId,
        run_id: review.runId,
        acceptance_id: review.acceptanceId,
        goal_run_id: review.goalRunId,
        kind: "acceptance_specialist_review",
        label: `acceptance-specialist-review:${review.reviewer}`,
        payload: review,
        time_created: review.timeCreated,
        time_updated: review.timeCreated,
      })
      .run(),
  )
}

export function requiredReviewersForSurfaces(input: {
  surfaces: readonly AcceptanceSpecialistReviewer[]
}): AcceptanceSpecialistReviewer[] {
  return [...new Set(input.surfaces)].sort()
}

export function findAcceptanceSpecialistReviews(
  input: { acceptanceID: string } | { taskID: string },
): AcceptanceSpecialistReview[] {
  if ("acceptanceID" in input) {
    return findAcceptanceSpecialistReviewsByAcceptance(input)
  }
  return findAcceptanceSpecialistReviewsByTask(input)
}

export function findAcceptanceSpecialistReviewsByAcceptance(input: {
  acceptanceID: string
}): AcceptanceSpecialistReview[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.acceptance_id, input.acceptanceID),
          eq(EngineArtifactTable.kind, "acceptance_specialist_review"),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created))
      .all(),
  )
  return rows.map((row) => validateAcceptanceSpecialistReview(row.payload))
}

export function findAcceptanceSpecialistReviewsByTask(input: { taskID: string }): AcceptanceSpecialistReview[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, input.taskID),
          eq(EngineArtifactTable.kind, "acceptance_specialist_review"),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created))
      .all(),
  )
  return rows.map((row) => validateAcceptanceSpecialistReview(row.payload))
}
