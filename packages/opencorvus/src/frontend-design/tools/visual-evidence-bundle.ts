import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"

import { VisualEvidenceBundleSchema, type VisualEvidenceBundle } from "@/acceptance/visual-evidence"
import { readPngEvidence } from "@/web-clone/evidence-integrity"

const EvalResultSchema = z.object({
  generatedAt: z.string().optional(),
  referencePath: z.string().min(1),
  renderedPath: z.string().min(1),
  overallScore: z.number(),
  passThreshold: z.number(),
  passed: z.boolean(),
  ssimScore: z.number(),
  pixelDiffPercent: z.number(),
  dimensionsMatch: z.boolean(),
})

const RenderResultSchema = z.object({
  generatedAt: z.string().optional(),
  url: z.string().min(1),
  renderedPath: z.string().min(1),
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  projectDirectory: z.string().min(1).optional(),
})

const VisionJudgeSchema = z.object({
  generatedAt: z.string().optional(),
  referencePath: z.string().min(1),
  renderedPath: z.string().min(1),
  accepted: z.boolean(),
  differences: z.array(z.object({
    severity: z.enum(["critical", "major", "minor"]),
    region: z.string().min(1),
    observed: z.string().min(1),
    expected: z.string().min(1),
    fix_hint: z.string().min(1),
  })).default([]),
})

export async function tryMaterializeVisualEvidenceBundle(input: {
  outputDir: string
  taskID?: string
  source: VisualEvidenceBundle["source"]
  projectDirectory?: string
  commitRef?: string
}): Promise<VisualEvidenceBundle | undefined> {
  if (!input.taskID) return undefined
  const evalPath = path.join(input.outputDir, "eval-result.json")
  const visionPath = path.join(input.outputDir, "vision-judge.json")
  const renderPath = path.join(input.outputDir, "render-result.json")

  const [evalRaw, visionRaw, renderRaw] = await Promise.all([
    readJson(evalPath),
    readJson(visionPath),
    readJson(renderPath),
  ])
  if (!evalRaw || !visionRaw || !renderRaw) return undefined

  const evalResult = EvalResultSchema.safeParse(evalRaw)
  const vision = VisionJudgeSchema.safeParse(visionRaw)
  const render = RenderResultSchema.safeParse(renderRaw)
  if (!evalResult.success || !vision.success || !render.success) return undefined

  const reference = await readPngEvidence(evalResult.data.referencePath)
  const rendered = await readPngEvidence(evalResult.data.renderedPath)
  if (!reference.valid || !rendered.valid || !reference.sha256 || !rendered.sha256 || !reference.width || !reference.height || !rendered.width || !rendered.height) {
    return undefined
  }

  const bundle = VisualEvidenceBundleSchema.parse({
    id: `veb_${input.source}_${reference.sha256.slice(0, 8)}_${rendered.sha256.slice(0, 8)}`,
    taskID: input.taskID,
    source: input.source,
    reference: {
      path: reference.path,
      sha256: reference.sha256,
      width: reference.width,
      height: reference.height,
    },
    rendered: {
      path: rendered.path,
      sha256: rendered.sha256,
      width: rendered.width,
      height: rendered.height,
      capturedAt: render.data.generatedAt ?? evalResult.data.generatedAt ?? new Date().toISOString(),
      viewport: render.data.viewport,
      appURL: render.data.url,
      projectDirectory: input.projectDirectory ?? render.data.projectDirectory ?? path.dirname(input.outputDir),
      commitRef: input.commitRef,
    },
    evaluation: {
      path: evalPath,
      overallScore: evalResult.data.overallScore,
      passThreshold: evalResult.data.passThreshold,
      passed: evalResult.data.passed,
      ssimScore: evalResult.data.ssimScore,
      pixelDiffPercent: evalResult.data.pixelDiffPercent,
      dimensionsMatch: evalResult.data.dimensionsMatch,
    },
    vision: {
      path: visionPath,
      accepted: vision.data.accepted,
      differenceCount: vision.data.differences.length,
      criticalCount: vision.data.differences.filter((item) => item.severity === "critical").length,
      majorCount: vision.data.differences.filter((item) => item.severity === "major").length,
      minorCount: vision.data.differences.filter((item) => item.severity === "minor").length,
    },
    regions: buildRegions({
      differences: vision.data.differences,
      evidenceRefs: [reference.path, rendered.path, evalPath, visionPath],
      passing: evalResult.data.passed && vision.data.accepted,
    }),
  })

  await fs.writeFile(path.join(input.outputDir, "visual-evidence-bundle.json"), JSON.stringify(bundle, null, 2), "utf8")
  return bundle
}

async function readJson(file: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"))
  } catch {
    return undefined
  }
}

function buildRegions(input: {
  differences: Array<z.infer<typeof VisionJudgeSchema>["differences"][number]>
  evidenceRefs: string[]
  passing: boolean
}): VisualEvidenceBundle["regions"] {
  if (input.differences.length === 0) {
    return [{
      id: "region_full_page",
      label: "Full page",
      requirementIDs: [],
      acceptanceSpecIDs: [],
      sourceRefs: input.evidenceRefs,
      viewport: "primary",
      required: true,
      status: input.passing ? "passing" : "failing",
      evidenceRefs: input.evidenceRefs,
      notes: input.passing ? "Numeric and qualitative evidence both passed." : "No qualitative differences were listed, but numeric or qualitative evidence did not pass.",
    }]
  }

  return input.differences.map((difference, index) => ({
    id: `region_${index + 1}_${slug(difference.region)}`,
    label: difference.region,
    requirementIDs: [],
    acceptanceSpecIDs: [],
    sourceRefs: input.evidenceRefs,
    viewport: "primary",
    required: true,
    status: "failing" as const,
    evidenceRefs: input.evidenceRefs,
    notes: `[${difference.severity}] observed=${difference.observed}; expected=${difference.expected}; fix=${difference.fix_hint}`,
  }))
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "visual_region"
}
