import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { Identifier } from "@/id/id"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { requireRuntimePackage } from "@/runtime/package-require"
import { evaluateVisual, isEvaluationReportPassing, WEBPAGE_EVALUATE_PASS_SCORE } from "@/verification/visual/evaluate"
import { runBrowserPreviewRegionComparisonCapture } from "./evidence-runner"
import { BrowserPreviewViewportID } from "./viewport"
import { normalizeRuntimePathRefs, persistBrowserPreviewEvidence } from "./persist"

const sharp = requireRuntimePackage<typeof import("sharp")>("sharp")

const SOURCE_REFERENCE_FILES = new Set(["reference.png", "reference-mobile.png"])

export const BrowserPreviewRegionBox = z
  .object({
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  })
  .strict()
export type BrowserPreviewRegionBox = z.infer<typeof BrowserPreviewRegionBox>

export const BrowserPreviewRegionLocator = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("test-id"), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("data-oc-region"), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("role"), role: z.string().min(1), name: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("selector"), value: z.string().min(1), owner_file: z.string().min(1) }).strict(),
])
export type BrowserPreviewRegionLocator = z.infer<typeof BrowserPreviewRegionLocator>

export const BrowserPreviewRegionBinding = z
  .object({
    region_id: z.string().min(1),
    viewport_id: BrowserPreviewViewportID,
    state_id: z.string().min(1).default("default"),
    region_scope: z.enum(["page-section", "card", "content", "title", "chart", "table", "control", "navigation"]),
    source: z
      .object({
        reference_artifact_id: z.string().min(1),
        bbox: BrowserPreviewRegionBox,
        semantic_role: z.string().min(1),
        text_anchors: z.array(z.string().min(1)).default([]),
        source_refs: z.array(z.string().min(1)).default([]),
      })
      .strict(),
    implementation: z
      .object({
        route: z.string().min(1).default("/"),
        locator: BrowserPreviewRegionLocator,
        component_files: z.array(z.string().min(1)).default([]),
      })
      .strict(),
    acceptance_refs: z.array(z.string().min(1)).default([]),
  })
  .strict()
export type BrowserPreviewRegionBinding = z.infer<typeof BrowserPreviewRegionBinding>

export const BrowserPreviewRegionComparisonRequest = z
  .object({
    targetID: z.string().min(1),
    viewportIDs: BrowserPreviewViewportID.array().min(1),
    inlineBindings: BrowserPreviewRegionBinding.array().min(1),
    output: z
      .object({
        include_fullpage_overview: z.boolean().default(false),
        include_side_by_side: z.boolean().default(true),
        include_diff: z.boolean().default(false),
      })
      .strict()
      .default({
        include_fullpage_overview: false,
        include_side_by_side: true,
        include_diff: false,
      }),
  })
  .strict()
export type BrowserPreviewRegionComparisonRequest = z.infer<typeof BrowserPreviewRegionComparisonRequest>

export const BrowserPreviewRegionComparisonResult = z.object({
  status: z.enum(["passed", "failed"]),
  manifestPath: z.string(),
  jobID: z.string(),
  taskID: z.string(),
  targetID: z.string(),
  operation: z.literal("reference-comparison"),
  evidenceIDs: z.record(z.string(), z.string()),
  regions: z.array(
    z.object({
      region_id: z.string(),
      viewport_id: BrowserPreviewViewportID,
      state_id: z.string().optional(),
      status: z.enum(["completed", "failed"]),
      reason: z.string().optional(),
      source_bbox: BrowserPreviewRegionBox.optional(),
      implementation_bbox: BrowserPreviewRegionBox.optional(),
      visual: z
        .object({
          overall_score: z.number(),
          pass_threshold: z.number(),
          ssim_score: z.number(),
          pixel_diff_percent: z.number(),
          mismatched_pixels: z.number(),
          total_pixels: z.number(),
          dimensions_match: z.boolean(),
        })
        .optional(),
      artifacts: z
        .object({
          source_crop: z.string(),
          implementation_crop: z.string(),
          side_by_side: z.string(),
          diff: z.string().optional(),
        })
        .optional(),
      diagnostics: z.array(z.string()),
    }),
  ),
  diagnostics: z.array(z.string()),
})
export type BrowserPreviewRegionComparisonResult = z.infer<typeof BrowserPreviewRegionComparisonResult>

