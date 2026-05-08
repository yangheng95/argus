import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Database, and, eq } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineArtifactTable, EngineGoalTable, EnginePlanNodeTable, EnginePlanVersionTable, EngineRequirementTable, EngineSpecSnapshotTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { createDecisionLog } from "../../src/decision-log"
import { createWorkflowState, WorkflowRegistry } from "../../src/engine/workflow"
import { createOrchestratorTools } from "../../src/orchestrator/tools"
import { goalStatusByID } from "../../src/engine/describe"
import { Session } from "../../src/session"
import { SessionTable } from "../../src/session/session.sql"
import { beginBuildAttempt, insertRequirements, recordIntegrityAttempt, startNewAttempt, updateGoalRun } from "../../src/engine/persist"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { findActivePlanForTask, findActiveSpecForTask, findGoal, findGoalLatestWorkspace, findLatestIntegrityAttemptArtifact, findRequirements, listGoalRunsByGoal } from "../../src/engine/store"
import { seedGoalRunAttemptWithWorkspace } from "../fixture/goal-run-attempt"
import { Filesystem } from "../../src/util/filesystem"

let buildAgentRunImpl: ((input: any) => Promise<any>) | undefined
let reviewIntegrityImpl: ((input: any) => Promise<any>) | undefined
let architectCoordinateImpl: ((input: any) => Promise<any>) | undefined
let deliveryServiceVerifyImpl: ((input: any) => Promise<any>) | undefined
let designAnalyzeImpl: ((input: any) => Promise<any>) | undefined

mock.module("@/build/agent", () => ({
  BuildAgent: {
    run: (input: any) => {
      if (!buildAgentRunImpl) throw new Error("BuildAgent.run mock not configured")
      return buildAgentRunImpl(input)
    },
  },
}))

mock.module("@/integrity", () => ({
  reviewIntegrity: (input: any) => {
    if (!reviewIntegrityImpl) throw new Error("reviewIntegrity mock not configured")
    return reviewIntegrityImpl(input)
  },
}))

mock.module("@/architect/agent", () => ({
  ArchitectAgent: {
    coordinate: (input: any) => {
      if (!architectCoordinateImpl) throw new Error("ArchitectAgent.coordinate mock not configured")
      return architectCoordinateImpl(input)
    },
  },
}))

mock.module("@/design-analyst", () => ({
  DesignAnalystAgent: {
    analyze: (input: any) => {
      if (!designAnalyzeImpl) throw new Error("DesignAnalystAgent.analyze mock not configured")
      return designAnalyzeImpl(input)
    },
  },
}))

mock.module("@/delivery/service", () => ({
  DeliveryFailureError: class DeliveryFailureError extends Error {},
  DeliveryService: {
    verify: (input: any) => {
      if (!deliveryServiceVerifyImpl) throw new Error("DeliveryService.verify mock not configured")
      return deliveryServiceVerifyImpl(input)
    },
  },
}))

async function markBuildSlotAcquired(input: any) {
  await input.onSlotAcquired?.()
}

function insertWorkflowTaskWithGoal(input: {
  projectID: string
  taskID: string
  goalID: string
  sessionID: string | null
  worktree: string
  projectName: string
  taskTitle: string
  request: string
  goalTitle: string
  goalSlug: string
  objective: string
  now: number
  workspaceDir?: string
  workspaceBranch?: string
  specID?: string
}) {
  const specID = input.specID ?? `spec_${input.goalID}`
  Database.use((db) => {
    db.insert(ProjectTable).values({
      id: input.projectID,
      worktree: input.worktree,
      name: input.projectName,
      sandboxes: "[]",
      time_created: input.now,
      time_updated: input.now,
    }).run()
    db.insert(EngineTaskTable).values({
      id: input.taskID,
      project_id: input.projectID,
      session_id: input.sessionID,
      source: "test",
      title: input.taskTitle,
      request: input.request,
      kind: "workflow",
      priority: "normal",
      time_created: input.now,
      time_updated: input.now,
      time_started: input.now,
    }).run()
    db.insert(EngineSpecSnapshotTable).values({
      id: specID,
      task_id: input.taskID,
      version: 1,
      status: "ready",
      summary: `${input.goalTitle} spec`,
      content: input.request,
      scope: input.objective,
      time_created: input.now,
      time_updated: input.now,
    }).run()
    db.insert(EngineGoalTable).values({
      id: input.goalID,
      task_id: input.taskID,
      spec_snapshot_id: specID,
      title: input.goalTitle,
      slug: input.goalSlug,
      objective: input.objective,
      acceptance_specs: [],
      owned_paths: ["src/index.ts"],
      depends_on: [],
      exports: [],
      imports: [],
      kind: "feature",
      requirement_ids: [],
      priority: "blocking",
      source: "test",
      status: "pending",
      order_index: 0,
      time_created: input.now,
      time_updated: input.now,
    }).run()
  })
  // Phase H (2026-05-05): seed via the shared fixture helper instead of an
  // ad-hoc Drizzle insert (rule 9 — single abstraction for the same shape
  // also used in engine/writer.test.ts).
  if (input.workspaceDir !== undefined || input.workspaceBranch !== undefined) {
    seedGoalRunAttemptWithWorkspace({
      taskID: input.taskID,
      goalID: input.goalID,
      workspaceDir: input.workspaceDir ?? null,
      workspaceBranch: input.workspaceBranch ?? null,
      status: "queued",
      now: input.now,
    })
  }
}

