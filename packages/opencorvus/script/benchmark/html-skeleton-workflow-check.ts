#!/usr/bin/env bun

import fs from "node:fs/promises"
import path from "node:path"
import { runVisualDiff, summarizeVisualReport, type VisualDiffReport } from "../../src/runtime/visual-page"
import { serveRenderedDir } from "./static-render-server"

const VISUAL_RENDER_PREREQUISITE_CHECK_IDS = new Set([
  "visual-root-index",
  "reference-png",
  "visual-root-is-design-output",
  "not-build-output-root",
  "editable-html-size",
  "not-framework-compiled-entry",
  "not-reference-image-only",
])

export interface HtmlSkeletonWorkflowCheckInput {
  taskID?: string
  taskDir?: string
  frontendDesignDir?: string
  frontendResearchDir?: string
  visualRoot?: string
  sourcePackageDir?: string
  templatePath?: string
  evidenceManifestPath?: string
  processTracePath?: string
  iterationStatePath?: string
  logDir?: string
  reference?: string
  outDir: string
  threshold: number
  worstThreshold: number
  browserLaunchTimeoutMs?: number
  headless: boolean
}

export interface HtmlSkeletonWorkflowCheckReport {
  passed: boolean
  outDir: string
  frontendDesignDir?: string
  frontendResearchDir?: string
  visualRoot: string
  sourcePackageDir?: string
  reference: string
  thresholds: {
    mean: number
    worstWindow: number
  }
  checks: Array<{
    id: string
    passed: boolean
    message: string
    path?: string
  }>
  visualDiff?: VisualDiffReport
}

function flag(name: string): string | undefined {
  const prefix = `${name}=`
  const argvMatch = process.argv.find((item) => item.startsWith(prefix))
  if (argvMatch) return argvMatch.slice(prefix.length)
  const idx = process.argv.indexOf(name)
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1]
  return undefined
}

function parseNumberFlag(name: string, fallback: number): number {
  const raw = flag(name)
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error(`Invalid numeric flag ${name}: ${raw}`)
  return value
}

function defaultOutDir(): string {
  return path.resolve(import.meta.dir, "../../../..", ".scratch", "html-skeleton-workflow", "latest")
}

export function parseHtmlSkeletonWorkflowCheckArgs(): HtmlSkeletonWorkflowCheckInput {
  return {
    taskID: flag("--task-id"),
    taskDir: flag("--task-dir"),
    frontendDesignDir: flag("--frontend-design-dir"),
    frontendResearchDir: flag("--frontend-research-dir"),
    visualRoot: flag("--visual-root"),
    sourcePackageDir: flag("--source-package"),
    templatePath: flag("--frontend-template"),
    evidenceManifestPath: flag("--evidence-source-manifest"),
    processTracePath: flag("--process-trace"),
    iterationStatePath: flag("--iteration-state"),
    logDir: flag("--log-dir"),
    reference: flag("--reference"),
    outDir: path.resolve(flag("--out") ?? defaultOutDir()),
    threshold: parseNumberFlag("--threshold", 0.95),
    worstThreshold: parseNumberFlag("--worst-threshold", 0.8),
    browserLaunchTimeoutMs: parseNumberFlag(
      "--browser-launch-timeout-ms",
      Number(process.env.OPENCORVUS_BROWSER_LAUNCH_TIMEOUT_MS ?? 60_000),
    ),
    headless: process.argv.includes("--headless") || process.env.OPENCORVUS_VISUAL_DIFF_HEADLESS === "1",
  }
}

