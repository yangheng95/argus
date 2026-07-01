import fs from "node:fs"
import path from "node:path"
import z from "zod"
import { BrowserPreviewEvidenceCorruptionError, findReadableBrowserPreviewEvidenceByID } from "@/browser-preview/persist"
import { BrowserPreviewCropIntent } from "@/browser-preview/region-schema"
import { ProjectRuntimePaths } from "@/project/runtime-paths"

export const VisualRegionEvidenceSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    requirementIDs: z.array(z.string().min(1)),
    acceptanceSpecIDs: z.array(z.string().min(1)),
    sourceRefs: z.array(z.string().min(1)),
    viewport: z.string().min(1),
    cropIntent: BrowserPreviewCropIntent,
    bounds: z
      .object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
      })
      .strict()
      .optional(),
    required: z.boolean(),
    status: z.enum(["passing", "failing", "deferred"]),
    evidenceRefs: z.array(z.string().min(1)),
    notes: z.string(),
  })
  .strict()

const VisualEvidenceBlankIntervalSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    y: z.number().finite().nonnegative(),
    height: z.number().finite().positive(),
    sourceRefs: z.array(z.string().min(1)),
    evidenceRefs: z.array(z.string().min(1)),
    notes: z.string().min(1),
  })
  .strict()

const VisualEvidenceCoveredIntervalSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    y: z.number().finite().nonnegative(),
    height: z.number().finite().positive(),
    regionIDs: z.array(z.string().min(1)).min(1),
    evidenceRefs: z.array(z.string().min(1)).min(1),
    notes: z.string().min(1),
  })
  .strict()

const VisualEvidencePageCoverageSchema = z
  .object({
    coordinateSpace: z.literal("source_reference_image_px"),
    implementationUse: z.literal("evidence_only"),
    requiredRegionIDs: z.array(z.string().min(1)),
    coveredIntervals: z.array(VisualEvidenceCoveredIntervalSchema).min(1),
    unexplainedBlankIntervals: z.array(VisualEvidenceBlankIntervalSchema),
  })
  .strict()

