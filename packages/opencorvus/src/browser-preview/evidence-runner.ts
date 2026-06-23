import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { PNG } from "pngjs"
import { BrowserNodeSidecarError, runBrowserNodeSidecar } from "@/browser/runtime/node-executor"
import { resolveBrowserNodeSidecarRuntime } from "@/browser/runtime/node-sidecar"
import { BrowserRuntime } from "@/browser/runtime"
import {
  normalizeRuntimeCaptureViewport,
  RUNTIME_CAPTURE_DEFAULTS,
  runtimeCaptureFailureSummary,
  runtimeCaptureFailedLayers,
  type RuntimeCaptureFailure,
  type RuntimeCaptureResult,
  type RuntimeCaptureSuccess,
} from "@/runtime/capture-contract"
import { pngLuminanceVariance } from "@/runtime/png-metrics"
import { Identifier } from "@/id/id"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { findBrowserPreviewTargetByID } from "./persist"
import type { BrowserPreviewRegionBinding, BrowserPreviewRegionBox } from "./region-comparison"
import { browserPreviewViewportByID, type BrowserPreviewViewportID } from "./viewport"

export type BrowserEvidenceManifestSummary = {
  manifestPath: string
  jobID: string
  taskID: string
  targetID: string
  operations: Array<{
    kind: "preview-capture"
    status: "completed" | "failed"
    viewportIDs: BrowserPreviewViewportID[]
    artifactPaths: string[]
    diagnosticsPath: string
  }>
}

export type BrowserPreviewEvidenceRunnerResult = {
  manifest: BrowserEvidenceManifestSummary
  captures: Record<string, RuntimeCaptureResult>
}

type BrowserPreviewEvidenceRunnerInput = {
  projectRoot: string
  jobID: string
  taskID: string
  targetID: string
  outDir: string
  viewportIDs: BrowserPreviewViewportID[]
  signal?: AbortSignal
}

type BrowserPreviewRegionComparisonRunnerInput = {
  projectRoot: string
  taskID: string
  targetID: string
  viewportIDs: BrowserPreviewViewportID[]
  viewportByID?: Partial<Record<BrowserPreviewViewportID, { width: number; height: number }>>
  bindings: BrowserPreviewRegionBinding[]
  includeFullpageOverview: boolean
  signal?: AbortSignal
}

export type BrowserPreviewRegionComparisonCaptureResult = {
  jobID: string
  outDir: string
  fullpagePath?: string
  regions: Array<{
    regionID: string
    stateID: string
    viewportID: BrowserPreviewViewportID
    status: "completed" | "failed"
    bbox?: BrowserPreviewRegionBox
    screenshotPath?: string
    viewport?: { width: number; height: number }
    fullpageSize?: { width: number; height: number }
    routeDiagnostics?: BrowserPreviewRegionRouteDiagnostics
    reason?: string
  }>
}

export type BrowserPreviewRegionRouteDiagnostics = {
  route: string
  url?: string
  status?: number
  content_type?: string
  body_length?: number
  title?: string
  dom?: {
    text_length: number
    node_count: number
    body_descendant_count: number
  }
  page_size?: { width: number; height: number }
  failed_requests: Array<{ url: string; status: number; reason: string }>
  console_errors: string[]
  page_errors: string[]
  valid_app_page: boolean
  reason?: string
  screenshot_path?: string
}

type SidecarViewportInput = {
  id: BrowserPreviewViewportID
  width: number
  height: number
  screenshotPath: string
}

export type SidecarCaptureResult = {
  id: BrowserPreviewViewportID
  captured: boolean
  passed: boolean
  target_url?: string
  requested_viewport: { width: number; height: number }
  viewport: { width: number; height: number; capped: boolean }
  size?: { width: number; height: number }
  path?: string
  layers?: RuntimeCaptureSuccess["layers"]
  dom?: RuntimeCaptureSuccess["dom"]
  capture_error?: RuntimeCaptureFailure["capture_error"]
  summary: string
}

export type BrowserPreviewFinalizedSidecarCapture = {
  capture: RuntimeCaptureResult
  artifactPath?: string
  diagnostic: string
}

type BrowserPreviewRegionSidecarBinding = {
  regionID: string
  stateID: string
  viewportID: BrowserPreviewViewportID
  route: string
  locator: BrowserPreviewRegionBinding["implementation"]["locator"]
}

