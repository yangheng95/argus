import { describe, expect, test } from "bun:test"
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
import { loadBenchmarkEnv } from "../../script/benchmark/env"
import { runHtmlSkeletonWorkflowCheck } from "../../script/benchmark/html-skeleton-workflow-check"
import { taskIDForSession } from "../../src/orchestrator/task-event"

await loadBenchmarkEnv(import.meta.dir)

const runE2E = process.env.OPENCORVUS_RUN_WEB_CLONE_E2E === "1" || process.env.OPENCORVUS_RUN_WEB_CLONE_E2E === "true"
const runFrontendDesignAgentE2E =
  process.env.OPENCORVUS_RUN_FRONTEND_DESIGN_AGENT_E2E === "1" ||
  process.env.OPENCORVUS_RUN_FRONTEND_DESIGN_AGENT_E2E === "true"
const e2eTest = runE2E ? test : test.skip
const repoRoot = path.resolve(import.meta.dir, "../../../..")
const defaultWebpageEvidenceDir = path.join(repoRoot, ".tmp", "source-skeleton-tradingview-v2h", "webpage-evidence")
const webpageEvidenceDir = path.resolve(
  process.env.OPENCORVUS_WEB_CLONE_E2E_WEBPAGE_EVIDENCE ?? defaultWebpageEvidenceDir,
)
const outputDir = path.resolve(
  process.env.OPENCORVUS_WEB_CLONE_E2E_OUTPUT ?? path.join(repoRoot, ".tmp", "opencorvus-web-clone-e2e-output"),
)
const frontendDesignBenchmarkTaskID =
  process.env.OPENCORVUS_FRONTEND_DESIGN_TASK_ID ?? `tsk_web_clone_frontend_design_e2e_${Date.now().toString(16)}`
const frontendDesignProjectDir = process.env.OPENCORVUS_FRONTEND_DESIGN_PROJECT_DIR
  ? path.resolve(process.env.OPENCORVUS_FRONTEND_DESIGN_PROJECT_DIR)
  : undefined
const frontendDesignProcessTracePath = process.env.OPENCORVUS_FRONTEND_DESIGN_PROCESS_TRACE
  ? path.resolve(process.env.OPENCORVUS_FRONTEND_DESIGN_PROCESS_TRACE)
  : undefined
