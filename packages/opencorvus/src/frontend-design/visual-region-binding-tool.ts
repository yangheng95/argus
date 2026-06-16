import { tool, type ToolSet } from "ai"
import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"

import { Instance } from "@/project/instance"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { requireRuntimePackage } from "@/runtime/package-require"
import { buildMultimodalToolResult } from "@/tool/multimodal-result"

const sharp = requireRuntimePackage<typeof import("sharp")>("sharp")

export interface FrontendVisualRegionBindingToolEvent {
  name: "create_visual_region_coordinate_atlas" | "create_visual_region_binding_package"
  status: "started" | "passed" | "failed"
  details?: Record<string, unknown>
}

const RegionBoxSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

const RegionBindingSchema = z.object({
  region_id: z.string().min(1),
  source_bbox: RegionBoxSchema,
  viewport: z.string().min(1),
  region_scope: z.string().min(1),
  target_route: z.string().min(1),
  implementation_locator: z.string().min(1),
  component_files: z.array(z.string().min(1)).min(1),
})

const VisualRegionBindingInputSchema = z.object({
  sourceImagePath: z
    .string()
    .min(1)
    .describe("Full-page source reference PNG. Use a task-runtime PNG such as fd/webpage-evidence/desktop-reference-full.png."),
  manifestPath: z
    .string()
    .min(1)
    .optional()
    .describe("VisualRegionBinding manifest output path. Defaults to docs/visual-region-binding.json."),
  packageName: z
    .string()
    .min(1)
    .optional()
    .describe("Artifact package directory name under the task frontend-design runtime package."),
  regions: z.array(RegionBindingSchema).min(1),
})

const VisualRegionCoordinateAtlasInputSchema = z.object({
  sourceImagePath: z
    .string()
    .min(1)
    .describe("Full-page source reference PNG to annotate with absolute screenshot coordinates."),
  atlasName: z
    .string()
    .min(1)
    .optional()
    .describe("Artifact package directory name under the task frontend-design runtime package."),
  bandHeight: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Height of each vertical coordinate band in source pixels. Default 900."),
  gridStep: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Grid spacing in source pixels. Default 100."),
})

type VisualRegionBindingInput = z.infer<typeof VisualRegionBindingInputSchema>
type VisualRegionCoordinateAtlasInput = z.infer<typeof VisualRegionCoordinateAtlasInputSchema>
type MaterializedVisualRegionBinding = z.infer<typeof RegionBindingSchema> & {
  source_reference_artifact: string
  source_crop_filename: string
}
type SourceImageDimensions = {
  width: number
  height: number
}
type MaterializedVisualRegionAtlasImage = {
  kind: "overview" | "band"
  filename: string
  artifact: string
  absolutePath: string
  y?: number
  height?: number
}

