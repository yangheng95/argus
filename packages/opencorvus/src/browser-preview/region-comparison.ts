import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import z from "zod"
import { BrowserNodeSidecarError, runBrowserNodeSidecar } from "@/browser/runtime/node-executor"
import { resolveBrowserNodeSidecarRuntime } from "@/browser/runtime/node-sidecar"
import { BrowserRuntime } from "@/browser/runtime"
import { Identifier } from "@/id/id"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { browserPreviewViewportByID, BrowserPreviewViewportID } from "./viewport"
import { normalizeRuntimePathRefs, persistBrowserPreviewEvidence } from "./persist"

const SOURCE_REFERENCE_FILES = new Set(["reference.png", "reference-mobile.png"])

export const BrowserPreviewRegionBox = z.object({
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
})
export type BrowserPreviewRegionBox = z.infer<typeof BrowserPreviewRegionBox>

export const BrowserPreviewRegionLocator = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("test-id"), value: z.string().min(1) }),
  z.object({ kind: z.literal("data-oc-region"), value: z.string().min(1) }),
  z.object({ kind: z.literal("role"), role: z.string().min(1), name: z.string().min(1) }),
  z.object({ kind: z.literal("selector"), value: z.string().min(1), owner_file: z.string().min(1) }),
])
export type BrowserPreviewRegionLocator = z.infer<typeof BrowserPreviewRegionLocator>

export const BrowserPreviewRegionBinding = z.object({
  region_id: z.string().min(1),
  viewport_id: BrowserPreviewViewportID,
  state_id: z.string().min(1).default("default"),
  region_scope: z.enum(["page-section", "card", "content", "title", "chart", "table", "control", "navigation"]),
  source: z.object({
    reference_artifact_id: z.string().min(1),
    bbox: BrowserPreviewRegionBox,
    semantic_role: z.string().min(1),
    text_anchors: z.array(z.string().min(1)).default([]),
    source_refs: z.array(z.string().min(1)).default([]),
  }),
  implementation: z.object({
    route: z.string().min(1).default("/"),
    locator: BrowserPreviewRegionLocator,
    component_files: z.array(z.string().min(1)).default([]),
  }),
  acceptance_refs: z.array(z.string().min(1)).default([]),
})
export type BrowserPreviewRegionBinding = z.infer<typeof BrowserPreviewRegionBinding>

export const BrowserPreviewRegionComparisonRequest = z.object({
  targetID: z.string().min(1),
  viewportIDs: BrowserPreviewViewportID.array().min(1),
  inlineBindings: BrowserPreviewRegionBinding.array().min(1),
  output: z
    .object({
      include_fullpage_overview: z.boolean().default(false),
      include_side_by_side: z.boolean().default(true),
      include_diff: z.boolean().default(false),
    })
    .default({
      include_fullpage_overview: false,
      include_side_by_side: true,
      include_diff: false,
    }),
})
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
      status: z.enum(["completed", "failed"]),
      reason: z.string().optional(),
      source_bbox: BrowserPreviewRegionBox.optional(),
      implementation_bbox: BrowserPreviewRegionBox.optional(),
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
  url: string
  bindings: BrowserPreviewRegionBinding[]
  viewportIDs: BrowserPreviewViewportID[]
  includeFullpageOverview?: boolean
  includeSideBySide?: boolean
  includeDiff?: boolean
  signal?: AbortSignal
}

type SidecarLocator = BrowserPreviewRegionLocator
type SidecarBinding = {
  regionID: string
  viewportID: BrowserPreviewViewportID
  route: string
  locator: SidecarLocator
}
type SidecarResult = {
  ok: true
  fullpagePath?: string
  regions: Array<{
    regionID: string
    viewportID: BrowserPreviewViewportID
    status: "completed" | "failed"
    bbox?: BrowserPreviewRegionBox
    screenshotPath?: string
    reason?: string
  }>
} | { ok: false; message: string; stack?: string }

