import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { BrowserNodeSidecarError, runBrowserNodeSidecar } from "@/browser/runtime/node-executor"
import { resolveBrowserNodeSidecarRuntime } from "@/browser/runtime/node-sidecar"
import { BrowserRuntime } from "@/browser/runtime"
import { Identifier } from "@/id/id"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { requireRuntimePackage } from "@/runtime/package-require"
import { findBrowserPreviewTargetByID, normalizeRuntimePathRefs } from "./persist"
import { BrowserPreviewSourceReferenceArtifactID, resolveSourceReferencePath } from "./region-comparison"
import { BrowserPreviewViewportID } from "./viewport"

const sharp = requireRuntimePackage<typeof import("sharp")>("sharp")
const SCROLL_SLICE_CAPTURE_EXTRA_TIMEOUT_MS = 45_000
const SCROLL_SLICE_ROUTE_NAVIGATION_TIMEOUT_MS = 30_000
const SCROLL_SLICE_NETWORK_IDLE_TIMEOUT_MS = 5_000
const SCROLL_SLICE_SETTLE_AFTER_SCROLL_MS = 250
const SIDE_BY_SIDE_TITLE_HEIGHT_PX = 44
const SIDE_BY_SIDE_LABEL_HEIGHT_PX = 32
const SIDE_BY_SIDE_GAP_PX = 16

const BrowserPreviewScrollSliceRoute = z
  .string()
  .min(1)
  .refine((value) => value.startsWith("/") && !value.startsWith("//"), {
    message: "route must be a target-local path beginning with a single '/'.",
  })

export const BrowserPreviewScrollSliceComparisonRequest = z
  .object({
    targetID: z.string().min(1),
    viewportID: BrowserPreviewViewportID.default("desktop"),
    sourceReferenceArtifactID: z
      .enum(BrowserPreviewSourceReferenceArtifactID.options)
      .default("web-clone-source/reference.png"),
    route: BrowserPreviewScrollSliceRoute.default("/"),
    scrollY: z.number().int().nonnegative(),
    sliceHeight: z.number().int().positive(),
  })
  .strict()
export type BrowserPreviewScrollSliceComparisonRequest = z.infer<typeof BrowserPreviewScrollSliceComparisonRequest>

export const BrowserPreviewScrollSliceComparisonResult = z
  .object({
    status: z.enum(["completed", "failed"]),
    operation: z.literal("scroll-slice-comparison"),
    manifestPath: z.string(),
    jobID: z.string(),
    taskID: z.string(),
    targetID: z.string(),
    viewportID: BrowserPreviewViewportID,
    route: z.string(),
    scrollY: z.number().int().nonnegative(),
    sliceHeight: z.number().int().positive(),
    sourceReferenceArtifactID: BrowserPreviewSourceReferenceArtifactID,
    url: z.string(),
    sourceImageSize: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
    implementation: z.object({
      url: z.string(),
      actualScrollY: z.number(),
      maxScrollY: z.number(),
      viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
      pageSize: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
      title: z.string(),
    }),
    visual: z.object({
      overall_score: z.number(),
      ssim_score: z.number(),
      pixel_diff_percent: z.number(),
      mismatched_pixels: z.number(),
      total_pixels: z.number(),
      dimensions_match: z.boolean(),
    }),
    artifacts: z.object({
      source_crop: z.string(),
      implementation_crop: z.string(),
      side_by_side: z.string(),
      diff: z.string().optional(),
    }),
    diagnostics: z.array(z.string()),
  })
  .strict()
export type BrowserPreviewScrollSliceComparisonResult = z.infer<typeof BrowserPreviewScrollSliceComparisonResult>

type CompareScrollSliceInput = BrowserPreviewScrollSliceComparisonRequest & {
  projectRoot: string
  taskID: string
  includeDiff?: boolean
  signal?: AbortSignal
}

type ScrollSliceSidecarResult =
  | {
      ok: true
      screenshotPath: string
      url: string
      actualScrollY: number
      maxScrollY: number
      viewport: { width: number; height: number }
      pageSize: { width: number; height: number }
      title: string
    }
  | { ok: false; message: string; stack?: string }

