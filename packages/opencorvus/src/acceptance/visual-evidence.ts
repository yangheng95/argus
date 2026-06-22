import fs from "node:fs"
import path from "node:path"
import z from "zod"
import { findReadableBrowserPreviewEvidenceByID } from "@/browser-preview/persist"
import { ProjectRuntimePaths } from "@/project/runtime-paths"

export const VisualRegionEvidenceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  requirementIDs: z.array(z.string().min(1)),
  acceptanceSpecIDs: z.array(z.string().min(1)),
  sourceRefs: z.array(z.string().min(1)),
  viewport: z.string().min(1),
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
}).strict()

export const VisualEvidenceBundleSchema = z.object({
  id: z.string().min(1),
  taskID: z.string().min(1),
  source: z.enum(["frontend_design", "build", "integrity"]),
  reference: z.object({
    path: z.string().min(1),
    sha256: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).strict(),
  rendered: z.object({
    path: z.string().min(1),
    sha256: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    capturedAt: z.string().min(1),
    viewport: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      deviceScaleFactor: z.number().positive().optional(),
    }).strict(),
    appURL: z.string().min(1),
    projectDirectory: z.string().min(1),
    commitRef: z.string().min(1).optional(),
  }).strict(),
  inspection: z.object({
    path: z.string().min(1).optional(),
    reviewedAt: z.string().min(1),
    status: z.enum(["passing", "failing", "incomplete"]),
    blockerCount: z.number().int().min(0),
    notes: z.string().min(1),
  }).strict(),
  regions: z.array(VisualRegionEvidenceSchema),
}).strict()

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
    bundle.inspection.status === "passing" &&
    bundle.inspection.blockerCount === 0 &&
    required.every((region) => region.status === "passing" && visualRegionHasReferenceComparisonRef(region))
  )
}

export async function validateVisualEvidenceBundleReferenceComparisons(input: {
  projectRoot: string
  bundle: VisualEvidenceBundle
  expectedTaskID?: string
}): Promise<{ passing: boolean; issues: string[] }> {
  const issues: string[] = []
  if (input.expectedTaskID && input.bundle.taskID !== input.expectedTaskID) {
    issues.push(`bundle task ${input.bundle.taskID} does not match expected task ${input.expectedTaskID}`)
  }
  const requiredRegions = input.bundle.regions.filter((item) => item.required)
  if (requiredRegions.length === 0) {
    issues.push("no required visual regions declared")
  }
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
      const evidence = await findReadableBrowserPreviewEvidenceByID({
        projectRoot: input.projectRoot,
        taskID: input.bundle.taskID,
        evidenceID,
      })
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
      matched = true
      break
    }
    if (!matched) issues.push(`${region.id}: no readable passed reference-comparison evidence matched this region`)
  }
  return { passing: visualEvidenceBundlePasses(input.bundle) && issues.length === 0, issues }
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
    `failing_required_regions=${failing.map((region) => `${region.id}:${region.status}`).join(", ") || "(none)"}`,
    `project_directory=${bundle.rendered.projectDirectory}`,
    bundle.rendered.commitRef ? `commit_ref=${bundle.rendered.commitRef}` : "",
  ]
    .filter(Boolean)
    .join("; ")
}