export function createVisualRegionBindingPackageTool(input: {
  taskID?: string
  onToolEvent?: (event: FrontendVisualRegionBindingToolEvent) => void | Promise<void>
}): ToolSet {
  return {
    create_visual_region_coordinate_atlas: tool({
      description:
        "Create a screenshot coordinate atlas from a real full-page source PNG before authoring VisualRegionBinding bboxes. " +
        "Writes an overview plus vertical band images with absolute x/y grid labels, returns those PNGs as visible tool attachments, and writes an atlas manifest. " +
        "Use the attached atlas images as the visual source for bbox decisions; DOM parent boxes and guessed section containers are not authoritative region cuts.",
      inputSchema: VisualRegionCoordinateAtlasInputSchema,
      execute: async (params) => {
        await input.onToolEvent?.({
          name: "create_visual_region_coordinate_atlas",
          status: "started",
          details: { sourceImagePath: params.sourceImagePath },
        })
        try {
          const result = await materializeVisualRegionCoordinateAtlas({
            ...params,
            taskID: input.taskID,
          })
          await input.onToolEvent?.({
            name: "create_visual_region_coordinate_atlas",
            status: "passed",
            details: {
              manifestPath: result.manifestPath,
              atlasImageCount: result.atlasImages.length,
              sourceImageDimensions: result.sourceImageDimensions,
            },
          })
          const multimodal = await buildFrontendDesignImageResult({
            text: [
              "# Visual region coordinate atlas materialized",
              "",
              `- Manifest: \`${result.manifestPath}\``,
              `- Source PNG: \`${result.sourceImagePath}\``,
              `- Source dimensions: ${result.sourceImageDimensions.width}x${result.sourceImageDimensions.height}`,
              `- Band height: ${result.bandHeight}`,
              `- Grid step: ${result.gridStep}`,
              "",
              "Read the attached atlas images and author VisualRegionBinding bboxes from visible region boundaries. Do not use DOM parent containers as the source of truth for region cuts.",
              "After choosing bboxes, call `create_visual_region_binding_package`, then inspect the returned overlay/contact sheet attachments and rerun if any cut is too broad, duplicated, missing, or visually off-boundary.",
            ].join("\n"),
            images: result.atlasImages.map((artifact) => ({
              path: artifact.absolutePath,
              filename: artifact.filename,
            })),
          })
          return {
            title: "Visual region coordinate atlas materialized",
            output: multimodal.text,
            attachments: multimodal.attachments,
            metadata: result,
          }
        } catch (error) {
          await input.onToolEvent?.({
            name: "create_visual_region_coordinate_atlas",
            status: "failed",
            details: { error: error instanceof Error ? error.message : String(error) },
          })
          throw error
        }
      },
    }),
    create_visual_region_binding_package: tool({
      description:
        "Materialize a VisualRegionBinding handoff package from a real source reference PNG and source bboxes. " +
        "Writes real per-region PNG crops, a bbox overlay image, a region contact sheet, and a JSON manifest with source_reference_artifact, source_bbox, viewport, region_scope, target_route, implementation_locator, and component_files. " +
        "Use this after reading a coordinate atlas and authoring bbox JSON from visible region boundaries. Do not use SVG wrappers, screenshot-only HTML, prose-only references, fake crops, DOM parent-container guesses, or uninspected bbox guesses.",
      inputSchema: VisualRegionBindingInputSchema,
      execute: async (params) => {
        await input.onToolEvent?.({
          name: "create_visual_region_binding_package",
          status: "started",
          details: { regionCount: params.regions.length },
        })
        try {
          const result = await materializeVisualRegionBindingPackage({
            ...params,
            taskID: input.taskID,
          })
          await input.onToolEvent?.({
            name: "create_visual_region_binding_package",
            status: "passed",
            details: {
              manifestPath: result.manifestPath,
              cropCount: result.regions.length,
              cropArtifacts: result.regions.map((region) => region.source_reference_artifact),
              bboxOverlayArtifact: result.bboxOverlayArtifact,
              contactSheetArtifact: result.contactSheetArtifact,
            },
          })
          const multimodal = await buildFrontendDesignImageResult({
            text: [
              "# VisualRegionBinding package materialized",
              "",
              `- Manifest: \`${result.manifestPath}\``,
              `- Source PNG: \`${result.sourceImagePath}\``,
              `- Regions: ${result.regions.length}`,
              `- BBox overlay: \`${result.bboxOverlayArtifact}\``,
              `- Contact sheet: \`${result.contactSheetArtifact}\``,
              "",
              "The overlay and contact sheet are attached to this tool result. Inspect them before final submit; if any crop boundary is wrong, rerun this tool with corrected bboxes.",
            ].join("\n"),
            images: [
              { path: resolveProjectPath(result.bboxOverlayArtifact, "bboxOverlayArtifact") },
              { path: resolveProjectPath(result.contactSheetArtifact, "contactSheetArtifact") },
            ],
          })
          return {
            title: "VisualRegionBinding package materialized",
            output: multimodal.text,
            attachments: multimodal.attachments,
            metadata: result,
          }
        } catch (error) {
          await input.onToolEvent?.({
            name: "create_visual_region_binding_package",
            status: "failed",
            details: { error: error instanceof Error ? error.message : String(error) },
          })
          throw error
        }
      },
    }),
  }
}