export async function runHtmlSkeletonWorkflowCheck(
  input: HtmlSkeletonWorkflowCheckInput,
): Promise<HtmlSkeletonWorkflowCheckReport> {
  const resolved = await resolveInputs(input)
  await fs.mkdir(resolved.outDir, { recursive: true })

  const checks: HtmlSkeletonWorkflowCheckReport["checks"] = []
  await collectArtifactChecks(resolved, checks)

  let visualDiff: VisualDiffReport | undefined
  const artifactChecksPassed = checks.every((check) => check.passed)
  const visualRenderPrerequisitesPassed = checks
    .filter((check) => VISUAL_RENDER_PREREQUISITE_CHECK_IDS.has(check.id))
    .every((check) => check.passed)
  if (visualRenderPrerequisitesPassed) {
    const server = await serveRenderedDir(resolved.visualRoot)
    try {
      visualDiff = await runVisualDiff({
        rendered: server.url,
        reference: resolved.reference,
        threshold: resolved.threshold,
        worstThreshold: resolved.worstThreshold,
        outDir: resolved.outDir,
        browserLaunchTimeoutMs: resolved.browserLaunchTimeoutMs,
        headless: resolved.headless,
      })
    } finally {
      await server.close()
    }
  }

  const passed = artifactChecksPassed && visualDiff?.passed === true
  const report: HtmlSkeletonWorkflowCheckReport = {
    passed,
    outDir: resolved.outDir,
    frontendDesignDir: resolved.frontendDesignDir,
    frontendResearchDir: resolved.frontendResearchDir,
    visualRoot: resolved.visualRoot,
    sourcePackageDir: resolved.sourcePackageDir,
    reference: resolved.reference,
    thresholds: {
      mean: resolved.threshold,
      worstWindow: resolved.worstThreshold,
    },
    checks,
    visualDiff,
  }
  await fs.writeFile(
    path.join(resolved.outDir, "html-skeleton-workflow-report.json"),
    JSON.stringify(report, null, 2) + "\n",
  )
  return report
}

async function resolveInputs(input: HtmlSkeletonWorkflowCheckInput): Promise<
  Required<Pick<HtmlSkeletonWorkflowCheckInput, "outDir" | "threshold" | "worstThreshold" | "headless">> & {
    frontendDesignDir?: string
    frontendResearchDir?: string
    visualRoot: string
    sourcePackageDir?: string
    templatePath?: string
    evidenceManifestPath?: string
    processTracePath?: string
    iterationStatePath?: string
    logDir?: string
    reference: string
    browserLaunchTimeoutMs?: number
  }
> {
  const taskDir = input.taskDir
    ? await resolveTaskDir(path.resolve(input.taskDir))
    : input.taskID
      ? path.join(repoRoot(), ".opencorvus", "runtime", "tasks", input.taskID)
      : undefined
  const frontendDesignDir = input.frontendDesignDir
    ? path.resolve(input.frontendDesignDir)
    : taskDir
      ? path.basename(taskDir).toLowerCase() === "frontend-design"
        ? taskDir
        : path.join(taskDir, "frontend-design")
      : undefined
  const frontendResearchDir = input.frontendResearchDir
    ? path.resolve(input.frontendResearchDir)
    : taskDir
      ? path.join(taskDir, "frontend-research")
      : undefined
  const visualRoot = path.resolve(
    input.visualRoot ?? path.join(frontendDesignDir ?? process.cwd(), "visual-html-skeleton"),
  )
  const sourcePackageDir = input.sourcePackageDir
    ? path.resolve(input.sourcePackageDir)
    : frontendDesignDir
      ? path.join(frontendDesignDir, "web-clone-source")
      : undefined
  const templatePath = input.templatePath
    ? path.resolve(input.templatePath)
    : frontendDesignDir
      ? path.join(frontendDesignDir, "frontend-template.md")
      : undefined
  const evidenceManifestPath = input.evidenceManifestPath
    ? path.resolve(input.evidenceManifestPath)
    : frontendDesignDir
      ? path.join(frontendDesignDir, "evidence-source-manifest.md")
      : undefined
  const processTracePath = input.processTracePath
    ? path.resolve(input.processTracePath)
    : frontendDesignDir
      ? path.join(frontendDesignDir, "frontend-design-process-trace.json")
      : undefined
  const iterationStatePath = input.iterationStatePath
    ? path.resolve(input.iterationStatePath)
    : frontendDesignDir
      ? path.join(frontendDesignDir, "frontend-design-iteration-state.json")
      : undefined
  const reference = path.resolve(input.reference ?? path.join(sourcePackageDir ?? visualRoot, "reference.png"))
  return {
    outDir: path.resolve(input.outDir),
    threshold: input.threshold,
    worstThreshold: input.worstThreshold,
    headless: input.headless,
    browserLaunchTimeoutMs: input.browserLaunchTimeoutMs,
    frontendDesignDir,
    frontendResearchDir,
    visualRoot,
    sourcePackageDir,
    templatePath,
    evidenceManifestPath,
    processTracePath,
    iterationStatePath,
    logDir: input.logDir ? path.resolve(input.logDir) : frontendDesignDir,
    reference,
  }
}