export const VisualEvidenceBundleSchema = z
  .object({
    id: z.string().min(1),
    taskID: z.string().min(1),
    source: z.enum(["frontend_design", "build", "integrity"]),
    reference: z
      .object({
        path: z.string().min(1),
        sha256: z.string().min(1),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .strict(),
    rendered: z
      .object({
        path: z.string().min(1),
        sha256: z.string().min(1),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        capturedAt: z.string().min(1),
        viewport: z
          .object({
            width: z.number().int().positive(),
            height: z.number().int().positive(),
            deviceScaleFactor: z.number().positive().optional(),
          })
          .strict(),
        appURL: z.string().min(1),
        projectDirectory: z.string().min(1),
        commitRef: z.string().min(1).optional(),
      })
      .strict(),
    inspection: z
      .object({
        path: z.string().min(1).optional(),
        reviewedAt: z.string().min(1),
        status: z.enum(["passing", "failing", "incomplete"]),
        blockerCount: z.number().int().min(0),
        notes: z.string().min(1),
      })
      .strict(),
    pageCoverage: VisualEvidencePageCoverageSchema,
    regions: z.array(VisualRegionEvidenceSchema),
  })
  .strict()

export const VisualEvidenceBundleListSchema = z.array(VisualEvidenceBundleSchema)

export type VisualRegionEvidence = z.infer<typeof VisualRegionEvidenceSchema>
export type VisualEvidenceBundle = z.infer<typeof VisualEvidenceBundleSchema>

export function readLatestTaskVisualEvidenceBundleSync(input: {
  projectDir: string
  taskID: string
}): VisualEvidenceBundle[] | undefined {
  const paths = ProjectRuntimePaths.frontendDesignPaths(input.projectDir, input.taskID)
  const bundlePath = path.join(paths.webpageEvidenceAbsolute, "visual-evidence-bundle.json")
  let raw: string
  try {
    raw = fs.readFileSync(bundlePath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
  const parsed = VisualEvidenceBundleSchema.safeParse(JSON.parse(raw))
  if (!parsed.success) {
    throw new Error(`Invalid VisualEvidenceBundle at ${bundlePath}: ${parsed.error.message}`)
  }
  if (parsed.data.taskID !== input.taskID) {
    throw new Error(`VisualEvidenceBundle ${parsed.data.id} belongs to ${parsed.data.taskID}, not ${input.taskID}`)
  }
  return [parsed.data]
}

export function browserPreviewEvidenceIDFromRef(ref: string): string | undefined {
  const trimmed = ref.trim()
  const withoutPrefix = trimmed.startsWith("browser_preview_evidence:")
    ? trimmed.slice("browser_preview_evidence:".length).trim()
    : trimmed
  return withoutPrefix.startsWith("art_") ? withoutPrefix : undefined
}

export function visualRegionHasReferenceComparisonRef(region: VisualRegionEvidence): boolean {
  return region.evidenceRefs.some((ref) => Boolean(browserPreviewEvidenceIDFromRef(ref)))
}

export function visualEvidenceBundlePasses(bundle: VisualEvidenceBundle): boolean {
  const required = bundle.regions.filter((region) => region.required)
  return (
    required.length > 0 &&
    visualEvidenceBundleStructuralIssues(bundle).length === 0 &&
    bundle.inspection.status === "passing" &&
    bundle.inspection.blockerCount === 0 &&
    required.every((region) => region.status === "passing" && visualRegionHasReferenceComparisonRef(region))
  )
}

function visualEvidenceBundleStructuralIssues(bundle: VisualEvidenceBundle): string[] {
  const issues: string[] = []
  const required = bundle.regions.filter((region) => region.required)
  if (required.length === 0) issues.push("no required visual regions declared")
  const declaredRequired = new Set(bundle.pageCoverage.requiredRegionIDs)
  const requiredIDs = new Set(required.map((region) => region.id))
  for (const region of required) {
    if (!declaredRequired.has(region.id)) {
      issues.push(`${region.id}: missing from pageCoverage.requiredRegionIDs`)
    }
  }
  for (const regionID of declaredRequired) {
    if (!requiredIDs.has(regionID)) {
      issues.push(`pageCoverage.requiredRegionIDs includes ${regionID}, but no matching required region exists`)
    }
  }
  for (const interval of bundle.pageCoverage.coveredIntervals) {
    const bottom = interval.y + interval.height
    if (bottom > bundle.reference.height) {
      issues.push(
        `${interval.id}: pageCoverage covered interval exceeds reference height ${bundle.reference.height} at y=${interval.y} height=${interval.height}`,
      )
    }
    for (const regionID of interval.regionIDs) {
      if (!requiredIDs.has(regionID)) {
        issues.push(`${interval.id}: covered interval references non-required or unknown region ${regionID}`)
      }
    }
    const missingEvidenceRefs = interval.evidenceRefs.filter((ref) =>
      required.every((region) => !region.evidenceRefs.includes(ref)),
    )
    if (missingEvidenceRefs.length > 0) {
      issues.push(`${interval.id}: covered interval evidenceRefs are not attached to required regions: ${missingEvidenceRefs.join(", ")}`)
    }
  }
  issues.push(...referenceHeightCoverageIssues(bundle.reference.height, bundle.pageCoverage.coveredIntervals))
  for (const interval of bundle.pageCoverage.unexplainedBlankIntervals) {
    issues.push(
      `${interval.id}: unexplained blank interval ${interval.label} at source_reference_image_px y=${interval.y} height=${interval.height}`,
    )
  }
  return issues
}

export async function validateVisualEvidenceBundleReferenceComparisons(input: {
  projectRoot: string
  bundle: VisualEvidenceBundle
  expectedTaskID?: string
}): Promise<{ passing: boolean; issues: string[] }> {
  const issues: string[] = []
  const evidenceBackedIntervals: Array<{ y: number; height: number; regionID: string; evidenceID: string }> = []
  if (input.expectedTaskID && input.bundle.taskID !== input.expectedTaskID) {
    issues.push(`bundle task ${input.bundle.taskID} does not match expected task ${input.expectedTaskID}`)
  }
  const requiredRegions = input.bundle.regions.filter((item) => item.required)
  issues.push(...visualEvidenceBundleStructuralIssues(input.bundle))
  for (const region of requiredRegions) {
    const comparisonIDs = region.evidenceRefs
      .map(browserPreviewEvidenceIDFromRef)
      .filter((id): id is string => Boolean(id))
    if (comparisonIDs.length === 0) {
      issues.push(`${region.id}: missing browser_preview_evidence reference-comparison evidence ref`)
      continue
    }
    let matched = false
    for (const evidenceID of comparisonIDs) {
      let evidence
      try {
        evidence = await findReadableBrowserPreviewEvidenceByID({
          projectRoot: input.projectRoot,
          taskID: input.bundle.taskID,
          evidenceID,
        })
      } catch (error) {
        if (!BrowserPreviewEvidenceCorruptionError.isInstance(error)) throw error
        issues.push(`${region.id}: evidence ${evidenceID} was not found or has unreadable artifacts`)
        continue
      }
      if (!evidence) {
        issues.push(`${region.id}: evidence ${evidenceID} was not found or has unreadable artifacts`)
        continue
      }
      if (evidence.operationKind !== "reference-comparison") {
        issues.push(`${region.id}: evidence ${evidenceID} is ${evidence.operationKind}, not reference-comparison`)
        continue
      }
      if (evidence.status !== "passed") {
        issues.push(`${region.id}: evidence ${evidenceID} status is ${evidence.status}`)
        continue
      }
      if (evidence.regionID !== region.id) {
        issues.push(`${region.id}: evidence ${evidenceID} belongs to region ${evidence.regionID ?? "(none)"}`)
        continue
      }
      if (evidence.viewportID !== region.viewport) {
        issues.push(`${region.id}: evidence ${evidenceID} viewport is ${evidence.viewportID}, not ${region.viewport}`)
        continue
      }
      if (evidence.cropIntent !== region.cropIntent) {
        issues.push(
          `${region.id}: evidence ${evidenceID} crop intent is ${evidence.cropIntent ?? "(none)"}, not ${region.cropIntent}`,
        )
        continue
      }
      const validated = validateReferenceComparisonCapture({
        evidenceID,
        region,
        capture: evidence.capture,
        reference: input.bundle.reference,
        issues,
      })
      if (validated.sourceInterval) evidenceBackedIntervals.push(validated.sourceInterval)
      matched = true
      break
    }
    if (!matched) issues.push(`${region.id}: no readable passed reference-comparison evidence matched this region`)
  }
  issues.push(...referenceHeightCoverageIssues(input.bundle.reference.height, evidenceBackedIntervals, "evidence-backed"))
  return { passing: visualEvidenceBundlePasses(input.bundle) && issues.length === 0, issues }
}

function referenceHeightCoverageIssues(
  referenceHeight: number,
  intervals: readonly Array<{ id?: string; y: number; height: number }>,
  label = "pageCoverage",
): string[] {
  if (intervals.length === 0) return [`${label}: no covered source-reference intervals declared`]
  const issues: string[] = []
  const sorted = [...intervals]
    .map((interval) => ({ y: interval.y, bottom: interval.y + interval.height }))
    .sort((a, b) => a.y - b.y || a.bottom - b.bottom)
  let coveredUntil = 0
  for (const interval of sorted) {
    if (interval.y > coveredUntil) {
      issues.push(`${label}: uncovered source-reference interval y=${coveredUntil} height=${interval.y - coveredUntil}`)
    }
    if (interval.bottom > coveredUntil) coveredUntil = interval.bottom
  }
  if (coveredUntil < referenceHeight) {
    issues.push(`${label}: uncovered source-reference interval y=${coveredUntil} height=${referenceHeight - coveredUntil}`)
  }
  return issues
}

const ReferenceComparisonContentMetricsSchema = z
  .object({
    non_white_pixel_ratio: z.number().finite().min(0).max(1),
    unique_color_count: z.number().int().nonnegative(),
  })
  .strict()

const ReferenceComparisonCaptureSchema = z
  .object({
    operation: z.literal("reference-comparison"),
    region: z
      .object({
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

function validateReferenceComparisonCapture(input: {
  evidenceID: string
  region: VisualRegionEvidence
  capture: unknown
  reference: VisualEvidenceBundle["reference"]
  issues: string[]
}): { sourceInterval?: { y: number; height: number; regionID: string; evidenceID: string } } {
  const parsed = ReferenceComparisonCaptureSchema.safeParse(input.capture)
  if (!parsed.success) {
    input.issues.push(
      `${input.region.id}: evidence ${input.evidenceID} missing structured reference-comparison capture with source bbox, coverage, and content metrics`,
    )
    return {}
  }
  const capture = parsed.data.region
  if (!capture.source_bbox) {
    input.issues.push(`${input.region.id}: evidence ${input.evidenceID} missing source_bbox`)
  }
  if (!capture.source_image_size) {
    input.issues.push(`${input.region.id}: evidence ${input.evidenceID} missing source_image_size`)
  }
  if (capture.source_bbox && capture.source_image_size) {
    const right = capture.source_bbox.x + capture.source_bbox.width
    const bottom = capture.source_bbox.y + capture.source_bbox.height
    if (right > capture.source_image_size.width || bottom > capture.source_image_size.height) {
      input.issues.push(
        `${input.region.id}: evidence ${input.evidenceID} source_bbox exceeds source_image_size ${capture.source_image_size.width}x${capture.source_image_size.height}`,
      )
    }
    if (
      capture.source_image_size.width !== input.reference.width ||
      capture.source_image_size.height !== input.reference.height
    ) {
      input.issues.push(
        `${input.region.id}: evidence ${input.evidenceID} source_image_size ${capture.source_image_size.width}x${capture.source_image_size.height} does not match bundle reference ${input.reference.width}x${input.reference.height}`,
      )
    }
  }
  if (!capture.coverage?.implementation_matches_source_size) {
    input.issues.push(`${input.region.id}: evidence ${input.evidenceID} implementation crop does not match source size`)
  }
  if (!capture.visual?.dimensions_match || capture.visual.total_pixels <= 0) {
    input.issues.push(`${input.region.id}: evidence ${input.evidenceID} missing valid visual dimensions metrics`)
  }
  if (!capture.content) {
    input.issues.push(`${input.region.id}: evidence ${input.evidenceID} missing source/implementation content metrics`)
    return {}
  }
  if (
    capture.content.source.non_white_pixel_ratio >= 0.002 &&
    capture.content.implementation.non_white_pixel_ratio <= 0.0001
  ) {
    input.issues.push(`${input.region.id}: evidence ${input.evidenceID} implementation content metrics indicate a blank crop`)
  }
  if (capture.content.source.unique_color_count >= 3 && capture.content.implementation.unique_color_count <= 1) {
    input.issues.push(
      `${input.region.id}: evidence ${input.evidenceID} implementation unique color count indicates a monochrome blank crop`,
    )
  }
  return capture.source_bbox
    ? {
        sourceInterval: {
          y: capture.source_bbox.y,
          height: capture.source_bbox.height,
          regionID: input.region.id,
          evidenceID: input.evidenceID,
        },
      }
    : {}
}

export function summarizeVisualEvidenceBundle(bundle: VisualEvidenceBundle): string {
  const required = bundle.regions.filter((region) => region.required)
  const failing = required.filter((region) => region.status !== "passing")
  return [
    `visual_evidence_bundle=${bundle.id}`,
    `source=${bundle.source}`,
    `reference=${bundle.reference.path} ${bundle.reference.width}x${bundle.reference.height}`,
    `rendered=${bundle.rendered.path} ${bundle.rendered.width}x${bundle.rendered.height}`,
    `viewport=${bundle.rendered.viewport.width}x${bundle.rendered.viewport.height}`,
    `inspection_status=${bundle.inspection.status}`,
    `production_blockers=${bundle.inspection.blockerCount}`,
    bundle.inspection.path ? `inspection=${bundle.inspection.path}` : "",
    `inspection_notes=${bundle.inspection.notes}`,
    `required_regions=${required.length}`,
    `page_coverage_required_regions=${bundle.pageCoverage.requiredRegionIDs.join(", ")}`,
    `page_coverage_intervals=${bundle.pageCoverage.coveredIntervals.length}`,
    `unexplained_blank_intervals=${bundle.pageCoverage.unexplainedBlankIntervals.length}`,
    `failing_required_regions=${failing.map((region) => `${region.id}:${region.status}`).join(", ") || "(none)"}`,
    `project_directory=${bundle.rendered.projectDirectory}`,
    bundle.rendered.commitRef ? `commit_ref=${bundle.rendered.commitRef}` : "",
  ]
    .filter(Boolean)
    .join("; ")
}
