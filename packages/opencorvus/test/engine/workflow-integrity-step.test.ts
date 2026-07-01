import fs from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineArtifactTable, EngineGoalTable, EngineSpecSnapshotTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { FRONTEND_DESIGN_COMPLETION_KEYS } from "../../src/frontend-design/handoff"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { recordIntegrityAttempt } from "../../src/engine/persist"
import { visualQaReportAcceptanceSemantics } from "../../src/visual-qa/acceptance-semantics"
import { VisualQaReportSchema } from "../../src/visual-qa/schema"
import {
  WorkflowRegistry,
  createWorkflowState,
  projectGoalSteps,
  projectTaskSteps,
  renderWorkflowPrompt,
} from "../../src/engine/workflow"
import { createDecisionLog } from "../../src/decision-log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const DEFAULT_VISUAL_QA_CHECK_ID = "check_dashboard_desktop"

function visualQaCheckItem(overrides: Record<string, unknown> = {}) {
  return {
    id: DEFAULT_VISUAL_QA_CHECK_ID,
    category: "reference-structure",
    question: "Does the dashboard desktop surface match the accepted visual requirements?",
    region: "dashboard",
    status: "passed",
    expected: "Dashboard desktop surface is visually complete and supported by fresh screenshot evidence.",
    observed: "Dashboard desktop surface was checked with a fresh screenshot.",
    viewports: [{ width: 1440, height: 900 }],
    states: ["default"],
    source_refs: ["visual_qa"],
    evidence_refs: ["artifacts/dashboard.png"],
    ...overrides,
  }
}

function visualQaReport(overrides: Record<string, unknown> = {}) {
  return {
    accepted: true,
    summary: "Visual QA report accepted.",
    check_items: [visualQaCheckItem()],
    coverage: [
      {
        check_ids: [DEFAULT_VISUAL_QA_CHECK_ID],
        region: "dashboard",
        viewports: [{ width: 1440, height: 900 }],
        states: ["default"],
        source_refs: ["visual_qa"],
        evidence_refs: ["artifacts/dashboard.png"],
        notes: "Checked the dashboard surface.",
      },
    ],
    findings: [],
    production_blockers: [],
    unresolved_code_module_problems: [],
    repairs: [],
    evidence: [
      {
        check_ids: [DEFAULT_VISUAL_QA_CHECK_ID],
        type: "screenshot",
        ref: "artifacts/dashboard.png",
        viewport: { width: 1440, height: 900 },
        state: "default",
        note: "Fresh visual QA screenshot.",
      },
    ],
    reference_parity: {
      required: false,
      required_regions: [],
      reference_comparison_evidence_refs: [],
      missing_regions: [],
      blocker_ids: [],
    },
    commands: [],
    changed_files: [],
    open_questions: [],
    fact_check_items: [],
    ...overrides,
  }
}

function visualQaCoverage(checkID: string, overrides: Record<string, unknown> = {}) {
  return {
    check_ids: [checkID],
    region: "dashboard",
    viewports: [{ width: 1440, height: 900 }],
    states: ["default"],
    source_refs: ["visual_qa"],
    evidence_refs: ["artifacts/dashboard.png"],
    notes: "Checked the dashboard surface.",
    ...overrides,
  }
}

function visualQaEvidence(checkID: string, overrides: Record<string, unknown> = {}) {
  return {
    check_ids: [checkID],
    type: "screenshot",
    ref: "artifacts/dashboard.png",
    viewport: { width: 1440, height: 900 },
    state: "default",
    note: "Fresh visual QA screenshot.",
    ...overrides,
  }
}

function visualQaDecisionRecord(reportInput: unknown, acceptanceOverrides: Record<string, unknown> = {}) {
  const report = VisualQaReportSchema.parse(reportInput)
  const semantics = visualQaReportAcceptanceSemantics(report)
  return {
    report,
    acceptance: {
      submittedAccepted: semantics.submittedAccepted,
      effectiveAccepted: semantics.effectiveAccepted,
      selfReportIssues: semantics.selfReportIssues,
      blockingIssues: semantics.selfReportIssues,
      ...acceptanceOverrides,
    },
  }
}

function legacyVisualQaDecisionRecord(report: Record<string, unknown>) {
  return {
    report,
    acceptance: {
      submittedAccepted: report.accepted === true,
      effectiveAccepted: false,
      selfReportIssues: ["Legacy Visual QA report does not satisfy current registered check item schema."],
      blockingIssues: ["Legacy Visual QA report does not satisfy current registered check item schema."],
    },
  }
}