const frontendDesignIterationStatePath = process.env.OPENCORVUS_FRONTEND_DESIGN_ITERATION_STATE
  ? path.resolve(process.env.OPENCORVUS_FRONTEND_DESIGN_ITERATION_STATE)
  : undefined
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
  visualSkeletonEvidence?: VisualSkeletonEvidence
  frontendDesignIterationState?: FrontendDesignIterationState
  audits: {
    htmlSkeletonWorkflow?: unknown
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

interface VisualSkeletonEvidence {
  indexHtmlExists: boolean
  tokenCssExists: boolean
  externalCssLinked: boolean
  frameworkEntryPresent: boolean
  buildOutputPresent: boolean
  rawSourceDomDumpPresent: boolean
  referenceImageExists: boolean
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
    expect(audit.findings.join("\n")).toContain("html-skeleton-workflow-check")
  })

  test("process trace records failed visual comparison as evidence instead of missing execution", () => {
    const trace = createBenchmarkProcessTrace({
      sourcePackageDir: "web-clone-source",
      outputDir: "frontend-design-skeleton",
    })
    trace.visualSkeletonEvidence = {
      indexHtmlExists: true,
      tokenCssExists: true,
      externalCssLinked: true,
      frameworkEntryPresent: false,
      buildOutputPresent: false,
      rawSourceDomDumpPresent: false,
      referenceImageExists: true,
    }
    trace.frontendDesignIterationState = createCompletedFrontendDesignIterationState()
    for (const name of [
      "frontend_design_static_tool_surface",
      "web_clone_prepare_context",
      "create_frontend_skeleton_project",
      "source-project-sidecars",
      "visual-skeleton-artifacts",
      "frontend_design_region_selection",
      "frontend_design_source_edit",
      "frontend_design_replacement_result",
    ] as const) {
      recordTraceEvent(trace, {
        step: name,
        kind:
          name === "source-project-sidecars" ||
          name === "visual-skeleton-artifacts" ||
          name === "frontend_design_static_tool_surface" ||
          name === "frontend_design_region_selection"
            ? "inspection"
            : "tool",
        name,
        status: "passed",
      })
    }
    recordTraceEvent(trace, {
      step: "html-skeleton-workflow-check",
      kind: "command",
      name: "html-skeleton-workflow-check",
      status: "failed",
      details: { passed: false, mssim: 0.46 },
    })

    const audit = evaluateBenchmarkProcessTrace(trace)

    expect(audit.findings.join("\n")).not.toContain("Missing process event: html-skeleton-workflow-check.")
  })

  test("process trace rejects host-only skeleton evidence without frontend_design HTML edits", () => {
    const trace = createBenchmarkProcessTrace({
      sourcePackageDir: "web-clone-source",
      outputDir: "frontend-design-skeleton",
    })
    trace.visualSkeletonEvidence = {
      indexHtmlExists: true,
      tokenCssExists: true,
      externalCssLinked: true,
      frameworkEntryPresent: false,
      buildOutputPresent: false,
      rawSourceDomDumpPresent: false,
      referenceImageExists: true,
    }
    for (const name of [
      "web_clone_prepare_context",
      "create_frontend_skeleton_project",
      "source-project-sidecars",
      "visual-skeleton-artifacts",
      "html-skeleton-workflow-check",
    ] as const) {
      const details = name === "html-skeleton-workflow-check" ? { passed: true, mssim: 0.96 } : undefined
      recordTraceEvent(trace, {
        step: name,
        kind:
          name === "source-project-sidecars" || name === "visual-skeleton-artifacts"
            ? "inspection"
            : name === "html-skeleton-workflow-check"
              ? "command"
              : "tool",
        name,
        status: "passed",
        ...(details ? { details } : {}),
      })
    }

    const audit = evaluateBenchmarkProcessTrace(trace)

    expect(audit.passed).toBe(false)
    expect(audit.findings.join("\n")).toContain("frontend_design_source_edit")
  })

  test("process trace accepts merged frontend_design agent events", () => {
    const trace = createBenchmarkProcessTrace({
      sourcePackageDir: "web-clone-source",
      outputDir: "frontend-design-skeleton",
    })
    trace.visualSkeletonEvidence = {
      indexHtmlExists: true,
      tokenCssExists: true,
      externalCssLinked: true,
      frameworkEntryPresent: false,
      buildOutputPresent: false,
      rawSourceDomDumpPresent: false,
      referenceImageExists: true,
    }
    trace.frontendDesignIterationState = createCompletedFrontendDesignIterationState()
    mergeFrontendDesignProcessTrace(trace, {
      version: 1,
      purpose: "frontend-design-process-trace",
      events: [
        { name: "frontend_design_static_tool_surface", status: "passed", timestamp: new Date().toISOString() },
        { name: "create_frontend_skeleton_project", status: "passed", timestamp: new Date().toISOString() },
        { name: "source-project-sidecars", status: "passed", timestamp: new Date().toISOString() },
        { name: "frontend_design_region_selection", status: "passed", timestamp: new Date().toISOString() },
        { name: "frontend_design_source_edit", status: "passed", timestamp: new Date().toISOString() },
        {
          name: "frontend_design_replacement_result",
          status: "passed",
          timestamp: new Date().toISOString(),
          details: { replacementStatus: "completed", regionComponentName: "HeroRegion" },
        },
        { name: "visual-skeleton-artifacts", status: "passed", timestamp: new Date().toISOString() },
        {
          name: "html-skeleton-workflow-check",
          status: "passed",
          timestamp: new Date().toISOString(),
          details: { passed: true, mssim: 0.96 },
        },
      ],
    })
    recordTraceEvent(trace, {
      step: "prepare-source-context",
      kind: "tool",
      name: "web_clone_prepare_context",
      status: "passed",
    })
    recordTraceEvent(trace, {
      step: "inspect-visual-skeleton-artifacts",
      kind: "inspection",
      name: "visual-skeleton-artifacts",
      status: "passed",
    })

    const audit = evaluateBenchmarkProcessTrace(trace)

    expect(audit.passed).toBe(true)
  })

  test("process trace rejects remaining frontend_design source debt", () => {
    const trace = createBenchmarkProcessTrace({
      sourcePackageDir: "web-clone-source",
      outputDir: "frontend-design-skeleton",
    })
    trace.visualSkeletonEvidence = {
      indexHtmlExists: true,
      tokenCssExists: true,
      externalCssLinked: true,
      frameworkEntryPresent: false,
      buildOutputPresent: false,
      rawSourceDomDumpPresent: false,
      referenceImageExists: true,
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
      step: "inspect-visual-skeleton-artifacts",
      kind: "inspection",
      name: "visual-skeleton-artifacts",
      status: "passed",
    })

    const audit = evaluateBenchmarkProcessTrace(trace)

    expect(audit.passed).toBe(false)
    expect(audit.findings.join("\n")).toContain(
      "Frontend-design iteration state still has remaining source debt: FaqRegion.",
    )
  })

  test("frontend_design agent benchmark request points at visual HTML skeleton boundaries", () => {
    const request = buildFrontendDesignAgentBenchmarkRequest({
      sourcePackageDir: ".opencorvus/runtime/tasks/tsk_test/frontend-design/web-clone-source",
      skeletonProjectDir: ".opencorvus/runtime/tasks/tsk_test/frontend-design/frontend-design-skeleton",
      targetProjectDir: ".opencorvus/runtime/tasks/tsk_test/frontend-design/visual-html-skeleton",
      webpageEvidenceDir: ".tmp/webpage-evidence",
    })

    expect(request).toContain("Call `create_frontend_skeleton_project`")
    expect(request).toContain("overwrite=true")
    expect(request).toContain(".opencorvus/runtime/tasks/tsk_test/frontend-design/web-clone-source")
    expect(request).toContain(".opencorvus/runtime/tasks/tsk_test/frontend-design/frontend-design-skeleton")
    expect(request).toContain(".opencorvus/runtime/tasks/tsk_test/frontend-design/visual-html-skeleton")
    expect(request).toContain("source-editable static HTML/CSS visual skeleton")
    expect(request).toContain("visual-html-skeleton/index.html")
    expect(request).toContain("visual-html-skeleton/styles/tokens.css")
    expect(request).toContain("editing only the visual HTML skeleton, not frontend-design-skeleton")
    expect(request).toContain(
      "Do not run install/build/dev-server commands inside the skeleton evidence project or the visual HTML skeleton",
    )
    expect(request).toContain("Create or populate the visual HTML skeleton before any visual comparison")
    expect(request).toContain("final_acceptance_mode=visual_baseline_allowed")
    expect(request).toContain("frontend_project.role=visual_baseline_input")
    expect(request).toContain("record_frontend_region_selection")
    expect(request).toContain("record_frontend_replacement_result")
    expect(request).toContain("frontend-design-process-trace.json")
    expect(request).toContain("frontend-design-iteration-state.json")
    expect(request).toContain("These files are written by frontend-design tools")
    expect(request).not.toContain("target acceptance project")
    expect(request).not.toContain("maintainable_replacement_required")
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

  e2eTest(
    "runs the OpenCorvus tool chain and enforces the visual threshold",
    async () => {
      await assertDirectory(webpageEvidenceDir)
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
            : (frontendDesignProjectDir ?? outputDir)
          const targetProjectDir = runFrontendDesignAgentE2E
            ? path.join(path.dirname(frontendDesignPaths.skeletonProjectAbsolute), "visual-html-skeleton")
            : (frontendDesignProjectDir ?? outputDir)
          const trace = createBenchmarkProcessTrace({
            sourcePackageDir: webpageEvidenceDir,
            outputDir: targetProjectDir,
          })
          const toolIds = await ToolRegistry.ids()
          expect(toolIds).toContain("web_clone_prepare_context")
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
              requiredTools: ["create_frontend_skeleton_project", "record_frontend_region_selection"],
            },
          })

          const prepareTool = await WebClonePrepareContextTool.init()
          const context = await prepareTool.execute(
            {
              webpageEvidenceDir,
              outputDir: runFrontendDesignAgentE2E ? frontendDesignPaths.sourcePackageAbsolute : undefined,
            },
            ctx,
          )
          expect(context.title).toBe("Web clone context prepared")
          recordTraceEvent(trace, {
            step: "prepare-source-context",
            kind: "tool",
            name: "web_clone_prepare_context",
            status: "passed",
            details: { webpageEvidenceDir, title: context.title },
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
                webpageEvidenceDir,
              }),
              taskID: frontendDesignBenchmarkTaskID,
              parentSessionID: frontendDesignParentSessionID,
              model: { providerID: parsedModel.providerID, modelID: parsedModel.modelID },
            })
            expect(analysis.processTraceArtifact).toBeTruthy()
            expect(analysis.iterationStateArtifact).toBeTruthy()
            mergeFrontendDesignProcessTrace(trace, await readFrontendDesignProcessTrace(analysis.processTraceArtifact!))
            trace.frontendDesignIterationState = await readFrontendDesignIterationState(
              analysis.iterationStateArtifact!,
            )
          }
          if (frontendDesignProcessTracePath) {
            mergeFrontendDesignProcessTrace(trace, await readFrontendDesignProcessTrace(frontendDesignProcessTracePath))
          }
          if (frontendDesignIterationStatePath) {
            trace.frontendDesignIterationState = await readFrontendDesignIterationState(
              frontendDesignIterationStatePath,
            )
          }
          if (!frontendDesignProjectDir && !runFrontendDesignAgentE2E) {
            const skeletonTrace = createFrontendSkeletonProjectTool({
              onToolEvent: (event) =>
                recordTraceEvent(trace, {
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
          recordTraceEvent(trace, {
            step: "inspect-source-project-sidecars",
            kind: "inspection",
            name: "source-project-sidecars",
            status: "passed",
            details: { skeletonProjectDir },
          })
          trace.visualSkeletonEvidence = await inspectVisualSkeletonEvidence(
            targetProjectDir,
            context.metadata.sourcePackageDir,
          )
          recordTraceEvent(trace, {
            step: "inspect-visual-skeleton-artifacts",
            kind: "inspection",
            name: "visual-skeleton-artifacts",
            status: "passed",
            details: trace.visualSkeletonEvidence,
          })

          const acceptanceDir = path.join(path.dirname(targetProjectDir), "acceptance")
          await fs.mkdir(acceptanceDir, { recursive: true })
          const htmlSkeletonWorkflow = await runHtmlSkeletonWorkflowCheck({
            frontendDesignDir: path.dirname(skeletonProjectDir),
            visualRoot: targetProjectDir,
            sourcePackageDir: context.metadata.sourcePackageDir,
            reference: path.join(context.metadata.sourcePackageDir, "reference.png"),
            outDir: path.join(acceptanceDir, "html-skeleton-workflow"),
            threshold,
            worstThreshold,
            headless: true,
          })
          trace.audits.htmlSkeletonWorkflow = htmlSkeletonWorkflow
          recordTraceEvent(trace, {
            step: "html-skeleton-workflow-check",
            kind: "command",
            name: "html-skeleton-workflow-check",
            status: htmlSkeletonWorkflow.passed ? "passed" : "failed",
            details: {
              passed: htmlSkeletonWorkflow.passed,
              mssim: htmlSkeletonWorkflow.visualDiff?.mssim,
              threshold,
              worstThreshold,
              report: path.join(htmlSkeletonWorkflow.outDir, "html-skeleton-workflow-report.json"),
            },
          })
          trace.processAudit = evaluateBenchmarkProcessTrace(trace)
          await fs.writeFile(
            path.join(acceptanceDir, "web-clone-benchmark-process-trace.json"),
            JSON.stringify(trace, null, 2),
            "utf8",
          )
          const report = {
            version: 1,
            purpose: "web-clone-opencorvus-e2e",
            passed: htmlSkeletonWorkflow.passed === true && trace.processAudit.passed === true,
            threshold,
            worstThreshold,
            webpageEvidenceDir,
            outputDir: targetProjectDir,
            skeletonProjectDir,
            processTrace: path.join(acceptanceDir, "web-clone-benchmark-process-trace.json"),
            processAudit: trace.processAudit,
            htmlSkeletonWorkflow,
          }
          await fs.writeFile(
            path.join(acceptanceDir, "opencorvus-web-clone-e2e.json"),
            JSON.stringify(report, null, 2),
            "utf8",
          )
          expect(report.passed, JSON.stringify(report, null, 2)).toBe(true)
        },
      })
    },
    600_000,
  )
})