export async function materializeVisualRegionCoordinateAtlas(
  input: VisualRegionCoordinateAtlasInput & { taskID?: string },
): Promise<{
  manifestPath: string
  sourceImagePath: string
  sourceImageDimensions: SourceImageDimensions
  atlasDirectory: string
  bandHeight: number
  gridStep: number
  atlasImages: MaterializedVisualRegionAtlasImage[]
}> {
  if (!input.taskID) throw new Error("create_visual_region_coordinate_atlas requires a task-scoped frontend_design taskID")

  const sourceImagePath = resolveProjectPath(input.sourceImagePath, "sourceImagePath")
  if (path.extname(sourceImagePath).toLowerCase() !== ".png") {
    throw new Error(`VisualRegionBinding source image must be a PNG: ${input.sourceImagePath}`)
  }

  const sourceMeta = await sharp(sourceImagePath).metadata()
  if (!sourceMeta.width || !sourceMeta.height) throw new Error(`Cannot read source PNG dimensions: ${sourceImagePath}`)
  if (sourceMeta.format !== "png") throw new Error(`VisualRegionBinding source image must decode as PNG: ${sourceImagePath}`)

  const bandHeight = input.bandHeight ?? 900
  const gridStep = input.gridStep ?? 100
  const runtimePaths = ProjectRuntimePaths.frontendDesignPaths(Instance.directory, input.taskID)
  const atlasName = safePathSegment(input.atlasName ?? "visual-region-coordinate-atlas")
  const atlasDirectory = path.join(runtimePaths.absoluteDir, "visual-region-atlases", atlasName)
  assertInsideProject(atlasDirectory, "atlasDirectory")
  await fs.mkdir(atlasDirectory, { recursive: true })

  const atlasImages: MaterializedVisualRegionAtlasImage[] = []
  const overviewPath = path.join(atlasDirectory, `overview__src${sourceMeta.width}x${sourceMeta.height}.png`)
  await writeCoordinateOverview({
    sourceImagePath,
    outputPath: overviewPath,
    sourceDimensions: { width: sourceMeta.width, height: sourceMeta.height },
    bandHeight,
  })
  atlasImages.push({
    kind: "overview",
    filename: path.basename(overviewPath),
    artifact: publicPath(overviewPath),
    absolutePath: overviewPath,
  })

  for (let y = 0, index = 1; y < sourceMeta.height; y += bandHeight, index += 1) {
    const height = Math.min(bandHeight, sourceMeta.height - y)
    const bandPath = path.join(
      atlasDirectory,
      `band-${String(index).padStart(2, "0")}__src${sourceMeta.width}x${sourceMeta.height}__y${y}-h${height}.png`,
    )
    await writeCoordinateBand({
      sourceImagePath,
      outputPath: bandPath,
      sourceDimensions: { width: sourceMeta.width, height: sourceMeta.height },
      y,
      height,
      gridStep,
    })
    atlasImages.push({
      kind: "band",
      filename: path.basename(bandPath),
      artifact: publicPath(bandPath),
      absolutePath: bandPath,
      y,
      height,
    })
  }

  const manifestPath = path.join(atlasDirectory, "manifest.json")
  const manifest = {
    version: 1,
    purpose: "visual-region-coordinate-atlas",
    generated_at: new Date().toISOString(),
    source_image: publicPath(sourceImagePath),
    source_image_dimensions: { width: sourceMeta.width, height: sourceMeta.height },
    band_height: bandHeight,
    grid_step: gridStep,
    atlas_directory: publicPath(atlasDirectory),
    atlas_images: atlasImages.map(({ absolutePath: _absolutePath, ...artifact }) => artifact),
  }
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8")

  return {
    manifestPath: publicPath(manifestPath),
    sourceImagePath: publicPath(sourceImagePath),
    sourceImageDimensions: { width: sourceMeta.width, height: sourceMeta.height },
    atlasDirectory: publicPath(atlasDirectory),
    bandHeight,
    gridStep,
    atlasImages,
  }
}