type BrowserPreviewRegionComparisonInput = {
  projectRoot: string
  taskID: string
  targetID: string
  bindings: BrowserPreviewRegionBinding[]
  viewportIDs: BrowserPreviewViewportID[]
  includeFullpageOverview?: boolean
  includeSideBySide?: boolean
  includeDiff?: boolean
  signal?: AbortSignal
}

export async function compareBrowserPreviewRegions(
  input: BrowserPreviewRegionComparisonInput,
): Promise<BrowserPreviewRegionComparisonResult> {
  if (!input.taskID.trim() || !input.targetID.trim()) {
    throw new Error("Browser preview region comparison requires taskID and targetID.")
  }
  const bindings = BrowserPreviewRegionBinding.array().parse(input.bindings)
  const jobID = Identifier.ascending("artifact")
  let outDir = ProjectRuntimePaths.browserPreviewJobRoot(input.projectRoot, input.taskID, jobID)
  let resultJobID = jobID

  const selectedViewportIDs = dedupeViewportIDs(input.viewportIDs)
  const selectedBindings = bindings.filter((binding) => selectedViewportIDs.includes(binding.viewport_id))
  assertUniqueBindingKeys(selectedBindings)
  const initialRegions: BrowserPreviewRegionComparisonResult["regions"] = []
  if (selectedBindings.length === 0) {
    initialRegions.push(
      ...selectedViewportIDs.map((viewportID) => ({
        region_id: "(none)",
        viewport_id: viewportID,
        status: "failed" as const,
        reason: "No region bindings matched the requested viewport.",
        diagnostics: ["No region bindings matched the requested viewport."],
      })),
    )
  }

  const sourceRefs = new Map<string, { path: string; bbox: BrowserPreviewRegionBox }>()
  for (const binding of selectedBindings) {
    try {
      sourceRefs.set(bindingKey(binding), {
        path: resolveSourceReferencePath({
          projectRoot: input.projectRoot,
          taskID: input.taskID,
          referenceArtifactID: binding.source.reference_artifact_id,
        }),
        bbox: binding.source.bbox,
      })
    } catch (error) {
      initialRegions.push({
        region_id: binding.region_id,
        viewport_id: binding.viewport_id,
        state_id: binding.state_id,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
        source_bbox: binding.source.bbox,
        diagnostics: [error instanceof Error ? error.message : String(error)],
      })
    }
  }

  const runnableBindings = selectedBindings.filter((binding) => sourceRefs.has(bindingKey(binding)))
  const sidecar = runnableBindings.length
    ? await runBrowserPreviewRegionComparisonCapture({
        projectRoot: input.projectRoot,
        taskID: input.taskID,
        targetID: input.targetID,
        viewportIDs: selectedViewportIDs,
        bindings: runnableBindings,
        includeFullpageOverview: input.includeFullpageOverview === true,
        signal: input.signal,
      })
    : undefined
  if (sidecar) {
    outDir = sidecar.outDir
    resultJobID = sidecar.jobID
  }
  await fs.mkdir(outDir, { recursive: true })

  const regions: BrowserPreviewRegionComparisonResult["regions"] = [...initialRegions]
  if (sidecar) {
    for (const region of sidecar.regions) {
      const binding = runnableBindings.find(
        (item) =>
          item.region_id === region.regionID &&
          item.viewport_id === region.viewportID &&
          item.state_id === region.stateID,
      )
      if (!binding) continue
      const source = sourceRefs.get(bindingKey(binding))
      if (!source) continue
      if (region.status !== "completed" || !region.bbox || !region.screenshotPath) {
        regions.push({
          region_id: binding.region_id,
          viewport_id: binding.viewport_id,
          state_id: binding.state_id,
          status: "failed",
          reason: region.reason ?? "Implementation region was not found.",
          source_bbox: binding.source.bbox,
          diagnostics: [region.reason ?? "Implementation region was not found."],
        })
        continue
      }
      try {
        regions.push(
          await materializeRegionComparison({
            outDir,
            binding,
            sourceImagePath: source.path,
            sourceBox: source.bbox,
            implementationImagePath: region.screenshotPath,
            implementationBox: region.bbox,
            includeSideBySide: input.includeSideBySide !== false,
            includeDiff: input.includeDiff === true,
          }),
        )
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        regions.push({
          region_id: binding.region_id,
          viewport_id: binding.viewport_id,
          state_id: binding.state_id,
          status: "failed",
          reason,
          source_bbox: binding.source.bbox,
          implementation_bbox: region.bbox,
          diagnostics: [reason],
        })
      }
    }
  }

  const manifestPath = path.join(outDir, "manifest.json")
  const diagnostics = regions.flatMap((region) => region.diagnostics)
  const evidenceIDs: Record<string, string> = {}
  for (const region of regions) {
    const evidenceID = persistBrowserPreviewEvidence({
      projectRoot: input.projectRoot,
      taskID: input.taskID,
      targetID: input.targetID,
      viewportID: region.viewport_id,
      operationKind: "reference-comparison",
      regionID: region.region_id,
      stateID: region.state_id,
      manifestPath,
      artifactPaths: region.artifacts,
      status: region.status === "completed" ? "passed" : "failed",
      summary:
        region.status === "completed"
          ? `reference comparison completed for ${region.region_id} (${region.state_id ?? "default"}, ${region.viewport_id})`
          : `reference comparison failed for ${region.region_id} (${region.state_id ?? "default"}, ${region.viewport_id}): ${region.reason}`,
      capture: {
        operation: "reference-comparison",
        manifest_path: manifestPath,
        region,
      },
      diagnostics: region.diagnostics,
    })
    evidenceIDs[regionKey(region)] = evidenceID
  }
  const result: BrowserPreviewRegionComparisonResult = {
    status: regions.length > 0 && regions.every((region) => region.status === "completed") ? "passed" : "failed",
    manifestPath,
    jobID: resultJobID,
    taskID: input.taskID,
    targetID: input.targetID,
    operation: "reference-comparison",
    evidenceIDs,
    regions,
    diagnostics,
  }
  const publicResult = normalizeRuntimePathRefs(input.projectRoot, result) as BrowserPreviewRegionComparisonResult
  await fs.writeFile(manifestPath, JSON.stringify(publicResult, null, 2), "utf8")
  return publicResult
}

