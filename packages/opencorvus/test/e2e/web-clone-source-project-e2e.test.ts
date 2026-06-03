import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { Agent } from "../../src/agent/agent"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { FrontendDesignAgent } from "../../src/frontend-design/agent"
import { createFrontendSkeletonProjectTool } from "../../src/frontend-design/skeleton-project-tool"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
import { ToolRegistry } from "../../src/tool/registry"
import { WebClonePrepareContextTool } from "../../src/tool/web-clone-prepare-context"
import { WebCloneSourceAuditTool } from "../../src/tool/web-clone-source-audit"
import { loadBenchmarkEnv } from "../../script/benchmark/env"
import { taskIDForSession } from "../../src/orchestrator/task-event"

await loadBenchmarkEnv(import.meta.dir)

const runE2E = process.env.OPENCORVUS_RUN_WEB_CLONE_E2E === "1" || process.env.OPENCORVUS_RUN_WEB_CLONE_E2E === "true"
const runFrontendDesignAgentE2E = process.env.OPENCORVUS_RUN_FRONTEND_DESIGN_AGENT_E2E === "1" || process.env.OPENCORVUS_RUN_FRONTEND_DESIGN_AGENT_E2E === "true"
const e2eTest = runE2E ? test : test.skip
const repoRoot = path.resolve(import.meta.dir, "../../../..")
const defaultMirrorDir = path.join(repoRoot, ".tmp", "source-skeleton-tradingview-v2h", "mirror")
const mirrorDir = path.resolve(process.env.OPENCORVUS_WEB_CLONE_E2E_MIRROR ?? defaultMirrorDir)
const outputDir = path.resolve(process.env.OPENCORVUS_WEB_CLONE_E2E_OUTPUT ?? path.join(repoRoot, ".tmp", "opencorvus-web-clone-e2e-output"))
const frontendDesignBenchmarkTaskID = process.env.OPENCORVUS_FRONTEND_DESIGN_TASK_ID ?? `tsk_web_clone_frontend_design_e2e_${Date.now().toString(16)}`
const frontendDesignProjectDir = process.env.OPENCORVUS_FRONTEND_DESIGN_PROJECT_DIR ? path.resolve(process.env.OPENCORVUS_FRONTEND_DESIGN_PROJECT_DIR) : undefined
const frontendDesignProcessTracePath = process.env.OPENCORVUS_FRONTEND_DESIGN_PROCESS_TRACE ? path.resolve(process.env.OPENCORVUS_FRONTEND_DESIGN_PROCESS_TRACE) : undefined
const frontendDesignIterationStatePath = process.env.OPENCORVUS_FRONTEND_DESIGN_ITERATION_STATE ? path.resolve(process.env.OPENCORVUS_FRONTEND_DESIGN_ITERATION_STATE) : undefined
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
  frontendDesignIterationState?: FrontendDesignIterationState
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

interface FrontendDesignProcessTrace {
  version: 1
  purpose: "frontend-design-process-trace"
  events: Array<{
    name: string
    status: "started" | "passed" | "failed"
    timestamp: string
    details?: Record<string, unknown>
  }>
}

