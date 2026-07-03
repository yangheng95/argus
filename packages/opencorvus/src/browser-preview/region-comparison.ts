import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { Identifier } from "@/id/id"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { requireRuntimePackage } from "@/runtime/package-require"
import { decodePNG, nonWhiteDensity, uniqueColorBucketCount } from "@/util/pixel-stats"
import { evaluateVisual, WEBPAGE_EVALUATE_PASS_SCORE } from "@/verification/visual/evaluate"
import { runBrowserPreviewRegionComparisonCapture } from "./evidence-runner"
import { browserPreviewViewportByID, BrowserPreviewViewport, BrowserPreviewViewportID } from "./viewport"
import { findBrowserPreviewTargetByID, normalizeRuntimePathRefs, persistBrowserPreviewEvidence } from "./persist"
import { BrowserPreviewCropIntent, BrowserPreviewRegionBinding, BrowserPreviewRegionBox } from "./region-schema"
import { resolveSourceReferencePath } from "./source-reference"
import { BrowserPreviewComparisonGuidance, BrowserPreviewComparisonGuidanceSchema } from "./comparison-guidance"

const sharp = requireRuntimePackage<typeof import("sharp")>("sharp")

export {
  BrowserPreviewRegionBinding,
  BrowserPreviewRegionBox,
  BrowserPreviewCropIntent,
  BrowserPreviewRegionLocator,
  BrowserPreviewSourceReferenceArtifactID,
} from "./region-schema"
export { resolveSourceReferencePath } from "./source-reference"

const BrowserPreviewImageSize = z
  .object({
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  })
  .strict()
type BrowserPreviewImageSizeValue = z.infer<typeof BrowserPreviewImageSize>