type BrowserPreviewRegionSidecarResult =
  | {
      ok: true
      fullpagePath?: string
      regions: BrowserPreviewRegionComparisonCaptureResult["regions"]
    }
  | { ok: false; message: string; stack?: string }

export class BrowserPreviewEvidenceTargetNotFoundError extends Error {
  constructor(readonly targetID: string) {
    super(`Browser preview target not found: ${targetID}`)
    this.name = "BrowserPreviewEvidenceTargetNotFoundError"
  }
}

export async function runBrowserPreviewEvidenceJob(
  input: BrowserPreviewEvidenceRunnerInput,
): Promise<BrowserPreviewEvidenceRunnerResult> {
  requireBrowserEvidenceIdentity(input)
  const target = findBrowserPreviewTargetByID({ taskID: input.taskID, targetID: input.targetID })
  if (!target) {
    throw new BrowserPreviewEvidenceTargetNotFoundError(input.targetID)
  }
  const projectRoot = path.resolve(input.projectRoot)
  const outDir = requireBrowserPreviewJobRoot({
    projectRoot,
    taskID: input.taskID,
    targetID: input.targetID,
    jobID: input.jobID,
    outDir: input.outDir,
  })
  const executablePath = await BrowserRuntime.findBrowserExecutable()
  const launchTimeoutMs = BrowserRuntime.resolveBrowserLaunchTimeoutMs(undefined)
  const navigationTimeoutMs = RUNTIME_CAPTURE_DEFAULTS.wait_timeout_ms
  const settleMs = RUNTIME_CAPTURE_DEFAULTS.settle_ms
  const runtime = await resolveBrowserNodeSidecarRuntime()
  await fs.mkdir(outDir, { recursive: true })

  const viewports: SidecarViewportInput[] = input.viewportIDs.map((id) => {
    const preset = browserPreviewViewportByID(target.viewports, id)
    const viewport = normalizeRuntimeCaptureViewport({ width: preset.width, height: preset.height })
    return {
      id,
      width: viewport.width,
      height: viewport.height,
      screenshotPath: path.join(outDir, `${id}.png`),
    }
  })

  const sidecar = await runBrowserNodeSidecar<
    { ok: true; captures: SidecarCaptureResult[] } | { ok: false; message: string; stack?: string }
  >({
    runtime,
    script: BROWSER_PREVIEW_BATCH_SCRIPT,
    payload: {
      url: target.url,
      executablePath,
      launchArgs: BrowserRuntime.defaultLaunchArgs(),
      launchTimeoutMs,
      navigationTimeoutMs,
      settleMs,
      minDomDescendants: RUNTIME_CAPTURE_DEFAULTS.min_dom_descendants,
      viewports,
    },
    payloadEnvName: "OPENCORVUS_BROWSER_PREVIEW_EVIDENCE_INPUT",
    hardTimeoutMs: launchTimeoutMs + viewports.length * (navigationTimeoutMs + settleMs + 15_000) + 30_000,
    label: "Browser preview evidence runner",
    signal: input.signal,
  }).catch((error) => {
    if (error instanceof BrowserNodeSidecarError) throw error
    throw new Error(error instanceof Error ? error.message : String(error), { cause: error })
  })

  if (!sidecar.result.ok) {
    throw new Error(
      `Browser preview evidence runner failed: ${sidecar.result.message}${sidecar.result.stack ? `\n${sidecar.result.stack}` : ""}`,
    )
  }
  if (sidecar.exitCode !== 0) {
    throw new Error(
      `Browser preview evidence runner exited with ${sidecar.signal ?? sidecar.exitCode}. ${sidecar.stderr.trim()}`,
    )
  }

  const captures: Record<string, RuntimeCaptureResult> = {}
  const artifactPaths: string[] = []
  const diagnostics: string[] = []
  for (const capture of sidecar.result.captures) {
    const finalized = await finalizeBrowserPreviewSidecarCapture({ capture, url: target.url, outDir })
    captures[capture.id] = finalized.capture
    if (finalized.artifactPath) artifactPaths.push(finalized.artifactPath)
    diagnostics.push(finalized.diagnostic)
  }

  const manifest = await writeBrowserEvidenceManifest({
    outDir,
    jobID: input.jobID,
    taskID: input.taskID,
    targetID: input.targetID,
    url: target.url,
    viewportIDs: input.viewportIDs,
    artifactPaths,
    captures,
    diagnostics,
  })
  return { manifest, captures }
}