export async function materializeVisualRegionBindingPackage(
  input: VisualRegionBindingInput & { taskID?: string },
): Promise<{
  manifestPath: string
  sourceImagePath: string
  sourceImageDimensions: SourceImageDimensions
  cropDirectory: string
  bboxOverlayArtifact: string
  contactSheetArtifact: string
  regions: MaterializedVisualRegionBinding[]
}> {
  if (!input.taskID) throw new Error("create_visual_region_binding_package requires a task-scoped frontend_design taskID")

  const sourceImagePath = resolveProjectPath(input.sourceImagePath, "sourceImagePath")
  if (path.extname(sourceImagePath).toLowerCase() !== ".png") {
    throw new Error(`VisualRegionBinding source image must be a PNG: ${input.sourceImagePath}`)
  }

  const sourceMeta = await sharp(sourceImagePath).metadata()
  if (!sourceMeta.width || !sourceMeta.height) throw new Error(`Cannot read source PNG dimensions: ${sourceImagePath}`)
  if (sourceMeta.format !== "png") throw new Error(`VisualRegionBinding source image must decode as PNG: ${sourceImagePath}`)

  const runtimePaths = ProjectRuntimePaths.frontendDesignPaths(Instance.directory, input.taskID)
  const packageName = safePathSegment(input.packageName ?? manifestStem(input.manifestPath ?? "visual-region-binding"))
  const cropDirectory = path.join(runtimePaths.absoluteDir, "visual-region-bindings", packageName)
  assertInsideProject(cropDirectory, "cropDirectory")
  await fs.mkdir(cropDirectory, { recursive: true })

  const regions: MaterializedVisualRegionBinding[] = []
  const bindingKeys = new Set<string>()
  const cropArtifacts: Array<{ region: MaterializedVisualRegionBinding; cropPath: string }> = []
  for (const [index, region] of input.regions.entries()) {
    assertBoxInsideImage(region.source_bbox, sourceMeta.width, sourceMeta.height, region.region_id)
    const bindingKey = `${safePathSegment(region.viewport)}::${safePathSegment(region.region_id)}`
    if (bindingKeys.has(bindingKey)) {
      throw new Error(`Duplicate VisualRegionBinding region for viewport and region_id: ${bindingKey}`)
    }
    bindingKeys.add(bindingKey)
    const cropFileName = cropFileNameFor(index, region, { width: sourceMeta.width, height: sourceMeta.height })
    const cropPath = path.join(cropDirectory, cropFileName)
    await sharp(sourceImagePath)
      .extract({
        left: region.source_bbox.x,
        top: region.source_bbox.y,
        width: region.source_bbox.width,
        height: region.source_bbox.height,
      })
      .png()
      .toFile(cropPath)
    const materialized = {
      ...region,
      source_crop_filename: cropFileName,
      source_reference_artifact: publicPath(cropPath),
    }
    regions.push(materialized)
    cropArtifacts.push({ region: materialized, cropPath })
  }

  const bboxOverlayPath = path.join(cropDirectory, `bbox-overlay__src${sourceMeta.width}x${sourceMeta.height}.png`)
  await writeBBoxOverlay({
    sourceImagePath,
    outputPath: bboxOverlayPath,
    sourceDimensions: { width: sourceMeta.width, height: sourceMeta.height },
    regions,
  })
  const contactSheetPath = path.join(cropDirectory, `region-contact-sheet__src${sourceMeta.width}x${sourceMeta.height}.png`)
  await writeContactSheet({ outputPath: contactSheetPath, cropArtifacts })

  const manifestPath = resolveManifestPath(input.manifestPath)
  if (path.extname(manifestPath).toLowerCase() !== ".json") {
    throw new Error(`VisualRegionBinding manifestPath must be a JSON file: ${input.manifestPath}`)
  }
  await fs.mkdir(path.dirname(manifestPath), { recursive: true })
  const manifest = {
    version: 1,
    purpose: "visual-region-binding-package",
    generated_at: new Date().toISOString(),
    source_image: publicPath(sourceImagePath),
    source_image_dimensions: { width: sourceMeta.width, height: sourceMeta.height },
    crop_directory: publicPath(cropDirectory),
    bbox_overlay_artifact: publicPath(bboxOverlayPath),
    contact_sheet_artifact: publicPath(contactSheetPath),
    regions,
  }
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8")

  return {
    manifestPath: publicPath(manifestPath),
    sourceImagePath: publicPath(sourceImagePath),
    sourceImageDimensions: { width: sourceMeta.width, height: sourceMeta.height },
    cropDirectory: publicPath(cropDirectory),
    bboxOverlayArtifact: publicPath(bboxOverlayPath),
    contactSheetArtifact: publicPath(contactSheetPath),
    regions,
  }
}

function resolveProjectPath(input: string, label: string): string {
  const resolved = path.isAbsolute(input) ? path.resolve(input) : path.resolve(Instance.directory, input)
  assertInsideProject(resolved, label)
  return resolved
}

function resolveManifestPath(input: string | undefined): string {
  return resolveProjectPath(input ?? path.join("docs", "visual-region-binding.json"), "manifestPath")
}

function manifestStem(input: string): string {
  const basename = path.basename(input, path.extname(input))
  return basename || "visual-region-binding"
}

function assertBoxInsideImage(
  box: z.infer<typeof RegionBoxSchema>,
  imageWidth: number,
  imageHeight: number,
  regionID: string,
): void {
  if (box.x + box.width > imageWidth || box.y + box.height > imageHeight) {
    throw new Error(
      `VisualRegionBinding bbox for ${regionID} exceeds source image bounds: ` +
        `box=${box.x},${box.y},${box.width},${box.height} image=${imageWidth}x${imageHeight}`,
    )
  }
}