describe("orchestrator tools", () => {
  let tmp: Awaited<ReturnType<typeof tmpdir>>

  beforeEach(async () => {
    await resetDatabase()
    tmp = await tmpdir()
    architectCoordinateImpl = undefined
    reviewIntegrityImpl = async () => ({
      verdict: "pass",
      summary: "Integrity pass",
      dimensions: [
        { id: "goal_fidelity", verdict: "pass", issues: [] },
        { id: "technical_feasibility", verdict: "pass", issues: [] },
        { id: "hallucination", verdict: "pass", issues: [] },
        { id: "solution_quality", verdict: "pass", issues: [] },
      ],
      issues: [],
      corrections: [],
      missingGoals: [],
      sessionID: "ses_integrity_default",
    })
  })

  afterEach(async () => {
    buildAgentRunImpl = undefined
    reviewIntegrityImpl = undefined
    architectCoordinateImpl = undefined
    deliveryServiceVerifyImpl = undefined
    designAnalyzeImpl = undefined
    mock.restore()
    await resetDatabase()
    await tmp?.[Symbol.asyncDispose]?.()
  })

  test("workflow tasks reject task-level build before delivery rework", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_build_${stamp}`
    const taskID = `tsk_build_${stamp}`
    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const workflowState = createWorkflowState(pipeline)

    Database.use((db) => {
      db.insert(ProjectTable).values({
        id: projectID,
        worktree: process.cwd(),
        name: "Build workflow contract test",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      }).run()
      db.insert(EngineTaskTable).values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "Build workflow contract task",
        request: "Verify workflow task-level build cannot bypass requirements and architect",
        kind: "workflow",
        priority: "normal",
        time_created: now,
        time_updated: now,
        time_started: now,
      }).run()
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "build workflow test" })

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
          workflow: pipeline,
          workflowState,
        })

        const result = await tools.build.execute({
          request: "Implement the page directly.",
          reason: "Try to bypass the workflow.",
        }, {} as any)

        expect(result).toContain("rejected task-level build")
        expect(result).toContain("kind=workflow")
        expect(result).toContain("requirements, architect, and per-goal build")
        expect(workflowState.workflowID).toBe("pipeline")
      },
    })
  })

  test("visual reference tasks require design_analysis before downstream stages", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_visual_gate_${stamp}`
    const taskID = `tsk_visual_gate_${stamp}`
    const goalID = `gol_visual_gate_${stamp}`
    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const workflowState = createWorkflowState(pipeline)

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "Visual gate project",
      taskTitle: "Visual gate task",
      request: "复刻 https://example.com/dashboard 的完整前后端页面",
      goalTitle: "Implement visual page",
      goalSlug: "implement-visual-page",
      objective: "Implement the page from the visual reference",
      now,
    })

    buildAgentRunImpl = async () => {
      throw new Error("build must not run before design_analysis")
    }
    architectCoordinateImpl = async () => {
      throw new Error("architect must not run before design_analysis")
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "visual gate test" })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
          workflow: pipeline,
          workflowState,
        })

        const requirementsResult = await tools.requirements.execute({ reason: "Need requirements" }, {} as any)
        expect(requirementsResult).toContain("blocked")
        expect(requirementsResult).toContain("design_analysis")
        expect(requirementsResult).toContain("evidence_source_manifest")
        expect(findActiveSpecForTask(taskID)).toBeDefined()

        const intentResult = await tools.analyze_intent.execute({ reason: "Need intent reading" }, {} as any)
        expect(intentResult).toContain("blocked")
        expect(intentResult).toContain("design_analysis")
        expect(intentResult).toContain("evidence_source_manifest")

        const architectResult = await tools.architect.execute({ reason: "Need goals" }, {} as any)
        expect(architectResult).toContain("blocked")
        expect(architectResult).toContain("design_analysis")

        const buildResult = await tools.build.execute({
          goalID,
          reason: "Try to build visual goal",
        }, {} as any)
        expect(buildResult).toContain("blocked")
        expect(buildResult).toContain("design_analysis")
        expect(buildResult).toContain("evidence_source_manifest")
      },
    })
  })

  test("design_analysis materializes PRD/SPEC and source manifest files", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_design_files_${stamp}`
    const taskID = `tsk_design_files_${stamp}`
    const goalID = `gol_design_files_${stamp}`
    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const workflowState = createWorkflowState(pipeline)

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "Design files project",
      taskTitle: "Design files task",
      request: "复刻 https://example.com/amd 的完整前后端页面",
      goalTitle: "Implement visual page",
      goalSlug: "implement-visual-page",
      objective: "Implement the page from the visual reference",
      now,
    })
    Database.use((db) => {
      db.update(EngineTaskTable)
        .set({
          attachments: [{
            sha: "sha-design-reference",
            url: "attachment://design-reference.png",
            mime: "image/png",
            size: 42,
            filename: "design-reference.png",
            intent: "visual_reference",
            source: "user-upload",
          }],
        })
        .where(eq(EngineTaskTable.id, taskID))
        .run()
    })

    designAnalyzeImpl = async () => ({
      specs: [],
      designSystem: "Reference design system",
      techStack: ["React", "Bun"],
      productSpec: "Product Requirements Document body",
      frontendSpec: "Frontend specification body",
      visualConsistencySpec: "Match reference layout, typography, colors, and spacing exactly.",
      backendSpec: "Backend API mock contract",
      prdIterationNotes: ["First pass covered layout.", "Second pass covered visual consistency."],
      completenessReview: "Complete enough for downstream implementation.",
      referenceArtifacts: ["mirror/reference.png", "mirror/page-ir.xml"],
      openQuestions: ["Live feed authentication is unknown."],
      sessionID: "ses_design_analysis_mock",
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "design files test" })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
          workflow: pipeline,
          workflowState,
        })

        const result = await tools.design_analysis.execute({ reason: "visual replica requires source PRD" }, {} as any)
        expect(result).toContain("prd_spec_file")
        expect(result).toContain(".opencorvus")

        const prdPath = path.join(tmp.path, ".opencorvus", "design-analysis", "prd-spec.md")
        const manifestPath = path.join(tmp.path, ".opencorvus", "design-analysis", "evidence-source-manifest.md")
        const prd = await fs.readFile(prdPath, "utf8")
        const manifest = await fs.readFile(manifestPath, "utf8")
        expect(prd).toContain("## Visual Consistency Spec")
        expect(prd).toContain("Match reference layout, typography, colors, and spacing exactly.")
        expect(prd).toContain(".opencorvus/design-analysis/evidence-source-manifest.md")
        expect(manifest).toContain("Canonical PRD/SPEC file: .opencorvus/design-analysis/prd-spec.md")
        expect(manifest).toContain("design-reference.png")
        expect(manifest).toContain("mirror/reference.png")
      },
    })
  })

  test("goal build re-reads dependency status before dispatch", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_build_dep_guard_${stamp}`
    const taskID = `tsk_build_dep_guard_${stamp}`
    const parentGoalID = `gol_dep_parent_${stamp}`
    const childGoalID = `gol_dep_child_${stamp}`
    const specID = `spec_dep_guard_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID: parentGoalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "Dependency guard project",
      taskTitle: "Dependency guard task",
      request: "Build dependent goals only after dependencies are still passed.",
      goalTitle: "Shared contract",
      goalSlug: "shared-contract",
      objective: "Provide shared code for child goals.",
      now,
      specID,
    })
    Database.use((db) => {
      db.insert(EngineGoalTable).values({
        id: childGoalID,
        task_id: taskID,
        spec_snapshot_id: specID,
        title: "Dependent feature",
        slug: "dependent-feature",
        objective: "Consume the shared contract.",
        acceptance_specs: [],
        owned_paths: ["src/feature.ts"],
        depends_on: [parentGoalID],
        exports: [],
        imports: [],
        kind: "feature",
        requirement_ids: [],
        priority: "blocking",
        source: "test",
        status: "pending",
        order_index: 1,
        time_created: now,
        time_updated: now,
      }).run()
    })
    seedGoalRunAttemptWithWorkspace({
      taskID,
      goalID: parentGoalID,
      workspaceDir: null,
      workspaceBranch: null,
      status: "completed",
      now,
    })
    startNewAttempt({
      goalID: parentGoalID,
      reason: "architecture_review_rework",
      now: now + 1,
      feedback: {
        value: "architecture review requires the dependency to be reworked",
        reason: "test dependency closure",
      },
    })
    expect(goalStatusByID(parentGoalID)).toBe("pending")

    let buildStarted = false
    buildAgentRunImpl = async () => {
      buildStarted = true
      return { status: "passed", summary: "should not run", files_changed: [], tests: [] }
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "dependency guard test" })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute({
          goalID: childGoalID,
          reason: "stale orchestrator view",
        }, {} as any)

        expect(result).toContain("blocked by unfinished dependencies")
        expect(result).toContain(`${parentGoalID}=pending`)
        expect(buildStarted).toBe(false)
        expect(listGoalRunsByGoal(childGoalID)).toHaveLength(0)
      },
    })
  })

  test("architect does not start without an active requirements spec snapshot", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_architect_requires_spec_${stamp}`
    const taskID = `tsk_architect_requires_spec_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable).values({
        id: projectID,
        worktree: process.cwd(),
        name: "Architect requirements preflight test",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      }).run()
      db.insert(EngineTaskTable).values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "Architect requirements preflight task",
        request: "Verify architect cannot run after requirements spec is cleared",
        kind: "workflow",
        priority: "normal",
        time_created: now,
        time_updated: now,
        time_started: now,
      }).run()
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "architect preflight test" })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.architect.execute({}, {} as any)

        expect(result).toContain("no active requirements spec snapshot")
        expect(result).toContain("requirements")
        const architectSessions = Database.use((db) =>
          db.select().from(SessionTable).where(eq(SessionTable.kind, "architect")).all(),
        )
        expect(architectSessions).toHaveLength(0)
      },
    })
  })

  test("architect promotion keeps requirements attached to the active spec", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_architect_requirement_copy_${stamp}`
    const taskID = `tsk_architect_requirement_copy_${stamp}`
    const reqSpecID = `spec_requirements_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable).values({
        id: projectID,
        worktree: process.cwd(),
        name: "Architect requirement copy test",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      }).run()
      db.insert(EngineTaskTable).values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "Architect requirement copy task",
        request: "Build a typed app shell",
        kind: "workflow",
        priority: "normal",
        time_created: now,
        time_updated: now,
        time_started: now,
      }).run()
      db.insert(EngineSpecSnapshotTable).values({
        id: reqSpecID,
        task_id: taskID,
        version: 1,
        status: "ready",
        summary: "Requirements parsed",
        content: "# Requirements\n- REQ-1 typed app shell",
        scope: "typed app shell",
        time_created: now,
        time_updated: now,
      }).run()
      insertRequirements(db, {
        taskID,
        specSnapshotID: reqSpecID,
        now,
        requirements: [{
          id: "REQ-1",
          title: "Typed app shell",
          description: "The app shell renders and typechecks.",
          acceptance: ["typecheck passes"],
          evidence_refs: ["user request"],
          priority: "blocking",
        }],
      })
    })

    architectCoordinateImpl = async (input: any) => {
      expect(input.requirements.map((r: any) => r.id)).toEqual(["REQ-1"])
      return {
        summary: "One goal architecture.",
        goals: [{
          id: "goal_app_shell",
          title: "App shell",
          objective: "Implement a typed app shell.",
          acceptance_specs: [{
            id: "acc-app-shell",
            source_requirement_id: "REQ-1",
            goal_id: "goal_app_shell",
            title: "typecheck passes",
            scorers: [{
              type: "llm_judge",
              name: "typecheck evidence",
              criteria: "The app shell typechecks.",
            }],
            severity: "essential",
          }],
          owned_paths: ["src/App.tsx"],
          depends_on: [],
          exports: ["AppShell"],
          imports: [],
          kind: "bootstrap",
          requirement_ids: ["REQ-1"],
          priority: "blocking",
        }],
        removedGoalIDs: [],
        traceability: [{ requirementID: "REQ-1", goalIDs: ["goal_app_shell"] }],
        fidelity: { sourceCoverage: [], referenceCoverage: [], assemblyOwners: [] },
        contracts: [],
      }
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "architect requirement copy test" })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.architect.execute({}, {} as any)
        expect(result).toContain("Architect decomposition complete")

        const activeSpec = findActiveSpecForTask(taskID)
        expect(activeSpec?.id).toBeTruthy()
        expect(activeSpec?.id).not.toBe(reqSpecID)
        const activeRequirements = findRequirements(activeSpec!.id)
        expect(activeRequirements.map((r) => r.description)).toEqual(["The app shell renders and typechecks."])
        expect(activeRequirements[0]?.metadata).toMatchObject({ source_requirement_id: "REQ-1" })

        const sourceRows = Database.use((db) =>
          db.select().from(EngineRequirementTable).where(eq(EngineRequirementTable.spec_snapshot_id, reqSpecID)).all(),
        )
        expect(sourceRows).toHaveLength(1)
      },
    })
  })

  test("publish gate failures remain rework feedback instead of terminal task failures", async () => {
    const source = await fs.readFile(path.join(import.meta.dir, "../../src/orchestrator/tools.ts"), "utf8")

    expect(source).toContain("publishGateReworkResult")
    expect(source).not.toContain('await updateTask(currentTask, { status: "failed", error: publishResult.summary')
    expect(source).not.toContain('await updateTask(task, { status: "failed", error: result.summary')
  })

  test("goal build runs first, then records architecture review feedback", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_goal_integrity_${stamp}`
    const taskID = `tsk_goal_integrity_${stamp}`
    const goalID = `goal_integrity_${stamp}`
    let architectureReviewCalls = 0
    let buildCalls = 0
    let buildTarget: any

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal integrity build test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Goal integrity build test",
          taskTitle: "Goal integrity build task",
          request: "Build a scoped goal with complete context",
          goalTitle: "Build with architecture review",
          goalSlug: "build-with-architecture-review",
          objective: "Verify build runs before architecture review feedback is recorded",
          now,
        })

        reviewIntegrityImpl = async () => {
          architectureReviewCalls += 1
          return {
            verdict: "pass",
            summary: "Integrity pass",
            dimensions: [
              { id: "goal_fidelity", verdict: "pass", issues: [] },
              { id: "technical_feasibility", verdict: "pass", issues: [] },
              { id: "hallucination", verdict: "pass", issues: [] },
              { id: "solution_quality", verdict: "pass", issues: [] },
            ],
            issues: [],
            corrections: [],
            missingGoals: [],
            sessionID: "ses_integrity_auto",
          }
        }
        buildAgentRunImpl = async (input: any) => {
          await markBuildSlotAcquired(input)
          buildCalls += 1
          buildTarget = input.target
          return {
            result: {
              status: "passed",
              summary: "Goal built successfully",
              files_changed: [{
                path: "src/index.ts",
                summary: "Changed scoped implementation file.",
                reason: "Required by the mocked goal build.",
              }],
              tests: [],
              commit_ref: "abc1234",
            },
            sessionID: "ses_goal_integrity_build",
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute({
          goalID,
          reason: "Per-goal pipeline execution.",
        }, {} as any)

        // Wave-level review (B-wave / spec architecture-rework-loosening
        // -plan-2026-05-06.md): build tool no longer triggers architecture
        // review per goal. The build report no longer carries
        // `architecture_review:` text — orchestrator calls `integrity`
        // explicitly at wave boundaries. Verify review is NOT auto-run
        // and the next-step prompt directs the LLM to call integrity.
        expect(result).toContain("status=passed")
        expect(result).not.toContain("architecture_review:")
        expect(result).toContain("call `integrity`")
        expect(buildCalls).toBe(1)
        expect(buildTarget).toMatchObject({
          kind: "goal",
          id: goalID,
          objective: "Verify build runs before architecture review feedback is recorded",
        })
        // Architecture review is no longer triggered by the build tool —
        // orchestrator drives it explicitly per wave.
        expect(architectureReviewCalls).toBe(0)
        const artifact = findLatestIntegrityAttemptArtifact({ taskID, specSnapshotID: `spec_${goalID}` })
        expect(artifact).toBeUndefined()
      },
    })
  })

  test("concurrent integrity calls share one review for the active spec", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_integrity_singleflight_${stamp}`
    const taskID = `tsk_integrity_singleflight_${stamp}`
    const goalID = `goal_integrity_singleflight_${stamp}`
    let reviewCalls = 0
    let releaseReview!: () => void
    const reviewGate = new Promise<void>((resolve) => {
      releaseReview = resolve
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "integrity singleflight test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Integrity singleflight test",
          taskTitle: "Integrity singleflight task",
          request: "Review a shared architecture graph once",
          goalTitle: "Shared review goal",
          goalSlug: "shared-review-goal",
          objective: "Verify concurrent review callers share the same integrity result",
          now,
        })

        reviewIntegrityImpl = async () => {
          reviewCalls += 1
          await reviewGate
          return {
            verdict: "pass",
            summary: "Integrity pass",
            dimensions: [
              { id: "goal_fidelity", verdict: "pass", issues: [] },
              { id: "technical_feasibility", verdict: "pass", issues: [] },
              { id: "hallucination", verdict: "pass", issues: [] },
              { id: "solution_quality", verdict: "pass", issues: [] },
            ],
            issues: [],
            corrections: [],
            missingGoals: [],
            sessionID: "ses_integrity_singleflight",
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const combined = Promise.all([
          tools.integrity.execute({ reason: "post-build review A" }, {} as any),
          tools.integrity.execute({ reason: "post-build review B" }, {} as any),
        ])
        for (let i = 0; i < 20 && reviewCalls === 0; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 5))
        }
        expect(reviewCalls).toBe(1)

        releaseReview()
        const [firstResult, secondResult] = await combined
        expect(firstResult).toContain("Integrity verdict: pass")
        expect(secondResult).toContain("Integrity verdict: pass")
        expect(reviewCalls).toBe(1)

        const attempts = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(and(
              eq(EngineArtifactTable.task_id, taskID),
              eq(EngineArtifactTable.kind, "integrity_attempt"),
            ))
            .all(),
        )
        expect(attempts).toHaveLength(1)
      },
    })
  })

  test("goal build receives the complete architecture protocol, not only its local slice", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_goal_arch_context_${stamp}`
    const taskID = `tsk_goal_arch_context_${stamp}`
    const goalID = `goal_arch_context_${stamp}`
    const siblingGoalID = `goal_arch_sibling_${stamp}`
    let capturedContext: any

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal architecture context test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Goal architecture context test",
          taskTitle: "Goal architecture context task",
          request: "Build a scoped goal with the full architecture protocol",
          goalTitle: "Feature implementation",
          goalSlug: "feature-implementation",
          objective: "Implement the feature without breaking sibling architecture contracts",
          now,
        })

        Database.use((db) => {
          db.insert(EngineGoalTable).values({
            id: siblingGoalID,
            task_id: taskID,
            spec_snapshot_id: `spec_${goalID}`,
            title: "Shared shell",
            slug: "shared-shell",
            objective: "Provide the shared shell consumed by feature goals",
            acceptance_specs: [{
              id: `acc_shell_${stamp}`,
              source_requirement_id: "REQ-1",
              goal_id: siblingGoalID,
              title: "shell exports AppShell",
              scorers: [{
                type: "llm_judge",
                name: "shell contract",
                criteria: "The shared shell renders and exports AppShell for feature goals.",
              }],
              severity: "essential",
            }],
            owned_paths: ["src/App.tsx", "src/main.tsx"],
            depends_on: [],
            exports: ["AppShell"],
            imports: [],
            kind: "bootstrap",
            requirement_ids: [],
            priority: "blocking",
            source: "test",
            status: "pending",
            order_index: 1,
            time_created: now,
            time_updated: now,
          }).run()
          db.update(EngineTaskTable)
            .set({
              metadata: {
                architect_fidelity: {
                  sourceCoverage: [{
                    id: "sibling-source",
                    paths: ["src/App.tsx"],
                    goal_ids: [siblingGoalID],
                    action: "modify",
                    rationale: "The shell source must remain the shared integration surface.",
                  }],
                  referenceCoverage: [{
                    id: "sibling-reference",
                    surface: "shared shell",
                    goal_ids: [siblingGoalID],
                    visual_spec_ids: [],
                    expectation: "The shell reference remains binding for every feature goal.",
                  }],
                  assemblyOwners: [{
                    surface: "app",
                    goal_id: siblingGoalID,
                    rationale: "The shell owns final app assembly.",
                  }],
                },
              },
              time_updated: now,
            })
            .where(eq(EngineTaskTable.id, taskID))
            .run()
        })

        const { createDecisionLog } = await import("../../src/decision-log")
        const decisionLog = createDecisionLog(taskID)
        decisionLog.append({
          phase: "architect",
          goalID: siblingGoalID,
          key: "shell_contract",
          value: "## Shell exports\nShared shell owns AppShell and feature goals must preserve that export.",
          reason: "Architect sibling contract",
        })

        buildAgentRunImpl = async (input: any) => {
          await markBuildSlotAcquired(input)
          capturedContext = input.context
          return {
            result: {
              status: "passed",
              summary: "Goal built with full architecture context",
              files_changed: [{
                path: "src/index.ts",
                summary: "Changed scoped implementation file.",
                reason: "Required by the mocked goal build.",
              }],
              tests: [],
              commit_ref: "abc1234",
            },
            sessionID: "ses_goal_arch_context_build",
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute({
          goalID,
          request: "Implement the goal",
          reason: "Per-goal pipeline execution.",
        }, {} as any)

        expect(result).toContain("status=passed")
        expect(capturedContext?.architectContracts?.map((c: any) => c.goalIDs?.[0])).toContain(siblingGoalID)
        expect(capturedContext?.collaborationGoals?.find((g: any) => g.id === siblingGoalID)?.objective).toContain("shared shell")
        expect(
          capturedContext?.collaborationGoals
            ?.find((g: any) => g.id === siblingGoalID)
            ?.acceptance_specs
            ?.some((spec: string) => spec.includes("shell exports AppShell")),
        ).toBe(true)
        expect(capturedContext?.fidelity?.sourceCoverage?.map((row: any) => row.id)).toContain("sibling-source")
        expect(capturedContext?.fidelity?.referenceCoverage?.map((row: any) => row.id)).toContain("sibling-reference")
        expect(capturedContext?.fidelity?.assemblyOwners?.map((row: any) => row.goal_id)).toContain(siblingGoalID)
      },
    })
  })

  test("post-build architecture review never rewrites the active goal graph", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_goal_integrity_block_${stamp}`
    const taskID = `tsk_goal_integrity_block_${stamp}`
    const goalID = `goal_integrity_block_${stamp}`
    let buildCalls = 0

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal integrity correction test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Goal integrity correction test",
          taskTitle: "Goal integrity correction task",
          request: "Do not let architecture review mutate the goal graph",
          goalTitle: "Review without graph mutation",
          goalSlug: "review-without-graph-mutation",
          objective: "Verify post-build review opens rework but does not rewrite goals",
          now,
        })

        reviewIntegrityImpl = async () => ({
          verdict: "needs_correction",
          summary: "Goal graph must change",
          dimensions: [
            { id: "goal_fidelity", verdict: "needs_correction", issues: [{ description: "Split the goal", type: "coverage_gap" }] },
            { id: "technical_feasibility", verdict: "pass", issues: [] },
            { id: "hallucination", verdict: "pass", issues: [] },
            { id: "solution_quality", verdict: "needs_correction", issues: [{ description: "Current goal is too broad", type: "granularity" }] },
          ],
          issues: [{ description: "Split the goal", type: "coverage_gap" }],
          corrections: [{ type: "split_goal" }],
          missingGoals: [],
          sessionID: "ses_integrity_corrected",
        })
        buildAgentRunImpl = async (input: any) => {
          await markBuildSlotAcquired(input)
          buildCalls += 1
          return {
            result: {
              status: "passed",
              summary: "Goal built before architecture review feedback.",
              files_changed: [{
                path: "src/index.ts",
                summary: "Changed scoped implementation file.",
                reason: "Required by the mocked goal build.",
              }],
              tests: [],
              commit_ref: "abc1234",
            },
            sessionID: "ses_goal_review_after_build",
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute({
          goalID,
          request: "Implement the goal",
          reason: "Per-goal pipeline execution.",
        }, {} as any)

        // Post-fix (B-wave): build tool does NOT trigger architecture review
        // (it was per-goal and noisy). Orchestrator calls `integrity` itself
        // at wave boundaries. Goals stay where they are; no auto-supersede,
        // no auto-rework.
        expect(result).toContain("status=passed")
        expect(result).not.toContain("architecture_review:")
        expect(result).not.toContain("### Architecture review")
        expect(result).not.toContain("architecture_review_rework: opened")
        expect(result).toContain("call `integrity`")
        expect(buildCalls).toBe(1)
        const runs = listGoalRunsByGoal(goalID)
        expect(runs).toHaveLength(1)
        expect(runs[0]?.superseded_reason).toBeFalsy()
        expect(findGoal(goalID)).toBeTruthy()
      },
    })
  })

  test("post-build architecture concerns open targeted rework instead of passive delivery", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_goal_review_concern_${stamp}`
    const taskID = `tsk_goal_review_concern_${stamp}`
    const goalID = `goal_review_concern_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal review concern test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Goal review concern test",
          taskTitle: "Goal review concern task",
          request: "Architecture concerns must drive rework before delivery",
          goalTitle: "Review concerns are actionable",
          goalSlug: "review-concerns-actionable",
          objective: "Verify post-build concerns are not a no-op",
          now,
        })

        reviewIntegrityImpl = async () => ({
          verdict: "concerns",
          summary: "Shared shell contract is underspecified",
          dimensions: [
            {
              id: "goal_fidelity",
              verdict: "concerns",
              issues: [{ description: "Sibling handoff is ambiguous", type: "coverage_gap", goalIDs: [goalID] }],
            },
            { id: "technical_feasibility", verdict: "pass", issues: [] },
            { id: "hallucination", verdict: "pass", issues: [] },
            { id: "solution_quality", verdict: "pass", issues: [] },
          ],
          issues: [{ description: "Sibling handoff is ambiguous", type: "coverage_gap", goalIDs: [goalID] }],
          corrections: [],
          missingGoals: [],
          sessionID: "ses_integrity_concern",
        })
        buildAgentRunImpl = async (input: any) => {
          await markBuildSlotAcquired(input)
          return {
            result: {
              status: "passed",
              summary: "Goal built with an ambiguous handoff.",
              files_changed: [{
                path: "src/index.ts",
                summary: "Changed scoped implementation file.",
                reason: "Required by the mocked goal build.",
              }],
              tests: [],
              commit_ref: "def5678",
            },
            sessionID: "ses_goal_review_concern",
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute({
          goalID,
          request: "Implement the goal",
          reason: "Per-goal pipeline execution.",
        }, {} as any)

        // Post-fix (B-wave): build tool no longer auto-runs architecture
        // review. Orchestrator drives integrity per wave. No supersede.
        expect(result).not.toContain("architecture_review:")
        expect(result).not.toContain("### Architecture review")
        expect(result).not.toContain("architecture_review_rework: opened")
        expect(result).toContain("call `integrity`")
        expect(listGoalRunsByGoal(goalID)[0]?.superseded_reason).toBeFalsy()
      },
    })
  })

  test("post-build architecture review routes sibling goal findings to the named goal", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_goal_review_sibling_${stamp}`
    const taskID = `tsk_goal_review_sibling_${stamp}`
    const goalID = `goal_review_source_${stamp}`
    const siblingGoalID = `goal_review_target_${stamp}`
    const specID = `spec_${goalID}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal review sibling route test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Goal review sibling route test",
          taskTitle: "Goal review sibling route task",
          request: "Architecture review must route findings to the affected goal",
          goalTitle: "Bootstrap goal",
          goalSlug: "bootstrap-goal",
          objective: "Build the bootstrap goal",
          now,
          specID,
        })
        Database.use((db) =>
          db.insert(EngineGoalTable).values({
            id: siblingGoalID,
            task_id: taskID,
            spec_snapshot_id: specID,
            title: "Feature goal",
            slug: "feature-goal",
            objective: "Build the feature goal",
            acceptance_specs: [],
            owned_paths: ["src/feature.ts"],
            depends_on: [],
            exports: [],
            imports: [],
            kind: "feature",
            requirement_ids: [],
            priority: "blocking",
            source: "test",
            status: "pending",
            order_index: 1,
            time_created: now,
            time_updated: now,
          }).run(),
        )
        Database.use((db) =>
          db.update(EngineTaskTable).set({
            metadata: {
              architect_fidelity: {
                sourceCoverage: [{
                  id: "src-test",
                  paths: ["package.json"],
                  goal_ids: [goalID],
                  action: "modify",
                  rationale: "test fixture source coverage",
                }],
                referenceCoverage: [],
                assemblyOwners: [{
                  surface: "test-app",
                  goal_id: siblingGoalID,
                  rationale: "test fixture assembly owner",
                }],
              },
            },
          }).where(eq(EngineTaskTable.id, taskID)).run(),
        )

        reviewIntegrityImpl = async () => ({
          verdict: "concerns",
          summary: "Feature acceptance is underspecified",
          dimensions: [
            {
              id: "goal_fidelity",
              verdict: "pass",
              issues: [],
            },
            { id: "technical_feasibility", verdict: "pass", issues: [] },
            { id: "hallucination", verdict: "pass", issues: [] },
            {
              id: "solution_quality",
              verdict: "concerns",
              issues: [{
                description: "Feature goal acceptance depends on bootstrap details",
                type: "weak_acceptance",
                goalIDs: [siblingGoalID],
              }],
            },
          ],
          issues: [{
            description: "Feature goal acceptance depends on bootstrap details",
            type: "weak_acceptance",
            goalIDs: [siblingGoalID],
          }],
          corrections: [],
          missingGoals: [],
          sessionID: "ses_integrity_sibling",
        })
        buildAgentRunImpl = async (input: any) => {
          await markBuildSlotAcquired(input)
          return {
            result: {
              status: "passed",
              summary: "Bootstrap goal built successfully.",
              files_changed: [{
                path: "package.json",
                summary: "Updated package scripts.",
                reason: "Required by the bootstrap goal.",
              }],
              tests: [],
              commit_ref: "abc5678",
            },
            sessionID: "ses_goal_review_sibling",
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute({
          goalID,
          request: "Implement the bootstrap goal",
          reason: "Per-goal pipeline execution.",
        }, {} as any)

        // Post-fix (B-wave): build tool no longer triggers review. The
        // build report carries no architecture_review section; orchestrator
        // calls `integrity` per wave to surface sibling-goal findings via
        // the integrity tool result + decision_log.
        expect(result).not.toContain("architecture_review:")
        expect(result).not.toContain("### Architecture review")
        expect(result).not.toContain(`goal=${goalID} superseded_tip`)
        expect(result).toContain("call `integrity`")
        // No auto-supersede.
        expect(goalStatusByID(goalID)).toBe("passed")
        expect(listGoalRunsByGoal(goalID)[0]?.superseded_reason).toBeFalsy()
      },
    })
  })

  test("post-build architecture rework invalidates live dependent goals", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_goal_review_cascade_${stamp}`
    const taskID = `tsk_goal_review_cascade_${stamp}`
    const goalID = `goal_review_root_${stamp}`
    const childGoalID = `goal_review_child_${stamp}`
    const specID = `spec_${goalID}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal review dependency cascade test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Goal review cascade route test",
          taskTitle: "Goal review cascade route task",
          request: "Architecture review must close over already-running dependents",
          goalTitle: "Foundation goal",
          goalSlug: "foundation-goal",
          objective: "Build the foundation contract",
          now,
          specID,
        })
        Database.use((db) =>
          db.insert(EngineGoalTable).values({
            id: childGoalID,
            task_id: taskID,
            spec_snapshot_id: specID,
            title: "Dependent goal",
            slug: "dependent-goal",
            objective: "Build on the foundation contract",
            acceptance_specs: [],
            owned_paths: ["src/dependent.ts"],
            depends_on: [goalID],
            exports: [],
            imports: [],
            kind: "feature",
            requirement_ids: [],
            priority: "blocking",
            source: "test",
            status: "pending",
            order_index: 1,
            time_created: now,
            time_updated: now,
          }).run(),
        )
        Database.use((db) =>
          db.update(EngineTaskTable).set({
            metadata: {
              architect_fidelity: {
                sourceCoverage: [{
                  id: "src-foundation",
                  paths: ["src/index.ts"],
                  goal_ids: [goalID],
                  action: "modify",
                  rationale: "test fixture source coverage",
                }],
                referenceCoverage: [],
                assemblyOwners: [{
                  surface: "test-app",
                  goal_id: childGoalID,
                  rationale: "test fixture assembly owner",
                }],
              },
            },
          }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const childRunID = beginBuildAttempt({
          taskID,
          goalID: childGoalID,
          sessionID: "ses_live_dependent",
        })
        expect(goalStatusByID(childGoalID)).toBe("running")

        reviewIntegrityImpl = async () => ({
          verdict: "needs_correction",
          summary: "Foundation contract changed under dependent work",
          dimensions: [
            {
              id: "goal_fidelity",
              verdict: "needs_correction",
              issues: [{
                description: "Foundation acceptance omitted a shared interface",
                type: "coverage_gap",
                goalIDs: [goalID],
              }],
            },
            { id: "technical_feasibility", verdict: "pass", issues: [] },
            { id: "hallucination", verdict: "pass", issues: [] },
            { id: "solution_quality", verdict: "pass", issues: [] },
          ],
          issues: [{
            description: "Foundation acceptance omitted a shared interface",
            type: "coverage_gap",
            goalIDs: [goalID],
          }],
          corrections: [],
          missingGoals: [],
          sessionID: "ses_integrity_cascade",
        })
        buildAgentRunImpl = async (input: any) => {
          await markBuildSlotAcquired(input)
          return {
            result: {
              status: "passed",
              summary: "Foundation goal built successfully.",
              files_changed: [{
                path: "src/index.ts",
                summary: "Implemented the foundation contract.",
                reason: "Required by the foundation goal.",
              }],
              tests: [],
              commit_ref: "cascade123",
            },
            sessionID: "ses_goal_review_cascade",
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute({
          goalID,
          request: "Implement the foundation goal",
          reason: "Per-goal pipeline execution.",
        }, {} as any)

        // Post-fix (B-wave): build tool no longer triggers review at all,
        // so neither the just-built goal nor any dependent gets cascaded.
        // Orchestrator calls integrity at wave boundary; dependents stay
        // running until orchestrator decides explicitly.
        expect(result).not.toContain("architecture_review:")
        expect(result).not.toContain("### Architecture review")
        expect(result).not.toContain("architecture_review_dependency_rework")
        expect(result).toContain("call `integrity`")
        expect(listGoalRunsByGoal(goalID)[0]?.superseded_reason).toBeFalsy()
        expect(listGoalRunsByGoal(childGoalID)[0]?.id).toBe(childRunID)
        expect(listGoalRunsByGoal(childGoalID)[0]?.status).toBe("running")
      },
    })
  })

  test("build finalization ignores stale reports from invalidated goal runs", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_stale_build_${stamp}`
    const taskID = `tsk_stale_build_${stamp}`
    const goalID = `goal_stale_build_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "stale build report test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Stale build report test",
          taskTitle: "Stale build report task",
          request: "A cancelled build report must not resurrect a goal",
          goalTitle: "Single goal",
          goalSlug: "single-goal",
          objective: "Verify stale reports are ignored",
          now,
        })
        buildAgentRunImpl = async (input: any) => {
          await markBuildSlotAcquired(input)
          const liveRun = listGoalRunsByGoal(goalID)[0]
          updateGoalRun(liveRun.id, {
            status: "aborted",
            error: "architecture_review_dependency_rework: invalidated while agent was running",
          })
          return {
            result: {
              status: "passed",
              summary: "This report arrived after invalidation.",
              files_changed: [{
                path: "src/index.ts",
                summary: "Late stale change.",
                reason: "Should not finalize after invalidation.",
              }],
              tests: [],
              commit_ref: "stale123",
            },
            sessionID: "ses_stale_build",
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute({
          goalID,
          request: "Implement the single goal",
          reason: "Per-goal pipeline execution.",
        }, {} as any)

        expect(result).toContain("build_result_ignored")
        // Post-fix (B-wave): no architecture_review section in build report.
        expect(result).not.toContain("architecture_review:")
        // Next-step still directs orchestrator to call integrity at wave
        // boundary (when applicable).
        expect(result).toContain("call `integrity`")
        expect(goalStatusByID(goalID)).toBe("pending")
        expect(listGoalRunsByGoal(goalID)[0]?.status).toBe("aborted")
      },
    })
  })

  test("architecture review records correction feedback without changing goals", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_integrity_noop_${stamp}`
    const taskID = `tsk_integrity_noop_${stamp}`
    const goalID = `goal_integrity_noop_${stamp}`
    const specID = `spec_${goalID}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "integrity no-op test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Integrity no-op correction test",
          taskTitle: "Integrity no-op correction task",
          request: "Do not block forever on no-op integrity corrections",
          goalTitle: "Keep graph executable",
          goalSlug: "keep-graph-executable",
          objective: "Verify no-op corrections do not remain needs_correction",
          now,
          specID,
        })

        reviewIntegrityImpl = async () => ({
          verdict: "needs_correction",
          summary: "Correction has no semantic effect",
          dimensions: [
            { id: "goal_fidelity", verdict: "pass", issues: [] },
            { id: "technical_feasibility", verdict: "needs_correction", issues: [{ description: "Dependency prose only", type: "missing_capability" }] },
            { id: "hallucination", verdict: "pass", issues: [] },
            { id: "solution_quality", verdict: "concerns", issues: [] },
          ],
          issues: [{ description: "Dependency prose only", type: "missing_capability" }],
          corrections: [{ action: "modify", goalID, reason: "No actual updates", updates: {} }],
          missingGoals: [],
          sessionID: "ses_integrity_noop",
        })

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.integrity.execute({}, {} as any)

        expect(result).toContain("Integrity verdict: needs_correction")
        expect(findGoal(goalID)).toBeTruthy()
        const artifact = findLatestIntegrityAttemptArtifact({ taskID, specSnapshotID: specID })
        expect(artifact?.label).toBe("verdict-needs_correction")
      },
    })
  })

  test("diagnostic architecture findings do not restart requirements by themselves", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_integrity_upstream_${stamp}`
    const taskID = `tsk_integrity_upstream_${stamp}`
    const goalID = `goal_integrity_upstream_${stamp}`
    const specID = `spec_${goalID}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "integrity upstream restart test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Integrity upstream restart test",
          taskTitle: "Integrity upstream restart task",
          request: "Record diagnostic architecture findings without rewriting requirements",
          goalTitle: "Record diagnostic architecture feedback",
          goalSlug: "record-diagnostic-architecture-feedback",
          objective: "Verify diagnostic findings become feedback instead of task mutation",
          now,
          specID,
        })

        reviewIntegrityImpl = async () => ({
          verdict: "needs_correction",
          summary: "Integrity needs_correction",
          dimensions: [
            { id: "goal_fidelity", verdict: "pass", issues: [] },
            { id: "technical_feasibility", verdict: "pass", issues: [] },
            {
              id: "hallucination",
              verdict: "needs_correction",
              issues: [{ description: "REQ-9 is not grounded in the user request.", type: "unsupported_claim" }],
            },
            { id: "solution_quality", verdict: "pass", issues: [] },
          ],
          issues: [{ description: "REQ-9 is not grounded in the user request.", type: "unsupported_claim" }],
          corrections: [],
          missingGoals: [],
          sessionID: "ses_integrity_upstream",
        })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.integrity.execute({}, {} as any)

        expect(result).toContain("Integrity verdict: needs_correction")
        // Post-fix: review headline now states the advisory contract
        // explicitly without referring to the deleted auto-route mechanism.
        expect(result).toContain("nothing in code supersedes goals")
        expect(findGoal(goalID)).toBeTruthy()
        const artifact = findLatestIntegrityAttemptArtifact({ taskID, specSnapshotID: specID })
        expect(artifact?.label).toBe("verdict-needs_correction")
      },
    })
  })

  test("repeated architecture corrections remain feedback instead of automatic plan restart", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_integrity_plan_restart_${stamp}`
    const taskID = `tsk_integrity_plan_restart_${stamp}`
    const goalID = `goal_integrity_plan_restart_${stamp}`
    const specID = `spec_${goalID}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "integrity plan restart test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Integrity plan restart test",
          taskTitle: "Integrity plan restart task",
          request: "Do not let repeated architecture review feedback mutate the plan automatically",
          goalTitle: "Keep repeated review as feedback",
          goalSlug: "keep-repeated-review-as-feedback",
          objective: "Verify repeated review findings do not restart Architect automatically",
          now,
          specID,
        })
        for (const offset of [1, 2]) {
          recordIntegrityAttempt({
            taskID,
            sessionID: `ses_prior_integrity_${offset}`,
            specSnapshotID: specID,
            verdict: "needs_correction",
            perDimension: [
              { id: "goal_fidelity", verdict: "needs_correction" },
              { id: "technical_feasibility", verdict: "pass" },
              { id: "hallucination", verdict: "pass" },
              { id: "solution_quality", verdict: "pass" },
            ],
            issuesCount: 1,
            correctionsCount: 1,
            missingCount: 0,
            reason: "Prior goal-layer correction did not converge.",
            now: now + offset,
          })
        }

        reviewIntegrityImpl = async () => ({
          verdict: "needs_correction",
          summary: "Integrity needs_correction",
          dimensions: [
            {
              id: "goal_fidelity",
              verdict: "needs_correction",
              issues: [{ description: "Goal still misses REQ-1.", type: "uncovered" }],
            },
            { id: "technical_feasibility", verdict: "pass", issues: [] },
            { id: "hallucination", verdict: "pass", issues: [] },
            { id: "solution_quality", verdict: "pass", issues: [] },
          ],
          issues: [{ description: "Goal still misses REQ-1.", type: "uncovered" }],
          corrections: [{ action: "modify", goalID, reason: "Still missing REQ-1", updates: { objective: "cover REQ-1" } }],
          missingGoals: [],
          sessionID: "ses_integrity_plan_restart",
        })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.integrity.execute({}, {} as any)

        expect(result).toContain("Integrity verdict: needs_correction")
        expect(result).not.toContain("Task restarted from plan")
        expect(findGoal(goalID)).toBeTruthy()
        const artifact = findLatestIntegrityAttemptArtifact({ taskID, specSnapshotID: specID })
        expect(artifact?.label).toBe("verdict-needs_correction")
      },
    })
  })

  test("mixed architecture findings are recorded without requirements or plan restart", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_integrity_mixed_restart_${stamp}`
    const taskID = `tsk_integrity_mixed_restart_${stamp}`
    const goalID = `goal_integrity_mixed_restart_${stamp}`
    const specID = `spec_${goalID}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "integrity mixed restart test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Integrity mixed restart test",
          taskTitle: "Integrity mixed restart task",
          request: "Record mixed architecture findings without automatic replanning",
          goalTitle: "Record mixed architecture feedback",
          goalSlug: "record-mixed-architecture-feedback",
          objective: "Verify mixed diagnostic plus goal-layer failures stay as review feedback",
          now,
          specID,
        })
        for (const offset of [1, 2]) {
          recordIntegrityAttempt({
            taskID,
            sessionID: `ses_prior_mixed_integrity_${offset}`,
            specSnapshotID: specID,
            verdict: "needs_correction",
            perDimension: [
              { id: "goal_fidelity", verdict: "needs_correction" },
              { id: "technical_feasibility", verdict: "pass" },
              { id: "hallucination", verdict: "pass" },
              { id: "solution_quality", verdict: "pass" },
            ],
            issuesCount: 1,
            correctionsCount: 1,
            missingCount: 0,
            reason: "Prior goal-layer correction did not converge.",
            now: now + offset,
          })
        }

        reviewIntegrityImpl = async () => ({
          verdict: "needs_correction",
          summary: "Integrity needs_correction",
          dimensions: [
            {
              id: "goal_fidelity",
              verdict: "needs_correction",
              issues: [{ description: "Goal still misses REQ-1.", type: "uncovered" }],
            },
            {
              id: "technical_feasibility",
              verdict: "needs_correction",
              issues: [{ description: "Import/export contract is still inconsistent.", type: "missing_capability" }],
            },
            {
              id: "hallucination",
              verdict: "needs_correction",
              issues: [{ description: "A goal references an invented artifact.", type: "invented_artifact" }],
            },
            {
              id: "solution_quality",
              verdict: "needs_correction",
              issues: [{ description: "Goal granularity remains unstable.", type: "granularity_off" }],
            },
          ],
          issues: [
            { description: "Goal still misses REQ-1.", type: "uncovered" },
            { description: "Import/export contract is still inconsistent.", type: "missing_capability" },
            { description: "A goal references an invented artifact.", type: "invented_artifact" },
            { description: "Goal granularity remains unstable.", type: "granularity_off" },
          ],
          corrections: [{ action: "modify", goalID, reason: "Still missing REQ-1", updates: { objective: "cover REQ-1" } }],
          missingGoals: [{ title: "Missing integration goal", objective: "Close the integration gap" }],
          sessionID: "ses_integrity_mixed_restart",
        })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.integrity.execute({}, {} as any)

        expect(result).toContain("Integrity verdict: needs_correction")
        expect(result).not.toContain("Task restarted from plan")
        expect(result).not.toContain("Task restarted from requirements")
        expect(findGoal(goalID)).toBeTruthy()
        const spec = Database.use((db) =>
          db.select({ status: EngineSpecSnapshotTable.status })
            .from(EngineSpecSnapshotTable)
            .where(eq(EngineSpecSnapshotTable.id, specID))
            .get(),
        )
        expect(spec?.status).toBe("ready")
        const artifact = findLatestIntegrityAttemptArtifact({ taskID, specSnapshotID: specID })
        const payload = artifact?.payload as Record<string, unknown> | undefined
        expect(artifact?.label).toBe("verdict-needs_correction")
        expect(payload?.reason).toBe("Integrity needs_correction")
      },
    })
  })

  test("goal build is not blocked by stale architecture review feedback", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_goal_integrity_persisted_block_${stamp}`
    const taskID = `tsk_goal_integrity_persisted_block_${stamp}`
    const goalID = `goal_integrity_persisted_block_${stamp}`
    const specID = `spec_${goalID}`
    let buildCalls = 0

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "persisted integrity block test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Persisted integrity block test",
          taskTitle: "Persisted integrity block task",
          request: "Let build act on complete context despite prior review feedback",
          goalTitle: "Build after prior architecture feedback",
          goalSlug: "build-after-prior-architecture-feedback",
          objective: "Verify stale review artifacts do not block a capable build agent",
          now,
          specID,
        })
        recordIntegrityAttempt({
          taskID,
          sessionID: "ses_integrity_persisted_block",
          specSnapshotID: specID,
          verdict: "needs_correction",
          perDimension: [
            { id: "goal_fidelity", verdict: "pass" },
            { id: "technical_feasibility", verdict: "pass" },
            { id: "hallucination", verdict: "needs_correction" },
            { id: "solution_quality", verdict: "concerns" },
          ],
          issuesCount: 2,
          correctionsCount: 0,
          missingCount: 0,
          reason: "Reference requirements were not grounded.",
          now,
        })
        buildAgentRunImpl = async (input: any) => {
          await markBuildSlotAcquired(input)
          buildCalls += 1
          return {
            result: {
              status: "passed",
              summary: "Build handled the prior architecture feedback.",
              files_changed: [{
                path: "src/index.ts",
                summary: "Changed implementation after review feedback.",
                reason: "Prior review feedback is context, not a dispatch gate.",
              }],
              tests: [],
              commit_ref: "abc1234",
            },
            sessionID: "ses_goal_after_prior_review",
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute({
          goalID,
          request: "Implement the goal",
          reason: "Per-goal pipeline execution.",
        }, {} as any)

        expect(result).toContain("status=passed")
        expect(buildCalls).toBe(1)
        expect(listGoalRunsByGoal(goalID)).toHaveLength(1)
      },
    })
  })

  test("goal build binds the live goal_run to the build session before completion", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_goal_build_session_bind_${stamp}`
    const taskID = `tsk_goal_build_session_bind_${stamp}`
    const goalID = `goal_build_session_bind_${stamp}`
    let observedSessionID: string | null | undefined

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "build session bind test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Build session bind test",
          taskTitle: "Build session bind task",
          request: "Bind build session to goal_run while it is still running",
          goalTitle: "Bind build session",
          goalSlug: "bind-build-session",
          objective: "Verify live goal_run attempts have a session_id before the build result returns",
          now,
        })
        buildAgentRunImpl = async (input: any) => {
          expect(listGoalRunsByGoal(goalID)).toHaveLength(0)
          await markBuildSlotAcquired(input)
          expect(goalStatusByID(goalID)).toBe("running")
          await input.onSessionCreated?.("ses_build_session_bind")
          observedSessionID = listGoalRunsByGoal(goalID)[0]?.session_id
          return {
            result: {
              status: "passed",
              summary: "Build completed after early session binding.",
              files_changed: [{
                path: "src/index.ts",
                summary: "Confirmed session binding contract.",
                reason: "The build milestone must be traceable while it is running.",
              }],
              tests: [],
              commit_ref: "abc1234",
            },
            sessionID: "ses_build_session_bind",
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute({
          goalID,
          request: "Implement the goal",
          reason: "Per-goal pipeline execution.",
        }, {} as any)

        expect(result).toContain("status=passed")
        expect(observedSessionID).toBe("ses_build_session_bind")
        expect(listGoalRunsByGoal(goalID)[0]?.session_id).toBe("ses_build_session_bind")
      },
    })
  })

  test("goal build is not blocked by correction-bearing review history", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_goal_integrity_concern_block_${stamp}`
    const taskID = `tsk_goal_integrity_concern_block_${stamp}`
    const goalID = `goal_integrity_concern_block_${stamp}`
    const specID = `spec_${goalID}`
    let buildCalls = 0

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "persisted integrity concern block test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Persisted integrity concern block test",
          taskTitle: "Persisted integrity concern block task",
          request: "Let build consume correction-bearing review history as context",
          goalTitle: "Build after correction feedback",
          goalSlug: "build-after-correction-feedback",
          objective: "Verify correction counts inform the prompt rather than block dispatch",
          now,
          specID,
        })
        recordIntegrityAttempt({
          taskID,
          sessionID: "ses_integrity_concern_block",
          specSnapshotID: specID,
          verdict: "concerns",
          perDimension: [
            { id: "goal_fidelity", verdict: "concerns" },
            { id: "technical_feasibility", verdict: "pass" },
            { id: "hallucination", verdict: "pass" },
            { id: "solution_quality", verdict: "concerns" },
          ],
          issuesCount: 3,
          correctionsCount: 1,
          missingCount: 0,
          reason: "A concern still carried a concrete correction action.",
          now,
        })
        buildAgentRunImpl = async (input: any) => {
          await markBuildSlotAcquired(input)
          buildCalls += 1
          return {
            result: {
              status: "passed",
              summary: "Build handled correction-bearing review history.",
              files_changed: [{
                path: "src/index.ts",
                summary: "Changed implementation after correction feedback.",
                reason: "Review history is context, not a dispatch gate.",
              }],
              tests: [],
              commit_ref: "abc1234",
            },
            sessionID: "ses_goal_after_correction_feedback",
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute({
          goalID,
          request: "Implement the goal",
          reason: "Per-goal pipeline execution.",
        }, {} as any)

        expect(result).toContain("status=passed")
        expect(buildCalls).toBe(1)
        expect(listGoalRunsByGoal(goalID)).toHaveLength(1)
      },
    })
  })

  test("deliver creates required integrity evidence before delivery verification", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_deliver_integrity_prereq_${stamp}`
    const taskID = `tsk_deliver_integrity_prereq_${stamp}`
    const goalID = `goal_deliver_integrity_prereq_${stamp}`
    const specID = `spec_${goalID}`
    const order: string[] = []
    let verifySawIntegrity = false

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "deliver integrity prerequisite test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Deliver integrity prerequisite project",
          taskTitle: "Deliver integrity prerequisite task",
          request: "Deliver must evaluate architecture integrity before final delivery verification",
          goalTitle: "Deliverable goal",
          goalSlug: "deliverable-goal",
          objective: "Create a non-trivial blocking goal requiring integrity evidence",
          now,
          specID,
        })
        reviewIntegrityImpl = async () => {
          order.push("integrity")
          return {
            verdict: "pass",
            summary: "Integrity pass before delivery",
            dimensions: [
              { id: "goal_fidelity", verdict: "pass", issues: [], corrections: [], missingGoals: [] },
              { id: "technical_feasibility", verdict: "pass", issues: [], corrections: [], missingGoals: [] },
              { id: "hallucination", verdict: "pass", issues: [], corrections: [], missingGoals: [] },
              { id: "solution_quality", verdict: "pass", issues: [], corrections: [], missingGoals: [] },
            ],
            issues: [],
            corrections: [],
            missingGoals: [],
            sessionID: `ses_integrity_deliver_${stamp}`,
          }
        }
        deliveryServiceVerifyImpl = async () => {
          order.push("verify")
          verifySawIntegrity = Boolean(findLatestIntegrityAttemptArtifact({ taskID, specSnapshotID: specID }))
          throw new Error("stop_after_delivery_service")
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.deliver.execute({ reason: "All goals are ready for final delivery" }, {} as any)

        expect(result).toContain("stop_after_delivery_service")
        expect(result).toContain("persisted as a structured rejection")
        expect(order).toEqual(["integrity", "verify"])
        expect(verifySawIntegrity).toBe(true)
        const artifact = findLatestIntegrityAttemptArtifact({ taskID, specSnapshotID: specID })
        expect(artifact?.label).toBe("verdict-pass")
        const throwArtifact = Database.use((db) =>
          db.select().from(EngineArtifactTable)
            .where(and(
              eq(EngineArtifactTable.task_id, taskID),
              eq(EngineArtifactTable.kind, "delivery_verification_threw"),
            ))
            .get(),
        )
        expect(throwArtifact?.payload).toMatchObject({
          error: "stop_after_delivery_service",
          verdict: "rejected",
        })
        const verdictArtifact = Database.use((db) =>
          db.select().from(EngineArtifactTable)
            .where(and(
              eq(EngineArtifactTable.task_id, taskID),
              eq(EngineArtifactTable.label, "delivery-agent-verdict"),
            ))
            .get(),
        )
        expect(verdictArtifact?.payload).toMatchObject({
          verdict: "rejected",
          rejection_details: [{
            category: "runtime",
            error: expect.stringContaining("stop_after_delivery_service"),
          }],
        })
      },
    })
  })

  test("goal build success removes the completed worktree and clears goal workspace metadata", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_goal_cleanup_${stamp}`
    const taskID = `tsk_goal_cleanup_${stamp}`
    const goalID = `goal_cleanup_${stamp}`
    let buildWorktreeDir = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal cleanup build test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Goal cleanup build test",
          taskTitle: "Goal cleanup build task",
          request: "Build a scoped goal and clean its worktree after success",
          goalTitle: "Clean successful worktree",
          goalSlug: "clean-successful-worktree",
          objective: "Verify completed goal worktrees are removed after a passed build",
          now,
        })

        buildAgentRunImpl = async (input: any) => {
          await markBuildSlotAcquired(input)
          buildWorktreeDir = input.managedWorktree.directory
          expect(input.target.id).toBe(goalID)
          expect(await Filesystem.exists(buildWorktreeDir)).toBe(true)
          return {
            result: {
              status: "passed",
              summary: "Goal built successfully",
              files_changed: [{
                path: "src/index.ts",
                summary: "Changed scoped implementation file.",
                reason: "Required by the mocked goal build.",
              }],
              tests: [],
              commit_ref: "abc1234",
            },
            sessionID: "ses_goal_cleanup_build",
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute({
          goalID,
          request: "Implement the goal",
          reason: "Per-goal pipeline execution.",
        }, {} as any)

        expect(result).toContain("status=passed")
        expect(result).toContain("goal worktree cleaned after successful merge")
        expect(buildWorktreeDir).not.toBe("")
        expect(await Filesystem.exists(buildWorktreeDir)).toBe(false)
        const ws = findGoalLatestWorkspace(goalID)
        expect(ws.directory).toBeNull()
        expect(ws.branch).toBeNull()
        expect(ws.baseRef).toBeNull()
        expect(listGoalRunsByGoal(goalID)[0]?.workspace_dir).toBeNull()
      },
    })
  })

  test("goal build failure keeps the worktree for diagnosis", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_goal_keep_${stamp}`
    const taskID = `tsk_goal_keep_${stamp}`
    const goalID = `goal_keep_${stamp}`
    let buildWorktreeDir = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal failed build test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Goal failed build test",
          taskTitle: "Goal failed build task",
          request: "Build a scoped goal and preserve its worktree on failure",
          goalTitle: "Preserve failed worktree",
          goalSlug: "preserve-failed-worktree",
          objective: "Verify failed goal worktrees remain available for diagnosis",
          now,
        })

        buildAgentRunImpl = async (input: any) => {
          await markBuildSlotAcquired(input)
          buildWorktreeDir = input.managedWorktree.directory
          expect(await Filesystem.exists(buildWorktreeDir)).toBe(true)
          return {
            result: {
              status: "failed",
              summary: "Goal build failed",
              files_changed: [],
              tests: [],
              error: "diagnostic failure",
            },
            sessionID: "ses_goal_failed_build",
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute({
          goalID,
          request: "Implement the goal",
          reason: "Per-goal pipeline execution.",
        }, {} as any)

        expect(result).toContain("status=failed")
        expect(result).not.toContain("goal worktree cleaned")
        expect(await Filesystem.exists(buildWorktreeDir)).toBe(true)
        expect(findGoalLatestWorkspace(goalID).directory).toBe(buildWorktreeDir)
        expect(listGoalRunsByGoal(goalID)[0]?.workspace_dir).toBe(buildWorktreeDir)
      },
    })
  })

  test("goal build success keeps workspace pointers when cleanup is refused", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_goal_refuse_${stamp}`
    const taskID = `tsk_goal_refuse_${stamp}`
    const goalID = `goal_refuse_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal cleanup refused test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Goal cleanup refused test",
          taskTitle: "Goal cleanup refused task",
          request: "Build a scoped goal whose recorded workspace is not a goal worktree",
          goalTitle: "Refuse unsafe cleanup",
          goalSlug: "refuse-unsafe-cleanup",
          objective: "Verify unsafe cleanup failures preserve diagnosis pointers",
          now,
        })

        buildAgentRunImpl = async (input: any) => {
          await markBuildSlotAcquired(input)
          return {
            result: {
              status: "passed",
              summary: "Goal built successfully",
              files_changed: [{
                path: "src/index.ts",
                summary: "Changed scoped implementation file.",
                reason: "Required by the mocked goal build.",
              }],
              tests: [],
              commit_ref: "abc1234",
            },
            sessionID: "ses_goal_cleanup_refused",
            worktreeDir: tmp.path,
            worktreeBranch: "opencorvus/not-a-goal-worktree",
            worktreeBaseRef: input.managedWorktree.baseRef,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute({
          goalID,
          request: "Implement the goal",
          reason: "Per-goal pipeline execution.",
        }, {} as any)

        expect(result).toContain("status=passed")
        expect(result).toContain("goal worktree cleanup failed")
        expect(await Filesystem.exists(tmp.path)).toBe(true)
        expect(findGoalLatestWorkspace(goalID).directory).toBe(tmp.path)
        expect(listGoalRunsByGoal(goalID)[0]?.workspace_dir).toBe(tmp.path)
      },
    })
  })

  // Single-active-plan invariant: createExecutionRunRecord and
  // restart_from_stage("plan") must each leave at most one engine_plan_version
  // row with status='active' for any given task. The board.ts read path
  // (findActivePlanForTask → ORDER BY version DESC LIMIT 1) silently picks
  // an arbitrary row when several share the same version, so a violation
  // surfaces as goals + goal_run cards disappearing from the overlay even
  // though the data is intact in the DB.

  test("createExecutionRunRecord supersedes the prior active plan", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_plan_invariant_${stamp}`
    const taskID = `tsk_plan_invariant_${stamp}`
    const goalID = `gol_plan_invariant_${stamp}`
    const priorPlanID = `pln_prior_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID, taskID, goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "Plan invariant project",
      taskTitle: "Plan invariant task",
      request: "Drive createExecutionRunRecord through prosecute and verify single active plan",
      goalTitle: "Single goal",
      goalSlug: "single-goal",
      objective: "Provide a goal so prosecute reaches ensureDispatchableRunForSingleGoal",
      now,
    })
    Database.use((db) => {
      db.insert(EnginePlanVersionTable).values({
        id: priorPlanID,
        task_id: taskID,
        spec_snapshot_id: `spec_${goalID}`,
        version: 1,
        status: "active",
        summary: "prior active plan",
        prompt: "prior",
        metadata: {},
        time_created: now - 1000,
        time_updated: now - 1000,
      }).run()
      db.update(EngineGoalTable)
        .set({ plan_version_id: priorPlanID })
        .where(eq(EngineGoalTable.id, goalID))
        .run()
      db.insert(EnginePlanNodeTable).values({
        id: `pln_node_prior_${stamp}`,
        task_id: taskID,
        plan_version_id: priorPlanID,
        kind: "goal",
        goal_id: goalID,
        title: "Single goal (prior)",
        brief: "prior brief",
        order_index: 0,
        metadata: {},
        time_created: now - 1000,
        time_updated: now - 1000,
      }).run()
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "plan invariant test" })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.prosecute.execute({}, {} as any)
        expect(result).toContain("no delivery row to prosecute")

        const plans = Database.use((db) =>
          db.select().from(EnginePlanVersionTable)
            .where(eq(EnginePlanVersionTable.task_id, taskID))
            .all(),
        )
        const active = plans.filter((p) => p.status === "active")
        const superseded = plans.filter((p) => p.status === "superseded")
        expect(active).toHaveLength(1)
        expect(superseded).toHaveLength(1)
        expect(superseded[0].id).toBe(priorPlanID)

        const livePlan = findActivePlanForTask(taskID)
        expect(livePlan?.id).toBe(active[0].id)
        expect(livePlan?.id).not.toBe(priorPlanID)

        const goal = findGoal(goalID)
        expect(goal?.plan_version_id).toBe(active[0].id)

        const planNodes = Database.use((db) =>
          db.select().from(EnginePlanNodeTable)
            .where(eq(EnginePlanNodeTable.plan_version_id, active[0].id))
            .all(),
        )
        expect(planNodes).toHaveLength(1)
        expect(planNodes[0].goal_id).toBe(goalID)

        // Prior plan's plan_node rows must be cleared so the board's per-goal
        // plan_node lookup (which only filters by goal_id) does not double-render.
        const priorNodes = Database.use((db) =>
          db.select().from(EnginePlanNodeTable)
            .where(eq(EnginePlanNodeTable.plan_version_id, priorPlanID))
            .all(),
        )
        expect(priorNodes).toHaveLength(0)
        const allNodesForGoal = Database.use((db) =>
          db.select().from(EnginePlanNodeTable)
            .where(eq(EnginePlanNodeTable.goal_id, goalID))
            .all(),
        )
        expect(allNodesForGoal).toHaveLength(1)
      },
    })
  })

  test("createExecutionRunRecord retires every active plan even when dirty data already has multiple", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_plan_dirty_${stamp}`
    const taskID = `tsk_plan_dirty_${stamp}`
    const goalID = `gol_plan_dirty_${stamp}`
    const olderPlanID = `pln_older_${stamp}`
    const newerPlanID = `pln_newer_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID, taskID, goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "Plan dirty regression",
      taskTitle: "Plan dirty regression task",
      request: "Two active plans must collapse to one after createExecutionRunRecord",
      goalTitle: "Single goal",
      goalSlug: "single-goal",
      objective: "Reproduce the dirty-data scenario from the overlay bug",
      now,
    })
    Database.use((db) => {
      db.insert(EnginePlanVersionTable).values({
        id: olderPlanID,
        task_id: taskID,
        spec_snapshot_id: `spec_${goalID}`,
        version: 1,
        status: "active",
        summary: "older active plan",
        prompt: "older",
        metadata: {},
        time_created: now - 2000,
        time_updated: now - 2000,
      }).run()
      db.insert(EnginePlanVersionTable).values({
        id: newerPlanID,
        task_id: taskID,
        spec_snapshot_id: `spec_${goalID}`,
        version: 1,
        status: "active",
        summary: "newer active plan",
        prompt: "newer",
        metadata: {},
        time_created: now - 1000,
        time_updated: now - 1000,
      }).run()
      db.update(EngineGoalTable)
        .set({ plan_version_id: newerPlanID })
        .where(eq(EngineGoalTable.id, goalID))
        .run()
      // Seed plan_node rows on BOTH dirty active plans so we can prove
      // every prior plan_node gets cleaned up, not just the most recent one.
      db.insert(EnginePlanNodeTable).values({
        id: `pln_node_older_${stamp}`,
        task_id: taskID,
        plan_version_id: olderPlanID,
        kind: "goal",
        goal_id: goalID,
        title: "Single goal (older)",
        brief: "older brief",
        order_index: 0,
        metadata: {},
        time_created: now - 2000,
        time_updated: now - 2000,
      }).run()
      db.insert(EnginePlanNodeTable).values({
        id: `pln_node_newer_${stamp}`,
        task_id: taskID,
        plan_version_id: newerPlanID,
        kind: "goal",
        goal_id: goalID,
        title: "Single goal (newer)",
        brief: "newer brief",
        order_index: 0,
        metadata: {},
        time_created: now - 1000,
        time_updated: now - 1000,
      }).run()
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "plan dirty regression test" })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        await tools.prosecute.execute({}, {} as any)

        const plans = Database.use((db) =>
          db.select().from(EnginePlanVersionTable)
            .where(eq(EnginePlanVersionTable.task_id, taskID))
            .all(),
        )
        const active = plans.filter((p) => p.status === "active")
        const supersededIDs = plans.filter((p) => p.status === "superseded").map((p) => p.id).sort()
        expect(active).toHaveLength(1)
        expect(active[0].id).not.toBe(olderPlanID)
        expect(active[0].id).not.toBe(newerPlanID)
        expect(supersededIDs).toEqual([olderPlanID, newerPlanID].sort())

        // No plan_node row should remain pointing at either retired plan,
        // and the board's per-goal lookup must surface exactly one node
        // (the new plan's), reproducing the bug-fix scenario.
        const nodesByGoal = Database.use((db) =>
          db.select().from(EnginePlanNodeTable)
            .where(eq(EnginePlanNodeTable.goal_id, goalID))
            .all(),
        )
        expect(nodesByGoal).toHaveLength(1)
        expect(nodesByGoal[0].plan_version_id).toBe(active[0].id)
      },
    })
  })

  test("restart_from_stage(plan) supersedes every active plan, not just one", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_restart_plan_${stamp}`
    const taskID = `tsk_restart_plan_${stamp}`
    const goalID = `gol_restart_plan_${stamp}`
    const olderPlanID = `pln_restart_older_${stamp}`
    const newerPlanID = `pln_restart_newer_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID, taskID, goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "Restart plan stage project",
      taskTitle: "Restart plan stage task",
      request: "restart_from_stage(plan) collapses dirty multi-active rows",
      goalTitle: "Single goal",
      goalSlug: "single-goal",
      objective: "Verify restart_from_stage retires every active plan",
      now,
    })
    Database.use((db) => {
      db.insert(EnginePlanVersionTable).values({
        id: olderPlanID,
        task_id: taskID,
        spec_snapshot_id: `spec_${goalID}`,
        version: 1,
        status: "active",
        summary: "older active plan",
        prompt: "older",
        metadata: {},
        time_created: now - 2000,
        time_updated: now - 2000,
      }).run()
      db.insert(EnginePlanVersionTable).values({
        id: newerPlanID,
        task_id: taskID,
        spec_snapshot_id: `spec_${goalID}`,
        version: 1,
        status: "active",
        summary: "newer active plan",
        prompt: "newer",
        metadata: {},
        time_created: now - 1000,
        time_updated: now - 1000,
      }).run()
      db.insert(EnginePlanNodeTable).values({
        id: `pln_node_restart_older_${stamp}`,
        task_id: taskID,
        plan_version_id: olderPlanID,
        kind: "goal",
        goal_id: goalID,
        title: "Single goal (older)",
        brief: "older brief",
        order_index: 0,
        metadata: {},
        time_created: now - 2000,
        time_updated: now - 2000,
      }).run()
      db.insert(EnginePlanNodeTable).values({
        id: `pln_node_restart_newer_${stamp}`,
        task_id: taskID,
        plan_version_id: newerPlanID,
        kind: "goal",
        goal_id: goalID,
        title: "Single goal (newer)",
        brief: "newer brief",
        order_index: 0,
        metadata: {},
        time_created: now - 1000,
        time_updated: now - 1000,
      }).run()
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "restart plan stage test" })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.restart_from_stage.execute(
          { stage: "plan", reason: "regression test" },
          {} as any,
        )
        expect(typeof result).toBe("string")

        const plans = Database.use((db) =>
          db.select().from(EnginePlanVersionTable)
            .where(eq(EnginePlanVersionTable.task_id, taskID))
            .all(),
        )
        const active = plans.filter((p) => p.status === "active")
        const supersededIDs = plans.filter((p) => p.status === "superseded").map((p) => p.id).sort()
        expect(active).toHaveLength(0)
        expect(supersededIDs).toEqual([olderPlanID, newerPlanID].sort())

        // Both retired plans' plan_node rows must be gone — restart_from_stage
        // routes through the same supersede helper.
        const remaining = Database.use((db) =>
          db.select().from(EnginePlanNodeTable)
            .where(eq(EnginePlanNodeTable.task_id, taskID))
            .all(),
        )
        expect(remaining).toHaveLength(0)
      },
    })
  })
})