function createBenchmarkProcessTrace(input: { sourcePackageDir: string; outputDir: string }): BenchmarkProcessTrace {
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
      "visual-skeleton-artifacts",
      "frontend_design_region_selection",
      "frontend_design_source_edit",
      "frontend_design_replacement_result",
      "html-skeleton-workflow-check",
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
  webpageEvidenceDir: string
}): string {
  return [
    "Run the frontend-design visual HTML skeleton benchmark for the prepared webpage clone source package.",
    "",
    `Webpage evidence: ${input.webpageEvidenceDir}`,
    `Prepared web-clone-source package: ${input.sourcePackageDir}`,
    `Frontend-design skeleton evidence project: ${input.skeletonProjectDir}`,
    `Frontend-design visual HTML skeleton root: ${input.targetProjectDir}`,
    "",
    "Call `create_frontend_skeleton_project` with that source package, the skeleton evidence project path, and overwrite=true.",
    "Then inspect skeleton sourceDomIterationState.ts, sourceDomReplacementPlan.ts, sourceDomRegions.ts, sourceData.ts, assets, and generated page/components as evidence only.",
    "Do not run install/build/dev-server commands inside the skeleton evidence project or the visual HTML skeleton; render the visual skeleton only through an explicit static file or URL harness for visual comparison.",
    "Create or populate the visual HTML skeleton before any visual comparison: visual-html-skeleton/index.html, visual-html-skeleton/styles/tokens.css, external layout/region CSS, owned assets, screenshots, and visual-diff/evaluation artifacts.",
    "Use normal frontend-design source-edit tools to extract generated source-dom/rawcode evidence into the source-editable static HTML/CSS visual skeleton while preserving visual parity.",
    "Before each major region restoration, call `record_frontend_region_selection`; after each restoration attempt, call `record_frontend_replacement_result` with completed/blocked/deferred status, changed skeleton files, visual evidence, and exact remaining visual/source debt.",
    "Submit with final_acceptance_mode=visual_baseline_allowed and frontend_project.role=visual_baseline_input. Report project_root=visual-html-skeleton and entrypoints including visual-html-skeleton/index.html and visual-html-skeleton/styles/tokens.css.",
    "The benchmark consumes frontend-design-process-trace.json and frontend-design-iteration-state.json. These files are written by frontend-design tools from your normal tool calls; do not edit them directly. Make the normal agent work visible by calling the region-selection/replacement tools and editing only the visual HTML skeleton, not frontend-design-skeleton.",
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
    db
      .insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: Instance.project.id,
        session_id: rootSession.id,
        source: "test",
        title: "frontend-design visual HTML skeleton benchmark",
        request: "Restore the prepared web-clone-source package into a source-editable visual HTML skeleton.",
        priority: "normal",
        time_created: now,
        time_updated: now,
        time_started: now,
      })
      .run(),
  )
  return rootSession.id
}