export function resolveSourceReferencePath(input: {
  projectRoot: string
  taskID: string
  referenceArtifactID: string
}): string {
  const paths = ProjectRuntimePaths.frontendDesignPaths(input.projectRoot, input.taskID)
  const normalized = input.referenceArtifactID.replaceAll("\\", "/").replace(/^\.?\//, "")
  const relative =
    normalized === "reference.png" || normalized === "reference-mobile.png"
      ? normalized
      : normalized.startsWith("web-clone-source/")
        ? normalized.slice("web-clone-source/".length)
        : ""
  if (!SOURCE_REFERENCE_FILES.has(relative)) {
    throw new Error(
      `Source reference must resolve to web-clone-source/reference.png or web-clone-source/reference-mobile.png: ${input.referenceArtifactID}`,
    )
  }
  const resolved = path.resolve(paths.sourcePackageAbsolute, relative)
  const sourceRoot = path.resolve(paths.sourcePackageAbsolute)
  if (!resolved.startsWith(sourceRoot + path.sep)) {
    throw new Error(`Source reference escapes web-clone-source: ${input.referenceArtifactID}`)
  }
  return resolved
}

async function materializeRegionComparison(input: {
  outDir: string
  binding: BrowserPreviewRegionBinding
  sourceImagePath: string
  sourceBox: BrowserPreviewRegionBox
  implementationImagePath: string
  implementationBox: BrowserPreviewRegionBox
  includeSideBySide: boolean
  includeDiff: boolean
}): Promise<BrowserPreviewRegionComparisonResult["regions"][number]> {
  const dir = path.join(input.outDir, "regions", input.binding.viewport_id, input.binding.state_id, regionDirectoryKey(input.binding))
  await fs.mkdir(dir, { recursive: true })
  const sourceCrop = path.join(dir, "source.png")
  const implementationCrop = path.join(dir, "implementation.png")
  await cropPng(input.sourceImagePath, sourceCrop, input.sourceBox, "source")
  await cropPng(input.implementationImagePath, implementationCrop, input.implementationBox, "implementation")
  const sideBySide = path.join(dir, "side-by-side.png")
  await makeSideBySide({
    leftPath: sourceCrop,
    rightPath: implementationCrop,
    outputPath: sideBySide,
    title: `${input.binding.region_id} [${input.binding.state_id}] (${input.binding.viewport_id})`,
  })
  const artifacts: NonNullable<BrowserPreviewRegionComparisonResult["regions"][number]["artifacts"]> = {
    source_crop: sourceCrop,
    implementation_crop: implementationCrop,
    side_by_side: sideBySide,
  }
  const visualReport = await evaluateVisual({
    originalImage: sourceCrop,
    renderedImage: implementationCrop,
  })
  if (input.includeDiff) {
    const diff = path.join(dir, "diff.png")
    await writeDataUrlPng(visualReport.diffImageDataUrl, diff)
    artifacts.diff = diff
  }
  const visual = {
    overall_score: visualReport.overallScore,
    pass_threshold: WEBPAGE_EVALUATE_PASS_SCORE,
    ssim_score: visualReport.ssimScore,
    pixel_diff_percent: visualReport.pixelDiffPercent,
    mismatched_pixels: visualReport.mismatchedPixels,
    total_pixels: visualReport.totalPixels,
    dimensions_match: visualReport.dimensionsMatch,
  }
  const passed = isEvaluationReportPassing(visualReport, WEBPAGE_EVALUATE_PASS_SCORE)
  return {
    region_id: input.binding.region_id,
    viewport_id: input.binding.viewport_id,
    state_id: input.binding.state_id,
    status: passed ? "completed" : "failed",
    reason: passed
      ? undefined
      : `Region visual score ${visualReport.overallScore}/100 below threshold ${WEBPAGE_EVALUATE_PASS_SCORE}/100.`,
    source_bbox: input.sourceBox,
    implementation_bbox: input.implementationBox,
    visual,
    artifacts,
    diagnostics: [
      passed
        ? `reference comparison completed for ${input.binding.region_id}: visual score ${visualReport.overallScore}/100`
        : `reference comparison failed for ${input.binding.region_id}: visual score ${visualReport.overallScore}/100 below ${WEBPAGE_EVALUATE_PASS_SCORE}/100`,
    ],
  }
}

async function cropPng(
  inputPath: string,
  outputPath: string,
  box: BrowserPreviewRegionBox,
  boxRole: "source" | "implementation",
): Promise<void> {
  const metadata = await sharp(inputPath).metadata()
  if (!metadata.width || !metadata.height) throw new Error(`Cannot read PNG dimensions: ${inputPath}`)
  const left = Math.floor(box.x)
  const top = Math.floor(box.y)
  const width = Math.ceil(box.width)
  const height = Math.ceil(box.height)
  assertCropBoxInsideImage({
    inputPath,
    box,
    boxRole,
    left,
    top,
    width,
    height,
    imageWidth: metadata.width,
    imageHeight: metadata.height,
  })
  await sharp(inputPath).extract({ left, top, width, height }).png().toFile(outputPath)
}

function assertCropBoxInsideImage(input: {
  inputPath: string
  box: BrowserPreviewRegionBox
  boxRole: "source" | "implementation"
  left: number
  top: number
  width: number
  height: number
  imageWidth: number
  imageHeight: number
}): void {
  if (
    input.left < 0 ||
    input.top < 0 ||
    input.width < 1 ||
    input.height < 1 ||
    input.left + input.width > input.imageWidth ||
    input.top + input.height > input.imageHeight
  ) {
    throw new Error(
      `Browser preview ${input.boxRole} bbox exceeds ${input.boxRole} image bounds: ` +
        `box=${input.box.x},${input.box.y},${input.box.width},${input.box.height} ` +
        `image=${input.imageWidth}x${input.imageHeight} path=${input.inputPath}`,
    )
  }
}

async function makeSideBySide(input: {
  leftPath: string
  rightPath: string
  outputPath: string
  title: string
}): Promise<void> {
  const [leftMeta, rightMeta] = await Promise.all([sharp(input.leftPath).metadata(), sharp(input.rightPath).metadata()])
  if (!leftMeta.width || !leftMeta.height || !rightMeta.width || !rightMeta.height) {
    throw new Error("Cannot compose side-by-side comparison without image dimensions.")
  }
  const titleHeight = 44
  const labelHeight = 32
  const gap = 16
  const width = leftMeta.width + rightMeta.width + gap
  const height = titleHeight + labelHeight + Math.max(leftMeta.height, rightMeta.height)
  const labels = Buffer.from(`
    <svg width="${width}" height="${titleHeight + labelHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#f6f7f9"/>
      <text x="12" y="28" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#111827">${escapeXml(input.title)}</text>
      <text x="12" y="${titleHeight + 22}" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#374151">Source reference</text>
      <text x="${leftMeta.width + gap + 12}" y="${titleHeight + 22}" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#374151">Local implementation</text>
    </svg>
  `)
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: "#f6f7f9",
    },
  })
    .composite([
      { input: labels, left: 0, top: 0 },
      { input: input.leftPath, left: 0, top: titleHeight + labelHeight },
      { input: input.rightPath, left: leftMeta.width + gap, top: titleHeight + labelHeight },
    ])
    .png()
    .toFile(input.outputPath)
}

