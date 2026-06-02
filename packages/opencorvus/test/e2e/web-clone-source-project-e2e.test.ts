import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool/registry"
import { WebCloneGenerateSourceProjectTool } from "../../src/tool/web-clone-generate-source-project"
import { WebClonePrepareContextTool } from "../../src/tool/web-clone-prepare-context"
import { WebCloneSourceAuditTool } from "../../src/tool/web-clone-source-audit"

const runE2E = process.env.OPENCORVUS_RUN_WEB_CLONE_E2E === "1" || process.env.OPENCORVUS_RUN_WEB_CLONE_E2E === "true"
const e2eTest = runE2E ? test : test.skip
const repoRoot = path.resolve(import.meta.dir, "../../../..")
const defaultMirrorDir = path.join(repoRoot, ".tmp", "source-skeleton-tradingview-v2h", "mirror")
const mirrorDir = path.resolve(process.env.OPENCORVUS_WEB_CLONE_E2E_MIRROR ?? defaultMirrorDir)
const outputDir = path.resolve(process.env.OPENCORVUS_WEB_CLONE_E2E_OUTPUT ?? path.join(repoRoot, ".tmp", "opencorvus-web-clone-e2e-output"))
const threshold = normalizeVisualThreshold(Number(process.env.OPENCORVUS_WEB_CLONE_E2E_THRESHOLD ?? 96))
const worstThreshold = normalizeVisualThreshold(Number(process.env.OPENCORVUS_WEB_CLONE_E2E_WORST_THRESHOLD ?? 75))