async function resolveTaskDir(inputDir: string): Promise<string> {
  const directFrontendDesign = path.join(inputDir, "frontend-design")
  if ((await dirExists(directFrontendDesign)) || path.basename(inputDir).toLowerCase() === "frontend-design") {
    return inputDir
  }
  if (path.basename(inputDir).toLowerCase() !== "tasks") return inputDir

  const entries = await fs.readdir(inputDir, { withFileTypes: true }).catch(() => [])
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const taskDir = path.join(inputDir, entry.name)
        const frontendDesignDir = path.join(taskDir, "frontend-design")
        const stat = await fs.stat(frontendDesignDir).catch(() => undefined)
        return stat?.isDirectory() ? { taskDir, mtimeMs: stat.mtimeMs } : undefined
      }),
  )
  const sorted = candidates
    .filter((item): item is { taskDir: string; mtimeMs: number } => Boolean(item))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  return sorted[0]?.taskDir ?? inputDir
}

async function collectArtifactChecks(
  input: {
    frontendDesignDir?: string
    frontendResearchDir?: string
    visualRoot: string
    sourcePackageDir?: string
    templatePath?: string
    evidenceManifestPath?: string
    processTracePath?: string
    iterationStatePath?: string
    logDir?: string
    reference: string
  },
  checks: HtmlSkeletonWorkflowCheckReport["checks"],
): Promise<void> {
  checks.push(
    await fileCheck(
      "visual-root-index",
      path.join(input.visualRoot, "index.html"),
      "visual HTML skeleton has an index.html entrypoint",
    ),
  )
  checks.push(await fileCheck("reference-png", input.reference, "visual truth reference.png is available"))

  const normalizedVisualRoot = normalizePath(input.visualRoot)
  checks.push({
    id: "visual-root-is-design-output",
    passed:
      !normalizedVisualRoot.endsWith("/frontend-design-skeleton") &&
      !normalizedVisualRoot.endsWith("/web-clone-source/source-skeleton"),
    message: "visualRoot must be the separate frontend-design visual output, not captured source evidence",
    path: input.visualRoot,
  })

  const indexPath = path.join(input.visualRoot, "index.html")
  const indexHtml = await readOptionalText(indexPath)
  const indexBytes = await fileSize(indexPath)
  checks.push({
    id: "not-build-output-root",
    passed: !(await hasBuildOutputIndex(input.visualRoot)),
    message: "visual HTML skeleton must be source-editable static HTML/CSS, not dist/build/out compiled output",
    path: input.visualRoot,
  })
  checks.push({
    id: "editable-html-size",
    passed: indexBytes > 0 && indexBytes <= 200_000,
    message:
      "index.html must stay editable and bounded; split source evidence into semantic sections/CSS/assets instead of a giant DOM dump",
    path: indexPath,
  })
  checks.push({
    id: "has-external-css",
    passed: /<link\b[^>]*\brel=(?:"stylesheet"|'stylesheet'|stylesheet\b)/i.test(indexHtml),
    message: "visual skeleton should use external CSS files so visual tokens/layout remain editable",
    path: indexPath,
  })
  const tokenPath = path.join(input.visualRoot, "styles", "tokens.css")
  checks.push(
    await fileCheck("visual-token-css", tokenPath, "visual skeleton includes source-backed styles/tokens.css"),
  )
  if (await fileExists(tokenPath)) {
    const tokenCss = await readOptionalText(tokenPath)
    checks.push({
      id: "visual-token-css-variables",
      passed: /--[a-z0-9-]+\s*:/i.test(tokenCss) && tokenCss.length <= 80_000,
      message: "tokens.css should contain bounded CSS custom properties instead of a copied raw CSS bundle",
      path: tokenPath,
    })
  }
  checks.push({
    id: "bounded-inline-css",
    passed: inlineStyleBytes(indexHtml) <= 12_000,
    message: "inline CSS must be bounded; put token/layout rules in editable CSS files",
    path: indexPath,
  })
  checks.push({
    id: "not-framework-compiled-entry",
    passed: !/(?:\/assets\/index-[^"']+\.js|\/src\/main\.(?:tsx|ts|jsx|js)|react-refresh|vite\/client)/i.test(
      indexHtml,
    ),
    message: "visual skeleton must not rely on a framework compiled/dev entry as the visual artifact",
    path: indexPath,
  })
  checks.push({
    id: "not-raw-source-dom-dump",
    passed: !isRawSourceDomDump(indexHtml),
    message:
      "visual skeleton must not be a raw captured DOM/source-skeleton dump; restore editable semantic HTML sections instead",
    path: indexPath,
  })
  checks.push({
    id: "no-unresolved-data-uri-assets",
    passed: !/__WEB_CLONE_DATA_URI_ASSET__/i.test(indexHtml),
    message: "visual skeleton must resolve captured image assets instead of preserving data URI placeholders",
    path: indexPath,
  })
  checks.push({
    id: "not-iframe-preview",
    passed: !/<iframe\b/i.test(indexHtml),
    message: "visual HTML skeleton must render its own HTML/CSS instead of iframe previewing captured evidence",
    path: path.join(input.visualRoot, "index.html"),
  })
  checks.push({
    id: "not-reference-image-only",
    passed: !isReferenceImageOnly(indexHtml),
    message: "visual HTML skeleton must not be only a reference screenshot wrapped in HTML",
    path: path.join(input.visualRoot, "index.html"),
  })

  if (input.sourcePackageDir) {
    for (const relative of [
      "README.md",
      "implementation-blueprint.md",
      "web-clone-implementation-contract.json",
      path.join("source-ir", "component-tree.json"),
      path.join("source-ir", "content-model.json"),
      path.join("source-ir", "layout-map.json"),
      path.join("source-ir", "style-profile.json"),
      path.join("source-ir", "style-tokens.json"),
      path.join("source-ir", "interaction-hints.json"),
      path.join("source-skeleton", "index.html"),
      path.join("source-skeleton", "critical.css"),
      path.join("source-skeleton", "source-skeleton-audit.json"),
      "reference.png",
    ]) {
      checks.push(
        await fileCheck(
          `source-package-${normalizePath(relative).replace(/[^a-z0-9]+/g, "-")}`,
          path.join(input.sourcePackageDir, relative),
          `source package includes ${relative}`,
        ),
      )
    }
  }

  if (input.templatePath && (await fileExists(input.templatePath))) {
    const template = await readOptionalText(input.templatePath)
    checks.push({
      id: "template-role-visual-baseline",
      passed:
        /\brole:\s*visual_baseline_input\b/i.test(template) ||
        /\bfrontend_project\.role=visual_baseline_input\b/i.test(template),
      message: "frontend-template reports frontend_project.role=visual_baseline_input",
      path: input.templatePath,
    })
    checks.push({
      id: "template-names-visual-root",
      passed: /visual-html-skeleton[\\/]+index\.html/i.test(template) || /visual-html-skeleton/i.test(template),
      message: "frontend-template names visual-html-skeleton entrypoints",
      path: input.templatePath,
    })
    checks.push({
      id: "template-records-visual-evidence",
      passed:
        /\bvisual-diff\b/i.test(template) || /\bwebpage_evaluate\b/i.test(template) || /\bscreenshot\b/i.test(template),
      message: "frontend-template decision log records rendered visual evidence",
      path: input.templatePath,
    })
  } else if (input.templatePath) {
    checks.push({
      id: "frontend-template",
      passed: false,
      message: "frontend-template.md is required for task-scoped workflow audit",
      path: input.templatePath,
    })
  }

  if (input.frontendDesignDir) {
    if (input.evidenceManifestPath) {
      checks.push(
        await fileCheck(
          "evidence-source-manifest",
          input.evidenceManifestPath,
          "frontend-design writes evidence-source-manifest.md",
        ),
      )
    }
    if (input.processTracePath) {
      checks.push(await fileCheck("process-trace", input.processTracePath, "frontend-design process trace exists"))
      if (await fileExists(input.processTracePath)) {
        const trace = await readOptionalText(input.processTracePath)
        checks.push({
          id: "trace-skeleton-tool",
          passed: /create_frontend_skeleton_project/i.test(trace),
          message: "process trace records create_frontend_skeleton_project",
          path: input.processTracePath,
        })
        checks.push({
          id: "trace-template-submit",
          passed: /submit_frontend_template/i.test(trace),
          message: "process trace records submit_frontend_template",
          path: input.processTracePath,
        })
        checks.push({
          id: "trace-region-outcome",
          passed: /record_frontend_replacement_result|record_frontend_region_selection|blocked|deferred/i.test(trace),
          message: "process trace records region restoration outcomes or explicit visual debt",
          path: input.processTracePath,
        })
      }
    }
    if (input.iterationStatePath) {
      checks.push(
        await fileCheck("iteration-state", input.iterationStatePath, "frontend-design iteration state exists"),
      )
      if (await fileExists(input.iterationStatePath)) {
        const state = await readOptionalText(input.iterationStatePath)
        checks.push({
          id: "iteration-state-debt-accounting",
          passed: /completed|blocked|deferred|remainingSourceDebt|remaining_source_debt/i.test(state),
          message: "iteration state includes completed/blocked/deferred or remaining source debt accounting",
          path: input.iterationStatePath,
        })
      }
    }
  }

  if (input.frontendResearchDir && (await dirExists(input.frontendResearchDir))) {
    await collectFrontendResearchChecks(input.frontendResearchDir, checks)
  }

  if (input.logDir && (await dirExists(input.logDir))) {
    const logText = await readSmallLogCorpus(input.logDir)
    checks.push({
      id: "logs-mention-skeleton-tool",
      passed: /create_frontend_skeleton_project/i.test(logText),
      message: "workflow logs mention create_frontend_skeleton_project",
      path: input.logDir,
    })
    checks.push({
      id: "logs-mention-template-submit",
      passed: /submit_frontend_template/i.test(logText),
      message: "workflow logs mention submit_frontend_template",
      path: input.logDir,
    })
  }
}

async function collectFrontendResearchChecks(
  frontendResearchDir: string,
  checks: HtmlSkeletonWorkflowCheckReport["checks"],
): Promise<void> {
  const files = await listLogFiles(frontendResearchDir)
  const bundle = files.find((file) => path.basename(file).toLowerCase() === "research-bundle.md")
  const evidence = files.find((file) => path.basename(file).toLowerCase() === "evidence.json")
  const citationMap = files.find((file) => path.basename(file).toLowerCase() === "citation-map.json")
  checks.push({
    id: "frontend-research-bundle",
    passed: Boolean(bundle),
    message: "frontend-research writes research-bundle.md",
    path: bundle ?? frontendResearchDir,
  })
  checks.push({
    id: "frontend-research-evidence",
    passed: Boolean(evidence),
    message: "frontend-research writes evidence.json",
    path: evidence ?? frontendResearchDir,
  })
  checks.push({
    id: "frontend-research-citation-map",
    passed: Boolean(citationMap),
    message: "frontend-research writes citation-map.json",
    path: citationMap ?? frontendResearchDir,
  })
  const corpus = await readSmallLogCorpus(frontendResearchDir)
  checks.push({
    id: "frontend-research-webpage-contract",
    passed: /\bwebpage_contract\b/i.test(corpus),
    message: "frontend-research report includes webpage_contract",
    path: frontendResearchDir,
  })
  checks.push({
    id: "frontend-research-reference-evidence",
    passed: /ev_webpage_reference_image|reference_image_evidence_ids|reference\.png/i.test(corpus),
    message: "frontend-research report references the webpage reference image evidence",
    path: frontendResearchDir,
  })
}

function repoRoot(): string {
  return path.resolve(import.meta.dir, "../../../..")
}

async function fileCheck(
  id: string,
  filePath: string,
  message: string,
): Promise<HtmlSkeletonWorkflowCheckReport["checks"][number]> {
  return {
    id,
    passed: await fileExists(filePath),
    message,
    path: filePath,
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  const stat = await fs.stat(filePath).catch(() => undefined)
  return stat?.isFile() === true
}

async function fileSize(filePath: string): Promise<number> {
  const stat = await fs.stat(filePath).catch(() => undefined)
  return stat?.isFile() ? stat.size : 0
}

async function dirExists(dirPath: string): Promise<boolean> {
  const stat = await fs.stat(dirPath).catch(() => undefined)
  return stat?.isDirectory() === true
}

async function hasBuildOutputIndex(root: string): Promise<boolean> {
  for (const dir of ["dist", "build", "out"]) {
    if (await fileExists(path.join(root, dir, "index.html"))) return true
  }
  return false
}

async function readOptionalText(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch {
    return ""
  }
}

function isReferenceImageOnly(html: string): boolean {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html
  const bodyWithoutTags = body
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
  const textLength = bodyWithoutTags.replace(/\s+/g, "").length
  const imageCount = (body.match(/<img\b/gi) ?? []).length
  return /\breference\.png\b/i.test(body) && imageCount <= 2 && textLength < 200
}

function inlineStyleBytes(html: string): number {
  return (html.match(/<style\b[\s\S]*?<\/style>/gi) ?? []).reduce((sum, block) => sum + block.length, 0)
}

function isRawSourceDomDump(html: string): boolean {
  const sourceNodeCount = (html.match(/\bdata-source-node-id=/gi) ?? []).length
  return (
    sourceNodeCount > 500 ||
    /\bsource-dom-page\b/i.test(html) ||
    /\bsinglefile-body\.html\b/i.test(html) ||
    /\bsource-skeleton\b/i.test(html)
  )
}

async function readSmallLogCorpus(root: string): Promise<string> {
  const files = await listLogFiles(root)
  const chunks: string[] = []
  for (const file of files.slice(0, 40)) {
    const stat = await fs.stat(file).catch(() => undefined)
    if (!stat?.isFile() || stat.size > 1_000_000) continue
    chunks.push(await readOptionalText(file))
  }
  return chunks.join("\n")
}

async function listLogFiles(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (out.length < 80) await walk(full)
      } else if (/\.(json|jsonl|log|md|txt)$/i.test(entry.name)) {
        out.push(full)
      }
    }
  }
  await walk(root)
  return out
}

function normalizePath(input: string): string {
  return input.replace(/\\/g, "/").toLowerCase()
}

async function main() {
  const report = await runHtmlSkeletonWorkflowCheck(parseHtmlSkeletonWorkflowCheckArgs())
  const visual = report.visualDiff
    ? ` ${summarizeVisualReport(report.visualDiff)}`
    : " visual-skipped"
  console.log(
    `[html-skeleton-workflow-check] ${report.passed ? "PASS" : "FAIL"}${visual} report=${path.join(report.outDir, "html-skeleton-workflow-report.json")}`,
  )
  process.exit(report.passed ? 0 : 1)
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(
      `[html-skeleton-workflow-check] error: ${err instanceof Error ? err.stack || err.message : String(err)}`,
    )
    process.exit(2)
  })
}