function safePathSegment(input: string): string {
  const value = input
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!value) throw new Error(`Invalid VisualRegionBinding path segment: ${input}`)
  return value
}

function cropFileNameFor(
  index: number,
  region: z.infer<typeof RegionBindingSchema>,
  sourceDimensions: SourceImageDimensions,
): string {
  const box = region.source_bbox
  const ordinal = String(index + 1).padStart(2, "0")
  return [
    `${ordinal}-${safePathSegment(region.region_id)}`,
    `src${sourceDimensions.width}x${sourceDimensions.height}`,
    `x${box.x}-y${box.y}-w${box.width}-h${box.height}`,
  ].join("__") + ".png"
}

async function writeBBoxOverlay(input: {
  sourceImagePath: string
  outputPath: string
  sourceDimensions: SourceImageDimensions
  regions: MaterializedVisualRegionBinding[]
}): Promise<void> {
  const overlay = `
    <svg width="${input.sourceDimensions.width}" height="${input.sourceDimensions.height}" xmlns="http://www.w3.org/2000/svg">
      ${input.regions
        .map((region, index) => {
          const box = region.source_bbox
          const color = overlayColor(index)
          const label = `${index + 1}. ${region.region_id} ${box.x},${box.y},${box.width},${box.height}`
          const labelY = Math.max(18, box.y + 18)
          return `
            <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="none" stroke="${color}" stroke-width="4"/>
            <rect x="${box.x}" y="${Math.max(0, labelY - 16)}" width="${Math.min(input.sourceDimensions.width - box.x, label.length * 7 + 14)}" height="20" fill="${color}" opacity="0.88"/>
            <text x="${box.x + 6}" y="${labelY}" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#ffffff">${escapeXml(label)}</text>
          `
        })
        .join("\n")}
    </svg>
  `
  await sharp(input.sourceImagePath)
    .composite([{ input: Buffer.from(overlay), left: 0, top: 0 }])
    .png()
    .toFile(input.outputPath)
}

async function writeCoordinateOverview(input: {
  sourceImagePath: string
  outputPath: string
  sourceDimensions: SourceImageDimensions
  bandHeight: number
}): Promise<void> {
  const outputWidth = Math.min(900, input.sourceDimensions.width)
  const scale = outputWidth / input.sourceDimensions.width
  const outputHeight = Math.max(1, Math.round(input.sourceDimensions.height * scale))
  const lines: string[] = []
  for (let y = 0, index = 1; y < input.sourceDimensions.height; y += input.bandHeight, index += 1) {
    const scaledY = Math.round(y * scale)
    const scaledHeight = Math.round(Math.min(input.bandHeight, input.sourceDimensions.height - y) * scale)
    const color = overlayColor(index - 1)
    lines.push(
      `<rect x="0" y="${scaledY}" width="${outputWidth}" height="${scaledHeight}" fill="none" stroke="${color}" stroke-width="3"/>`,
      `<rect x="0" y="${Math.max(0, scaledY)}" width="190" height="22" fill="${color}" opacity="0.9"/>`,
      `<text x="8" y="${Math.max(16, scaledY + 16)}" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#ffffff">band ${index}: y=${y}</text>`,
    )
  }
  const overlay = `<svg width="${outputWidth}" height="${outputHeight}" xmlns="http://www.w3.org/2000/svg">${lines.join("\n")}</svg>`
  await sharp(input.sourceImagePath)
    .resize({ width: outputWidth })
    .composite([{ input: Buffer.from(overlay), left: 0, top: 0 }])
    .png()
    .toFile(input.outputPath)
}

