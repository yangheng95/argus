import fs from "node:fs/promises"
import path from "node:path"

import { WebpageAnalyzeTool, WebpageCompileTool, WebpageExtractTool } from "@/frontend-design/tools"
import { captureWebpageRuntimeStateEvidence } from "@/browser/webpage/runtime-state"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { TaskRuntimeMaterializer } from "@/project/task-runtime-materializer"
import type { Tool } from "@/tool/tool"
import { prepareWebCloneContext } from "@/web-clone/context"
import { readPngEvidence } from "@/web-clone/evidence-integrity"

export type LiveWebpageEvidenceStatus = "skipped" | "reused" | "generated"

export interface LiveWebpageEvidenceResult {
  status: LiveWebpageEvidenceStatus
  url?: string
  evidenceDir?: string
  artifacts: string[]
}

export interface LiveWebpageEvidencePipeline {
  extract(input: { url: string; outputDir: string; signal?: AbortSignal; taskID: string }): Promise<void>
  compile(input: { outputDir: string; signal?: AbortSignal; taskID: string }): Promise<void>
  analyze(input: { outputDir: string; signal?: AbortSignal; taskID: string }): Promise<void>
  captureRuntimeState(input: { url: string; outputDir: string; signal?: AbortSignal; taskID: string }): Promise<void>
}

const PRIMARY_WEBPAGE_EVIDENCE_FILES = [
  "reference.png",
  "capture.html",
  "extracted-page.json",
  "page.ir.json",
  "assets/manifest.json",
  "segments.json",
  "codegen-context.json",
  "prd-evidence-summary.md",
  "visual-surface-candidates.json",
  "source-skeleton/index.html",
  "source-skeleton/critical.css",
  "source-skeleton/full-source.css",
  "source-skeleton/README.md",
  "source-skeleton/used-selectors.json",
  "source-skeleton/skeleton-manifest.json",
  "source-skeleton/source-skeleton-audit.json",
  "source-ir/component-tree.json",
  "source-ir/content-model.json",
  "source-ir/layout-map.json",
  "source-ir/style-tokens.json",
  "source-ir/interaction-hints.json",
  "source-ir/interaction-state-snapshots.json",
  "source-ir/source-quality-audit.json",
  "interaction-states/initial.png",
  "interaction-states/scroll-25.png",
  "interaction-states/scroll-50.png",
  "interaction-states/scroll-75.png",
] as const

export function primaryWebpageEvidenceArtifacts(taskID?: string): string[] {
  const root = taskID
    ? ProjectRuntimePaths.frontendDesignPaths("", taskID).webpageEvidenceRelative
    : "webpage-evidence"
  return PRIMARY_WEBPAGE_EVIDENCE_FILES.map((file) => path.posix.join(root, file))
}

const PRIMARY_WEBPAGE_SOURCE_PACKAGE_FILES = [
  "README.md",
  "implementation-blueprint.md",
  "web-clone-context.md",
  "web-clone-implementation-contract.json",
  "web-clone-source-manifest.json",
  "reference.png",
  "visual-surface-candidates.json",
  "assets/manifest.json",
  "source-skeleton/index.html",
  "source-skeleton/critical.css",
  "source-skeleton/full-source.css",
  "source-skeleton/used-selectors.json",
  "source-skeleton/skeleton-manifest.json",
  "source-skeleton/source-skeleton-audit.json",
  "source-ir/component-tree.json",
  "source-ir/content-model.json",
  "source-ir/layout-map.json",
  "source-ir/style-tokens.json",
  "source-ir/interaction-hints.json",
  "source-ir/interaction-state-snapshots.json",
  "source-ir/source-quality-audit.json",
  "interaction-states/initial.png",
  "interaction-states/scroll-25.png",
  "interaction-states/scroll-50.png",
  "interaction-states/scroll-75.png",
] as const

export function primaryWebpageSourcePackageArtifacts(taskID?: string): string[] {
  const root = taskID
    ? ProjectRuntimePaths.frontendDesignPaths("", taskID).sourcePackageRelative
    : "web-clone-source"
  return PRIMARY_WEBPAGE_SOURCE_PACKAGE_FILES.map((file) => path.posix.join(root, file))
}

export async function ensureLiveWebpageEvidence(input: {
  projectDir: string
  worktreeDir: string
  taskID: string
  urls: readonly string[]
  signal?: AbortSignal
  pipeline?: LiveWebpageEvidencePipeline
}): Promise<LiveWebpageEvidenceResult> {
  const url = input.urls.find((item) => item.startsWith("http://") || item.startsWith("https://"))
  if (!url) return { status: "skipped", artifacts: [] }

  await TaskRuntimeMaterializer.materializeFrontendDesign({
    projectDir: input.projectDir,
    taskID: input.taskID,
    worktreeDir: input.worktreeDir,
  })

  const paths = ProjectRuntimePaths.frontendDesignPaths(input.projectDir, input.taskID)
  const evidenceDir = paths.webpageEvidenceAbsolute

  if (await hasCompletePrimaryEvidence(evidenceDir, url)) {
    await ensureVisibleSourcePackage(input.projectDir, input.worktreeDir, input.taskID)
    return {
      status: "reused",
      url,
      evidenceDir,
      artifacts: [...primaryWebpageEvidenceArtifacts(input.taskID), ...primaryWebpageSourcePackageArtifacts(input.taskID)],
    }
  }

  const pipeline = input.pipeline ?? defaultLiveWebpageEvidencePipeline()
  await pipeline.extract({ url, outputDir: evidenceDir, signal: input.signal, taskID: input.taskID })
  await pipeline.compile({ outputDir: evidenceDir, signal: input.signal, taskID: input.taskID })
  await pipeline.analyze({ outputDir: evidenceDir, signal: input.signal, taskID: input.taskID })
  await pipeline.captureRuntimeState({ url, outputDir: evidenceDir, signal: input.signal, taskID: input.taskID })
  if (!(await hasCompletePrimaryEvidence(evidenceDir, url))) {
    throw new Error(`Live webpage evidence pipeline finished but did not produce the complete primary webpage evidence artifact set in ${evidenceDir}`)
  }
  await ensureVisibleSourcePackage(input.projectDir, input.worktreeDir, input.taskID)

  return {
    status: "generated",
    url,
    evidenceDir,
    artifacts: [...primaryWebpageEvidenceArtifacts(input.taskID), ...primaryWebpageSourcePackageArtifacts(input.taskID)],
  }
}