export async function compareBrowserPreviewScrollSlice(
  input: CompareScrollSliceInput,
): Promise<BrowserPreviewScrollSliceComparisonResult> {
  if (!input.taskID.trim() || !input.targetID.trim()) {
    throw new Error("Browser preview scroll-slice comparison requires taskID and targetID.")
  }
  const target = findBrowserPreviewTargetByID({ taskID: input.taskID, targetID: input.targetID })
  if (!target) {
    throw new Error(`Browser preview target not found: ${input.targetID}`)
  }

  const projectRoot = path.resolve(input.projectRoot)
  const sourceImagePath = resolveSourceReferencePath({
    projectRoot,
    taskID: input.taskID,
    referenceArtifactID: input.sourceReferenceArtifactID,
  })
  const sourceImageSize = await readPngSize(sourceImagePath)
  assertSliceWithinSource({
    sourceImagePath,
    sourceImageSize,
    scrollY: input.scrollY,
    sliceHeight: input.sliceHeight,
  })

  const jobID = Identifier.ascending("artifact")
  const outDir = ProjectRuntimePaths.browserPreviewJobRoot(projectRoot, input.taskID, jobID)
  await fs.mkdir(outDir, { recursive: true })
  const sourceCrop = path.join(outDir, "source-slice.png")
  const implementationCrop = path.join(outDir, "implementation-slice.png")
  const sideBySide = path.join(outDir, "side-by-side.png")
  await sharp(sourceImagePath)
    .extract({ left: 0, top: input.scrollY, width: sourceImageSize.width, height: input.sliceHeight })
    .png()
    .toFile(sourceCrop)

  const implementation = await captureImplementationSlice({
    targetUrl: target.url,
    route: input.route,
    outDir,
    screenshotPath: implementationCrop,
    viewport: { width: sourceImageSize.width, height: input.sliceHeight },
    scrollY: input.scrollY,
    signal: input.signal,
  })
  if (implementation.viewport.width !== sourceImageSize.width || implementation.viewport.height !== input.sliceHeight) {
    throw new Error(
      `Implementation viewport mismatch: expected ${sourceImageSize.width}x${input.sliceHeight}, got ` +
        `${implementation.viewport.width}x${implementation.viewport.height}.`,
    )
  }

  await makeScrollSliceSideBySide({
    leftPath: sourceCrop,
    rightPath: implementationCrop,
    outputPath: sideBySide,
    title: `${input.viewportID} scrollY=${input.scrollY} height=${input.sliceHeight}`,
  })
  const visual = await evaluateSliceVisual(sourceCrop, implementationCrop)
  const artifacts: BrowserPreviewScrollSliceComparisonResult["artifacts"] = {
    source_crop: sourceCrop,
    implementation_crop: implementationCrop,
    side_by_side: sideBySide,
  }
  if (input.includeDiff === true) {
    const diff = path.join(outDir, "diff.png")
    await writeDataUrlPng(visual.diffImageDataUrl, diff)
    artifacts.diff = diff
  }

  const result: BrowserPreviewScrollSliceComparisonResult = {
    status: "completed",
    operation: "scroll-slice-comparison",
    manifestPath: path.join(outDir, "manifest.json"),
    jobID,
    taskID: input.taskID,
    targetID: input.targetID,
    viewportID: input.viewportID,
    route: input.route,
    scrollY: input.scrollY,
    sliceHeight: input.sliceHeight,
    sourceReferenceArtifactID: input.sourceReferenceArtifactID,
    url: target.url,
    sourceImageSize,
    implementation,
    visual: {
      overall_score: visual.overallScore,
      ssim_score: visual.ssimScore,
      pixel_diff_percent: visual.pixelDiffPercent,
      mismatched_pixels: visual.mismatchedPixels,
      total_pixels: visual.totalPixels,
      dimensions_match: visual.dimensionsMatch,
    },
    artifacts,
    diagnostics: [
      "Scroll-slice comparison is supporting Visual QA evidence only.",
      "It is not browser_preview_compare_regions reference-comparison proof.",
    ],
  }
  const publicResult = normalizeRuntimePathRefs(projectRoot, result) as BrowserPreviewScrollSliceComparisonResult
  await fs.writeFile(result.manifestPath, JSON.stringify(publicResult, null, 2), "utf8")
  return publicResult
}