export async function compareBrowserPreviewRegions(
  input: BrowserPreviewRegionComparisonInput,
): Promise<BrowserPreviewRegionComparisonResult> {
  if (!input.taskID.trim() || !input.targetID.trim()) {
    throw new Error("Browser preview region comparison requires taskID and targetID.")
  }
  const jobID = Identifier.ascending("artifact")
  const outDir = ProjectRuntimePaths.browserPreviewJobRoot(input.projectRoot, input.taskID, jobID)
  await fs.mkdir(outDir, { recursive: true })

  const selectedViewportIDs = dedupeViewportIDs(input.viewportIDs)
  const selectedBindings = input.bindings.filter((binding) => selectedViewportIDs.includes(binding.viewport_id))
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
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
        source_bbox: binding.source.bbox,
        diagnostics: [error instanceof Error ? error.message : String(error)],
      })
    }
  }

  const runnableBindings = selectedBindings.filter((binding) => sourceRefs.has(bindingKey(binding)))
  const sidecar = runnableBindings.length
    ? await runImplementationCapture({
        url: input.url,
        outDir,
        viewportIDs: selectedViewportIDs,
        bindings: runnableBindings,
        includeFullpageOverview: input.includeFullpageOverview === true,
        signal: input.signal,
      })
    : undefined

  const regions: BrowserPreviewRegionComparisonResult["regions"] = [...initialRegions]
  if (sidecar) {
    for (const region of sidecar.regions) {
      const binding = runnableBindings.find(
        (item) => item.region_id === region.regionID && item.viewport_id === region.viewportID,
      )
      if (!binding) continue
      const source = sourceRefs.get(bindingKey(binding))
      if (!source) continue
      if (region.status !== "completed" || !region.bbox || !region.screenshotPath) {
        regions.push({
          region_id: binding.region_id,
          viewport_id: binding.viewport_id,
          status: "failed",
          reason: region.reason ?? "Implementation region was not found.",
          source_bbox: binding.source.bbox,
          diagnostics: [region.reason ?? "Implementation region was not found."],
        })
        continue
      }
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
      manifestPath,
      artifactPaths: region.artifacts,
      status: region.status === "completed" ? "passed" : "failed",
      summary:
        region.status === "completed"
          ? `reference comparison completed for ${region.region_id} (${region.viewport_id})`
          : `reference comparison failed for ${region.region_id} (${region.viewport_id}): ${region.reason}`,
      capture: {
        operation: "reference-comparison",
        manifest_path: manifestPath,
        region,
      },
      diagnostics: region.diagnostics,
    })
    evidenceIDs[`${region.viewport_id}:${region.region_id}`] = evidenceID
  }
  const result: BrowserPreviewRegionComparisonResult = {
    status: regions.length > 0 && regions.every((region) => region.status === "completed") ? "passed" : "failed",
    manifestPath,
    jobID,
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

async function runImplementationCapture(input: {
  url: string
  outDir: string
  viewportIDs: BrowserPreviewViewportID[]
  bindings: BrowserPreviewRegionBinding[]
  includeFullpageOverview: boolean
  signal?: AbortSignal
}): Promise<Extract<SidecarResult, { ok: true }>> {
  const executablePath = await BrowserRuntime.findBrowserExecutable()
  const launchTimeoutMs = BrowserRuntime.resolveBrowserLaunchTimeoutMs(undefined)
  const runtime = await resolveBrowserNodeSidecarRuntime()
  const sidecarBindings: SidecarBinding[] = input.bindings.map((binding) => ({
    regionID: binding.region_id,
    viewportID: binding.viewport_id,
    route: binding.implementation.route,
    locator: binding.implementation.locator,
  }))
  const sidecar = await runBrowserNodeSidecar<SidecarResult>({
    runtime,
    script: REGION_COMPARISON_SCRIPT,
    payload: {
      url: input.url,
      outDir: input.outDir,
      executablePath,
      launchArgs: BrowserRuntime.defaultLaunchArgs(),
      launchTimeoutMs,
      viewportIDs: input.viewportIDs,
      viewportByID: Object.fromEntries(
        input.viewportIDs.map((id) => {
          const viewport = browserPreviewViewportByID(id)
          return [id, { width: viewport.width, height: viewport.height }]
        }),
      ),
      bindings: sidecarBindings,
      includeFullpageOverview: input.includeFullpageOverview,
    },
    payloadEnvName: "OPENCORVUS_BROWSER_PREVIEW_REGION_COMPARISON_INPUT",
    hardTimeoutMs: launchTimeoutMs + input.bindings.length * 15_000 + 30_000,
    label: "Browser preview region comparison runner",
    signal: input.signal,
  }).catch((error) => {
    if (error instanceof BrowserNodeSidecarError) throw error
    throw new Error(error instanceof Error ? error.message : String(error), { cause: error })
  })
  if (!sidecar.result.ok) {
    throw new Error(
      `Browser preview region comparison runner failed: ${sidecar.result.message}${sidecar.result.stack ? `\n${sidecar.result.stack}` : ""}`,
    )
  }
  if (sidecar.exitCode !== 0) {
    throw new Error(
      `Browser preview region comparison runner exited with ${sidecar.signal ?? sidecar.exitCode}. ${sidecar.stderr.trim()}`,
    )
  }
  return sidecar.result
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
  const dir = path.join(input.outDir, "regions", input.binding.viewport_id, regionDirectoryKey(input.binding))
  await fs.mkdir(dir, { recursive: true })
  const sourceCrop = path.join(dir, "source.png")
  const implementationCrop = path.join(dir, "implementation.png")
  await cropPng(input.sourceImagePath, sourceCrop, input.sourceBox)
  await cropPng(input.implementationImagePath, implementationCrop, input.implementationBox)
  const sideBySide = path.join(dir, "side-by-side.png")
  await makeSideBySide({
    leftPath: sourceCrop,
    rightPath: implementationCrop,
    outputPath: sideBySide,
    title: `${input.binding.region_id} (${input.binding.viewport_id})`,
  })
  const artifacts: NonNullable<BrowserPreviewRegionComparisonResult["regions"][number]["artifacts"]> = {
    source_crop: sourceCrop,
    implementation_crop: implementationCrop,
    side_by_side: sideBySide,
  }
  if (input.includeDiff) {
    const diff = path.join(dir, "diff.png")
    await makeDiff({ sourcePath: sourceCrop, implementationPath: implementationCrop, outputPath: diff })
    artifacts.diff = diff
  }
  return {
    region_id: input.binding.region_id,
    viewport_id: input.binding.viewport_id,
    status: "completed",
    source_bbox: input.sourceBox,
    implementation_bbox: input.implementationBox,
    artifacts,
    diagnostics: [`reference comparison completed for ${input.binding.region_id}`],
  }
}

async function cropPng(inputPath: string, outputPath: string, box: BrowserPreviewRegionBox): Promise<void> {
  const metadata = await sharp(inputPath).metadata()
  if (!metadata.width || !metadata.height) throw new Error(`Cannot read PNG dimensions: ${inputPath}`)
  const left = clamp(Math.floor(box.x), 0, metadata.width - 1)
  const top = clamp(Math.floor(box.y), 0, metadata.height - 1)
  const width = clamp(Math.ceil(box.width), 1, metadata.width - left)
  const height = clamp(Math.ceil(box.height), 1, metadata.height - top)
  await sharp(inputPath).extract({ left, top, width, height }).png().toFile(outputPath)
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

async function makeDiff(input: { sourcePath: string; implementationPath: string; outputPath: string }): Promise<void> {
  const sourceMeta = await sharp(input.sourcePath).metadata()
  if (!sourceMeta.width || !sourceMeta.height) throw new Error("Cannot diff without source dimensions.")
  const implementation = await sharp(input.implementationPath)
    .resize(sourceMeta.width, sourceMeta.height, { fit: "fill" })
    .png()
    .toBuffer()
  await sharp(input.sourcePath)
    .composite([{ input: implementation, blend: "difference" }])
    .png()
    .toFile(input.outputPath)
}

function bindingKey(binding: BrowserPreviewRegionBinding): string {
  return `${binding.viewport_id}:${binding.region_id}`
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
  return Identifier.scopedDirectoryKey("browser-preview-region", `${binding.viewport_id}:${binding.region_id}`)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => {
    const entities: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }
    return entities[char] ?? char
  })
}

