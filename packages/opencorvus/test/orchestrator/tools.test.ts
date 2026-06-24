import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { createHash } from "node:crypto"
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
import { Identifier } from "../../src/id/id"
import { createWorkflowState, WorkflowRegistry } from "../../src/engine/workflow"
import { createOrchestratorTools, READ_CONTEXT_OUTPUT_CHAR_BUDGET } from "../../src/orchestrator/tools"
import * as TaskLoop from "../../src/orchestrator/loop"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { SessionPrompt } from "../../src/session/prompt"
import { goalStatusByID } from "../../src/engine/describe"
import { Session } from "../../src/session"
import { SessionTable } from "../../src/session/session.sql"
import {
  beginBuildAttempt,
  insertRequirements,
  persistTaskFrontendResearchBrief,
  persistTaskResearchBrief,
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
  findAcceptanceByRun,
  findActiveSpecForTask,
  findEvaluationByRun,
  findGoal,
  findGoalRun,
  findGoalLatestWorkspace,
  findTask,
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
import {
  buildIntegrityRootHistory,
  persistentRootSummary,
  renderIntegrityRootHistoryBlock,
} from "../../src/integrity/root-history"
import { Config } from "../../src/config/config"
import { ProtocolEventTable } from "../../src/protocol/protocol.sql"
import { Provider } from "../../src/provider/provider"
import { createRun } from "../../src/engine/writer"
import { updateRun } from "../../src/engine/state"
import { ExecutorRegistry } from "../../src/executor/registry"
import type { ExecutorAdapter } from "../../src/executor/contract"
import { AgentRunError } from "../../src/agent/runner"
import { Message } from "../../src/session/message"
import {
  claimStageContinuationRequest,
  createStageContinuationRequest,
  findStageContinuationRequest,
  markStageContinuationClaimFailed,
  markStageContinuationConsumed,
} from "../../src/engine/stage-continuation"
import { createAgentCoordinationRequest, findAgentCoordinationRequest } from "../../src/engine/agent-coordination"
import { researchRequestHash, researchSourceDigest } from "../../src/research/schema"
import { recordFactCheckAttempt } from "../../src/fact-check/persist"

let buildAgentRunImpl: ((input: any) => Promise<any>) | undefined
let reviewIntegrityImpl: ((input: any) => Promise<any>) | undefined
let computeRequirementStatusSnapshotImpl: ((input: any) => any[]) | undefined
let requirementsRunImpl: ((input: any) => Promise<any>) | undefined
let architectCoordinateImpl: ((input: any) => Promise<any>) | undefined
let designAnalyzeImpl: ((input: any) => Promise<any>) | undefined
let frontendResearchRunImpl: ((input: any) => Promise<any>) | undefined
let deepResearchRunImpl: ((input: any) => Promise<any>) | undefined
let goalWorkloadAnalyzeImpl: ((input: any) => Promise<any>) | undefined
let visualQaAnalyzeImpl: ((input: any) => Promise<any>) | undefined
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

function toolText(result: unknown): string {
  if (typeof result === "string") return result
  if (
    result &&
    typeof result === "object" &&
    (result as { type?: unknown }).type === "final" &&
    typeof (result as { output?: unknown }).output === "string"
  ) {
    return (result as { output: string }).output
  }
  if (
    result &&
    typeof result === "object" &&
    typeof (result as { output?: unknown }).output === "string" &&
    typeof (result as { title?: unknown }).title === "string" &&
    typeof (result as { metadata?: unknown }).metadata === "object"
  ) {
    return (result as { output: string }).output
  }
  throw new Error(`Expected string tool result or known wrapped string output, got ${JSON.stringify(result)}`)
}

function minimalFrontendResearchBrief(input: {
  taskID: string
  sessionID: string
  sourceURL: string
  request?: string
}) {
  const evidence = [
    {
      id: "ev_page_reference",
      kind: "web" as const,
      pointer: "web-clone-source/reference.png",
      title: "Rendered webpage reference",
      retrieved_at: "2026-06-21T00:00:00.000Z",
      reliability: "primary" as const,
      excerpt: "Rendered webpage reference evidence for frontend investigation.",
      volatile: false,
    },
  ]
  const paths = ProjectRuntimePaths.frontendResearchPaths(process.cwd(), input.taskID, input.sessionID)
  return {
    metadata: {
      research_session_id: input.sessionID,
      created_for_message_id: "msg_frontend_research_recovered",
      request_hash: researchRequestHash(input.request ?? "frontend-research-request"),
      source_digest: researchSourceDigest(evidence),
      created_at: "2026-06-21T00:00:00.000Z",
    },
    scope: {
      user_goal: "Investigate the webpage before implementation.",
      deliverable_type: "implementation_input" as const,
      audience: "downstream frontend agents",
      explicit_non_goals: [],
      assumed_non_goals: [],
    },
    bundle: {
      full_markdown_path: `${paths.relativeDir}/research-bundle.md`,
      evidence_json_path: `${paths.relativeDir}/evidence.json`,
      citation_map_path: `${paths.relativeDir}/citation-map.json`,
    },
    summary: "Recovered frontend research brief.",
    evidence_index: evidence,
    facts: [
      {
        id: "fact_reference_exists",
        statement: "A rendered webpage reference exists for investigation.",
        evidence_ids: ["ev_page_reference"],
      },
    ],
    inferences: [
      {
        id: "inf_downstream_needs_reference",
        inference: "Downstream agents must use the rendered reference as visual evidence.",
        based_on_fact_ids: ["fact_reference_exists"],
        confidence: "high" as const,
      },
    ],
    problem_statements: [
      {
        id: "problem_visual_parity",
        statement: "Implementation must preserve the captured visual layout.",
        fact_ids: ["fact_reference_exists"],
      },
    ],
    user_needs: [
      {
        id: "need_source_backed_packets",
        need: "Downstream agents need source-backed investigation packets.",
        fact_ids: ["fact_reference_exists"],
      },
    ],
    constraints: [
      {
        id: "constraint_reference_backed",
        constraint: "Do not replace reference-backed observations with unsupported guesses.",
        fact_ids: ["fact_reference_exists"],
      },
    ],
    document_outline: [
      {
        id: "section_visual_contract",
        title: "Visual contract",
        purpose: "Summarize visual evidence for downstream work.",
        evidence_ids: ["ev_page_reference"],
      },
    ],
    webpage_contract: {
      source_url: input.sourceURL,
      reference_image_evidence_ids: ["ev_page_reference"],
      functional_surfaces: [
        {
          id: "surface_page",
          evidence_ids: ["ev_page_reference"],
          title: "Page surface",
          user_visible_behavior: "The page renders a visible webpage surface.",
          component_kind_hypothesis: "static page surface",
          required_interactions: [],
        },
      ],
      visual_layout: [
        {
          id: "layout_page",
          evidence_ids: ["ev_page_reference"],
          viewport: "desktop" as const,
          region: "page",
          layout_contract: "Preserve the rendered page layout.",
          spacing_and_alignment: "Spacing and alignment come from rendered evidence.",
        },
      ],
      style_requirements: [
        {
          id: "style_page",
          evidence_ids: ["ev_page_reference"],
          token_or_selector: "page",
          requirement: "Use rendered evidence for visible styling.",
        },
      ],
      interaction_states: [],
      data_content_inventory: [
        {
          id: "data_page",
          evidence_ids: ["ev_page_reference"],
          surface: "page",
          content_contract: "Use visible captured content as evidence.",
        },
      ],
      fidelity_acceptance: [
        {
          id: "accept_page",
          evidence_ids: ["ev_page_reference"],
          target: "page",
          criterion: "Compare implementation against rendered reference evidence.",
        },
      ],
      fidelity_risks: [],
    },
    subpage_research_tasks: [],
    open_questions: [],
  }
}

function minimalFrontendDesignAnalysis() {
  return {
    specs: [],
    designSystem: "Reference design system",
    techStack: ["React"],
    frontendTemplate: "Frontend design continuation recovered from the existing child session.",
    finalAcceptanceMode: "maintainable_replacement_required",
    fillableModules: "Recovered fillable modules from visual reference evidence.",
    componentInventory: "Recovered component inventory.",
    qualityProjectContract: "Recovered quality contract for downstream implementation.",
    componentReusePlan: [
      {
        family_id: "comp-recovered-shell",
        name: "Recovered shell",
        observed_surface: "Reference shell",
        source_refs: ["attachment://original-reference.png"],
        implementation_strategy: "existing_project_component",
        reuse_source: "src/components/Shell.tsx",
        mature_library_candidates: [],
        props_states: "default",
        replacement_boundary: "page shell",
        parity_guard: "compare against visual reference",
      },
    ],
    materialInventory: "Recovered material inventory.",
    frontendProject: {
      status: "not_created",
      role: "source_baseline_input",
      project_root: "",
      source_package: "",
      entrypoints: [],
      generation_tool: "",
      notes: [],
    },
    visualConsistencyContract: "Match the visual reference.",
    uiDataContract: "Use captured visible data only.",
    templateIterationNotes: ["Recovered existing review pass."],
    completenessReview: "Recovered frontend design handoff.",
    referenceArtifacts: ["attachment://original-reference.png"],
    openQuestions: [],
    report: {
      summary: "Recovered frontend design handoff.",
      detail: "Recovered frontend design handoff.",
      commands: [],
      changed_files: [],
      open_questions: [],
      fact_check_items: [],
    },
  }
}

function minimalArchitectResult(goalID = "goal_recovered_app_shell") {
  return {
    summary: "Recovered architecture.",
    goals: [
      {
        id: goalID,
        title: "Recovered app shell",
        objective: "Implement a typed app shell after continuing the prior architect session.",
        acceptance_specs: [
          {
            id: `acc-${goalID}`,
            source_requirement_id: "REQ-1",
            goal_id: goalID,
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
    traceability: [{ requirementID: "REQ-1", goalIDs: [goalID] }],
    fidelity: { sourceCoverage: [], referenceCoverage: [], assemblyOwners: [] },
    contractGraph: { version: 1, contracts: [], dependency_contracts: [] },
    validationFindings: [],
  }
}

function minimalDeepResearchBrief(input: { taskID: string; sessionID: string }) {
  const evidence = [
    {
      id: "ev_deep_source",
      kind: "web" as const,
      pointer: "https://example.com/source",
      title: "Deep research source",
      retrieved_at: "2026-06-21T00:00:00.000Z",
      reliability: "primary" as const,
      excerpt: "Deep research evidence for the target task.",
      volatile: false,
    },
  ]
  const paths = ProjectRuntimePaths.deepResearchPaths(process.cwd(), input.taskID, input.sessionID)
  return {
    metadata: {
      research_session_id: input.sessionID,
      created_for_message_id: "msg_deep_research_recovered",
      request_hash: "deep-research-request-hash",
      source_digest: researchSourceDigest(evidence),
      created_at: "2026-06-21T00:00:00.000Z",
    },
    scope: {
      user_goal: "Collect source-backed research for implementation planning.",
      deliverable_type: "research_report" as const,
      audience: "orchestrator and downstream agents",
      explicit_non_goals: [],
      assumed_non_goals: [],
    },
    bundle: {
      full_markdown_path: `${paths.relativeDir}/research-bundle.md`,
      evidence_json_path: `${paths.relativeDir}/evidence.json`,
      citation_map_path: `${paths.relativeDir}/citation-map.json`,
    },
    summary: "Recovered deep research brief.",
    evidence_index: evidence,
    facts: [
      {
        id: "fact_deep_source_exists",
        statement: "A source-backed research item exists.",
        evidence_ids: ["ev_deep_source"],
      },
    ],
    inferences: [
      {
        id: "inf_deep_source_is_useful",
        inference: "The source-backed item can inform implementation planning.",
        based_on_fact_ids: ["fact_deep_source_exists"],
        confidence: "high" as const,
      },
    ],
    problem_statements: [
      {
        id: "problem_need_source_backing",
        statement: "Planning must use source-backed evidence.",
        fact_ids: ["fact_deep_source_exists"],
      },
    ],
    user_needs: [
      {
        id: "need_research_report",
        need: "Downstream agents need a durable research report.",
        fact_ids: ["fact_deep_source_exists"],
      },
    ],
    constraints: [
      {
        id: "constraint_source_backed",
        constraint: "Do not replace source-backed facts with guesses.",
        fact_ids: ["fact_deep_source_exists"],
      },
    ],
    document_outline: [
      {
        id: "section_sources",
        title: "Sources",
        purpose: "Summarize source-backed implementation context.",
        evidence_ids: ["ev_deep_source"],
      },
    ],
    subpage_research_tasks: [],
    open_questions: [],
  }
}

function minimalWorkloadBrief(goalID: string) {
  return {
    goal_id: goalID,
    why_not_smaller: ["This goal crosses visible UI and verification surfaces."],
    underestimation_traps: ["Do not report success without running the acceptance check."],
    execution_inventory: {
      surfaces: 1,
      states: 1,
      data_contracts: 1,
      verification_points: 1,
    },
    verification_inventory: ["Run the targeted acceptance command."],
    references: {
      contract_ids: [],
      reference_coverage_ids: [],
      acceptance_spec_ids: ["acc-workload"],
      visual_spec_ids: [],
      prd_sections: ["Implementation"],
    },
  }
}

function minimalVisualQaReport() {
  return {
    accepted: true,
    summary: "Recovered visual QA report.",
    coverage: [
      {
        region: "main surface",
        viewports: [{ width: 1280, height: 720 }],
        states: ["default"],
        source_refs: ["build evidence"],
        evidence_refs: ["visual-qa-evidence"],
        notes: "Main surface was checked.",
      },
    ],
    findings: [],
    production_blockers: [],
    follow_up_task: null,
    repairs: [],
    evidence: [
      {
        type: "command" as const,
        ref: "bun test visual-qa",
        state: "default",
        note: "Visual QA recovery test evidence.",
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
  }
}

function successfulAbortAdapter(): ExecutorAdapter {
  return {
    capabilities: () => ({
      submit: true,
      status: true,
      abort: true,
      acceptance: false,
      resume: false,
      events: false,
    }),
    submit: async () => {
      throw new Error("not used")
    },
    status: async () => {
      throw new Error("not used")
    },
    abort: async () => true,
    acceptance: async () => {
      throw new Error("not used")
    },
    resume: async () => {
      throw new Error("not used")
    },
    events: () => {
      throw new Error("not used")
    },
  } as unknown as ExecutorAdapter
}

async function createAbortableCoordinatorRun(input: { taskID: string; sessionID: string; now: number }) {
  ExecutorRegistry.register("opencorvus", successfulAbortAdapter())
  const run = createRun({
    taskID: input.taskID,
    sessionID: input.sessionID,
    executor: "opencorvus",
    status: "running",
    phase: "execute",
    now: input.now,
  })
  await updateRun(
    run,
    {
      executor_ref: {
        session_id: input.sessionID,
        queue_task_id: `queue_${run.id}`,
      },
    },
    "bind test abort handle",
  )
  return run.id
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function waitForCondition(label: string, condition: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 400; i++) {
    if (await condition()) return
    await Bun.sleep(25)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

function expectGoalBuildStarted(result: unknown): string {
  const text = toolText(result)
  expect(text).toContain("Build agent started (status=running")
  return text
}

async function waitForGoalStatus(goalID: string, status: "passed" | "failed" | "running") {
  await waitForCondition(`goal ${goalID} status ${status}`, () => goalStatusByID(goalID) === status)
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
  const acceptanceVerdict = verdict === "pass" ? "pass" : "concerns"
  return {
    verdict,
    summary,
    teamReportMarkdown:
      input.teamReportMarkdown ??
      [
        summary,
        ...findings.map((finding) => finding.description),
        ...requiredRepairs.map((repair) => repair.description),
      ]
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
        reviewerID: "acceptance_surface",
        scope: "Acceptance and implementation evidence",
        verdict: acceptanceVerdict,
        summary: verdict === "pass" ? "Acceptance evidence is acceptable." : summary,
        evidence: ["Mock acceptance evidence."],
        findings: findings.filter((finding) => finding.reviewers.includes("acceptance_surface")),
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

mock.module("@/requirements", () => ({
  RequirementsAgent: {
    run: (input: any) => {
      if (!requirementsRunImpl) throw new Error("RequirementsAgent.run mock not configured")
      return requirementsRunImpl(input)
    },
  },
}))

mock.module("@/frontend-design", () => ({
  FrontendDesignAgent: {
    analyze: (input: any) => {
      if (!designAnalyzeImpl) throw new Error("FrontendDesignAgent.analyze mock not configured")
      return designAnalyzeImpl(input)
    },
  },
}))

mock.module("@/frontend-research", () => ({
  FrontendResearchAgent: {
    run: (input: any) => {
      if (!frontendResearchRunImpl) throw new Error("FrontendResearchAgent.run mock not configured")
      return frontendResearchRunImpl(input)
    },
  },
}))

mock.module("@/research", () => ({
  DeepResearchAgent: {
    run: (input: any) => {
      if (!deepResearchRunImpl) throw new Error("DeepResearchAgent.run mock not configured")
      return deepResearchRunImpl(input)
    },
  },
  researchSourceDigest,
}))

mock.module("@/goal-workload-analyst", () => ({
  GoalWorkloadAnalystAgent: {
    analyze: (input: any) => {
      if (!goalWorkloadAnalyzeImpl) throw new Error("GoalWorkloadAnalystAgent.analyze mock not configured")
      return goalWorkloadAnalyzeImpl(input)
    },
  },
}))

mock.module("@/visual-qa", () => ({
  VisualQaAgent: {
    analyze: (input: any) => {
      if (!visualQaAnalyzeImpl) throw new Error("VisualQaAgent.analyze mock not configured")
      return visualQaAnalyzeImpl(input)
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

mock.module("@/plugin", () => ({
  Plugin: {
    list: async () => [],
    trigger: async () => {},
  },
}))

async function markBuildSlotAcquired(
  input: any,
  sessionID = `ses_build_mock_${Date.now()}_${Math.random().toString(36).slice(2)}`,
) {
  await input.onSessionCreated?.(sessionID, {
    worktreeDir: input.managedWorktree?.directory,
    worktreeBranch: input.managedWorktree?.branch,
    worktreeBaseRef: input.managedWorktree?.baseRef,
  })
}

function acceptanceDecisionFixture(verdict: any) {
  return {
    final: verdict,
    rawAgentVerdict: verdict,
    hostGate: {
      passed: true,
      manifest: {
        id: "artifact_acceptance_manifest_fixture",
        taskId: "tsk_acceptance_fixture",
        runId: "run_acceptance_fixture",
        acceptanceId: "dlv_acceptance_fixture",
        iteration: 0,
        requiredChecks: [],
        checkResults: [],
        goalCoverage: [],
        requirementCoverage: [],
        reviewEvidence: [],
        changedFiles: [],
        finalGate: {
          status: "passed",
          summary: "Acceptance evidence gate passed 0 required check(s).",
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
  insertProject?: boolean
}) {
  const specID = input.specID ?? `spec_${input.goalID}`
  Database.use((db) => {
    if (input.insertProject !== false) {
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
    }
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

async function writePassingSourceSkeletonHandoff(projectDir: string) {
  const sourcePackageDir = path.join(projectDir, "web-clone-source")
  const skeletonDir = path.join(sourcePackageDir, "source-skeleton")
  const sourceIrDir = path.join(sourcePackageDir, "source-ir")
  await fs.mkdir(skeletonDir, { recursive: true })
  await fs.mkdir(sourceIrDir, { recursive: true })
  await fs.writeFile(path.join(sourcePackageDir, "reference.png"), minimalPngBytes())
  await fs.writeFile(
    path.join(skeletonDir, "index.html"),
    '<!doctype html><body data-reference-image="../reference.png"><main data-source-node-id="main"><h1>Economic calendar</h1></main></body>',
    "utf8",
  )
  await fs.writeFile(path.join(skeletonDir, "styles.css"), "@import url('./critical.css');\n", "utf8")
  await fs.writeFile(path.join(skeletonDir, "critical.css"), "main { display: block; }\n", "utf8")
  await fs.writeFile(path.join(skeletonDir, "full-source.css"), "main { display: block; }\n", "utf8")
  await fs.writeFile(path.join(skeletonDir, "used-selectors.json"), JSON.stringify({ rules: [], stats: {} }), "utf8")
  await fs.writeFile(path.join(skeletonDir, "README.md"), "Use ../reference.png as visual truth.\n", "utf8")
  await fs.writeFile(
    path.join(skeletonDir, "source-skeleton-audit.json"),
    JSON.stringify({
      version: 1,
      purpose: "web-clone-source-skeleton-audit",
      passed: true,
      hasHtml: true,
      hasCss: true,
      hasCriticalCss: true,
      hasFullSourceCss: true,
      hasUsedSelectors: true,
      hasReadme: true,
      hasSourceIr: true,
      frameworkAgnostic: true,
      referencesScreenshot: true,
      cssAssetBytes: 24,
      criticalCssBytes: 24,
      computedStyleRuleCount: 0,
      replayFactoryDetected: false,
      generatedProjectDetected: false,
      findings: [],
    }),
    "utf8",
  )
  for (const file of [
    "component-tree.json",
    "content-model.json",
    "layout-map.json",
    "style-tokens.json",
    "interaction-hints.json",
    "source-quality-audit.json",
  ]) {
    await fs.writeFile(path.join(sourceIrDir, file), JSON.stringify({ version: 1, passed: true }), "utf8")
  }
  await writeMinimalSourceManifest(sourcePackageDir)
}

function minimalPngBytes(): Uint8Array {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8//8/AwAI/AL+KDv4AAAAAElFTkSuQmCC",
    "base64",
  )
}

async function writeMinimalSourceManifest(sourcePackageDir: string): Promise<void> {
  const referenceSha256 = createHash("sha256").update(Buffer.from(minimalPngBytes())).digest("hex")
  await fs.writeFile(
    path.join(sourcePackageDir, "web-clone-source-manifest.json"),
    JSON.stringify(
      {
        version: 1,
        purpose: "web-clone-visible-source-package",
        provenance: {
          source: "webpage-evidence",
          webpageEvidenceDir: sourcePackageDir,
          reference: {
            path: "reference.png",
            sha256: referenceSha256,
            width: 1,
            height: 1,
            bytes: minimalPngBytes().length,
          },
        },
        files: [
          {
            path: "reference.png",
            sha256: referenceSha256,
            bytes: minimalPngBytes().length,
            source: "webpage-evidence/reference.png",
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  )
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

function seedBuildUptakeIntegrityHistory(input: { taskID: string; specID: string; now: number; rootID?: string }) {
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

function seedSettingsRequirement(input: { taskID: string; specID: string; now: number }) {
  Database.use((db) =>
    insertRequirements(db, {
      taskID: input.taskID,
      specSnapshotID: input.specID,
      now: input.now,
      requirements: [
        {
          id: "REQ-settings",
          title: "Settings validation",
          description: "Validate persisted settings before use.",
          acceptance: ["Persisted settings are validated on load."],
          evidence_refs: [],
          non_goals: [],
          priority: "blocking",
        },
      ],
    }),
  )
}

describe("orchestrator tools", () => {
  let tmp: Awaited<ReturnType<typeof tmpdir>>

  beforeEach(async () => {
    await resetDatabase()
    tmp = await tmpdir()
    requirementsRunImpl = undefined
    architectCoordinateImpl = undefined
    designAnalyzeImpl = undefined
    frontendResearchRunImpl = undefined
    deepResearchRunImpl = undefined
    goalWorkloadAnalyzeImpl = undefined
    visualQaAnalyzeImpl = undefined
    mcpServerToolsImpl = undefined
    mcpCallToolImpl = undefined
    reviewIntegrityImpl = async () => integrityTeamResult({ sessionID: "ses_integrity_default" })
  })

  afterEach(async () => {
    buildAgentRunImpl = undefined
    reviewIntegrityImpl = undefined
    computeRequirementStatusSnapshotImpl = undefined
    requirementsRunImpl = undefined
    architectCoordinateImpl = undefined
    designAnalyzeImpl = undefined
    frontendResearchRunImpl = undefined
    deepResearchRunImpl = undefined
    goalWorkloadAnalyzeImpl = undefined
    visualQaAnalyzeImpl = undefined
    mcpServerToolsImpl = undefined
    mcpCallToolImpl = undefined
    ExecutorRegistry.reset()
    mock.restore()
    await resetDatabase()
    await tmp?.[Symbol.asyncDispose]?.()
  })

  test("build integrity feedback markdown uses the task primary runtime root", async () => {
    const source = await fs.readFile(path.resolve(import.meta.dir, "../../src/orchestrator/tools.ts"), "utf8")

    expect(source).toContain("runtimeMarkdownDir: ProjectRuntimePaths.taskAbsolute(")
    expect(source).toContain("taskPrimaryProjectRoot(input.taskID),")
    expect(source).toContain('input.taskID,\n      "integrity-feedback",')
    expect(source).not.toContain(
      'ProjectRuntimePaths.taskAbsolute(Instance.project.worktree, input.taskID, "integrity-feedback")',
    )
  })

  test("select_expert_squad writes a validated prompt profile to the task root session overlay", async () => {
    const now = Date.now()
    const projectID = "prj_select_expert_squad"
    const taskID = "tsk_select_expert_squad"
    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: tmp.path,
          name: "Select expert squad project",
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
          title: "Select expert squad",
          request: "Use the frontend automation debug expert squad.",
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
        const root = await Session.create({ kind: "root", title: "select expert squad root" })
        Database.use((db) =>
          db
            .update(EngineTaskTable)
            .set({ session_id: root.id, time_updated: Date.now() })
            .where(eq(EngineTaskTable.id, taskID))
            .run(),
        )
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: root.id,
          signal: new AbortController().signal,
        })

        const result = await tools.select_expert_squad.execute(
          {
            profile_id: "frontend-automation-debug",
            reason: "The current failure requires browser automation and screenshot evidence.",
          },
          buildToolOptions("select_expert_squad"),
        )
        expect(toolText(result)).toContain("- previous: frontend-replica")
        expect(toolText(result)).toContain("- active: frontend-automation-debug")
        expect((await Session.get(root.id)).metadata?.configOverlay).toMatchObject({
          prompt_profile: { active: "frontend-automation-debug" },
        })

        await expect(
          tools.select_expert_squad.execute(
            { profile_id: "missing-profile", reason: "Unknown expert squad must not be persisted." },
            buildToolOptions("select_expert_squad_unknown"),
          ),
        ).rejects.toThrow("Unknown prompt profile")
        expect((await Session.get(root.id)).metadata?.configOverlay).toMatchObject({
          prompt_profile: { active: "frontend-automation-debug" },
        })
      },
    })
  })

  test("frontend_design live webpage evidence uses the task primary runtime root", async () => {
    const source = await fs.readFile(path.resolve(import.meta.dir, "../../src/orchestrator/tools.ts"), "utf8")

    expect(source).toContain(
      "const webpageEvidenceProjectDir = taskPrimaryProjectRoot(taskID, { activeProjectID: Instance.project.id })",
    )
    expect(source).toContain("projectDir: webpageEvidenceProjectDir,")
    expect(source).not.toContain(
      "projectDir: Instance.project.worktree,\n              worktreeDir: Instance.directory,",
    )
  })

  test("inject_operator_message reads the current wake message without creating a second task message", async () => {
    const injectMessage = spyOn(EngineService, "injectMessage").mockResolvedValue({
      appended: true,
      orchestratorWoken: true,
      executorResumed: false,
      status: "active",
    })
    const { tools } = createOrchestratorTools({
      taskID: "tsk_operator_projection",
      agentSessionID: "ses_orchestrator_projection",
      signal: new AbortController().signal,
      operatorMessage: {
        text: "resume only the failed build",
        source: "overlay_build_steer",
        messageID: "msg_operator_projection",
        target: {
          kind: "build_session",
          sessionID: "ses_build_projection",
          goalID: "goal_projection",
        },
      },
    })

    const result = await tools.inject_operator_message.execute(
      { reason: "need the latest operator guidance" },
      buildToolOptions("inject_operator_message"),
    )

    expect(injectMessage).not.toHaveBeenCalled()
    expect(toolText(result)).toContain("Operator message is already recorded")
    expect(toolText(result)).toContain("source=overlay_build_steer")
    expect(toolText(result)).toContain("messageID=msg_operator_projection")
    expect(toolText(result)).toContain('"sessionID":"ses_build_projection"')
    expect(toolText(result)).toContain("resume only the failed build")
  })

  test("fail_task marks the task terminal and interrupts its task loop", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_fail_task_${stamp}`
    const taskID = `tsk_fail_task_${stamp}`
    const interruptTaskLoop = spyOn(TaskLoop, "interruptTaskLoop")
    const pipeline = WorkflowRegistry.resolveSync("pipeline")!

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: tmp.path,
          name: "Fail task project",
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
          title: "Fail task",
          request: "prove fail_task is terminal",
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
        const parent = await Session.create({ kind: "root", title: "fail_task parent" })
        Database.use((db) =>
          db
            .update(EngineTaskTable)
            .set({ session_id: parent.id, time_updated: Date.now() })
            .where(eq(EngineTaskTable.id, taskID))
            .run(),
        )
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
          workflow: pipeline,
          workflowState: createWorkflowState(pipeline),
        })

        const result = await tools.fail_task.execute(
          { error: "persistent integrity failure" },
          buildToolOptions("fail_task"),
        )

        expect(toolText(result)).toContain(`Task ${taskID} failed`)
        expect(deriveTaskStatus(findTask(taskID)!)).toBe("failed")
        expect(interruptTaskLoop).toHaveBeenCalledWith(taskID, "task failed")
      },
    })
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
          time_completed: now + 1,
        })
        .run()
    })

    const promptSpy = spyOn(SessionPrompt, "prompt").mockImplementation(async (input: any) => {
      const userMessageID = Identifier.ascending("message")
      await Session.updateMessage({
        id: userMessageID,
        sessionID: input.sessionID,
        role: "user",
        time: { created: Date.now() },
        agent: input.agent,
        model: input.model,
        system: input.system,
        systemMode: input.systemMode,
        tools: input.tools,
        extra: input.extra,
      } as any)
      return {
        info: {
          id: Identifier.ascending("message"),
          role: "assistant",
          sessionID: input.sessionID,
          parentID: userMessageID,
          agent: "explore",
        },
        parts: [{ type: "text", text: "AuctionData lives under Hithink.PrefabLibrary/PrefabLibrary/Business." }],
      } as any
    })
    spyOn(Provider, "getModel").mockResolvedValue({
      id: "model",
      providerID: "test",
      api: { id: "model" },
      capabilities: { input: {} },
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

        expect(toolText(result)).toContain("Explore complete")
        expect(toolText(result)).toContain("AuctionData lives under Hithink.PrefabLibrary")
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
        const sessionID = (artifacts[0].payload as any).session_id
        expect(typeof sessionID).toBe("string")
        expect((artifacts[0].payload as any).result).toContain("AuctionData lives under Hithink.PrefabLibrary")
        const messages = await Session.messages({ sessionID })
        const source = messages.find((message) => message.info.role === "user")
        expect(source?.info.agent).toBe("explore")
        const descriptorRef = (source?.info.extra as any)?.workerTurnDescriptor
        expect(typeof descriptorRef?.id).toBe("string")
        expect(typeof descriptorRef?.hash).toBe("string")
        const contract = SessionPrompt.getSessionRuntimeContract(sessionID)
        expect(contract?.identity).toMatchObject({
          sessionID,
          agentKind: "explore",
          contractKind: "stage-attempt",
          workerTurnDescriptorID: descriptorRef.id,
          workerTurnDescriptorHash: descriptorRef.hash,
        })
        expect(contract?.exactTools).toBeUndefined()
        SessionPrompt.clearSessionRuntimeContract(sessionID)
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

        expect(toolText(result)).toContain("Build agent finished")
        expect(toolText(result)).toContain("Direct workflow build completed")
        expect(workflowState.workflowID).toBe("pipeline")
        const run = findActiveRunForTask(taskID)
        expect(run).toBeDefined()
        expect(run?.plan_version_id).toBeNull()
        expect(run?.status).toBe("running")
      },
    })
  })

  test("orchestrator tools do not reject work solely because the task is terminal", async () => {
    const source = await fs.readFile(path.join(import.meta.dir, "..", "..", "src", "orchestrator", "tools.ts"), "utf8")
    expect(source).not.toContain("Terminal tasks cannot create build runs")
    expect(source).not.toContain("A terminal task must first be reactivated")
    expect(source).not.toContain("build: rejected because task")
    expect(source).not.toContain("terminal task")
  })

  test("task-level direct build receives persistent integrity findings in build context", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_build_uptake_direct_${stamp}`
    const taskID = `tsk_build_uptake_direct_${stamp}`
    const goalID = `gol_build_uptake_direct_${stamp}`
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
    seedSettingsRequirement({ taskID, specID, now })
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

        expect(toolText(result)).toContain("Build agent finished")
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
    const goalID = `gol_build_uptake_goal_${stamp}`
    const specID = `spec_build_uptake_goal_${stamp}`
    let capturedContext: any

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "build uptake goal test" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
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
          insertProject: false,
        })
        seedSettingsRequirement({ taskID, specID, now })
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

        const pipeline = WorkflowRegistry.resolveSync("pipeline")!
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
          workflow: pipeline,
          workflowState: createWorkflowState(pipeline),
        })

        const result = await tools.build.execute(
          {
            goalID,
            request: "Retry by fixing the storage load validator.",
            reason: "Per-goal integrity correction.",
          },
          buildToolOptions(),
        )

        expectGoalBuildStarted(result)
        await waitForGoalStatus(goalID, "passed")
      },
    })

    expect(capturedContext?.integrityFeedback).toContain("## Persistent Integrity Findings")
    expect(capturedContext?.integrityFeedback).toMatch(/root: root_[a-f0-9]{12}/)
    expect(capturedContext?.integrityFeedback).toContain("BF-R2-settings-validation")
    expect(capturedContext?.retryGuidance).toBe("Retry by fixing the storage load validator.")
  })

  test("goal build rejects persisted contract_audit graph id mismatch before build starts", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_audit_drift_${stamp}`
    const taskID = `tsk_audit_drift_${stamp}`
    const goalID = `gol_audit_drift_${stamp}`

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
        const pipeline = WorkflowRegistry.resolveSync("pipeline")!
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
          workflow: pipeline,
          workflowState: createWorkflowState(pipeline),
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

  test("frontend_research returns a visible failure card when startup fails", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_frontend_research_failure_${stamp}`
    const taskID = `tsk_frontend_research_failure_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "frontend research failure parent" })
        Database.use((db) => {
          db.insert(ProjectTable)
            .values({
              id: projectID,
              worktree: tmp.path,
              name: "Frontend research failure project",
              sandboxes: "[]",
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: projectID,
              session_id: parent.id,
              source: "test",
              title: "Frontend research failure task",
              request: "Investigate a webpage before implementation.",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()
        })

        frontendResearchRunImpl = async (input: any) => {
          input.onSessionCreated?.("ses_frontend_research_failed_startup")
          throw new Error("rendered webpage evidence capture failed")
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.frontend_research.execute(
          {
            reason: "Need visible webpage investigation packets.",
            source_urls: ["https://example.com/page"],
          },
          buildToolOptions("frontend_research"),
        )

        expect(toolText(result)).toContain("Frontend research failed before producing an artifact.")
        expect(toolText(result)).toContain("- status: failed")
        expect(toolText(result)).toContain("- artifact_id: none")
        expect(toolText(result)).toContain("- session: ses_frontend_research_failed_startup")
        expect(toolText(result)).toContain("rendered webpage evidence capture failed")
        expect(toolText(result)).toContain("https://example.com/page")
        expect(SessionStatus.get("ses_frontend_research_failed_startup")).toEqual({
          type: "terminal",
          reason: "error",
          error: "rendered webpage evidence capture failed",
        })
      },
    })
  })

  test("frontend_research terminal finalizer miss returns same-session continuation", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_frontend_research_continue_${stamp}`
    const taskID = `tsk_frontend_research_continue_${stamp}`
    const failedSessionID = `ses_frontend_research_continue_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "frontend research continuation parent" })
        Database.use((db) => {
          db.insert(ProjectTable)
            .values({
              id: projectID,
              worktree: tmp.path,
              name: "Frontend research continuation project",
              sandboxes: "[]",
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: projectID,
              session_id: parent.id,
              source: "test",
              title: "Frontend research continuation task",
              request: "Investigate a webpage before implementation.",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()
        })

        let continuationArtifactID = ""
        let calls = 0
        frontendResearchRunImpl = async (input: any) => {
          calls += 1
          if (calls === 1) {
            input.onSessionCreated?.(failedSessionID)
            throw new AgentRunError("frontend-research", "missing terminal submit_research_brief", {
              nonRetryable: true,
              cause: new Message.TerminalToolMissingError({
                message: "Frontend research ended without submit_research_brief.",
                toolName: "submit_research_brief",
                retries: 0,
              }),
            })
          }
          expect(input.continuation).toMatchObject({
            sessionID: failedSessionID,
            artifactID: continuationArtifactID,
            kind: "protocol-finalizer-miss",
            finalizerName: "submit_research_brief",
          })
          expect(input.sourceUrls).toEqual(["https://example.com/page"])
          expect(input.focus).toBeUndefined()
          return {
            brief: minimalFrontendResearchBrief({
              taskID,
              sessionID: failedSessionID,
              sourceURL: "https://example.com/page",
            }),
            bundle: {
              full_markdown: "# Frontend research\n- recovered",
              evidence_json: "{}",
              citation_map_json: "{}",
            },
            factCheckItems: [],
            sessionID: failedSessionID,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const first = await tools.frontend_research.execute(
          {
            reason: "Need webpage investigation packets.",
            source_urls: ["https://example.com/page"],
          },
          buildToolOptions("frontend_research"),
        )
        const firstText = toolText(first)
        expect(firstText).toContain("same-session continuation is ready")
        expect(firstText).toContain("frontend_research({")
        expect(firstText).toContain(
          '"reason":"Continue after missing submit_research_brief: Need webpage investigation packets."',
        )
        expect(firstText).not.toContain("frontend-research({")
        const match = firstText.match(/continuation_artifact_id[^\n]*?(art_[A-Za-z0-9]+)/)
        expect(match?.[1]).toBeTruthy()
        continuationArtifactID = match![1]

        const continuation = findStageContinuationRequest({ taskID, artifactID: continuationArtifactID })
        expect(continuation?.payload.session_id).toBe(failedSessionID)
        expect(continuation?.payload.stage).toBe("frontend-research")
        expect(continuation?.payload.finalizer_name).toBe("submit_research_brief")

        const second = await tools.frontend_research.execute(
          {
            reason: "Continue previous frontend research finalizer miss.",
            continuation_artifact_id: continuationArtifactID,
          },
          buildToolOptions("frontend_research"),
        )
        expect(toolText(second)).toContain("Frontend research brief persisted")
        expect(calls).toBe(2)
      },
    })
  })

  test("frontend_research unavailable continuation artifacts return visible recovery results", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_frontend_research_unavailable_${stamp}`
    const pipeline = WorkflowRegistry.resolveSync("pipeline")!

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "frontend research unavailable continuation parent",
        })
        const projectID = Instance.project.id
        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: projectID,
              session_id: parent.id,
              source: "test",
              title: "Frontend research unavailable continuation task",
              request: "Collect webpage packets.",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()
        })

        let calls = 0
        frontendResearchRunImpl = async () => {
          calls += 1
          throw new Error("unavailable continuation should not reach child agent")
        }

        const consumed = createStageContinuationRequest({
          taskID,
          stage: "frontend-research",
          sessionID: `ses_frontend_research_consumed_${stamp}`,
          parentSessionID: parent.id,
          normalizedStageInput: { task: { id: taskID } },
          inputDigest: "digest-consumed",
          failureName: "TerminalToolMissingError",
          failureMessage: "missing submit_research_brief",
          finalizerName: "submit_research_brief",
        })
        const consumedClaim = claimStageContinuationRequest({
          taskID,
          artifactID: consumed.artifactID,
          sessionID: `ses_frontend_research_consumed_${stamp}`,
          finalizerName: "submit_research_brief",
        })
        markStageContinuationConsumed({
          taskID,
          artifactID: consumed.artifactID,
          claimID: consumedClaim.claimID,
          messageID: "msg_consumed_continuation",
        })

        const claimFailed = createStageContinuationRequest({
          taskID,
          stage: "frontend-research",
          sessionID: `ses_frontend_research_claim_failed_${stamp}`,
          parentSessionID: parent.id,
          normalizedStageInput: { task: { id: taskID } },
          inputDigest: "digest-claim-failed",
          failureName: "TerminalToolMissingError",
          failureMessage: "missing submit_research_brief",
          finalizerName: "submit_research_brief",
        })
        const failedClaim = claimStageContinuationRequest({
          taskID,
          artifactID: claimFailed.artifactID,
          sessionID: `ses_frontend_research_claim_failed_${stamp}`,
          finalizerName: "submit_research_brief",
        })
        markStageContinuationClaimFailed({
          taskID,
          artifactID: claimFailed.artifactID,
          claimID: failedClaim.claimID,
          error: "append recovery prompt failed",
        })

        const staleClaim = createStageContinuationRequest({
          taskID,
          stage: "frontend-research",
          sessionID: `ses_frontend_research_stale_claim_${stamp}`,
          parentSessionID: parent.id,
          normalizedStageInput: { task: { id: taskID } },
          inputDigest: "digest-stale-claim",
          failureName: "TerminalToolMissingError",
          failureMessage: "missing submit_research_brief",
          finalizerName: "submit_research_brief",
        })
        claimStageContinuationRequest({
          taskID,
          artifactID: staleClaim.artifactID,
          sessionID: `ses_frontend_research_stale_claim_${stamp}`,
          finalizerName: "submit_research_brief",
        })
        const staleClaimRow = findStageContinuationRequest({ taskID, artifactID: staleClaim.artifactID })
        Database.use((db) =>
          db
            .update(EngineArtifactTable)
            .set({
              payload: {
                ...staleClaimRow!.payload,
                claim_owner: "previous-process",
              },
            })
            .where(eq(EngineArtifactTable.id, staleClaim.artifactID))
            .run(),
        )

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
          workflow: pipeline,
          workflowState: createWorkflowState(pipeline),
        })

        const consumedResult = await tools.frontend_research.execute(
          {
            reason: "try consumed continuation",
            continuation_artifact_id: consumed.artifactID,
          },
          buildToolOptions("frontend_research_consumed"),
        )
        const consumedText = toolText(consumedResult)
        expect(consumedText).toContain("continuation artifact is no longer pending")
        expect(consumedText).toContain("consumed")
        expect(consumedText).toContain("msg_consumed_continuation")

        const claimFailedResult = await tools.frontend_research.execute(
          {
            reason: "try claim-failed continuation",
            continuation_artifact_id: claimFailed.artifactID,
          },
          buildToolOptions("frontend_research_claim_failed"),
        )
        const claimFailedText = toolText(claimFailedResult)
        expect(claimFailedText).toContain("continuation artifact is no longer pending")
        expect(claimFailedText).toContain("claim_failed")
        expect(claimFailedText).toContain("append recovery prompt failed")

        const staleClaimResult = await tools.frontend_research.execute(
          {
            reason: "try claimed continuation from previous process",
            continuation_artifact_id: staleClaim.artifactID,
          },
          buildToolOptions("frontend_research_stale_claim"),
        )
        const staleClaimText = toolText(staleClaimResult)
        expect(staleClaimText).toContain("continuation artifact is no longer pending")
        expect(staleClaimText).toContain("claim_failed")
        expect(staleClaimText).toContain("previous-process")
        expect(calls).toBe(0)
        const statuses = Database.use((db) =>
          db
            .select({ payload: ProtocolEventTable.payload })
            .from(ProtocolEventTable)
            .where(and(eq(ProtocolEventTable.task_id, taskID), eq(ProtocolEventTable.type, "workflow.step.updated")))
            .all()
            .filter((event) => event.payload?.stepID === "frontend_research")
            .map((event) => String(event.payload?.status ?? "")),
        )
        expect(statuses).toEqual(["running", "completed", "running", "completed", "running", "completed"])
      },
    })
  })

  test("deep_research terminal finalizer miss returns same-session continuation", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_deep_research_continue_${stamp}`
    const failedSessionID = `ses_deep_research_continue_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "deep research continuation parent" })
        const projectID = Instance.project.id
        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: projectID,
              session_id: parent.id,
              source: "test",
              title: "Deep research continuation task",
              request: "Collect source-backed research.",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()
        })

        let continuationArtifactID = ""
        let calls = 0
        deepResearchRunImpl = async (input: any) => {
          calls += 1
          if (calls === 1) {
            input.onSessionCreated?.(failedSessionID)
            throw new AgentRunError("deep-research", "missing terminal submit_research_brief", {
              nonRetryable: true,
              cause: new Message.TerminalToolMissingError({
                message: "Deep research ended without submit_research_brief.",
                toolName: "submit_research_brief",
                retries: 0,
              }),
            })
          }
          expect(input.continuation).toMatchObject({
            sessionID: failedSessionID,
            artifactID: continuationArtifactID,
            kind: "protocol-finalizer-miss",
            finalizerName: "submit_research_brief",
          })
          expect(input.sourceUrls).toBeUndefined()
          return {
            brief: minimalDeepResearchBrief({
              taskID,
              sessionID: failedSessionID,
            }),
            bundle: {
              full_markdown: "# Deep research\n- recovered",
              evidence_json: "{}",
              citation_map_json: "{}",
            },
            factCheckItems: [],
            sessionID: failedSessionID,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const first = await tools.deep_research.execute(
          {
            reason: "Need source-backed research.",
            source_urls: ["https://example.com/source"],
          },
          buildToolOptions("deep_research"),
        )
        const firstText = toolText(first)
        expect(firstText).toContain("same-session continuation is ready")
        expect(firstText).toContain("deep_research({")
        expect(firstText).not.toContain("continuation_call: research({")
        const match = firstText.match(/continuation_artifact_id[^\n]*?(art_[A-Za-z0-9]+)/)
        expect(match?.[1]).toBeTruthy()
        continuationArtifactID = match![1]

        const continuation = findStageContinuationRequest({ taskID, artifactID: continuationArtifactID })
        expect(continuation?.payload.session_id).toBe(failedSessionID)
        expect(continuation?.payload.stage).toBe("deep-research")
        expect(continuation?.payload.finalizer_name).toBe("submit_research_brief")

        const second = await tools.deep_research.execute(
          {
            reason: "Continue previous deep research finalizer miss.",
            continuation_artifact_id: continuationArtifactID,
          },
          buildToolOptions("deep_research"),
        )
        expect(toolText(second)).toContain("Deep research brief persisted")
        expect(calls).toBe(2)
      },
    })
  })

  test("requirements continuation rejects stale frontend design evidence before resuming worker", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_requirements_stale_fd_${stamp}`
    const failedSessionID = `ses_requirements_stale_fd_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "requirements stale frontend design parent" })
        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: parent.id,
              source: "test",
              title: "Requirements stale frontend design task",
              request: "Extract requirements before frontend design evidence changes.",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()
        })

        let continuationArtifactID = ""
        let calls = 0
        requirementsRunImpl = async (input: any) => {
          calls += 1
          input.onSessionCreated?.(failedSessionID)
          throw new AgentRunError("requirements", "missing terminal submit_requirements", {
            nonRetryable: true,
            cause: new Message.TerminalToolMissingError({
              message: "Requirements ended without submit_requirements.",
              toolName: "submit_requirements",
              retries: 0,
            }),
          })
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const first = await tools.requirements.execute(
          {
            reason: "Need requirements.",
          },
          buildToolOptions("requirements_stale_fd"),
        )
        const match = toolText(first).match(/continuation_artifact_id[^\n]*?(art_[A-Za-z0-9]+)/)
        expect(match?.[1]).toBeTruthy()
        continuationArtifactID = match![1]

        createDecisionLog(taskID).append({
          phase: "frontend_design",
          key: "public_report",
          value: "Frontend design evidence became available after the requirements continuation was created.",
          reason: "test evidence changed after continuation capture",
        })

        const staleResult = await tools.requirements.execute(
          {
            reason: "Continue previous requirements finalizer miss.",
            continuation_artifact_id: continuationArtifactID,
          },
          buildToolOptions("requirements_stale_fd"),
        )
        expect(toolText(staleResult)).toContain("continuation artifact scope is stale")
        expect(toolText(staleResult)).toContain("scope_mismatch")
        expect(toolText(staleResult)).toContain("start a fresh requirements")
        expect(calls).toBe(1)
      },
    })
  })

  test("frontend_design continuation rejects stale visual artifacts before resuming worker", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_frontend_design_stale_visual_${stamp}`
    const failedSessionID = `ses_frontend_design_stale_visual_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "frontend design stale visual parent" })
        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: parent.id,
              source: "test",
              title: "Frontend design stale visual task",
              request: "Analyze the visual reference before it changes.",
              kind: "workflow",
              priority: "normal",
              attachments: [
                {
                  sha: "sha-original-reference",
                  url: "attachment://original-reference.png",
                  mime: "image/png",
                  size: 42,
                  filename: "original-reference.png",
                  intent: "visual_reference",
                  source: "user-upload",
                },
              ],
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()
        })

        let continuationArtifactID = ""
        let calls = 0
        designAnalyzeImpl = async (input: any) => {
          calls += 1
          input.onSessionCreated?.(failedSessionID)
          throw new AgentRunError("frontend-design", "missing terminal submit_frontend_template", {
            nonRetryable: true,
            cause: new Message.TerminalToolMissingError({
              message: "Frontend design ended without submit_frontend_template.",
              toolName: "submit_frontend_template",
              retries: 0,
            }),
          })
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const first = await tools.frontend_design.execute(
          {
            reason: "Need frontend design handoff.",
          },
          buildToolOptions("frontend_design_stale_visual"),
        )
        const match = toolText(first).match(/continuation_artifact_id[^\n]*?(art_[A-Za-z0-9]+)/)
        expect(match?.[1]).toBeTruthy()
        continuationArtifactID = match![1]

        Database.use((db) => {
          db.update(EngineTaskTable)
            .set({
              system_artifacts: [
                {
                  sha: "sha-new-reference",
                  url: "attachment://new-reference.png",
                  mime: "image/png",
                  size: 84,
                  filename: "new-reference.png",
                  intent: "visual_reference",
                  source: "url-screenshot",
                },
              ],
              time_updated: now + 1,
            })
            .where(eq(EngineTaskTable.id, taskID))
            .run()
        })

        const staleResult = await tools.frontend_design.execute(
          {
            reason: "Continue previous frontend design finalizer miss.",
            continuation_artifact_id: continuationArtifactID,
          },
          buildToolOptions("frontend_design_stale_visual"),
        )
        expect(toolText(staleResult)).toContain("continuation artifact scope is stale")
        expect(toolText(staleResult)).toContain("scope_mismatch")
        expect(toolText(staleResult)).toContain("start a fresh frontend_design")
        expect(calls).toBe(1)
      },
    })
  })

  test("frontend_design continuation rejects stale host-prepared source evidence before resuming worker", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_frontend_design_stale_host_evidence_${stamp}`
    const failedSessionID = `ses_frontend_design_stale_host_evidence_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "frontend design stale host evidence parent" })
        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: parent.id,
              source: "test",
              title: "Frontend design stale host evidence task",
              request: "Analyze the host-prepared source evidence before it changes.",
              kind: "workflow",
              priority: "normal",
              attachments: [
                {
                  sha: "sha-original-reference",
                  url: "attachment://original-reference.png",
                  mime: "image/png",
                  size: 42,
                  filename: "original-reference.png",
                  intent: "visual_reference",
                  source: "user-upload",
                },
              ],
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()
        })

        const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
        const sourceDataDir = path.join(paths.skeletonProjectAbsolute, "src", "data")
        await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
        await fs.mkdir(sourceDataDir, { recursive: true })
        await fs.writeFile(path.join(paths.sourcePackageAbsolute, "reference.png"), minimalPngBytes())
        await fs.writeFile(
          path.join(sourceDataDir, "sourceDomReplacementPlan.ts"),
          "export const sourceDomReplacementPlan = [] as const\n",
          "utf8",
        )
        await fs.writeFile(
          path.join(sourceDataDir, "sourceDomIterationState.ts"),
          'export const sourceDomIterationState = {"generatedRegionCount":1,"semanticReplacementCount":0,"remainingRegionCount":1} as const\n',
          "utf8",
        )
        const writeSourceManifest = async (referenceImage: string, regionCount: number) => {
          await fs.writeFile(
            path.join(sourceDataDir, "sourceProjectManifest.json"),
            JSON.stringify(
              {
                visualIteration: {
                  referenceImage,
                  evidenceMethod: "test-source-package",
                  viewportMatrix: [
                    {
                      name: "desktop",
                      width: 1440,
                      height: 900,
                      evidenceRole: "reference",
                      comparison: "captured-source",
                    },
                  ],
                  rule: "Use host-prepared source evidence as the visual baseline.",
                },
                sourceDomRegions: {
                  count: regionCount,
                  largestBytes: 128,
                  highPriorityCount: 1,
                  replacementPlanCount: 0,
                  iterationStateModule: "sourceDomIterationState.ts",
                  semanticReplacementCount: 0,
                },
              },
              null,
              2,
            ),
            "utf8",
          )
        }
        await writeSourceManifest("reference.png", 1)

        let continuationArtifactID = ""
        let calls = 0
        designAnalyzeImpl = async (input: any) => {
          calls += 1
          input.onSessionCreated?.(failedSessionID)
          throw new AgentRunError("frontend-design", "missing terminal submit_frontend_template", {
            nonRetryable: true,
            cause: new Message.TerminalToolMissingError({
              message: "Frontend design ended without submit_frontend_template.",
              toolName: "submit_frontend_template",
              retries: 0,
            }),
          })
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const first = await tools.frontend_design.execute(
          {
            reason: "Need frontend design handoff from host-prepared source evidence.",
          },
          buildToolOptions("frontend_design_stale_host_evidence"),
        )
        const match = toolText(first).match(/continuation_artifact_id[^\n]*?(art_[A-Za-z0-9]+)/)
        expect(match?.[1]).toBeTruthy()
        continuationArtifactID = match![1]

        await writeSourceManifest("reference-updated.png", 2)

        const staleResult = await tools.frontend_design.execute(
          {
            reason: "Continue previous frontend design finalizer miss.",
            continuation_artifact_id: continuationArtifactID,
          },
          buildToolOptions("frontend_design_stale_host_evidence"),
        )
        expect(toolText(staleResult)).toContain("continuation artifact scope is stale")
        expect(toolText(staleResult)).toContain("scope_mismatch")
        expect(toolText(staleResult)).toContain("start a fresh frontend_design")
        expect(calls).toBe(1)
      },
    })
  })

  test("frontend_design continuation rejects stale frontend research blueprint before resuming worker", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_frontend_design_stale_blueprint_${stamp}`
    const failedSessionID = `ses_frontend_design_stale_blueprint_${stamp}`
    const request = "Clone https://example.com/page into a visual HTML skeleton."

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "frontend design stale blueprint parent" })
        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: parent.id,
              source: "test",
              title: "Frontend design stale blueprint task",
              request,
              kind: "workflow",
              priority: "normal",
              attachments: [
                {
                  sha: "sha-original-reference",
                  url: "attachment://original-reference.png",
                  mime: "image/png",
                  size: 42,
                  filename: "original-reference.png",
                  intent: "visual_reference",
                  source: "user-upload",
                },
              ],
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()
        })

        let continuationArtifactID = ""
        let calls = 0
        designAnalyzeImpl = async (input: any) => {
          calls += 1
          input.onSessionCreated?.(failedSessionID)
          throw new AgentRunError("frontend-design", "missing terminal submit_frontend_template", {
            nonRetryable: true,
            cause: new Message.TerminalToolMissingError({
              message: "Frontend design ended without submit_frontend_template.",
              toolName: "submit_frontend_template",
              retries: 0,
            }),
          })
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const first = await tools.frontend_design.execute(
          {
            reason: "Need frontend design handoff.",
          },
          buildToolOptions("frontend_design_stale_blueprint"),
        )
        const match = toolText(first).match(/continuation_artifact_id[^\n]*?(art_[A-Za-z0-9]+)/)
        expect(match?.[1]).toBeTruthy()
        continuationArtifactID = match![1]

        persistTaskFrontendResearchBrief({
          taskID,
          brief: minimalFrontendResearchBrief({
            taskID,
            sessionID: `ses_frontend_research_blueprint_${stamp}`,
            sourceURL: "https://example.com/page",
            request,
          }),
          now: now + 1,
        })

        const staleResult = await tools.frontend_design.execute(
          {
            reason: "Continue previous frontend design finalizer miss.",
            continuation_artifact_id: continuationArtifactID,
          },
          buildToolOptions("frontend_design_stale_blueprint"),
        )
        expect(toolText(staleResult)).toContain("continuation artifact scope is stale")
        expect(toolText(staleResult)).toContain("scope_mismatch")
        expect(toolText(staleResult)).toContain("start a fresh frontend_design")
        expect(calls).toBe(1)
      },
    })
  })

  test("frontend_design continuation ignores unrelated task metadata changes", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_frontend_design_metadata_resume_${stamp}`
    const failedSessionID = `ses_frontend_design_metadata_resume_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "frontend design metadata resume parent" })
        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: parent.id,
              source: "test",
              title: "Frontend design metadata resume task",
              request: "Analyze the visual reference before unrelated metadata changes.",
              kind: "workflow",
              priority: "normal",
              attachments: [
                {
                  sha: "sha-original-reference",
                  url: "attachment://original-reference.png",
                  mime: "image/png",
                  size: 42,
                  filename: "original-reference.png",
                  intent: "visual_reference",
                  source: "user-upload",
                },
              ],
              metadata: { unrelated_counter: 1 },
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()
        })

        let continuationArtifactID = ""
        let calls = 0
        designAnalyzeImpl = async (input: any) => {
          calls += 1
          if (calls === 1) {
            input.onSessionCreated?.(failedSessionID)
            throw new AgentRunError("frontend-design", "missing terminal submit_frontend_template", {
              nonRetryable: true,
              cause: new Message.TerminalToolMissingError({
                message: "Frontend design ended without submit_frontend_template.",
                toolName: "submit_frontend_template",
                retries: 0,
              }),
            })
          }
          expect(input.continuation).toMatchObject({
            sessionID: failedSessionID,
            artifactID: continuationArtifactID,
            kind: "protocol-finalizer-miss",
            finalizerName: "submit_frontend_template",
          })
          return minimalFrontendDesignAnalysis()
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const first = await tools.frontend_design.execute(
          {
            reason: "Need frontend design handoff.",
          },
          buildToolOptions("frontend_design_metadata_resume"),
        )
        const match = toolText(first).match(/continuation_artifact_id[^\n]*?(art_[A-Za-z0-9]+)/)
        expect(match?.[1]).toBeTruthy()
        continuationArtifactID = match![1]

        Database.use((db) => {
          db.update(EngineTaskTable)
            .set({
              metadata: { unrelated_counter: 2 },
              time_updated: now + 1,
            })
            .where(eq(EngineTaskTable.id, taskID))
            .run()
        })

        const second = await tools.frontend_design.execute(
          {
            reason: "Continue previous frontend design finalizer miss.",
            continuation_artifact_id: continuationArtifactID,
          },
          buildToolOptions("frontend_design_metadata_resume"),
        )
        expect(toolText(second)).toContain("SUCCESS: frontend_design public report")
        expect(toolText(second)).not.toContain("scope_mismatch")
        expect(calls).toBe(2)
      },
    })
  })

  test("workload_analysis terminal finalizer miss returns same-session continuation", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_workload_continue_${stamp}`
    const goalID = `goal_workload_continue_${stamp}`
    const failedSessionID = `ses_workload_continue_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "workload continuation parent" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Workload continuation project",
          taskTitle: "Workload continuation task",
          request: "Size the active architecture goals.",
          goalTitle: "Sized goal",
          goalSlug: "sized-goal",
          objective: "Implement and verify one surface.",
          now,
          specID: `spec_workload_continue_${stamp}`,
          requirementIDs: ["REQ-workload"],
          insertProject: false,
        })

        let continuationArtifactID = ""
        let calls = 0
        goalWorkloadAnalyzeImpl = async (input: any) => {
          calls += 1
          if (calls === 1) {
            input.onSessionCreated?.(failedSessionID)
            throw new AgentRunError("goal-workload-analyst", "missing terminal submit_workload_analysis", {
              nonRetryable: true,
              cause: new Message.TerminalToolMissingError({
                message: "Workload analyst ended without submit_workload_analysis.",
                toolName: "submit_workload_analysis",
                retries: 0,
              }),
            })
          }
          expect(input.continuation).toMatchObject({
            sessionID: failedSessionID,
            artifactID: continuationArtifactID,
            kind: "protocol-finalizer-miss",
            finalizerName: "submit_workload_analysis",
          })
          return {
            briefs: [minimalWorkloadBrief(goalID)],
            specSnapshotID: `spec_workload_continue_${stamp}`,
            summary: "Recovered workload analysis.",
            sessionID: failedSessionID,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const first = await tools.workload_analysis.execute(
          {
            reason: "Need an independent workload review.",
          },
          buildToolOptions("workload_analysis"),
        )
        const firstText = toolText(first)
        expect(firstText).toContain("same-session continuation is ready")
        expect(firstText).toContain("workload_analysis({")
        expect(firstText).not.toContain("goal_workload_analyst({")
        const match = firstText.match(/continuation_artifact_id[^\n]*?(art_[A-Za-z0-9]+)/)
        expect(match?.[1]).toBeTruthy()
        continuationArtifactID = match![1]

        const continuation = findStageContinuationRequest({ taskID, artifactID: continuationArtifactID })
        expect(continuation?.payload.session_id).toBe(failedSessionID)
        expect(continuation?.payload.stage).toBe("goal-workload-analyst")
        expect(continuation?.payload.finalizer_name).toBe("submit_workload_analysis")

        const second = await tools.workload_analysis.execute(
          {
            reason: "Continue previous workload finalizer miss.",
            continuation_artifact_id: continuationArtifactID,
          },
          buildToolOptions("workload_analysis"),
        )
        expect(toolText(second)).toContain("Workload analysis complete")
        expect(calls).toBe(2)
      },
    })
  })

  test("workload_analysis continuation rejects stale goal graph before resuming worker", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_workload_stale_scope_${stamp}`
    const goalID = `goal_workload_stale_scope_${stamp}`
    const failedSessionID = `ses_workload_stale_scope_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "workload stale continuation parent" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Workload stale continuation project",
          taskTitle: "Workload stale continuation task",
          request: "Size the active architecture goals before the graph changes.",
          goalTitle: "Sized goal",
          goalSlug: "sized-goal",
          objective: "Implement and verify one surface.",
          now,
          specID: `spec_workload_stale_scope_${stamp}`,
          requirementIDs: ["REQ-workload"],
          insertProject: false,
        })

        let continuationArtifactID = ""
        let calls = 0
        goalWorkloadAnalyzeImpl = async (input: any) => {
          calls += 1
          input.onSessionCreated?.(failedSessionID)
          throw new AgentRunError("goal-workload-analyst", "missing terminal submit_workload_analysis", {
            nonRetryable: true,
            cause: new Message.TerminalToolMissingError({
              message: "Workload analyst ended without submit_workload_analysis.",
              toolName: "submit_workload_analysis",
              retries: 0,
            }),
          })
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const first = await tools.workload_analysis.execute(
          {
            reason: "Need an independent workload review.",
          },
          buildToolOptions("workload_analysis"),
        )
        const match = toolText(first).match(/continuation_artifact_id[^\n]*?(art_[A-Za-z0-9]+)/)
        expect(match?.[1]).toBeTruthy()
        continuationArtifactID = match![1]

        Database.use((db) => {
          db.update(EngineGoalTable)
            .set({
              objective: "Implement and verify a changed surface after graph mutation.",
              time_updated: now + 1,
            })
            .where(eq(EngineGoalTable.id, goalID))
            .run()
        })

        const staleResult = await tools.workload_analysis.execute(
          {
            reason: "Continue previous workload finalizer miss.",
            continuation_artifact_id: continuationArtifactID,
          },
          buildToolOptions("workload_analysis"),
        )
        expect(toolText(staleResult)).toContain("continuation artifact scope is stale")
        expect(toolText(staleResult)).toContain("scope_mismatch")
        expect(toolText(staleResult)).toContain("start a fresh workload_analysis")
        expect(calls).toBe(1)
      },
    })
  })

  test("visual_qa terminal finalizer miss returns same-session continuation", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_visual_qa_continue_${stamp}`
    const failedSessionID = `ses_visual_qa_continue_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "visual QA continuation parent" })
        const projectID = Instance.project.id
        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: projectID,
              session_id: parent.id,
              source: "test",
              title: "Visual QA continuation task",
              request: "Review the finished visible product.",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()
        })

        let continuationArtifactID = ""
        let calls = 0
        visualQaAnalyzeImpl = async (input: any) => {
          calls += 1
          if (calls === 1) {
            input.onSessionCreated?.(failedSessionID)
            throw new AgentRunError("visual-qa", "missing terminal submit_visual_qa_report", {
              nonRetryable: true,
              cause: new Message.TerminalToolMissingError({
                message: "Visual QA ended without submit_visual_qa_report.",
                toolName: "submit_visual_qa_report",
                retries: 0,
              }),
            })
          }
          expect(input.continuation).toMatchObject({
            sessionID: failedSessionID,
            artifactID: continuationArtifactID,
            kind: "protocol-finalizer-miss",
            finalizerName: "submit_visual_qa_report",
          })
          return {
            report: minimalVisualQaReport(),
            sessionID: failedSessionID,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const first = await tools.visual_qa.execute(
          {
            reason: "Need final GUI review.",
          },
          buildToolOptions("visual_qa"),
        )
        const firstText = toolText(first)
        expect(firstText).toContain("same-session continuation is ready")
        expect(firstText).toContain("visual_qa({")
        const match = firstText.match(/continuation_artifact_id[^\n]*?(art_[A-Za-z0-9]+)/)
        expect(match?.[1]).toBeTruthy()
        continuationArtifactID = match![1]

        const continuation = findStageContinuationRequest({ taskID, artifactID: continuationArtifactID })
        expect(continuation?.payload.session_id).toBe(failedSessionID)
        expect(continuation?.payload.stage).toBe("visual-qa")
        expect(continuation?.payload.finalizer_name).toBe("submit_visual_qa_report")

        const second = await tools.visual_qa.execute(
          {
            reason: "Continue previous visual QA finalizer miss.",
            continuation_artifact_id: continuationArtifactID,
          },
          buildToolOptions("visual_qa"),
        )
        expect(toolText(second)).toContain("visual_qa complete: accepted=true")
        expect(calls).toBe(2)
      },
    })
  })

  test("visual_qa continuation rejects stale frontend evidence before resuming worker", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_visual_qa_stale_evidence_${stamp}`
    const failedSessionID = `ses_visual_qa_stale_evidence_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "visual QA stale evidence parent" })
        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: parent.id,
              source: "test",
              title: "Visual QA stale evidence task",
              request: "Review the finished visible product after frontend evidence changes.",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()
        })

        let continuationArtifactID = ""
        let calls = 0
        visualQaAnalyzeImpl = async (input: any) => {
          calls += 1
          if (calls === 1) {
            input.onSessionCreated?.(failedSessionID)
            throw new AgentRunError("visual-qa", "missing terminal submit_visual_qa_report", {
              nonRetryable: true,
              cause: new Message.TerminalToolMissingError({
                message: "Visual QA ended without submit_visual_qa_report.",
                toolName: "submit_visual_qa_report",
                retries: 0,
              }),
            })
          }
          throw new Error("stale visual_qa continuation reached child agent")
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const first = await tools.visual_qa.execute(
          {
            reason: "Need final GUI review.",
          },
          buildToolOptions("visual_qa_stale_evidence"),
        )
        const match = toolText(first).match(/continuation_artifact_id[^\n]*?(art_[A-Za-z0-9]+)/)
        expect(match?.[1]).toBeTruthy()
        continuationArtifactID = match![1]

        createDecisionLog(taskID).append({
          phase: "frontend_design",
          key: "public_report",
          value: "New frontend design report materialized after the visual QA continuation was created.",
          reason: "test evidence changed after continuation capture",
        })

        const staleResult = await tools.visual_qa.execute(
          {
            reason: "Continue stale visual QA after evidence changed.",
            continuation_artifact_id: continuationArtifactID,
          },
          buildToolOptions("visual_qa_stale_evidence"),
        )
        expect(toolText(staleResult)).toContain("continuation artifact scope is stale")
        expect(toolText(staleResult)).toContain("scope_mismatch")
        expect(toolText(staleResult)).toContain("start a fresh visual_qa")
        expect(calls).toBe(1)
      },
    })
  })

  test("integrity terminal finalizer miss returns same-session continuation with ownership closed", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_integrity_continue_${stamp}`
    const goalID = `goal_integrity_continue_${stamp}`
    const specID = `spec_integrity_continue_${stamp}`
    const failedSessionID = `ses_integrity_continue_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "integrity continuation parent" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Integrity continuation project",
          taskTitle: "Integrity continuation task",
          request: "Review the active architecture graph.",
          goalTitle: "Reviewable goal",
          goalSlug: "reviewable-goal",
          objective: "Provide one reviewable goal.",
          now,
          specID,
          requirementIDs: ["REQ-integrity"],
          insertProject: false,
        })

        let continuationArtifactID = ""
        let calls = 0
        reviewIntegrityImpl = async (input: any) => {
          calls += 1
          if (calls === 1) {
            input.onSessionCreated?.(failedSessionID)
            throw new AgentRunError("integrity", "missing terminal submit_integrity_consensus", {
              nonRetryable: true,
              cause: new Message.TerminalToolMissingError({
                message: "Integrity ended without submit_integrity_consensus.",
                toolName: "submit_integrity_consensus",
                retries: 0,
              }),
            })
          }
          expect(input.continuation).toMatchObject({
            sessionID: failedSessionID,
            artifactID: continuationArtifactID,
            kind: "protocol-finalizer-miss",
            finalizerName: "submit_integrity_consensus",
          })
          return integrityTeamResult({
            verdict: "pass",
            summary: "Recovered integrity pass.",
            sessionID: failedSessionID,
          })
        }

        const pipeline = WorkflowRegistry.resolveSync("pipeline")!
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
          workflow: pipeline,
          workflowState: createWorkflowState(pipeline),
        })

        const first = await tools.integrity.execute(
          {
            reason: "Need an independent integrity review.",
          },
          buildToolOptions("integrity"),
        )
        const firstText = toolText(first)
        expect(firstText).toContain("same-session continuation is ready")
        expect(firstText).toContain("integrity({")
        const match = firstText.match(/continuation_artifact_id[^\n]*?(art_[A-Za-z0-9]+)/)
        expect(match?.[1]).toBeTruthy()
        continuationArtifactID = match![1]

        const continuation = findStageContinuationRequest({ taskID, artifactID: continuationArtifactID })
        expect(continuation?.payload.session_id).toBe(failedSessionID)
        expect(continuation?.payload.stage).toBe("integrity")
        expect(continuation?.payload.finalizer_name).toBe("submit_integrity_consensus")
        expect(continuation?.payload.normalized_stage_input).toMatchObject({
          active_spec_snapshot_id: specID,
          phase: "pre_build",
          goal_ids: [goalID],
        })
        expect(findLatestIntegrityAttemptArtifact({ taskID, specSnapshotID: specID })).toBeUndefined()
        expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(0)

        const second = await tools.integrity.execute(
          {
            reason: "Continue previous integrity finalizer miss.",
            continuation_artifact_id: continuationArtifactID,
          },
          buildToolOptions("integrity"),
        )
        expect(toolText(second)).toContain("Integrity verdict: pass")
        expect(calls).toBe(2)
        const artifact = findLatestIntegrityAttemptArtifact({ taskID, specSnapshotID: specID })
        expect(artifact?.payload.session_id).toBe(failedSessionID)
        const attempts = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "integrity_attempt")))
            .all(),
        )
        expect(attempts).toHaveLength(1)
        expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(0)
        const statuses = Database.use((db) =>
          db
            .select({ payload: ProtocolEventTable.payload })
            .from(ProtocolEventTable)
            .where(and(eq(ProtocolEventTable.task_id, taskID), eq(ProtocolEventTable.type, "workflow.step.updated")))
            .all()
            .filter((event) => event.payload?.stepID === "integrity")
            .map((event) => String(event.payload?.status ?? "")),
        )
        expect(statuses).toEqual(["running", "failed", "running", "failed"])
      },
    })
  })

  test("integrity continuation rejects stale visual QA evidence before resuming worker", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_integrity_stale_evidence_${stamp}`
    const goalID = `goal_integrity_stale_evidence_${stamp}`
    const specID = `spec_integrity_stale_evidence_${stamp}`
    const failedSessionID = `ses_integrity_stale_evidence_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "integrity stale evidence parent" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Integrity stale evidence project",
          taskTitle: "Integrity stale evidence task",
          request: "Reject integrity continuation after review evidence changes.",
          goalTitle: "Reviewable stale evidence goal",
          goalSlug: "reviewable-stale-evidence-goal",
          objective: "Provide one reviewable goal.",
          now,
          specID,
          requirementIDs: ["REQ-integrity-stale"],
          insertProject: false,
        })

        let continuationArtifactID = ""
        let calls = 0
        reviewIntegrityImpl = async (input: any) => {
          calls += 1
          if (calls === 1) {
            input.onSessionCreated?.(failedSessionID)
            throw new AgentRunError("integrity", "missing terminal submit_integrity_consensus", {
              nonRetryable: true,
              cause: new Message.TerminalToolMissingError({
                message: "Integrity ended without submit_integrity_consensus.",
                toolName: "submit_integrity_consensus",
                retries: 0,
              }),
            })
          }
          throw new Error("stale integrity continuation reached child agent")
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const first = await tools.integrity.execute(
          {
            reason: "Need an independent integrity review.",
          },
          buildToolOptions("integrity_stale_evidence"),
        )
        const match = toolText(first).match(/continuation_artifact_id[^\n]*?(art_[A-Za-z0-9]+)/)
        expect(match?.[1]).toBeTruthy()
        continuationArtifactID = match![1]

        createDecisionLog(taskID).append({
          phase: "visual_qa",
          key: "latest_summary",
          value: "New visual QA evidence appeared after the integrity continuation was created.",
          reason: "test evidence changed after continuation capture",
        })

        const staleResult = await tools.integrity.execute(
          {
            reason: "Continue stale integrity after visual QA changed.",
            continuation_artifact_id: continuationArtifactID,
          },
          buildToolOptions("integrity_stale_evidence"),
        )
        expect(toolText(staleResult)).toContain("continuation artifact scope is stale")
        expect(toolText(staleResult)).toContain("scope_mismatch")
        expect(toolText(staleResult)).toContain("start a fresh integrity")
        expect(calls).toBe(1)
        expect(findLatestIntegrityAttemptArtifact({ taskID, specSnapshotID: specID })).toBeUndefined()
      },
    })
  })

  test("orchestrator tools do not expose removed child-session steering control", async () => {
    const { tools } = createOrchestratorTools({
      taskID: "tsk_removed_child_session_control",
      agentSessionID: "ses_removed_child_session_control",
      signal: new AbortController().signal,
    })

    expect(tools[["steer", "subagent"].join("_")]).toBeUndefined()
    expect(tools.cancel_subagent).toBeDefined()
    expect(tools.respond_agent_coordination).toBeDefined()
  })

  test("respond_agent_coordination continue consumes a pending request and resumes the same worker session", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_continue_${stamp}`
    const taskID = `tsk_agent_coordination_continue_${stamp}`
    const goalID = `gol_agent_coordination_continue_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination continue",
      taskTitle: "agent coordination continue",
      request: "Worker asks the orchestrator to continue the same session",
      goalTitle: "Coordinate worker",
      goalSlug: "coordinate-worker",
      objective: "Continue the worker from the existing session",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const loopSpy = spyOn(SessionPrompt, "loop").mockResolvedValue({
          info: {
            id: Identifier.ascending("message"),
            role: "assistant",
            sessionID: "unused",
          },
          parts: [],
        } as any)
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "assistant",
          parentID: parent.id,
          title: "agent coordination worker",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const request = createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "coding",
          messageID: Identifier.ascending("message"),
          summary: "Need a routing decision",
          details: "The worker has enough evidence but needs the orchestrator to confirm continuation.",
          blocking: true,
          requestedDecision: "continue this worker session",
          severity: "blocked",
        })

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "continue",
              message: "Continue with the current evidence and produce the requested finding.",
              reason: "The worker requested scheduler confirmation and the same session remains valid.",
            },
            buildToolOptions("respond_agent_coordination"),
          ),
        )

        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with continue`)
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        const messages: Message.WithParts[] = []
        for await (const item of Message.stream(worker.id)) messages.push(item)
        const responseUser = messages.find(
          (item) =>
            item.info.role === "user" &&
            item.parts.some((part) => part.type === "text" && part.text.includes("Orchestrator Coordination Response")),
        )
        expect(responseUser).toBeDefined()
        expect(responseUser?.parts.some((part) => part.type === "text" && part.text.includes(request.payload.summary))).toBe(
          true,
        )
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(loopSpy).toHaveBeenCalledWith({ sessionID: worker.id })
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
        const runID = await createAbortableCoordinatorRun({ taskID, sessionID: child.id, now })
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

        const result = toolText(
          await tools.cancel_subagent.execute(
            {
              session_id: child.id,
              reason: "steer gave no useful progress; abort the stale child before re-dispatch",
            },
            buildToolOptions(),
          ),
        )

        expect(findGoalRun(goalRunID)?.status).toBe("aborted")
        expect(findGoalRun(goalRunID)?.error).toContain("cancel_subagent:")
        expect(toolText(result)).toContain(`Cancelled sub-agent session ${child.id}`)
        expect(toolText(result)).toContain(`goal_run ${goalRunID} aborted`)
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
        const runID = await createAbortableCoordinatorRun({ taskID, sessionID: child.id, now })
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

        const result = toolText(
          await tools.cancel_subagent.execute(
            {
              goal_id: goalID,
              reason: "resume should terminate the latest live child session for this goal before re-dispatch",
            },
            buildToolOptions(),
          ),
        )

        expect(findGoalRun(goalRunID)?.status).toBe("aborted")
        expect(toolText(result)).toContain(`Cancelled sub-agent session ${child.id}`)
        expect(toolText(result)).toContain(`source=${goalID} -> goal_run ${goalRunID} -> session ${child.id}`)
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
        const runID = await createAbortableCoordinatorRun({ taskID, sessionID: child.id, now })
        const goalRunID = beginBuildAttempt({
          taskID,
          goalID,
          runID,
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

        const modifyResult = toolText(
          await tools.modify_goal.execute(
            {
              goalID,
              updates: { objective: "Mutated while live" },
              reason: "should be rejected while live owned",
            },
            buildToolOptions(),
          ),
        )
        expect(modifyResult).toContain("Error: modify_goal refused")
        expect(findGoal(goalID)?.objective).toBe("Guard live build ownership")
        expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(1)

        const cancelResult = toolText(
          await tools.cancel_subagent.execute(
            {
              goal_id: goalID,
              reason: "operator changed direction while this build was still running",
            },
            buildToolOptions(),
          ),
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

  test("live goal_run without tool ownership blocks contract mutation", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_live_goal_run_guard_${stamp}`
    const taskID = `tsk_live_goal_run_guard_${stamp}`
    const goalID = `gol_live_goal_run_guard_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "live goal_run guard",
      taskTitle: "live goal_run guard",
      request: "Do not mutate a goal while its async build goal_run is live",
      goalTitle: "Async build goal",
      goalSlug: "async-build-goal",
      objective: "Guard live goal_run facts",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "live goal_run parent" })
        const child = await Session.create({
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "live goal_run child",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const runID = await createAbortableCoordinatorRun({ taskID, sessionID: child.id, now })
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

        const modifyResult = toolText(
          await tools.modify_goal.execute(
            {
              goalID,
              updates: { objective: "Mutated while live goal_run exists" },
              reason: "should be rejected while async build is live",
            },
            buildToolOptions(),
          ),
        )

        expect(modifyResult).toContain("Error: modify_goal refused")
        expect(modifyResult).toContain(`live goal_run ${goalRunID}`)
        expect(findGoal(goalID)?.objective).toBe("Guard live goal_run facts")
        expect(findGoalRun(goalRunID)?.status).toBe("running")
        expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(0)
      },
    })
  })

  test("add_goal appends a new operator instruction goal to the active plan", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_add_goal_${stamp}`
    const taskID = `tsk_add_goal_${stamp}`
    const goalID = `gol_add_goal_existing_${stamp}`
    const planID = `plan_add_goal_${stamp}`
    const planNodeID = `plan_node_add_goal_existing_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "add goal",
      taskTitle: "add goal from operator message",
      request: "Start with one workflow goal",
      goalTitle: "Existing goal",
      goalSlug: "existing-goal",
      objective: "Implement the existing workflow surface before the operator adds more scoped work.",
      now,
    })
    Database.use((db) => {
      db.insert(EnginePlanVersionTable)
        .values({
          id: planID,
          task_id: taskID,
          spec_snapshot_id: `spec_${goalID}`,
          version: 1,
          status: "active",
          summary: "1 goals",
          prompt: "Start with one workflow goal",
          metadata: {},
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EnginePlanNodeTable)
        .values({
          id: planNodeID,
          task_id: taskID,
          plan_version_id: planID,
          kind: "goal",
          goal_id: goalID,
          title: "Existing goal",
          brief: "existing brief",
          order_index: 0,
          metadata: {},
          time_created: now,
          time_updated: now,
        })
        .run()
      db.update(EngineGoalTable).set({ plan_version_id: planID }).where(eq(EngineGoalTable.id, goalID)).run()
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "add goal parent" })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.add_goal.execute(
          {
            goal: {
              title: "Operator requested follow-up goal",
              objective:
                "Implement the concrete follow-up surface from the latest operator instruction with clear tests and no changes to unrelated workflow goals.",
              acceptance_specs: [
                {
                  id: "ACC-OPERATOR-FOLLOWUP",
                  source_requirement_id: "REQ-OPERATOR-FOLLOWUP",
                  goal_id: "operator_followup_goal",
                  title: "Operator follow-up is implemented",
                  scorers: [
                    {
                      type: "llm_judge",
                      name: "operator-followup",
                      criteria: "Confirm the concrete operator-requested follow-up surface is implemented and tested.",
                    },
                  ],
                  severity: "essential",
                  trigger: "on_goal",
                },
              ],
              owned_paths: ["src/operator-followup.ts"],
              depends_on: [goalID],
              priority: "blocking",
              kind: "feature",
              requirement_ids: ["REQ-OPERATOR-FOLLOWUP"],
            },
            reason: "The latest operator message adds a concrete follow-up surface inside the same task.",
          },
          buildToolOptions("add_goal"),
        )

        expect(toolText(result)).toContain("Goal added")
        const goals = Database.use((db) =>
          db
            .select()
            .from(EngineGoalTable)
            .where(eq(EngineGoalTable.task_id, taskID))
            .orderBy(EngineGoalTable.order_index)
            .all(),
        )
        expect(goals).toHaveLength(2)
        const added = goals[1]!
        expect(added.title).toBe("Operator requested follow-up goal")
        expect(added.plan_version_id).toBe(planID)
        expect(added.depends_on).toEqual([goalID])
        expect(added.order_index).toBe(1)
        expect(added.acceptance_specs[0]?.goal_id).toBe(added.id)

        const planNodes = Database.use((db) =>
          db
            .select()
            .from(EnginePlanNodeTable)
            .where(eq(EnginePlanNodeTable.plan_version_id, planID))
            .orderBy(EnginePlanNodeTable.order_index)
            .all(),
        )
        expect(planNodes).toHaveLength(2)
        expect(planNodes[1]?.goal_id).toBe(added.id)
        expect(planNodes[1]?.depends_on_ids).toEqual([planNodeID])

        const plan = findActivePlanForTask(taskID)
        expect(plan?.summary).toBe("2 goals")
        const decisions = createDecisionLog(taskID).readByPhase("orchestrator")
        expect(decisions.some((entry) => entry.key === `added_goal_${added.id}`)).toBe(true)
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
        const runID = await createAbortableCoordinatorRun({ taskID, sessionID: child.id, now })
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
            tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
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

        const result = toolText(
          await tools.cancel_subagent.execute(
            {
              goal_run_id: goalRunID,
              mode: "recover_stale",
              reason: "operator note arrived after the build session stopped producing events",
            },
            buildToolOptions("cancel_subagent"),
          ),
        )

        expect(toolText(result)).toContain(`Recovered stale live-owned build ${child.id}`)
        expect(toolText(result)).toContain(`ownership=${ownershipPayload.ownership_id}`)
        expect(toolText(result)).toContain(`goal_run ${goalRunID} aborted`)
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

        const result = toolText(
          await tools.cancel_subagent.execute(
            {
              goal_id: goalID,
              mode: "recover_stale",
              reason: "should not abort an active stream",
            },
            buildToolOptions("recover_streaming_build"),
          ),
        )

        expect(toolText(result)).toContain("refused stale recovery because build session")
        expect(toolText(result)).toContain("streaming")
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

        const result = toolText(
          await tools.cancel_subagent.execute(
            {
              session_id: child.id,
              mode: "recover_stale",
              reason: "there is no live ownership to recover",
            },
            buildToolOptions("recover_no_owner"),
          ),
        )

        expect(toolText(result)).toContain("No live build ownership found")
        expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(0)
      },
    })
  })

  test("read_context schema requires an explicit narrow scope", async () => {
    const { tools } = createOrchestratorTools({
      taskID: "tsk_read_context_schema",
      agentSessionID: "ses_read_context_schema",
      signal: new AbortController().signal,
    })
    const schema = tools.read_context.inputSchema as unknown as z.ZodTypeAny

    expect(schema.safeParse({}).success).toBe(false)
    expect(schema.safeParse({ scope: "all" }).success).toBe(false)
    expect(schema.safeParse({ scope: "goals" }).success).toBe(false)
    expect(schema.safeParse({ scope: "evaluations" }).success).toBe(false)
    expect(schema.safeParse({ scope: "deliveries" }).success).toBe(false)
    expect(schema.safeParse({ scope: "research" }).success).toBe(false)
    expect(schema.safeParse({ scope: "decisions" }).success).toBe(true)
    expect(schema.safeParse({ scope: "integrity_history" }).success).toBe(true)
    expect(schema.safeParse({ scope: "fact_checks" }).success).toBe(true)
  })

  test("read_context drilldown scopes bound persisted audit context while preserving pointers", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_read_context_budget_${stamp}`
    const taskID = `tsk_read_context_budget_${stamp}`
    const goalID = `gol_read_context_budget_${stamp}`
    const specID = `spec_read_context_budget_${stamp}`
    const giantReportEnd = `GIANT_INTEGRITY_REPORT_END_${stamp}`
    const giantDecisionEnd = `GIANT_DECISION_CONTEXT_END_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "read context budget",
      taskTitle: "read context budget",
      request: "Keep read_context under its output budget",
      goalTitle: "Read context budget goal",
      goalSlug: "read-context-budget-goal",
      objective: "Expose bounded read_context state without large raw artifacts",
      now,
      specID,
      requirementIDs: ["REQ-BUDGET"],
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "read context budget parent" })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )

        const integrityArtifactID = recordIntegrityAttempt({
          taskID,
          sessionID: `ses_integrity_budget_${stamp}`,
          lineage: activeOnlyLineage(taskID, specID),
          verdict: "needs_correction",
          phase: "post_build",
          reviewers: [{ reviewerID: "rev_budget", scope: "Read context budget", verdict: "needs_correction" }],
          findings: [
            integrityFinding({
              id: `finding_read_context_budget_${stamp}`,
              description: "read_context must not inline full integrity reports.",
              repair: "Render a bounded excerpt and point at the integrity artifact.",
              filePaths: ["src/index.ts"],
              requirementIDs: ["REQ-BUDGET"],
              reviewers: ["rev_budget"],
            }),
          ],
          teamReportMarkdown: `GIANT_INTEGRITY_REPORT_START_${stamp}\n${"integrity report body ".repeat(5_000)}\n${giantReportEnd}`,
          now: now + 1,
        })

        createDecisionLog(taskID).append({
          phase: "architect",
          key: `read_context_drilldown_${stamp}`,
          value:
            `GIANT_DECISION_CONTEXT_START_${stamp}\n` + `${"decision context body ".repeat(100)}\n` + giantDecisionEnd,
          reason: "Decision drilldown remains available while ordinary task state stays in the task snapshot.",
        })
        recordFactCheckAttempt({
          taskID,
          factCheckSessionID: `ses_fact_check_budget_${stamp}`,
          targetSessionID: `ses_target_budget_${stamp}`,
          targetAgent: "build",
          targetMessageID: `msg_target_budget_${stamp}`,
          targetMessageContentHash: `hash_budget_${stamp}`,
          invokedByOrchestratorSessionID: parent.id,
          report: {
            scope: {
              target_session_id: `ses_target_budget_${stamp}`,
              target_agent: "build",
              target_message_id: `msg_target_budget_${stamp}`,
              target_message_content_hash: `hash_budget_${stamp}`,
              items_total: 3,
              items_inspected: 3,
            },
            verified: [
              {
                claim: "The build changed bounded context handling.",
                evidence: "Diff and tests show explicit scope handling.",
              },
            ],
            corrected: [],
            unresolved: [],
            overall_verdict: "clean",
          },
          timeStarted: now + 2,
          now: now + 3,
          outcome: "completed",
        })

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const integrity = toolText(
          await tools.read_context.execute({ scope: "integrity_history" }, buildToolOptions("read_context")),
        )
        expect(integrity.length).toBeLessThanOrEqual(READ_CONTEXT_OUTPUT_CHAR_BUDGET)
        expect(integrity).toContain(integrityArtifactID)
        expect(integrity).toContain("GIANT_INTEGRITY_REPORT_START")
        expect(integrity).toContain("read_context omitted")
        expect(integrity).not.toContain(giantReportEnd)

        const decisions = toolText(
          await tools.read_context.execute({ scope: "decisions" }, buildToolOptions("read_context")),
        )
        expect(decisions.length).toBeLessThanOrEqual(READ_CONTEXT_OUTPUT_CHAR_BUDGET)
        expect(decisions).toContain(`read_context_drilldown_${stamp}`)
        expect(decisions).toContain("GIANT_DECISION_CONTEXT_START")
        expect(decisions).toContain("task-scoped decision-log bundle")
        expect(decisions).not.toContain(giantDecisionEnd)

        const factChecks = toolText(
          await tools.read_context.execute({ scope: "fact_checks" }, buildToolOptions("read_context")),
        )
        expect(factChecks.length).toBeLessThanOrEqual(READ_CONTEXT_OUTPUT_CHAR_BUDGET)
        expect(factChecks).toContain("## Fact-check attempts")
        expect(factChecks).toContain("[clean]")
        expect(factChecks).toContain("target=`build`")
        expect(factChecks).toContain(`session=\`ses_target_budge`)
        expect(factChecks).toContain("verified=1 corrected=0 unresolved=0")
        expect(factChecks).toContain("(completed)")
      },
    })
  })

  test("task-level direct build creates a run without exposing deliver", async () => {
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
          request: "Apply a direct edit and verify it through acceptance.",
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
        expect(toolText(buildResult)).toContain("Build agent finished")

        const run = findActiveRunForTask(taskID)
        expect(run).toBeDefined()
        expect(run?.plan_version_id).toBeNull()

        expect("deliver" in tools).toBe(false)
        expect("publish_acceptance" in tools).toBe(false)
        expect(findRun(run!.id)?.phase).not.toBe("deliver")
        expect(findAcceptanceByRun(run!.id)).toBeUndefined()
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
    const goalID = `gol_integrity_completed_${stamp}`
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
        expectGoalBuildStarted(buildResult)
        await waitForGoalStatus(goalID, "passed")

        const run = findActiveRunForTask(taskID)
        expect(run).toBeDefined()

        insertArchitectContractGraphArtifact({ taskID, now: now + 1 })
        const integrityResult = await tools.integrity.execute(
          { reason: "Goal build finished and post-build integrity should complete the task." },
          buildToolOptions(),
        )

        const integrityText = toolText(integrityResult)
        expect(integrityText).toContain("Integrity verdict: pass")
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
        expect(integrityText).toContain("findings=1")
        expect(integrityText).toContain("REQ-1 evidence is acceptable but should be strengthened next time.")
        expect(integrityText).toContain("task completed")
        const taskRow = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get(),
        )
        expect(taskRow?.session_id).toBe(parent.id)
        expect(taskRow?.time_completed).toBeNumber()
        expect(deriveTaskStatus(taskRow!)).toBe("completed")
        expect(findRun(run!.id)?.status).toBe("completed")
        expect(findAcceptanceByRun(run!.id)).toBeUndefined()
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

        expect("publish_acceptance" in tools).toBe(false)
        const taskAfterPublishAttempt = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get(),
        )
        expect(deriveTaskStatus(taskAfterPublishAttempt!)).toBe("completed")

        expect(taskAfterPublishAttempt?.session_id).toBe(parent.id)
        expect(taskAfterPublishAttempt?.time_completed).toBeNumber()
        expect(deriveTaskStatus(taskAfterPublishAttempt!)).toBe("completed")
        expect(findRun(run!.id)?.status).toBe("completed")
        expect(findAcceptanceByRun(run!.id)).toBeUndefined()
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
    const goalID = `gol_integrity_blocked_${stamp}`
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
        expectGoalBuildStarted(buildResult)
        await waitForGoalStatus(goalID, "passed")

        const run = findActiveRunForTask(taskID)
        expect(run).toBeDefined()

        insertArchitectContractGraphArtifact({ taskID, now: now + 1 })
        const integrityResult = await tools.integrity.execute(
          { reason: "Goal build finished and post-build integrity should block the run." },
          buildToolOptions(),
        )

        expect(toolText(integrityResult)).toContain("Integrity verdict: needs_correction")
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

        expect(toolText(result)).toContain("rejected task-level workflow build")
        expect(toolText(result)).toContain("directBuildIntent is required")
        expect(toolText(result)).toContain('directBuildIntent="modify_files"')
        expect(toolText(result)).not.toContain(["inspect", "only"].join("_"))
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

        expect(toolText(result)).toContain("rejected task-level build")
        expect(toolText(result)).toContain(`directBuildIntent="${retiredIntent}" is not supported`)
        expect(toolText(result)).toContain("build is implementation-only")
        expect(toolText(result)).toContain(
          "Repository investigation belongs to analyze_intent, requirements, or explore",
        )
        const run = findActiveRunForTask(taskID)
        expect(run).toBeUndefined()
      },
    })
  })

  test("propose_task can create a follow-up while the parent task is still active", async () => {
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

    await fs.writeFile(path.join(tmp.path, "opencorvus.json"), JSON.stringify({ model: "test/model" }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "propose task parent" })
        Database.use((db) =>
          db
            .update(EngineTaskTable)
            .set({ session_id: parent.id, time_updated: Date.now() })
            .where(eq(EngineTaskTable.id, taskID))
            .run(),
        )
        const pipeline = WorkflowRegistry.resolveSync("pipeline")!
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          workflow: pipeline,
          workflowState: createWorkflowState(pipeline),
        })

        const result = await tools.propose_task.execute(
          {
            title: "Harden generated component tests",
            request: "Add focused tests for the component generated by the parent task.",
            reason: "This is a separate quality-hardening follow-up after the current request.",
            priority: "high",
            kind: "workflow",
          },
          buildToolOptions(),
        )

        const text = toolText(result)
        expect(text).toContain("Follow-up task created automatically")
        expect(text).toContain("tsk_created_followup")
        expect(await Question.list()).toHaveLength(0)
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

    await fs.writeFile(path.join(tmp.path, "opencorvus.json"), JSON.stringify({ model: "test/model" }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "completed propose task parent" })
        Database.use((db) =>
          db
            .update(EngineTaskTable)
            .set({ session_id: parent.id, time_updated: Date.now() })
            .where(eq(EngineTaskTable.id, taskID))
            .run(),
        )
        const pipeline = WorkflowRegistry.resolveSync("pipeline")!
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
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
        const text = toolText(result)
        const pending = await Question.list()

        expect(text).toContain("Follow-up task created automatically")
        expect(text).toContain("tsk_completed_followup")
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

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: "tsk_existing_completed_followup",
              project_id: projectID,
              session_id: null,
              source: "test",
              title: "Existing follow-up",
              request: "Existing follow-up task.",
              kind: "workflow",
              priority: "normal",
              metadata: { parent_task_id: taskID },
              time_created: now + 1,
              time_updated: now + 1,
            })
            .run(),
        )
        const secondResult = await tools.propose_task.execute(
          {
            title: "Third verification pass",
            request: "Try to create another child task.",
            reason: "This should be rejected because one inheriting child already exists.",
            priority: "normal",
            kind: "workflow",
          },
          buildToolOptions(),
        )
        const secondText = toolText(secondResult)
        expect(secondText).toContain(
          "Follow-up task was not created because this parent already has an inheriting child task",
        )
        expect(secondText).toContain("tsk_existing_completed_followup")
        expect(createSpy).toHaveBeenCalledTimes(1)
      },
    })
  })

  test("propose_task does not create a follow-up task when auto-confirm is disabled and the user declines", async () => {
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
          time_completed: now + 1,
        })
        .run()
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "decline proposed task parent" })
        Database.use((db) =>
          db
            .update(EngineTaskTable)
            .set({ session_id: parent.id, time_updated: Date.now() })
            .where(eq(EngineTaskTable.id, taskID))
            .run(),
        )
        spyOn(Config, "get").mockResolvedValue({ experimental: { auto_confirm_proposed_tasks: false } } as any)
        const pipeline = WorkflowRegistry.resolveSync("pipeline")!
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
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

        expect(toolText(result)).toContain("Follow-up task proposal was not created")
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
      projectName: "Visual reference project",
      taskTitle: "Visual reference task",
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
          summary: "Visual URL did not host-block the build.",
          files_changed: [],
          tests: [],
        },
        sessionID: "ses_visual_no_host_block_build",
        worktreeDir: input.managedWorktree.directory,
        worktreeBranch: input.managedWorktree.branch,
        worktreeBaseRef: input.managedWorktree.baseRef,
        diffs: [],
      }
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "visual reference test" })
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
        expectGoalBuildStarted(buildResult)
        await waitForGoalStatus(goalID, "passed")
      },
    })
  }, 30_000)

  test("frontend_design materializes frontend template and source manifest files", async () => {
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

    designAnalyzeImpl = async (input) => {
      await input.onSessionCreated?.("ses_frontend_design_mock")
      return {
        specs: [],
        designSystem: "Reference design system",
        techStack: ["React", "Bun"],
        frontendTemplate: "Frontend replica scope body",
        finalAcceptanceMode: "maintainable_replacement_required",
        fillableModules:
          "Frontend fillable modules body. Use web-clone-source/README.md, web-clone-source/implementation-blueprint.md, web-clone-source/source-ir/component-tree.json, web-clone-source/source-ir/content-model.json, web-clone-source/source-ir/style-profile.json, web-clone-source/source-skeleton/critical.css, and web-clone-source/reference.png as the development handoff; use raw webpage evidence only as diagnostics for named gaps.",
        componentInventory: "Component inventory body.",
        qualityProjectContract:
          "High-quality target project body. Build semantic React source from the source skeleton, component modules, data modules, style modules, CSS sidecars, and verification commands.",
        componentReusePlan: [
          {
            family_id: "comp-page-shell",
            name: "Page shell",
            observed_surface: "Reference page shell",
            source_refs: ["web-clone-source/reference.png"],
            implementation_strategy: "extracted_baseline_defer",
            reuse_source: "frontend-design-skeleton/src/components/SourceClonePage.tsx",
            mature_library_candidates: [],
            props_states: "static extracted baseline until parity-safe replacement",
            replacement_boundary: "page root subtree",
            parity_guard: "measured visual comparison against reference.png",
          },
        ],
        materialInventory: "Material inventory body.",
        frontendProject: {
          status: "created",
          role: "source_baseline_input",
          project_root: "C:\\tmp\\frontend-design-skeleton",
          source_package: "web-clone-source",
          entrypoints: ["README.md", "src/App.tsx", "src/styles.css"],
          generation_tool: "test",
          notes: [],
        },
        visualConsistencyContract:
          "Match reference layout, typography, colors, and spacing exactly. Verify desktop and wide viewports with measured visual comparison plus source-quality review.",
        uiDataContract:
          "UI data contract derived from source-skeleton table/list/control structure; unknown backend details remain unknown.",
        templateIterationNotes: ["First pass covered layout.", "Second pass covered visual consistency."],
        completenessReview: "Complete enough for downstream implementation.",
        referenceArtifacts: [
          "web-clone-source/README.md",
          "web-clone-source/implementation-blueprint.md",
          "web-clone-source/web-clone-context.md",
          "web-clone-source/web-clone-implementation-contract.json",
          "web-clone-source/source-ir/component-tree.json",
          "web-clone-source/source-ir/content-model.json",
          "web-clone-source/source-ir/layout-map.json",
          "web-clone-source/source-ir/style-profile.json",
          "web-clone-source/source-ir/style-tokens.json",
          "web-clone-source/source-ir/interaction-hints.json",
          "web-clone-source/source-skeleton/critical.css",
          "web-clone-source/visual-surface-candidates.json",
          "web-clone-source/reference.png",
          "webpage-evidence/reference.png",
          "webpage-evidence/page.ir.json",
          "webpage-evidence/assets/manifest.json",
          "webpage-evidence/segments.json",
          "webpage-evidence/codegen-context.json",
          "webpage-evidence/source-skeleton/",
          "webpage-evidence/source-skeleton/README.md",
          "webpage-evidence/source-skeleton/index.html",
          "webpage-evidence/source-skeleton/critical.css",
          "webpage-evidence/source-skeleton/full-source.css",
          "webpage-evidence/source-skeleton/used-selectors.json",
          "webpage-evidence/source-skeleton/skeleton-manifest.json",
          "webpage-evidence/source-skeleton/source-skeleton-audit.json",
          "webpage-evidence/source-ir/component-tree.json",
          "webpage-evidence/source-ir/content-model.json",
          "webpage-evidence/source-ir/layout-map.json",
          "webpage-evidence/source-ir/style-profile.json",
          "webpage-evidence/source-ir/style-tokens.json",
          "webpage-evidence/source-ir/interaction-hints.json",
          "webpage-evidence/source-ir/source-quality-audit.json",
        ],
        openQuestions: ["Live feed authentication is unknown."],
        report: {
          summary: "Frontend replica scope body",
          detail: [
            "## Frontend Template",
            "Frontend replica scope body",
            "",
            "## Final Acceptance Mode",
            "maintainable_replacement_required",
            "",
            "## Fillable Modules",
            "Frontend fillable modules body. Use web-clone-source/README.md, web-clone-source/implementation-blueprint.md, web-clone-source/source-ir/component-tree.json, web-clone-source/source-ir/content-model.json, web-clone-source/source-ir/style-profile.json, web-clone-source/source-skeleton/critical.css, and web-clone-source/reference.png as the development handoff; use raw webpage evidence only as diagnostics for named gaps.",
            "",
            "## Implementation Problems And Agent Handoff",
            "Complete enough for downstream implementation.",
            "",
            "## Reuse Constraints",
            "- comp-page-shell - Page shell",
            "  - strategy: extracted_baseline_defer",
            "  - parity_guard: measured visual comparison against reference.png",
            "",
            "## Source Region Evolution Plan",
            "- no source-region evolution plan submitted",
            "",
            "## Quality Project Contract",
            "High-quality target project body. Build semantic React source from the source skeleton, component modules, data modules, style modules, CSS sidecars, and verification commands.",
            "",
            "## Material Inventory",
            "Material inventory body.",
            "",
            "## Frontend Project",
            "- status: created",
            "- role: source_baseline_input",
            "- project_root: C:\\tmp\\frontend-design-skeleton",
            "- acceptance_root: .",
            "- source_package: web-clone-source",
            "- generation_tool: test",
            "- adoption_rule: frontend-design-skeleton is a source baseline excluded from final acceptance",
            "",
            "## Visual Consistency Contract",
            "Match reference layout, typography, colors, and spacing exactly. Verify desktop and wide viewports with measured visual comparison plus source-quality review.",
            "",
            "## UI Data Contract",
            "UI data contract derived from source-skeleton table/list/control structure; unknown backend details remain unknown.",
            "",
            "## Reference Artifacts",
            "- web-clone-source/implementation-blueprint.md",
            "- web-clone-source/source-skeleton/critical.css",
            "- web-clone-source/source-ir/component-tree.json",
            "- web-clone-source/source-ir/style-profile.json",
          ].join("\n"),
        },
        sessionID: "ses_frontend_design_mock",
      }
    }

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

        const result = await tools.frontend_design.execute(
          { reason: "visual replica requires source template" },
          {} as any,
        )
        expect(toolText(result)).toContain("frontend_template_file")
        expect(toolText(result)).toContain(".opencorvus")

        const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
        const templatePath = paths.templateAbsolute
        const manifestPath = paths.manifestAbsolute
        const template = await fs.readFile(templatePath, "utf8")
        const manifest = await fs.readFile(manifestPath, "utf8")
        expect(template).toContain("## Visual Consistency Contract")
        expect(template).toContain("## Implementation Problems And Agent Handoff")
        expect(template).not.toContain("## Component Inventory")
        expect(template).toContain("## Reuse Constraints")
        expect(template).toContain("## Quality Project Contract")
        expect(template).toContain("## Material Inventory")
        expect(template).toContain("High-quality target project body")
        expect(template).toContain("source skeleton")
        expect(template).toContain("role: source_baseline_input")
        expect(template).toContain("acceptance_root: .")
        expect(template).toContain("frontend-design-skeleton is a source baseline excluded from final acceptance")
        expect(template).toContain("Match reference layout, typography, colors, and spacing exactly.")
        expect(template).toContain(paths.manifestRelative)
        expect(template).toContain("web-clone-source/implementation-blueprint.md")
        expect(template).toContain("web-clone-source/source-skeleton/critical.css")
        expect(template).toContain("web-clone-source/source-ir/component-tree.json")
        expect(template).toContain("web-clone-source/source-ir/style-profile.json")
        expect(template).toContain("measured visual comparison")
        expect(manifest).toContain(`Canonical frontend_design public report file: ${paths.templateRelative}`)
        expect(manifest).toContain("design-reference.png")
        expect(manifest).toContain("webpage-evidence/reference.png")
        expect(manifest).toContain("webpage-evidence/page.ir.json")
        expect(manifest).toContain("webpage-evidence/assets/manifest.json")
        expect(manifest).toContain("webpage-evidence/segments.json")
        expect(manifest).toContain("webpage-evidence/codegen-context.json")
        expect(manifest).toContain("web-clone-source/implementation-blueprint.md")
        expect(manifest).toContain("web-clone-source/source-skeleton/critical.css")
        expect(manifest).toContain("web-clone-source/source-ir/content-model.json")
        expect(manifest).toContain("web-clone-source/source-ir/style-profile.json")
        expect(manifest).toContain("web-clone-source/reference.png")

        const stepSummaries = Database.use((db) =>
          db
            .select({ payload: ProtocolEventTable.payload })
            .from(ProtocolEventTable)
            .where(and(eq(ProtocolEventTable.task_id, taskID), eq(ProtocolEventTable.type, "workflow.step.updated")))
            .all()
            .map((event) => String(event.payload?.summary ?? "")),
        )
        expect(stepSummaries).toContain("frontend_design dispatch: input accepted")
        expect(stepSummaries).toContain("frontend_design dispatch: loading agent module")
        expect(stepSummaries).toContain("frontend_design dispatch: visual input ready; calling agent analyze")
        expect(stepSummaries).toContain("frontend_design dispatch: agent session created ses_frontend_design_mock")
        expect(stepSummaries).toContain("frontend_design dispatch: agent analyze returned")
      },
    })
  }, 60_000)

  test("post-build integrity reviews source-skeleton handoff diagnostics without host-blocking missing audit evidence", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_integrity_source_skeleton_diag_${stamp}`
    const taskID = `tsk_integrity_source_skeleton_diag_${stamp}`
    const goalID = `gol_integrity_source_skeleton_diag_${stamp}`
    const specID = `spec_${goalID}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "source skeleton integrity diagnostic test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Source skeleton integrity diagnostic project",
          taskTitle: "Source skeleton integrity diagnostic task",
          request: "Clone a web page from source skeleton artifacts",
          goalTitle: "Implement source skeleton",
          goalSlug: "implement-source-skeleton",
          objective: "Use source skeleton artifacts.",
          now,
          specID,
          requirementIDs: ["REQ-1"],
        })
        Database.use((db) => {
          insertRequirements(db, {
            taskID,
            specSnapshotID: specID,
            now,
            requirements: [
              {
                id: "REQ-1",
                title: "Source skeleton",
                description: "Implement from source skeleton.",
                acceptance: ["post-build integrity reviews source skeleton diagnostic evidence"],
                evidence_refs: ["frontend_design"],
                non_goals: [],
                priority: "blocking",
              },
            ],
          })
          db.update(EngineGoalTable)
            .set({
              acceptance_specs: [
                {
                  id: "acc-source-skeleton",
                  source_requirement_id: "REQ-1",
                  goal_id: goalID,
                  title: "post-build integrity reviews source skeleton diagnostic evidence",
                  scorers: [
                    { type: "llm_judge", name: "diagnostic review", criteria: "Review source skeleton artifacts." },
                  ],
                  severity: "essential",
                },
              ],
              requirement_ids: ["REQ-1"],
            })
            .where(eq(EngineGoalTable.id, goalID))
            .run()
        })
        const runID = beginBuildAttempt({
          taskID,
          goalID,
          sessionID: parent.id,
          workspaceDir: tmp.path,
          workspaceBranch: "opencorvus/source-skeleton-diagnostic",
          workspaceBaseRef: null,
          now: now + 1,
        })
        updateGoalRun(runID, { status: "completed", time_completed: now + 2 })
        computeRequirementStatusSnapshotImpl = () => [
          {
            requirementID: "REQ-1",
            title: "Source skeleton",
            status: "claimed",
            claimingGoals: [{ goalID, runStatus: "completed" }],
          },
        ]
        createDecisionLog(taskID).append({
          phase: "frontend_design",
          key: "reference_artifacts",
          value:
            "web-clone-source/reference.png\n" +
            "web-clone-source/source-skeleton/README.md\n" +
            "web-clone-source/source-skeleton/index.html\n" +
            "web-clone-source/source-skeleton/critical.css\n" +
            "web-clone-source/source-skeleton/source-skeleton-audit.json\n" +
            "web-clone-source/source-ir/component-tree.json\n" +
            "web-clone-source/source-ir/style-profile.json\n" +
            "web-clone-source/source-ir/source-quality-audit.json",
          reason: "web_clone_source_skeleton",
        })

        let reviewCalled = false
        reviewIntegrityImpl = async () => {
          reviewCalled = true
          return integrityTeamResult({ sessionID: "ses_source_skeleton_diagnostic" })
        }
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.integrity.execute(
          { reason: "post-build review" },
          buildToolOptions("integrity_review"),
        )

        const resultText = toolText(result)
        expect(resultText).toContain("Integrity verdict: pass")
        expect(resultText).not.toContain("invalid web-clone-source/reference.png")
        expect(reviewCalled).toBe(true)
      },
    })
  })

  test("post-build integrity reviews source-skeleton implementation without host-blocking missing consumption audit", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_integrity_source_consumption_diag_${stamp}`
    const taskID = `tsk_integrity_source_consumption_diag_${stamp}`
    const goalID = `gol_integrity_source_consumption_diag_${stamp}`
    const specID = `spec_${goalID}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await writePassingSourceSkeletonHandoff(tmp.path)
        const parent = await Session.create({ kind: "root", title: "source skeleton consumption diagnostic test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Source skeleton consumption diagnostic project",
          taskTitle: "Source skeleton consumption diagnostic task",
          request: "Clone a web page from source skeleton artifacts",
          goalTitle: "Implement source skeleton app",
          goalSlug: "implement-source-skeleton-app",
          objective: "Implement normal React/Vue source from source skeleton artifacts.",
          now,
          specID,
          requirementIDs: ["REQ-1"],
        })
        Database.use((db) => {
          insertRequirements(db, {
            taskID,
            specSnapshotID: specID,
            now,
            requirements: [
              {
                id: "REQ-1",
                title: "Source skeleton implementation",
                description: "Implement from source skeleton and expose implementation evidence for reviewer analysis.",
                acceptance: ["post-build integrity reviews source skeleton consumption evidence"],
                evidence_refs: ["frontend_design"],
                non_goals: [],
                priority: "blocking",
              },
            ],
          })
          db.update(EngineGoalTable)
            .set({
              acceptance_specs: [
                {
                  id: "acc-source-skeleton-consumption",
                  source_requirement_id: "REQ-1",
                  goal_id: goalID,
                  title: "post-build integrity reviews source skeleton consumption evidence",
                  scorers: [
                    {
                      type: "llm_judge",
                      name: "diagnostic review",
                      criteria: "Review source skeleton consumption evidence.",
                    },
                  ],
                  severity: "essential",
                },
              ],
              requirement_ids: ["REQ-1"],
            })
            .where(eq(EngineGoalTable.id, goalID))
            .run()
        })
        const runID = beginBuildAttempt({
          taskID,
          goalID,
          sessionID: parent.id,
          workspaceDir: tmp.path,
          workspaceBranch: "opencorvus/source-skeleton-consumption-diagnostic",
          workspaceBaseRef: null,
          now: now + 1,
        })
        updateGoalRun(runID, { status: "completed", time_completed: now + 2 })
        computeRequirementStatusSnapshotImpl = () => [
          {
            requirementID: "REQ-1",
            title: "Source skeleton implementation",
            status: "claimed",
            claimingGoals: [{ goalID, runStatus: "completed" }],
          },
        ]
        createDecisionLog(taskID).append({
          phase: "frontend_design",
          key: "reference_artifacts",
          value:
            "webpage-evidence/reference.png\n" +
            "webpage-evidence/source-skeleton/README.md\n" +
            "webpage-evidence/source-skeleton/index.html\n" +
            "webpage-evidence/source-skeleton/styles.css\n" +
            "webpage-evidence/source-skeleton/critical.css\n" +
            "webpage-evidence/source-skeleton/full-source.css\n" +
            "webpage-evidence/source-skeleton/used-selectors.json\n" +
            "webpage-evidence/source-skeleton/source-skeleton-audit.json\n" +
            "webpage-evidence/source-ir/component-tree.json\n" +
            "webpage-evidence/source-ir/content-model.json\n" +
            "webpage-evidence/source-ir/layout-map.json\n" +
            "webpage-evidence/source-ir/style-profile.json\n" +
            "webpage-evidence/source-ir/style-tokens.json\n" +
            "webpage-evidence/source-ir/interaction-hints.json\n" +
            "webpage-evidence/source-ir/source-quality-audit.json",
          reason: "web_clone_source_skeleton",
        })

        let reviewCalled = false
        reviewIntegrityImpl = async () => {
          reviewCalled = true
          return integrityTeamResult({ sessionID: "ses_source_skeleton_consumption_diagnostic" })
        }
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.integrity.execute(
          { reason: "post-build review" },
          buildToolOptions("integrity_review"),
        )

        const resultText = toolText(result)
        expect(resultText).toContain("Integrity verdict: pass")
        expect(resultText).not.toContain("missing web-clone-source-skeleton-consumption-audit.json")
        expect(reviewCalled).toBe(true)
      },
    })
  })

  test("post-build integrity treats web-clone-source package as reviewer evidence without host-blocking", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_integrity_visible_source_diag_${stamp}`
    const taskID = `tsk_integrity_visible_source_diag_${stamp}`
    const goalID = `gol_integrity_visible_source_diag_${stamp}`
    const specID = `spec_${goalID}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await writePassingSourceSkeletonHandoff(tmp.path)
        const parent = await Session.create({ kind: "root", title: "visible source diagnostic test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Visible source diagnostic project",
          taskTitle: "Visible source diagnostic task",
          request: "Clone a web page from prepared web-clone-source artifacts",
          goalTitle: "Implement source skeleton app",
          goalSlug: "implement-source-skeleton-app",
          objective: "Implement normal React/Vue source from source skeleton artifacts.",
          now,
          specID,
          requirementIDs: ["REQ-1"],
        })
        Database.use((db) => {
          insertRequirements(db, {
            taskID,
            specSnapshotID: specID,
            now,
            requirements: [
              {
                id: "REQ-1",
                title: "Source skeleton implementation",
                description: "Implement from web-clone-source artifacts.",
                acceptance: ["post-build integrity reviews visible source package evidence"],
                evidence_refs: [],
                non_goals: [],
                priority: "blocking",
              },
            ],
          })
        })
        const runID = beginBuildAttempt({
          taskID,
          goalID,
          sessionID: parent.id,
          workspaceDir: tmp.path,
          workspaceBranch: "opencorvus/visible-source-diagnostic",
          workspaceBaseRef: null,
          now: now + 1,
        })
        updateGoalRun(runID, { status: "completed", time_completed: now + 2 })
        computeRequirementStatusSnapshotImpl = () => [
          {
            requirementID: "REQ-1",
            title: "Source skeleton implementation",
            status: "claimed",
            claimingGoals: [{ goalID, runStatus: "completed" }],
          },
        ]

        let reviewCalled = false
        reviewIntegrityImpl = async () => {
          reviewCalled = true
          return integrityTeamResult({ sessionID: "ses_visible_source_diagnostic" })
        }
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.integrity.execute(
          { reason: "post-build review" },
          buildToolOptions("integrity_review"),
        )

        const resultText = toolText(result)
        expect(resultText).toContain("Integrity verdict: pass")
        expect(resultText).not.toContain("missing web-clone-source-skeleton-consumption-audit.json")
        expect(reviewCalled).toBe(true)
      },
    })
  })

  test("frontend_design exposes materialization failure details", async () => {
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
          tools.frontend_design.execute(
            { reason: "material should be inspected", materials: [missingMaterial] },
            {} as any,
          ),
        ).rejects.toThrow(missingMaterial)

        const entry = createDecisionLog(taskID).readByKey("abort_materialization_failed")
        expect(entry?.value).toContain(missingMaterial)
        expect(entry?.value).toContain("Materialization errors")
        const stepEvents = Database.use((db) =>
          db
            .select({ payload: ProtocolEventTable.payload })
            .from(ProtocolEventTable)
            .where(and(eq(ProtocolEventTable.task_id, taskID), eq(ProtocolEventTable.type, "workflow.step.updated")))
            .all(),
        )
        expect(
          stepEvents.some((event) => event.payload?.stepID === "frontend_design" && event.payload?.status === "failed"),
        ).toBe(true)
      },
    })
  })

  test("frontend_design materializes Figma references through MCP before analysis", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_figma_mcp_${stamp}`
    const goalID = `gol_figma_mcp_${stamp}`
    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const workflowState = createWorkflowState(pipeline)
    const figmaUrl = "https://www.figma.com/design/fileKey/Product?node-id=1963-5219&m=dev"

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
        frontendTemplate: "Frontend replica scope from Figma MCP evidence",
        finalAcceptanceMode: "maintainable_replacement_required",
        fillableModules: "Frontend fillable modules from Figma MCP evidence",
        componentInventory: "Figma component inventory.",
        qualityProjectContract:
          "High-quality Figma target project: readable semantic React components, project-owned styles, asset references, and screenshot verification.",
        componentReusePlan: [
          {
            family_id: "comp-figma-window",
            name: "Figma window",
            observed_surface: "Figma MCP screenshot window",
            source_refs: ["figma-mcp screenshot"],
            implementation_strategy: "existing_project_component",
            reuse_source: "src/components/window",
            mature_library_candidates: [],
            props_states: "window title, content slots, focus state",
            replacement_boundary: "window component subtree",
            parity_guard: "match Figma MCP screenshot",
          },
        ],
        materialInventory: "Figma material inventory.",
        frontendProject: {
          status: "not_created",
          role: "source_baseline_input",
          project_root: "",
          source_package: "",
          entrypoints: [],
          generation_tool: "",
          notes: [],
        },
        visualConsistencyContract: "Match the Figma MCP screenshot and metadata.",
        uiDataContract: "Mock API only; unknown backend details remain unknown.",
        templateIterationNotes: ["Checked Figma node inventory.", "Checked implementability from MCP metadata."],
        completenessReview: "Figma MCP evidence is complete enough for handoff.",
        referenceArtifacts: ["figma-mcp screenshot", "figma-mcp metadata"],
        openQuestions: [],
        report: {
          summary: "Frontend replica scope from Figma MCP evidence",
          detail: [
            "## Frontend Template",
            "Frontend replica scope from Figma MCP evidence",
            "",
            "## Implementation Problems And Agent Handoff",
            "Figma MCP evidence is complete enough for handoff.",
            "",
            "## Reuse Constraints",
            "- comp-figma-window - Figma window",
            "",
            "## Quality Project Contract",
            "High-quality Figma target project: readable semantic React components, project-owned styles, asset references, and screenshot verification.",
            "",
            "## Visual Consistency Contract",
            "Match the Figma MCP screenshot and metadata.",
          ].join("\n"),
        },
        sessionID: "ses_frontend_design_figma_mcp_mock",
      }
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "figma mcp test" })
        const current = Instance.current()
        if (!current) throw new Error("Expected current instance while seeding Figma MCP task")
        insertWorkflowTaskWithGoal({
          projectID: current.project.id,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Figma MCP project",
          taskTitle: "Figma MCP task",
          request: `复刻 ${figmaUrl}`,
          goalTitle: "Implement Figma window",
          goalSlug: "implement-figma-window",
          objective: "Implement the Figma window",
          now,
          insertProject: false,
        })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
          workflow: pipeline,
          workflowState,
        })

        const result = await tools.frontend_design.execute(
          {
            reason: "Figma MCP visual reference requires frontend template",
            figma_url: figmaUrl,
          },
          buildToolOptions(),
        )
        expect(toolText(result)).toContain("SUCCESS")
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
    expect(goalStatusByID(parentGoalID)).toBe("passed")

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

        const resultText = toolText(result)
        expect(resultText).toContain("blocked by unfinished dependencies")
        expect(resultText).toContain(`${parentGoalID}=needs_redispatch(architecture_review_rework; status=passed)`)
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

        expect(toolText(result)).toContain("no active requirements spec snapshot")
        expect(toolText(result)).toContain("requirements")
        const architectSessions = Database.use((db) =>
          db.select().from(SessionTable).where(eq(SessionTable.kind, "architect")).all(),
        )
        expect(architectSessions).toHaveLength(0)
      },
    })
  })

  test("architect terminal finalizer miss returns a same-session continuation artifact", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_architect_continuation_${stamp}`
    const taskID = `tsk_architect_continuation_${stamp}`
    const reqSpecID = `spec_architect_continuation_${stamp}`
    const failedSessionID = `ses_architect_finalizer_miss_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "Architect continuation test",
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
          title: "Architect continuation task",
          request: "Decompose a task after finalizer miss.",
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

    let continuationArtifactID = ""
    let coordinateCalls = 0
    architectCoordinateImpl = async (input: any) => {
      coordinateCalls += 1
      if (coordinateCalls === 1) {
        await input.onSessionCreated?.(failedSessionID)
        throw new AgentRunError("architect", "missing terminal submit_architect", {
          nonRetryable: true,
          cause: new Message.TerminalToolMissingError({
            message: "Architect ended without submit_architect.",
            toolName: "submit_architect",
            retries: 0,
          }),
        })
      }
      expect(input.continuation).toMatchObject({
        sessionID: failedSessionID,
        artifactID: continuationArtifactID,
        kind: "protocol-finalizer-miss",
        finalizerName: "submit_architect",
      })
      return {
        summary: "Recovered architecture.",
        goals: [
          {
            id: "goal_recovered_app_shell",
            title: "Recovered app shell",
            objective: "Implement a typed app shell after continuing the prior architect session.",
            acceptance_specs: [
              {
                id: "acc-recovered-app-shell",
                source_requirement_id: "REQ-1",
                goal_id: "goal_recovered_app_shell",
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
        traceability: [{ requirementID: "REQ-1", goalIDs: ["goal_recovered_app_shell"] }],
        fidelity: { sourceCoverage: [], referenceCoverage: [], assemblyOwners: [] },
        contractGraph: { version: 1, contracts: [], dependency_contracts: [] },
        validationFindings: [],
      }
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "architect continuation test" })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const first = await tools.architect.execute({ reason: "initial decomposition" }, buildToolOptions())
        const firstText = toolText(first)
        expect(firstText).toContain("same-session continuation is ready")
        const match = firstText.match(/continuation_artifact_id[^\n]*?(art_[A-Za-z0-9]+)/)
        expect(match?.[1]).toBeTruthy()
        continuationArtifactID = match![1]

        const continuation = findStageContinuationRequest({ taskID, artifactID: continuationArtifactID })
        expect(continuation?.payload.session_id).toBe(failedSessionID)
        expect(continuation?.payload.stage).toBe("architect")
        expect(continuation?.payload.finalizer_name).toBe("submit_architect")

        const second = await tools.architect.execute(
          { reason: "continue previous architect finalizer miss", continuation_artifact_id: continuationArtifactID },
          buildToolOptions(),
        )
        expect(toolText(second)).toContain("Architect decomposition complete")
        expect(coordinateCalls).toBe(2)
      },
    })
  })

  test("architect continuation ignores unrendered unflagged workload brief changes", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_architect_workload_unflagged_${stamp}`
    const goalID = `goal_architect_workload_unflagged_${stamp}`
    const specID = `spec_architect_workload_unflagged_${stamp}`
    const failedSessionID = `ses_architect_workload_unflagged_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "architect workload unflagged parent" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Architect workload unflagged project",
          taskTitle: "Architect workload unflagged task",
          request: "Refine a goal graph with unflagged workload notes.",
          goalTitle: "Unflagged workload goal",
          goalSlug: "unflagged-workload-goal",
          objective: "Implement the unflagged workload goal contract.",
          now,
          specID,
          requirementIDs: ["REQ-architect"],
          insertProject: false,
        })
        const brief = {
          goal_id: goalID,
          decomposition_concern: "",
          why_not_smaller: ["original unrendered note"],
          underestimation_traps: ["original trap"],
          execution_inventory: {
            surfaces: 1,
            states: 1,
            data_contracts: 1,
            verification_points: 1,
          },
          verification_inventory: ["run typecheck"],
          references: {
            contract_ids: [],
            reference_coverage_ids: [],
            acceptance_spec_ids: [],
            visual_spec_ids: [],
            prd_sections: [],
          },
        }
        Database.use((db) => {
          db.insert(EngineArtifactTable)
            .values({
              id: `art_workload_original_${stamp}`,
              task_id: taskID,
              run_id: null,
              goal_run_id: null,
              acceptance_id: null,
              kind: "goal_workload",
              label: "active",
              payload: {
                spec_snapshot_id: specID,
                summary: "No goals flagged.",
                briefs: [brief],
              },
              time_created: now,
              time_updated: now,
            })
            .run()
        })

        let continuationArtifactID = ""
        let calls = 0
        architectCoordinateImpl = async (input: any) => {
          calls += 1
          if (calls === 1) {
            input.onSessionCreated?.(failedSessionID)
            throw new AgentRunError("architect", "missing terminal submit_architect", {
              nonRetryable: true,
              cause: new Message.TerminalToolMissingError({
                message: "Architect ended without submit_architect.",
                toolName: "submit_architect",
                retries: 0,
              }),
            })
          }
          expect(input.continuation).toMatchObject({
            sessionID: failedSessionID,
            artifactID: continuationArtifactID,
            kind: "protocol-finalizer-miss",
            finalizerName: "submit_architect",
          })
          return minimalArchitectResult(`goal_recovered_workload_${stamp}`)
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const first = await tools.architect.execute({ reason: "refine graph" }, buildToolOptions("architect_workload"))
        const match = toolText(first).match(/continuation_artifact_id[^\n]*?(art_[A-Za-z0-9]+)/)
        expect(match?.[1]).toBeTruthy()
        continuationArtifactID = match![1]

        Database.use((db) => {
          db.insert(EngineArtifactTable)
            .values({
              id: `art_workload_changed_${stamp}`,
              task_id: taskID,
              run_id: null,
              goal_run_id: null,
              acceptance_id: null,
              kind: "goal_workload",
              label: "active",
              payload: {
                spec_snapshot_id: specID,
                summary: "No goals flagged; unrendered notes changed.",
                briefs: [{ ...brief, why_not_smaller: ["changed unrendered note"] }],
              },
              time_created: now + 1,
              time_updated: now + 1,
            })
            .run()
        })

        const second = await tools.architect.execute(
          {
            reason: "continue previous architect finalizer miss",
            continuation_artifact_id: continuationArtifactID,
          },
          buildToolOptions("architect_workload"),
        )
        expect(toolText(second)).toContain("Architect decomposition complete")
        expect(toolText(second)).not.toContain("scope_mismatch")
        expect(calls).toBe(2)
      },
    })
  })

  test("architect continuation rejects stale active spec scope before resuming worker", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_architect_stale_scope_${stamp}`
    const taskID = `tsk_architect_stale_scope_${stamp}`
    const reqSpecID = `spec_architect_stale_scope_${stamp}`
    const nextSpecID = `spec_architect_stale_scope_next_${stamp}`
    const failedSessionID = `ses_architect_stale_scope_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: process.cwd(),
          name: "Architect stale continuation test",
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
          title: "Architect stale continuation task",
          request: "Decompose a task after finalizer miss, then change the active spec.",
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
          content: "# Requirements\n- REQ-1 original scope",
          scope: "original scope",
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
            title: "Original scope",
            description: "The original active spec is in force.",
            acceptance: ["original spec accepted"],
            evidence_refs: ["user request"],
            non_goals: ["No changed scope."],
            priority: "blocking",
          },
        ],
      })
    })

    let continuationArtifactID = ""
    let coordinateCalls = 0
    architectCoordinateImpl = async (input: any) => {
      coordinateCalls += 1
      await input.onSessionCreated?.(failedSessionID)
      throw new AgentRunError("architect", "missing terminal submit_architect", {
        nonRetryable: true,
        cause: new Message.TerminalToolMissingError({
          message: "Architect ended without submit_architect.",
          toolName: "submit_architect",
          retries: 0,
        }),
      })
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "architect stale continuation test" })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const first = await tools.architect.execute({ reason: "initial decomposition" }, buildToolOptions())
        const match = toolText(first).match(/continuation_artifact_id[^\n]*?(art_[A-Za-z0-9]+)/)
        expect(match?.[1]).toBeTruthy()
        continuationArtifactID = match![1]

        Database.use((db) => {
          db.update(EngineSpecSnapshotTable)
            .set({ status: "superseded", time_updated: now + 1 })
            .where(eq(EngineSpecSnapshotTable.id, reqSpecID))
            .run()
          db.insert(EngineSpecSnapshotTable)
            .values({
              id: nextSpecID,
              task_id: taskID,
              version: 2,
              status: "ready",
              summary: "Requirements changed",
              content: "# Requirements\n- REQ-1 changed scope",
              scope: "changed scope",
              time_created: now + 1,
              time_updated: now + 1,
            })
            .run()
        })

        const staleResult = await tools.architect.execute(
          { reason: "continue previous architect finalizer miss", continuation_artifact_id: continuationArtifactID },
          buildToolOptions(),
        )
        expect(toolText(staleResult)).toContain("continuation artifact scope is stale")
        expect(toolText(staleResult)).toContain("scope_mismatch")
        expect(toolText(staleResult)).toContain("start a fresh architect")
        expect(coordinateCalls).toBe(1)
      },
    })
  })

  test("architect continuation rejects stale existing goal graph before resuming worker", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_architect_stale_goals_${stamp}`
    const goalID = `goal_architect_stale_goals_${stamp}`
    const specID = `spec_architect_stale_goals_${stamp}`
    const failedSessionID = `ses_architect_stale_goals_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "architect stale goal graph parent" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Architect stale goal graph project",
          taskTitle: "Architect stale goal graph task",
          request: "Refine the existing goal graph.",
          goalTitle: "Original goal",
          goalSlug: "original-goal",
          objective: "Implement the original goal contract.",
          now,
          specID,
          requirementIDs: ["REQ-architect"],
          insertProject: false,
        })

        let continuationArtifactID = ""
        let calls = 0
        architectCoordinateImpl = async (input: any) => {
          calls += 1
          input.onSessionCreated?.(failedSessionID)
          throw new AgentRunError("architect", "missing terminal submit_architect", {
            nonRetryable: true,
            cause: new Message.TerminalToolMissingError({
              message: "Architect ended without submit_architect.",
              toolName: "submit_architect",
              retries: 0,
            }),
          })
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const first = await tools.architect.execute({ reason: "refine graph" }, buildToolOptions("architect_goals"))
        const match = toolText(first).match(/continuation_artifact_id[^\n]*?(art_[A-Za-z0-9]+)/)
        expect(match?.[1]).toBeTruthy()
        continuationArtifactID = match![1]

        Database.use((db) => {
          db.update(EngineGoalTable)
            .set({
              objective: "Implement a changed goal contract after the continuation was created.",
              time_updated: now + 1,
            })
            .where(eq(EngineGoalTable.id, goalID))
            .run()
        })

        const staleResult = await tools.architect.execute(
          {
            reason: "continue previous architect finalizer miss",
            continuation_artifact_id: continuationArtifactID,
          },
          buildToolOptions("architect_goals"),
        )
        expect(toolText(staleResult)).toContain("continuation artifact scope is stale")
        expect(toolText(staleResult)).toContain("scope_mismatch")
        expect(toolText(staleResult)).toContain("start a fresh architect")
        expect(calls).toBe(1)
      },
    })
  })

  test("architect continuation rejects stale goal retry labels before resuming worker", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_architect_stale_retry_${stamp}`
    const goalID = `goal_architect_stale_retry_${stamp}`
    const specID = `spec_architect_stale_retry_${stamp}`
    const failedSessionID = `ses_architect_stale_retry_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "architect stale retry parent" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Architect stale retry project",
          taskTitle: "Architect stale retry task",
          request: "Refine the existing goal graph after build retry state changes.",
          goalTitle: "Retry-sensitive goal",
          goalSlug: "retry-sensitive-goal",
          objective: "Implement the retry-sensitive goal contract.",
          now,
          specID,
          requirementIDs: ["REQ-architect"],
          insertProject: false,
        })

        let continuationArtifactID = ""
        let calls = 0
        architectCoordinateImpl = async (input: any) => {
          calls += 1
          input.onSessionCreated?.(failedSessionID)
          throw new AgentRunError("architect", "missing terminal submit_architect", {
            nonRetryable: true,
            cause: new Message.TerminalToolMissingError({
              message: "Architect ended without submit_architect.",
              toolName: "submit_architect",
              retries: 0,
            }),
          })
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const first = await tools.architect.execute({ reason: "refine graph" }, buildToolOptions("architect_retry"))
        const match = toolText(first).match(/continuation_artifact_id[^\n]*?(art_[A-Za-z0-9]+)/)
        expect(match?.[1]).toBeTruthy()
        continuationArtifactID = match![1]

        seedGoalRunAttemptWithWorkspace({
          taskID,
          goalID,
          artifactID: `grun_architect_retry_${stamp}`,
          workspaceDir: tmp.path,
          workspaceBranch: "codex/retry",
          retryCount: 1,
          status: "completed",
          now: now + 1,
        })

        const staleResult = await tools.architect.execute(
          {
            reason: "continue previous architect finalizer miss",
            continuation_artifact_id: continuationArtifactID,
          },
          buildToolOptions("architect_retry"),
        )
        expect(toolText(staleResult)).toContain("continuation artifact scope is stale")
        expect(toolText(staleResult)).toContain("scope_mismatch")
        expect(toolText(staleResult)).toContain("start a fresh architect")
        expect(calls).toBe(1)
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
        expect(toolText(result)).toContain("Architect decomposition complete")

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

  test("publish gate failures are post-acceptance export feedback instead of task lifecycle decisions", async () => {
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
    const goalID = `gol_integrity_${stamp}`
    let architectureReviewCalls = 0
    let buildCalls = 0
    let buildTarget: any

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal integrity build test" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
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
          insertProject: false,
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

        // Build start no longer triggers architecture review per goal.
        // Orchestrator calls `integrity` explicitly from refill context.
        const resultText = expectGoalBuildStarted(result)
        await waitForGoalStatus(goalID, "passed")
        expect(resultText).not.toContain("architecture_review:")
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

  test("goal build receives only current-goal requirements and related architecture context", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_goal_scoped_context_${stamp}`
    const taskID = `tsk_goal_scoped_context_${stamp}`
    const goalID = `gol_feature_${stamp}`
    const shellGoalID = `gol_shell_${stamp}`
    const consumerGoalID = `gol_consumer_${stamp}`
    const unrelatedGoalID = `gol_unrelated_${stamp}`
    const specID = `spec_goal_scoped_context_${stamp}`
    let buildInput: any

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal scoped build context test" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Goal scoped build context test",
          taskTitle: "Goal scoped build context task",
          request: "Build one goal from a multi-goal plan.",
          goalTitle: "Feature surface",
          goalSlug: "feature-surface",
          objective: "Implement only the feature surface.",
          now,
          specID,
          requirementIDs: ["REQ-feature"],
          insertProject: false,
        })

        Database.use((db) => {
          insertRequirements(db, {
            taskID,
            specSnapshotID: specID,
            now,
            requirements: [
              {
                id: "REQ-feature",
                title: "Feature",
                description: "Implement the feature surface.",
                acceptance: ["feature renders"],
                evidence_refs: ["feature-evidence"],
                non_goals: ["Do not rebuild the shell."],
                priority: "blocking",
              },
              {
                id: "REQ-shell",
                title: "Shell",
                description: "Implement the reusable shell.",
                acceptance: ["shell renders"],
                evidence_refs: ["shell-evidence"],
                non_goals: [],
                priority: "blocking",
              },
              {
                id: "REQ-consumer",
                title: "Consumer",
                description: "Wire the downstream consumer surface.",
                acceptance: ["consumer renders"],
                evidence_refs: ["consumer-evidence"],
                non_goals: [],
                priority: "blocking",
              },
              {
                id: "REQ-unrelated",
                title: "Unrelated",
                description: "Build an unrelated marketing panel.",
                acceptance: ["marketing renders"],
                evidence_refs: ["marketing-evidence"],
                non_goals: [],
                priority: "blocking",
              },
            ],
          })
          db.update(EngineGoalTable)
            .set({
              owned_paths: ["src/feature.tsx"],
              depends_on: [shellGoalID],
              requirement_ids: ["REQ-feature"],
            })
            .where(eq(EngineGoalTable.id, goalID))
            .run()
          for (const goal of [
            {
              id: shellGoalID,
              title: "Shell",
              slug: "shell",
              objective: "Implement the reusable shell.",
              owned_paths: ["src/App.tsx"],
              depends_on: [] as string[],
              requirement_ids: ["REQ-shell"],
              status: "passed",
              order_index: 1,
            },
            {
              id: consumerGoalID,
              title: "Consumer",
              slug: "consumer",
              objective: "Wire the downstream consumer surface.",
              owned_paths: ["src/consumer.tsx"],
              depends_on: [goalID],
              requirement_ids: ["REQ-consumer"],
              status: "pending",
              order_index: 2,
            },
            {
              id: unrelatedGoalID,
              title: "Unrelated",
              slug: "unrelated",
              objective: "Build an unrelated marketing panel.",
              owned_paths: ["src/marketing.tsx"],
              depends_on: [] as string[],
              requirement_ids: ["REQ-unrelated"],
              status: "pending",
              order_index: 3,
            },
          ]) {
            db.insert(EngineGoalTable)
              .values({
                id: goal.id,
                task_id: taskID,
                spec_snapshot_id: specID,
                title: goal.title,
                slug: goal.slug,
                objective: goal.objective,
                acceptance_specs: [],
                owned_paths: goal.owned_paths,
                depends_on: goal.depends_on,
                exports: [],
                imports: [],
                kind: "feature",
                requirement_ids: goal.requirement_ids,
                priority: "blocking",
                source: "test",
                status: goal.status,
                order_index: goal.order_index,
                time_created: now,
                time_updated: now,
              })
              .run()
          }
          db.update(EngineTaskTable)
            .set({
              metadata: {
                architect_fidelity: {
                  sourceCoverage: [
                    {
                      id: "src-feature",
                      paths: ["src/feature.tsx"],
                      goal_ids: [goalID],
                      action: "modify",
                      rationale: "Feature goal owns this source surface.",
                    },
                    {
                      id: "src-unrelated",
                      paths: ["src/marketing.tsx"],
                      goal_ids: [unrelatedGoalID],
                      action: "modify",
                      rationale: "Unrelated goal owns this source surface.",
                    },
                  ],
                  referenceCoverage: [
                    {
                      id: "ref-feature",
                      surface: "feature",
                      goal_ids: [goalID],
                      visual_spec_ids: ["vis-feature"],
                      expectation: "Feature reference applies to this goal.",
                    },
                    {
                      id: "ref-shell",
                      surface: "shell",
                      goal_ids: [shellGoalID],
                      visual_spec_ids: ["vis-shell"],
                      expectation: "Shell reference applies to a sibling goal.",
                    },
                  ],
                  assemblyOwners: [
                    {
                      surface: "feature-assembly",
                      goal_id: goalID,
                      rationale: "Feature goal owns feature stitching.",
                    },
                    {
                      surface: "final-shell",
                      goal_id: shellGoalID,
                      rationale: "Shell goal owns final shell stitching.",
                    },
                  ],
                },
              },
            } as any)
            .where(eq(EngineTaskTable.id, taskID))
            .run()
        })
        const shellRunID = beginBuildAttempt({
          taskID,
          goalID: shellGoalID,
          sessionID: `ses_shell_${stamp}`,
          now: now + 10,
        })
        updateGoalRun(shellRunID, { status: "completed", time_completed: now + 11 })
        insertArchitectContractGraphArtifact({
          taskID,
          now: now + 1,
          graph: {
            version: 1,
            contracts: [
              {
                id: "contract_shell",
                kind: "component",
                name: "Shell",
                producer_goal_id: shellGoalID,
                consumer_goal_ids: [goalID],
                summary: "Shell contract consumed by the feature goal.",
                artifact_paths: ["src/App.tsx"],
                evidence_refs: [],
              },
            ],
            dependency_contracts: [
              {
                from_goal_id: shellGoalID,
                to_goal_id: goalID,
                reason: "contract",
                contract_ids: ["contract_shell"],
              },
              {
                from_goal_id: goalID,
                to_goal_id: consumerGoalID,
                reason: "integration_order",
                contract_ids: [],
              },
            ],
          },
        })

        buildAgentRunImpl = async (input: any) => {
          await markBuildSlotAcquired(input)
          buildInput = input
          return {
            result: {
              status: "passed",
              summary: "Feature built successfully",
              files_changed: [
                {
                  path: "src/feature.tsx",
                  summary: "Changed scoped feature file.",
                  reason: "Required by REQ-feature.",
                },
              ],
              tests: [],
              commit_ref: "def5678",
            },
            sessionID: "ses_goal_scoped_context_build",
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

        const result = await tools.build.execute({ goalID, reason: "Scoped goal execution." }, buildToolOptions())

        expectGoalBuildStarted(result)
        await waitForGoalStatus(goalID, "passed")
        expect(buildInput.target.requirement_ids).toEqual(["REQ-feature"])
        expect(buildInput.context.requirements.map((requirement: any) => requirement.id)).toEqual(["REQ-feature"])
        expect(JSON.stringify(buildInput.context.requirements)).not.toContain("REQ-shell")
        expect(JSON.stringify(buildInput.context.requirements)).not.toContain("REQ-unrelated")
        expect(new Set(buildInput.context.collaborationGoals.map((goal: any) => goal.id))).toEqual(
          new Set([shellGoalID, goalID, consumerGoalID]),
        )
        expect(JSON.stringify(buildInput.context.collaborationGoals)).not.toContain(unrelatedGoalID)
        expect(buildInput.context.fidelity.sourceCoverage.map((row: any) => row.id)).toEqual(["src-feature"])
        expect(buildInput.context.fidelity.referenceCoverage.map((row: any) => row.id)).toEqual(["ref-feature"])
        expect(buildInput.context.fidelity.assemblyOwners.map((row: any) => row.surface)).toEqual(["feature-assembly"])

        const contractArtifact = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "build_session_contract")))
            .get(),
        )
        expect((contractArtifact?.payload as any).requirements_snapshot.map((row: any) => row.id)).toEqual([
          "REQ-feature",
        ])
        expect(
          (contractArtifact?.payload as any).collaboration_goals_snapshot.map((goal: any) => goal.id),
        ).not.toContain(unrelatedGoalID)
      },
    })
  }, 15000)

  test("concurrent integrity calls share one review for the active spec", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_integrity_singleflight_${stamp}`
    const taskID = `tsk_integrity_singleflight_${stamp}`
    const goalID = `gol_integrity_singleflight_${stamp}`
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
          tools.integrity.execute({ reason: "post-build review A" }, buildToolOptions("integrity_review_a")),
          tools.integrity.execute({ reason: "post-build review B" }, buildToolOptions("integrity_review_b")),
        ])
        for (let i = 0; i < 20 && reviewCalls === 0; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 5))
        }
        expect(reviewCalls).toBe(1)

        releaseReview()
        const [firstResult, secondResult] = await combined
        expect(toolText(firstResult)).toContain("Integrity verdict: pass")
        expect(toolText(secondResult)).toContain("Integrity verdict: pass")
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

  test("goal build receives sibling contract graph without leaking sibling fidelity scope", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_goal_arch_context_${stamp}`
    const taskID = `tsk_goal_arch_context_${stamp}`
    const goalID = `gol_arch_context_${stamp}`
    const siblingGoalID = `gol_arch_sibling_${stamp}`
    let capturedContext: any

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal architecture context test" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
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
          insertProject: false,
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

        expectGoalBuildStarted(result)
        await waitForGoalStatus(goalID, "passed")
        expect(capturedContext?.contractGraph?.contracts?.map((c: any) => c.producer_goal_id)).toContain(siblingGoalID)
        expect(capturedContext?.contractGraph?.dependency_contracts?.map((c: any) => c.from_goal_id)).toContain(
          siblingGoalID,
        )
        expect(capturedContext?.collaborationGoals?.find((g: any) => g.id === siblingGoalID)?.objective).toBeUndefined()
        expect(
          capturedContext?.collaborationGoals?.find((g: any) => g.id === siblingGoalID)?.acceptance_specs,
        ).toBeUndefined()
        expect(capturedContext?.fidelity).toBeUndefined()
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
    const goalID = `gol_integrity_block_${stamp}`
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
                reviewers: ["acceptance_surface"],
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

        // Build start does not trigger architecture review or graph mutation.
        // Orchestrator calls `integrity` explicitly from refill context.
        const resultText = expectGoalBuildStarted(result)
        await waitForGoalStatus(goalID, "passed")
        expect(resultText).not.toContain("architecture_review:")
        expect(resultText).not.toContain("### Architecture review")
        expect(resultText).not.toContain("architecture_review_rework: opened")
        expect(buildCalls).toBe(1)
        const runs = listGoalRunsByGoal(goalID)
        expect(runs).toHaveLength(1)
        expect(runs[0]?.superseded_reason).toBeFalsy()
        expect(findGoal(goalID)).toBeTruthy()
      },
    })
  })

  test("post-build architecture concerns open targeted rework instead of passive acceptance", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_goal_review_concern_${stamp}`
    const taskID = `tsk_goal_review_concern_${stamp}`
    const goalID = `gol_review_concern_${stamp}`

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
          request: "Architecture concerns must drive rework before acceptance",
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

        const resultText = expectGoalBuildStarted(result)
        await waitForGoalStatus(goalID, "passed")
        expect(resultText).not.toContain("architecture_review:")
        expect(resultText).not.toContain("### Architecture review")
        expect(resultText).not.toContain("architecture_review_rework: opened")
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
    const goalID = `gol_review_source_${stamp}`
    const siblingGoalID = `gol_review_target_${stamp}`
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
                reviewers: ["acceptance_surface"],
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

        // Build start does not trigger review or supersede sibling goals.
        const resultText = expectGoalBuildStarted(result)
        await waitForGoalStatus(goalID, "passed")
        expect(resultText).not.toContain("architecture_review:")
        expect(resultText).not.toContain("### Architecture review")
        expect(resultText).not.toContain(`goal=${goalID} superseded_tip`)
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
    const goalID = `gol_review_root_${stamp}`
    const childGoalID = `gol_review_child_${stamp}`
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

        // Build start does not trigger review or cascade dependent rework.
        const resultText = expectGoalBuildStarted(result)
        await waitForGoalStatus(goalID, "passed")
        expect(resultText).not.toContain("architecture_review:")
        expect(resultText).not.toContain("### Architecture review")
        expect(resultText).not.toContain("architecture_review_dependency_rework")
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
    const goalID = `gol_stale_build_${stamp}`

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

        const resultText = expectGoalBuildStarted(result)
        await waitForCondition("stale build report ignored", () => listGoalRunsByGoal(goalID)[0]?.status === "aborted")
        expect(resultText).not.toContain("architecture_review:")
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
    const goalID = `gol_integrity_noop_${stamp}`
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
                reviewers: ["acceptance_surface"],
              }),
            ],
            sessionID: "ses_integrity_noop",
          })

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.integrity.execute({}, buildToolOptions("integrity_noop"))

        expect(toolText(result)).toContain("Integrity verdict: needs_correction")
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
    const goalID = `gol_integrity_upstream_${stamp}`
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

        const result = await tools.integrity.execute({}, buildToolOptions("integrity_upstream"))

        const resultText = toolText(result)
        expect(resultText).toContain("Integrity verdict: needs_correction")
        // Post-fix: review headline now states the advisory contract
        // explicitly without referring to the deleted auto-route mechanism.
        expect(resultText).toContain("Nothing in code supersedes goals")
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
    const goalID = `gol_integrity_plan_restart_${stamp}`
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

        const result = await tools.integrity.execute({}, buildToolOptions("integrity_replay"))

        const resultText = toolText(result)
        expect(resultText).toContain("Integrity verdict: needs_correction")
        expect(resultText).not.toContain("Task restarted from plan")
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
    const goalID = `gol_integrity_artifact_missing_${stamp}`
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
        const output = await tools.integrity.execute({}, buildToolOptions("integrity_findings"))

        expect(toolText(output)).toContain("artifact_persistence_status")
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
    const goalID = `gol_integrity_persistent_roots_${stamp}`
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

        await tools.integrity.execute({}, buildToolOptions("integrity_task_lifecycle"))

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
    const goalID = `gol_integrity_mixed_restart_${stamp}`
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
                reviewers: ["acceptance_surface"],
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
                reviewers: ["acceptance_surface"],
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

        const result = await tools.integrity.execute({}, buildToolOptions("integrity_context"))

        const resultText = toolText(result)
        expect(resultText).toContain("Integrity verdict: needs_correction")
        expect(resultText).not.toContain("Task restarted from plan")
        expect(resultText).not.toContain("Task restarted from requirements")
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
    const goalID = `gol_integrity_persisted_block_${stamp}`
    const specID = `spec_${goalID}`
    let buildCalls = 0

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "persisted integrity block test" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
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
          insertProject: false,
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

        expectGoalBuildStarted(result)
        await waitForGoalStatus(goalID, "passed")
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
    const goalID = `gol_retry_default_${stamp}`
    const priorSessionID = `ses_prior_retry_default_${stamp}`
    let observedExistingSessionID: unknown

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "default retry session reuse test" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
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
          insertProject: false,
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

        expectGoalBuildStarted(result)
        await waitForGoalStatus(goalID, "failed")
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
    const goalID = `gol_retry_fresh_${stamp}`
    const priorSessionID = `ses_prior_retry_fresh_${stamp}`
    let freshSessionID: string | undefined

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "fresh retry session test" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
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
          insertProject: false,
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

        expectGoalBuildStarted(result)
        await waitForGoalStatus(goalID, "failed")
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
    const goalID = `gol_retry_fresh_marker_${stamp}`
    const priorSessionID = `ses_prior_retry_marker_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "fresh retry marker cleanup test" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
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
          insertProject: false,
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

        expectGoalBuildStarted(result)
        await waitForGoalStatus(goalID, "failed")
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

        expect(toolText(result)).toContain("Build agent finished")
        expect(observedTarget).toEqual({ kind: "request", text: "Apply the scoped direct fix." })
        expect(observedExistingSessionID).toBeUndefined()
      },
    })
  })

  test(
    "goal build returns started after binding goal_run and finalizes in the background",
    async () => {
      await tmp?.[Symbol.asyncDispose]?.()
      tmp = await tmpdir({ git: true })

      const now = Date.now()
      const stamp = now.toString(16)
      const taskID = `tsk_goal_build_session_bind_${stamp}`
      const goalID = `gol_build_session_bind_${stamp}`
      let observedSessionID: string | null | undefined
      const terminal = deferred<void>()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const parent = await Session.create({ kind: "root", title: "build session bind test" })
          const current = Instance.current()
          if (!current) throw new Error("Expected current instance while seeding build session bind task")
          insertWorkflowTaskWithGoal({
            projectID: current.project.id,
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
            insertProject: false,
          })
          buildAgentRunImpl = async (input: any) => {
            expect(listGoalRunsByGoal(goalID)).toHaveLength(0)
            await markBuildSlotAcquired(input, "ses_build_session_bind")
            expect(goalStatusByID(goalID)).toBe("running")
            observedSessionID = listGoalRunsByGoal(goalID)[0]?.session_id
            await terminal.promise
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

          expect(toolText(result)).toContain("Build agent started (status=running")
          expect(toolText(result)).toContain("goal_run")
          expect(observedSessionID).toBe("ses_build_session_bind")
          expect(listGoalRunsByGoal(goalID)[0]?.session_id).toBe("ses_build_session_bind")
          expect(listGoalRunsByGoal(goalID)[0]?.status).toBe("running")

          terminal.resolve()
          await waitForCondition(
            "background goal build finalization",
            () => listGoalRunsByGoal(goalID)[0]?.status === "completed",
          )
          expect(listGoalRunsByGoal(goalID)[0]?.session_id).toBe("ses_build_session_bind")
        },
      })
    },
    { timeout: 15_000 },
  )

  test(
    "goal build background finalize failure does not leave a live goal_run",
    async () => {
      await tmp?.[Symbol.asyncDispose]?.()
      tmp = await tmpdir({ git: true })

      const now = Date.now()
      const stamp = now.toString(16)
      const taskID = `tsk_goal_finalize_failure_${stamp}`
      const goalID = `gol_finalize_failure_${stamp}`
      const terminal = deferred<void>()
      const finalize = spyOn(EnginePersist, "finalizeBuildAttempt").mockImplementationOnce(() => {
        throw new Error("simulated terminal persistence failure")
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const parent = await Session.create({ kind: "root", title: "goal finalize failure test" })
          const current = Instance.current()
          if (!current) throw new Error("Expected current instance while seeding goal finalize failure task")
          insertWorkflowTaskWithGoal({
            projectID: current.project.id,
            taskID,
            goalID,
            sessionID: parent.id,
            worktree: tmp.path,
            projectName: "Goal finalize failure test",
            taskTitle: "Goal finalize failure task",
            request: "Do not leave live goal_run when finalize persistence fails",
            goalTitle: "Finalize failure guard",
            goalSlug: "finalize-failure-guard",
            objective: "Verify background finalization failure reaches terminal failed state",
            now,
            insertProject: false,
          })
          buildAgentRunImpl = async (input: any) => {
            await markBuildSlotAcquired(input, "ses_goal_finalize_failure")
            await terminal.promise
            return {
              result: {
                status: "passed",
                summary: "Build completed but persistence will fail.",
                files_changed: [
                  {
                    path: "src/index.ts",
                    summary: "Changed implementation.",
                    reason: "The test needs a normal passed build result before finalization fails.",
                  },
                ],
                tests: [],
                commit_ref: "abc1234",
              },
              sessionID: "ses_goal_finalize_failure",
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

          expect(toolText(result)).toContain("Build agent started (status=running")
          expect(listGoalRunsByGoal(goalID)[0]?.status).toBe("running")

          terminal.resolve()
          await waitForCondition(
            "background goal build finalization failure",
            () => listGoalRunsByGoal(goalID)[0]?.status === "failed",
          )
          const run = listGoalRunsByGoal(goalID)[0]
          expect(run?.error).toContain("build finalization failed: simulated terminal persistence failure")
          expect(finalize).toHaveBeenCalledTimes(1)
        },
      })
    },
    { timeout: 15_000 },
  )

  test("goal build rejects duplicate dispatch while a live goal_run exists", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_duplicate_live_goal_${stamp}`
    const taskID = `tsk_duplicate_live_goal_${stamp}`
    const goalID = `gol_duplicate_live_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "duplicate live goal test" })
        insertWorkflowTaskWithGoal({
          projectID,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Duplicate live goal test",
          taskTitle: "Duplicate live goal task",
          request: "Reject duplicate goal dispatch while a live run exists",
          goalTitle: "Duplicate live guard",
          goalSlug: "duplicate-live-guard",
          objective: "Ensure duplicate dispatch is keyed by live goal_run facts",
          now,
        })
        beginBuildAttempt({
          taskID,
          goalID,
          sessionID: `ses_duplicate_live_${stamp}`,
          now: now + 1,
        })
        buildAgentRunImpl = async () => {
          throw new Error("BuildAgent.run must not start for duplicate live goal_run")
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        await expect(
          tools.build.execute(
            {
              goalID,
              request: "Start duplicate build",
              reason: "This should be rejected before BuildAgent starts.",
            },
            buildToolOptions(),
          ),
        ).rejects.toThrow(/already has live goal_run/)
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
    const goalID = `gol_integrity_concern_block_${stamp}`
    const specID = `spec_${goalID}`
    let buildCalls = 0

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "persisted integrity concern block test" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
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
          insertProject: false,
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

        expectGoalBuildStarted(result)
        await waitForGoalStatus(goalID, "passed")
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
    const goalID = `gol_integrity_persistent_context_${stamp}`
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
        expect(toolText(context)).toContain("Persistent blocking roots")

        const result = await tools.build.execute(
          {
            goalID,
            request: "The stub LLM selected build through the normal tool path.",
            reason: "Active-path no-host-gate regression.",
          },
          buildToolOptions(),
        )

        expectGoalBuildStarted(result)
        await waitForGoalStatus(goalID, "passed")
        expect(buildCalls).toBe(1)
      },
    })
  })

  test("orchestrator tool surface omits retired deliver verification", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_deliver_integrity_prereq_${stamp}`
    const taskID = `tsk_deliver_integrity_prereq_${stamp}`
    const goalID = `gol_deliver_integrity_prereq_${stamp}`
    const specID = `spec_${goalID}`
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
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        expect("deliver" in tools).toBe(false)
        expect("publish_acceptance" in tools).toBe(false)
        const artifact = findLatestIntegrityAttemptArtifact({ taskID, specSnapshotID: specID })
        expect(artifact).toBeUndefined()
        const throwArtifact = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(
              and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "acceptance_review_threw")),
            )
            .get(),
        )
        expect(throwArtifact).toBeUndefined()
        const verdictArtifact = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(
              and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.label, "acceptance-review-verdict")),
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
    const goalID = `gol_cleanup_${stamp}`
    let buildWorktreeDir = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal cleanup build test" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
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
          insertProject: false,
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

        expectGoalBuildStarted(result)
        await waitForGoalStatus(goalID, "passed")
        expect(buildWorktreeDir).not.toBe("")
        await waitForCondition("completed goal worktree cleanup", async () => {
          if (await Filesystem.exists(buildWorktreeDir)) return false
          const ws = findGoalLatestWorkspace(goalID)
          return ws.directory === null && listGoalRunsByGoal(goalID)[0]?.workspace_dir === null
        })
        const ws = findGoalLatestWorkspace(goalID)
        expect(ws.directory).toBeNull()
        expect(ws.branch).toBeNull()
        expect(ws.baseRef).toBeNull()
        expect(listGoalRunsByGoal(goalID)[0]?.workspace_dir).toBeNull()
      },
    })
  }, 30_000)

  test("goal build failure keeps the worktree for diagnosis", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_goal_keep_${stamp}`
    const taskID = `tsk_goal_keep_${stamp}`
    const goalID = `gol_keep_${stamp}`
    let buildWorktreeDir = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal failed build test" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
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
          insertProject: false,
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

        expectGoalBuildStarted(result)
        await waitForGoalStatus(goalID, "failed")
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
    const goalID = `gol_refuse_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal cleanup refused test" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
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
          insertProject: false,
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

        expectGoalBuildStarted(result)
        await waitForGoalStatus(goalID, "passed")
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
    const goalID = `gol_retry_render_${stamp}`
    let capturedContext: any

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "retry rendered attachment test" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Retry rendered attachment test",
          taskTitle: "Retry rendered attachment task",
          request: "Build a visual UI and retry from acceptance feedback",
          goalTitle: "Visual goal",
          goalSlug: "visual-goal",
          objective: "Verify retry screenshots keep canonical attachment URLs",
          now,
          insertProject: false,
        })

        const rendered = await AttachmentStore.write(
          Instance.project.id,
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
          key: "acceptance_rejection",
          value: "Previous rendered page missed the reference layout.",
          reason: "Acceptance rejected visual fidelity.",
        })
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
          createDecisionLog(taskID).append({
            phase: "frontend_design",
            key,
            value: `${key} complete for retry attachment regression.`,
            reason: "Visual build gate requires complete frontend-design template first.",
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
            request: "Apply acceptance visual feedback",
            reason: "Retry after acceptance rejection.",
          },
          buildToolOptions(),
        )

        expectGoalBuildStarted(result)
        await waitForGoalStatus(goalID, "passed")
        expect(capturedContext?.retryAttachments).toHaveLength(1)
        const retryAttachment = capturedContext.retryAttachments[0]
        expect(retryAttachment.url).toBe(rendered.url)
        expect(retryAttachment.url).toStartWith(`/attachment/${Instance.project.id}/`)
        await expect(AttachmentStore.inlineFileParts([retryAttachment])).resolves.toHaveLength(1)
      },
    })
  })

  test("orchestrator tools do not expose the removed stage-rewind entrypoint", () => {
    const { tools } = createOrchestratorTools({
      taskID: "tsk_removed_stage_rewind",
      agentSessionID: "ses_removed_stage_rewind",
      signal: new AbortController().signal,
    })
    expect((tools as Record<string, unknown>)[["restart", "from", "stage"].join("_")]).toBeUndefined()
  })
})