async function captureImplementationSlice(input: {
  targetUrl: string
  route: string
  outDir: string
  screenshotPath: string
  viewport: { width: number; height: number }
  scrollY: number
  signal?: AbortSignal
}): Promise<BrowserPreviewScrollSliceComparisonResult["implementation"]> {
  const executablePath = await BrowserRuntime.findBrowserExecutable()
  const launchTimeoutMs = BrowserRuntime.resolveBrowserLaunchTimeoutMs(undefined)
  const runtime = await resolveBrowserNodeSidecarRuntime()
  const sidecar = await runBrowserNodeSidecar<ScrollSliceSidecarResult>({
    runtime,
    script: BROWSER_PREVIEW_SCROLL_SLICE_SCRIPT,
    payload: {
      targetUrl: input.targetUrl,
      route: input.route,
      outDir: input.outDir,
      screenshotPath: input.screenshotPath,
      viewport: input.viewport,
      scrollY: input.scrollY,
      executablePath,
      launchArgs: BrowserRuntime.defaultLaunchArgs(),
      launchTimeoutMs,
    },
    payloadEnvName: "OPENCORVUS_BROWSER_PREVIEW_SCROLL_SLICE_INPUT",
    hardTimeoutMs: launchTimeoutMs + SCROLL_SLICE_CAPTURE_EXTRA_TIMEOUT_MS,
    label: "Browser preview scroll-slice comparison runner",
    signal: input.signal,
  }).catch((error) => {
    if (error instanceof BrowserNodeSidecarError) throw error
    throw new Error(error instanceof Error ? error.message : String(error), { cause: error })
  })
  if (!sidecar.result.ok) {
    throw new Error(
      `Browser preview scroll-slice comparison runner failed: ${sidecar.result.message}${
        sidecar.result.stack ? `\n${sidecar.result.stack}` : ""
      }`,
    )
  }
  if (sidecar.exitCode !== 0) {
    throw new Error(
      `Browser preview scroll-slice comparison runner exited with ${sidecar.signal ?? sidecar.exitCode}. ${sidecar.stderr.trim()}`,
    )
  }
  return {
    url: sidecar.result.url,
    actualScrollY: sidecar.result.actualScrollY,
    maxScrollY: sidecar.result.maxScrollY,
    viewport: sidecar.result.viewport,
    pageSize: sidecar.result.pageSize,
    title: sidecar.result.title,
  }
}

async function readPngSize(inputPath: string): Promise<{ width: number; height: number }> {
  const metadata = await sharp(inputPath).metadata()
  if (!metadata.width || !metadata.height) throw new Error(`Cannot read PNG dimensions: ${inputPath}`)
  return { width: metadata.width, height: metadata.height }
}

function assertSliceWithinSource(input: {
  sourceImagePath: string
  sourceImageSize: { width: number; height: number }
  scrollY: number
  sliceHeight: number
}): void {
  if (input.scrollY + input.sliceHeight > input.sourceImageSize.height) {
    throw new Error(
      `Requested scroll slice exceeds reference image bounds: scrollY=${input.scrollY} ` +
        `sliceHeight=${input.sliceHeight} image=${input.sourceImageSize.width}x${input.sourceImageSize.height} ` +
        `path=${input.sourceImagePath}`,
    )
  }
}

async function evaluateSliceVisual(originalImage: string, renderedImage: string) {
  const { evaluateVisual } = await import("@/verification/visual/evaluate")
  return evaluateVisual({ originalImage, renderedImage })
}