const ctx = {
  sessionID: "test-web-clone-source-project-e2e",
  messageID: "message",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

interface BenchmarkProcessTrace {
  version: 1
  purpose: "web-clone-benchmark-process-trace"
  sourcePackageDir: string
  outputDir: string
  expectedFlow: string[]
  events: BenchmarkProcessEvent[]
  sourceProjectEvidence?: SourceProjectEvidence
  audits: {
    visualBaselineAllowed?: unknown
    maintainableReplacementRequired?: unknown
    visualDiff?: unknown
  }
  processAudit: {
    passed: boolean
    findings: string[]
  }
}

interface BenchmarkProcessEvent {
  step: string
  kind: "tool" | "command" | "inspection"
  name: string
  status: "started" | "passed" | "failed"
  timestamp: string
  details?: Record<string, unknown>
}

interface SourceProjectEvidence {
  sourceDomPageExists: boolean
  replacementPlanExists: boolean
  iterationStateExists: boolean
  sourceRegionsExists: boolean
  referenceImageExists: boolean
  sourceDomRegionFileCount: number
  semanticReplacementFileCount: number
}

describe("web clone source project E2E", () => {
  test("process trace rejects missing rawproject refinement evidence", () => {
    const trace = createBenchmarkProcessTrace({
      sourcePackageDir: "web-clone-source",
      outputDir: "frontend-design-skeleton",
    })
    recordTraceEvent(trace, {
      step: "prepare-source-context",
      kind: "tool",
      name: "web_clone_prepare_context",
      status: "passed",
    })

    const audit = evaluateBenchmarkProcessTrace(trace)

    expect(audit.passed).toBe(false)
    expect(audit.findings.join("\n")).toContain("create_frontend_skeleton_project")
    expect(audit.findings.join("\n")).toContain("frontend_design_source_edit")
    expect(audit.findings.join("\n")).toContain("sourceDomReplacementPlan.ts")
    expect(audit.findings.join("\n")).toContain("maintainable_replacement_required")
  })

  test("process trace records failed visual comparison as evidence instead of missing execution", () => {
    const trace = createBenchmarkProcessTrace({
      sourcePackageDir: "web-clone-source",
      outputDir: "frontend-design-skeleton",
    })
    trace.sourceProjectEvidence = {
      sourceDomPageExists: true,
      replacementPlanExists: true,
      iterationStateExists: true,
      sourceRegionsExists: true,
      referenceImageExists: true,
      sourceDomRegionFileCount: 0,
      semanticReplacementFileCount: 4,
    }
    for (const name of [
      "frontend_design_static_tool_surface",
      "web_clone_prepare_context",
      "create_frontend_skeleton_project",
      "source-project-sidecars",
      "frontend_design_region_selection",
      "frontend_design_source_edit",
      "bun install",
      "bun run build",
    ] as const) {
      recordTraceEvent(trace, {
        step: name,
        kind: name === "source-project-sidecars" || name === "frontend_design_static_tool_surface" || name === "frontend_design_region_selection" ? "inspection" : name.startsWith("bun") ? "command" : "tool",
        name,
        status: "passed",
      })
    }
    recordTraceEvent(trace, {
      step: "audit-visual-baseline",
      kind: "tool",
      name: "web_clone_source_audit",
      status: "passed",
      details: { finalDeliveryMode: "visual_baseline_allowed", passed: true },
    })
    recordTraceEvent(trace, {
      step: "audit-maintainable-replacement",
      kind: "tool",
      name: "web_clone_source_audit",
      status: "passed",
      details: { finalDeliveryMode: "maintainable_replacement_required", passed: true },
    })
    recordTraceEvent(trace, {
      step: "compare-rendered-reference",
      kind: "command",
      name: "visual-diff",
      status: "failed",
      details: { passed: false, mssim: 0.46 },
    })

    const audit = evaluateBenchmarkProcessTrace(trace)

    expect(audit.findings.join("\n")).not.toContain("Missing process event: visual-diff.")
  })

  test("process trace rejects host-only semantic replacements without frontend_design source edits", () => {
    const trace = createBenchmarkProcessTrace({
      sourcePackageDir: "web-clone-source",
      outputDir: "frontend-design-skeleton",
    })
    trace.sourceProjectEvidence = {
      sourceDomPageExists: true,
      replacementPlanExists: true,
      iterationStateExists: true,
      sourceRegionsExists: true,
      referenceImageExists: true,
      sourceDomRegionFileCount: 0,
      semanticReplacementFileCount: 3,
    }
    for (const name of ["web_clone_prepare_context", "web_clone_generate_source_project", "source-project-sidecars", "bun install", "bun run build", "visual-diff"] as const) {
      recordTraceEvent(trace, {
        step: name,
        kind: name === "source-project-sidecars" ? "inspection" : name.startsWith("bun") || name === "visual-diff" ? "command" : "tool",
        name,
        status: "passed",
      })
    }
    recordTraceEvent(trace, {
      step: "audit-maintainable-replacement",
      kind: "tool",
      name: "web_clone_source_audit",
      status: "passed",
      details: { finalDeliveryMode: "maintainable_replacement_required", passed: true },
    })

    const audit = evaluateBenchmarkProcessTrace(trace)

    expect(audit.passed).toBe(false)
    expect(audit.findings.join("\n")).toContain("frontend_design_source_edit")
    expect(audit.findings.join("\n")).toContain("create_frontend_skeleton_project")
  })

  e2eTest("runs the OpenCorvus tool chain and enforces the visual threshold", async () => {
    await assertDirectory(mirrorDir)
    await Instance.provide({
      directory: repoRoot,
      fn: async () => {
        const trace = createBenchmarkProcessTrace({ sourcePackageDir: mirrorDir, outputDir })
        const toolIds = await ToolRegistry.ids()
        expect(toolIds).toContain("web_clone_prepare_context")
        expect(toolIds).toContain("web_clone_generate_source_project")
        expect(toolIds).toContain("web_clone_source_audit")
        recordTraceEvent(trace, {
          step: "registry-tool-surface",
          kind: "inspection",
          name: "ToolRegistry.ids",
          status: "passed",
          details: {
            requiredTools: ["web_clone_prepare_context", "web_clone_generate_source_project", "web_clone_source_audit"],
          },
        })

        const prepareTool = await WebClonePrepareContextTool.init()
        const context = await prepareTool.execute({ mirrorDir }, ctx)
        expect(context.title).toBe("Web clone context prepared")
        recordTraceEvent(trace, {
          step: "prepare-source-context",
          kind: "tool",
          name: "web_clone_prepare_context",
          status: "passed",
          details: { mirrorDir, title: context.title },
        })

        const generateTool = await WebCloneGenerateSourceProjectTool.init()
        const generated = await generateTool.execute({ mirrorDir, outputDir, overwrite: true }, ctx)
        expect(generated.title).toBe("Web clone source project generated")
        recordTraceEvent(trace, {
          step: "materialize-source-project",
          kind: "tool",
          name: "web_clone_generate_source_project",
          status: "passed",
          details: {
            mirrorDir: generated.metadata.mirrorDir,
            outputDir: generated.metadata.outputDir,
            visualIterationMatrix: generated.metadata.visualIterationMatrix,
          },
        })
        trace.sourceProjectEvidence = await inspectSourceProjectEvidence(outputDir)
        recordTraceEvent(trace, {
          step: "inspect-source-project-sidecars",
          kind: "inspection",
          name: "source-project-sidecars",
          status: "passed",
          details: trace.sourceProjectEvidence,
        })

        await run("bun", ["install"], outputDir)
        recordTraceEvent(trace, {
          step: "install-source-project",
          kind: "command",
          name: "bun install",
          status: "passed",
          details: { cwd: outputDir },
        })
        await run("bun", ["run", "build"], outputDir)
        recordTraceEvent(trace, {
          step: "build-source-project",
          kind: "command",
          name: "bun run build",
          status: "passed",
          details: { cwd: outputDir },
        })

        const auditTool = await WebCloneSourceAuditTool.init()
        const audit = await auditTool.execute({
          projectDir: outputDir,
          sourcePackageDir: mirrorDir,
          outputPath: path.join(outputDir, "acceptance", "web-clone-source-skeleton-consumption-audit.json"),
        }, ctx)
        expect(audit.metadata.audit.passed).toBe(true)
        trace.audits.visualBaselineAllowed = audit.metadata.audit
        recordTraceEvent(trace, {
          step: "audit-visual-baseline",
          kind: "tool",
          name: "web_clone_source_audit",
          status: "passed",
          details: { finalDeliveryMode: "visual_baseline_allowed", passed: audit.metadata.audit.passed },
        })

        const acceptanceDir = path.join(outputDir, "acceptance")
        await fs.mkdir(acceptanceDir, { recursive: true })
        const maintainableAudit = await auditTool.execute({
          projectDir: outputDir,
          sourcePackageDir: mirrorDir,
          finalDeliveryMode: "maintainable_replacement_required",
          outputPath: path.join(acceptanceDir, "web-clone-source-maintainable-audit.json"),
        }, ctx)
        trace.audits.maintainableReplacementRequired = maintainableAudit.metadata.audit
        recordTraceEvent(trace, {
          step: "audit-maintainable-replacement",
          kind: "tool",
          name: "web_clone_source_audit",
          status: maintainableAudit.metadata.audit.passed ? "passed" : "failed",
          details: {
            finalDeliveryMode: "maintainable_replacement_required",
            passed: maintainableAudit.metadata.audit.passed,
            findings: maintainableAudit.metadata.audit.findings,
          },
        })
        const visualOutDir = path.join(acceptanceDir, "overlay-visual-diff")
        const visualExitCode = await runVisualDiffCli({
          renderedDir: outputDir,
          reference: path.join(mirrorDir, "reference.png"),
          outDir: visualOutDir,
          threshold,
          worstThreshold,
        })
        const visualReport = JSON.parse(await fs.readFile(path.join(visualOutDir, "diff.json"), "utf8"))
        trace.audits.visualDiff = visualReport
        recordTraceEvent(trace, {
          step: "compare-rendered-reference",
          kind: "command",
          name: "visual-diff",
          status: visualExitCode === 0 && visualReport.passed === true ? "passed" : "failed",
          details: {
            visualExitCode,
            passed: visualReport.passed,
            mssim: visualReport.mssim,
            threshold,
            worstThreshold,
          },
        })
        trace.processAudit = evaluateBenchmarkProcessTrace(trace)
        await fs.writeFile(path.join(acceptanceDir, "web-clone-benchmark-process-trace.json"), JSON.stringify(trace, null, 2), "utf8")
        const report = {
          version: 1,
          purpose: "web-clone-opencorvus-e2e",
          passed:
            visualExitCode === 0 &&
            visualReport.passed === true &&
            maintainableAudit.metadata.audit.passed === true &&
            trace.processAudit.passed === true,
          threshold,
          worstThreshold,
          mirrorDir,
          outputDir,
          processTrace: path.join(acceptanceDir, "web-clone-benchmark-process-trace.json"),
          visualBaselineAudit: audit.metadata.audit,
          maintainableAudit: maintainableAudit.metadata.audit,
          processAudit: trace.processAudit,
          overlayVisualDiff: visualReport,
        }
        await fs.writeFile(path.join(acceptanceDir, "opencorvus-web-clone-e2e.json"), JSON.stringify(report, null, 2), "utf8")
        expect(report.passed, JSON.stringify(report, null, 2)).toBe(true)
      },
    })
  }, 600_000)
})

function createBenchmarkProcessTrace(input: {
  sourcePackageDir: string
  outputDir: string
}): BenchmarkProcessTrace {
  return {
    version: 1,
    purpose: "web-clone-benchmark-process-trace",
    sourcePackageDir: input.sourcePackageDir,
    outputDir: input.outputDir,
    expectedFlow: [
      "frontend_design_static_tool_surface",
      "web_clone_prepare_context",
      "create_frontend_skeleton_project",
      "source-project-sidecars",
      "frontend_design_region_selection",
      "frontend_design_source_edit",
      "bun install",
      "bun run build",
      "web_clone_source_audit:visual_baseline_allowed",
      "web_clone_source_audit:maintainable_replacement_required",
      "visual-diff",
    ],
    events: [],
    audits: {},
    processAudit: {
      passed: false,
      findings: ["Process trace has not been evaluated yet."],
    },
  }
}

function recordTraceEvent(trace: BenchmarkProcessTrace, input: Omit<BenchmarkProcessEvent, "timestamp">): void {
  trace.events.push({
    ...input,
    timestamp: new Date().toISOString(),
  })
}

async function inspectSourceProjectEvidence(projectDir: string): Promise<SourceProjectEvidence> {
  const sourceDomDir = path.join(projectDir, "src", "components", "source-dom")
  const semanticDir = path.join(projectDir, "src", "components", "semantic")
  const [sourceDomRegionFileCount, semanticReplacementFileCount] = await Promise.all([
    countTsxFiles(sourceDomDir),
    countTsxFiles(semanticDir),
  ])
  return {
    sourceDomPageExists: await fileExists(path.join(projectDir, "src", "components", "SourceDomPage.tsx")),
    replacementPlanExists: await fileExists(path.join(projectDir, "src", "data", "sourceDomReplacementPlan.ts")),
    iterationStateExists: await fileExists(path.join(projectDir, "src", "data", "sourceDomIterationState.ts")),
    sourceRegionsExists: await fileExists(path.join(projectDir, "src", "data", "sourceDomRegions.ts")),
    referenceImageExists: await fileExists(path.join(projectDir, "reference.png")),
    sourceDomRegionFileCount,
    semanticReplacementFileCount,
  }
}

async function fileExists(file: string): Promise<boolean> {
  return (await fs.stat(file).catch(() => undefined))?.isFile() === true
}

async function countTsxFiles(dir: string): Promise<number> {
  const entries = await fs.readdir(dir).catch(() => [])
  return entries.filter((entry) => entry.endsWith(".tsx")).length
}

function evaluateBenchmarkProcessTrace(trace: BenchmarkProcessTrace): BenchmarkProcessTrace["processAudit"] {
  const findings: string[] = []
  const eventNames = trace.events.map((event) => event.name)
  const requiredNames = [
    "frontend_design_static_tool_surface",
    "web_clone_prepare_context",
    "create_frontend_skeleton_project",
    "source-project-sidecars",
    "frontend_design_region_selection",
    "frontend_design_source_edit",
    "bun install",
    "bun run build",
    "visual-diff",
  ]
  for (const name of requiredNames) {
    if (!eventNames.includes(name)) findings.push(`Missing process event: ${name}.`)
  }

  const visualBaselineAudit = trace.events.find((event) =>
    event.name === "web_clone_source_audit" &&
    event.details?.finalDeliveryMode === "visual_baseline_allowed" &&
    event.status === "passed"
  )
  if (!visualBaselineAudit) findings.push("Missing passing web_clone_source_audit event for visual_baseline_allowed.")

  const maintainableAudit = trace.events.find((event) =>
    event.name === "web_clone_source_audit" &&
    event.details?.finalDeliveryMode === "maintainable_replacement_required"
  )
  if (!maintainableAudit) findings.push("Missing web_clone_source_audit event for maintainable_replacement_required.")

  const evidence = trace.sourceProjectEvidence
  if (!evidence?.sourceDomPageExists) findings.push("Generated source project is missing SourceDomPage.tsx.")
  if (!evidence?.replacementPlanExists) findings.push("Generated source project is missing sourceDomReplacementPlan.ts.")
  if (!evidence?.iterationStateExists) findings.push("Generated source project is missing sourceDomIterationState.ts.")
  if (!evidence?.sourceRegionsExists) findings.push("Generated source project is missing sourceDomRegions.ts.")
  if (!evidence?.referenceImageExists) findings.push("Generated source project is missing reference.png.")
  if ((evidence?.semanticReplacementFileCount ?? 0) <= 0) {
    findings.push("Frontend-design source project has no semantic replacement components; rawproject refinement did not start.")
  }
  if ((evidence?.sourceDomRegionFileCount ?? 0) > 0) {
    findings.push("Frontend-design source project still contains generated source-dom regions; rawproject refinement is incomplete.")
  }

  const generateIndex = eventNames.indexOf("create_frontend_skeleton_project")
  const buildIndex = eventNames.indexOf("bun run build")
  if (generateIndex >= 0 && buildIndex >= 0 && buildIndex < generateIndex) {
    findings.push("Project build ran before create_frontend_skeleton_project materialized the rawproject baseline.")
  }

  const sourceEditIndex = eventNames.indexOf("frontend_design_source_edit")
  if (generateIndex >= 0 && sourceEditIndex >= 0 && sourceEditIndex < generateIndex) {
    findings.push("Frontend-design source edit ran before create_frontend_skeleton_project materialized the rawproject baseline.")
  }

  return {
    passed: findings.length === 0,
    findings,
  }
}

async function assertDirectory(dir: string): Promise<void> {
  const stat = await fs.stat(dir).catch(() => undefined)
  if (!stat?.isDirectory()) throw new Error(`web clone e2e mirror directory does not exist: ${dir}`)
}

function normalizeVisualThreshold(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0.96
  return value > 1 ? value / 100 : value
}

async function run(command: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", windowsHide: true })
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`))
    })
  })
}

async function runVisualDiffCli(input: {
  renderedDir: string
  reference: string
  outDir: string
  threshold: number
  worstThreshold: number
}): Promise<number> {
  await fs.mkdir(input.outDir, { recursive: true })
  return new Promise<number>((resolve, reject) => {
    const child = spawn("bun", [
      "run",
      path.join(repoRoot, "packages", "opencorvus", "script", "benchmark", "visual-diff.ts"),
      "--rendered-dir",
      input.renderedDir,
      "--reference",
      input.reference,
      "--out",
      input.outDir,
      "--threshold",
      String(input.threshold),
      "--worst-threshold",
      String(input.worstThreshold),
      "--headless",
      "--chrome-cli-fallback",
    ], { cwd: repoRoot, stdio: "inherit", windowsHide: true })
    child.on("error", reject)
    child.on("exit", (code) => resolve(code ?? 1))
  })
}
