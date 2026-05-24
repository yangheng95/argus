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

describe("pipeline workflow architecture review step", () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  afterEach(async () => {
    await resetDatabase()
  })

  test("projects architecture review after build instead of before execution", () => {
    const pipeline = WorkflowRegistry.resolveSync("pipeline")
    expect(pipeline).toBeDefined()
    const stepIDs = pipeline!.steps.map((step) => step.id)
    expect(stepIDs).toEqual([
      "design_analysis",
      "analyze_intent",
      "requirements",
      "architect",
      "build",
      "integrity",
    ])
    expect(pipeline!.steps.find((step) => step.id === "design_analysis")?.after).toEqual([])
    expect(pipeline!.steps.find((step) => step.id === "analyze_intent")?.after).toEqual(["design_analysis"])
    expect(pipeline!.steps.find((step) => step.id === "build")?.after).toEqual(["architect"])
    expect(pipeline!.steps.find((step) => step.id === "integrity")?.after).toEqual(["build"])
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
  })

  test("projects design_analysis as completed from PRD/SPEC decision log without visual rows", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `proj_workflow_design_${stamp}`
    const taskID = `tsk_workflow_design_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable).values({
        id: projectID,
        worktree: process.cwd(),
        name: "Workflow design step test",
        sandboxes: [],
        time_created: now,
        time_updated: now,
      }).run()
      db.insert(EngineTaskTable).values({
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
      }).run()
    })

    const log = createDecisionLog(taskID)
    for (const key of [
      "product_spec",
      "frontend_spec",
      "visual_consistency_spec",
      "backend_spec",
      "prd_iteration_notes",
      "completeness_review",
      "evidence_source_manifest",
    ]) {
      log.append({
        phase: "design_analysis",
        key,
        value: `${key} value`,
        reason: "test",
      })
    }

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.design_analysis?.status).toBe("completed")
  })

  test("projects integrity as completed when top-level pass has advisory concerns evidence", () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `proj_workflow_integrity_${stamp}`
    const taskID = `tsk_workflow_integrity_${stamp}`
    const specID = `spec_workflow_integrity_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable).values({
        id: projectID,
        worktree: process.cwd(),
        name: "Workflow integrity step test",
        sandboxes: [],
        time_created: now,
        time_updated: now,
      }).run()
      db.insert(EngineTaskTable).values({
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
      }).run()
      db.insert(EngineSpecSnapshotTable).values({
        id: specID,
        task_id: taskID,
        version: 1,
        status: "ready",
        summary: "Active spec",
        content: "spec",
        scope: "scope",
        time_created: now,
        time_updated: now,
      }).run()
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
      db.insert(ProjectTable).values({
        id: projectID,
        worktree: process.cwd(),
        name: "Workflow integrity failed projection test",
        sandboxes: [],
        time_created: now,
        time_updated: now,
      }).run()
      db.insert(EngineTaskTable).values({
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
      }).run()
      db.insert(EngineSpecSnapshotTable).values({
        id: specID,
        task_id: taskID,
        version: 1,
        status: "ready",
        summary: "Active spec",
        content: "spec",
        scope: "scope",
        time_created: now,
        time_updated: now,
      }).run()
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
      db.insert(ProjectTable).values({
        id: projectID,
        worktree: process.cwd(),
        name: "Workflow integrity concern correction projection test",
        sandboxes: [],
        time_created: now,
        time_updated: now,
      }).run()
      db.insert(EngineTaskTable).values({
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
      }).run()
      db.insert(EngineSpecSnapshotTable).values({
        id: specID,
        task_id: taskID,
        version: 1,
        status: "ready",
        summary: "Active spec",
        content: "spec",
        scope: "scope",
        time_created: now,
        time_updated: now,
      }).run()
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