const REGION_COMPARISON_SCRIPT = String.raw`
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(process.env.OPENCORVUS_PLAYWRIGHT_REQUIRE_PATH || "playwright");

function routeUrl(base, route) {
  return new URL(route || "/", base).toString();
}

async function locate(page, locator) {
  if (locator.kind === "role") {
    const box = await page.getByRole(locator.role, { name: locator.name }).first().boundingBox().catch(() => null);
    return box ? toBox(box) : null;
  }
  const selector = selectorFor(locator);
  return page.evaluate((input) => {
    const node = document.querySelector(input.selector);
    if (!node) return null;
    return toBox(node.getBoundingClientRect());
    function toBox(rect) {
      return {
        x: Math.max(0, Math.round(rect.x)),
        y: Math.max(0, Math.round(rect.y)),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      };
    }
  }, { selector });
}

function selectorFor(locator) {
  if (locator.kind === "selector") return locator.value;
  if (locator.kind === "test-id") return "[data-testid=" + JSON.stringify(locator.value) + "]";
  if (locator.kind === "data-oc-region") return "[data-oc-region=" + JSON.stringify(locator.value) + "]";
  throw new Error("Unsupported locator kind: " + locator.kind);
}

function toBox(rect) {
  return {
    x: Math.max(0, Math.round(rect.x)),
    y: Math.max(0, Math.round(rect.y)),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

async function main() {
  const input = JSON.parse(Buffer.from(process.env.OPENCORVUS_BROWSER_PREVIEW_REGION_COMPARISON_INPUT || "", "base64").toString("utf8"));
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: input.executablePath,
      headless: true,
      timeout: input.launchTimeoutMs,
      args: input.launchArgs,
    });
    const regions = [];
    for (const viewportID of input.viewportIDs) {
      const viewport = input.viewportByID[viewportID];
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
      try {
        const page = await context.newPage();
        const firstRoute = input.bindings.find((binding) => binding.viewportID === viewportID)?.route || "/";
        await page.goto(routeUrl(input.url, firstRoute), { waitUntil: "networkidle", timeout: 30000 });
        const viewportDir = path.join(input.outDir, "implementation", viewportID);
        await fs.mkdir(viewportDir, { recursive: true });
        const screenshotPath = path.join(viewportDir, "full.png");
        await page.screenshot({ path: screenshotPath, type: "png", fullPage: false });
        for (const binding of input.bindings.filter((item) => item.viewportID === viewportID)) {
          if (binding.route !== firstRoute) {
            await page.goto(routeUrl(input.url, binding.route), { waitUntil: "networkidle", timeout: 30000 });
          }
          const regionScreenshotPath = path.join(viewportDir, sanitizeSegment(binding.regionID) + ".png");
          await page.screenshot({ path: regionScreenshotPath, type: "png", fullPage: false });
          const bbox = await locate(page, binding.locator);
          if (!bbox) {
            regions.push({
              regionID: binding.regionID,
              viewportID,
              status: "failed",
              reason: "Implementation locator did not match any visible element.",
            });
            continue;
          }
          regions.push({
            regionID: binding.regionID,
            viewportID,
            status: "completed",
            bbox,
            screenshotPath: regionScreenshotPath,
          });
        }
      } finally {
        await context.close().catch(() => {});
      }
    }
    process.stdout.write(JSON.stringify({ ok: true, regions }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, message: error?.message || String(error), stack: error?.stack }));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

function sanitizeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 96) || "region";
}

main();
`
