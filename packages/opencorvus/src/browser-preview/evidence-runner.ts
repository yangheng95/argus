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
  runtimeCaptureFailedLayers,
  type RuntimeCaptureFailure,
  type RuntimeCaptureResult,
  type RuntimeCaptureSuccess,
} from "@/runtime/capture-contract"
import { pngLuminanceVariance } from "@/runtime/png-metrics"
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
  jobID: string
  taskID: string
  targetID: string
  url: string
  outDir: string
  viewportIDs: BrowserPreviewViewportID[]
  signal?: AbortSignal
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

export async function runBrowserPreviewEvidenceJob(
  input: BrowserPreviewEvidenceRunnerInput,
): Promise<BrowserPreviewEvidenceRunnerResult> {
  requireBrowserEvidenceIdentity(input)
  const executablePath = await BrowserRuntime.findBrowserExecutable()
  const launchTimeoutMs = BrowserRuntime.resolveBrowserLaunchTimeoutMs(undefined)
  const navigationTimeoutMs = RUNTIME_CAPTURE_DEFAULTS.wait_timeout_ms
  const settleMs = RUNTIME_CAPTURE_DEFAULTS.settle_ms
  const runtime = await resolveBrowserNodeSidecarRuntime()
  await fs.mkdir(input.outDir, { recursive: true })

  const viewports: SidecarViewportInput[] = input.viewportIDs.map((id) => {
    const preset = browserPreviewViewportByID(id)
    const viewport = normalizeRuntimeCaptureViewport({ width: preset.width, height: preset.height })
    return {
      id,
      width: viewport.width,
      height: viewport.height,
      screenshotPath: path.join(input.outDir, `${id}.png`),
    }
  })

  const sidecar = await runBrowserNodeSidecar<
    { ok: true; captures: SidecarCaptureResult[] } | { ok: false; message: string; stack?: string }
  >({
    runtime,
    script: BROWSER_PREVIEW_BATCH_SCRIPT,
    payload: {
      url: input.url,
      executablePath,
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
    const finalized = await finalizeBrowserPreviewSidecarCapture({ capture, url: input.url, outDir: input.outDir })
    captures[capture.id] = finalized.capture
    if (finalized.artifactPath) artifactPaths.push(finalized.artifactPath)
    diagnostics.push(finalized.diagnostic)
  }

  const manifest = await writeBrowserEvidenceManifest({
    outDir: input.outDir,
    jobID: input.jobID,
    taskID: input.taskID,
    targetID: input.targetID,
    url: input.url,
    viewportIDs: input.viewportIDs,
    artifactPaths,
    captures,
    diagnostics,
  })
  return { manifest, captures }
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

function requireBrowserEvidenceIdentity(input: { jobID: string; taskID: string; targetID: string }): void {
  const missing = [
    input.jobID.trim() ? undefined : "jobID",
    input.taskID.trim() ? undefined : "taskID",
    input.targetID.trim() ? undefined : "targetID",
  ].filter((item): item is string => Boolean(item))
  if (missing.length > 0) {
    throw new Error(`Browser preview evidence runner requires non-empty ${missing.join(", ")}.`)
  }
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
    const missing = [
      !capture.layers ? "layers" : undefined,
      !capture.dom ? "dom" : undefined,
    ].filter((item): item is string => !!item)
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
  const summary = passed ? `all runtime capture layers passed on ${input.url}` : `failed layers: ${failedLayers.join(", ")}`
  return {
    capture: {
      captured: true,
      passed,
      url: input.url,
      target_url: capture.target_url ?? input.url,
      path: finalPath,
      sha,
      bytes: bytes.length,
      size: capture.size ?? { width: capture.viewport.width, height: capture.viewport.height },
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
    const bodyBuf = response ? await response.body().catch(() => Buffer.alloc(0)) : Buffer.alloc(0);
    let httpReason = "";
    if (status < 200 || status >= 300) httpReason = "status=" + status;
    else if (!contentType.includes("text/html")) httpReason = "content-type=" + (contentType || "(missing)") + " - app root must serve text/html";
    else if (bodyBuf.length < 200) httpReason = "body=" + bodyBuf.length + "B - too small to be an app shell";
    await new Promise((resolve) => setTimeout(resolve, input.settleMs));
    const dom = await collectDom(page);
    await page.screenshot({
      path: viewport.screenshotPath,
      type: "png",
      clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
    });
    const passed =
      status >= 200 &&
      status < 300 &&
      contentType.includes("text/html") &&
      bodyBuf.length >= 200 &&
      failedRequests.length === 0 &&
      consoleErrors.length === 0 &&
      pageErrors.length === 0 &&
      dom.bodyDescendantCount >= input.minDomDescendants;
    const failedLayers = [];
    if (status < 200 || status >= 300 || !contentType.includes("text/html") || bodyBuf.length < 200) failedLayers.push("http");
    if (failedRequests.length > 0) failedLayers.push("asset");
    if (consoleErrors.length > 0 || pageErrors.length > 0) failedLayers.push("js");
    if (dom.bodyDescendantCount < input.minDomDescendants) failedLayers.push("dom");
    return {
      id: viewport.id,
      captured: true,
      passed,
      target_url: input.url,
      path: viewport.screenshotPath,
      size: { width: viewport.width, height: viewport.height },
      requested_viewport: { width: viewport.width, height: viewport.height },
      viewport: { width: viewport.width, height: viewport.height, capped: false },
      layers: {
        http: { passed: !failedLayers.includes("http"), status, content_type: contentType, body_length: bodyBuf.length, reason: httpReason },
        asset: { passed: failedRequests.length === 0, total: totalResponses, failed: failedRequests },
        dom: { passed: dom.bodyDescendantCount >= input.minDomDescendants, body_descendants: dom.bodyDescendantCount, required: input.minDomDescendants },
        js: { passed: consoleErrors.length === 0 && pageErrors.length === 0, console_errors: consoleErrors, page_errors: pageErrors },
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
    await context.close().catch(() => {});
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
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
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
    if (browser) await browser.close().catch(() => {});
  }
}

main();
`