async function writeDataUrlPng(input: string, outputPath: string): Promise<void> {
  const prefix = "data:image/png;base64,"
  if (!input.startsWith(prefix)) {
    throw new Error("Visual comparison diff must be a PNG data URL.")
  }
  await fs.writeFile(outputPath, Buffer.from(input.slice(prefix.length), "base64"))
}

function bindingKey(binding: BrowserPreviewRegionBinding): string {
  return `${binding.viewport_id}:${binding.state_id}:${binding.region_id}`
}

function regionKey(region: { viewport_id: BrowserPreviewViewportID; state_id?: string; region_id: string }): string {
  return `${region.viewport_id}:${region.state_id ?? "default"}:${region.region_id}`
}

function dedupeViewportIDs(ids: BrowserPreviewViewportID[]): BrowserPreviewViewportID[] {
  const out: BrowserPreviewViewportID[] = []
  for (const id of ids) {
    if (!out.includes(id)) out.push(id)
  }
  return out
}

function sanitizeSegment(value: string): string {
  const hash = crypto.createHash("sha256").update(value).digest("hex").slice(0, 8)
  return `${value.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 64)}-${hash}`
}

function regionDirectoryKey(binding: BrowserPreviewRegionBinding): string {
  return sanitizeSegment(`${binding.viewport_id}:${binding.state_id}:${binding.region_id}`)
}

function assertUniqueBindingKeys(bindings: BrowserPreviewRegionBinding[]): void {
  const seen = new Set<string>()
  for (const binding of bindings) {
    const key = bindingKey(binding)
    if (seen.has(key)) {
      throw new Error(`Duplicate browser preview region comparison binding identity: ${key}`)
    }
    seen.add(key)
  }
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => {
    const entities: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }
    return entities[char] ?? char
  })
}