async function ensureVisibleSourcePackage(projectDir: string, worktreeDir: string, taskID: string): Promise<void> {
  const paths = ProjectRuntimePaths.frontendDesignPaths(projectDir, taskID)
  await prepareWebCloneContext({
    webpageEvidenceDir: paths.webpageEvidenceAbsolute,
    outputDir: paths.sourcePackageAbsolute,
  })
  if (!(await hasCompleteSourcePackage(paths.sourcePackageAbsolute))) {
    throw new Error(`Live webpage evidence pipeline produced an incomplete web-clone-source package in ${paths.sourcePackageAbsolute}`)
  }
  await TaskRuntimeMaterializer.materializeFrontendDesign({ projectDir, taskID, worktreeDir })
}

export async function hasCompletePrimaryEvidence(webpageEvidenceDir: string, url?: string): Promise<boolean> {
  if (!(await hasValidPngFile(path.join(webpageEvidenceDir, "reference.png")))) return false
  for (const relative of PRIMARY_WEBPAGE_EVIDENCE_FILES) {
    if (relative === "reference.png") continue
    if (!(await hasNonEmptyFile(path.join(webpageEvidenceDir, relative)))) return false
  }
  if (!url) return true
  const extractedUrl = await readExtractedPageUrl(path.join(webpageEvidenceDir, "extracted-page.json"))
  return normalizeUrlForEvidence(extractedUrl) === normalizeUrlForEvidence(url)
}

export async function hasCompleteSourcePackage(sourcePackageDir: string): Promise<boolean> {
  for (const relative of PRIMARY_WEBPAGE_SOURCE_PACKAGE_FILES) {
    const file = path.join(sourcePackageDir, relative)
    if (relative === "reference.png") {
      if (!(await hasValidPngFile(file))) return false
      continue
    }
    if (!(await hasNonEmptyFile(file))) return false
  }
  return true
}

function defaultLiveWebpageEvidencePipeline(): LiveWebpageEvidencePipeline {
  return {
    extract: async ({ url, outputDir, signal, taskID }) => {
      await runTool(WebpageExtractTool, {
        url,
        outputDir,
        viewport_width: 1440,
        viewport_height: 900,
        keep_images: true,
      }, signal, taskID)
    },
    compile: async ({ outputDir, signal, taskID }) => {
      await runTool(WebpageCompileTool, { outputDir }, signal, taskID)
    },
    analyze: async ({ outputDir, signal, taskID }) => {
      await runTool(WebpageAnalyzeTool, { outputDir }, signal, taskID)
    },
    captureRuntimeState: async ({ url, outputDir, signal }) => {
      await captureWebpageRuntimeStateEvidence({
        url,
        outputDir,
        viewport: { width: 1440, height: 900 },
        signal,
      })
    },
  }
}

async function runTool(
  tool: Tool.Info,
  args: Record<string, unknown>,
  signal: AbortSignal | undefined,
  taskID: string,
): Promise<void> {
  const initialized = await tool.init()
  const controller = new AbortController()
  if (signal?.aborted) controller.abort(signal.reason)
  signal?.addEventListener("abort", () => controller.abort(signal.reason), { once: true })
  await initialized.execute(args, {
    sessionID: "",
    messageID: `host-webpage-evidence-${taskID}`,
    agent: "orchestrator",
    abort: signal ?? controller.signal,
    messages: [],
    extra: { taskID },
    metadata: () => {},
    ask: async () => {},
  })
}

async function hasNonEmptyFile(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file)
    return stat.isFile() && stat.size > 0
  } catch {
    return false
  }
}

async function hasValidPngFile(file: string): Promise<boolean> {
  return (await readPngEvidence(file)).valid
}

async function readExtractedPageUrl(file: string): Promise<string | undefined> {
  try {
    const json = JSON.parse(await fs.readFile(file, "utf8"))
    return typeof json?.url === "string" ? json.url : undefined
  } catch {
    return undefined
  }
}

function normalizeUrlForEvidence(input: string | undefined): string {
  if (!input) return ""
  try {
    const parsed = new URL(input)
    parsed.hash = ""
    return parsed.toString().replace(/\/$/, "")
  } catch {
    return input.trim().replace(/\/$/, "")
  }
}