interface FrontendDesignIterationState {
  version: 1
  purpose: "frontend-design-rawproject-iteration-state"
  completedReplacements: Array<Record<string, unknown>>
  blockedReplacements: Array<Record<string, unknown>>
  deferredReplacements: Array<Record<string, unknown>>
  remainingSourceDebt: string[]
  lastUpdated: string
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
    expect(audit.findings.join("\n")).toContain("frontend_design_replacement_result")
    expect(audit.findings.join("\n")).toContain("frontend_design iteration state artifact")
    expect(audit.findings.join("\n")).toContain("frontend_design_region_selection")
    expect(audit.findings.join("\n")).toContain("maintainable_replacement_required")
  })

  test("process trace records failed visual comparison as evidence instead of missing execution", () => {
    const trace = createBenchmarkProcessTrace({
      sourcePackageDir: "web-clone-source",
      outputDir: "frontend-design-skeleton",
    })
    trace.sourceProjectEvidence = {
      sourceDomPageExists: false,
      replacementPlanExists: false,
      iterationStateExists: false,
      sourceRegionsExists: false,
      referenceImageExists: true,
      sourceDomRegionFileCount: 0,
      semanticReplacementFileCount: 4,
    }
    trace.frontendDesignIterationState = createCompletedFrontendDesignIterationState()
    for (const name of [
      "frontend_design_static_tool_surface",
      "web_clone_prepare_context",
      "create_frontend_skeleton_project",
      "source-project-sidecars",
      "frontend_design_region_selection",
      "frontend_design_source_edit",
      "frontend_design_replacement_result",
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
      details: { finalAcceptanceMode: "visual_baseline_allowed", passed: true },
    })
    recordTraceEvent(trace, {
      step: "audit-maintainable-replacement",
      kind: "tool",
      name: "web_clone_source_audit",
      status: "passed",
      details: { finalAcceptanceMode: "maintainable_replacement_required", passed: true },
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
      sourceDomPageExists: false,
      replacementPlanExists: false,
      iterationStateExists: false,
      sourceRegionsExists: false,
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
      details: { finalAcceptanceMode: "maintainable_replacement_required", passed: true },
    })

    const audit = evaluateBenchmarkProcessTrace(trace)

    expect(audit.passed).toBe(false)
    expect(audit.findings.join("\n")).toContain("frontend_design_source_edit")
    expect(audit.findings.join("\n")).toContain("create_frontend_skeleton_project")
  })

  test("process trace accepts merged frontend_design agent events", () => {
    const trace = createBenchmarkProcessTrace({
      sourcePackageDir: "web-clone-source",
      outputDir: "frontend-design-skeleton",
    })
    trace.sourceProjectEvidence = {
      sourceDomPageExists: false,
      replacementPlanExists: false,
      iterationStateExists: false,
      sourceRegionsExists: false,
      referenceImageExists: true,
      sourceDomRegionFileCount: 0,
      semanticReplacementFileCount: 4,
    }
    trace.frontendDesignIterationState = createCompletedFrontendDesignIterationState()
    mergeFrontendDesignProcessTrace(trace, {
      version: 1,
      purpose: "frontend-design-process-trace",
      events: [
        { name: "frontend_design_static_tool_surface", status: "passed", timestamp: new Date().toISOString() },
        { name: "create_frontend_skeleton_project", status: "passed", timestamp: new Date().toISOString() },
        { name: "frontend_design_region_selection", status: "passed", timestamp: new Date().toISOString() },
        { name: "frontend_design_source_edit", status: "passed", timestamp: new Date().toISOString() },
        { name: "frontend_design_replacement_result", status: "passed", timestamp: new Date().toISOString(), details: { replacementStatus: "completed", regionComponentName: "HeroRegion" } },
        { name: "bun install", status: "passed", timestamp: new Date().toISOString() },
        { name: "bun run build", status: "passed", timestamp: new Date().toISOString() },
        { name: "web_clone_source_audit", status: "passed", timestamp: new Date().toISOString(), details: { finalAcceptanceMode: "visual_baseline_allowed", passed: true } },
        { name: "web_clone_source_audit", status: "passed", timestamp: new Date().toISOString(), details: { finalAcceptanceMode: "maintainable_replacement_required", passed: true } },
      ],
    })
    recordTraceEvent(trace, {
      step: "prepare-source-context",
      kind: "tool",
      name: "web_clone_prepare_context",
      status: "passed",
    })
    recordTraceEvent(trace, {
      step: "inspect-source-project-sidecars",
      kind: "inspection",
      name: "source-project-sidecars",
      status: "passed",
    })
    recordTraceEvent(trace, {
      step: "compare-rendered-reference",
      kind: "command",
      name: "visual-diff",
      status: "passed",
      details: { passed: true, mssim: 0.93 },
    })

    const audit = evaluateBenchmarkProcessTrace(trace)

    expect(audit.passed).toBe(true)
  })

  test("process trace rejects remaining frontend_design source debt", () => {
    const trace = createBenchmarkProcessTrace({
      sourcePackageDir: "web-clone-source",
      outputDir: "frontend-design-skeleton",
    })
    trace.sourceProjectEvidence = {
      sourceDomPageExists: false,
      replacementPlanExists: false,
      iterationStateExists: false,
      sourceRegionsExists: false,
      referenceImageExists: true,
      sourceDomRegionFileCount: 0,
      semanticReplacementFileCount: 4,
    }
    trace.frontendDesignIterationState = {
      ...createCompletedFrontendDesignIterationState(),
      remainingSourceDebt: ["FaqRegion"],
    }
    mergeFrontendDesignProcessTrace(trace, createCompletedFrontendDesignProcessTrace())
    recordTraceEvent(trace, {
      step: "prepare-source-context",
      kind: "tool",
      name: "web_clone_prepare_context",
      status: "passed",
    })
    recordTraceEvent(trace, {
      step: "inspect-source-project-sidecars",
      kind: "inspection",
      name: "source-project-sidecars",
      status: "passed",
    })
    recordTraceEvent(trace, {
      step: "compare-rendered-reference",
      kind: "command",
      name: "visual-diff",
      status: "passed",
      details: { passed: true, mssim: 0.93 },
    })

    const audit = evaluateBenchmarkProcessTrace(trace)

    expect(audit.passed).toBe(false)
    expect(audit.findings.join("\n")).toContain("Frontend-design iteration state still has remaining source debt: FaqRegion.")
  })

  test("frontend_design agent benchmark request points at runtime source project boundaries", () => {
    const request = buildFrontendDesignAgentBenchmarkRequest({
      sourcePackageDir: ".opencorvus/runtime/tasks/tsk_test/frontend-design/web-clone-source",
      skeletonProjectDir: ".opencorvus/runtime/tasks/tsk_test/frontend-design/frontend-design-skeleton",
      targetProjectDir: ".opencorvus/runtime/tasks/tsk_test/frontend-design/frontend-design-target",
      mirrorDir: ".tmp/mirror",
    })

    expect(request).toContain("Call `create_frontend_skeleton_project`")
    expect(request).toContain("overwrite=true")
    expect(request).toContain(".opencorvus/runtime/tasks/tsk_test/frontend-design/web-clone-source")
    expect(request).toContain(".opencorvus/runtime/tasks/tsk_test/frontend-design/frontend-design-skeleton")
    expect(request).toContain(".opencorvus/runtime/tasks/tsk_test/frontend-design/frontend-design-target")
    expect(request).toContain("editing only the target acceptance project, not frontend-design-skeleton")
    expect(request).toContain("Do not run install/build/render/dev-server commands inside the skeleton evidence project")
    expect(request).toContain("Create or populate the target acceptance project before any runnable project command")
    expect(request).toContain("record_frontend_region_selection")
    expect(request).toContain("record_frontend_replacement_result")
    expect(request).toContain("frontend-design-process-trace.json")
    expect(request).toContain("frontend-design-iteration-state.json")
    expect(request).toContain("These files are written by frontend-design tools")
    expect(request).not.toContain("make those artifacts prove")
    expect(request).not.toContain("from scratch")
  })

  test("frontend_design benchmark task root owns child agent sessions", async () => {
    await Instance.provide({
      directory: repoRoot,
      fn: async () => {
        const taskID = `tsk_web_clone_frontend_design_parent_${Date.now().toString(16)}`
        const parentSessionID = await ensureFrontendDesignBenchmarkTask(taskID)
        const child = await Session.createNext({
          kind: "frontend-design",
          parentID: parentSessionID,
          title: "frontend-design benchmark child",
          directory: Instance.directory,
        })

        expect(taskIDForSession(child.id)).toBe(taskID)
      },
    })
  })

  e2eTest("runs the OpenCorvus tool chain and enforces the visual threshold", async () => {
    await assertDirectory(mirrorDir)
    if (frontendDesignProjectDir) await assertDirectory(frontendDesignProjectDir)
    if (frontendDesignProcessTracePath) await assertFile(frontendDesignProcessTracePath)
    if (frontendDesignIterationStatePath) await assertFile(frontendDesignIterationStatePath)
    await Instance.provide({
      directory: repoRoot,
      fn: async () => {
        const frontendDesignModel = runFrontendDesignAgentE2E
          ? await resolveFrontendDesignBenchmarkModel()
          : undefined
        const frontendDesignPaths = ProjectRuntimePaths.frontendDesignPaths(repoRoot, frontendDesignBenchmarkTaskID)
        const skeletonProjectDir = runFrontendDesignAgentE2E
          ? frontendDesignPaths.skeletonProjectAbsolute
          : frontendDesignProjectDir ?? outputDir
        const targetProjectDir = runFrontendDesignAgentE2E
          ? path.join(path.dirname(frontendDesignPaths.skeletonProjectAbsolute), "frontend-design-target")
          : frontendDesignProjectDir ?? outputDir
        const trace = createBenchmarkProcessTrace({ sourcePackageDir: mirrorDir, outputDir: targetProjectDir })
        const toolIds = await ToolRegistry.ids()
        expect(toolIds).toContain("web_clone_prepare_context")
        expect(toolIds).toContain("web_clone_source_audit")
        const frontendDesign = await Agent.get("frontend-design")
        const frontendDesignToolIds = new Set(frontendDesign?.tools?.include ?? [])
        expect(frontendDesignToolIds.has("create_frontend_skeleton_project")).toBe(true)
        expect(frontendDesignToolIds.has("record_frontend_region_selection")).toBe(true)
        recordTraceEvent(trace, {
          step: "registry-tool-surface",
          kind: "inspection",
          name: "frontend_design_static_tool_surface",
          status: "passed",
          details: {
            requiredTools: ["create_frontend_skeleton_project", "record_frontend_region_selection", "web_clone_source_audit"],
          },
        })

        const prepareTool = await WebClonePrepareContextTool.init()
        const context = await prepareTool.execute({
          mirrorDir,
          outputDir: runFrontendDesignAgentE2E ? frontendDesignPaths.sourcePackageAbsolute : undefined,
        }, ctx)
        expect(context.title).toBe("Web clone context prepared")
        recordTraceEvent(trace, {
          step: "prepare-source-context",
          kind: "tool",
          name: "web_clone_prepare_context",
          status: "passed",
          details: { mirrorDir, title: context.title },
        })

        if (runFrontendDesignAgentE2E) {
          await resetFrontendDesignBenchmarkSkeletonDir(frontendDesignPaths.skeletonProjectAbsolute)
          await resetFrontendDesignBenchmarkTargetDir(targetProjectDir)
          const frontendDesignParentSessionID = await ensureFrontendDesignBenchmarkTask(frontendDesignBenchmarkTaskID)
          const parsedModel = Provider.parseModel(frontendDesignModel!)
          const analysis = await FrontendDesignAgent.analyze({
            title: "Web clone rawproject refinement benchmark",
            request: buildFrontendDesignAgentBenchmarkRequest({
              sourcePackageDir: context.metadata.sourcePackageDir,
              skeletonProjectDir,
              targetProjectDir,
              mirrorDir,
            }),
            taskID: frontendDesignBenchmarkTaskID,
            parentSessionID: frontendDesignParentSessionID,
            model: { providerID: parsedModel.providerID, modelID: parsedModel.modelID },
          })
          expect(analysis.processTraceArtifact).toBeTruthy()
          expect(analysis.iterationStateArtifact).toBeTruthy()
          mergeFrontendDesignProcessTrace(trace, await readFrontendDesignProcessTrace(analysis.processTraceArtifact!))
          trace.frontendDesignIterationState = await readFrontendDesignIterationState(analysis.iterationStateArtifact!)
        }
        if (frontendDesignProcessTracePath) {
          mergeFrontendDesignProcessTrace(trace, await readFrontendDesignProcessTrace(frontendDesignProcessTracePath))
        }
        if (frontendDesignIterationStatePath) {
          trace.frontendDesignIterationState = await readFrontendDesignIterationState(frontendDesignIterationStatePath)
        }
        if (!frontendDesignProjectDir && !runFrontendDesignAgentE2E) {
          const skeletonTrace = createFrontendSkeletonProjectTool({
            onToolEvent: (event) => recordTraceEvent(trace, {
              step: event.name,
              kind: "tool",
              name: event.name,
              status: event.status,
              details: event.details,
            }),
          })
          const created = await (skeletonTrace.create_frontend_skeleton_project as any).execute({
            sourcePackageDir: context.metadata.sourcePackageDir,
            outputDir: skeletonProjectDir,
            overwrite: true,
          })
          expect(created.title).toBe("Frontend source skeleton project created")
        }
        trace.sourceProjectEvidence = await inspectSourceProjectEvidence(targetProjectDir)
        recordTraceEvent(trace, {
          step: "inspect-source-project-sidecars",
          kind: "inspection",
          name: "source-project-sidecars",
          status: "passed",
          details: trace.sourceProjectEvidence,
        })

        await run("bun", ["install"], targetProjectDir)
        recordTraceEvent(trace, {
          step: "install-source-project",
          kind: "command",
          name: "bun install",
          status: "passed",
          details: { cwd: targetProjectDir },
        })
        await run("bun", ["run", "build"], targetProjectDir)
        recordTraceEvent(trace, {
          step: "build-source-project",
          kind: "command",
          name: "bun run build",
          status: "passed",
          details: { cwd: targetProjectDir },
        })

        const auditTool = await WebCloneSourceAuditTool.init()
        const audit = await auditTool.execute({
          projectDir: targetProjectDir,
          sourcePackageDir: context.metadata.sourcePackageDir,
          outputPath: path.join(targetProjectDir, "acceptance", "web-clone-source-skeleton-consumption-audit.json"),
        }, ctx)
        expect(audit.metadata.audit.passed).toBe(true)
        trace.audits.visualBaselineAllowed = audit.metadata.audit
        recordTraceEvent(trace, {
          step: "audit-visual-baseline",
          kind: "tool",
          name: "web_clone_source_audit",
          status: "passed",
          details: { finalAcceptanceMode: "visual_baseline_allowed", passed: audit.metadata.audit.passed },
        })

        const acceptanceDir = path.join(targetProjectDir, "acceptance")
        await fs.mkdir(acceptanceDir, { recursive: true })
        const maintainableAudit = await auditTool.execute({
          projectDir: targetProjectDir,
          sourcePackageDir: context.metadata.sourcePackageDir,
          finalAcceptanceMode: "maintainable_replacement_required",
          outputPath: path.join(acceptanceDir, "web-clone-source-maintainable-audit.json"),
        }, ctx)
        trace.audits.maintainableReplacementRequired = maintainableAudit.metadata.audit
        recordTraceEvent(trace, {
          step: "audit-maintainable-replacement",
          kind: "tool",
          name: "web_clone_source_audit",
          status: maintainableAudit.metadata.audit.passed ? "passed" : "failed",
          details: {
            finalAcceptanceMode: "maintainable_replacement_required",
            passed: maintainableAudit.metadata.audit.passed,
            findings: maintainableAudit.metadata.audit.findings,
          },
        })
        const visualOutDir = path.join(acceptanceDir, "overlay-visual-diff")
        const visualExitCode = await runVisualDiffCli({
          renderedDir: targetProjectDir,
          reference: path.join(context.metadata.sourcePackageDir, "reference.png"),
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
          outputDir: targetProjectDir,
          skeletonProjectDir,
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
      "frontend_design_replacement_result",
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

function buildFrontendDesignAgentBenchmarkRequest(input: {
  sourcePackageDir: string
  skeletonProjectDir: string
  targetProjectDir: string
  mirrorDir: string
}): string {
  return [
    "Run the frontend-design rawproject refinement benchmark for the prepared webpage clone source package.",
    "",
    `Mirror evidence: ${input.mirrorDir}`,
    `Prepared web-clone-source package: ${input.sourcePackageDir}`,
    `Frontend-design skeleton evidence project: ${input.skeletonProjectDir}`,
    `Frontend-design target acceptance project: ${input.targetProjectDir}`,
    "",
    "Call `create_frontend_skeleton_project` with that source package, the skeleton evidence project path, and overwrite=true.",
    "Then inspect skeleton sourceDomIterationState.ts, sourceDomReplacementPlan.ts, sourceDomRegions.ts, sourceData.ts, assets, and generated page/components as evidence only.",
    "Do not run install/build/render/dev-server commands inside the skeleton evidence project.",
    "Create or populate the target acceptance project before any runnable project command.",
    "Use normal frontend-design source-edit tools to extract generated source-dom/rawcode evidence into the target acceptance project as semantic project-owned components, extracted mock/API data modules, and scoped styles while preserving visual parity.",
    "Before each replacement, call `record_frontend_region_selection`; after each replacement attempt, call `record_frontend_replacement_result` with completed/blocked/deferred status and exact remaining source debt.",
    "Run build plus web_clone_source_audit in maintainable_replacement_required mode on the target acceptance project before claiming completion.",
    "The benchmark consumes frontend-design-process-trace.json and frontend-design-iteration-state.json. These files are written by frontend-design tools from your normal tool calls; do not edit them directly. Make the normal agent work visible by calling the region-selection/replacement tools and editing only the target acceptance project, not frontend-design-skeleton.",
  ].join("\n")
}

async function resetFrontendDesignBenchmarkSkeletonDir(projectDir: string): Promise<void> {
  const runtimeTasksRoot = path.resolve(repoRoot, ".opencorvus", "runtime", "tasks")
  const target = path.resolve(projectDir)
  const relative = path.relative(runtimeTasksRoot, target)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to reset frontend-design benchmark project outside runtime tasks: ${target}`)
  }
  await fs.rm(target, { recursive: true, force: true })
}

async function resetFrontendDesignBenchmarkTargetDir(projectDir: string): Promise<void> {
  const runtimeTasksRoot = path.resolve(repoRoot, ".opencorvus", "runtime", "tasks")
  const target = path.resolve(projectDir)
  const relative = path.relative(runtimeTasksRoot, target)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to reset frontend-design benchmark target outside runtime tasks: ${projectDir}`)
  }
  await fs.rm(target, { recursive: true, force: true })
}

async function ensureFrontendDesignBenchmarkTask(taskID: string): Promise<string> {
  const rootSession = await Session.create({ kind: "root", title: "frontend-design benchmark root" })
  const now = Date.now()
  Database.use((db) =>
    db.insert(EngineTaskTable).values({
      id: taskID,
      project_id: Instance.project.id,
      session_id: rootSession.id,
      source: "test",
      title: "frontend-design rawproject benchmark",
      request: "Refine the prepared web-clone-source package into a maintainable frontend-design source project.",
      priority: "normal",
      time_created: now,
      time_updated: now,
      time_started: now,
    }).run(),
  )
  return rootSession.id
}

async function resolveFrontendDesignBenchmarkModel(): Promise<string> {
  const providers = await Provider.list()
  const explicit = firstEnv("OPENCORVUS_FRONTEND_DESIGN_E2E_MODEL", "OPENCORVUS_DESIGN_TEST_MODEL", "OPENCORVUS_E2E_MODEL")
  const model = explicit
    ? resolveModelRefFromProviders(providers, explicit)
    : resolvePreferredFrontendDesignModel(providers)
  const parsed = Provider.parseModel(model)
  const resolved = await Provider.getModel(parsed.providerID, parsed.modelID)
  await Provider.getLanguage(resolved)
  return model
}

function firstEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return undefined
}

function resolveModelRefFromProviders(
  providers: Awaited<ReturnType<typeof Provider.list>>,
  input: string,
): string {
  if (input.includes("/")) {
    return input
  }
  for (const providerID of ["hexin", "moonshotai-cn", "moonshotai", "kimik26", "glm51", "huggingface"]) {
    if (providers[providerID]?.models[input]) return `${providerID}/${input}`
  }
  throw new Error(`frontend-design benchmark model not found in current project: ${input}`)
}

function resolvePreferredFrontendDesignModel(providers: Awaited<ReturnType<typeof Provider.list>>): string {
  for (const [providerID, modelID] of [
    ["glm51", "glm51"],
    ["hexin", "kimi-k2.5"],
    ["hexin", "glm-5.1"],
    ["kimik26", "kimik26"],
    ["moonshotai-cn", "kimi-k2.5"],
    ["moonshotai", "kimi-k2.5"],
  ] as const) {
    if (providers[providerID]?.models[modelID]) return `${providerID}/${modelID}`
  }
  for (const [providerID, provider] of Object.entries(providers)) {
    const [modelID] = Object.keys(provider.models)
    if (modelID) return `${providerID}/${modelID}`
  }
  throw new Error("No frontend-design benchmark model is available in the current project.")
}

function createCompletedFrontendDesignIterationState(): FrontendDesignIterationState {
  return {
    version: 1,
    purpose: "frontend-design-rawproject-iteration-state",
    completedReplacements: [
      {
        regionComponentName: "HeroRegion",
        replacementStatus: "completed",
        replacementComponentName: "HeroSection",
      },
    ],
    blockedReplacements: [],
    deferredReplacements: [],
    remainingSourceDebt: [],
    lastUpdated: new Date().toISOString(),
  }
}

function createCompletedFrontendDesignProcessTrace(): FrontendDesignProcessTrace {
  return {
    version: 1,
    purpose: "frontend-design-process-trace",
    events: [
      { name: "frontend_design_static_tool_surface", status: "passed", timestamp: new Date().toISOString() },
      { name: "create_frontend_skeleton_project", status: "passed", timestamp: new Date().toISOString() },
      { name: "frontend_design_region_selection", status: "passed", timestamp: new Date().toISOString() },
      { name: "frontend_design_source_edit", status: "passed", timestamp: new Date().toISOString() },
      { name: "frontend_design_replacement_result", status: "passed", timestamp: new Date().toISOString(), details: { replacementStatus: "completed", regionComponentName: "HeroRegion" } },
      { name: "bun install", status: "passed", timestamp: new Date().toISOString() },
      { name: "bun run build", status: "passed", timestamp: new Date().toISOString() },
      { name: "web_clone_source_audit", status: "passed", timestamp: new Date().toISOString(), details: { finalAcceptanceMode: "visual_baseline_allowed", passed: true } },
      { name: "web_clone_source_audit", status: "passed", timestamp: new Date().toISOString(), details: { finalAcceptanceMode: "maintainable_replacement_required", passed: true } },
    ],
  }
}

function recordTraceEvent(trace: BenchmarkProcessTrace, input: Omit<BenchmarkProcessEvent, "timestamp">): void {
  trace.events.push({
    ...input,
    timestamp: new Date().toISOString(),
  })
}

async function readFrontendDesignProcessTrace(file: string): Promise<FrontendDesignProcessTrace> {
  const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Partial<FrontendDesignProcessTrace>
  if (parsed.version !== 1 || parsed.purpose !== "frontend-design-process-trace" || !Array.isArray(parsed.events)) {
    throw new Error(`Invalid frontend_design process trace: ${file}`)
  }
  return parsed as FrontendDesignProcessTrace
}

async function readFrontendDesignIterationState(file: string): Promise<FrontendDesignIterationState> {
  const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Partial<FrontendDesignIterationState>
  if (
    parsed.version !== 1 ||
    parsed.purpose !== "frontend-design-rawproject-iteration-state" ||
    !Array.isArray(parsed.completedReplacements) ||
    !Array.isArray(parsed.blockedReplacements) ||
    !Array.isArray(parsed.deferredReplacements) ||
    !Array.isArray(parsed.remainingSourceDebt) ||
    typeof parsed.lastUpdated !== "string"
  ) {
    throw new Error(`Invalid frontend_design iteration state: ${file}`)
  }
  return parsed as FrontendDesignIterationState
}

function mergeFrontendDesignProcessTrace(trace: BenchmarkProcessTrace, frontendTrace: FrontendDesignProcessTrace): void {
  for (const event of frontendTrace.events) {
    recordTraceEvent(trace, {
      step: event.name,
      kind: frontendDesignEventKind(event.name),
      name: event.name,
      status: event.status,
      details: event.details,
    })
  }
}

function frontendDesignEventKind(name: string): BenchmarkProcessEvent["kind"] {
  if (
    name === "frontend_design_static_tool_surface" ||
    name === "frontend_design_region_selection" ||
    name === "source-project-sidecars"
  ) {
    return "inspection"
  }
  if (name === "bun install" || name === "bun run build" || name === "visual-diff") return "command"
  return "tool"
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
    "frontend_design_replacement_result",
    "bun install",
    "bun run build",
    "visual-diff",
  ]
  for (const name of requiredNames) {
    if (!eventNames.includes(name)) findings.push(`Missing process event: ${name}.`)
  }

  const visualBaselineAudit = trace.events.find((event) =>
    event.name === "web_clone_source_audit" &&
    event.details?.finalAcceptanceMode === "visual_baseline_allowed" &&
    event.status === "passed"
  )
  if (!visualBaselineAudit) findings.push("Missing passing web_clone_source_audit event for visual_baseline_allowed.")

  const maintainableAudit = trace.events.find((event) =>
    event.name === "web_clone_source_audit" &&
    event.details?.finalAcceptanceMode === "maintainable_replacement_required"
  )
  if (!maintainableAudit) findings.push("Missing web_clone_source_audit event for maintainable_replacement_required.")

  const evidence = trace.sourceProjectEvidence
  if (!evidence?.referenceImageExists) findings.push("Generated source project is missing reference.png.")
  if ((evidence?.semanticReplacementFileCount ?? 0) <= 0) {
    findings.push("Frontend-design source project has no semantic replacement components; rawproject refinement did not start.")
  }
  if (evidence?.sourceDomPageExists) {
    findings.push("Final target project still contains SourceDomPage.tsx; skeleton rawcode must be extracted into semantic target-project source, not delivered.")
  }
  if (evidence?.replacementPlanExists) {
    findings.push("Final target project still contains sourceDomReplacementPlan.ts; this skeleton planning sidecar must not remain in app source.")
  }
  if (evidence?.iterationStateExists) {
    findings.push("Final target project still contains sourceDomIterationState.ts; frontend_design iteration state belongs in the process artifact, not app source.")
  }
  if (evidence?.sourceRegionsExists) {
    findings.push("Final target project still contains sourceDomRegions.ts; source-region metrics are skeleton evidence, not app source.")
  }
  if ((evidence?.sourceDomRegionFileCount ?? 0) > 0) {
    findings.push("Frontend-design source project still contains generated source-dom regions; rawproject refinement is incomplete.")
  }

  const iterationState = trace.frontendDesignIterationState
  if (!iterationState) {
    findings.push("Missing frontend_design iteration state artifact.")
  } else {
    if (iterationState.completedReplacements.length <= 0) {
      findings.push("Frontend-design iteration state has no completed replacements.")
    }
    if (iterationState.remainingSourceDebt.length > 0) {
      findings.push(`Frontend-design iteration state still has remaining source debt: ${iterationState.remainingSourceDebt.join(", ")}.`)
    }
    if (iterationState.blockedReplacements.length > 0) {
      findings.push(`Frontend-design iteration state still has blocked replacements: ${iterationState.blockedReplacements.length}.`)
    }
    if (iterationState.deferredReplacements.length > 0) {
      findings.push(`Frontend-design iteration state still has deferred replacements: ${iterationState.deferredReplacements.length}.`)
    }
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

async function assertFile(file: string): Promise<void> {
  const stat = await fs.stat(file).catch(() => undefined)
  if (!stat?.isFile()) throw new Error(`web clone e2e file does not exist: ${file}`)
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
