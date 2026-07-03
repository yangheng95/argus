import z from "zod"
import { and, desc, eq } from "drizzle-orm"
import { browserPreviewEvidenceIDFromRef, findReadableBrowserPreviewEvidenceByID } from "@/browser-preview/persist"
import type { PersistedBrowserPreviewEvidence } from "@/browser-preview/persist"
import { EngineArtifactTable } from "@/engine/engine.sql"
import { Identifier } from "@/id/id"
import { Database } from "@/storage/db"

export const VISUAL_FEEDBACK_VERIFICATION_ARTIFACT_LABEL = "visual-feedback-verification" as const

export const VisualFeedbackVerificationSchema = z
  .object({
    id: z.string().min(1),
    taskID: z.string().min(1),
    runID: z.string().min(1),
    goalRunID: z.string().min(1).optional(),
    acceptanceID: z.string().min(1).optional(),
    previewTargetID: z.string().min(1).optional(),
    projectRoot: z.string().min(1),
    status: z.enum(["passed", "failed"]),
    summary: z.string().min(1),
    requiredReferenceRegions: z.array(z.string().min(1)),
    referenceComparisonEvidenceRefs: z.array(z.string().min(1)),
    productionBlockerIDs: z.array(z.string().min(1)),
    visualQaReportRef: z.string().min(1).optional(),
  })
  .strict()

export const VisualFeedbackVerificationListSchema = z.array(VisualFeedbackVerificationSchema)

export type VisualFeedbackVerification = z.infer<typeof VisualFeedbackVerificationSchema>

const VisualFeedbackVerificationArtifactPayloadSchema = z
  .object({
    visual_feedback_verification: VisualFeedbackVerificationSchema,
  })
  .passthrough()

const ReferenceComparisonContentMetricsSchema = z
  .object({
    non_white_pixel_ratio: z.number().finite().nonnegative(),
    unique_color_count: z.number().finite().int().nonnegative(),
  })
  .strict()