async function writeCoordinateBand(input: {
  sourceImagePath: string
  outputPath: string
  sourceDimensions: SourceImageDimensions
  y: number
  height: number
  gridStep: number
}): Promise<void> {
  const crop = await sharp(input.sourceImagePath)
    .extract({ left: 0, top: input.y, width: input.sourceDimensions.width, height: input.height })
    .png()
    .toBuffer()
  const verticalLines: string[] = []
  for (let x = 0; x <= input.sourceDimensions.width; x += input.gridStep) {
    verticalLines.push(
      `<line x1="${x}" y1="0" x2="${x}" y2="${input.height}" stroke="#111827" stroke-width="${x % 500 === 0 ? 2 : 1}" opacity="${x % 500 === 0 ? 0.35 : 0.16}"/>`,
      `<text x="${x + 4}" y="18" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="#111827">x=${x}</text>`,
    )
  }
  const horizontalLines: string[] = []
  for (let offset = 0; offset <= input.height; offset += input.gridStep) {
    const y = input.y + offset
    horizontalLines.push(
      `<line x1="0" y1="${offset}" x2="${input.sourceDimensions.width}" y2="${offset}" stroke="#dc2626" stroke-width="${y % 500 === 0 ? 2 : 1}" opacity="${y % 500 === 0 ? 0.42 : 0.18}"/>`,
      `<rect x="0" y="${Math.max(0, offset - 16)}" width="82" height="18" fill="#dc2626" opacity="0.84"/>`,
      `<text x="6" y="${Math.max(13, offset - 3)}" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="#ffffff">y=${y}</text>`,
    )
  }
  const header = `<rect x="0" y="0" width="${input.sourceDimensions.width}" height="30" fill="#ffffff" opacity="0.84"/>
    <text x="12" y="21" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="#111827">absolute screenshot coordinates: src=${input.sourceDimensions.width}x${input.sourceDimensions.height}, band y=${input.y}-${input.y + input.height}</text>`
  const overlay = `<svg width="${input.sourceDimensions.width}" height="${input.height}" xmlns="http://www.w3.org/2000/svg">${verticalLines.join("\n")}${horizontalLines.join("\n")}${header}</svg>`
  await sharp(crop).composite([{ input: Buffer.from(overlay), left: 0, top: 0 }]).png().toFile(input.outputPath)
}

async function writeContactSheet(input: {
  outputPath: string
  cropArtifacts: Array<{ region: MaterializedVisualRegionBinding; cropPath: string }>
}): Promise<void> {
  const columns = 2
  const cellWidth = 440
  const cellHeight = 330
  const labelHeight = 54
  const rows = Math.ceil(input.cropArtifacts.length / columns)
  const composites: Array<{ input: Buffer; left: number; top: number }> = []
  for (const [index, artifact] of input.cropArtifacts.entries()) {
    const column = index % columns
    const row = Math.floor(index / columns)
    const left = column * cellWidth
    const top = row * cellHeight
    const box = artifact.region.source_bbox
    const label = `${index + 1}. ${artifact.region.region_id} | ${box.width}x${box.height} @ ${box.x},${box.y}`
    const labelSvg = `<svg width="${cellWidth}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#f6f7f9"/>
      <text x="12" y="22" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#111827">${escapeXml(label)}</text>
      <text x="12" y="42" font-family="Arial, sans-serif" font-size="12" fill="#4b5563">${escapeXml(artifact.region.viewport)} | ${escapeXml(artifact.region.region_scope.slice(0, 72))}</text>
    </svg>`
    composites.push({ input: Buffer.from(labelSvg), left, top })
    const thumbnail = await sharp(artifact.cropPath)
      .resize({ width: cellWidth - 24, height: cellHeight - labelHeight - 16, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer()
    composites.push({ input: thumbnail, left: left + 12, top: top + labelHeight + 8 })
  }
  await sharp({
    create: {
      width: columns * cellWidth,
      height: Math.max(cellHeight, rows * cellHeight),
      channels: 4,
      background: "#ffffff",
    },
  })
    .composite(composites)
    .png()
    .toFile(input.outputPath)
}

function overlayColor(index: number): string {
  const colors = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#be123c", "#4f46e5"]
  return colors[index % colors.length]!
}

function escapeXml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

async function buildFrontendDesignImageResult(input: {
  text: string
  images: Array<{ path: string; filename?: string }>
}): Promise<{ text: string; attachments: Array<{ type: "file"; mime: string; url: string; filename?: string }> }> {
  const projectID = Instance.project.id
  return buildMultimodalToolResult({
    projectID,
    text: input.text,
    images: input.images.map((image) => ({ ...image, mime: "image/png" })),
  })
}

function publicPath(input: string): string {
  const relative = path.relative(Instance.directory, input)
  const value = relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : input
  return value.replaceAll("\\", "/")
}

function assertInsideProject(targetPath: string, label: string): void {
  const root = path.resolve(Instance.directory)
  const target = path.resolve(targetPath)
  const relative = path.relative(root, target)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the current project directory: ${target}`)
  }
}
