import z from "zod"

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
    .optional(),
  required: z.boolean(),
  status: z.enum(["passing", "failing", "deferred"]),
  evidenceRefs: z.array(z.string().min(1)),
  notes: z.string(),
})

export const VisualEvidenceBundleSchema = z.object({
  id: z.string().min(1),
  taskID: z.string().min(1),
  source: z.enum(["frontend_design", "build", "integrity"]),
  reference: z.object({
    path: z.string().min(1),
    sha256: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
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
    }),
    appURL: z.string().min(1),
    projectDirectory: z.string().min(1),
    commitRef: z.string().min(1).optional(),
  }),
  evaluation: z.object({
    path: z.string().min(1),
    overallScore: z.number(),
    passThreshold: z.number(),
    passed: z.boolean(),
    ssimScore: z.number(),
    pixelDiffPercent: z.number(),
    dimensionsMatch: z.boolean(),
  }),
  vision: z.object({
    path: z.string().min(1),
    accepted: z.boolean(),
    differenceCount: z.number().int().min(0),
    criticalCount: z.number().int().min(0),
    majorCount: z.number().int().min(0),
    minorCount: z.number().int().min(0),
  }),
  regions: z.array(VisualRegionEvidenceSchema),
})

export const VisualEvidenceBundleListSchema = z.array(VisualEvidenceBundleSchema)

export type VisualRegionEvidence = z.infer<typeof VisualRegionEvidenceSchema>
export type VisualEvidenceBundle = z.infer<typeof VisualEvidenceBundleSchema>

export function visualEvidenceBundlePasses(bundle: VisualEvidenceBundle): boolean {
  return (
    bundle.evaluation.passed &&
    bundle.vision.accepted &&
    bundle.regions.filter((region) => region.required).every((region) => region.status === "passing")
  )
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
    `score=${bundle.evaluation.overallScore}/${bundle.evaluation.passThreshold}`,
    `evaluation_passed=${bundle.evaluation.passed}`,
    `vision_accepted=${bundle.vision.accepted}`,
    `differences=${bundle.vision.differenceCount} critical=${bundle.vision.criticalCount} major=${bundle.vision.majorCount} minor=${bundle.vision.minorCount}`,
    `required_regions=${required.length}`,
    `failing_required_regions=${failing.map((region) => `${region.id}:${region.status}`).join(", ") || "(none)"}`,
    `project_directory=${bundle.rendered.projectDirectory}`,
    bundle.rendered.commitRef ? `commit_ref=${bundle.rendered.commitRef}` : "",
  ]
    .filter(Boolean)
    .join("; ")
}
