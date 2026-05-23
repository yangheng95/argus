import { Identifier } from "@/id/id"
import { Database, and, desc, eq } from "@/storage/db"
import { EngineArtifactTable } from "@/engine/engine.sql"
import z from "zod"

export const DeliverySpecialistReviewer = z.enum([
  "backend_api",
  "client_contract",
  "test_integration",
  "security_data",
])

export const DeliveryReviewFindingEvidence = z
  .object({
    kind: z.enum(["file", "command", "screenshot", "dom", "network", "api_response", "log"]),
    ref: z.string().min(1),
    excerpt: z.string().min(1).optional(),
  })
  .strict()

export const DeliveryReviewFinding = z
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
    evidence: z.array(DeliveryReviewFindingEvidence).min(1),
    affectedRequirementIDs: z.array(z.string().min(1)),
    suggestedOwnerGoalID: z.string().min(1).optional(),
  })
  .strict()

export const DeliverySpecialistReview = z
  .object({
    id: z.string().min(1),
    taskId: z.string().min(1),
    runId: z.string().min(1),
    deliveryId: z.string().min(1),
    goalRunId: z.string().min(1).optional(),
    reviewer: DeliverySpecialistReviewer,
    executionStatus: z.enum(["completed", "tool_failed", "evidence_missing"]),
    summary: z.string().min(1),
    findings: z.array(DeliveryReviewFinding),
    evidenceRefs: z.array(z.string().min(1)).min(1),
    reviewedSurfaces: z.array(DeliverySpecialistReviewer).min(1),
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

export type DeliverySpecialistReviewer = z.infer<typeof DeliverySpecialistReviewer>
export type DeliveryReviewFinding = z.infer<typeof DeliveryReviewFinding>
export type DeliverySpecialistReview = z.infer<typeof DeliverySpecialistReview>

export function createDeliverySpecialistReview(
  input: Omit<DeliverySpecialistReview, "id" | "timeCreated">,
): DeliverySpecialistReview {
  return DeliverySpecialistReview.parse({
    ...input,
    id: Identifier.ascending("artifact"),
    timeCreated: Date.now(),
  })
}

export function validateDeliverySpecialistReview(input: unknown): DeliverySpecialistReview {
  return DeliverySpecialistReview.parse(input)
}

export function persistDeliverySpecialistReview(input: { review: DeliverySpecialistReview }) {
  const review = validateDeliverySpecialistReview(input.review)
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id: review.id,
        task_id: review.taskId,
        run_id: review.runId,
        delivery_id: review.deliveryId,
        goal_run_id: review.goalRunId,
        kind: "delivery_specialist_review",
        label: `delivery-specialist-review:${review.reviewer}`,
        payload: review,
        time_created: review.timeCreated,
        time_updated: review.timeCreated,
      })
      .run(),
  )
}

export function requiredReviewersForSurfaces(input: {
  surfaces: readonly DeliverySpecialistReviewer[]
}): DeliverySpecialistReviewer[] {
  return [...new Set(input.surfaces)].sort()
}

export function findDeliverySpecialistReviews(
  input: { deliveryID: string } | { taskID: string },
): DeliverySpecialistReview[] {
  if ("deliveryID" in input) {
    return findDeliverySpecialistReviewsByDelivery(input)
  }
  return findDeliverySpecialistReviewsByTask(input)
}

export function findDeliverySpecialistReviewsByDelivery(input: { deliveryID: string }): DeliverySpecialistReview[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.delivery_id, input.deliveryID),
          eq(EngineArtifactTable.kind, "delivery_specialist_review"),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created))
      .all(),
  )
  return rows.map((row) => validateDeliverySpecialistReview(row.payload))
}

export function findDeliverySpecialistReviewsByTask(input: { taskID: string }): DeliverySpecialistReview[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(eq(EngineArtifactTable.task_id, input.taskID), eq(EngineArtifactTable.kind, "delivery_specialist_review")),
      )
      .orderBy(desc(EngineArtifactTable.time_created))
      .all(),
  )
  return rows.map((row) => validateDeliverySpecialistReview(row.payload))
}
