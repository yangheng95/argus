import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineSpecSnapshotTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { recordIntegrityAttempt } from "../../src/engine/persist"
import {
  WorkflowRegistry,
  createWorkflowState,
  projectTaskSteps,
  renderWorkflowPrompt,
} from "../../src/engine/workflow"
import { createDecisionLog } from "../../src/decision-log"
import { resetDatabase } from "../fixture/db"

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
    expect(text).toContain("Pipeline 的最后 gate 是 `integrity`")
    expect(text).toContain("acceptance_specs / traceability / source-reference coverage / cross-goal contracts")
    expect(text).toContain("最终系统完整性 gate")
    expect(text).toContain("terminal frontend goal batch 后的同级 GUI")
    expect(text).not.toContain("post-integrity 前端 GUI 修复")
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
    for (const key of [
      "public_report",
      "frontend_template",
      "fillable_modules",
      "material_inventory",
      "visual_consistency_contract",
      "ui_data_contract",
      "template_iteration_notes",
      "completeness_review",
      "evidence_source_manifest",
    ]) {
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
  })

  test("projects visual_qa as completed from structured decision log report", () => {
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
    expect(taskSteps.visual_qa?.status).toBe("completed")
  })

  test("projects visual_qa as failed when summary lacks acceptance semantics", () => {
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
    expect(taskSteps.visual_qa?.status).toBe("failed")
  })

  test("projects visual_qa as failed when structured summary is not accepted", () => {
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
    expect(taskSteps.visual_qa?.status).toBe("failed")
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
      value: JSON.stringify({
        accepted: true,
        summary: "A report with blockers must not project as complete.",
        production_blockers: [{ id: "blocker_map" }],
      }),
      reason: "Dedicated frontend GUI and functional QA report.",
    })

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.visual_qa?.status).toBe("failed")
  })

  test("projects visual_qa as failed when full report lacks production blocker semantics", () => {
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
      value: JSON.stringify({
        accepted: true,
        summary: "Legacy report without production blocker semantics.",
      }),
      reason: "Legacy report must not project as accepted visual QA.",
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

  test("projects needs_correction integrity as failed because integrity is the workflow gate", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `proj_workflow_integrity_failed_${stamp}`
    const taskID = `tsk_workflow_integrity_failed_${stamp}`
    const specID = `spec_workflow_integrity_failed_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "Workflow integrity failed projection test",
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
          title: "Workflow integrity failed status",
          request: "Show integrity stage as failed when correction is required",
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
      sessionID: "ses_integrity_projection_failed",
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
    expect(taskSteps.integrity?.status).toBe("failed")
  })

  test("projects historical top-level concerns payload with correction work as failed", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `proj_workflow_integrity_concern_failed_${stamp}`
    const taskID = `tsk_workflow_integrity_concern_failed_${stamp}`
    const specID = `spec_workflow_integrity_concern_failed_${stamp}`

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
          request: "Show integrity stage as failed when concerns contain correction work",
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
      sessionID: "ses_integrity_projection_concern_failed",
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
    expect(taskSteps.integrity?.status).toBe("failed")
  })
})