export async function runBrowserPreviewRegionComparisonCapture(
  input: BrowserPreviewRegionComparisonRunnerInput,
): Promise<BrowserPreviewRegionComparisonCaptureResult> {
  requireBrowserEvidenceIdentity(input)
  const target = findBrowserPreviewTargetByID({ taskID: input.taskID, targetID: input.targetID })
  if (!target) {
    throw new BrowserPreviewEvidenceTargetNotFoundError(input.targetID)
  }
  const jobID = Identifier.ascending("artifact")
  const projectRoot = path.resolve(input.projectRoot)
  const outDir = ProjectRuntimePaths.browserPreviewJobRoot(projectRoot, input.taskID, jobID)
  await fs.mkdir(outDir, { recursive: true })
  if (input.bindings.length === 0) {
    return { jobID, outDir, regions: [] }
  }

  const executablePath = await BrowserRuntime.findBrowserExecutable()
  const launchTimeoutMs = BrowserRuntime.resolveBrowserLaunchTimeoutMs(undefined)
  const runtime = await resolveBrowserNodeSidecarRuntime()
  const sidecarBindings: BrowserPreviewRegionSidecarBinding[] = input.bindings.map((binding) => ({
    regionID: binding.region_id,
    stateID: binding.state_id,
    viewportID: binding.viewport_id,
    route: binding.implementation.route,
    locator: binding.implementation.locator,
  }))
  const sidecar = await runBrowserNodeSidecar<BrowserPreviewRegionSidecarResult>({
    runtime,
    script: BROWSER_PREVIEW_REGION_COMPARISON_SCRIPT,
    payload: {
      url: target.url,
      outDir,
      executablePath,
      launchArgs: BrowserRuntime.defaultLaunchArgs(),
      launchTimeoutMs,
      settleMs: RUNTIME_CAPTURE_DEFAULTS.settle_ms,
      viewportIDs: input.viewportIDs,
      viewportByID: Object.fromEntries(
        input.viewportIDs.map((id) => {
          const viewport = input.viewportByID?.[id] ?? browserPreviewViewportByID(target.viewports, id)
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
  return { jobID, outDir, fullpagePath: sidecar.result.fullpagePath, regions: sidecar.result.regions }
}

export async function writeBrowserEvidenceManifest(input: {
  outDir: string
  jobID: string
  taskID: string
  targetID: string
  url: string
  viewportIDs: BrowserPreviewViewportID[]
  artifactPaths: string[]
  captures: Record<string, RuntimeCaptureResult>
  diagnostics: string[]
}): Promise<BrowserEvidenceManifestSummary> {
  requireBrowserEvidenceIdentity(input)
  await fs.mkdir(input.outDir, { recursive: true })
  const diagnosticsPath = path.join(input.outDir, "diagnostics.json")
  const manifest: BrowserEvidenceManifestSummary = {
    manifestPath: path.join(input.outDir, "manifest.json"),
    jobID: input.jobID,
    taskID: input.taskID,
    targetID: input.targetID,
    operations: [
      {
        kind: "preview-capture",
        status: Object.values(input.captures).every((capture) => capture.captured && capture.passed)
          ? "completed"
          : "failed",
        viewportIDs: input.viewportIDs,
        artifactPaths: input.artifactPaths,
        diagnosticsPath,
      },
    ],
  }
  await fs.writeFile(
    diagnosticsPath,
    JSON.stringify(
      {
        jobID: input.jobID,
        taskID: input.taskID,
        targetID: input.targetID,
        url: input.url,
        viewportIDs: input.viewportIDs,
        diagnostics: input.diagnostics,
      },
      null,
      2,
    ),
  )
  await fs.writeFile(
    manifest.manifestPath,
    JSON.stringify(
      {
        ...manifest,
        url: input.url,
        captures: input.captures,
        diagnostics: input.diagnostics,
      },
      null,
      2,
    ),
  )
  return manifest
}

function requireBrowserEvidenceIdentity(input: {
  projectRoot?: string
  jobID?: string
  taskID: string
  targetID: string
}): void {
  const missing = [
    "projectRoot" in input && !input.projectRoot?.trim() ? "projectRoot" : undefined,
    "jobID" in input && !input.jobID?.trim() ? "jobID" : undefined,
    input.taskID.trim() ? undefined : "taskID",
    input.targetID.trim() ? undefined : "targetID",
  ].filter((item): item is string => Boolean(item))
  if (missing.length > 0) {
    throw new Error(`Browser preview evidence runner requires non-empty ${missing.join(", ")}.`)
  }
}

function requireBrowserPreviewJobRoot(input: {
  projectRoot: string
  taskID: string
  targetID: string
  jobID: string
  outDir: string
}): string {
  requireBrowserEvidenceIdentity(input)
  const expected = path.resolve(ProjectRuntimePaths.browserPreviewJobRoot(input.projectRoot, input.taskID, input.jobID))
  const actual = path.resolve(input.outDir)
  if (actual !== expected) {
    throw new Error(`Browser preview evidence outDir must match task runtime job root: ${expected}`)
  }
  return actual
}

export async function finalizeBrowserPreviewSidecarCapture(input: {
  capture: SidecarCaptureResult
  url: string
  outDir: string
}): Promise<BrowserPreviewFinalizedSidecarCapture> {
  const { capture } = input
  if (!capture.captured || !capture.path) {
    return {
      capture: {
        captured: false,
        passed: false,
        url: input.url,
        requested_viewport: capture.requested_viewport,
        viewport: capture.viewport,
        capture_error: capture.capture_error ?? { kind: "capture_failed", message: capture.summary },
        summary: capture.summary,
      },
      diagnostic: capture.summary,
    }
  }
  if (!capture.layers || !capture.dom) {
    const missing = [!capture.layers ? "layers" : undefined, !capture.dom ? "dom" : undefined].filter(
      (item): item is string => !!item,
    )
    const summary = `browser preview capture failed: sidecar did not return structured ${missing.join(" and ")} evidence`
    return {
      capture: {
        captured: false,
        passed: false,
        url: input.url,
        requested_viewport: capture.requested_viewport,
        viewport: capture.viewport,
        capture_error: { kind: "capture_failed", message: summary },
        summary,
      },
      diagnostic: summary,
    }
  }
  const bytes = await fs.readFile(capture.path)
  const sha = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16)
  const finalPath = path.join(input.outDir, `${capture.id}-${sha}.png`)
  if (finalPath !== capture.path) {
    await fs.rename(capture.path, finalPath).catch(async () => {
      await fs.copyFile(capture.path!, finalPath)
    })
  }
  const png = PNG.sync.read(bytes)
  const variance = pngLuminanceVariance(png)
  capture.layers.pixel = {
    passed: variance >= 25,
    variance: Number(variance.toFixed(2)),
    floor: 25,
    screenshot_path: finalPath,
  }
  const failedLayers = runtimeCaptureFailedLayers(capture.layers)
  const passed = failedLayers.length === 0
  const summary = passed
    ? `all runtime capture layers passed on ${input.url}`
    : runtimeCaptureFailureSummary(capture.layers)
  return {
    capture: {
      captured: true,
      passed,
      url: input.url,
      target_url: capture.target_url ?? input.url,
      path: finalPath,
      sha,
      bytes: bytes.length,
      size: { width: png.width, height: png.height },
      requested_viewport: capture.requested_viewport,
      viewport: capture.viewport,
      layers: capture.layers,
      dom: capture.dom,
      summary,
    },
    artifactPath: finalPath,
    diagnostic: summary,
  }
}

const BROWSER_PREVIEW_BATCH_SCRIPT = String.raw`
const { chromium } = require(process.env.OPENCORVUS_PLAYWRIGHT_REQUIRE_PATH || "playwright");

function isBrowserImplicitAssetRequest(rawUrl) {
  try {
    return new URL(rawUrl).pathname === "/favicon.ico";
  } catch {
    return false;
  }
}

function isResourceLoadConsoleError(text) {
  return String(text || "").trimStart().startsWith("Failed to load resource:");
}

async function collectDom(page) {
  return page.evaluate(() => {
    const body = document.body;
    const text = body ? (body.innerText || "").trim() : "";
    const nodeCount = document.querySelectorAll("*").length;
    const bodyDescendantCount = body ? body.getElementsByTagName("*").length : 0;
    const hasBodyChildren = !!body && body.children.length > 0;
    const isEmptyRootShell = (() => {
      if (!body) return true;
      const elementChildren = Array.from(body.children).filter(
        (c) => c.tagName !== "SCRIPT" && c.tagName !== "STYLE" && c.tagName !== "NOSCRIPT",
      );
      if (elementChildren.length !== 1) return false;
      const sole = elementChildren[0];
      if (sole.id !== "root" && sole.id !== "app" && sole.id !== "__next") return false;
      return sole.querySelectorAll("*").length <= 1;
    })();
    return { textLength: text.length, nodeCount, bodyDescendantCount, hasBodyChildren, isEmptyRootShell };
  });
}

async function collectPageSize(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const width = Math.max(
      window.innerWidth,
      root ? root.scrollWidth : 0,
      body ? body.scrollWidth : 0,
      root ? root.offsetWidth : 0,
      body ? body.offsetWidth : 0,
    );
    const height = Math.max(
      window.innerHeight,
      root ? root.scrollHeight : 0,
      body ? body.scrollHeight : 0,
      root ? root.offsetHeight : 0,
      body ? body.offsetHeight : 0,
    );
    return { width, height };
  });
}

async function collectGlyphCoverage(page) {
  return page.evaluate(() => {
    // CJK means Chinese, Japanese, and Korean unified ideograph coverage.
    const cjkTextPattern = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
    const samples = [];
    const failed = [];
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) && samples.length < 24) {
      const text = String(node.textContent || "").replace(/\s+/g, " ").trim();
      if (!cjkTextPattern.test(text)) continue;
      const parent = node.parentElement;
      if (!parent || !isVisible(parent)) continue;
      const style = getComputedStyle(parent);
      const sampleText = Array.from(text).filter((char) => cjkTextPattern.test(char)).slice(0, 8).join("");
      if (!sampleText) continue;
      const fontSpec = [style.fontStyle, style.fontVariant, style.fontWeight, style.fontSize, style.fontFamily]
        .filter(Boolean)
        .join(" ");
      samples.push({
        text: sampleText,
        font_family: style.fontFamily,
        font_spec: fontSpec,
        font_size: style.fontSize,
      });
    }

    for (const sample of samples) {
      const fontReady = typeof document.fonts?.check === "function" ? document.fonts.check(sample.font_spec, sample.text) : false;
      const missingChars = Array.from(new Set(Array.from(sample.text))).filter((char) =>
        glyphMatchesMissingGlyph(char, sample.font_spec, sample.font_size),
      );
      if (!fontReady || missingChars.length > 0) {
        failed.push({
          text: sample.text,
          font_family: sample.font_family,
          font_spec: sample.font_spec,
          reason: !fontReady ? "document.fonts.check failed" : "canvas glyph matched missing-glyph sentinel",
          missing_chars: missingChars,
        });
      }
    }

    return { passed: failed.length === 0, checked: samples.length, failed };

    function isVisible(element) {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function glyphMatchesMissingGlyph(char, fontSpec, fontSize) {
      const actual = glyphFingerprint(char, fontSpec, fontSize);
      const missing = glyphFingerprint(String.fromCodePoint(0x10ffff), fontSpec, fontSize);
      return (
        actual.ink > 0 &&
        missing.ink > 0 &&
        actual.hash === missing.hash &&
        actual.minX === missing.minX &&
        actual.minY === missing.minY &&
        actual.maxX === missing.maxX &&
        actual.maxY === missing.maxY
      );
    }

    function glyphFingerprint(char, fontSpec, fontSize) {
      const size = Number.parseFloat(fontSize) || 16;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(48, Math.min(192, Math.ceil(size * 5)));
      canvas.height = Math.max(48, Math.min(192, Math.ceil(size * 5)));
      const ctx = canvas.getContext("2d");
      if (!ctx) return { ink: 0, hash: "0", minX: 0, minY: 0, maxX: 0, maxY: 0 };
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#000";
      ctx.font = fontSpec;
      ctx.textBaseline = "top";
      ctx.fillText(char, 4, 4);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      let minX = canvas.width;
      let minY = canvas.height;
      let maxX = 0;
      let maxY = 0;
      let hash = 2166136261;
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const i = (y * canvas.width + x) * 4;
          const alpha = data[i + 3];
          if (alpha <= 8) continue;
          ink += 1;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
          hash ^= data[i] + (data[i + 1] << 8) + (data[i + 2] << 16) + (alpha << 24);
          hash = Math.imul(hash, 16777619) >>> 0;
        }
      }
      return {
        ink,
        hash: hash.toString(16),
        minX: ink ? minX : 0,
        minY: ink ? minY : 0,
        maxX: ink ? maxX : 0,
        maxY: ink ? maxY : 0,
      };
    }
  });
}

async function captureViewport(browser, input, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  try {
    const page = await context.newPage();
    const failedRequests = [];
    let totalResponses = 0;
    page.on("response", (res) => {
      totalResponses += 1;
      const status = res.status();
      if (status >= 400 && status < 600 && !isBrowserImplicitAssetRequest(res.url())) {
        failedRequests.push({ url: res.url(), status, reason: res.statusText() || "HTTP " + status });
      }
    });
    page.on("requestfailed", (req) => {
      if (isBrowserImplicitAssetRequest(req.url())) return;
      failedRequests.push({ url: req.url(), status: 0, reason: req.failure()?.errorText || "request failed" });
    });
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text().slice(0, 400);
      if (isResourceLoadConsoleError(text)) return;
      consoleErrors.push(text);
    });
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push((err?.message || String(err)).slice(0, 400)));
    await page.exposeFunction("__opencorvusCaptureUnhandledRejection", (message) => {
      pageErrors.push(("unhandledrejection: " + message).slice(0, 400));
    });
    await page.addInitScript(() => {
      window.addEventListener("unhandledrejection", (event) => {
        const reason = event.reason;
        const message =
          reason instanceof Error ? reason.message : typeof reason === "string" ? reason : JSON.stringify(reason);
        window.__opencorvusCaptureUnhandledRejection?.(message);
      });
    });
    const response = await page.goto(input.url, { waitUntil: "load", timeout: input.navigationTimeoutMs });
    const status = response?.status() || 0;
    const contentType = String(response?.headers()["content-type"] || "").toLowerCase();
    const bodyBuf = response ? await response.body() : Buffer.alloc(0);
    let httpReason = "";
    if (status < 200 || status >= 300) httpReason = "status=" + status;
    else if (!contentType.includes("text/html")) httpReason = "content-type=" + (contentType || "(missing)") + " - app root must serve text/html";
    else if (bodyBuf.length < 200) httpReason = "body=" + bodyBuf.length + "B - too small to be an app shell";
    await new Promise((resolve) => setTimeout(resolve, input.settleMs));
    const dom = await collectDom(page);
    const pageSize = await collectPageSize(page);
    const glyph = await collectGlyphCoverage(page);
    await page.screenshot({
      path: viewport.screenshotPath,
      type: "png",
      fullPage: true,
    });
    const passed =
      status >= 200 &&
      status < 300 &&
      contentType.includes("text/html") &&
      bodyBuf.length >= 200 &&
      failedRequests.length === 0 &&
      consoleErrors.length === 0 &&
      pageErrors.length === 0 &&
      dom.bodyDescendantCount >= input.minDomDescendants &&
      glyph.passed;
    const failedLayers = [];
    if (status < 200 || status >= 300 || !contentType.includes("text/html") || bodyBuf.length < 200) failedLayers.push("http");
    if (failedRequests.length > 0) failedLayers.push("asset");
    if (consoleErrors.length > 0 || pageErrors.length > 0) failedLayers.push("js");
    if (dom.bodyDescendantCount < input.minDomDescendants) failedLayers.push("dom");
    if (!glyph.passed) failedLayers.push("glyph");
    return {
      id: viewport.id,
      captured: true,
      passed,
      target_url: input.url,
      path: viewport.screenshotPath,
      size: pageSize,
      requested_viewport: { width: viewport.width, height: viewport.height },
      viewport: { width: viewport.width, height: viewport.height, capped: false },
      layers: {
        http: { passed: !failedLayers.includes("http"), status, content_type: contentType, body_length: bodyBuf.length, reason: httpReason },
        asset: { passed: failedRequests.length === 0, total: totalResponses, failed: failedRequests },
        dom: { passed: dom.bodyDescendantCount >= input.minDomDescendants, body_descendants: dom.bodyDescendantCount, required: input.minDomDescendants },
        js: { passed: consoleErrors.length === 0 && pageErrors.length === 0, console_errors: consoleErrors, page_errors: pageErrors },
        glyph,
        pixel: { passed: false, variance: 0, floor: 25, screenshot_path: viewport.screenshotPath },
        expected: { passed: true, missing_selectors: [], missing_texts: [] },
      },
      dom,
      summary: passed ? "browser preview capture passed on " + input.url : "failed layers: " + failedLayers.join(", "),
    };
  } catch (error) {
    const message = error?.message || String(error);
    return {
      id: viewport.id,
      captured: false,
      passed: false,
      requested_viewport: { width: viewport.width, height: viewport.height },
      viewport: { width: viewport.width, height: viewport.height, capped: false },
      capture_error: { kind: "capture_failed", message },
      summary: "browser preview capture failed: " + message,
    };
  } finally {
    await context.close();
  }
}

async function main() {
  const input = JSON.parse(Buffer.from(process.env.OPENCORVUS_BROWSER_PREVIEW_EVIDENCE_INPUT || "", "base64").toString("utf8"));
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: input.executablePath,
      headless: true,
      timeout: input.launchTimeoutMs,
      args: input.launchArgs,
    });
    const captures = [];
    for (const viewport of input.viewports) {
      captures.push(await captureViewport(browser, input, viewport));
    }
    process.stdout.write(JSON.stringify({ ok: true, captures }));
  } catch (error) {
    process.stdout.write(JSON.stringify({
      ok: false,
      message: error?.message || String(error),
      stack: error?.stack,
    }));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
}

main();
`

const BROWSER_PREVIEW_REGION_COMPARISON_SCRIPT = String.raw`
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(process.env.OPENCORVUS_PLAYWRIGHT_REQUIRE_PATH || "playwright");

function isBrowserImplicitAssetRequest(rawUrl) {
  try {
    return new URL(rawUrl).pathname === "/favicon.ico";
  } catch {
    return false;
  }
}

function routeUrl(base, route) {
  return new URL(route || "/", base).toString();
}

async function collectDom(page) {
  return page.evaluate(() => {
    const body = document.body;
    const text = body ? (body.innerText || "").trim() : "";
    return {
      text_length: text.length,
      node_count: document.querySelectorAll("*").length,
      body_descendant_count: body ? body.getElementsByTagName("*").length : 0,
    };
  });
}

async function collectPageSize(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const width = Math.max(
      window.innerWidth,
      root ? root.scrollWidth : 0,
      body ? body.scrollWidth : 0,
      root ? root.offsetWidth : 0,
      body ? body.offsetWidth : 0,
    );
    const height = Math.max(
      window.innerHeight,
      root ? root.scrollHeight : 0,
      body ? body.scrollHeight : 0,
      root ? root.offsetHeight : 0,
      body ? body.offsetHeight : 0,
    );
    return { width, height };
  });
}

function createRouteDiagnosticsRecorder(page) {
  let failedRequests = [];
  let consoleErrors = [];
  let pageErrors = [];
  page.on("response", (res) => {
    const status = res.status();
    if (status >= 400 && status < 600 && !isBrowserImplicitAssetRequest(res.url())) {
      failedRequests.push({ url: res.url(), status, reason: res.statusText() || "HTTP " + status });
    }
  });
  page.on("requestfailed", (req) => {
    if (isBrowserImplicitAssetRequest(req.url())) return;
    failedRequests.push({ url: req.url(), status: 0, reason: req.failure()?.errorText || "request failed" });
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 400));
  });
  page.on("pageerror", (err) => pageErrors.push((err?.message || String(err)).slice(0, 400)));
  return {
    reset() {
      failedRequests = [];
      consoleErrors = [];
      pageErrors = [];
    },
    snapshot() {
      return {
        failed_requests: failedRequests.slice(),
        console_errors: consoleErrors.slice(),
        page_errors: pageErrors.slice(),
      };
    },
  };
}

async function navigateAndDiagnose(page, recorder, input, route, screenshotPath) {
  recorder.reset();
  let response = null;
  let navigationError = "";
  try {
    response = await page.goto(routeUrl(input.url, route), { waitUntil: "load", timeout: 30000 });
  } catch (error) {
    navigationError = error?.message || String(error);
  }
  await new Promise((resolve) => setTimeout(resolve, input.settleMs ?? 500));
  const status = response ? response.status() : 0;
  const headers = response ? response.headers() : {};
  const contentType = String(headers["content-type"] || "").toLowerCase();
  let bodyLength = 0;
  if (response) {
    try {
      bodyLength = (await response.body()).length;
    } catch {
      bodyLength = 0;
    }
  }
  let dom = { text_length: 0, node_count: 0, body_descendant_count: 0 };
  try {
    dom = await collectDom(page);
  } catch {}
  let pageSize = { width: 0, height: 0 };
  try {
    pageSize = await collectPageSize(page);
  } catch {}
  let title = "";
  try {
    title = await page.title();
  } catch {}
  try {
    await page.screenshot({ path: screenshotPath, type: "png", fullPage: true });
  } catch {}
  const recorded = recorder.snapshot();
  const validAppPage =
    !navigationError &&
    status >= 200 &&
    status < 300 &&
    contentType.includes("text/html") &&
    bodyLength >= 200 &&
    dom.body_descendant_count > 0;
  const reasons = [];
  if (navigationError) reasons.push("navigation=" + navigationError);
  if (status < 200 || status >= 300) reasons.push("status=" + status);
  if (!contentType.includes("text/html")) reasons.push("content-type=" + (contentType || "(missing)"));
  if (bodyLength < 200) reasons.push("body=" + bodyLength + "B");
  if (dom.body_descendant_count <= 0) reasons.push("dom_descendants=" + dom.body_descendant_count);
  return {
    route,
    url: page.url(),
    status,
    content_type: contentType,
    body_length: bodyLength,
    title,
    dom,
    page_size: pageSize,
    ...recorded,
    valid_app_page: validAppPage,
    reason: validAppPage ? undefined : reasons.join(", "),
    screenshot_path: screenshotPath,
  };
}

async function locate(page, locator) {
  const target = locatorFor(page, locator).first();
  const visible = await target.isVisible();
  if (!visible) return null;
  const box = await target.boundingBox();
  if (!box || box.width <= 0 || box.height <= 0) return null;
  const normalized = toBox(box);
  if (normalized.width <= 0 || normalized.height <= 0) return null;
  return normalized;
}

function locatorFor(page, locator) {
  if (locator.kind === "role") return page.getByRole(locator.role, { name: locator.name });
  return page.locator(selectorFor(locator));
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
    width: Math.round(rect.width),
    height: Math.round(rect.height),
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
        const recorder = createRouteDiagnosticsRecorder(page);
        const firstRoute = input.bindings.find((binding) => binding.viewportID === viewportID)?.route || "/";
        let currentRoute = firstRoute;
        const viewportDir = path.join(input.outDir, "implementation", viewportID);
        await fs.mkdir(viewportDir, { recursive: true });
        const screenshotPath = path.join(viewportDir, "full.png");
        let currentRouteDiagnostics = await navigateAndDiagnose(page, recorder, input, firstRoute, screenshotPath);
        for (const binding of input.bindings.filter((item) => item.viewportID === viewportID)) {
          if (binding.route !== currentRoute) {
            currentRoute = binding.route;
            currentRouteDiagnostics = await navigateAndDiagnose(page, recorder, input, binding.route, screenshotPath);
          }
          const regionScreenshotPath = path.join(viewportDir, sanitizeSegment(binding.viewportID + ":" + binding.stateID + ":" + binding.regionID) + ".png");
          await page.screenshot({ path: regionScreenshotPath, type: "png", fullPage: true });
          const routeDiagnostics = { ...currentRouteDiagnostics, screenshot_path: regionScreenshotPath };
          if (!routeDiagnostics.valid_app_page) {
            const reason = "Implementation route did not render a valid app page: route=" + binding.route + " url=" + (routeDiagnostics.url || "") + " " + (routeDiagnostics.reason || "route health failed");
            regions.push({
              regionID: binding.regionID,
              stateID: binding.stateID,
              viewportID,
              status: "failed",
              reason,
              screenshotPath: regionScreenshotPath,
              viewport,
              fullpageSize: routeDiagnostics.page_size,
              routeDiagnostics,
            });
            continue;
          }
          const bbox = await locate(page, binding.locator);
          if (!bbox) {
            regions.push({
              regionID: binding.regionID,
              stateID: binding.stateID,
              viewportID,
              status: "failed",
              reason: "Implementation locator did not match any visible element.",
              screenshotPath: regionScreenshotPath,
              viewport,
              fullpageSize: routeDiagnostics.page_size,
              routeDiagnostics,
            });
            continue;
          }
          regions.push({
            regionID: binding.regionID,
            stateID: binding.stateID,
            viewportID,
            status: "completed",
            bbox,
            screenshotPath: regionScreenshotPath,
            viewport,
            fullpageSize: routeDiagnostics.page_size,
            routeDiagnostics,
          });
        }
      } finally {
        await context.close();
      }
    }
    process.stdout.write(JSON.stringify({ ok: true, regions }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, message: error?.message || String(error), stack: error?.stack }));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
}

function sanitizeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 96) || "region";
}

main();
`
