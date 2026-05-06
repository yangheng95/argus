import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineSpecSnapshotTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { recordIntegrityAttempt } from "../../src/engine/persist"
import { WorkflowRegistry, projectTaskSteps } from "../../src/engine/workflow"
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
      "analyze_intent",
      "design_analysis",
      "requirements",
      "architect",
      "build",
      "integrity",
      "deliver",
    ])
    expect(pipeline!.steps.find((step) => step.id === "build")?.after).toEqual(["architect"])
    expect(pipeline!.steps.find((step) => step.id === "integrity")?.after).toEqual(["build"])
  })

  test("projects integrity as completed when the active spec has an integrity attempt", () => {
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
      specSnapshotID: specID,
      verdict: "pass",
      perDimension: [
        { id: "goal_fidelity", verdict: "pass" },
        { id: "technical_feasibility", verdict: "pass" },
        { id: "hallucination", verdict: "pass" },
        { id: "solution_quality", verdict: "pass" },
      ],
      issuesCount: 0,
      correctionsCount: 0,
      missingCount: 0,
      now,
    })

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.integrity?.status).toBe("completed")
    expect(taskSteps.build).toBeUndefined()
  })

  test("projects needs_correction integrity as completed (advisory; orchestrator decides)", () => {
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
      specSnapshotID: specID,
      verdict: "needs_correction",
      perDimension: [
        { id: "goal_fidelity", verdict: "pass" },
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
    // C2 (spec architecture-rework-loosening-plan-2026-05-06.md): integrity
    // is advisory — needs_correction is NOT a workflow failure. The full
    // review markdown is surfaced to the orchestrator LLM via build tool
    // result + read_context; the LLM decides whether the findings warrant
    // any action.
    expect(taskSteps.integrity?.status).toBe("completed")
  })

  test("projects concerns with correction work as completed (advisory; orchestrator decides)", () => {
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

    recordIntegrityAttempt({
      taskID,
      sessionID: "ses_integrity_projection_concern_failed",
      specSnapshotID: specID,
      verdict: "concerns",
      perDimension: [
        { id: "goal_fidelity", verdict: "concerns" },
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
    // C2: concerns + correction count > 0 is no longer a workflow failure.
    // The orchestrator LLM reads the markdown and decides.
    expect(taskSteps.integrity?.status).toBe("completed")
  })
})