describe("pipeline workflow review topology", () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  afterEach(async () => {
    await resetDatabase()
  })

  test("projects workload, visual QA, and integrity as advisory peer review topology", () => {
    const pipeline = WorkflowRegistry.resolveSync("pipeline")
    expect(pipeline).toBeDefined()
    const stepIDs = pipeline!.steps.map((step) => step.id)
    expect(stepIDs).toEqual([
      "frontend_design",
      "frontend_research",
      "analyze_intent",
      "requirements",
      "architect",
      "workload_analysis",
      "build",
      "visual_qa",
      "integrity",
    ])
    expect(pipeline!.steps.find((step) => step.id === "frontend_design")?.after).toEqual([])
    expect(pipeline!.steps.find((step) => step.id === "frontend_research")?.after).toEqual([])
    expect(pipeline!.steps.find((step) => step.id === "analyze_intent")?.after).toEqual([
      "frontend_design",
      "frontend_research",
    ])
    expect(pipeline!.steps.find((step) => step.id === "requirements")?.after).toEqual([
      "frontend_design",
      "frontend_research",
    ])
    expect(pipeline!.steps.find((step) => step.id === "workload_analysis")?.after).toEqual(["architect"])
    expect(pipeline!.steps.find((step) => step.id === "build")?.after).toEqual(["workload_analysis"])
    expect(pipeline!.steps.find((step) => step.id === "visual_qa")?.after).toEqual(["build"])
    expect(pipeline!.steps.find((step) => step.id === "integrity")?.after).toEqual(["build"])
    expect(pipeline!.steps.find((step) => step.id === "visual_qa")?.after).not.toContain("integrity")
    expect(stepIDs.indexOf("workload_analysis")).toBeGreaterThan(stepIDs.indexOf("architect"))
    expect(stepIDs.indexOf("workload_analysis")).toBeLessThan(stepIDs.indexOf("build"))
  })

  test("projects the current single build phase as running for running goal attempts", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `proj_workflow_build_phase_${stamp}`
    const taskID = `tsk_workflow_build_phase_${stamp}`
    const goalID = `goal_workflow_build_phase_${stamp}`
    const goalRunID = `glr_workflow_build_phase_${stamp}`
    const runID = `run_workflow_build_phase_${stamp}`
    const sessionID = `ses_workflow_build_phase_${stamp}`
    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const buildStep = pipeline.steps.find((step) => step.id === "build")

    expect(buildStep?.phases).toEqual([{ id: "build", label: "Build", sessionKind: "build" }])

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: "/tmp/workflow-build-phase",
          branch: "main",
          status: "active",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "single build phase",
          request: "project the active build phase",
          priority: "normal",
          time_started: now,
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineGoalTable)
        .values({
          id: goalID,
          task_id: taskID,
          title: "Build the feature",
          slug: "build-feature",
          objective: "Run the executor.",
          order_index: 0,
          time_created: now,
          time_updated: now,
        } as any)
        .run()
      db.insert(EngineArtifactTable)
        .values({
          id: goalRunID,
          task_id: taskID,
          run_id: runID,
          goal_run_id: goalRunID,
          kind: "goal_run_attempt",
          label: "running",
          payload: {
            goal_id: goalID,
            session_id: sessionID,
            status: "running",
            retry_count: 0,
            time_started: now,
          },
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    const projected = projectGoalSteps(taskID, pipeline)
    expect(projected[goalID]?.steps.build?.status).toBe("running")
    expect(projected[goalID]?.steps.build?.startedAt).toBe(now)
    expect(projected[goalID]?.stepPhases?.build?.build?.status).toBe("running")
    expect(projected[goalID]?.stepPhases?.build?.plan).toBeUndefined()
  })

  test("does not project sessionless manual completion as a build phase", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `proj_workflow_sessionless_complete_${stamp}`
    const taskID = `tsk_workflow_sessionless_complete_${stamp}`
    const goalID = `goal_workflow_sessionless_complete_${stamp}`
    const goalRunID = `glr_workflow_sessionless_complete_${stamp}`
    const pipeline = WorkflowRegistry.resolveSync("pipeline")!

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: "/tmp/workflow-sessionless-complete",
          branch: "main",
          status: "active",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "sessionless completion",
          request: "project a manual completion without a build phase",
          priority: "normal",
          time_started: now,
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineGoalTable)
        .values({
          id: goalID,
          task_id: taskID,
          title: "Already satisfied",
          slug: "already-satisfied",
          objective: "Represent work proven satisfied without executor dispatch.",
          order_index: 0,
          time_created: now,
          time_updated: now,
        } as any)
        .run()
      db.insert(EngineArtifactTable)
        .values({
          id: goalRunID,
          task_id: taskID,
          run_id: null,
          goal_run_id: goalRunID,
          kind: "goal_run_attempt",
          label: "attempt-completed",
          payload: {
            goal_id: goalID,
            session_id: null,
            status: "completed",
            retry_count: 0,
            metadata: {
              manual_completion: {
                source: "orchestrator.complete_goal",
                reason: "Existing evidence proves this goal is already satisfied.",
                time_completed: now,
              },
            },
            time_started: now - 5_000,
            time_completed: now,
          },
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    const projected = projectGoalSteps(taskID, pipeline)
    expect(projected[goalID]?.goalStatus).toBe("passed")
    expect(projected[goalID]?.steps.build?.status).toBe("completed")
    expect(projected[goalID]?.steps.build?.startedAt).toBeUndefined()
    expect(projected[goalID]?.steps.build?.completedAt).toBeUndefined()
    expect(projected[goalID]?.stepPhases?.build).toBeUndefined()
  })

  test("rendered workflow prompt does not expose deleted architect or scheduler semantics", () => {
    const direct = WorkflowRegistry.resolveSync("direct")!
    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const text = [
      renderWorkflowPrompt(direct, createWorkflowState(direct)),
      renderWorkflowPrompt(pipeline, createWorkflowState(pipeline)),
    ].join("\n\n")

    expect(text).not.toContain("停止默认调度")
    expect(text).not.toContain("goals / 度量 / 挑战种子 / 契约")
    expect(text).not.toContain("metric specs, challenge seeds")
    expect(text).not.toContain("evaluator as plan/build/evaluate phases")
    expect(text).not.toContain("per-goal[build + architecture_review]")
    expect(text).not.toContain("goal build 完成后自动跑一次 architecture_review")
    expect(text).toContain("Pipeline 的 review report surface 是 `integrity`")
    expect(text).toContain("acceptance_specs / traceability / source-reference coverage / cross-goal contracts")
    expect(text).toContain("系统完整性 review report")
    expect(text).toContain("所有 blocking build terminal 后、最终调度决定前的一次性 GUI")
    expect(text).not.toContain("post-integrity 前端 GUI 修复")
  })

  test("projects failed analyze_intent abort decisions as failed after reload", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `proj_workflow_intent_failed_${stamp}`
    const taskID = `tsk_workflow_intent_failed_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: "/tmp/workflow-intent-failed",
          branch: "main",
          status: "active",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "intent failed",
          request: "intent analysis throws",
          priority: "normal",
          time_started: now,
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    createDecisionLog(taskID).append({
      phase: "intent_analysis",
      key: "abort_intent_analysis_failed",
      value: JSON.stringify({
        reason: "intent_analysis_threw",
        error: "Intent analysis failed before terminal report.",
      }),
      reason: "test",
    })

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.analyze_intent?.status).toBe("failed")
  })

  test("projects frontend_design as completed from frontend template decision log without visual rows", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `proj_workflow_design_${stamp}`
    const taskID = `tsk_workflow_design_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "Workflow design step test",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "Workflow design status",
          request: "Clone a visual webpage",
          kind: "workflow",
          priority: "normal",
          design_specs: [],
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })

    const log = createDecisionLog(taskID)
    for (const key of FRONTEND_DESIGN_COMPLETION_KEYS) {
      log.append({
        phase: "frontend_design",
        key,
        value: `${key} value`,
        reason: "test",
      })
    }

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.frontend_design?.status).toBe("completed")

    const prompt = renderWorkflowPrompt(pipeline, createWorkflowState(pipeline), taskID)
    const designLine = prompt.split("\n").find((line) => line.includes("[task] frontend_design"))
    expect(designLine).toBeDefined()
    expect(designLine).toContain("[DONE]")
  })

  test("does not project visual_qa as completed from summary-only decision log text", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `proj_workflow_visual_qa_${stamp}`
    const taskID = `tsk_workflow_visual_qa_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "Workflow visual QA step test",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "Workflow visual QA status",
          request: "Repair a frontend after integrity review",
          kind: "workflow",
          priority: "normal",
          design_specs: [],
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })

    createDecisionLog(taskID).append({
      phase: "visual_qa",
      key: "latest_summary",
      value: "accepted=true\nsummary=real chart replaced placeholder\nproduction_blockers=0",
      reason: "Latest structured visual QA summary for integrity review.",
    })

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.visual_qa?.status).toBe("pending")
  })

  test("projects visual_qa as completed from full structured report", () => {
    const now = Date.now()
    const stamp = `${now.toString(16)}_report`
    const projectID = `proj_workflow_visual_qa_${stamp}`
    const taskID = `tsk_workflow_visual_qa_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "Workflow visual QA full report step test",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "Workflow visual QA full report status",
          request: "Repair a frontend after integrity review",
          kind: "workflow",
          priority: "normal",
          design_specs: [],
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })

    createDecisionLog(taskID).append({
      phase: "visual_qa",
      key: "report_1",
      value: JSON.stringify(
        visualQaDecisionRecord(
          visualQaReport({
            summary: "Full visual QA report accepted.",
          }),
        ),
      ),
      reason: "Dedicated frontend GUI and functional QA report.",
    })
    createDecisionLog(taskID).append({
      phase: "visual_qa",
      key: "latest_summary",
      value: "accepted=true\nsummary=full visual QA report accepted\nproduction_blockers=0",
      reason: "Latest structured visual QA summary for integrity review.",
    })

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.visual_qa?.status).toBe("completed")
  })

  test("projects visual_qa as failed from legacy bare accepted report JSON", () => {
    const now = Date.now()
    const stamp = `${now.toString(16)}_bare_report`
    const projectID = `proj_workflow_visual_qa_${stamp}`
    const taskID = `tsk_workflow_visual_qa_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "Workflow bare visual QA report test",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "Workflow bare visual QA report status",
          request: "Repair a frontend after integrity review",
          kind: "workflow",
          priority: "normal",
          design_specs: [],
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })

    createDecisionLog(taskID).append({
      phase: "visual_qa",
      key: "report_1",
      value: JSON.stringify(
        legacyVisualQaDecisionRecord({
          accepted: true,
          summary: "Bare accepted report cannot satisfy registered check item schema.",
          production_blockers: [],
        }),
      ),
      reason: "Legacy frontend GUI and functional QA report.",
    })

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.visual_qa?.status).toBe("failed")
  })

  test("projects visual_qa as failed from accepted reference parity report without comparison refs", () => {
    const now = Date.now()
    const stamp = `${now.toString(16)}_reference_missing`
    const projectID = `proj_workflow_visual_qa_${stamp}`
    const taskID = `tsk_workflow_visual_qa_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "Workflow visual QA reference parity report test",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "Workflow visual QA reference parity status",
          request: "Repair a frontend reference clone",
          kind: "workflow",
          priority: "normal",
          design_specs: [],
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })

    createDecisionLog(taskID).append({
      phase: "visual_qa",
      key: "report_1",
      value: JSON.stringify(
        visualQaDecisionRecord(
          visualQaReport({
            summary: "Report claimed acceptance but cited no comparison evidence.",
            reference_parity: {
              required: true,
              required_regions: ["region_header@desktop"],
              reference_comparison_evidence_refs: [],
              missing_regions: [],
              blocker_ids: [],
            },
          }),
        ),
      ),
      reason: "Dedicated frontend GUI and functional QA report.",
    })

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.visual_qa?.status).toBe("failed")
  })

  test("projects visual_qa as failed from accepted reference parity report with missing regions", () => {
    const now = Date.now()
    const stamp = `${now.toString(16)}_reference_missing_regions`
    const projectID = `proj_workflow_visual_qa_${stamp}`
    const taskID = `tsk_workflow_visual_qa_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "Workflow visual QA reference missing regions test",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "Workflow visual QA missing regions status",
          request: "Repair a frontend reference clone",
          kind: "workflow",
          priority: "normal",
          design_specs: [],
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })

    createDecisionLog(taskID).append({
      phase: "visual_qa",
      key: "report_1",
      value: JSON.stringify(
        visualQaDecisionRecord(
          visualQaReport({
            summary: "Report claimed acceptance while listing missing reference regions.",
            evidence: [
              {
                check_ids: [DEFAULT_VISUAL_QA_CHECK_ID],
                type: "reference_comparison",
                ref: "browser_preview_evidence:art_header",
                viewport: { width: 1440, height: 900 },
                state: "default",
                note: "Header reference comparison.",
              },
            ],
            reference_parity: {
              required: true,
              required_regions: ["region_header@desktop", "region_footer@desktop"],
              reference_comparison_evidence_refs: ["browser_preview_evidence:art_header"],
              missing_regions: ["region_footer@desktop"],
              blocker_ids: [],
            },
          }),
        ),
      ),
      reason: "Dedicated frontend GUI and functional QA report.",
    })

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.visual_qa?.status).toBe("failed")
  })

  test("projects reference task visual_qa as completed when accepted report claims parity is not required", () => {
    const now = Date.now()
    const stamp = `${now.toString(16)}_reference_false`
    const projectID = `proj_workflow_visual_qa_${stamp}`
    const taskID = `tsk_workflow_visual_qa_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "Workflow visual QA reference false report test",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "Workflow visual QA reference false status",
          request: "Repair a frontend reference clone",
          kind: "workflow",
          priority: "normal",
          design_specs: [],
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })

    createDecisionLog(taskID).append({
      phase: "frontend_design",
      key: "reference_artifacts",
      value: "web-clone-source/reference.png",
      reason: "Frontend design supplied source reference artifacts.",
    })
    createDecisionLog(taskID).append({
      phase: "visual_qa",
      key: "report_1",
      value: JSON.stringify(
        visualQaDecisionRecord(
          visualQaReport({
            summary: "Screenshot-only report claimed parity not required.",
            reference_parity: {
              required: false,
              required_regions: [],
              reference_comparison_evidence_refs: [],
              missing_regions: [],
              blocker_ids: [],
            },
          }),
        ),
      ),
      reason: "Dedicated frontend GUI and functional QA report.",
    })

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.visual_qa?.status).toBe("completed")
  })

  test("projects visual_qa as completed when VisualEvidenceBundle alone requires reference parity", async () => {
    await using tmp = await tmpdir()
    const now = Date.now()
    const stamp = `${now.toString(16)}_bundle_only`
    const projectID = `proj_workflow_visual_qa_${stamp}`
    const taskID = `tsk_workflow_visual_qa_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: tmp.path,
          name: "Workflow bundle-only visual QA reference test",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "Workflow visual QA bundle-only reference status",
          request: "Repair a frontend reference clone",
          kind: "workflow",
          priority: "normal",
          design_specs: [],
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })

    const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
    await fs.mkdir(paths.webpageEvidenceAbsolute, { recursive: true })
    await fs.writeFile(
      path.join(paths.webpageEvidenceAbsolute, "visual-evidence-bundle.json"),
      JSON.stringify({
        id: "veb_bundle_only",
        taskID,
        source: "frontend_design",
        reference: {
          path: "web-clone-source/reference.png",
          sha256: "reference-sha",
          width: 1440,
          height: 900,
        },
        rendered: {
          path: "artifacts/rendered.png",
          sha256: "rendered-sha",
          width: 1440,
          height: 900,
          capturedAt: new Date(now).toISOString(),
          viewport: { width: 1440, height: 900 },
          appURL: "http://127.0.0.1:7878",
          projectDirectory: tmp.path,
        },
        inspection: {
          reviewedAt: new Date(now).toISOString(),
          status: "passing",
          blockerCount: 0,
          notes: "Bundle declares required reference region.",
        },
        pageCoverage: {
          coordinateSpace: "source_reference_image_px",
          implementationUse: "evidence_only",
          requiredRegionIDs: ["dashboard"],
          coveredIntervals: [
            {
              id: "coverage_full_reference",
              label: "Full reference page",
              y: 0,
              height: 900,
              regionIDs: ["dashboard"],
              evidenceRefs: ["browser_preview_evidence:art_missing_comparison"],
              notes: "Required evidence covers the full source reference height.",
            },
          ],
          unexplainedBlankIntervals: [],
        },
        regions: [
          {
            id: "dashboard",
            label: "Dashboard",
            requirementIDs: ["REQ-1"],
            acceptanceSpecIDs: ["ACC-1"],
            sourceRefs: ["web-clone-source/reference.png"],
            viewport: "desktop",
            cropIntent: "full-region",
            required: true,
            status: "passing",
            evidenceRefs: ["browser_preview_evidence:art_missing_comparison"],
            notes: "Required reference region.",
          },
        ],
      }),
    )

    createDecisionLog(taskID).append({
      phase: "visual_qa",
      key: "report_1",
      value: JSON.stringify(
        visualQaDecisionRecord(
          visualQaReport({
            summary: "Screenshot-only report claimed parity not required.",
            reference_parity: {
              required: false,
              required_regions: [],
              reference_comparison_evidence_refs: [],
              missing_regions: [],
              blocker_ids: [],
            },
          }),
        ),
      ),
      reason: "Dedicated frontend GUI and functional QA report.",
    })

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.visual_qa?.status).toBe("completed")
  })

  test("projects reference task visual_qa as failed from verified unaccepted comparison ref strings", () => {
    const now = Date.now()
    const stamp = `${now.toString(16)}_reference_bogus_refs`
    const projectID = `proj_workflow_visual_qa_${stamp}`
    const taskID = `tsk_workflow_visual_qa_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "Workflow visual QA bogus reference refs test",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "Workflow visual QA bogus reference refs status",
          request: "Repair a frontend reference clone",
          kind: "workflow",
          priority: "normal",
          design_specs: [],
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })

    createDecisionLog(taskID).append({
      phase: "frontend_design",
      key: "reference_artifacts",
      value: "web-clone-source/reference.png",
      reason: "Frontend design supplied source reference artifacts.",
    })
    createDecisionLog(taskID).append({
      phase: "visual_qa",
      key: "report_1",
      value: JSON.stringify(
        visualQaDecisionRecord(
          visualQaReport({
            summary: "Report cited unverified string refs.",
            coverage: [
              {
                check_ids: [DEFAULT_VISUAL_QA_CHECK_ID],
                region: "dashboard",
                viewports: [{ width: 1440, height: 900 }],
                states: ["default"],
                source_refs: ["visual_qa"],
                evidence_refs: ["art_missing_comparison"],
                notes: "Claimed dashboard reference comparison.",
              },
            ],
            findings: [],
            production_blockers: [],
            unresolved_code_module_problems: [],
            repairs: [],
            evidence: [
              {
                check_ids: [DEFAULT_VISUAL_QA_CHECK_ID],
                type: "reference_comparison",
                ref: "art_missing_comparison",
                viewport: { width: 1440, height: 900 },
                state: "default",
                note: "Unverified comparison ref string.",
              },
            ],
            reference_parity: {
              required: true,
              required_regions: ["dashboard@desktop"],
              reference_comparison_evidence_refs: ["art_missing_comparison"],
              missing_regions: [],
              blocker_ids: [],
            },
            commands: [],
            changed_files: [],
            open_questions: [],
            fact_check_items: [],
          }),
          {
            effectiveAccepted: false,
            blockingIssues: [
              "no submitted reference comparison refs resolved to readable passed browser_preview_evidence.",
            ],
          },
        ),
      ),
      reason: "Dedicated frontend GUI and functional QA report.",
    })

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.visual_qa?.status).toBe("failed")
  })

  test("projects visual_qa as failed from self-reported reference parity refs rejected by acceptance record", () => {
    const now = Date.now()
    const stamp = `${now.toString(16)}_self_reference_bogus_refs`
    const projectID = `proj_workflow_visual_qa_${stamp}`
    const taskID = `tsk_workflow_visual_qa_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "Workflow visual QA self-reported reference refs test",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "Workflow visual QA self-reported reference status",
          request: "Repair a frontend page",
          kind: "workflow",
          priority: "normal",
          design_specs: [],
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })

    createDecisionLog(taskID).append({
      phase: "visual_qa",
      key: "report_1",
      value: JSON.stringify(
        visualQaDecisionRecord(
          visualQaReport({
            summary: "Report self-reported reference parity evidence.",
            coverage: [
              {
                check_ids: [DEFAULT_VISUAL_QA_CHECK_ID],
                region: "dashboard",
                viewports: [{ width: 1440, height: 900 }],
                states: ["default"],
                source_refs: ["visual_qa"],
                evidence_refs: ["art_missing_comparison"],
                notes: "Claimed dashboard reference comparison.",
              },
            ],
            findings: [],
            production_blockers: [],
            unresolved_code_module_problems: [],
            repairs: [],
            evidence: [
              {
                check_ids: [DEFAULT_VISUAL_QA_CHECK_ID],
                type: "reference_comparison",
                ref: "art_missing_comparison",
                viewport: { width: 1440, height: 900 },
                state: "default",
                note: "Unverified comparison ref string.",
              },
            ],
            reference_parity: {
              required: true,
              required_regions: ["dashboard@desktop"],
              reference_comparison_evidence_refs: ["art_missing_comparison"],
              missing_regions: [],
              blocker_ids: [],
            },
            commands: [],
            changed_files: [],
            open_questions: [],
            fact_check_items: [],
          }),
          {
            effectiveAccepted: false,
            blockingIssues: [
              "no submitted reference comparison refs resolved to readable passed browser_preview_evidence.",
            ],
          },
        ),
      ),
      reason: "Dedicated frontend GUI and functional QA report.",
    })

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.visual_qa?.status).toBe("failed")
  })

  test("keeps visual_qa pending when summary lacks a full report", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `proj_workflow_visual_qa_unstructured_${stamp}`
    const taskID = `tsk_workflow_visual_qa_unstructured_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "Workflow unstructured visual QA summary test",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "Workflow unstructured visual QA status",
          request: "Repair a frontend after integrity review",
          kind: "workflow",
          priority: "normal",
          design_specs: [],
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })

    createDecisionLog(taskID).append({
      phase: "visual_qa",
      key: "latest_summary",
      value: "summary=old visual qa summary without production blocker semantics",
      reason: "Legacy summary must not project as accepted visual QA.",
    })

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.visual_qa?.status).toBe("pending")
  })

  test("keeps visual_qa pending when non-accepted summary lacks a full report", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `proj_workflow_visual_qa_failed_${stamp}`
    const taskID = `tsk_workflow_visual_qa_failed_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "Workflow failed visual QA step test",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "Workflow failed visual QA status",
          request: "Repair a frontend after integrity review",
          kind: "workflow",
          priority: "normal",
          design_specs: [],
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })

    createDecisionLog(taskID).append({
      phase: "visual_qa",
      key: "latest_summary",
      value: "accepted=false\nsummary=map is not production-ready\nproduction_blockers=1",
      reason: "Latest structured visual QA summary for integrity review.",
    })

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.visual_qa?.status).toBe("pending")
  })

  test("projects visual_qa as failed when full report contains production blockers", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `proj_workflow_visual_qa_blockers_${stamp}`
    const taskID = `tsk_workflow_visual_qa_blockers_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "Workflow visual QA blocker report test",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "Workflow visual QA blocker report status",
          request: "Repair a frontend after integrity review",
          kind: "workflow",
          priority: "normal",
          design_specs: [],
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })

    createDecisionLog(taskID).append({
      phase: "visual_qa",
      key: "report_1",
      value: JSON.stringify(
        visualQaDecisionRecord(
          visualQaReport({
          summary: "A report with blockers must not project as complete.",
          production_blockers: [
            {
              id: "blocker_map",
              check_ids: [DEFAULT_VISUAL_QA_CHECK_ID],
              principle_ids: ["component-truth"],
              region: "dashboard",
              reason: "The visible map is a placeholder instead of the required production component.",
              impact: "Users would see a misleading placeholder surface.",
              required_correction: "Replace the placeholder with the production map component.",
              source_refs: ["visual_qa"],
              evidence_refs: ["artifacts/dashboard.png"],
            },
          ],
          }),
        ),
      ),
      reason: "Dedicated frontend GUI and functional QA report.",
    })

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.visual_qa?.status).toBe("failed")
  })

  test("projects visual_qa from report semantics when the effective acceptance record is stale", () => {
    const now = Date.now()
    const stamp = `${now.toString(16)}_effective_record_source`
    const projectID = `proj_workflow_visual_qa_${stamp}`
    const taskID = `tsk_workflow_visual_qa_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "Workflow visual QA effective record source test",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "Workflow visual QA effective record source status",
          request: "Render visual QA from acceptance record",
          kind: "workflow",
          priority: "normal",
          design_specs: [],
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })

    createDecisionLog(taskID).append({
      phase: "visual_qa",
      key: "report_1",
      value: JSON.stringify(
        visualQaDecisionRecord(
          visualQaReport({
            summary: "Projection should reject stale effective acceptance when report fields contradict it.",
            production_blockers: [
              {
                id: "blocker_ignored_by_projection",
                check_ids: [DEFAULT_VISUAL_QA_CHECK_ID],
                principle_ids: ["component-truth"],
                region: "dashboard",
                reason: "This report field is intentionally inconsistent with the acceptance record.",
                impact: "Projection must recompute acceptance from report fields.",
                required_correction: "Treat the report as rejected.",
                source_refs: ["visual_qa"],
                evidence_refs: ["artifacts/dashboard.png"],
              },
            ],
          }),
          {
            effectiveAccepted: true,
            selfReportIssues: [],
            blockingIssues: [],
          },
        ),
      ),
      reason: "Dedicated frontend GUI and functional QA report.",
    })

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.visual_qa?.status).toBe("failed")
  })

  test("projects visual_qa as failed when accepted report omits current blocker fields", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `proj_workflow_visual_qa_missing_blockers_${stamp}`
    const taskID = `tsk_workflow_visual_qa_missing_blockers_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "Workflow visual QA missing blocker semantics test",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "Workflow visual QA missing blocker semantics",
          request: "Repair a frontend after integrity review",
          kind: "workflow",
          priority: "normal",
          design_specs: [],
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })

    createDecisionLog(taskID).append({
      phase: "visual_qa",
      key: "report_1",
      value: JSON.stringify(
        legacyVisualQaDecisionRecord({
          accepted: true,
          summary: "Accepted report omits current registered check item and blocker fields.",
        }),
      ),
      reason: "Legacy report is accepted by its own submitted fields.",
    })

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.visual_qa?.status).toBe("failed")
  })

  test("projects integrity as completed when top-level pass has advisory concerns evidence", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `proj_workflow_integrity_${stamp}`
    const taskID = `tsk_workflow_integrity_${stamp}`
    const specID = `spec_workflow_integrity_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "Workflow integrity step test",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "Workflow integrity status",
          request: "Show integrity stage as completed",
          kind: "workflow",
          priority: "normal",
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
      db.insert(EngineSpecSnapshotTable)
        .values({
          id: specID,
          task_id: taskID,
          version: 1,
          status: "ready",
          summary: "Active spec",
          content: "spec",
          scope: "scope",
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    recordIntegrityAttempt({
      taskID,
      sessionID: "ses_integrity_projection",
      lineage: {
        taskID,
        activeSpecSnapshotID: specID,
        inheritedSpecSnapshotIDs: [],
        reason: "active_only",
      },
      verdict: "pass",
      phase: "post_build",
      perDimension: [
        { id: "requirement_fidelity", verdict: "pass" },
        { id: "technical_feasibility", verdict: "pass" },
        { id: "hallucination", verdict: "pass" },
        { id: "solution_quality", verdict: "concerns" },
      ],
      issuesCount: 1,
      correctionsCount: 0,
      missingCount: 0,
      reason: "Advisory solution-quality concern without repair payload.",
      now,
    })

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.integrity?.status).toBe("completed")
    expect(taskSteps.build).toBeUndefined()
  })

  test("projects needs_correction integrity report as completed review evidence", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `proj_workflow_integrity_report_${stamp}`
    const taskID = `tsk_workflow_integrity_report_${stamp}`
    const specID = `spec_workflow_integrity_report_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "Workflow integrity report projection test",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "Workflow integrity report status",
          request: "Show integrity stage as completed when correction evidence is recorded",
          kind: "workflow",
          priority: "normal",
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
      db.insert(EngineSpecSnapshotTable)
        .values({
          id: specID,
          task_id: taskID,
          version: 1,
          status: "ready",
          summary: "Active spec",
          content: "spec",
          scope: "scope",
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    recordIntegrityAttempt({
      taskID,
      sessionID: "ses_integrity_projection_report",
      lineage: {
        taskID,
        activeSpecSnapshotID: specID,
        inheritedSpecSnapshotIDs: [],
        reason: "active_only",
      },
      verdict: "needs_correction",
      phase: "post_build",
      perDimension: [
        { id: "requirement_fidelity", verdict: "pass" },
        { id: "technical_feasibility", verdict: "pass" },
        { id: "hallucination", verdict: "needs_correction" },
        { id: "solution_quality", verdict: "concerns" },
      ],
      issuesCount: 1,
      correctionsCount: 0,
      missingCount: 0,
      now,
    })

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.integrity?.status).toBe("completed")
  })

  test("projects historical top-level concerns payload with correction work as completed review evidence", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `proj_workflow_integrity_concern_report_${stamp}`
    const taskID = `tsk_workflow_integrity_concern_report_${stamp}`
    const specID = `spec_workflow_integrity_concern_report_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "Workflow integrity concern correction projection test",
          sandboxes: [],
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "Workflow integrity correction status",
          request: "Show integrity stage as completed when concerns contain correction work",
          kind: "workflow",
          priority: "normal",
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
      db.insert(EngineSpecSnapshotTable)
        .values({
          id: specID,
          task_id: taskID,
          version: 1,
          status: "ready",
          summary: "Active spec",
          content: "spec",
          scope: "scope",
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    // New aggregate semantics no longer produce a top-level `concerns` verdict:
    // repair-bearing concerns aggregate to `needs_correction`, while advisory-only
    // concerns aggregate to `pass`. This row pins projection behavior for older
    // persisted non-pass artifacts that already carry top-level `concerns`.
    recordIntegrityAttempt({
      taskID,
      sessionID: "ses_integrity_projection_concern_report",
      lineage: {
        taskID,
        activeSpecSnapshotID: specID,
        inheritedSpecSnapshotIDs: [],
        reason: "active_only",
      },
      verdict: "concerns",
      phase: "post_build",
      perDimension: [
        { id: "requirement_fidelity", verdict: "concerns" },
        { id: "technical_feasibility", verdict: "pass" },
        { id: "hallucination", verdict: "pass" },
        { id: "solution_quality", verdict: "concerns" },
      ],
      issuesCount: 2,
      correctionsCount: 1,
      missingCount: 0,
      now,
    })

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.integrity?.status).toBe("completed")
  })
})
