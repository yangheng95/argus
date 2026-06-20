import fs from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineSpecSnapshotTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { FRONTEND_DESIGN_COMPLETION_KEYS } from "../../src/frontend-design/handoff"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { recordIntegrityAttempt } from "../../src/engine/persist"
import {
  WorkflowRegistry,
  createWorkflowState,
  projectTaskSteps,
  renderWorkflowPrompt,
} from "../../src/engine/workflow"
import { createDecisionLog } from "../../src/decision-log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

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
    expect(text).toContain("所有 blocking build terminal 后、final acceptance 前的一次性 GUI")
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
      value: JSON.stringify({
        accepted: true,
        summary: "Full visual QA report accepted.",
        coverage: [
          {
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
        follow_up_task: null,
        repairs: [],
        evidence: [
          {
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
      }),
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

  test("does not project visual_qa as completed from bare accepted report JSON", () => {
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
      value: JSON.stringify({
        accepted: true,
        summary: "Bare accepted report should not project completion.",
        production_blockers: [],
      }),
      reason: "Malformed frontend GUI and functional QA report.",
    })

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.visual_qa?.status).toBe("failed")
  })

  test("does not project visual_qa as completed from reference parity report without comparison refs", () => {
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
      value: JSON.stringify({
        accepted: true,
        summary: "Report claimed acceptance but cited no comparison evidence.",
        production_blockers: [],
        reference_parity: {
          required: true,
          required_regions: ["region_header@desktop"],
          reference_comparison_evidence_refs: [],
          missing_regions: [],
        },
      }),
      reason: "Dedicated frontend GUI and functional QA report.",
    })

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.visual_qa?.status).toBe("failed")
  })

  test("does not project reference task visual_qa as completed when report claims parity is not required", () => {
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
      value: JSON.stringify({
        accepted: true,
        summary: "Screenshot-only report claimed parity not required.",
        coverage: [
          {
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
        follow_up_task: null,
        repairs: [],
        evidence: [
          {
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
      }),
      reason: "Dedicated frontend GUI and functional QA report.",
    })

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.visual_qa?.status).toBe("failed")
  })

  test("does not project visual_qa as completed when VisualEvidenceBundle alone requires reference parity", async () => {
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
        regions: [
          {
            id: "dashboard",
            label: "Dashboard",
            requirementIDs: ["REQ-1"],
            acceptanceSpecIDs: ["ACC-1"],
            sourceRefs: ["web-clone-source/reference.png"],
            viewport: "desktop",
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
      value: JSON.stringify({
        accepted: true,
        summary: "Screenshot-only report claimed parity not required.",
        coverage: [
          {
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
        follow_up_task: null,
        repairs: [],
        evidence: [
          {
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
      }),
      reason: "Dedicated frontend GUI and functional QA report.",
    })

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.visual_qa?.status).toBe("failed")
  })

  test("does not project reference task visual_qa as completed from unverified comparison ref strings", () => {
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
      value: JSON.stringify({
        accepted: true,
        summary: "Report cited unverified string refs.",
        coverage: [
          {
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
        follow_up_task: null,
        repairs: [],
        evidence: [
          {
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
      reason: "Dedicated frontend GUI and functional QA report.",
    })

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.visual_qa?.status).toBe("pending")
  })

  test("does not project visual_qa as completed from self-reported reference parity refs", () => {
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
      value: JSON.stringify({
        accepted: true,
        summary: "Report self-reported reference parity evidence.",
        coverage: [
          {
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
        follow_up_task: null,
        repairs: [],
        evidence: [
          {
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
      reason: "Dedicated frontend GUI and functional QA report.",
    })

    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const taskSteps = projectTaskSteps(taskID, pipeline)
    expect(taskSteps.visual_qa?.status).toBe("pending")
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
