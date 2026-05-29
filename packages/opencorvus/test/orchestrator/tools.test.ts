import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { Database, and, eq } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import {
  EngineArtifactTable,
  EngineGoalTable,
  EnginePlanNodeTable,
  EnginePlanVersionTable,
  EngineRequirementTable,
  EngineSpecSnapshotTable,
  EngineTaskTable,
} from "../../src/engine/engine.sql"
import { createDecisionLog } from "../../src/decision-log"
import { createWorkflowState, WorkflowRegistry } from "../../src/engine/workflow"
import { createOrchestratorTools } from "../../src/orchestrator/tools"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { SessionPrompt } from "../../src/session/prompt"
import { goalStatusByID } from "../../src/engine/describe"
import { openTaskForOperatorMessage } from "../../src/engine/task-message-open"
import { Session } from "../../src/session"
import { SessionTable } from "../../src/session/session.sql"
import {
  beginBuildAttempt,
  insertRequirements,
  recordIntegrityAttempt,
  startNewAttempt,
  updateGoalRun,
} from "../../src/engine/persist"
import * as EnginePersist from "../../src/engine/persist"
import { AttachmentStore } from "../../src/storage/attachment-store"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import {
  findActiveRunForTask,
  findActivePlanForTask,
  findDeliveryByRun,
  findActiveSpecForTask,
  findEvaluationByRun,
  findGoal,
  findGoalRun,
  findGoalLatestWorkspace,
  findLatestIntegrityArtifactMissingStatus,
  findLatestIntegrityAttemptArtifact,
  findRequirements,
  findRun,
  listGoalRunsByGoal,
} from "../../src/engine/store"
import { seedGoalRunAttemptWithWorkspace } from "../fixture/goal-run-attempt"
import { Filesystem } from "../../src/util/filesystem"
import { EngineService } from "../../src/task-api"
import { Question } from "../../src/question"
import { deriveTaskStatus } from "../../src/engine/task-status"
import { SessionStatus } from "../../src/session/status"
import { withStreamActivity } from "../../src/util/stream-activity"
import {
  completeOrchestratorToolOwnership,
  createOrchestratorToolOwnershipPayload,
  findLatestOwnershipByID,
  insertOrchestratorToolOwnershipArtifact,
  listLiveOrchestratorToolOwnership,
} from "../../src/engine/tool-ownership"
import { Ownership } from "../../src/engine/ownership"
import { buildIntegrityReplayContext, buildSpecSnapshotLineage } from "../../src/integrity/replay-context"
import { buildIntegrityRootHistory, persistentRootSummary, renderIntegrityRootHistoryBlock } from "../../src/integrity/root-history"
import { Config } from "../../src/config/config"

let buildAgentRunImpl: ((input: any) => Promise<any>) | undefined
let reviewIntegrityImpl: ((input: any) => Promise<any>) | undefined
let computeRequirementStatusSnapshotImpl: ((input: any) => any[]) | undefined
let architectCoordinateImpl: ((input: any) => Promise<any>) | undefined
let deliveryServiceVerifyImpl: ((input: any) => Promise<any>) | undefined
let designAnalyzeImpl: ((input: any) => Promise<any>) | undefined
let mcpServerToolsImpl: (() => Promise<any[]>) | undefined
let mcpCallToolImpl: ((input: { key: string; args: Record<string, unknown> }) => Promise<any>) | undefined

function buildToolOptions(label = "build") {
  const stamp = `${Date.now()}_${Math.random().toString(16).slice(2)}`
  return {
    toolCallId: `cal_${label}_${stamp}`,
    opencorvus: {
      sessionID: `ses_${label}_${stamp}`,
      messageID: `msg_${label}_${stamp}`,
      toolCallID: `cal_${label}_${stamp}`,
      toolPartID: `prt_${label}_${stamp}`,
    },
  } as any
}

function activeOnlyLineage(taskID: string, specSnapshotID: string) {
  return {
    taskID,
    activeSpecSnapshotID: specSnapshotID,
    inheritedSpecSnapshotIDs: [],
    reason: "active_only" as const,
  }
}

function acceptedAcceptance() {
  return {
    verdict: "accepted",
    summary: "Acceptance passed",
    deferred_checks: [],
    tool_call_evidence: [{ tool: "unit_test", passed: true, detail: "unit test passed" }],
  }
}

function integrityFinding(input: {
  id?: string
  severity?: "blocking" | "advisory"
  verdictImpact?: "pass" | "concerns" | "needs_correction"
  title?: string
  description: string
  targetIDs?: string[]
  requirementIDs?: string[]
  filePaths?: string[]
  repair?: string
  reviewers?: string[]
}) {
  return {
    id: input.id ?? `finding-${Math.random().toString(16).slice(2)}`,
    severity: input.severity ?? (input.verdictImpact === "needs_correction" ? "blocking" : "advisory"),
    verdictImpact: input.verdictImpact ?? "needs_correction",
    title: input.title ?? input.description,
    description: input.description,
    evidence: [`Mock evidence: ${input.description}`],
    targetIDs: input.targetIDs ?? [],
    requirementIDs: input.requirementIDs ?? [],
    specIDs: [],
    filePaths: input.filePaths ?? [],
    repair: input.repair ?? "Review the finding and route explicit repair work.",
    reviewers: input.reviewers ?? ["requirements_surface"],
    consensus: "agreed",
  }
}

function integrityRepair(input: { id?: string; description: string; targetIDs?: string[]; filePaths?: string[] }) {
  return {
    id: input.id ?? `repair-${Math.random().toString(16).slice(2)}`,
    description: input.description,
    evidence: [`Mock repair evidence: ${input.description}`],
    targetIDs: input.targetIDs ?? [],
    filePaths: input.filePaths ?? [],
  }
}

function integrityTeamResult(input: {
  verdict?: "pass" | "concerns" | "needs_correction"
  summary?: string
  sessionID?: string
  findings?: Array<ReturnType<typeof integrityFinding>>
  requiredRepairs?: Array<ReturnType<typeof integrityRepair>>
  teamReportMarkdown?: string
}) {
  const verdict = input.verdict ?? "pass"
  const summary = input.summary ?? "Integrity pass"
  const findings = input.findings ?? []
  const requiredRepairs = input.requiredRepairs ?? []
  const requirementsVerdict = verdict === "needs_correction" ? "needs_correction" : "pass"
  const deliveryVerdict = verdict === "pass" ? "pass" : "concerns"
  return {
    verdict,
    summary,
    teamReportMarkdown:
      input.teamReportMarkdown ??
      [summary, ...findings.map((finding) => finding.description), ...requiredRepairs.map((repair) => repair.description)]
        .filter(Boolean)
        .join("\n"),
    reviewers: [
      {
        reviewerID: "requirements_surface",
        scope: "Requirement fidelity",
        verdict: requirementsVerdict,
        summary,
        evidence: ["Mock requirement evidence."],
        findings: findings.filter((finding) => finding.reviewers.includes("requirements_surface")),
        openQuestions: [],
      },
      {
        reviewerID: "delivery_surface",
        scope: "Delivery and implementation evidence",
        verdict: deliveryVerdict,
        summary: verdict === "pass" ? "Delivery evidence is acceptable." : summary,
        evidence: ["Mock delivery evidence."],
        findings: findings.filter((finding) => finding.reviewers.includes("delivery_surface")),
        openQuestions: [],
      },
    ],
    findings,
    rounds: [],
    requiredRepairs,
    unresolvedDisagreements: [],
        fact_check_items: [],
    sessionID: input.sessionID ?? "ses_integrity_default",
  }
}

mock.module("@/build/agent", () => ({
  BuildAgent: {
    run: (input: any) => {
      if (!buildAgentRunImpl) throw new Error("BuildAgent.run mock not configured")
      return buildAgentRunImpl(input)
    },
  },
}))