const BrowserPreviewRouteDiagnostics = z
  .object({
    route: z.string(),
    url: z.string().optional(),
    status: z.number().finite().optional(),
    content_type: z.string().optional(),
    body_length: z.number().finite().nonnegative().optional(),
    title: z.string().optional(),
    dom: z
      .object({
        text_length: z.number().finite().nonnegative(),
        node_count: z.number().finite().nonnegative(),
        body_descendant_count: z.number().finite().nonnegative(),
      })
      .strict()
      .optional(),
    page_size: BrowserPreviewImageSize.optional(),
    failed_requests: z
      .array(
        z
          .object({
            url: z.string(),
            status: z.number().finite(),
            reason: z.string(),
          })
          .strict(),
      )
      .default([]),
    console_errors: z.array(z.string()).default([]),
    page_errors: z.array(z.string()).default([]),
    valid_app_page: z.boolean(),
    reason: z.string().optional(),
    screenshot_path: z.string().optional(),
  })
  .strict()

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
  comparison_mode: z.literal("true-size"),
  artifact_note: z.string(),
  comparison_guidance: BrowserPreviewComparisonGuidanceSchema,
  evidenceIDs: z.record(z.string(), z.string()),
  regions: z.array(
    z.object({
      region_id: z.string(),
      viewport_id: BrowserPreviewViewportID,
      state_id: z.string().optional(),
      crop_intent: BrowserPreviewCropIntent.optional(),
      status: z.enum(["completed", "failed"]),
      reason: z.string().optional(),
      source_bbox: BrowserPreviewRegionBox.optional(),
      implementation_bbox: BrowserPreviewRegionBox.optional(),
      source_image_size: BrowserPreviewImageSize.optional(),
      implementation_viewport: BrowserPreviewImageSize.optional(),
      implementation_fullpage_size: BrowserPreviewImageSize.optional(),
      implementation_screenshot_path: z.string().optional(),
      route_diagnostics: BrowserPreviewRouteDiagnostics.optional(),
      artifact_note: z.string().optional(),
      visual: z
        .object({
          overall_score: z.number(),
          ssim_score: z.number(),
          pixel_diff_percent: z.number(),
          mismatched_pixels: z.number(),
          total_pixels: z.number(),
          dimensions_match: z.boolean(),
        })
        .optional(),
      coverage: z
        .object({
          source_width: z.number(),
          source_height: z.number(),
          implementation_width: z.number(),
          implementation_height: z.number(),
          implementation_covers_source: z.boolean(),
          implementation_matches_source_size: z.boolean(),
        })
        .optional(),
      content: z
        .object({
          source: z
            .object({
              non_white_pixel_ratio: z.number(),
              unique_color_count: z.number().int().nonnegative(),
            })
            .strict(),
          implementation: z
            .object({
              non_white_pixel_ratio: z.number(),
              unique_color_count: z.number().int().nonnegative(),
            })
            .strict(),
        })
        .strict()
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

const TRUE_SIZE_COMPARISON_ARTIFACT_NOTE =
  "True-size comparison: source and local implementation crops are stitched from their real screenshot dimensions without runner-side resizing; exact crop size matching is required, and crop size mismatch is evaluated as a parity failure."

type TrueSizeRegionVisualReport = {
  overallScore: number
  ssimScore: number
  pixelDiffPercent: number
  dimensionsMatch: boolean
  mismatchedPixels: number
  totalPixels: number
  diffImageDataUrl?: string
  sourceSize: BrowserPreviewImageSizeValue
  implementationSize: BrowserPreviewImageSizeValue
}

type RegionContentMetrics = {
  non_white_pixel_ratio: number
  unique_color_count: number
}

type BrowserPreviewRegionComparisonInput = {
  projectRoot: string
  taskID: string
  runID?: string
  goalRunID?: string
  acceptanceID?: string
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
  const target = findBrowserPreviewTargetByID({ taskID: input.taskID, targetID: input.targetID })
  if (!target) throw new Error(`Browser preview target not found: ${input.targetID}`)
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

  const sourceRefs = new Map<
    string,
    { path: string; bbox: BrowserPreviewRegionBox; imageSize: BrowserPreviewImageSizeValue }
  >()
  for (const binding of selectedBindings) {
    try {
      const resolvedPath = resolveSourceReferencePath({
        projectRoot: input.projectRoot,
        taskID: input.taskID,
        referenceArtifactID: binding.source.reference_artifact_id,
      })
      sourceRefs.set(bindingKey(binding), {
        path: resolvedPath,
        bbox: binding.source.bbox,
        imageSize: await readPngSize(resolvedPath),
      })
    } catch (error) {
      initialRegions.push({
        region_id: binding.region_id,
        viewport_id: binding.viewport_id,
        state_id: binding.state_id,
        crop_intent: binding.crop_intent,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
        source_bbox: binding.source.bbox,
        diagnostics: [error instanceof Error ? error.message : String(error)],
      })
    }
  }

  const runnableBindings = selectedBindings.filter((binding) => sourceRefs.has(bindingKey(binding)))
  const implementationViewportByID = comparisonImplementationViewportByID({
    selectedViewportIDs,
    targetViewports: target.viewports,
  })
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
        const reason = region.reason ?? "Implementation region was not found."
        const implementationViewport = region.viewport ?? implementationViewportByID[binding.viewport_id]
        regions.push({
          region_id: binding.region_id,
          viewport_id: binding.viewport_id,
          state_id: binding.state_id,
          crop_intent: binding.crop_intent,
          status: "failed",
          reason,
          source_bbox: binding.source.bbox,
          source_image_size: source.imageSize,
          implementation_viewport: implementationViewport,
          implementation_fullpage_size: region.fullpageSize,
          implementation_screenshot_path: region.screenshotPath,
          route_diagnostics: region.routeDiagnostics,
          diagnostics: [reason],
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
            sourceImageSize: source.imageSize,
            implementationImagePath: region.screenshotPath,
            implementationBox: region.bbox,
            implementationViewport: region.viewport ?? implementationViewportByID[binding.viewport_id],
            implementationFullpageSize: region.fullpageSize,
            implementationScreenshotPath: region.screenshotPath,
            routeDiagnostics: region.routeDiagnostics,
            includeSideBySide: input.includeSideBySide !== false,
            includeDiff: input.includeDiff === true,
          }),
        )
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        const implementationViewport = region.viewport ?? implementationViewportByID[binding.viewport_id]
        regions.push({
          region_id: binding.region_id,
          viewport_id: binding.viewport_id,
          state_id: binding.state_id,
          crop_intent: binding.crop_intent,
          status: "failed",
          reason,
          source_bbox: binding.source.bbox,
          implementation_bbox: region.bbox,
          source_image_size: source.imageSize,
          implementation_viewport: implementationViewport,
          implementation_fullpage_size: region.fullpageSize,
          implementation_screenshot_path: region.screenshotPath,
          route_diagnostics: region.routeDiagnostics,
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
      runID: input.runID,
      goalRunID: input.goalRunID,
      acceptanceID: input.acceptanceID,
      targetID: input.targetID,
      viewportID: region.viewport_id,
      operationKind: "reference-comparison",
      regionID: region.region_id,
      stateID: region.state_id,
      cropIntent: region.crop_intent,
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
    comparison_mode: "true-size",
    artifact_note: TRUE_SIZE_COMPARISON_ARTIFACT_NOTE,
    comparison_guidance: BrowserPreviewComparisonGuidance,
    evidenceIDs,
    regions,
    diagnostics: [TRUE_SIZE_COMPARISON_ARTIFACT_NOTE, ...diagnostics],
  }
  const publicResult = normalizeRuntimePathRefs(input.projectRoot, result) as BrowserPreviewRegionComparisonResult
  await fs.writeFile(manifestPath, JSON.stringify(publicResult, null, 2), "utf8")
  return publicResult
}

async function materializeRegionComparison(input: {
  outDir: string
  binding: BrowserPreviewRegionBinding
  sourceImagePath: string
  sourceBox: BrowserPreviewRegionBox
  sourceImageSize: BrowserPreviewImageSizeValue
  implementationImagePath: string
  implementationBox: BrowserPreviewRegionBox
  implementationViewport: BrowserPreviewImageSizeValue
  implementationFullpageSize?: BrowserPreviewImageSizeValue
  implementationScreenshotPath: string
  routeDiagnostics?: z.infer<typeof BrowserPreviewRouteDiagnostics>
  includeSideBySide: boolean
  includeDiff: boolean
}): Promise<BrowserPreviewRegionComparisonResult["regions"][number]> {
  const dir = path.join(
    input.outDir,
    "regions",
    input.binding.viewport_id,
    input.binding.state_id,
    regionDirectoryKey(input.binding),
  )
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
  const visualReport = await evaluateTrueSizeRegionVisual({
    sourceCrop,
    implementationCrop,
  })
  if (input.includeDiff && visualReport.diffImageDataUrl) {
    const diff = path.join(dir, "diff.png")
    await writeDataUrlPng(visualReport.diffImageDataUrl, diff)
    artifacts.diff = diff
  }
  const visual = {
    overall_score: visualReport.overallScore,
    ssim_score: visualReport.ssimScore,
    pixel_diff_percent: visualReport.pixelDiffPercent,
    mismatched_pixels: visualReport.mismatchedPixels,
    total_pixels: visualReport.totalPixels,
    dimensions_match: visualReport.dimensionsMatch,
  }
  const coverage = {
    source_width: visualReport.sourceSize.width,
    source_height: visualReport.sourceSize.height,
    implementation_width: visualReport.implementationSize.width,
    implementation_height: visualReport.implementationSize.height,
    implementation_covers_source:
      visualReport.implementationSize.width >= visualReport.sourceSize.width &&
      visualReport.implementationSize.height >= visualReport.sourceSize.height,
    implementation_matches_source_size:
      visualReport.implementationSize.width === visualReport.sourceSize.width &&
      visualReport.implementationSize.height === visualReport.sourceSize.height,
  }
  const content = {
    source: await measureRegionContent(sourceCrop),
    implementation: await measureRegionContent(implementationCrop),
  }
  const visualPassed = visualReport.overallScore >= WEBPAGE_EVALUATE_PASS_SCORE
  const completed = coverage.implementation_matches_source_size && visualPassed
  const reason = coverage.implementation_matches_source_size
    ? visualPassed
      ? undefined
      : `Reference comparison visual score ${visualReport.overallScore}/100 is below required ${WEBPAGE_EVALUATE_PASS_SCORE}/100.`
    : `Implementation crop size does not match source region: source=${coverage.source_width}x${coverage.source_height} implementation=${coverage.implementation_width}x${coverage.implementation_height}.`
  return {
    region_id: input.binding.region_id,
    viewport_id: input.binding.viewport_id,
    state_id: input.binding.state_id,
    crop_intent: input.binding.crop_intent,
    status: completed ? "completed" : "failed",
    reason,
    source_bbox: input.sourceBox,
    implementation_bbox: input.implementationBox,
    source_image_size: input.sourceImageSize,
    implementation_viewport: input.implementationViewport,
    implementation_fullpage_size: input.implementationFullpageSize,
    implementation_screenshot_path: input.implementationScreenshotPath,
    route_diagnostics: input.routeDiagnostics,
    artifact_note: TRUE_SIZE_COMPARISON_ARTIFACT_NOTE,
    visual,
    coverage,
    content,
    artifacts,
    diagnostics: [
      TRUE_SIZE_COMPARISON_ARTIFACT_NOTE,
      completed
        ? `reference comparison completed for ${input.binding.region_id}: implementation crop size matches source region and visual score ${visualReport.overallScore}/100 meets ${WEBPAGE_EVALUATE_PASS_SCORE}/100`
        : `reference comparison failed for ${input.binding.region_id}: ${reason}`,
    ],
  }
}

async function measureRegionContent(filePath: string): Promise<RegionContentMetrics> {
  const png = await decodePNG(filePath)
  return {
    non_white_pixel_ratio: nonWhiteDensity(png),
    unique_color_count: uniqueColorBucketCount(png),
  }
}

async function evaluateTrueSizeRegionVisual(input: {
  sourceCrop: string
  implementationCrop: string
}): Promise<TrueSizeRegionVisualReport> {
  const [sourceSize, implementationSize] = await Promise.all([
    readPngSize(input.sourceCrop),
    readPngSize(input.implementationCrop),
  ])
  if (sourceSize.width === implementationSize.width && sourceSize.height === implementationSize.height) {
    const report = await evaluateVisual({
      originalImage: input.sourceCrop,
      renderedImage: input.implementationCrop,
    })
    return {
      overallScore: report.overallScore,
      ssimScore: report.ssimScore,
      pixelDiffPercent: report.pixelDiffPercent,
      dimensionsMatch: report.dimensionsMatch,
      mismatchedPixels: report.mismatchedPixels,
      totalPixels: report.totalPixels,
      diffImageDataUrl: report.diffImageDataUrl,
      sourceSize,
      implementationSize,
    }
  }
  const totalPixels =
    Math.max(sourceSize.width, implementationSize.width) * Math.max(sourceSize.height, implementationSize.height)
  return {
    overallScore: 0,
    ssimScore: 0,
    pixelDiffPercent: 100,
    dimensionsMatch: false,
    mismatchedPixels: totalPixels,
    totalPixels,
    sourceSize,
    implementationSize,
  }
}

async function readPngSize(inputPath: string): Promise<BrowserPreviewImageSizeValue> {
  const metadata = await sharp(inputPath).metadata()
  if (!metadata.width || !metadata.height) throw new Error(`Cannot read PNG dimensions: ${inputPath}`)
  return { width: metadata.width, height: metadata.height }
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
  const titleHeight = 62
  const labelHeight = 32
  const gap = 16
  const width = leftMeta.width + rightMeta.width + gap
  const height = titleHeight + labelHeight + Math.max(leftMeta.height, rightMeta.height)
  const labels = Buffer.from(`
    <svg width="${width}" height="${titleHeight + labelHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#f6f7f9"/>
      <text x="12" y="28" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#111827">${escapeXml(input.title)}</text>
      <text x="12" y="50" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#4b5563">TRUE-SIZE: no runner-side crop scaling; dimensions are part of parity.</text>
      <text x="12" y="${titleHeight + 22}" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#374151">LEFT: Source reference (true size)</text>
      <text x="${leftMeta.width + gap + 12}" y="${titleHeight + 22}" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#374151">RIGHT: Local implementation (true size)</text>
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

function comparisonImplementationViewportByID(input: {
  selectedViewportIDs: BrowserPreviewViewportID[]
  targetViewports: BrowserPreviewViewport[]
}): Record<BrowserPreviewViewportID, BrowserPreviewImageSizeValue> {
  const out = {} as Record<BrowserPreviewViewportID, BrowserPreviewImageSizeValue>
  for (const viewportID of input.selectedViewportIDs) {
    const preset = browserPreviewViewportByID(input.targetViewports, viewportID)
    out[viewportID] = { width: preset.width, height: preset.height }
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