async function makeScrollSliceSideBySide(input: {
  leftPath: string
  rightPath: string
  outputPath: string
  title: string
}): Promise<void> {
  const [leftMeta, rightMeta] = await Promise.all([sharp(input.leftPath).metadata(), sharp(input.rightPath).metadata()])
  if (!leftMeta.width || !leftMeta.height || !rightMeta.width || !rightMeta.height) {
    throw new Error("Cannot compose scroll-slice comparison without image dimensions.")
  }
  const titleHeight = SIDE_BY_SIDE_TITLE_HEIGHT_PX
  const labelHeight = SIDE_BY_SIDE_LABEL_HEIGHT_PX
  const gap = SIDE_BY_SIDE_GAP_PX
  const width = leftMeta.width + rightMeta.width + gap
  const height = titleHeight + labelHeight + Math.max(leftMeta.height, rightMeta.height)
  const labels = Buffer.from(`
    <svg width="${width}" height="${titleHeight + labelHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#f6f7f9"/>
      <text x="12" y="28" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#111827">${escapeXml(input.title)}</text>
      <text x="12" y="${titleHeight + 22}" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#374151">Source reference slice</text>
      <text x="${leftMeta.width + gap + 12}" y="${titleHeight + 22}" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#374151">Implementation slice</text>
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
    throw new Error("Scroll-slice visual diff must be a PNG data URL.")
  }
  await fs.writeFile(outputPath, Buffer.from(input.slice(prefix.length), "base64"))
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

const BROWSER_PREVIEW_SCROLL_SLICE_SCRIPT = `
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");

const input = JSON.parse(Buffer.from(process.env.OPENCORVUS_BROWSER_PREVIEW_SCROLL_SLICE_INPUT || "", "base64").toString("utf8"));

(async () => {
  let browser;
  try {
    await fs.mkdir(input.outDir, { recursive: true });
    browser = await chromium.launch({
      executablePath: input.executablePath,
      args: input.launchArgs || [],
      timeout: input.launchTimeoutMs,
    });
    const page = await browser.newPage({
      viewport: { width: input.viewport.width, height: input.viewport.height },
      deviceScaleFactor: 1,
    });
    const routeUrl = new URL(input.route || "/", input.targetUrl).toString();
    const response = await page.goto(routeUrl, { waitUntil: "domcontentloaded", timeout: ${SCROLL_SLICE_ROUTE_NAVIGATION_TIMEOUT_MS} });
    await page.waitForLoadState("networkidle", { timeout: ${SCROLL_SLICE_NETWORK_IDLE_TIMEOUT_MS} }).catch(() => undefined);
    const status = response ? response.status() : undefined;
    if (typeof status === "number" && status >= 400) {
      throw new Error("Implementation route returned HTTP " + status + ": " + routeUrl);
    }
    const metricsBeforeScroll = await page.evaluate(() => ({
      scrollHeight: Math.ceil(document.documentElement.scrollHeight || document.body.scrollHeight || 0),
      clientHeight: Math.ceil(document.documentElement.clientHeight || window.innerHeight || 0),
    }));
    const maxScrollY = Math.max(0, metricsBeforeScroll.scrollHeight - metricsBeforeScroll.clientHeight);
    if (input.scrollY > maxScrollY) {
      throw new Error(
        "Requested scrollY exceeds implementation scroll range: scrollY=" +
          input.scrollY +
          " maxScrollY=" +
          maxScrollY +
          " url=" +
          routeUrl
      );
    }
    await page.evaluate((scrollY) => window.scrollTo(0, scrollY), input.scrollY);
    await page.waitForTimeout(${SCROLL_SLICE_SETTLE_AFTER_SCROLL_MS});
    const capture = await page.evaluate(() => ({
      actualScrollY: Math.round(window.scrollY),
      scrollHeight: Math.ceil(document.documentElement.scrollHeight || document.body.scrollHeight || 0),
      clientHeight: Math.ceil(document.documentElement.clientHeight || window.innerHeight || 0),
      pageWidth: Math.ceil(document.documentElement.scrollWidth || document.body.scrollWidth || window.innerWidth || 0),
      pageHeight: Math.ceil(document.documentElement.scrollHeight || document.body.scrollHeight || window.innerHeight || 0),
      title: document.title || "",
    }));
    if (capture.actualScrollY !== input.scrollY) {
      throw new Error(
        "Implementation did not reach requested scrollY: requested=" +
          input.scrollY +
          " actual=" +
          capture.actualScrollY +
          " url=" +
          routeUrl
      );
    }
    await page.screenshot({ path: input.screenshotPath, type: "png", fullPage: false });
    const result = {
      ok: true,
      screenshotPath: input.screenshotPath,
      url: routeUrl,
      actualScrollY: capture.actualScrollY,
      maxScrollY,
      viewport: { width: input.viewport.width, height: input.viewport.height },
      pageSize: { width: capture.pageWidth, height: capture.pageHeight },
      title: capture.title,
    };
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        message: error && error.message ? error.message : String(error),
        stack: error && error.stack ? error.stack : undefined,
      })
    );
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
})();
`