mock.module("@/integrity", () => ({
  reviewIntegrity: async (input: any) => {
    if (!reviewIntegrityImpl) throw new Error("reviewIntegrity mock not configured")
    const result = await reviewIntegrityImpl(input)
    return result?.acceptance ? result : { ...result, acceptance: acceptedAcceptance() }
  },
  // Pure projection — empty snapshot is the right answer for orchestrator
  // tests, which don't seed the goal_run / verification-evidence rows the
  // production projection would join. Tests asserting prompt rendering of
  // the snapshot live in active integrity tests and use the real function;
  // this mock is just a non-throwing stub so the orchestrator's pre-review
  // wiring doesn't blow up in orchestrator-focused suites.
  computeRequirementStatusSnapshot: (input: any) => computeRequirementStatusSnapshotImpl?.(input) ?? [],
  buildIntegrityReplayContext,
  buildSpecSnapshotLineage,
  buildIntegrityRootHistory,
  persistentRootSummary,
  renderIntegrityRootHistoryBlock,
  applyIntegrityCorrections: (goals: any) => goals,
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

mock.module("@/mcp", () => ({
  MCP: {
    Status: z.any(),
    serverTools: () => {
      if (!mcpServerToolsImpl) throw new Error("MCP.serverTools mock not configured")
      return mcpServerToolsImpl()
    },
    callTool: (input: { key: string; args: Record<string, unknown> }) => {
      if (!mcpCallToolImpl) throw new Error("MCP.callTool mock not configured")
      return mcpCallToolImpl(input)
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

mock.module("@/plugin", () => ({
  Plugin: {
    list: async () => [],
    trigger: async () => {},
  },
}))

async function markBuildSlotAcquired(input: any, sessionID = `ses_build_mock_${Date.now()}_${Math.random().toString(36).slice(2)}`) {
  await input.onSessionCreated?.(
    sessionID,
    {
      worktreeDir: input.managedWorktree?.directory,
      worktreeBranch: input.managedWorktree?.branch,
      worktreeBaseRef: input.managedWorktree?.baseRef,
    },
  )
}

function deliveryDecisionFixture(verdict: any) {
  return {
    final: verdict,
    rawAgentVerdict: verdict,
    hostGate: {
      passed: true,
      manifest: {
        id: "artifact_delivery_manifest_fixture",
        taskId: "tsk_delivery_fixture",
        runId: "run_delivery_fixture",
        deliveryId: "dlv_delivery_fixture",
        iteration: 0,
        requiredChecks: [],
        checkResults: [],
        goalCoverage: [],
        requirementCoverage: [],
        reviewEvidence: [],
        changedFiles: [],
        finalGate: {
          status: "passed",
          summary: "Delivery evidence gate passed 0 required check(s).",
          failedCheckIds: [],
          failedCoverageIds: [],
          failedReviewIds: [],
        },
        timeCreated: 1,
      },
      failures: [],
    },
    source: "llm",
  }
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
  requirementIDs?: string[]
}) {
  const specID = input.specID ?? `spec_${input.goalID}`
  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: input.projectID,
        worktree: input.worktree,
        name: input.projectName,
        sandboxes: "[]",
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
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
      })
      .run()
    db.insert(EngineSpecSnapshotTable)
      .values({
        id: specID,
        task_id: input.taskID,
        version: 1,
        status: "ready",
        summary: `${input.goalTitle} spec`,
        content: input.request,
        scope: input.objective,
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    db.insert(EngineGoalTable)
      .values({
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
        requirement_ids: input.requirementIDs ?? [],
        priority: "blocking",
        source: "test",
        status: "pending",
        order_index: 0,
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
  })
  insertArchitectContractGraphArtifact({ taskID: input.taskID, now: input.now })
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

function insertArchitectContractGraphArtifact(input: {
  taskID: string
  now: number
  graph?: {
    version: 1
    contracts: any[]
    dependency_contracts: any[]
  }
}) {
  Database.use((db) => {
    db.insert(EngineArtifactTable)
      .values({
        id: `artifact_contract_graph_${input.taskID}_${input.now}`,
        task_id: input.taskID,
        run_id: null,
        goal_run_id: null,
        kind: "architect_contract_graph",
        label: "architect-contract-graph",
        payload: input.graph ?? { version: 1, contracts: [], dependency_contracts: [] },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
  })
}

function seedTerminalFailedBuildRun(input: {
  taskID: string
  goalID: string
  sessionID: string
  workspaceDir: string
  workspaceBranch?: string
  workspaceBaseRef?: string | null
  now: number
}) {
  const goalRunID = beginBuildAttempt({
    taskID: input.taskID,
    goalID: input.goalID,
    sessionID: input.sessionID,
    workspaceDir: input.workspaceDir,
    workspaceBranch: input.workspaceBranch ?? "opencorvus/prior-build",
    workspaceBaseRef: input.workspaceBaseRef ?? null,
    now: input.now,
  })
  updateGoalRun(goalRunID, {
    status: "failed",
    error: "prior build failed",
    time_completed: input.now + 1,
  })
  return goalRunID
}

function seedBuildUptakeIntegrityHistory(input: {
  taskID: string
  specID: string
  now: number
  rootID?: string
}) {
  const rootID = input.rootID ?? "storage-validation"
  recordIntegrityAttempt({
    taskID: input.taskID,
    sessionID: `ses_build_uptake_r1_${input.now}`,
    lineage: activeOnlyLineage(input.taskID, input.specID),
    verdict: "needs_correction",
    phase: "post_build",
    reviewers: [{ reviewerID: "rev_storage", scope: "Storage validation", verdict: "needs_correction" }],
    findings: [
      integrityFinding({
        id: "BF-R1-storage-validation",
        description: "getSettings trusts localStorage values.",
        repair: "Validate persisted settings on load.",
        filePaths: ["src/services/storage.ts"],
        requirementIDs: ["REQ-settings"],
        reviewers: ["rev_storage"],
      }),
    ].map((finding) => ({
      ...finding,
      rootID,
      canonicalLabel: "Validate persisted settings",
      title: "Persisted settings are trusted",
      evidence: ["src/services/storage.ts getSettings"],
    })),
    now: input.now + 1,
  })
  recordIntegrityAttempt({
    taskID: input.taskID,
    sessionID: `ses_build_uptake_r2_${input.now}`,
    lineage: activeOnlyLineage(input.taskID, input.specID),
    verdict: "needs_correction",
    phase: "post_build",
    reviewers: [{ reviewerID: "rev_settings", scope: "Settings repair verification", verdict: "needs_correction" }],
    findings: [
      integrityFinding({
        id: "BF-R2-settings-validation",
        description: "Invalid model/temperature/maxTokens values from localStorage reach API settings.",
        repair: "Validate model against ALLOWED_MODELS, clamp temperature to [0,2], clamp maxTokens to [1,8192].",
        filePaths: ["src/services/storage.ts"],
        requirementIDs: ["REQ-settings"],
        reviewers: ["rev_settings", "rev_storage"],
      }),
    ].map((finding) => ({
      ...finding,
      rootID,
      canonicalLabel: "Validate persisted settings",
      title: "getSettings does not validate model, temperature, or maxTokens",
      evidence: ["src/services/storage.ts getSettings still returns unchecked values"],
    })),
    now: input.now + 2,
  })
}

describe("orchestrator tools", () => {
  let tmp: Awaited<ReturnType<typeof tmpdir>>

  beforeEach(async () => {
    await resetDatabase()
    tmp = await tmpdir()
    architectCoordinateImpl = undefined
    mcpServerToolsImpl = undefined
    mcpCallToolImpl = undefined
    reviewIntegrityImpl = async () => integrityTeamResult({ sessionID: "ses_integrity_default" })
  })

  afterEach(async () => {
    buildAgentRunImpl = undefined
    reviewIntegrityImpl = undefined
    computeRequirementStatusSnapshotImpl = undefined
    architectCoordinateImpl = undefined
    deliveryServiceVerifyImpl = undefined
    designAnalyzeImpl = undefined
    mcpServerToolsImpl = undefined
    mcpCallToolImpl = undefined
    mock.restore()
    await resetDatabase()
    await tmp?.[Symbol.asyncDispose]?.()
  })

  test("explore dispatches registered explore subagent and persists findings for orchestrator", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_explore_${stamp}`
    const taskID = `tsk_explore_${stamp}`
    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    await fs.writeFile(path.join(tmp.path, "opencorvus.json"), JSON.stringify({ model: "test/model" }))

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: tmp.path,
          name: "Explore dispatch project",
          sandboxes: "[]",
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "Explore dispatch task",
          request: "Find the AuctionData component source.",
          kind: "workflow",
          priority: "normal",
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })

    const promptSpy = spyOn(SessionPrompt, "prompt").mockResolvedValue({
      parts: [{ type: "text", text: "AuctionData lives under Hithink.PrefabLibrary/PrefabLibrary/Business." }],
    } as any)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "explore dispatch parent" })
        Database.use((db) =>
          db
            .update(EngineTaskTable)
            .set({ session_id: parent.id, time_updated: Date.now() })
            .where(eq(EngineTaskTable.id, taskID))
            .run(),
        )
        const workflowState = createWorkflowState(pipeline)
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
          workflow: pipeline,
          workflowState,
        })

        expect(tools.explore).toBeDefined()
        const result = await tools.explore.execute(
          {
            question: "Locate the AuctionData source component and summarize the relevant files.",
            reason: "Need repository facts before requirements.",
          },
          buildToolOptions(),
        )

        expect(result).toContain("Explore complete")
        expect(result).toContain("AuctionData lives under Hithink.PrefabLibrary")
        expect(promptSpy).toHaveBeenCalledTimes(1)
        const promptInput = promptSpy.mock.calls[0][0] as any
        expect(promptInput.agent).toBe("explore")
        expect(promptInput.tools.bash).toBe(false)
        expect(promptInput.tools.write).toBe(false)
        expect(promptInput.tools.edit).toBe(false)
        expect(promptInput.tools.task).toBe(false)

        const decisions = createDecisionLog(taskID).readByPhase("explore")
        expect(decisions).toHaveLength(1)
        expect(decisions[0].value).toContain("AuctionData lives under Hithink.PrefabLibrary")
        const artifacts = Database.use((db) =>
          db.select().from(EngineArtifactTable).where(eq(EngineArtifactTable.kind, "exploration")).all(),
        )
        expect(artifacts).toHaveLength(1)
        expect(typeof (artifacts[0].payload as any).session_id).toBe("string")
        expect((artifacts[0].payload as any).result).toContain("AuctionData lives under Hithink.PrefabLibrary")
      },
    })
  })

  test("workflow tasks allow task-level direct build when the orchestrator chooses it", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_build_${stamp}`
    const taskID = `tsk_build_${stamp}`
    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const workflowState = createWorkflowState(pipeline)

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "Build workflow contract test",
          sandboxes: "[]",
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "Build workflow contract task",
          request: "Verify workflow task-level build can be selected directly",
          kind: "workflow",
          priority: "normal",
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })

    buildAgentRunImpl = async (input: any) => {
      expect(input.target).toEqual({
        kind: "request",
        text: "Implement the page directly.",
      })
      return {
        result: {
          status: "passed",
          summary: "Direct workflow build completed.",
          files_changed: [],
          tests: [],
        },
        sessionID: "ses_direct_workflow_build",
        worktreeDir: tmp.path,
        diffs: [],
      }
    }

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

        const result = await tools.build.execute(
          {
            request: "Implement the page directly.",
            reason: "Scoped workflow task; direct build is enough.",
            directBuildIntent: "modify_files",
          },
          buildToolOptions(),
        )

        expect(result).toContain("Build agent finished")
        expect(result).toContain("Direct workflow build completed")
        expect(workflowState.workflowID).toBe("pipeline")
        const run = findActiveRunForTask(taskID)
        expect(run).toBeDefined()
        expect(run?.plan_version_id).toBeNull()
        expect(run?.status).toBe("running")
      },
    })
  })

  test("task-level direct build receives persistent integrity findings in build context", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_build_uptake_direct_${stamp}`
    const taskID = `tsk_build_uptake_direct_${stamp}`
    const goalID = `goal_build_uptake_direct_${stamp}`
    const specID = `spec_build_uptake_direct_${stamp}`
    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const workflowState = createWorkflowState(pipeline)
    let capturedIntegrityFeedback = ""

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "Build uptake direct test",
      taskTitle: "Build uptake direct task",
      request: "Repair persistent integrity blockers through a direct build.",
      goalTitle: "Existing goal for active spec",
      goalSlug: "existing-goal-for-active-spec",
      objective: "Keep an active spec snapshot for direct build feedback.",
      now,
      specID,
      requirementIDs: ["REQ-settings"],
    })
    seedBuildUptakeIntegrityHistory({ taskID, specID, now })

    buildAgentRunImpl = async (input: any) => {
      expect(input.target).toEqual({
        kind: "request",
        text: "Repair persistent settings validation.",
      })
      capturedIntegrityFeedback = input.context?.integrityFeedback ?? ""
      return {
        result: {
          status: "passed",
          summary: "Direct build consumed integrity feedback.",
          files_changed: [],
          tests: [],
        },
        sessionID: "ses_build_uptake_direct",
        worktreeDir: tmp.path,
        diffs: [],
      }
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "build uptake direct test" })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
          workflow: pipeline,
          workflowState,
        })

        const result = await tools.build.execute(
          {
            request: "Repair persistent settings validation.",
            reason: "Direct correction after integrity review.",
            directBuildIntent: "modify_files",
          },
          buildToolOptions(),
        )

        expect(result).toContain("Build agent finished")
      },
    })

    expect(capturedIntegrityFeedback).toContain("## Persistent Integrity Findings")
    expect(capturedIntegrityFeedback).toMatch(/root: root_[a-f0-9]{12}/)
    expect(capturedIntegrityFeedback).toContain("BF-R2-settings-validation")
    expect(capturedIntegrityFeedback).toContain("getSettings does not validate model, temperature, or maxTokens")
    expect(capturedIntegrityFeedback).toContain("Validate model against ALLOWED_MODELS")
    expect(capturedIntegrityFeedback).toContain("reviewer ids: rev_settings, rev_storage")
  })

  test("goal build receives persistent integrity findings alongside retry guidance", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_build_uptake_goal_${stamp}`
    const taskID = `tsk_build_uptake_goal_${stamp}`
    const goalID = `goal_build_uptake_goal_${stamp}`
    const specID = `spec_build_uptake_goal_${stamp}`
    let capturedContext: any

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "build uptake goal test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Build uptake goal test",
          taskTitle: "Build uptake goal task",
          request: "Repair persistent integrity blockers through a goal build.",
          goalTitle: "Settings validation goal",
          goalSlug: "settings-validation-goal",
          objective: "Validate persisted settings on load.",
          now,
          specID,
          requirementIDs: ["REQ-settings"],
        })
        seedBuildUptakeIntegrityHistory({ taskID, specID, now })

        buildAgentRunImpl = async (input: any) => {
          await markBuildSlotAcquired(input, "ses_build_uptake_goal")
          capturedContext = input.context
          return {
            result: {
              status: "passed",
              summary: "Goal build consumed integrity feedback.",
              files_changed: [
                {
                  path: "src/services/storage.ts",
                  summary: "Validated persisted settings.",
                  reason: "Persistent integrity finding required the storage load path to validate settings.",
                },
              ],
              tests: [],
              commit_ref: "abc1234",
            },
            sessionID: "ses_build_uptake_goal",
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

        const result = await tools.build.execute(
          {
            goalID,
            request: "Retry by fixing the storage load validator.",
            reason: "Per-goal integrity correction.",
          },
          buildToolOptions(),
        )

        expect(result).toContain("status=passed")
      },
    })

    expect(capturedContext?.integrityFeedback).toContain("## Persistent Integrity Findings")
    expect(capturedContext?.integrityFeedback).toMatch(/root: root_[a-f0-9]{12}/)
    expect(capturedContext?.integrityFeedback).toContain("BF-R2-settings-validation")
    expect(capturedContext?.retryGuidance).toBe("Retry by fixing the storage load validator.")
  }, 15000)

  test("goal build rejects persisted contract_audit graph id mismatch before build starts", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_audit_drift_${stamp}`
    const taskID = `tsk_audit_drift_${stamp}`
    const goalID = `goal_audit_drift_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "contract audit drift predispatch",
      taskTitle: "contract audit drift predispatch",
      request: "Reject drifted contract audit ids before build",
      goalTitle: "Build drifted audit goal",
      goalSlug: "build-drifted-audit-goal",
      objective: "Attempt to build a goal whose persisted audit contract id is absent from the graph.",
      now,
    })
    Database.use((db) =>
      db
        .update(EngineGoalTable)
        .set({
          acceptance_specs: [
            {
              id: "acc-contract-audit-drift",
              source_requirement_id: "REQ-1",
              goal_id: goalID,
              title: "Contract audit drift",
              severity: "essential",
              scorers: [
                {
                  type: "contract_audit",
                  name: "graph-contract",
                  spec: { kind: "contract_graph", contract_ids: ["missing_contract"] },
                  expect: { status: "passed" },
                },
              ],
            },
          ],
        })
        .where(eq(EngineGoalTable.id, goalID))
        .run(),
    )

    let buildStarted = false
    buildAgentRunImpl = async () => {
      buildStarted = true
      return {
        result: { status: "passed", summary: "should not run", files_changed: [], tests: [] },
        sessionID: "ses_should_not_start",
        worktreeDir: tmp.path,
        diffs: [],
      }
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "contract audit drift predispatch" })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        await expect(
          tools.build.execute(
            {
              goalID,
              reason: "Per-goal build should reject persisted graph/audit mismatch before starting build.",
            },
            buildToolOptions(),
          ),
        ).rejects.toThrow("contract_audit references unknown graph contract")
        expect(buildStarted).toBe(false)
        expect(listGoalRunsByGoal(goalID)).toHaveLength(0)
      },
    })
  })

  test("steer_subagent returns an activity snapshot for a live-owned build goal_run session", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_steer_goal_run_${stamp}`
    const taskID = `tsk_steer_goal_run_${stamp}`
    const goalID = `gol_steer_goal_run_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "steer_subagent goal_run resolution",
      taskTitle: "steer_subagent goal_run resolution",
      request: "Resolve goal_run ids to build sessions",
      goalTitle: "Build child session",
      goalSlug: "build-child-session",
      objective: "Reject steering a running build via the live goal_run id from read_context",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "steer goal_run parent" })
        const child = await Session.create({
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "steer goal_run child",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const goalRunID = beginBuildAttempt({
          taskID,
          goalID,
          sessionID: child.id,
        })
        const ownershipPayload = createOrchestratorToolOwnershipPayload({
          taskID,
          orchestratorSessionID: parent.id,
          orchestratorMessageID: `msg_steer_goal_run_${stamp}`,
          toolCallID: `cal_steer_goal_run_${stamp}`,
          toolPartID: `prt_steer_goal_run_${stamp}`,
          childSessionID: child.id,
          scope: "goal",
          goalID,
          goalRunID,
        })
        insertOrchestratorToolOwnershipArtifact({
          taskID,
          goalRunID,
          label: "tool-ownership-start",
          payload: ownershipPayload,
        })
        SessionStatus.set(child.id, { type: "streaming" })
        const gate = withStreamActivity({ idleMs: 60_000, label: "test-steer-goal-run" })
        const unregisterActivityGate = SessionStatus.registerActivityGate(child.id, gate)
        const replySpy = spyOn(EngineService, "replyAgentSession").mockResolvedValue({
          task_id: taskID,
          session_id: child.id,
          message_id: "msg_reply_goal_run",
        } as Awaited<ReturnType<typeof EngineService.replyAgentSession>>)
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        try {
          const result = await tools.steer_subagent.execute(
            {
              session_id: goalRunID,
              message: "汇报当前实现进度",
              reason: "live goal_run should resolve to the child build session",
            },
            buildToolOptions(),
          )

          expect(replySpy).not.toHaveBeenCalled()
          expect(result).toContain("Activity snapshot for live-owned build child session")
          expect(result).toContain(`child_session_id=${child.id}`)
          expect(result).toContain("status=streaming")
          expect(result).toMatch(/last_activity_at=\d+/)
          expect(result).toMatch(/age_ms=\d+/)
          expect(result).toContain(`owner_tool_part=${ownershipPayload.tool_part_id}`)
          expect(result).toContain(`owner_ownership=${ownershipPayload.ownership_id}`)
          expect(result).toContain(`goal_run=${goalRunID}`)
        } finally {
          unregisterActivityGate()
          gate.dispose()
        }
      },
    })
  })

  test("steer_subagent returns an activity snapshot for a live-owned build goal_id target", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_steer_goal_id_${stamp}`
    const taskID = `tsk_steer_goal_id_${stamp}`
    const goalID = `gol_steer_goal_id_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "steer_subagent goal id resolution",
      taskTitle: "steer_subagent goal id resolution",
      request: "Resolve goal ids to build sessions",
      goalTitle: "Build child session",
      goalSlug: "build-child-session",
      objective: "Reject steering a running build via goal_id without guessing the child session",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "steer goal id parent" })
        const child = await Session.create({
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "steer goal id child",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const goalRunID = beginBuildAttempt({
          taskID,
          goalID,
          sessionID: child.id,
        })
        const ownershipPayload = createOrchestratorToolOwnershipPayload({
          taskID,
          orchestratorSessionID: parent.id,
          orchestratorMessageID: `msg_steer_goal_id_${stamp}`,
          toolCallID: `cal_steer_goal_id_${stamp}`,
          toolPartID: `prt_steer_goal_id_${stamp}`,
          childSessionID: child.id,
          scope: "goal",
          goalID,
          goalRunID,
        })
        insertOrchestratorToolOwnershipArtifact({
          taskID,
          goalRunID,
          label: "tool-ownership-start",
          payload: ownershipPayload,
        })
        SessionStatus.set(child.id, { type: "streaming" })
        const gate = withStreamActivity({ idleMs: 60_000, label: "test-steer-goal-id" })
        const unregisterActivityGate = SessionStatus.registerActivityGate(child.id, gate)
        const replySpy = spyOn(EngineService, "replyAgentSession").mockResolvedValue({
          task_id: taskID,
          session_id: child.id,
          message_id: "msg_reply_goal_id",
        } as Awaited<ReturnType<typeof EngineService.replyAgentSession>>)
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        try {
          const result = await tools.steer_subagent.execute(
            {
              goal_id: goalID,
              message: "汇报当前测试进度",
              reason: "goal_id should resolve to the latest live child session",
            },
            buildToolOptions(),
          )

          expect(replySpy).not.toHaveBeenCalled()
          expect(result).toContain("Activity snapshot for live-owned build child session")
          expect(result).toContain(`child_session_id=${child.id}`)
          expect(result).toContain("status=streaming")
          expect(result).toMatch(/last_activity_at=\d+/)
          expect(result).toMatch(/age_ms=\d+/)
          expect(result).toContain(`owner_tool_part=${ownershipPayload.tool_part_id}`)
          expect(result).toContain(`owner_ownership=${ownershipPayload.ownership_id}`)
          expect(result).toContain(`goal_run=${goalRunID}`)
        } finally {
          unregisterActivityGate()
          gate.dispose()
        }
      },
    })
  })

  test("steer_subagent still injects steering for a non-build child session", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_steer_non_build_${stamp}`
    const taskID = `tsk_steer_non_build_${stamp}`
    const goalID = `gol_steer_non_build_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "steer non build",
      taskTitle: "steer non build",
      request: "Steer a normal child session",
      goalTitle: "Non-build child",
      goalSlug: "non-build-child",
      objective: "Confirm non-build steer_subagent still replies",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "steer non-build parent" })
        const child = await Session.create({
          kind: "integrity",
          parentID: parent.id,
          title: "steer non-build child",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const replySpy = spyOn(EngineService, "replyAgentSession").mockResolvedValue({
          task_id: taskID,
          session_id: child.id,
          message_id: "msg_reply_non_build",
        } as Awaited<ReturnType<typeof EngineService.replyAgentSession>>)
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.steer_subagent.execute(
          {
            session_id: child.id,
            message: "report current status",
            reason: "confirm non-build steering remains an injected reply",
          },
          buildToolOptions(),
        )

        expect(replySpy).toHaveBeenCalledWith(taskID, child.id, { message: "report current status" })
        expect(result).toContain(`Steered sub-agent session ${child.id}`)
        expect(result).toContain("message=msg_reply_non_build")
      },
    })
  })

  test("steer_subagent keeps the fresh-build guidance for a build session with no live owner", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_steer_build_no_owner_${stamp}`
    const taskID = `tsk_steer_build_no_owner_${stamp}`
    const goalID = `gol_steer_build_no_owner_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "steer build no owner",
      taskTitle: "steer build no owner",
      request: "Keep no-owner build steering structural",
      goalTitle: "No-owner build child",
      goalSlug: "no-owner-build-child",
      objective: "Confirm no-owner build steer_subagent remains a fresh build instruction",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "steer no-owner parent" })
        const child = await Session.create({
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "steer no-owner child",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const replySpy = spyOn(EngineService, "replyAgentSession").mockResolvedValue({
          task_id: taskID,
          session_id: child.id,
          message_id: "msg_reply_no_owner",
        } as Awaited<ReturnType<typeof EngineService.replyAgentSession>>)
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.steer_subagent.execute(
          {
            session_id: child.id,
            message: "report current status",
            reason: "no live owner means this should remain a build retry instruction",
          },
          buildToolOptions(),
        )

        expect(replySpy).not.toHaveBeenCalled()
        expect(result).toContain(`Error: steer_subagent cannot generically steer build session ${child.id}.`)
        expect(result).toContain("Use build({ goalID, request }) for a fresh stage-attempt runtime contract instead.")
      },
    })
  })

  test("cancel_subagent aborts a live goal attempt by child session", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_cancel_subagent_${stamp}`
    const taskID = `tsk_cancel_subagent_${stamp}`
    const goalID = `gol_cancel_subagent_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "cancel_subagent goal session",
      taskTitle: "cancel_subagent goal session",
      request: "Cancel a wedged build child session and re-dispatch later",
      goalTitle: "Cancel stale child session",
      goalSlug: "cancel-stale-child-session",
      objective: "Abort the live goal attempt tied to the child build session",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "cancel_subagent parent" })
        const child = await Session.create({
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "cancel_subagent child",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const runID = `run_cancel_subagent_${stamp}`
        const goalRunID = beginBuildAttempt({
          taskID,
          goalID,
          runID,
          sessionID: child.id,
        })
        const goalRun = findGoalRun(goalRunID)
        expect(goalRun).toBeDefined()

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.cancel_subagent.execute(
          {
            session_id: child.id,
            reason: "steer gave no useful progress; abort the stale child before re-dispatch",
          },
          buildToolOptions(),
        )

        expect(findGoalRun(goalRunID)?.status).toBe("aborted")
        expect(findGoalRun(goalRunID)?.error).toContain("cancel_subagent:")
        expect(result).toContain(`Cancelled sub-agent session ${child.id}`)
        expect(result).toContain(`goal_run ${goalRunID} aborted`)
      },
    })
  })

  test("cancel_subagent resolves goal_id to the latest live child attempt", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_cancel_subagent_goal_${stamp}`
    const taskID = `tsk_cancel_subagent_goal_${stamp}`
    const goalID = `gol_cancel_subagent_goal_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "cancel_subagent goal id",
      taskTitle: "cancel_subagent goal id",
      request: "Cancel the latest live child session by goal id",
      goalTitle: "Cancel latest child session by goal id",
      goalSlug: "cancel-latest-child-session-by-goal-id",
      objective: "Resolve goal_id to the latest live child session before aborting the attempt",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "cancel_subagent goal parent" })
        const child = await Session.create({
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "cancel_subagent goal child",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const runID = `run_cancel_subagent_goal_${stamp}`
        const goalRunID = beginBuildAttempt({
          taskID,
          goalID,
          runID,
          sessionID: child.id,
        })

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.cancel_subagent.execute(
          {
            goal_id: goalID,
            reason: "resume should terminate the latest live child session for this goal before re-dispatch",
          },
          buildToolOptions(),
        )

        expect(findGoalRun(goalRunID)?.status).toBe("aborted")
        expect(result).toContain(`Cancelled sub-agent session ${child.id}`)
        expect(result).toContain(`source=${goalID} -> goal_run ${goalRunID} -> session ${child.id}`)
      },
    })
  })

  test("live build ownership blocks contract mutation but cancel_subagent can stop the running build", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_live_owner_guard_${stamp}`
    const taskID = `tsk_live_owner_guard_${stamp}`
    const goalID = `gol_live_owner_guard_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "live owner guard",
      taskTitle: "live owner guard",
      request: "Do not mutate a goal while its build tool owns it",
      goalTitle: "Owned build goal",
      goalSlug: "owned-build-goal",
      objective: "Guard live build ownership",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "live owner parent" })
        const child = await Session.create({
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "live owner child",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const goalRunID = beginBuildAttempt({
          taskID,
          goalID,
          sessionID: child.id,
        })
        const ownershipPayload = createOrchestratorToolOwnershipPayload({
          taskID,
          orchestratorSessionID: parent.id,
          orchestratorMessageID: `msg_live_owner_${stamp}`,
          toolCallID: `cal_live_owner_${stamp}`,
          toolPartID: `prt_live_owner_${stamp}`,
          childSessionID: child.id,
          scope: "goal",
          goalID,
          goalRunID,
        })
        insertOrchestratorToolOwnershipArtifact({
          taskID,
          goalRunID,
          label: "tool-ownership-start",
          payload: ownershipPayload,
        })

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const modifyResult = await tools.modify_goal.execute(
          {
            goalID,
            updates: { objective: "Mutated while live" },
            reason: "should be rejected while live owned",
          },
          buildToolOptions(),
        )
        expect(modifyResult).toContain("Error: modify_goal refused")
        expect(findGoal(goalID)?.objective).toBe("Guard live build ownership")
        expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(1)

        const cancelResult = await tools.cancel_subagent.execute(
          {
            goal_id: goalID,
            reason: "operator changed direction while this build was still running",
          },
          buildToolOptions(),
        )
        expect(cancelResult).toContain("Cancelled live-owned build session")
        expect(cancelResult).toContain(`goal_run ${goalRunID} aborted`)
        expect(findGoalRun(goalRunID)?.status).toBe("aborted")
        expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(0)

        completeOrchestratorToolOwnership({
          taskID,
          ownershipID: ownershipPayload.ownership_id,
          outcome: "completed",
          now: now + 1,
        })
        expect(findLatestOwnershipByID(taskID, ownershipPayload.ownership_id)?.payload.outcome).toBe("cancelled")
      },
    })
  })

  test("cancel_subagent recover_stale mode closes live ownership and aborts the wedged goal attempt", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_cancel_subagent_recover_stale_${stamp}`
    const taskID = `tsk_cancel_subagent_recover_stale_${stamp}`
    const goalID = `gol_cancel_subagent_recover_stale_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "recover stale build",
      taskTitle: "recover stale build",
      request: "Recover a build that no longer has active execution",
      goalTitle: "Recover stale build goal",
      goalSlug: "cancel-subagent-recover-stale-goal",
      objective: "Close stale build ownership so the goal can retry",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "recover stale parent" })
        const child = await Session.create({
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "recover stale child",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const runID = `run_cancel_subagent_recover_stale_${stamp}`
        const goalRunID = beginBuildAttempt({
          taskID,
          goalID,
          runID,
          sessionID: child.id,
        })
        const orchestratorMessageID = `msg_cancel_subagent_recover_stale_${stamp}`
        const toolPartID = `prt_cancel_subagent_recover_stale_${stamp}`
        const toolCallID = `cal_cancel_subagent_recover_stale_${stamp}`
        await Session.persistMessage({
          info: {
            id: orchestratorMessageID,
            sessionID: parent.id,
            role: "assistant",
            time: { created: now },
            parentID: `msg_user_cancel_subagent_recover_stale_${stamp}`,
            providerID: "test-provider",
            modelID: "test-model",
            agent: "orchestrator",
            path: { cwd: tmp.path, root: tmp.path },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          },
          parts: [
            {
              id: toolPartID,
              messageID: orchestratorMessageID,
              sessionID: parent.id,
              type: "tool",
              callID: toolCallID,
              tool: "build",
              state: {
                status: "running",
                input: { goalID },
                title: "Build",
                time: { start: now },
              },
            },
          ],
          touchSessionID: parent.id,
        })
        const ownershipPayload = createOrchestratorToolOwnershipPayload({
          taskID,
          orchestratorSessionID: parent.id,
          orchestratorMessageID,
          toolCallID,
          toolPartID,
          childSessionID: child.id,
          scope: "goal",
          goalID,
          goalRunID,
          now,
        })
        insertOrchestratorToolOwnershipArtifact({
          taskID,
          runID,
          goalRunID,
          label: "tool-ownership-start",
          payload: ownershipPayload,
          now,
        })

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.cancel_subagent.execute(
          {
            goal_run_id: goalRunID,
            mode: "recover_stale",
            reason: "operator note arrived after the build session stopped producing events",
          },
          buildToolOptions("cancel_subagent"),
        )

        expect(result).toContain(`Recovered stale live-owned build ${child.id}`)
        expect(result).toContain(`ownership=${ownershipPayload.ownership_id}`)
        expect(result).toContain(`goal_run ${goalRunID} aborted`)
        expect(findGoalRun(goalRunID)?.status).toBe("aborted")
        expect(findGoalRun(goalRunID)?.error).toContain("cancel_subagent:")
        expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(0)

        const messages = await Session.messages({ sessionID: parent.id })
        const toolPart = messages.flatMap((message) => message.parts).find((part) => part.id === toolPartID)
        expect(toolPart?.type).toBe("tool")
        expect(toolPart?.type === "tool" ? toolPart.state.status : undefined).toBe("error")
      },
    })
  })

  test("cancel_subagent recover_stale mode refuses a build session that is still streaming", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_recover_streaming_build_${stamp}`
    const taskID = `tsk_recover_streaming_build_${stamp}`
    const goalID = `gol_recover_streaming_build_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "recover streaming build",
      taskTitle: "recover streaming build",
      request: "Do not recover an actively streaming build",
      goalTitle: "Recover streaming build goal",
      goalSlug: "recover-streaming-build-goal",
      objective: "Refuse recovery while the build session is active",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "recover streaming parent" })
        const child = await Session.create({
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "recover streaming child",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const goalRunID = beginBuildAttempt({
          taskID,
          goalID,
          sessionID: child.id,
        })
        const ownershipPayload = createOrchestratorToolOwnershipPayload({
          taskID,
          orchestratorSessionID: parent.id,
          orchestratorMessageID: `msg_recover_streaming_build_${stamp}`,
          toolCallID: `cal_recover_streaming_build_${stamp}`,
          toolPartID: `prt_recover_streaming_build_${stamp}`,
          childSessionID: child.id,
          scope: "goal",
          goalID,
          goalRunID,
          now,
        })
        insertOrchestratorToolOwnershipArtifact({
          taskID,
          goalRunID,
          label: "tool-ownership-start",
          payload: ownershipPayload,
          now,
        })
        SessionStatus.set(child.id, { type: "streaming" })

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.cancel_subagent.execute(
          {
            goal_id: goalID,
            mode: "recover_stale",
            reason: "should not abort an active stream",
          },
          buildToolOptions("recover_streaming_build"),
        )

        expect(result).toContain("refused stale recovery because build session")
        expect(result).toContain("streaming")
        expect(findGoalRun(goalRunID)?.status).toBe("running")
        expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(1)
        SessionStatus.set(child.id, { type: "terminal", reason: "aborted", error: "test cleanup" })
      },
    })
  })

  test("cancel_subagent recover_stale mode is a no-op when the build session has no live ownership", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_recover_no_owner_${stamp}`
    const taskID = `tsk_recover_no_owner_${stamp}`
    const goalID = `gol_recover_no_owner_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "recover no owner",
      taskTitle: "recover no owner",
      request: "No-op when there is no live build ownership",
      goalTitle: "Recover no owner goal",
      goalSlug: "recover-no-owner-goal",
      objective: "Do not mutate state without live ownership",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "recover no owner parent" })
        const child = await Session.create({
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "recover no owner child",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.cancel_subagent.execute(
          {
            session_id: child.id,
            mode: "recover_stale",
            reason: "there is no live ownership to recover",
          },
          buildToolOptions("recover_no_owner"),
        )

        expect(result).toContain("No live build ownership found")
        expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(0)
      },
    })
  })

  test("read_context surfaces latest goal_run and child session ids for running goals", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_read_context_goal_run_${stamp}`
    const taskID = `tsk_read_context_goal_run_${stamp}`
    const goalID = `gol_read_context_goal_run_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "read_context goal runtime",
      taskTitle: "read_context goal runtime",
      request: "Expose runtime ids for steering",
      goalTitle: "Surface live runtime ids",
      goalSlug: "surface-live-runtime-ids",
      objective: "Show latest goal_run and child session ids so the orchestrator can steer the live build correctly",
      now,
      requirementIDs: ["REQ-1", "REQ-3"],
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "read_context parent" })
        const child = await Session.create({
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "read_context child",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const goalRunID = beginBuildAttempt({
          taskID,
          goalID,
          sessionID: child.id,
        })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.read_context.execute({ scope: "goals" }, {} as any)

        expect(result).toContain("requirement_ids: REQ-1, REQ-3")
        expect(result).toContain(`latest_goal_run_id: ${goalRunID}`)
        expect(result).toContain("latest_goal_run_status: running")
        expect(result).toContain(`latest_goal_session_id: ${child.id}`)
      },
    })
  })

  test("task-level direct build creates a run and deliver stays disabled", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_direct_deliver_${stamp}`
    const taskID = `tsk_direct_deliver_${stamp}`
    const direct = WorkflowRegistry.resolveSync("direct")!
    const workflowState = createWorkflowState(direct)

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: tmp.path,
          name: "Direct build deliver project",
          sandboxes: "[]",
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "Direct build deliver task",
          request: "Apply a direct edit and verify it through delivery.",
          kind: "build",
          priority: "normal",
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })

    buildAgentRunImpl = async () => {
      await fs.writeFile(path.join(tmp.path, "direct-output.txt"), "direct build output\n")
      return {
        result: {
          status: "passed",
          summary: "Direct build wrote an output file.",
          files_changed: [
            {
              path: "direct-output.txt",
              summary: "Added direct build output.",
              reason: "The direct build request required a concrete file change.",
            },
          ],
          tests: [],
        },
        sessionID: "ses_direct_build_deliver",
        worktreeDir: tmp.path,
        diffs: [{ file: "direct-output.txt", diff: "New file:\ndirect build output\n" }],
      }
    }
    deliveryServiceVerifyImpl = async (input: any) => {
      throw new Error(`DeliveryService.verify must not run after deliver retirement: ${input?.runID ?? "no-run"}`)
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "direct build deliver test" })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
          workflow: direct,
          workflowState,
        })

        const buildResult = await tools.build.execute(
          {
            request: "Write the direct output file.",
            reason: "Explicit kind=build task-level direct implementation.",
          },
          buildToolOptions(),
        )
        expect(buildResult).toContain("Build agent finished")

        const run = findActiveRunForTask(taskID)
        expect(run).toBeDefined()
        expect(run?.plan_version_id).toBeNull()

        const deliverResult = await tools.deliver.execute(
          { reason: "Direct build finished and must pass delivery." },
          buildToolOptions(),
        )

        expect(deliverResult).toContain("deliver: disabled")
        expect(deliverResult).toContain("integrity")
        expect(findRun(run!.id)?.phase).not.toBe("deliver")
        expect(findDeliveryByRun(run!.id)).toBeUndefined()
      },
    })
  })

  test("post-build integrity pass with advisory concerns completes the task and preserves evidence", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_integrity_completed_${stamp}`
    const taskID = `tsk_integrity_completed_${stamp}`
    const goalID = `goal_integrity_completed_${stamp}`
    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const workflowState = createWorkflowState(pipeline)

    buildAgentRunImpl = async (input: any) => {
      await markBuildSlotAcquired(input)
      await fs.writeFile(path.join(tmp.path, "accepted-output.txt"), "accepted integrity output\n")
      return {
        result: {
          status: "passed",
          summary: "Direct build wrote accepted output.",
          files_changed: [
            {
              path: "accepted-output.txt",
              summary: "Added accepted output.",
              reason: "The direct build request required a concrete file change.",
            },
          ],
          tests: [],
        },
        sessionID: "ses_goal_build_integrity_completed",
        worktreeDir: input.managedWorktree.directory,
        worktreeBranch: input.managedWorktree.branch,
        worktreeBaseRef: input.managedWorktree.baseRef,
        diffs: [{ file: "accepted-output.txt", diff: "New file:\naccepted integrity output\n" }],
      }
    }
    deliveryServiceVerifyImpl = async () => {
      throw new Error("DeliveryService.verify must not complete the task after deliver retirement")
    }
    computeRequirementStatusSnapshotImpl = () => [
      {
        requirementID: "REQ-1",
        status: "satisfied",
        claimingGoals: [{ goalID: "direct-task", runStatus: "completed" }],
      },
    ]
    let capturedIntegrityInput: any
    reviewIntegrityImpl = async (input) => {
      capturedIntegrityInput = input
      return {
        verdict: "pass",
        summary: "Integrity pass with advisory concern",
        teamReportMarkdown:
          "**solution_quality = concerns**\n\nREQ-1 evidence is acceptable but should be strengthened next time.",
        reviewers: [
          {
            reviewerID: "requirement_fidelity",
            scope: "Requirement fidelity",
            verdict: "pass",
            summary: "REQ-1 is satisfied by the completed build evidence.",
            evidence: ["REQ-1 status snapshot is satisfied."],
            findings: [],
            openQuestions: [],
          },
          {
            reviewerID: "solution_quality",
            scope: "Solution quality",
            verdict: "concerns",
            summary: "Evidence is acceptable but should be stronger next time.",
            evidence: ["accepted-output.txt was produced."],
            findings: [
              {
                id: "F-1",
                severity: "advisory",
                verdictImpact: "concerns",
                title: "Weak acceptance evidence",
                description: "REQ-1 evidence is acceptable but should be strengthened next time.",
                evidence: ["accepted-output.txt was produced."],
                targetIDs: [goalID],
                requirementIDs: ["REQ-1"],
                specIDs: [],
                filePaths: ["accepted-output.txt"],
                repair: "Strengthen acceptance evidence on the next build.",
                reviewers: ["solution_quality"],
                consensus: "agreed",
              },
            ],
            openQuestions: [],
          },
        ],
        findings: [
          {
            id: "F-1",
            severity: "advisory",
            verdictImpact: "concerns",
            title: "Weak acceptance evidence",
            description: "REQ-1 evidence is acceptable but should be strengthened next time.",
            evidence: ["accepted-output.txt was produced."],
            targetIDs: [goalID],
            requirementIDs: ["REQ-1"],
            specIDs: [],
            filePaths: ["accepted-output.txt"],
            repair: "Strengthen acceptance evidence on the next build.",
            reviewers: ["solution_quality"],
            consensus: "agreed",
          },
        ],
        rounds: [
          {
            roundID: "round-1",
            prompt: "Confirm post-build evidence quality.",
            reviewerIDs: ["requirement_fidelity", "solution_quality"],
            outcome: "Advisory concern retained; pass verdict remains valid.",
          },
        ],
        requiredRepairs: [],
        unresolvedDisagreements: [],
        fact_check_items: [],
        sessionID: "ses_integrity_advisory_complete",
      }
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "integrity completion test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Integrity completion project",
          taskTitle: "Integrity completion task",
          request: "Verify post-build integrity is the completion authority",
          goalTitle: "Integrity completion goal",
          goalSlug: "integrity-completion",
          objective: "Produce terminal build evidence for integrity completion",
          now,
        })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
          workflow: pipeline,
          workflowState,
        })

        const buildResult = await tools.build.execute(
          {
            goalID,
            request: "Write the accepted output file.",
            reason: "Per-goal pipeline implementation before integrity.",
          },
          buildToolOptions(),
        )
        expect(buildResult).toContain("Build agent finished")

        const run = findActiveRunForTask(taskID)
        expect(run).toBeDefined()

        insertArchitectContractGraphArtifact({ taskID, now: now + 1 })
        const integrityResult = await tools.integrity.execute(
          { reason: "Goal build finished and post-build integrity should complete the task." },
          buildToolOptions(),
        )

        expect(integrityResult).toContain("Integrity verdict: pass")
        expect(capturedIntegrityInput.replayContext).toMatchObject({
          attemptNumber: 1,
          buildEvidenceSinceLastReview: {
            changedFiles: [],
            goalRuns: [expect.objectContaining({ goalID, status: "completed" })],
          },
          scaleSignals: {
            phase: "post_build",
            priorAttempts: 0,
            changedFilesSinceLastReview: 0,
          },
        })
        expect(integrityResult).toContain("findings=1")
        expect(integrityResult).toContain("REQ-1 evidence is acceptable but should be strengthened next time.")
        expect(integrityResult).toContain("task completed")
        const taskRow = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get(),
        )
        expect(taskRow?.session_id).toBe(parent.id)
        expect(taskRow?.time_completed).toBeNumber()
        expect(deriveTaskStatus(taskRow!)).toBe("completed")
        expect(findRun(run!.id)?.status).toBe("completed")
        expect(findDeliveryByRun(run!.id)).toBeUndefined()
        expect(findEvaluationByRun(run!.id)).toBeUndefined()
        const artifact = findLatestIntegrityAttemptArtifact({ taskID, specSnapshotID: `spec_${goalID}` })
        const payload = artifact?.payload as Record<string, any> | undefined
        expect(artifact?.label).toBe("verdict-pass")
        expect(payload?.attempts).toBe(1)
        expect(payload?.findings_count).toBe(1)
        expect(payload?.required_repairs_count).toBe(0)
        expect(payload?.team_report_markdown).toContain("**solution_quality = concerns**")
        expect(payload?.team_report_markdown).toContain(
          "REQ-1 evidence is acceptable but should be strengthened next time.",
        )

        const publishResult = await tools.publish_delivery.execute(
          { reason: "Explicit artifact export after integrity completion." },
          buildToolOptions(),
        )
        expect(publishResult).toContain("publish_delivery: disabled")
        const taskAfterPublishAttempt = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get(),
        )
        expect(deriveTaskStatus(taskAfterPublishAttempt!)).toBe("completed")

        const reopened = await openTaskForOperatorMessage(
          taskAfterPublishAttempt!,
          "Operator continuation reopened task",
        )
        expect(reopened.session_id).toBe(parent.id)
        expect(reopened.time_completed).toBeNull()
        expect(deriveTaskStatus(reopened)).toBe("queued")
        expect(findRun(run!.id)?.status).toBe("completed")
        expect(findDeliveryByRun(run!.id)).toBeUndefined()
        expect(findEvaluationByRun(run!.id)).toBeUndefined()
      },
    })
  })

  test("post-build integrity needs_correction blocks the active run and keeps the task active", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_integrity_blocked_${stamp}`
    const taskID = `tsk_integrity_blocked_${stamp}`
    const goalID = `goal_integrity_blocked_${stamp}`
    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const workflowState = createWorkflowState(pipeline)

    buildAgentRunImpl = async (input: any) => {
      await markBuildSlotAcquired(input)
      await fs.writeFile(path.join(tmp.path, "correction-output.txt"), "needs correction output\n")
      return {
        result: {
          status: "passed",
          summary: "Build produced output that integrity will reject.",
          files_changed: [
            {
              path: "correction-output.txt",
              summary: "Added output requiring integrity correction.",
              reason: "The mocked build needs terminal evidence before integrity.",
            },
          ],
          tests: [],
        },
        sessionID: "ses_goal_build_integrity_blocked",
        worktreeDir: input.managedWorktree.directory,
        worktreeBranch: input.managedWorktree.branch,
        worktreeBaseRef: input.managedWorktree.baseRef,
        diffs: [{ file: "correction-output.txt", diff: "New file:\nneeds correction output\n" }],
      }
    }
    computeRequirementStatusSnapshotImpl = () => [
      {
        requirementID: "REQ-1",
        status: "satisfied",
        claimingGoals: [{ goalID, runStatus: "completed" }],
      },
    ]
    reviewIntegrityImpl = async () =>
      integrityTeamResult({
        verdict: "needs_correction",
        summary: "Integrity found a post-build requirement mismatch.",
        findings: [
          integrityFinding({
            id: "F-REQ-1",
            description: "REQ-1 is not fully satisfied by the build output.",
            targetIDs: [goalID],
            requirementIDs: ["REQ-1"],
            repair: "Cover REQ-1 completely.",
          }),
        ],
        requiredRepairs: [
          integrityRepair({
            id: "repair-REQ-1",
            description: "Cover REQ-1 completely.",
            targetIDs: [goalID],
          }),
        ],
        sessionID: "ses_integrity_blocked",
      })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "integrity blocked test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Integrity blocked project",
          taskTitle: "Integrity blocked task",
          request: "Verify non-pass post-build integrity blocks the active run",
          goalTitle: "Integrity blocked goal",
          goalSlug: "integrity-blocked",
          objective: "Produce terminal build evidence for a non-pass integrity review",
          now,
        })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
          workflow: pipeline,
          workflowState,
        })

        const buildResult = await tools.build.execute(
          {
            goalID,
            request: "Write output that will need correction.",
            reason: "Per-goal pipeline implementation before integrity.",
          },
          buildToolOptions(),
        )
        expect(buildResult).toContain("Build agent finished")

        const run = findActiveRunForTask(taskID)
        expect(run).toBeDefined()

        insertArchitectContractGraphArtifact({ taskID, now: now + 1 })
        const integrityResult = await tools.integrity.execute(
          { reason: "Goal build finished and post-build integrity should block the run." },
          buildToolOptions(),
        )

        expect(integrityResult).toContain("Integrity verdict: needs_correction")
        const blockedRun = findRun(run!.id)
        expect(blockedRun?.status).toBe("blocked")
        expect(blockedRun?.blocking_reason).toContain("needs_correction")
        expect(blockedRun?.blocking_reason).toContain("integrity")
        expect(blockedRun?.error).toBe("Integrity found a post-build requirement mismatch.")

        const taskRow = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get(),
        )
        expect(taskRow?.time_completed).toBeNull()
        expect(deriveTaskStatus(taskRow!)).toBe("active")
      },
    })
  })

  test("workflow task-level build requires directBuildIntent before starting build agent", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_build_intent_${stamp}`
    const taskID = `tsk_build_intent_${stamp}`
    const pipeline = WorkflowRegistry.resolveSync("pipeline")!

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "Build workflow intent test",
          sandboxes: "[]",
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "Build workflow intent task",
          request: "Verify workflow task-level build intent is explicit",
          kind: "workflow",
          priority: "normal",
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })

    buildAgentRunImpl = async () => {
      throw new Error("BuildAgent.run must not start when workflow directBuildIntent is missing")
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "build workflow intent test" })
        const workflowState = createWorkflowState(pipeline)
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
          workflow: pipeline,
          workflowState,
        })

        const result = await tools.build.execute(
          {
            request: "Implement the page directly.",
            reason: "Scoped workflow task; direct build is enough.",
          },
          buildToolOptions(),
        )

        expect(result).toContain("rejected task-level workflow build")
        expect(result).toContain("directBuildIntent is required")
        expect(result).toContain('directBuildIntent="modify_files"')
        expect(result).not.toContain(["inspect", "only"].join("_"))
      },
    })
  })

  test("workflow task-level investigation build is rejected before starting build agent", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_build_inspect_${stamp}`
    const taskID = `tsk_build_inspect_${stamp}`
    const pipeline = WorkflowRegistry.resolveSync("pipeline")!

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "Build workflow inspect test",
          sandboxes: "[]",
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "Build workflow inspect task",
          request: "Verify inspect-only workflow direct build is blocked",
          kind: "workflow",
          priority: "normal",
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })

    const retiredIntent = ["inspect", "only"].join("_")
    buildAgentRunImpl = async () => {
      throw new Error("BuildAgent.run must not start for retired investigation intent")
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "build workflow inspect test" })
        const workflowState = createWorkflowState(pipeline)
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
          workflow: pipeline,
          workflowState,
        })

        const result = await tools.build.execute(
          {
            request: "Explore the component tree without changing files.",
            reason: "Need repository investigation before implementation.",
            directBuildIntent: retiredIntent,
          } as any,
          buildToolOptions(),
        )

        expect(result).toContain("rejected task-level build")
        expect(result).toContain(`directBuildIntent="${retiredIntent}" is not supported`)
        expect(result).toContain("build is implementation-only")
        expect(result).toContain("Repository investigation belongs to analyze_intent, requirements, or explore")
        const run = findActiveRunForTask(taskID)
        expect(run).toBeUndefined()
      },
    })
  })

  test("propose_task creates a follow-up task only after user confirmation", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_propose_${stamp}`
    const taskID = `tsk_propose_${stamp}`
    const createSpy = spyOn(EngineService, "createTask").mockResolvedValue("tsk_created_followup")

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: tmp.path,
          name: "propose task project",
          sandboxes: "[]",
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          session_id: null,
          source: "test",
          title: "Parent task",
          request: "Build the initial feature.",
          kind: "workflow",
          priority: "normal",
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(Config, "get").mockResolvedValue({ experimental: { confirm_proposed_tasks: true } } as any)
        const pipeline = WorkflowRegistry.resolveSync("pipeline")!
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: "ses_orchestrator_propose",
          workflow: pipeline,
          workflowState: createWorkflowState(pipeline),
        })

        const proposal = tools.propose_task.execute(
          {
            title: "Harden generated component tests",
            request: "Add focused tests for the component generated by the parent task.",
            reason: "This is a separate quality-hardening follow-up after the current request.",
            priority: "high",
            kind: "workflow",
          },
          buildToolOptions(),
        )

        let pending = await Question.list()
        for (let i = 0; pending.length === 0 && i < 20; i++) {
          await Bun.sleep(5)
          pending = await Question.list()
        }
        expect(pending).toHaveLength(1)
        expect(pending[0].questions[0].options.map((option) => option.label)).toEqual(["创建任务", "不创建"])

        await Question.reply({ requestID: pending[0].id, answers: [["创建任务"]] })
        const result = await proposal

        expect(result).toContain("Follow-up task created after user confirmation")
        expect(result).toContain("tsk_created_followup")
        expect(createSpy).toHaveBeenCalledTimes(1)
        expect(createSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Harden generated component tests",
            request: "Add focused tests for the component generated by the parent task.",
            priority: "high",
            kind: "workflow",
            source: "orchestrator:propose_task",
            metadata: {
              origin: "orchestrator_proposed_task",
              parent_task_id: taskID,
              inheritance: "orchestrator_follow_up",
              proposal_reason: "This is a separate quality-hardening follow-up after the current request.",
            },
          }),
        )
      },
    })
  })

  test("propose_task can create a follow-up from a completed parent task", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_completed_propose_${stamp}`
    const taskID = `tsk_completed_propose_${stamp}`
    const createSpy = spyOn(EngineService, "createTask").mockResolvedValue("tsk_completed_followup")

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: tmp.path,
          name: "completed propose task project",
          sandboxes: "[]",
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          session_id: null,
          source: "test",
          title: "Completed parent task",
          request: "Build the initial feature and run the first test pass.",
          kind: "workflow",
          priority: "normal",
          time_created: now,
          time_updated: now,
          time_started: now - 1_000,
          time_completed: now,
        })
        .run()
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const pipeline = WorkflowRegistry.resolveSync("pipeline")!
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: "ses_orchestrator_completed_propose",
          workflow: pipeline,
          workflowState: createWorkflowState(pipeline),
        })

        const proposal = tools.propose_task.execute(
          {
            title: "Run second verification pass",
            request: "Run a second verification pass for the completed parent task and fix any regressions found.",
            reason: "The first task is complete; this is a separate follow-up verification scope.",
            priority: "high",
            queue: true,
            kind: "workflow",
          },
          buildToolOptions(),
        )

        const result = await proposal
        const pending = await Question.list()

        expect(result).toContain("Follow-up task created without user confirmation")
        expect(result).toContain("tsk_completed_followup")
        expect(pending).toHaveLength(0)
        expect(createSpy).toHaveBeenCalledTimes(1)
        expect(createSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Run second verification pass",
            request: "Run a second verification pass for the completed parent task and fix any regressions found.",
            priority: "high",
            queue: true,
            kind: "workflow",
            source: "orchestrator:propose_task",
            metadata: {
              origin: "orchestrator_proposed_task",
              parent_task_id: taskID,
              inheritance: "orchestrator_follow_up",
              proposal_reason: "The first task is complete; this is a separate follow-up verification scope.",
            },
          }),
        )
      },
    })
  })

  test("propose_task does not create a follow-up task when the user declines", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_decline_${stamp}`
    const taskID = `tsk_decline_${stamp}`
    const createSpy = spyOn(EngineService, "createTask").mockResolvedValue("tsk_should_not_create")

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: tmp.path,
          name: "decline task project",
          sandboxes: "[]",
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          session_id: null,
          source: "test",
          title: "Parent task",
          request: "Build the initial feature.",
          kind: "workflow",
          priority: "normal",
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(Config, "get").mockResolvedValue({ experimental: { confirm_proposed_tasks: true } } as any)
        const pipeline = WorkflowRegistry.resolveSync("pipeline")!
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: "ses_orchestrator_decline",
          workflow: pipeline,
          workflowState: createWorkflowState(pipeline),
        })

        const proposal = tools.propose_task.execute(
          {
            title: "Optional cleanup",
            request: "Clean up optional polish items.",
            reason: "This is optional and separate from the current task.",
            priority: "normal",
            kind: "build",
          },
          buildToolOptions(),
        )

        let pending = await Question.list()
        for (let i = 0; pending.length === 0 && i < 20; i++) {
          await Bun.sleep(5)
          pending = await Question.list()
        }
        expect(pending).toHaveLength(1)

        await Question.reply({ requestID: pending[0].id, answers: [["不创建"]] })
        const result = await proposal

        expect(result).toContain("Follow-up task proposal was not created")
        expect(createSpy).not.toHaveBeenCalled()
      },
    })
  })

  test("visual reference inputs do not host-block downstream tool calls", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

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

    let buildCalled = false
    buildAgentRunImpl = async (input: any) => {
      buildCalled = true
      await markBuildSlotAcquired(input)
      return {
        result: {
          status: "passed",
          summary: "Visual URL did not force a design_analysis host gate.",
          files_changed: [],
          tests: [],
        },
        sessionID: "ses_visual_no_host_gate_build",
        worktreeDir: input.managedWorktree.directory,
        worktreeBranch: input.managedWorktree.branch,
        worktreeBaseRef: input.managedWorktree.baseRef,
        diffs: [],
      }
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

        const buildResult = await tools.build.execute(
          {
            goalID,
            reason: "Try to build visual goal",
          },
          buildToolOptions(),
        )
        expect(buildCalled).toBe(true)
        expect(buildResult).toContain("Build agent finished")
        expect(buildResult).toContain("Visual URL did not force a design_analysis host gate")
      },
    })
  }, 30_000)

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
          attachments: [
            {
              sha: "sha-design-reference",
              url: "attachment://design-reference.png",
              mime: "image/png",
              size: 42,
              filename: "design-reference.png",
              intent: "visual_reference",
              source: "user-upload",
            },
          ],
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

        const paths = ProjectRuntimePaths.designAnalysisPaths(tmp.path, taskID)
        const prdPath = paths.prdAbsolute
        const manifestPath = paths.manifestAbsolute
        const prd = await fs.readFile(prdPath, "utf8")
        const manifest = await fs.readFile(manifestPath, "utf8")
        expect(prd).toContain("## Visual Consistency Spec")
        expect(prd).toContain("Match reference layout, typography, colors, and spacing exactly.")
        expect(prd).toContain(paths.manifestRelative)
        expect(manifest).toContain(`Canonical PRD/SPEC file: ${paths.prdRelative}`)
        expect(manifest).toContain("design-reference.png")
        expect(manifest).toContain("mirror/reference.png")
      },
    })
  })

  test("design_analysis exposes materialization failure details", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_design_material_fail_${stamp}`
    const taskID = `tsk_design_material_fail_${stamp}`
    const goalID = `gol_design_material_fail_${stamp}`
    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const workflowState = createWorkflowState(pipeline)
    const missingMaterial = "docs/prd/missing-reference.png"

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "Design material failure project",
      taskTitle: "Design material failure task",
      request: "Create the page from provided local material.",
      goalTitle: "Implement page",
      goalSlug: "implement-page",
      objective: "Implement the page from material evidence",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "design material failure test" })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
          workflow: pipeline,
          workflowState,
        })

        await expect(
          tools.design_analysis.execute(
            { reason: "material should be inspected", materials: [missingMaterial] },
            {} as any,
          ),
        ).rejects.toThrow(missingMaterial)

        const entry = createDecisionLog(taskID).readByKey("abort_materialization_failed")
        expect(entry?.value).toContain(missingMaterial)
        expect(entry?.value).toContain("Materialization errors")
      },
    })
  })

  test("design_analysis materializes Figma references through MCP before analysis", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_figma_mcp_${stamp}`
    const taskID = `tsk_figma_mcp_${stamp}`
    const goalID = `gol_figma_mcp_${stamp}`
    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const workflowState = createWorkflowState(pipeline)
    const figmaUrl = "https://www.figma.com/design/fileKey/Product?node-id=1963-5219&m=dev"

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "Figma MCP project",
      taskTitle: "Figma MCP task",
      request: `复刻 ${figmaUrl}`,
      goalTitle: "Implement Figma window",
      goalSlug: "implement-figma-window",
      objective: "Implement the Figma window",
      now,
    })

    mcpServerToolsImpl = async () => [
      {
        key: "Figma_get_design_context",
        client: "Figma",
        name: "get_design_context",
        description: "",
        inputSchema: {},
      },
      { key: "Figma_get_screenshot", client: "Figma", name: "get_screenshot", description: "", inputSchema: {} },
      { key: "Figma_get_metadata", client: "Figma", name: "get_metadata", description: "", inputSchema: {} },
      { key: "Figma_get_variable_defs", client: "Figma", name: "get_variable_defs", description: "", inputSchema: {} },
    ]
    const calls: Array<{ key: string; args: Record<string, unknown> }> = []
    mcpCallToolImpl = async (input) => {
      calls.push(input)
      if (input.key === "Figma_get_screenshot") {
        return {
          content: [
            {
              type: "image",
              data: Buffer.from("fake png bytes").toString("base64"),
              mimeType: "image/png",
            },
          ],
        }
      }
      return {
        content: [
          {
            type: "text",
            text: `${input.key} evidence for ${input.args.nodeId}`,
          },
        ],
      }
    }

    designAnalyzeImpl = async (input) => {
      const attachments = input.attachments ?? []
      expect(attachments.some((item: any) => item.source === "figma-mcp" && item.mime === "image/png")).toBe(true)
      expect(
        attachments.filter((item: any) => item.source === "figma-mcp" && item.mime === "text/markdown").length,
      ).toBe(3)
      return {
        specs: [],
        designSystem: "Figma MCP design system",
        techStack: ["React"],
        productSpec: "Product spec from Figma MCP evidence",
        frontendSpec: "Frontend spec from Figma MCP evidence",
        visualConsistencySpec: "Match the Figma MCP screenshot and metadata.",
        backendSpec: "Mock API only; unknown backend details remain unknown.",
        prdIterationNotes: ["Checked Figma node inventory.", "Checked implementability from MCP metadata."],
        completenessReview: "Figma MCP evidence is complete enough for handoff.",
        referenceArtifacts: ["figma-mcp screenshot", "figma-mcp metadata"],
        openQuestions: [],
        sessionID: "ses_design_analysis_figma_mcp_mock",
      }
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "figma mcp test" })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
          workflow: pipeline,
          workflowState,
        })

        const result = await tools.design_analysis.execute(
          {
            reason: "Figma MCP visual reference requires PRD/SPEC",
            figma_url: figmaUrl,
          },
          buildToolOptions(),
        )
        expect(result).toContain("SUCCESS")
        expect(calls.map((call) => call.key).sort()).toEqual(
          ["Figma_get_design_context", "Figma_get_metadata", "Figma_get_screenshot", "Figma_get_variable_defs"].sort(),
        )
        expect(calls.every((call) => call.args.nodeId === "1963:5219")).toBe(true)

        const task = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get(),
        )!
        expect((task.attachments as any[]).some((item) => item.source === "figma-mcp")).toBe(true)
        expect((task.system_artifacts as any[]).filter((item) => item.source === "figma-mcp").length).toBe(3)
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
      db.insert(EngineGoalTable)
        .values({
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
        })
        .run()
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

        const result = await tools.build.execute(
          {
            goalID: childGoalID,
            reason: "stale orchestrator view",
          },
          buildToolOptions(),
        )

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
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "Architect requirements preflight test",
          sandboxes: "[]",
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
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
        })
        .run()
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
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "Architect requirement copy test",
          sandboxes: "[]",
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
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
        })
        .run()
      db.insert(EngineSpecSnapshotTable)
        .values({
          id: reqSpecID,
          task_id: taskID,
          version: 1,
          status: "ready",
          summary: "Requirements parsed",
          content: "# Requirements\n- REQ-1 typed app shell",
          scope: "typed app shell",
          time_created: now,
          time_updated: now,
        })
        .run()
      insertRequirements(db, {
        taskID,
        specSnapshotID: reqSpecID,
        now,
        requirements: [
          {
            id: "REQ-1",
            title: "Typed app shell",
            description: "The app shell renders and typechecks.",
            acceptance: ["typecheck passes"],
            evidence_refs: ["user request"],
            non_goals: ["This requirement does not cover unrelated runtime features."],
            priority: "blocking",
          },
        ],
      })
    })

    architectCoordinateImpl = async (input: any) => {
      expect(input.requirements.map((r: any) => r.id)).toEqual(["REQ-1"])
      expect(input.requirements[0].acceptance).toBe("typecheck passes")
      expect(input.requirements[0].non_goals).toBe("This requirement does not cover unrelated runtime features.")
      return {
        summary: "One goal architecture.",
        goals: [
          {
            id: "goal_app_shell",
            title: "App shell",
            objective: "Implement a typed app shell.",
            acceptance_specs: [
              {
                id: "acc-app-shell",
                source_requirement_id: "REQ-1",
                goal_id: "goal_app_shell",
                title: "typecheck passes",
                scorers: [
                  {
                    type: "llm_judge",
                    name: "typecheck evidence",
                    criteria: "The app shell typechecks.",
                  },
                ],
                severity: "essential",
              },
            ],
            owned_paths: ["src/App.tsx"],
            depends_on: [],
            exports: ["AppShell"],
            imports: [],
            kind: "bootstrap",
            requirement_ids: ["REQ-1"],
            priority: "blocking",
          },
        ],
        removedGoalIDs: [],
        traceability: [{ requirementID: "REQ-1", goalIDs: ["goal_app_shell"] }],
        fidelity: { sourceCoverage: [], referenceCoverage: [], assemblyOwners: [] },
        contractGraph: { version: 1, contracts: [], dependency_contracts: [] },
        validationFindings: [],
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

  test("publish gate failures are post-delivery export feedback instead of task lifecycle decisions", async () => {
    const source = await fs.readFile(path.join(import.meta.dir, "../../src/orchestrator/tools.ts"), "utf8")

    expect(source).toContain("publishGateArtifactResult")
    expect(source).toContain("Task lifecycle is unchanged")
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
          return integrityTeamResult({ sessionID: "ses_integrity_auto" })
        }
        buildAgentRunImpl = async (input: any) => {
          await markBuildSlotAcquired(input)
          buildCalls += 1
          buildTarget = input.target
          return {
            result: {
              status: "passed",
              summary: "Goal built successfully",
              files_changed: [
                {
                  path: "src/index.ts",
                  summary: "Changed scoped implementation file.",
                  reason: "Required by the mocked goal build.",
                },
              ],
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

        const result = await tools.build.execute(
          {
            goalID,
            reason: "Per-goal pipeline execution.",
          },
          buildToolOptions(),
        )

        // Wave-level review (B-wave / spec architecture-rework-loosening
        // -plan-2026-05-06.md): build tool no longer triggers architecture
        // review per goal. The build report no longer carries
        // `architecture_review:` text — orchestrator calls `integrity`
        // explicitly at wave boundaries. Verify review is NOT auto-run
        // and the next-step prompt directs the LLM to call integrity.
        expect(result).toContain("status=passed")
        expect(result).not.toContain("architecture_review:")
        expect(result).toContain("Call `integrity` as the final workflow gate")
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
          return integrityTeamResult({ sessionID: "ses_integrity_singleflight" })
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
            .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "integrity_attempt")))
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
          db.insert(EngineGoalTable)
            .values({
              id: siblingGoalID,
              task_id: taskID,
              spec_snapshot_id: `spec_${goalID}`,
              title: "Shared shell",
              slug: "shared-shell",
              objective: "Provide the shared shell consumed by feature goals",
              acceptance_specs: [
                {
                  id: `acc_shell_${stamp}`,
                  source_requirement_id: "REQ-1",
                  goal_id: siblingGoalID,
                  title: "shell exports AppShell",
                  scorers: [
                    {
                      type: "llm_judge",
                      name: "shell contract",
                      criteria: "The shared shell renders and exports AppShell for feature goals.",
                    },
                  ],
                  severity: "essential",
                },
              ],
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
            })
            .run()
          db.update(EngineTaskTable)
            .set({
              metadata: {
                architect_fidelity: {
                  sourceCoverage: [
                    {
                      id: "sibling-source",
                      paths: ["src/App.tsx"],
                      goal_ids: [siblingGoalID],
                      action: "modify",
                      rationale: "The shell source must remain the shared integration surface.",
                    },
                  ],
                  referenceCoverage: [
                    {
                      id: "sibling-reference",
                      surface: "shared shell",
                      goal_ids: [siblingGoalID],
                      visual_spec_ids: [],
                      expectation: "The shell reference remains binding for every feature goal.",
                    },
                  ],
                  assemblyOwners: [
                    {
                      surface: "app",
                      goal_id: siblingGoalID,
                      rationale: "The shell owns final app assembly.",
                    },
                  ],
                },
              },
              time_updated: now,
            })
            .where(eq(EngineTaskTable.id, taskID))
            .run()
        })
        insertArchitectContractGraphArtifact({
          taskID,
          now: now + 1,
          graph: {
            version: 1,
            contracts: [
              {
                id: "contract_shell",
                kind: "component",
                name: "AppShell",
                producer_goal_id: siblingGoalID,
                consumer_goal_ids: [goalID],
                summary: "Shared shell component consumed by feature goals.",
                artifact_paths: ["src/App.tsx"],
              },
            ],
            dependency_contracts: [
              {
                from_goal_id: siblingGoalID,
                to_goal_id: goalID,
                reason: "contract",
                contract_ids: ["contract_shell"],
              },
            ],
          },
        })

        buildAgentRunImpl = async (input: any) => {
          await markBuildSlotAcquired(input)
          capturedContext = input.context
          return {
            result: {
              status: "passed",
              summary: "Goal built with full architecture context",
              files_changed: [
                {
                  path: "src/index.ts",
                  summary: "Changed scoped implementation file.",
                  reason: "Required by the mocked goal build.",
                },
              ],
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

        const result = await tools.build.execute(
          {
            goalID,
            request: "Implement the goal",
            reason: "Per-goal pipeline execution.",
          },
          buildToolOptions(),
        )

        expect(result).toContain("status=passed")
        expect(capturedContext?.contractGraph?.contracts?.map((c: any) => c.producer_goal_id)).toContain(siblingGoalID)
        expect(capturedContext?.contractGraph?.dependency_contracts?.map((c: any) => c.from_goal_id)).toContain(
          siblingGoalID,
        )
        expect(capturedContext?.collaborationGoals?.find((g: any) => g.id === siblingGoalID)?.objective).toContain(
          "shared shell",
        )
        expect(
          capturedContext?.collaborationGoals
            ?.find((g: any) => g.id === siblingGoalID)
            ?.acceptance_specs?.some((spec: string) => spec.includes("shell exports AppShell")),
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

        reviewIntegrityImpl = async () =>
          integrityTeamResult({
            verdict: "needs_correction",
            summary: "Goal graph must change",
            findings: [
              integrityFinding({
                id: "F-split-goal",
                description: "Split the goal",
                targetIDs: [goalID],
                repair: "Split the current goal into smaller repair work.",
              }),
              integrityFinding({
                id: "F-goal-too-broad",
                description: "Current goal is too broad",
                targetIDs: [goalID],
                repair: "Narrow the goal before accepting the task.",
                reviewers: ["delivery_surface"],
              }),
            ],
            requiredRepairs: [
              integrityRepair({
                id: "repair-split-goal",
                description: "Split the current goal into smaller repair work.",
                targetIDs: [goalID],
              }),
            ],
            sessionID: "ses_integrity_corrected",
          })
        buildAgentRunImpl = async (input: any) => {
          await markBuildSlotAcquired(input)
          buildCalls += 1
          return {
            result: {
              status: "passed",
              summary: "Goal built before architecture review feedback.",
              files_changed: [
                {
                  path: "src/index.ts",
                  summary: "Changed scoped implementation file.",
                  reason: "Required by the mocked goal build.",
                },
              ],
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

        const result = await tools.build.execute(
          {
            goalID,
            request: "Implement the goal",
            reason: "Per-goal pipeline execution.",
          },
          buildToolOptions(),
        )

        // Post-fix (B-wave): build tool does NOT trigger architecture review
        // (it was per-goal and noisy). Orchestrator calls `integrity` itself
        // at wave boundaries. Goals stay where they are; no auto-supersede,
        // no auto-rework.
        expect(result).toContain("status=passed")
        expect(result).not.toContain("architecture_review:")
        expect(result).not.toContain("### Architecture review")
        expect(result).not.toContain("architecture_review_rework: opened")
        expect(result).toContain("Call `integrity` as the final workflow gate")
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

        reviewIntegrityImpl = async () =>
          integrityTeamResult({
            verdict: "concerns",
            summary: "Shared shell contract is underspecified",
            findings: [
              integrityFinding({
                id: "F-sibling-handoff",
                severity: "advisory",
                verdictImpact: "concerns",
                description: "Sibling handoff is ambiguous",
                targetIDs: [goalID],
                repair: "Clarify the sibling handoff before final acceptance.",
              }),
            ],
            sessionID: "ses_integrity_concern",
          })
        buildAgentRunImpl = async (input: any) => {
          await markBuildSlotAcquired(input)
          return {
            result: {
              status: "passed",
              summary: "Goal built with an ambiguous handoff.",
              files_changed: [
                {
                  path: "src/index.ts",
                  summary: "Changed scoped implementation file.",
                  reason: "Required by the mocked goal build.",
                },
              ],
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

        const result = await tools.build.execute(
          {
            goalID,
            request: "Implement the goal",
            reason: "Per-goal pipeline execution.",
          },
          buildToolOptions(),
        )

        // Post-fix (B-wave): build tool no longer auto-runs architecture
        // review. Orchestrator drives integrity per wave. No supersede.
        expect(result).not.toContain("architecture_review:")
        expect(result).not.toContain("### Architecture review")
        expect(result).not.toContain("architecture_review_rework: opened")
        expect(result).toContain("Call `integrity` as the final workflow gate")
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
          db
            .insert(EngineGoalTable)
            .values({
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
            })
            .run(),
        )
        Database.use((db) =>
          db
            .update(EngineTaskTable)
            .set({
              metadata: {
                architect_fidelity: {
                  sourceCoverage: [
                    {
                      id: "src-test",
                      paths: ["package.json"],
                      goal_ids: [goalID],
                      action: "modify",
                      rationale: "test fixture source coverage",
                    },
                  ],
                  referenceCoverage: [],
                  assemblyOwners: [
                    {
                      surface: "test-app",
                      goal_id: siblingGoalID,
                      rationale: "test fixture assembly owner",
                    },
                  ],
                },
              },
            })
            .where(eq(EngineTaskTable.id, taskID))
            .run(),
        )

        reviewIntegrityImpl = async () =>
          integrityTeamResult({
            verdict: "concerns",
            summary: "Feature acceptance is underspecified",
            findings: [
              integrityFinding({
                id: "F-feature-acceptance",
                severity: "advisory",
                verdictImpact: "concerns",
                description: "Feature goal acceptance depends on bootstrap details",
                targetIDs: [siblingGoalID],
                repair: "Clarify acceptance across the bootstrap and feature goals.",
                reviewers: ["delivery_surface"],
              }),
            ],
            sessionID: "ses_integrity_sibling",
          })
        buildAgentRunImpl = async (input: any) => {
          await markBuildSlotAcquired(input)
          return {
            result: {
              status: "passed",
              summary: "Bootstrap goal built successfully.",
              files_changed: [
                {
                  path: "package.json",
                  summary: "Updated package scripts.",
                  reason: "Required by the bootstrap goal.",
                },
              ],
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

        const result = await tools.build.execute(
          {
            goalID,
            request: "Implement the bootstrap goal",
            reason: "Per-goal pipeline execution.",
          },
          buildToolOptions(),
        )

        // Post-fix (B-wave): build tool no longer triggers review. The
        // build report carries no architecture_review section; orchestrator
        // calls `integrity` per wave to surface sibling-goal findings via
        // the integrity tool result + decision_log.
        expect(result).not.toContain("architecture_review:")
        expect(result).not.toContain("### Architecture review")
        expect(result).not.toContain(`goal=${goalID} superseded_tip`)
        expect(result).toContain("Call `integrity` as the final workflow gate")
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
          db
            .insert(EngineGoalTable)
            .values({
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
            })
            .run(),
        )
        Database.use((db) =>
          db
            .update(EngineTaskTable)
            .set({
              metadata: {
                architect_fidelity: {
                  sourceCoverage: [
                    {
                      id: "src-foundation",
                      paths: ["src/index.ts"],
                      goal_ids: [goalID],
                      action: "modify",
                      rationale: "test fixture source coverage",
                    },
                  ],
                  referenceCoverage: [],
                  assemblyOwners: [
                    {
                      surface: "test-app",
                      goal_id: childGoalID,
                      rationale: "test fixture assembly owner",
                    },
                  ],
                },
              },
            })
            .where(eq(EngineTaskTable.id, taskID))
            .run(),
        )
        const childRunID = beginBuildAttempt({
          taskID,
          goalID: childGoalID,
          sessionID: "ses_live_dependent",
        })
        expect(goalStatusByID(childGoalID)).toBe("running")

        reviewIntegrityImpl = async () =>
          integrityTeamResult({
            verdict: "needs_correction",
            summary: "Foundation contract changed under dependent work",
            findings: [
              integrityFinding({
                id: "F-foundation-interface",
                description: "Foundation acceptance omitted a shared interface",
                targetIDs: [goalID],
                repair: "Add the shared interface contract to the foundation goal.",
              }),
            ],
            requiredRepairs: [
              integrityRepair({
                id: "repair-foundation-interface",
                description: "Add the shared interface contract to the foundation goal.",
                targetIDs: [goalID],
              }),
            ],
            sessionID: "ses_integrity_cascade",
          })
        buildAgentRunImpl = async (input: any) => {
          await markBuildSlotAcquired(input)
          return {
            result: {
              status: "passed",
              summary: "Foundation goal built successfully.",
              files_changed: [
                {
                  path: "src/index.ts",
                  summary: "Implemented the foundation contract.",
                  reason: "Required by the foundation goal.",
                },
              ],
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

        const result = await tools.build.execute(
          {
            goalID,
            request: "Implement the foundation goal",
            reason: "Per-goal pipeline execution.",
          },
          buildToolOptions(),
        )

        // Post-fix (B-wave): build tool no longer triggers review at all,
        // so neither the just-built goal nor any dependent gets cascaded.
        // Orchestrator calls integrity at wave boundary; dependents stay
        // running until orchestrator decides explicitly.
        expect(result).not.toContain("architecture_review:")
        expect(result).not.toContain("### Architecture review")
        expect(result).not.toContain("architecture_review_dependency_rework")
        expect(result).toContain("Call `integrity` as the final workflow gate")
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
              files_changed: [
                {
                  path: "src/index.ts",
                  summary: "Late stale change.",
                  reason: "Should not finalize after invalidation.",
                },
              ],
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

        const result = await tools.build.execute(
          {
            goalID,
            request: "Implement the single goal",
            reason: "Per-goal pipeline execution.",
          },
          buildToolOptions(),
        )

        expect(result).toContain("build_result_ignored")
        // Post-fix (B-wave): no architecture_review section in build report.
        expect(result).not.toContain("architecture_review:")
        // Next-step still directs orchestrator to call integrity at wave
        // boundary (when applicable).
        expect(result).toContain("Call `integrity` as the final workflow gate")
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

        reviewIntegrityImpl = async () =>
          integrityTeamResult({
            verdict: "needs_correction",
            summary: "Correction has no semantic effect",
            findings: [
              integrityFinding({
                id: "F-dependency-prose-only",
                description: "Dependency prose only",
                targetIDs: [goalID],
                repair: "Route explicit dependency repair instead of applying no-op updates.",
                reviewers: ["delivery_surface"],
              }),
            ],
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

        reviewIntegrityImpl = async () =>
          integrityTeamResult({
            verdict: "needs_correction",
            summary: "Integrity needs_correction",
            findings: [
              integrityFinding({
                id: "F-REQ-9-unsupported",
                description: "REQ-9 is not grounded in the user request.",
                repair: "Reconcile unsupported requirement text with the original request.",
              }),
            ],
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
        expect(result).toContain("Nothing in code supersedes goals")
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
            lineage: activeOnlyLineage(taskID, specID),
            verdict: "needs_correction",
            phase: "post_build",
            perDimension: [
              { id: "requirement_fidelity", verdict: "needs_correction" },
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

        reviewIntegrityImpl = async () =>
          integrityTeamResult({
            verdict: "needs_correction",
            summary: "Integrity needs_correction",
            findings: [
              integrityFinding({
                id: "F-goal-misses-REQ-1",
                description: "Goal still misses REQ-1.",
                targetIDs: [goalID],
                requirementIDs: ["REQ-1"],
                repair: "Update the goal to cover REQ-1.",
              }),
            ],
            requiredRepairs: [
              integrityRepair({
                id: "repair-cover-REQ-1",
                description: "Update the goal to cover REQ-1.",
                targetIDs: [goalID],
              }),
            ],
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

  test("integrity artifact persistence failure marks artifact_missing without completing a pass verdict", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_integrity_artifact_missing_${stamp}`
    const taskID = `tsk_integrity_artifact_missing_${stamp}`
    const goalID = `goal_integrity_artifact_missing_${stamp}`
    const specID = `spec_${goalID}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "integrity artifact missing test" })
        const integritySession = await Session.createNext({
          kind: "integrity",
          parentID: parent.id,
          title: "Integrity Supervisor",
          directory: tmp.path,
        })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Integrity artifact missing test",
          taskTitle: "Integrity artifact missing task",
          request: "Do not complete without persisted integrity artifact",
          goalTitle: "Persist integrity result",
          goalSlug: "persist-integrity-result",
          objective: "Verify artifact persistence is required for pass completion",
          now,
          specID,
        })
        computeRequirementStatusSnapshotImpl = () => [
          {
            id: "REQ-artifact-missing",
            description: "Persist integrity result",
            priority: "blocking",
            claimingGoals: [{ goalID, runStatus: "completed" }],
          },
        ]
        reviewIntegrityImpl = async () =>
          integrityTeamResult({
            verdict: "pass",
            summary: "Integrity passed but artifact persistence will fail",
            sessionID: integritySession.id,
          })
        spyOn(EnginePersist, "recordIntegrityAttempt").mockImplementation(() => {
          throw new Error("insert failed")
        })

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const output = await tools.integrity.execute({}, {} as any)

        expect(output).toContain("artifact_persistence_status")
        expect(SessionStatus.get(integritySession.id)).toMatchObject({
          type: "terminal",
          reason: "artifact_missing",
        })
        expect(findLatestIntegrityArtifactMissingStatus(taskID)?.sessionID).toBe(integritySession.id)
        const task = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
        expect(task?.time_completed).toBeNull()
      },
    })
  })

  test("review decision_log records persistent_roots from shared root history", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_integrity_persistent_roots_${stamp}`
    const taskID = `tsk_integrity_persistent_roots_${stamp}`
    const goalID = `goal_integrity_persistent_roots_${stamp}`
    const specID = `spec_${goalID}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "integrity persistent roots test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Integrity persistent roots test",
          taskTitle: "Integrity persistent roots task",
          request: "Record persistent root summaries in review decision log",
          goalTitle: "Persist root summary",
          goalSlug: "persist-root-summary",
          objective: "Verify repeated review findings are summarized for later context",
          now,
          specID,
        })
        for (const offset of [1, 2]) {
          recordIntegrityAttempt({
            taskID,
            sessionID: `ses_prior_persistent_root_${offset}`,
            lineage: activeOnlyLineage(taskID, specID),
            verdict: "needs_correction",
            phase: "post_build",
            reviewers: [{ reviewerID: "rev_storage", scope: "Storage validation" }],
            findings: [
              integrityFinding({
                id: `BF-prior-${offset}`,
                title: `Settings validation prior ${offset}`,
                description: "getSettings() still accepts invalid localStorage settings.",
                filePaths: ["src/services/storage.ts"],
                reviewers: ["rev_storage"],
              }),
            ],
            now: now + offset,
          })
        }

        reviewIntegrityImpl = async () =>
          integrityTeamResult({
            verdict: "needs_correction",
            summary: "Integrity needs_correction",
            findings: [
              integrityFinding({
                id: "BF-current-settings-validation",
                title: "Storage settings validator still absent",
                description: "getSettings() still fails to validate stored model settings.",
                filePaths: ["src/services/storage.ts"],
                reviewers: ["rev_storage"],
              }),
            ],
            sessionID: "ses_integrity_persistent_root_current",
          })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        await tools.integrity.execute({}, {} as any)

        const reviewRows = createDecisionLog(taskID).readByPhase("review")
        expect(reviewRows.at(-1)?.value).toContain("persistent_roots=[")
        expect(reviewRows.at(-1)?.value).toContain("(3)")
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
            lineage: activeOnlyLineage(taskID, specID),
            verdict: "needs_correction",
            phase: "post_build",
            perDimension: [
              { id: "requirement_fidelity", verdict: "needs_correction" },
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

        reviewIntegrityImpl = async () =>
          integrityTeamResult({
            verdict: "needs_correction",
            summary: "Integrity needs_correction",
            findings: [
              integrityFinding({
                id: "F-goal-still-misses-REQ-1",
                description: "Goal still misses REQ-1.",
                targetIDs: [goalID],
                requirementIDs: ["REQ-1"],
                repair: "Update the goal to cover REQ-1.",
              }),
              integrityFinding({
                id: "F-import-export-inconsistent",
                description: "Import/export contract is still inconsistent.",
                repair: "Repair the import/export contract.",
                reviewers: ["delivery_surface"],
              }),
              integrityFinding({
                id: "F-invented-artifact",
                description: "A goal references an invented artifact.",
                repair: "Remove invented artifact references.",
              }),
              integrityFinding({
                id: "F-granularity-unstable",
                description: "Goal granularity remains unstable.",
                repair: "Stabilize goal granularity before acceptance.",
                reviewers: ["delivery_surface"],
              }),
            ],
            requiredRepairs: [
              integrityRepair({
                id: "repair-cover-REQ-1",
                description: "Update the goal to cover REQ-1.",
                targetIDs: [goalID],
              }),
            ],
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
          db
            .select({ status: EngineSpecSnapshotTable.status })
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
          lineage: activeOnlyLineage(taskID, specID),
          verdict: "needs_correction",
          phase: "post_build",
          perDimension: [
            { id: "requirement_fidelity", verdict: "pass" },
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
              files_changed: [
                {
                  path: "src/index.ts",
                  summary: "Changed implementation after review feedback.",
                  reason: "Prior review feedback is context, not a dispatch gate.",
                },
              ],
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

        const result = await tools.build.execute(
          {
            goalID,
            request: "Implement the goal",
            reason: "Per-goal pipeline execution.",
          },
          buildToolOptions(),
        )

        expect(result).toContain("status=passed")
        expect(buildCalls).toBe(1)
        expect(listGoalRunsByGoal(goalID)).toHaveLength(1)
      },
    })
  })

  test("goal build retry reuses the prior build session by default", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_retry_default_${stamp}`
    const taskID = `tsk_retry_default_${stamp}`
    const goalID = `goal_retry_default_${stamp}`
    const priorSessionID = `ses_prior_retry_default_${stamp}`
    let observedExistingSessionID: unknown

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "default retry session reuse test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Default retry session reuse test",
          taskTitle: "Default retry session reuse task",
          request: "Retry a failed goal in the same build session by default",
          goalTitle: "Reuse prior build session",
          goalSlug: "reuse-prior-build-session",
          objective: "Verify build retries keep the prior session unless freshContext is requested",
          now,
        })
        seedTerminalFailedBuildRun({
          taskID,
          goalID,
          sessionID: priorSessionID,
          workspaceDir: tmp.path,
          now: now + 10,
        })

        const createNextSpy = spyOn(Session, "createNext")
        buildAgentRunImpl = async (input: any) => {
          observedExistingSessionID = input.existingSessionID
          await markBuildSlotAcquired(input, priorSessionID)
          return {
            result: {
              status: "failed",
              summary: "Retry stayed in the prior build session.",
              files_changed: [],
              tests: [],
              error: "same-session retry failed again",
            },
            sessionID: priorSessionID,
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

        const result = await tools.build.execute(
          {
            goalID,
            request: "Retry the failed goal with the same context.",
            reason: "Per-goal retry without freshContext should reuse the session.",
          },
          buildToolOptions(),
        )

        expect(result).toContain("status=failed")
        expect(observedExistingSessionID).toBe(priorSessionID)
        expect(createNextSpy).not.toHaveBeenCalled()
      },
    })
  })

  test("goal build freshContext starts a distinct build session", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_retry_fresh_${stamp}`
    const taskID = `tsk_retry_fresh_${stamp}`
    const goalID = `goal_retry_fresh_${stamp}`
    const priorSessionID = `ses_prior_retry_fresh_${stamp}`
    let freshSessionID: string | undefined

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "fresh retry session test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Fresh retry session test",
          taskTitle: "Fresh retry session task",
          request: "Retry a context-wedged failed goal in a new build session",
          goalTitle: "Fresh build session",
          goalSlug: "fresh-build-session",
          objective: "Verify freshContext skips prior session reuse",
          now,
        })
        seedTerminalFailedBuildRun({
          taskID,
          goalID,
          sessionID: priorSessionID,
          workspaceDir: tmp.path,
          now: now + 10,
        })

        const createNextSpy = spyOn(Session, "createNext")
        buildAgentRunImpl = async (input: any) => {
          expect(input.existingSessionID).toBeUndefined()
          const buildSession = await Session.createNext({
            kind: "build",
            parentID: input.parentSessionID,
            goalID,
            title: "Fresh context retry build",
            directory: input.managedWorktree.directory,
          })
          freshSessionID = buildSession.id
          await input.onSessionCreated?.(buildSession.id, {
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
          })
          return {
            result: {
              status: "failed",
              summary: "Retry ran in a fresh build session.",
              files_changed: [],
              tests: [],
              error: "fresh-session retry still failed",
            },
            sessionID: buildSession.id,
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

        const result = await tools.build.execute(
          {
            goalID,
            request: "Context is wedged; retry from a fresh build session and preserve lessons here.",
            reason: "Prior same-context attempts hit context overflow.",
            freshContext: true,
          },
          buildToolOptions(),
        )

        expect(result).toContain("status=failed")
        expect(typeof freshSessionID).toBe("string")
        expect(freshSessionID).not.toBe(priorSessionID)
        expect(createNextSpy).toHaveBeenCalledTimes(1)
        expect(listGoalRunsByGoal(goalID)[0]?.session_id).toBe(freshSessionID)
      },
    })
  })

  test("goal build freshContext clears the prior worktree ownership marker before dispatch", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_retry_fresh_marker_${stamp}`
    const taskID = `tsk_retry_fresh_marker_${stamp}`
    const goalID = `goal_retry_fresh_marker_${stamp}`
    const priorSessionID = `ses_prior_retry_marker_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "fresh retry marker cleanup test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Fresh retry marker cleanup test",
          taskTitle: "Fresh retry marker cleanup task",
          request: "Clear the abandoned ownership marker before a fresh-context retry",
          goalTitle: "Fresh marker cleanup",
          goalSlug: "fresh-marker-cleanup",
          objective: "Verify abandoned prior session ownership is cleared before dispatch",
          now,
        })
        seedTerminalFailedBuildRun({
          taskID,
          goalID,
          sessionID: priorSessionID,
          workspaceDir: tmp.path,
          now: now + 10,
        })
        await Ownership.Worktree.record({
          primaryWorktreeDir: Instance.worktree,
          worktreeDir: tmp.path,
          taskID,
          sessionID: priorSessionID,
          goalID,
        })
        expect(
          (await Ownership.Worktree.list(Instance.worktree)).some(({ marker }) => marker.sessionID === priorSessionID),
        ).toBe(true)

        const clearSpy = spyOn(Ownership.Worktree, "clear")
        buildAgentRunImpl = async (input: any) => {
          expect(input.existingSessionID).toBeUndefined()
          const markers = await Ownership.Worktree.list(Instance.worktree)
          expect(markers.some(({ marker }) => marker.sessionID === priorSessionID)).toBe(false)
          await markBuildSlotAcquired(input, `ses_fresh_marker_${stamp}`)
          return {
            result: {
              status: "failed",
              summary: "Fresh retry observed cleared prior ownership.",
              files_changed: [],
              tests: [],
              error: "fresh retry failed after marker cleanup",
            },
            sessionID: `ses_fresh_marker_${stamp}`,
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

        const result = await tools.build.execute(
          {
            goalID,
            request: "Prior context is wedged; retry fresh and restate every lesson here.",
            reason: "Fresh-context retry after context overflow.",
            freshContext: true,
          },
          buildToolOptions(),
        )

        expect(result).toContain("status=failed")
        expect(clearSpy).toHaveBeenCalledTimes(1)
        expect(clearSpy).toHaveBeenCalledWith({
          primaryWorktreeDir: Instance.worktree,
          worktreeDir: tmp.path,
        })
      },
    })
  })

  test("task-level build ignores freshContext and still opens a normal direct build", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_task_fresh_noop_${stamp}`
    const taskID = `tsk_task_fresh_noop_${stamp}`
    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const workflowState = createWorkflowState(pipeline)
    let observedExistingSessionID: unknown = "unset"
    let observedTarget: any

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: tmp.path,
          name: "Task freshContext no-op project",
          sandboxes: "[]",
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineTaskTable)
        .values({
          id: taskID,
          project_id: projectID,
          source: "test",
          title: "Task freshContext no-op task",
          request: "Run a task-level direct build while freshContext is set",
          kind: "workflow",
          priority: "normal",
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })

    buildAgentRunImpl = async (input: any) => {
      observedExistingSessionID = input.existingSessionID
      observedTarget = input.target
      return {
        result: {
          status: "passed",
          summary: "Task-level direct build ignored freshContext.",
          files_changed: [],
          tests: [],
        },
        sessionID: `ses_task_fresh_noop_${stamp}`,
        worktreeDir: tmp.path,
        diffs: [],
      }
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "task freshContext no-op test" })

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
          workflow: pipeline,
          workflowState,
        })

        const result = await tools.build.execute(
          {
            request: "Apply the scoped direct fix.",
            reason: "Task-level direct build; freshContext has no goal to affect.",
            directBuildIntent: "modify_files",
            freshContext: true,
          },
          buildToolOptions(),
        )

        expect(result).toContain("status=passed")
        expect(observedTarget).toEqual({ kind: "request", text: "Apply the scoped direct fix." })
        expect(observedExistingSessionID).toBeUndefined()
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
          await markBuildSlotAcquired(input, "ses_build_session_bind")
          expect(goalStatusByID(goalID)).toBe("running")
          observedSessionID = listGoalRunsByGoal(goalID)[0]?.session_id
          return {
            result: {
              status: "passed",
              summary: "Build completed after early session binding.",
              files_changed: [
                {
                  path: "src/index.ts",
                  summary: "Confirmed session binding contract.",
                  reason: "The build milestone must be traceable while it is running.",
                },
              ],
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

        const result = await tools.build.execute(
          {
            goalID,
            request: "Implement the goal",
            reason: "Per-goal pipeline execution.",
          },
          buildToolOptions(),
        )

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
          lineage: activeOnlyLineage(taskID, specID),
          verdict: "concerns",
          phase: "post_build",
          perDimension: [
            { id: "requirement_fidelity", verdict: "concerns" },
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
              files_changed: [
                {
                  path: "src/index.ts",
                  summary: "Changed implementation after correction feedback.",
                  reason: "Review history is context, not a dispatch gate.",
                },
              ],
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

        const result = await tools.build.execute(
          {
            goalID,
            request: "Implement the goal",
            reason: "Per-goal pipeline execution.",
          },
          buildToolOptions(),
        )

        expect(result).toContain("status=passed")
        expect(buildCalls).toBe(1)
        expect(listGoalRunsByGoal(goalID)).toHaveLength(1)
      },
    })
  })

  test("persistent integrity roots are context, not a host-side build gate", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_goal_integrity_persistent_context_${stamp}`
    const taskID = `tsk_goal_integrity_persistent_context_${stamp}`
    const goalID = `goal_integrity_persistent_context_${stamp}`
    const specID = `spec_${goalID}`
    let buildCalls = 0

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "persistent integrity context test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Persistent integrity context test",
          taskTitle: "Persistent integrity context task",
          request: "Let the LLM-selected lane execute through normal tools",
          goalTitle: "Build after persistent integrity context",
          goalSlug: "build-after-persistent-integrity-context",
          objective: "Verify persistent roots are prompt context, not host dispatch gates",
          now,
          specID,
        })
        for (const offset of [1, 2, 3]) {
          recordIntegrityAttempt({
            taskID,
            sessionID: `ses_persistent_context_${offset}`,
            lineage: activeOnlyLineage(taskID, specID),
            verdict: "needs_correction",
            phase: "post_build",
            reviewers: [{ reviewerID: "rev_storage", scope: "Storage validation" }],
            findings: [
              integrityFinding({
                id: `BF-context-${offset}`,
                title: `Settings validation round ${offset}`,
                description: "getSettings() still accepts invalid settings.",
                filePaths: ["src/services/storage.ts"],
                reviewers: ["rev_storage"],
              }),
            ],
            now: now + offset,
          })
        }
        buildAgentRunImpl = async (input: any) => {
          await markBuildSlotAcquired(input)
          buildCalls += 1
          return {
            result: {
              status: "passed",
              summary: "Build executed because the selected lane was not host-gated by root history.",
              files_changed: [
                {
                  path: "src/services/storage.ts",
                  summary: "Handled selected build lane.",
                  reason: "Persistent roots are model-visible context only.",
                },
              ],
              tests: [],
              commit_ref: "abc1234",
            },
            sessionID: "ses_goal_after_persistent_context",
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
        const context = await tools.read_context.execute({ scope: "integrity_history" }, {} as any)
        expect(context).toContain("Persistent blocking roots")

        const result = await tools.build.execute(
          {
            goalID,
            request: "The stub LLM selected build through the normal tool path.",
            reason: "Active-path no-host-gate regression.",
          },
          buildToolOptions(),
        )

        expect(result).toContain("status=passed")
        expect(buildCalls).toBe(1)
      },
    })
  })

  test("deliver is disabled and does not run integrity or delivery verification", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_deliver_integrity_prereq_${stamp}`
    const taskID = `tsk_deliver_integrity_prereq_${stamp}`
    const goalID = `goal_deliver_integrity_prereq_${stamp}`
    const specID = `spec_${goalID}`
    const order: string[] = []

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "deliver direct verification test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Deliver direct verification project",
          taskTitle: "Deliver direct verification task",
          request: "Deliver must verify directly without an internal integrity pass",
          goalTitle: "Deliverable goal",
          goalSlug: "deliverable-goal",
          objective: "Create a non-trivial blocking goal requiring integrity evidence",
          now,
          specID,
        })
        reviewIntegrityImpl = async () => {
          throw new Error("deliver must not call integrity internally")
        }
        deliveryServiceVerifyImpl = async () => {
          order.push("verify")
          throw new Error("deliver must not call DeliveryService.verify")
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.deliver.execute({ reason: "All goals are ready for final delivery" }, {} as any)

        expect(result).toContain("deliver: disabled")
        expect(result).toContain("integrity")
        expect(order).toEqual([])
        const artifact = findLatestIntegrityAttemptArtifact({ taskID, specSnapshotID: specID })
        expect(artifact).toBeUndefined()
        const throwArtifact = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(
              and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "delivery_verification_threw")),
            )
            .get(),
        )
        expect(throwArtifact).toBeUndefined()
        const verdictArtifact = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(
              and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.label, "delivery-agent-verdict")),
            )
            .get(),
        )
        expect(verdictArtifact).toBeUndefined()
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
              files_changed: [
                {
                  path: "src/index.ts",
                  summary: "Changed scoped implementation file.",
                  reason: "Required by the mocked goal build.",
                },
              ],
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

        const result = await tools.build.execute(
          {
            goalID,
            request: "Implement the goal",
            reason: "Per-goal pipeline execution.",
          },
          buildToolOptions(),
        )

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

        const result = await tools.build.execute(
          {
            goalID,
            request: "Implement the goal",
            reason: "Per-goal pipeline execution.",
          },
          buildToolOptions(),
        )

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
              files_changed: [
                {
                  path: "src/index.ts",
                  summary: "Changed scoped implementation file.",
                  reason: "Required by the mocked goal build.",
                },
              ],
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

        const result = await tools.build.execute(
          {
            goalID,
            request: "Implement the goal",
            reason: "Per-goal pipeline execution.",
          },
          buildToolOptions(),
        )

        expect(result).toContain("status=passed")
        expect(result).toContain("goal worktree cleanup failed")
        expect(await Filesystem.exists(tmp.path)).toBe(true)
        expect(findGoalLatestWorkspace(goalID).directory).toBe(tmp.path)
        expect(listGoalRunsByGoal(goalID)[0]?.workspace_dir).toBe(tmp.path)
      },
    })
  })

  test("goal build retry forwards previous rendered screenshot through attachment store URL", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_retry_render_${stamp}`
    const taskID = `tsk_retry_render_${stamp}`
    const goalID = `goal_retry_render_${stamp}`
    let capturedContext: any

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "retry rendered attachment test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Retry rendered attachment test",
          taskTitle: "Retry rendered attachment task",
          request: "Build a visual UI and retry from delivery feedback",
          goalTitle: "Visual goal",
          goalSlug: "visual-goal",
          objective: "Verify retry screenshots keep canonical attachment URLs",
          now,
        })

        const rendered = await AttachmentStore.write(
          projectID,
          Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          "image/png",
          "rendered.png",
        )
        Database.use((db) => {
          db.update(EngineTaskTable)
            .set({
              system_artifacts: [
                {
                  ...rendered,
                  filename: rendered.filename,
                  intent: "rendered_output",
                  source: "runtime_capture",
                },
              ],
              time_updated: now,
            })
            .where(eq(EngineTaskTable.id, taskID))
            .run()
        })
        createDecisionLog(taskID).append({
          phase: "retry",
          goalID,
          key: "delivery_rejection",
          value: "Previous rendered page missed the reference layout.",
          reason: "Delivery rejected visual fidelity.",
        })
        for (const key of [
          "product_spec",
          "frontend_spec",
          "visual_consistency_spec",
          "backend_spec",
          "prd_iteration_notes",
          "completeness_review",
          "evidence_source_manifest",
        ]) {
          createDecisionLog(taskID).append({
            phase: "design_analysis",
            key,
            value: `${key} complete for retry attachment regression.`,
            reason: "Visual build gate requires complete design-analysis PRD/SPEC first.",
          })
        }

        buildAgentRunImpl = async (input: any) => {
          await markBuildSlotAcquired(input)
          capturedContext = input.context
          return {
            result: {
              status: "passed",
              summary: "Goal built after retry screenshot",
              files_changed: [
                {
                  path: "src/index.ts",
                  summary: "Updated visual implementation.",
                  reason: "Required by the mocked retry build.",
                },
              ],
              tests: [],
              commit_ref: "abc1234",
            },
            sessionID: "ses_goal_retry_render",
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

        const result = await tools.build.execute(
          {
            goalID,
            request: "Apply delivery visual feedback",
            reason: "Retry after delivery rejection.",
          },
          buildToolOptions(),
        )

        expect(result).toContain("status=passed")
        expect(capturedContext?.retryAttachments).toHaveLength(1)
        const retryAttachment = capturedContext.retryAttachments[0]
        expect(retryAttachment.url).toBe(rendered.url)
        expect(retryAttachment.url).toStartWith(`/attachment/${projectID}/`)
        await expect(AttachmentStore.inlineFileParts([retryAttachment])).resolves.toHaveLength(1)
      },
    })
  })

  // Single-active-plan invariant: restart_from_stage("plan") must leave at
  // most one engine_plan_version row with status='active' for any given task.
  // The board.ts read path (findActivePlanForTask → ORDER BY version DESC
  // LIMIT 1) silently picks an arbitrary row when several share the same
  // version, so a violation surfaces as goals + goal_run cards disappearing
  // from the overlay even though the data is intact in the DB. The
  // `restart_from_stage(plan)` test in this block covers that invariant;
  // earlier post-delivery hardening regressions were removed alongside the
  // retired delivery agent.

  test("restart_from_stage(plan) supersedes every active plan, not just one", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_restart_plan_${stamp}`
    const taskID = `tsk_restart_plan_${stamp}`
    const goalID = `gol_restart_plan_${stamp}`
    const olderPlanID = `pln_restart_older_${stamp}`
    const newerPlanID = `pln_restart_newer_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
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
      db.insert(EnginePlanVersionTable)
        .values({
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
        })
        .run()
      db.insert(EnginePlanVersionTable)
        .values({
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
        })
        .run()
      db.insert(EnginePlanNodeTable)
        .values({
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
        })
        .run()
      db.insert(EnginePlanNodeTable)
        .values({
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
        })
        .run()
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

        const result = await tools.restart_from_stage.execute({ stage: "plan", reason: "regression test" }, {} as any)
        expect(typeof result).toBe("string")

        const plans = Database.use((db) =>
          db.select().from(EnginePlanVersionTable).where(eq(EnginePlanVersionTable.task_id, taskID)).all(),
        )
        const active = plans.filter((p) => p.status === "active")
        const supersededIDs = plans
          .filter((p) => p.status === "superseded")
          .map((p) => p.id)
          .sort()
        expect(active).toHaveLength(0)
        expect(supersededIDs).toEqual([olderPlanID, newerPlanID].sort())

        // Both retired plans' plan_node rows must be gone — restart_from_stage
        // routes through the same supersede helper.
        const remaining = Database.use((db) =>
          db.select().from(EnginePlanNodeTable).where(eq(EnginePlanNodeTable.task_id, taskID)).all(),
        )
        expect(remaining).toHaveLength(0)
      },
    })
  })
})