const ReferenceComparisonCaptureSchema = z
  .object({
    operation: z.literal("reference-comparison").optional(),
    region: z
      .object({
        region_id: z.string().min(1),
        viewport_id: z.string().min(1),
        crop_intent: z.string().min(1).optional(),
        source_bbox: z
          .object({
            x: z.number().finite().nonnegative(),
            y: z.number().finite().nonnegative(),
            width: z.number().finite().positive(),
            height: z.number().finite().positive(),
          })
          .strict()
          .optional(),
        source_image_size: z
          .object({
            width: z.number().finite().positive(),
            height: z.number().finite().positive(),
          })
          .strict()
          .optional(),
        visual: z
          .object({
            dimensions_match: z.boolean(),
            total_pixels: z.number().finite().positive(),
          })
          .passthrough()
          .optional(),
        coverage: z
          .object({
            implementation_matches_source_size: z.boolean(),
          })
          .passthrough()
          .optional(),
        content: z
          .object({
            source: ReferenceComparisonContentMetricsSchema,
            implementation: ReferenceComparisonContentMetricsSchema,
          })
          .strict()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough()

export function summarizeVisualFeedbackVerification(verification: VisualFeedbackVerification): string {
  return [
    `visual_feedback_verification=${verification.id}`,
    `task=${verification.taskID}`,
    `run=${verification.runID}`,
    `preview_target=${verification.previewTargetID ?? "(none)"}`,
    `status=${verification.status}`,
    `reference_regions=${verification.requiredReferenceRegions.join(", ") || "(none)"}`,
    `reference_comparison_evidence=${verification.referenceComparisonEvidenceRefs.join(", ") || "(none)"}`,
    `production_blockers=${verification.productionBlockerIDs.join(", ") || "(none)"}`,
    `summary=${verification.summary}`,
  ].join(" | ")
}

export async function validateVisualFeedbackVerification(input: {
  verification: VisualFeedbackVerification
  expectedTaskID: string
  expectedRunID?: string
}): Promise<{ passing: boolean; issues: string[]; summaries: string[] }> {
  const issues: string[] = []
  const summaries: string[] = []
  const verification = input.verification
  if (verification.taskID !== input.expectedTaskID) {
    issues.push(`verification ${verification.id} belongs to task ${verification.taskID}, not ${input.expectedTaskID}`)
  }
  if (input.expectedRunID && verification.runID !== input.expectedRunID) {
    issues.push(`verification ${verification.id} belongs to run ${verification.runID}, not ${input.expectedRunID}`)
  }
  if (verification.status !== "passed") {
    issues.push(`verification ${verification.id} status=${verification.status}`)
  }
  if (verification.productionBlockerIDs.length > 0) {
    issues.push(`verification ${verification.id} has production blockers: ${verification.productionBlockerIDs.join(", ")}`)
  }
  if (verification.referenceComparisonEvidenceRefs.length === 0) {
    issues.push(`verification ${verification.id} has no referenceComparisonEvidenceRefs`)
  }
  if (verification.status === "passed" && verification.requiredReferenceRegions.length === 0) {
    issues.push(`verification ${verification.id} has no requiredReferenceRegions`)
  }
  if (verification.status === "passed" && !verification.previewTargetID) {
    issues.push(`verification ${verification.id} has no previewTargetID`)
  }

  const coveredRegions = new Set<string>()
  for (const ref of verification.referenceComparisonEvidenceRefs) {
    const evidenceID = browserPreviewEvidenceIDFromRef(ref)
    if (!evidenceID) {
      issues.push(`reference comparison ref is not browser_preview_evidence: ${ref}`)
      continue
    }
    let evidence: PersistedBrowserPreviewEvidence | undefined
    try {
      evidence = await findReadableBrowserPreviewEvidenceByID({
        projectRoot: verification.projectRoot,
        taskID: input.expectedTaskID,
        evidenceID,
      })
    } catch (error) {
      issues.push(`${ref}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    if (!evidence) {
      issues.push(`${ref}: browser_preview_evidence row was not found for task ${input.expectedTaskID}`)
      continue
    }
    summaries.push(`${ref}: ${evidence.operationKind} status=${evidence.status} ${evidence.summary}`)
    if (evidence.runID !== verification.runID) {
      issues.push(`${ref}: runID=${evidence.runID ?? "null"}, expected ${verification.runID}`)
    }
    if (verification.previewTargetID && evidence.targetID !== verification.previewTargetID) {
      issues.push(`${ref}: targetID=${evidence.targetID}, expected ${verification.previewTargetID}`)
    }
    if (evidence.operationKind !== "reference-comparison") {
      issues.push(`${ref}: operationKind=${evidence.operationKind}, expected reference-comparison`)
      continue
    }
    if (evidence.status !== "passed") {
      issues.push(`${ref}: status=${evidence.status}, expected passed`)
    }
    const capture = validateReferenceComparisonCapture(evidence, ref)
    issues.push(...capture.issues)
    if (capture.regionKey) coveredRegions.add(capture.regionKey)
  }

  for (const requiredRegion of verification.requiredReferenceRegions) {
    if (!coveredRegions.has(requiredRegion)) {
      issues.push(`required reference region lacks passed reference-comparison evidence: ${requiredRegion}`)
    }
  }

  return { passing: issues.length === 0, issues, summaries }
}

export function persistVisualFeedbackVerificationArtifact(input: {
  taskID: string
  runID: string
  goalRunID?: string
  acceptanceID?: string
  verification: VisualFeedbackVerification
  now?: number
}): string {
  if (input.verification.taskID !== input.taskID) {
    throw new Error(
      `persistVisualFeedbackVerificationArtifact: verification taskID=${input.verification.taskID} does not match ${input.taskID}`,
    )
  }
  if (input.verification.runID !== input.runID) {
    throw new Error(
      `persistVisualFeedbackVerificationArtifact: verification runID=${input.verification.runID} does not match ${input.runID}`,
    )
  }
  const now = input.now ?? Date.now()
  const id = Identifier.ascending("artifact")
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id,
        task_id: input.taskID,
        run_id: input.runID,
        goal_run_id: input.goalRunID ?? null,
        acceptance_id: input.acceptanceID ?? null,
        kind: "verification-evidence",
        label: VISUAL_FEEDBACK_VERIFICATION_ARTIFACT_LABEL,
        payload: {
          scope: "visual_feedback",
          status: input.verification.status,
          verdict: input.verification.status === "passed" ? "accepted" : "rejected",
          summary: input.verification.summary,
          checks: [
            {
              name: VISUAL_FEEDBACK_VERIFICATION_ARTIFACT_LABEL,
              status: input.verification.status,
              evidence: summarizeVisualFeedbackVerification(input.verification),
              scorer_kind: "prebuilt",
            },
          ],
          time_completed: now,
          visual_feedback_verification: input.verification,
        },
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  return id
}

export function readLatestTaskVisualFeedbackVerification(input: {
  taskID: string
  runID: string
}): VisualFeedbackVerification[] | undefined {
  const conditions = [
    eq(EngineArtifactTable.task_id, input.taskID),
    eq(EngineArtifactTable.kind, "verification-evidence"),
    eq(EngineArtifactTable.label, VISUAL_FEEDBACK_VERIFICATION_ARTIFACT_LABEL),
  ]
  conditions.push(eq(EngineArtifactTable.run_id, input.runID))
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(and(...conditions))
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .limit(1)
      .get(),
  )
  if (!row) return undefined
  const parsed = VisualFeedbackVerificationArtifactPayloadSchema.safeParse(row.payload)
  if (!parsed.success) {
    throw new Error(`visual feedback verification artifact ${row.id} is malformed: ${parsed.error.message}`)
  }
  return [parsed.data.visual_feedback_verification]
}

export function readVisualFeedbackVerificationArtifactByID(input: {
  taskID: string
  artifactID: string
}): VisualFeedbackVerification | undefined {
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, input.taskID),
          eq(EngineArtifactTable.id, input.artifactID),
          eq(EngineArtifactTable.kind, "verification-evidence"),
          eq(EngineArtifactTable.label, VISUAL_FEEDBACK_VERIFICATION_ARTIFACT_LABEL),
        ),
      )
      .limit(1)
      .get(),
  )
  if (!row) return undefined
  const parsed = VisualFeedbackVerificationArtifactPayloadSchema.safeParse(row.payload)
  if (!parsed.success) {
    throw new Error(`visual feedback verification artifact ${row.id} is malformed: ${parsed.error.message}`)
  }
  return parsed.data.visual_feedback_verification
}

function validateReferenceComparisonCapture(
  evidence: PersistedBrowserPreviewEvidence,
  ref: string,
): { regionKey?: string; issues: string[] } {
  const issues: string[] = []
  const parsed = ReferenceComparisonCaptureSchema.safeParse(evidence.capture)
  if (!parsed.success) {
    return {
      issues: [
        `${ref}: missing structured reference-comparison capture with region, source bbox, coverage, visual, and content metrics`,
      ],
    }
  }
  const region = parsed.data.region
  const regionKey = `${region.region_id}@${region.viewport_id}`
  if (!region.source_bbox) issues.push(`${ref}: missing source_bbox`)
  if (!region.source_image_size) issues.push(`${ref}: missing source_image_size`)
  if (!region.coverage?.implementation_matches_source_size) {
    issues.push(`${ref}: implementation crop does not match source size`)
  }
  if (!region.visual?.dimensions_match || region.visual.total_pixels <= 0) {
    issues.push(`${ref}: missing valid visual dimensions metrics`)
  }
  if (!region.content) {
    issues.push(`${ref}: missing source and implementation content metrics`)
    return { regionKey, issues }
  }
  if (
    region.content.source.non_white_pixel_ratio >= 0.002 &&
    region.content.implementation.non_white_pixel_ratio <= 0.0001
  ) {
    issues.push(`${ref}: implementation content metrics indicate a blank crop`)
  }
  if (region.content.source.unique_color_count >= 3 && region.content.implementation.unique_color_count <= 1) {
    issues.push(`${ref}: implementation unique color count indicates a monochrome blank crop`)
  }
  return { regionKey, issues }
}