async function resolveFrontendDesignBenchmarkModel(): Promise<string> {
  const providers = await Provider.list()
  const explicit = firstEnv(
    "OPENCORVUS_FRONTEND_DESIGN_E2E_MODEL",
    "OPENCORVUS_DESIGN_TEST_MODEL",
    "OPENCORVUS_E2E_MODEL",
  )
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

function resolveModelRefFromProviders(providers: Awaited<ReturnType<typeof Provider.list>>, input: string): string {
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
      { name: "source-project-sidecars", status: "passed", timestamp: new Date().toISOString() },
      { name: "visual-skeleton-artifacts", status: "passed", timestamp: new Date().toISOString() },
      { name: "frontend_design_region_selection", status: "passed", timestamp: new Date().toISOString() },
      { name: "frontend_design_source_edit", status: "passed", timestamp: new Date().toISOString() },
      {
        name: "frontend_design_replacement_result",
        status: "passed",
        timestamp: new Date().toISOString(),
        details: { replacementStatus: "completed", regionComponentName: "HeroRegion" },
      },
      {
        name: "html-skeleton-workflow-check",
        status: "passed",
        timestamp: new Date().toISOString(),
        details: { passed: true, mssim: 0.96 },
      },
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

function mergeFrontendDesignProcessTrace(
  trace: BenchmarkProcessTrace,
  frontendTrace: FrontendDesignProcessTrace,
): void {
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
    name === "source-project-sidecars" ||
    name === "visual-skeleton-artifacts"
  ) {
    return "inspection"
  }
  if (name === "html-skeleton-workflow-check") return "command"
  return "tool"
}

async function inspectVisualSkeletonEvidence(
  projectDir: string,
  sourcePackageDir: string,
): Promise<VisualSkeletonEvidence> {
  const indexPath = path.join(projectDir, "index.html")
  const indexHtml = await fs.readFile(indexPath, "utf8").catch(() => "")
  return {
    indexHtmlExists: await fileExists(indexPath),
    tokenCssExists: await fileExists(path.join(projectDir, "styles", "tokens.css")),
    externalCssLinked: /<link\b[^>]*\brel=(?:"stylesheet"|'stylesheet'|stylesheet\b)/i.test(indexHtml),
    frameworkEntryPresent:
      /(?:\/assets\/index-[^"']+\.js|\/src\/main\.(?:tsx|ts|jsx|js)|react-refresh|vite\/client)/i.test(indexHtml),
    buildOutputPresent:
      (await fileExists(path.join(projectDir, "dist", "index.html"))) ||
      (await fileExists(path.join(projectDir, "build", "index.html"))) ||
      (await fileExists(path.join(projectDir, "out", "index.html"))),
    rawSourceDomDumpPresent:
      /\bsource-dom-page\b/i.test(indexHtml) ||
      /\bsinglefile-body\.html\b/i.test(indexHtml) ||
      /\bsource-skeleton\b/i.test(indexHtml) ||
      (indexHtml.match(/\bdata-source-node-id=/gi) ?? []).length > 500,
    referenceImageExists: await fileExists(path.join(sourcePackageDir, "reference.png")),
  }
}

async function fileExists(file: string): Promise<boolean> {
  return (await fs.stat(file).catch(() => undefined))?.isFile() === true
}

function evaluateBenchmarkProcessTrace(trace: BenchmarkProcessTrace): BenchmarkProcessTrace["processAudit"] {
  const findings: string[] = []
  const eventNames = trace.events.map((event) => event.name)
  const requiredNames = [
    "frontend_design_static_tool_surface",
    "web_clone_prepare_context",
    "create_frontend_skeleton_project",
    "source-project-sidecars",
    "visual-skeleton-artifacts",
    "frontend_design_region_selection",
    "frontend_design_source_edit",
    "frontend_design_replacement_result",
    "html-skeleton-workflow-check",
  ]
  for (const name of requiredNames) {
    if (!eventNames.includes(name)) findings.push(`Missing process event: ${name}.`)
  }

  const htmlSkeletonCheck = trace.events.find(
    (event) =>
      event.name === "html-skeleton-workflow-check" && event.status === "passed" && event.details?.passed === true,
  )
  if (!htmlSkeletonCheck)
    findings.push("Missing passing html-skeleton-workflow-check event for the visual HTML skeleton.")

  const evidence = trace.visualSkeletonEvidence
  if (!evidence?.referenceImageExists) findings.push("Source package is missing reference.png.")
  if (!evidence?.indexHtmlExists) findings.push("Visual HTML skeleton is missing index.html.")
  if (!evidence?.tokenCssExists) findings.push("Visual HTML skeleton is missing styles/tokens.css.")
  if (!evidence?.externalCssLinked) findings.push("Visual HTML skeleton index.html does not link external CSS.")
  if (evidence?.frameworkEntryPresent) {
    findings.push("Visual HTML skeleton still uses a framework compiled/dev entry instead of static HTML/CSS.")
  }
  if (evidence?.buildOutputPresent) {
    findings.push(
      "Visual HTML skeleton root contains dist/build/out output; the design artifact must stay source-editable.",
    )
  }
  if (evidence?.rawSourceDomDumpPresent) {
    findings.push(
      "Visual HTML skeleton appears to be a raw source DOM dump instead of restored semantic HTML sections.",
    )
  }

  const iterationState = trace.frontendDesignIterationState
  if (!iterationState) {
    findings.push("Missing frontend_design iteration state artifact.")
  } else {
    if (iterationState.completedReplacements.length <= 0) {
      findings.push("Frontend-design iteration state has no completed replacements.")
    }
    if (iterationState.remainingSourceDebt.length > 0) {
      findings.push(
        `Frontend-design iteration state still has remaining source debt: ${iterationState.remainingSourceDebt.join(", ")}.`,
      )
    }
    if (iterationState.blockedReplacements.length > 0) {
      findings.push(
        `Frontend-design iteration state still has blocked replacements: ${iterationState.blockedReplacements.length}.`,
      )
    }
    if (iterationState.deferredReplacements.length > 0) {
      findings.push(
        `Frontend-design iteration state still has deferred replacements: ${iterationState.deferredReplacements.length}.`,
      )
    }
  }

  const generateIndex = eventNames.indexOf("create_frontend_skeleton_project")
  const sourceEditIndex = eventNames.indexOf("frontend_design_source_edit")
  if (generateIndex >= 0 && sourceEditIndex >= 0 && sourceEditIndex < generateIndex) {
    findings.push(
      "Frontend-design HTML skeleton edit ran before create_frontend_skeleton_project materialized the source evidence baseline.",
    )
  }

  return {
    passed: findings.length === 0,
    findings,
  }
}

async function assertDirectory(dir: string): Promise<void> {
  const stat = await fs.stat(dir).catch(() => undefined)
  if (!stat?.isDirectory()) throw new Error(`web clone e2e webpage evidence directory does not exist: ${dir}`)
}

async function assertFile(file: string): Promise<void> {
  const stat = await fs.stat(file).catch(() => undefined)
  if (!stat?.isFile()) throw new Error(`web clone e2e file does not exist: ${file}`)
}

function normalizeVisualThreshold(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0.96
  return value > 1 ? value / 100 : value
}
