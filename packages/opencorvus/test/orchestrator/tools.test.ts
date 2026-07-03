import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { $ } from "bun"
import { createHash } from "node:crypto"
import { createServer, type Server } from "node:http"
import fs from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import z from "zod"
import { persistBrowserPreviewEvidence } from "../../src/browser-preview/persist"
import { composeBuildInputEvidenceManifest } from "../../src/build/evidence-manifest"
import { Bus } from "../../src/bus"
import { Database, and, eq, sql } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import {
  EngineArtifactTable,
  EngineGoalTable,
  EngineInteractionRequestTable,
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
import { Agent } from "../../src/agent/agent"
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
import { resetDatabase, TEST_DATABASE_LOCK_DIAGNOSTIC_TIMEOUT_MS } from "../fixture/db"
import { PROJECT_EXPERT_SQUAD_ID, writeProjectExpertSquadPackage } from "../fixture/expert-squad"
import { tmpdir } from "../fixture/fixture"
import { persistTestBrowserPreviewTarget } from "../fixture/browser-preview"
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
import { SessionStatus, sessionLifecycleOrderKey } from "../../src/session/status"
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
import { EffectiveConfig } from "../../src/config/effective"
import { ProtocolEventTable } from "../../src/protocol/protocol.sql"
import { Provider } from "../../src/provider/provider"
import { createRun } from "../../src/engine/writer"
import * as EngineWriter from "../../src/engine/writer"
import { hooks, terminalTask, updateRun } from "../../src/engine/state"
import { EngineInteraction } from "../../src/engine/interaction"
import { ExecutorRegistry } from "../../src/executor/registry"
import type { ExecutorAdapter } from "../../src/executor/contract"
import { AgentRunError } from "../../src/agent/runner"
import { Message } from "../../src/session/message"
import { SessionControl } from "../../src/session/control"
import { Worktree } from "../../src/worktree"
import {
  claimStageContinuationRequest,
  createStageContinuationRequest,
  findStageContinuationRequest,
  markStageContinuationClaimFailed,
  markStageContinuationConsumed,
} from "../../src/engine/stage-continuation"
import {
  createAgentCoordinationResponse,
  createAgentCoordinationRequest,
  findAgentCoordinationAction,
  findAgentCoordinationRequest,
  listAgentCoordinationActions,
  listPendingAgentCoordinationRequests,
  recordAgentCoordinationActionProgress,
} from "../../src/engine/agent-coordination"
import { researchRequestHash, researchSourceDigest } from "../../src/research/schema"
import { recordFactCheckAttempt } from "../../src/fact-check/persist"
import { WorkerTurnDescriptor } from "../../src/agent/worker-turn-descriptor"
import { ensureTaskMessageProtocolBridge } from "../../src/orchestrator/protocol/message-bridge"
import { SkillTool } from "../../src/tool/skill"
import {
  createDesignResourceManifest,
  recordDesignResourceManifest,
} from "../../src/frontend-design/design-resource-manifest"
import { installControlModel } from "../workspace/mock-control-model"

const ORCHESTRATOR_TOOLS_TEST_TIMEOUT_MS = TEST_DATABASE_LOCK_DIAGNOSTIC_TIMEOUT_MS + 15_000

let buildAgentRunImpl: ((input: any) => Promise<any>) | undefined
let reviewIntegrityImpl: ((input: any) => Promise<any>) | undefined
let computeRequirementStatusSnapshotImpl: ((input: any) => any[]) | undefined
let requirementsRunImpl: ((input: any) => Promise<any>) | undefined
let architectCoordinateImpl: ((input: any) => Promise<any>) | undefined
let designAnalyzeImpl: ((input: any) => Promise<any>) | undefined
let frontendResearchRunImpl: ((input: any) => Promise<any>) | undefined
let deepResearchRunImpl: ((input: any) => Promise<any>) | undefined
let intentAnalysisAnalyzeImpl: ((input: any) => Promise<any>) | undefined
let exploreRunImpl: ((input: any) => Promise<any>) | undefined
let goalWorkloadAnalyzeImpl: ((input: any) => Promise<any>) | undefined
let factCheckAgentRunImpl: ((input: any) => Promise<any>) | undefined
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

async function buildPersistedToolOptions(input: {
  sessionID: string
  label: string
  toolName?: string
  toolInput?: Record<string, unknown>
  now?: number
}) {
  const stamp = `${Date.now()}_${Math.random().toString(16).slice(2)}`
  const toolName = input.toolName ?? "respond_agent_coordination"
  const messageID = `msg_${input.label}_${stamp}`
  const toolCallID = `cal_${input.label}_${stamp}`
  const toolPartID = `prt_${input.label}_${stamp}`
  const now = input.now ?? Date.now()
  await Session.persistMessage({
    info: {
      id: messageID,
      sessionID: input.sessionID,
      role: "assistant",
      time: { created: now },
      parentID: `msg_user_${input.label}_${stamp}`,
      providerID: "test-provider",
      modelID: "test-model",
      agent: "orchestrator",
      path: { cwd: Instance.directory, root: Instance.worktree },
      cost: 0,
      tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [
      {
        id: toolPartID,
        messageID,
        sessionID: input.sessionID,
        type: "tool",
        callID: toolCallID,
        tool: toolName,
        state: {
          status: "running",
          input: input.toolInput ?? {},
          time: { start: now },
        },
      },
    ],
    touchSessionID: input.sessionID,
  })
  return {
    toolCallId: toolCallID,
    opencorvus: {
      sessionID: input.sessionID,
      messageID,
      toolCallID,
      toolPartID,
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

async function waitForSessionStatusEvent(input: {
  taskID: string
  sessionID: string
  reason: "aborted" | "completed" | "error" | "artifact_missing"
  afterMs?: number
}) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const row = Database.use((db) =>
      db
        .select({
          id: ProtocolEventTable.id,
          payload: ProtocolEventTable.payload,
          emittedAt: ProtocolEventTable.emitted_at,
        })
        .from(ProtocolEventTable)
        .where(
          and(
            eq(ProtocolEventTable.task_id, input.taskID),
            eq(ProtocolEventTable.session_id, input.sessionID),
            eq(ProtocolEventTable.type, "session.status"),
          ),
        )
        .orderBy(sql`${ProtocolEventTable.emitted_at} DESC`, sql`${ProtocolEventTable.seq} DESC`)
        .all(),
    ).find((event) => {
      if (input.afterMs !== undefined && event.emittedAt < input.afterMs) return false
      const status =
        event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
          ? (event.payload as Record<string, unknown>).status
          : undefined
      return (
        status &&
        typeof status === "object" &&
        !Array.isArray(status) &&
        (status as Record<string, unknown>).type === "terminal" &&
        (status as Record<string, unknown>).reason === input.reason
      )
    })
    if (row) return row
    await Bun.sleep(25)
  }
  throw new Error(`session.status ${input.reason} event not found for ${input.sessionID}`)
}

function testStageInputDigest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex")
}

async function seedTerminalAssistantMessage(input: {
  parentID: string
  kind: string
  text: string
  now: number
}): Promise<{ sessionID: string; messageID: string; contentHash: string }> {
  const session = await Session.create({
    kind: input.kind as any,
    parentID: input.parentID,
    title: `terminal ${input.kind} message`,
  })
  const userID = Identifier.ascending("message")
  await Session.updateMessage({
    id: userID,
    sessionID: session.id,
    role: "user",
    time: { created: input.now },
    agent: "user",
    model: { providerID: "test", modelID: "test" },
  } as any)
  const assistantID = Identifier.ascending("message")
  await Session.updateMessage({
    id: assistantID,
    sessionID: session.id,
    role: "assistant",
    parentID: userID,
    modelID: "test",
    providerID: "test",
    agent: input.kind,
    path: { cwd: Instance.directory, root: Instance.worktree },
    time: { created: input.now + 1, completed: input.now + 2 },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, total: 0, cache: { read: 0, write: 0 } },
  } as any)
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: assistantID,
    sessionID: session.id,
    type: "text",
    text: input.text,
  } as any)
  SessionStatus.set(session.id, { type: "idle" })
  return {
    sessionID: session.id,
    messageID: assistantID,
    contentHash: createHash("sha256").update(input.text).digest("hex"),
  }
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

function minimalRequirementsResult(input: { sessionID: string }) {
  return {
    sessionID: input.sessionID,
    summary: "Recovered requirements result.",
    requirements: [
      {
        id: "REQ-1",
        type: "explicit" as const,
        description: "Persist a durable A2A coordination mailbox.",
        acceptance: "A2A request, response, and action artifacts are visible and recoverable.",
        non_goals: "Do not preserve fallback A2A routes.",
        evidence_refs: [],
      },
    ],
    decisions: [
      {
        key: "communication_protocol",
        value: "durable_a2a_mailbox",
        reason: "Worker scheduling decisions must be recoverable and observable.",
      },
    ],
  }
}

function minimalArchitectRedispatchResult(input: { sessionID: string }) {
  return {
    sessionID: input.sessionID,
    summary: "Recovered architect decomposition.",
    decompositionAnalysis: "One durable A2A protocol goal covers the current requirements.",
    goals: [
      {
        id: "goal_a2a_protocol",
        title: "A2A protocol",
        objective: "Implement the durable A2A coordination protocol.",
        acceptance_specs: [
          {
            id: "acc-a2a-protocol",
            source_requirement_id: "REQ-1",
            goal_id: "goal_a2a_protocol",
            title: "A2A protocol is durable",
            scorers: [
              {
                type: "llm_judge" as const,
                name: "durability evidence",
                criteria: "The protocol uses durable request, response, and action artifacts.",
              },
            ],
            severity: "essential" as const,
          },
        ],
        owned_paths: ["packages/opencorvus/src/engine/agent-coordination.ts"],
        depends_on: [],
        exports: ["AgentCoordination"],
        imports: [],
        kind: "feature" as const,
        requirement_ids: ["REQ-1"],
        priority: "blocking" as const,
      },
    ],
    removedGoalIDs: [],
    traceability: [{ requirementID: "REQ-1", goalIDs: ["goal_a2a_protocol"] }],
    fidelity: { sourceCoverage: [], referenceCoverage: [], assemblyOwners: [] },
    contractGraph: { version: 1 as const, contracts: [], dependency_contracts: [] },
    validationFindings: [],
  }
}

function minimalFrontendDesignResult(input: { sessionID: string }) {
  return {
    specs: [
      {
        id: "VIS-1",
        category: "layout" as const,
        severity: "must" as const,
        title: "Reference layout",
        requirement: "Preserve the source layout hierarchy.",
        applies_to: "main surface",
        rationale: "The A2A redispatch must preserve frontend-design evidence.",
      },
    ],
    designSystem: "Source-aligned product design",
    techStack: ["React", "CSS"],
    frontendTemplate: "Recovered frontend template from A2A redispatch.",
    finalAcceptanceMode: "maintainable_replacement_required" as const,
    fillableModules: "main shell, data slots, interaction states",
    componentInventory: "AppShell, PrimaryPanel",
    componentReusePlan: [
      {
        family_id: "app-shell",
        name: "App shell",
        observed_surface: "reference screenshot",
        source_refs: ["ref.png"],
        implementation_strategy: "existing_project_component" as const,
        reuse_source: "src/components/AppShell.tsx",
        mature_library_candidates: [],
        props_states: "default",
        replacement_boundary: "application shell",
        parity_guard: "screenshot review",
      },
    ],
    baselineReplacementPlan: [],
    implementationPhaseOutcomes: [],
    qualityProjectContract: "Use semantic components and project-owned styles.",
    materialInventory: "reference screenshot",
    frontendProject: {
      status: "not_created" as const,
      role: "visual_baseline_input" as const,
      project_root: "visual-html-skeleton",
      source_package: "frontend-design-skeleton",
      entrypoints: ["index.html"],
      generation_tool: "frontend-design",
      notes: ["A2A redispatch preserved the existing visual reference."],
    },
    visualConsistencyContract: "Match the visual reference hierarchy.",
    uiDataContract: "No backend data contract in this fixture.",
    templateIterationNotes: ["Checked visual evidence coverage.", "Checked downstream implementation feasibility."],
    completenessReview: "Frontend design handoff is complete for this fixture.",
    referenceArtifacts: ["ref.png"],
    openQuestions: [],
    report: {
      summary: "Recovered frontend template from A2A redispatch.",
      detail: "Frontend design public report.",
    },
    sessionID: input.sessionID,
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
  const checkID = "check-main-surface"
  return {
    accepted: true,
    summary: "Recovered visual QA report.",
    check_items: [
      {
        id: checkID,
        category: "component-truth",
        question: "Does the main visible surface render as the implemented product UI?",
        region: "main surface",
        status: "passed" as const,
        expected: "The main surface renders with the intended product structure and no blocking visual defects.",
        observed: "The main surface was checked from fresh Visual QA evidence.",
        viewports: [{ width: 1280, height: 720 }],
        states: ["default"],
        source_refs: ["build evidence"],
        evidence_refs: ["visual-qa-evidence"],
      },
    ],
    coverage: [
      {
        check_ids: [checkID],
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
    unresolved_code_module_problems: [],
    repairs: [],
    evidence: [
      {
        check_ids: [checkID],
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

function minimalVisualQaReportWithRequiredReferenceParity() {
  const report = minimalVisualQaReport()
  return {
    ...report,
    reference_parity: {
      required: true,
      required_regions: ["main surface"],
      reference_comparison_evidence_refs: [],
      missing_regions: ["main surface"],
      blocker_ids: ["missing-rendered-reference-comparison"],
    },
  }
}

function minimalVisualQaAcceptance() {
  const issue = "accepted=true was submitted without screenshot comparison or screen-by-screen screenshot evidence."
  return {
    submittedAccepted: true,
    effectiveAccepted: false,
    selfReportIssues: [issue],
    blockingIssues: [issue],
  }
}

function minimalAcceptedVisualQaAcceptance() {
  return {
    submittedAccepted: true,
    effectiveAccepted: true,
    selfReportIssues: [],
    blockingIssues: [],
  }
}

function minimalVisualQaDecisionRecord() {
  return {
    report: minimalVisualQaReport(),
    acceptance: minimalVisualQaAcceptance(),
  }
}

async function writeVisualQaReferenceImage(projectRoot: string, taskID: string): Promise<void> {
  const paths = ProjectRuntimePaths.frontendDesignPaths(projectRoot, taskID)
  await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
  await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 4,
      background: "#e7f5ee",
    },
  })
    .png()
    .toFile(path.join(paths.sourcePackageAbsolute, "reference.png"))
}

async function seedVisualQaReferenceComparisonEvidence(input: {
  projectRoot: string
  taskID: string
  runID: string
  targetID: string
  regionID: string
  viewportID: string
}): Promise<string> {
  const jobID = `art_visualqa_reference_comparison_${Date.now().toString(16)}`
  const outDir = ProjectRuntimePaths.browserPreviewJobRoot(input.projectRoot, input.taskID, jobID)
  const artifactDir = path.join(outDir, "reference-comparison")
  await fs.mkdir(artifactDir, { recursive: true })
  const sourceCrop = path.join(artifactDir, "source.png")
  const implementationCrop = path.join(artifactDir, "implementation.png")
  const sideBySide = path.join(artifactDir, "side-by-side.png")
  const diff = path.join(artifactDir, "diff.png")
  const implementationScreenshot = path.join(artifactDir, "implementation-full.png")
  for (const filePath of [sourceCrop, implementationCrop, sideBySide, diff, implementationScreenshot]) {
    await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 4,
        background: "#e7f5ee",
      },
    })
      .png()
      .toFile(filePath)
  }
  const evidenceID = await persistBrowserPreviewEvidence({
    projectRoot: input.projectRoot,
    taskID: input.taskID,
    runID: input.runID,
    targetID: input.targetID,
    viewportID: input.viewportID,
    operationKind: "reference-comparison",
    regionID: input.regionID,
    cropIntent: "full-region",
    artifactPaths: {
      source_crop: sourceCrop,
      implementation_crop: implementationCrop,
      side_by_side: sideBySide,
      diff,
    },
    status: "passed",
    summary: "seeded Visual QA reference-comparison evidence",
    capture: {
      operation: "reference-comparison",
      status: "passed",
      region: {
        region_id: input.regionID,
        viewport_id: input.viewportID,
        crop_intent: "full-region",
        source_bbox: { x: 0, y: 0, width: 800, height: 600 },
        source_image_size: { width: 800, height: 600 },
        implementation_screenshot_path: implementationScreenshot,
        visual: {
          dimensions_match: true,
          total_pixels: 480_000,
        },
        coverage: {
          implementation_matches_source_size: true,
        },
        content: {
          source: {
            non_white_pixel_ratio: 1,
            unique_color_count: 1,
          },
          implementation: {
            non_white_pixel_ratio: 1,
            unique_color_count: 1,
          },
        },
      },
    },
    diagnostics: ["seeded Visual QA reference-comparison evidence"],
  })
  return `browser_preview_evidence:${evidenceID}`
}

async function startVisualQaMatchingPreviewServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    if (req.url !== "/economy") {
      res.writeHead(404)
      res.end("not found")
      return
    }
    res.writeHead(200, { "content-type": "text/html" })
    res.end(`<!doctype html>
      <html>
        <head>
          <style>
            html, body { margin: 0; width: 800px; height: 600px; background: #e7f5ee; }
            [data-oc-region="economy-page"] {
              position: absolute;
              left: 0;
              top: 0;
              width: 800px;
              height: 600px;
              background: #e7f5ee;
            }
          </style>
        </head>
        <body>
          <section data-oc-region="economy-page"></section>
        </body>
      </html>`)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Visual QA preview server did not bind a port")
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
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

function installBuildRuntimeContract(input: { sessionID: string; taskID: string; goalID: string; goalRunID: string }) {
  const descriptor = WorkerTurnDescriptor.create({
    sessionID: input.sessionID,
    payload: {
      agent: "build",
      roleContractID: "build",
      model: { providerID: "openai", modelID: "gpt-5.5" },
      prompt: { rawSystemPrompt: false },
      tools: {
        enabled: ["request_orchestrator_decision", "report_build_result"],
        terminal: "report_build_result",
      },
      output: { format: "text", resultMode: "reply" },
      workflow: {
        taskID: input.taskID,
        goalID: input.goalID,
        goalRunID: input.goalRunID,
        attemptID: input.goalRunID,
        sessionKind: "build",
      },
    },
  })
  SessionPrompt.setSessionRuntimeContract(input.sessionID, {
    identity: {
      sessionID: input.sessionID,
      agentKind: "build",
      contractKind: "stage-attempt",
      goalID: input.goalID,
      goalRunID: input.goalRunID,
      attemptID: input.goalRunID,
      workerTurnDescriptorID: descriptor.id,
      workerTurnDescriptorHash: descriptor.hash,
      installedAt: Date.now(),
    },
    tools: {
      request_orchestrator_decision: {} as any,
      report_build_result: {} as any,
    },
    system: ["Build runtime contract for request-bound continuation."],
    exactTools: false,
    includeMcpTools: true,
  })
  return descriptor
}

function installIntentAnalysisRuntimeContract(input: { sessionID: string; taskID: string }) {
  const descriptor = WorkerTurnDescriptor.create({
    sessionID: input.sessionID,
    payload: {
      agent: "intent-analysis",
      roleContractID: "intent-analysis",
      model: { providerID: "openai", modelID: "gpt-5.5" },
      prompt: { rawSystemPrompt: false },
      tools: {
        enabled: ["ask_clarification", "extract_slot", "flag_missing_info", "request_orchestrator_decision"],
      },
      output: { format: "json_schema", resultMode: "reply" },
      workflow: {
        taskID: input.taskID,
        sessionKind: "intent-analysis",
      },
    },
  })
  SessionPrompt.setSessionRuntimeContract(input.sessionID, {
    identity: {
      sessionID: input.sessionID,
      agentKind: "intent-analysis",
      contractKind: "stage-attempt",
      workerTurnDescriptorID: descriptor.id,
      workerTurnDescriptorHash: descriptor.hash,
      installedAt: Date.now(),
    },
    tools: {
      ask_clarification: {} as any,
      extract_slot: {} as any,
      flag_missing_info: {} as any,
      request_orchestrator_decision: {} as any,
    },
    system: ["Intent analysis runtime contract for request-bound continuation."],
    structuredOutputGuard: () => {},
    exactTools: true,
    includeMcpTools: false,
  })
  return descriptor
}

function installExploreRuntimeContract(input: { sessionID: string; taskID: string }) {
  const descriptor = WorkerTurnDescriptor.create({
    sessionID: input.sessionID,
    payload: {
      agent: "explore",
      roleContractID: "explore",
      model: { providerID: "openai", modelID: "gpt-5.5" },
      prompt: { rawSystemPrompt: false },
      tools: {
        enabled: [],
      },
      output: { format: "text", resultMode: "reply" },
      workflow: {
        taskID: input.taskID,
        sessionKind: "explore",
      },
    },
  })
  SessionPrompt.setSessionRuntimeContract(input.sessionID, {
    identity: {
      sessionID: input.sessionID,
      agentKind: "explore",
      contractKind: "stage-attempt",
      workerTurnDescriptorID: descriptor.id,
      workerTurnDescriptorHash: descriptor.hash,
      installedAt: Date.now(),
    },
    tools: {},
    system: ["Explore runtime contract for request-bound continuation."],
    exactTools: false,
    includeMcpTools: false,
  })
  return descriptor
}

function installGoalWorkloadRuntimeContract(input: { sessionID: string; taskID: string }) {
  const descriptor = WorkerTurnDescriptor.create({
    sessionID: input.sessionID,
    payload: {
      agent: "goal-workload-analyst",
      roleContractID: "goal-workload-analyst",
      model: { providerID: "openai", modelID: "gpt-5.5" },
      prompt: { rawSystemPrompt: false },
      tools: {
        enabled: ["register_workload_brief", "request_orchestrator_decision", "submit_workload_analysis"],
        terminal: "submit_workload_analysis",
      },
      output: { format: "text", resultMode: "reply" },
      workflow: {
        taskID: input.taskID,
        sessionKind: "goal-workload-analyst",
      },
    },
  })
  SessionPrompt.setSessionRuntimeContract(input.sessionID, {
    identity: {
      sessionID: input.sessionID,
      agentKind: "goal-workload-analyst",
      contractKind: "stage-attempt",
      workerTurnDescriptorID: descriptor.id,
      workerTurnDescriptorHash: descriptor.hash,
      installedAt: Date.now(),
    },
    tools: {
      register_workload_brief: {} as any,
      request_orchestrator_decision: {} as any,
      submit_workload_analysis: {} as any,
    },
    system: ["Goal workload runtime contract for request-bound continuation."],
    exactTools: true,
    includeMcpTools: false,
  })
  return descriptor
}

function installFactCheckRuntimeContract(input: { sessionID: string; taskID: string }) {
  const descriptor = WorkerTurnDescriptor.create({
    sessionID: input.sessionID,
    payload: {
      agent: "fact-check",
      roleContractID: "fact-check",
      model: { providerID: "openai", modelID: "gpt-5.5" },
      prompt: { rawSystemPrompt: false },
      tools: {
        enabled: ["report_fact_check_result"],
        terminal: "report_fact_check_result",
      },
      output: { format: "text", resultMode: "reply" },
      workflow: {
        taskID: input.taskID,
        sessionKind: "fact-check",
      },
    },
  })
  SessionPrompt.setSessionRuntimeContract(input.sessionID, {
    identity: {
      sessionID: input.sessionID,
      agentKind: "fact-check",
      contractKind: "stage-attempt",
      workerTurnDescriptorID: descriptor.id,
      workerTurnDescriptorHash: descriptor.hash,
      installedAt: Date.now(),
    },
    tools: {
      report_fact_check_result: {} as any,
    },
    system: ["Fact-check runtime contract for request-bound continuation."],
    exactTools: true,
    includeMcpTools: false,
  })
  return descriptor
}

function installFrontendResearchRuntimeContract(input: { sessionID: string; taskID: string }) {
  const descriptor = WorkerTurnDescriptor.create({
    sessionID: input.sessionID,
    payload: {
      agent: "frontend-research",
      roleContractID: "frontend-research",
      model: { providerID: "openai", modelID: "gpt-5.5" },
      prompt: { rawSystemPrompt: false },
      tools: {
        enabled: ["skill", "request_orchestrator_decision"],
        terminal: "submit_research_brief",
      },
      output: { format: "text", resultMode: "reply" },
      workflow: {
        taskID: input.taskID,
        sessionKind: "frontend-research",
      },
    },
  })
  SessionPrompt.setSessionRuntimeContract(input.sessionID, {
    identity: {
      sessionID: input.sessionID,
      agentKind: "frontend-research",
      contractKind: "stage-attempt",
      workerTurnDescriptorID: descriptor.id,
      workerTurnDescriptorHash: descriptor.hash,
      installedAt: Date.now(),
    },
    tools: {
      skill: {} as any,
      request_orchestrator_decision: {} as any,
    },
    system: ["Frontend research runtime contract for request-bound continuation."],
    exactTools: true,
    includeMcpTools: false,
  })
  return descriptor
}

function installFrontendDesignRuntimeContract(input: { sessionID: string; taskID: string }) {
  const descriptor = WorkerTurnDescriptor.create({
    sessionID: input.sessionID,
    payload: {
      agent: "frontend-design",
      roleContractID: "frontend-design",
      model: { providerID: "openai", modelID: "gpt-5.5" },
      prompt: { rawSystemPrompt: false },
      tools: {
        enabled: ["skill", "request_orchestrator_decision"],
        terminal: "submit_frontend_template",
      },
      output: { format: "text", resultMode: "reply" },
      workflow: {
        taskID: input.taskID,
        sessionKind: "frontend-design",
      },
    },
  })
  SessionPrompt.setSessionRuntimeContract(input.sessionID, {
    identity: {
      sessionID: input.sessionID,
      agentKind: "frontend-design",
      contractKind: "stage-attempt",
      workerTurnDescriptorID: descriptor.id,
      workerTurnDescriptorHash: descriptor.hash,
      installedAt: Date.now(),
    },
    tools: {
      skill: {} as any,
      request_orchestrator_decision: {} as any,
    },
    system: ["Frontend design runtime contract for request-bound continuation."],
    exactTools: true,
    includeMcpTools: false,
  })
  return descriptor
}

function installVisualQaRuntimeContract(input: { sessionID: string; taskID: string }) {
  const descriptor = WorkerTurnDescriptor.create({
    sessionID: input.sessionID,
    payload: {
      agent: "visual-qa",
      roleContractID: "visual-qa",
      model: { providerID: "openai", modelID: "gpt-5.5" },
      prompt: { rawSystemPrompt: false },
      tools: {
        enabled: ["skill", "request_orchestrator_decision"],
        terminal: "submit_visual_qa_report",
      },
      output: { format: "text", resultMode: "reply" },
      workflow: {
        taskID: input.taskID,
        sessionKind: "visual-qa",
      },
    },
  })
  SessionPrompt.setSessionRuntimeContract(input.sessionID, {
    identity: {
      sessionID: input.sessionID,
      agentKind: "visual-qa",
      contractKind: "stage-attempt",
      workerTurnDescriptorID: descriptor.id,
      workerTurnDescriptorHash: descriptor.hash,
      installedAt: Date.now(),
    },
    tools: {
      skill: {} as any,
      request_orchestrator_decision: {} as any,
    },
    system: ["Visual QA runtime contract for request-bound continuation."],
    exactTools: true,
    includeMcpTools: false,
  })
  return descriptor
}

function installIntegrityRuntimeContract(input: { sessionID: string; taskID: string }) {
  const descriptor = WorkerTurnDescriptor.create({
    sessionID: input.sessionID,
    payload: {
      agent: "integrity",
      roleContractID: "integrity",
      model: { providerID: "openai", modelID: "gpt-5.5" },
      prompt: { rawSystemPrompt: false },
      tools: {
        enabled: ["skill", "request_orchestrator_decision"],
        terminal: "submit_integrity_consensus",
      },
      output: { format: "text", resultMode: "reply" },
      workflow: {
        taskID: input.taskID,
        sessionKind: "integrity",
      },
    },
  })
  SessionPrompt.setSessionRuntimeContract(input.sessionID, {
    identity: {
      sessionID: input.sessionID,
      agentKind: "integrity",
      contractKind: "stage-attempt",
      workerTurnDescriptorID: descriptor.id,
      workerTurnDescriptorHash: descriptor.hash,
      installedAt: Date.now(),
    },
    tools: {
      skill: {} as any,
      request_orchestrator_decision: {} as any,
    },
    system: ["Integrity runtime contract for request-bound continuation."],
    exactTools: true,
    includeMcpTools: false,
  })
  return descriptor
}

function installDeepResearchRuntimeContract(input: { sessionID: string; taskID: string }) {
  const descriptor = WorkerTurnDescriptor.create({
    sessionID: input.sessionID,
    payload: {
      agent: "deep-research",
      roleContractID: "deep-research",
      model: { providerID: "openai", modelID: "gpt-5.5" },
      prompt: { rawSystemPrompt: false },
      tools: {
        enabled: ["skill", "request_orchestrator_decision"],
        terminal: "submit_research_brief",
      },
      output: { format: "text", resultMode: "reply" },
      workflow: {
        taskID: input.taskID,
        sessionKind: "deep-research",
      },
    },
  })
  SessionPrompt.setSessionRuntimeContract(input.sessionID, {
    identity: {
      sessionID: input.sessionID,
      agentKind: "deep-research",
      contractKind: "stage-attempt",
      workerTurnDescriptorID: descriptor.id,
      workerTurnDescriptorHash: descriptor.hash,
      installedAt: Date.now(),
    },
    tools: {
      skill: {} as any,
      request_orchestrator_decision: {} as any,
    },
    system: ["Deep research runtime contract for request-bound continuation."],
    exactTools: true,
    includeMcpTools: false,
  })
  return descriptor
}

function installRequirementsRuntimeContract(input: { sessionID: string; taskID: string }) {
  const descriptor = WorkerTurnDescriptor.create({
    sessionID: input.sessionID,
    payload: {
      agent: "requirements",
      roleContractID: "requirements",
      model: { providerID: "openai", modelID: "gpt-5.5" },
      prompt: { rawSystemPrompt: false },
      tools: {
        enabled: ["skill", "request_orchestrator_decision"],
        terminal: "submit_requirements",
      },
      output: { format: "text", resultMode: "reply" },
      workflow: {
        taskID: input.taskID,
        sessionKind: "requirements",
      },
    },
  })
  SessionPrompt.setSessionRuntimeContract(input.sessionID, {
    identity: {
      sessionID: input.sessionID,
      agentKind: "requirements",
      contractKind: "stage-attempt",
      workerTurnDescriptorID: descriptor.id,
      workerTurnDescriptorHash: descriptor.hash,
      installedAt: Date.now(),
    },
    tools: {
      skill: {} as any,
      request_orchestrator_decision: {} as any,
    },
    system: ["Requirements runtime contract for request-bound continuation."],
    exactTools: true,
    includeMcpTools: false,
  })
  return descriptor
}

function installArchitectRuntimeContract(input: { sessionID: string; taskID: string }) {
  const descriptor = WorkerTurnDescriptor.create({
    sessionID: input.sessionID,
    payload: {
      agent: "architect",
      roleContractID: "architect",
      model: { providerID: "openai", modelID: "gpt-5.5" },
      prompt: { rawSystemPrompt: false },
      tools: {
        enabled: ["skill", "request_orchestrator_decision"],
        terminal: "submit_architect",
      },
      output: { format: "text", resultMode: "reply" },
      workflow: {
        taskID: input.taskID,
        sessionKind: "architect",
      },
    },
  })
  SessionPrompt.setSessionRuntimeContract(input.sessionID, {
    identity: {
      sessionID: input.sessionID,
      agentKind: "architect",
      contractKind: "stage-attempt",
      workerTurnDescriptorID: descriptor.id,
      workerTurnDescriptorHash: descriptor.hash,
      installedAt: Date.now(),
    },
    tools: {
      skill: {} as any,
      request_orchestrator_decision: {} as any,
    },
    system: ["Architect runtime contract for request-bound continuation."],
    exactTools: true,
    includeMcpTools: false,
  })
  return descriptor
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
  await waitForCondition(`goal ${goalID} status ${status}`, async () => {
    if (goalStatusByID(goalID) !== status) return false
    if (status !== "passed") return true
    const workspace = findGoalLatestWorkspace(goalID)
    if (!workspace.directory) return true
    const normalized = workspace.directory.replace(/\\/g, "/")
    if (!normalized.includes("/.opencorvus/r/w/")) return true
    return !(await Filesystem.exists(workspace.directory))
  })
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
    checkIDs: ["check-requirements"],
    severity:
      input.severity ?? ((input.verdictImpact ?? "needs_correction") === "needs_correction" ? "blocking" : "advisory"),
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
    checkIDs: ["check-requirements"],
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
  const requirementCheckStatus = verdict === "needs_correction" ? "failed" : "passed"
  const acceptanceCheckStatus = verdict === "pass" ? "passed" : "inconclusive"
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
    checkItems: [
      {
        id: "check-requirements",
        reviewerID: "requirements_surface",
        category: "requirement",
        target: "Requirement fidelity",
        question: "Do requirements match the requested behavior?",
        status: requirementCheckStatus,
        expected: "Requirements and implementation evidence satisfy the request.",
        observed: summary,
        evidence: ["Mock requirement evidence."],
        requirementIDs: [],
        specIDs: [],
        targetIDs: [],
        userRequestQuotes: [],
      },
      {
        id: "check-acceptance",
        reviewerID: "acceptance_surface",
        category: "acceptance",
        target: "Acceptance and implementation evidence",
        question: "Does acceptance evidence support the integrity verdict?",
        status: acceptanceCheckStatus,
        expected: "Acceptance evidence is acceptable.",
        observed: verdict === "pass" ? "Acceptance evidence is acceptable." : summary,
        evidence: ["Mock acceptance evidence."],
        requirementIDs: [],
        specIDs: [],
        targetIDs: [],
        userRequestQuotes: [],
      },
    ],
    reviewers: [
      {
        reviewerID: "requirements_surface",
        checkIDs: ["check-requirements"],
        scope: "Requirement fidelity",
        verdict: requirementsVerdict,
        summary,
        investigationPlan: {
          requestPromise: "Requirements match the requested behavior.",
          hypothesis: "Requirements may omit the requested behavior.",
          evidencePlan: ["Inspect requirement fidelity evidence."],
          passCriteria: ["Requirement fidelity evidence supports the request."],
        },
        drilldowns: [
          {
            checkIDs: ["check-requirements"],
            kind: "mock_integrity_evidence",
            target: "Requirement fidelity",
            purpose: "Exercise orchestrator integrity persistence.",
            result: "Mock requirement evidence.",
          },
        ],
        coverage: [
          {
            checkIDs: ["check-requirements"],
            userRequestQuote: "requirements match request",
            status: verdict === "needs_correction" ? "missing" : "covered",
            evidence: "Mock requirement evidence.",
          },
        ],
        evidence: [{ checkIDs: ["check-requirements"], note: "Mock requirement evidence." }],
        openQuestions: [],
      },
      {
        reviewerID: "acceptance_surface",
        checkIDs: ["check-acceptance"],
        scope: "Acceptance and implementation evidence",
        verdict: acceptanceVerdict,
        summary: verdict === "pass" ? "Acceptance evidence is acceptable." : summary,
        investigationPlan: {
          requestPromise: "Acceptance evidence supports the delivered implementation.",
          hypothesis: "Acceptance evidence may be incomplete.",
          evidencePlan: ["Inspect acceptance evidence."],
          passCriteria: ["Acceptance evidence supports the delivered implementation."],
        },
        drilldowns: [
          {
            checkIDs: ["check-acceptance"],
            kind: "mock_integrity_evidence",
            target: "Acceptance and implementation evidence",
            purpose: "Exercise orchestrator integrity persistence.",
            result: "Mock acceptance evidence.",
          },
        ],
        coverage: [
          {
            checkIDs: ["check-acceptance"],
            userRequestQuote: "acceptance evidence supports implementation",
            status: verdict === "pass" ? "covered" : "inconclusive",
            evidence: "Mock acceptance evidence.",
          },
        ],
        evidence: [{ checkIDs: ["check-acceptance"], note: "Mock acceptance evidence." }],
        openQuestions: [],
      },
    ],
    findings,
    coverageAudit: [
      {
        checkIDs: ["check-requirements", "check-acceptance"],
        promise: "Mock integrity task promises were reviewed.",
        reviewerIDs: ["requirements_surface", "acceptance_surface"],
        status: verdict === "pass" ? "covered" : "inconclusive",
        notes: summary,
      },
    ],
    uninspectedRisks: [],
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

mock.module("@/intent-analysis/agent", () => ({
  IntentAnalysisAgent: {
    analyze: (input: any) => {
      if (!intentAnalysisAnalyzeImpl) throw new Error("IntentAnalysisAgent.analyze mock not configured")
      return intentAnalysisAnalyzeImpl(input)
    },
  },
}))

mock.module("@/explore/agent", () => ({
  ExploreAgent: {
    run: (input: any) => {
      if (!exploreRunImpl) throw new Error("ExploreAgent.run mock not configured")
      return exploreRunImpl(input)
    },
  },
}))

mock.module("@/goal-workload-analyst", () => ({
  GoalWorkloadAnalystAgent: {
    analyze: (input: any) => {
      if (!goalWorkloadAnalyzeImpl) throw new Error("GoalWorkloadAnalystAgent.analyze mock not configured")
      return goalWorkloadAnalyzeImpl(input)
    },
  },
}))

mock.module("@/fact-check", () => ({
  FactCheckAgent: {
    run: (input: any) => {
      if (!factCheckAgentRunImpl) throw new Error("FactCheckAgent.run mock not configured")
      return factCheckAgentRunImpl(input)
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
    worktreeDir: input.managedWorktree?.directory ?? input.workDir,
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
        evidenceDecision: {
          status: "passed",
          summary: "Acceptance evidence passed 0 required check(s).",
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
  acceptanceSpecs?: unknown[]
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
        acceptance_specs: input.acceptanceSpecs ?? [],
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

async function seedLatestAssistantError(input: {
  sessionID: string
  now: number
  agent?: string
  error: NonNullable<Message.Assistant["error"]>
}) {
  const agent = input.agent ?? "build"
  const userMessageID = Identifier.ascending("message")
  await Session.updateMessage({
    id: userMessageID,
    sessionID: input.sessionID,
    role: "user",
    time: { created: input.now },
    agent,
    model: { providerID: "test", modelID: "test-model" },
  } satisfies Message.User)
  await Session.updateMessage({
    id: Identifier.ascending("message"),
    sessionID: input.sessionID,
    role: "assistant",
    parentID: userMessageID,
    agent,
    modelID: "test-model",
    providerID: "test",
    path: { cwd: Instance.directory, root: Instance.worktree },
    cost: 0,
    tokens: { total: 171_746, input: 8_144, output: 148, reasoning: 0, cache: { read: 163_454, write: 0 } },
    error: input.error,
    finish: "error",
    time: { created: input.now + 1, completed: input.now + 2 },
  } satisfies Message.Assistant)
}

async function seedLatestAssistantUsage(input: {
  sessionID: string
  now: number
  inputTokens: number
  totalTokens?: number
}) {
  const userMessageID = Identifier.ascending("message")
  await Session.updateMessage({
    id: userMessageID,
    sessionID: input.sessionID,
    role: "user",
    time: { created: input.now },
    agent: "build",
    model: { providerID: "mock-control", modelID: "control" },
  } satisfies Message.User)
  await Session.updateMessage({
    id: Identifier.ascending("message"),
    sessionID: input.sessionID,
    role: "assistant",
    parentID: userMessageID,
    agent: "build",
    modelID: "control",
    providerID: "mock-control",
    path: { cwd: Instance.directory, root: Instance.worktree },
    cost: 0,
    tokens: {
      total: input.totalTokens ?? input.inputTokens + 100,
      input: input.inputTokens,
      output: 100,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    finish: "stop",
    time: { created: input.now + 1, completed: input.now + 2 },
  } satisfies Message.Assistant)
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

  beforeEach(
    async () => {
      await resetDatabase()
      tmp = await tmpdir()
      requirementsRunImpl = undefined
      architectCoordinateImpl = undefined
      designAnalyzeImpl = undefined
      frontendResearchRunImpl = undefined
      deepResearchRunImpl = undefined
      intentAnalysisAnalyzeImpl = undefined
      exploreRunImpl = undefined
      goalWorkloadAnalyzeImpl = undefined
      factCheckAgentRunImpl = undefined
      visualQaAnalyzeImpl = undefined
      mcpServerToolsImpl = undefined
      mcpCallToolImpl = undefined
      reviewIntegrityImpl = async () => integrityTeamResult({ sessionID: "ses_integrity_default" })
    },
    { timeout: ORCHESTRATOR_TOOLS_TEST_TIMEOUT_MS },
  )

  afterEach(
    async () => {
      buildAgentRunImpl = undefined
      reviewIntegrityImpl = undefined
      computeRequirementStatusSnapshotImpl = undefined
      requirementsRunImpl = undefined
      architectCoordinateImpl = undefined
      designAnalyzeImpl = undefined
      frontendResearchRunImpl = undefined
      deepResearchRunImpl = undefined
      intentAnalysisAnalyzeImpl = undefined
      exploreRunImpl = undefined
      goalWorkloadAnalyzeImpl = undefined
      factCheckAgentRunImpl = undefined
      visualQaAnalyzeImpl = undefined
      mcpServerToolsImpl = undefined
      mcpCallToolImpl = undefined
      ExecutorRegistry.reset()
      mock.restore()
      await resetDatabase()
      await tmp?.[Symbol.asyncDispose]?.()
    },
    { timeout: ORCHESTRATOR_TOOLS_TEST_TIMEOUT_MS },
  )

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
    await writeProjectExpertSquadPackage(tmp.path)
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
          request:
            "Use the frontend innovate expert squad for an existing URL redesign with aesthetic, professional, and convenient user-task goals.",
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
        expect(Object.keys(tools)).not.toContain("source-evidence")
        expect(Object.keys(tools)).not.toContain("build-evidence")
        expect(Object.keys(tools)).not.toContain("package-browser")

        const result = await tools.select_expert_squad.execute(
          {
            profile_id: "frontend-innovate",
            reason:
              "The current task requires existing URL redesign from Figma, screenshots, task convenience, and accessibility evidence.",
          },
          buildToolOptions("select_expert_squad"),
        )
        expect(toolText(result)).toContain("- previous: general")
        expect(toolText(result)).toContain("- active: frontend-innovate")
        expect((await Session.get(root.id)).metadata?.configOverlay).toMatchObject({
          prompt_profile: { active: "frontend-innovate" },
        })

        const projectPackageResult = await tools.select_expert_squad.execute(
          {
            profile_id: PROJECT_EXPERT_SQUAD_ID,
            reason: "The current task requires the project-local expert squad package.",
          },
          buildToolOptions("select_expert_squad_project_package"),
        )
        expect(toolText(projectPackageResult)).toContain("- previous: frontend-innovate")
        expect(toolText(projectPackageResult)).toContain(`- active: ${PROJECT_EXPERT_SQUAD_ID}`)
        expect((await Session.get(root.id)).metadata?.configOverlay).toMatchObject({
          prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID },
        })

        await expect(
          tools.select_expert_squad.execute(
            { profile_id: "missing-profile", reason: "Unknown expert squad must not be persisted." },
            buildToolOptions("select_expert_squad_unknown"),
          ),
        ).rejects.toThrow("Unknown prompt profile")
        expect((await Session.get(root.id)).metadata?.configOverlay).toMatchObject({
          prompt_profile: { active: PROJECT_EXPERT_SQUAD_ID },
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
    const now = Date.now()
    const projectID = `project_operator_projection_${now.toString(16)}`
    const taskID = `tsk_operator_projection_${now.toString(16)}`
    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: tmp.path,
          name: "operator projection project",
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
          title: "Operator projection task",
          request: "Read the current wake message.",
          priority: "normal",
          time_created: now,
          time_updated: now,
          time_started: now,
        })
        .run()
    })
    const injectMessage = spyOn(EngineService, "injectMessage").mockResolvedValue({
      appended: true,
      orchestratorWoken: true,
      executorResumed: false,
      status: "active",
    })
    const { tools } = createOrchestratorTools({
      taskID,
      agentSessionID: "ses_orchestrator_projection",
      signal: new AbortController().signal,
      operatorMessage: {
        text: "resume only the failed build",
        source: "panel",
        messageID: "msg_operator_projection",
      },
    })

    const result = await tools.inject_operator_message.execute(
      { reason: "need the latest operator guidance" },
      buildToolOptions("inject_operator_message"),
    )

    expect(injectMessage).not.toHaveBeenCalled()
    expect(toolText(result)).toContain("Operator message is already recorded")
    expect(toolText(result)).toContain("source=panel")
    expect(toolText(result)).toContain("messageID=msg_operator_projection")
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

  test("post-build integrity pass records report evidence but does not complete the task", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_integrity_no_auto_complete_${stamp}`
    const taskID = `tsk_integrity_no_auto_complete_${stamp}`
    const goalID = `gol_integrity_no_auto_complete_${stamp}`
    const specID = `spec_integrity_no_auto_complete_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "integrity no auto complete" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          specID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Integrity no auto complete",
          taskTitle: "Integrity no auto complete",
          request: "prove integrity pass is evidence only",
          goalTitle: "Build terminal evidence",
          goalSlug: "build-terminal-evidence",
          objective: "Produce terminal build evidence",
          now,
          insertProject: false,
        })
        computeRequirementStatusSnapshotImpl = () => [
          {
            requirementID: "REQ-1",
            claimingGoals: [{ goalID, runStatus: "completed" }],
          },
        ]
        reviewIntegrityImpl = async () =>
          integrityTeamResult({
            sessionID: "ses_integrity_no_auto_complete",
            verdict: "pass",
            summary: "Post-build integrity passed",
          })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.integrity.execute(
          { reason: "post-build completion evidence" },
          buildToolOptions("integrity"),
        )

        const text = toolText(result)
        expect(text).toContain("Pass report persisted")
        expect(text).toContain("completion summary")
        expect(text).toContain("integrity_attempt_id")
        expect(deriveTaskStatus(findTask(taskID)!)).toBe("active")
        const latest = findLatestIntegrityAttemptArtifact({ taskID, specSnapshotID: specID, phase: "post_build" })
        expect(latest?.artifactID).toBeTruthy()
      },
    })
  })

  test("post-build integrity non-pass records a completed review step event", async () => {
    const now = Date.now()
    const stamp = `${now.toString(16)}_non_pass_step`
    const taskID = `tsk_integrity_non_pass_step_${stamp}`
    const goalID = `gol_integrity_non_pass_step_${stamp}`
    const specID = `spec_integrity_non_pass_step_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "integrity non-pass completed step" })
        const pipeline = WorkflowRegistry.resolveSync("pipeline")!
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          specID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Integrity non-pass completed step",
          taskTitle: "Integrity non-pass completed step",
          request: "prove non-pass integrity is still a completed review report",
          goalTitle: "Build terminal evidence",
          goalSlug: "build-terminal-evidence",
          objective: "Produce terminal build evidence",
          now,
          insertProject: false,
        })
        computeRequirementStatusSnapshotImpl = () => [
          {
            requirementID: "REQ-1",
            claimingGoals: [{ goalID, runStatus: "completed" }],
          },
        ]
        reviewIntegrityImpl = async () =>
          integrityTeamResult({
            sessionID: "ses_integrity_non_pass_step",
            verdict: "needs_correction",
            summary: "Post-build integrity found a repair.",
            findings: [
              integrityFinding({
                id: "finding-non-pass-step",
                description: "A blocking repair remains.",
                targetIDs: [goalID],
              }),
            ],
            requiredRepairs: [
              integrityRepair({
                id: "repair-non-pass-step",
                description: "Repair the blocking issue.",
                targetIDs: [goalID],
              }),
            ],
          })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
          workflow: pipeline,
          workflowState: createWorkflowState(pipeline),
        })

        await tools.integrity.execute({ reason: "post-build repair evidence" }, buildToolOptions("integrity"))

        const statuses = Database.use((db) =>
          db
            .select({ payload: ProtocolEventTable.payload })
            .from(ProtocolEventTable)
            .where(and(eq(ProtocolEventTable.task_id, taskID), eq(ProtocolEventTable.type, "workflow.step.updated")))
            .all()
            .filter((event) => event.payload?.stepID === "integrity")
            .map((event) => String(event.payload?.status ?? "")),
        )
        expect(statuses).toEqual(["running", "completed"])
      },
    })
  })

  test("complete_task completes from explicit orchestrator summary without requiring integrity attempt", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_complete_task_${stamp}`
    const taskID = `tsk_complete_task_${stamp}`
    const goalID = `gol_complete_task_${stamp}`
    const specID = `spec_complete_task_${stamp}`
    const interruptTaskLoop = spyOn(TaskLoop, "interruptTaskLoop")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "complete_task parent" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          specID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Complete task project",
          taskTitle: "Complete task",
          request: "prove complete_task is explicit",
          goalTitle: "Build complete evidence",
          goalSlug: "build-complete-evidence",
          objective: "Produce completion evidence",
          now,
          insertProject: false,
        })
        const run = createRun({
          taskID,
          planVersionID: null,
          sessionID: parent.id,
          executor: "opencorvus",
          status: "running",
          phase: "execute",
          summary: "active run",
          now,
        })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.complete_task.execute(
          { summary: "Explicit Orchestrator completion from durable task evidence" },
          buildToolOptions("complete_task"),
        )

        expect(toolText(result)).toContain(`Task ${taskID} completed`)
        expect(toolText(result)).toContain("Explicit Orchestrator completion from durable task evidence")
        expect(deriveTaskStatus(findTask(taskID)!)).toBe("completed")
        expect(findRun(run.id)?.status).toBe("completed")
        expect(interruptTaskLoop).toHaveBeenCalledWith(taskID, "task completed")
      },
    })
  })

  test("complete_task rejects empty summary and terminal tasks without an integrity evidence gate", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_complete_task_reject_${stamp}`
    const taskID = `tsk_complete_task_reject_${stamp}`
    const goalID = `gol_complete_task_reject_${stamp}`
    const specID = `spec_complete_task_reject_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "complete_task rejection parent" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          specID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Complete task rejection project",
          taskTitle: "Complete task rejection",
          request: "reject invalid completion evidence",
          goalTitle: "Build rejection evidence",
          goalSlug: "build-rejection-evidence",
          objective: "Produce rejection evidence",
          now,
          insertProject: false,
        })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const emptySummaryResult = await tools.complete_task.execute(
          { summary: "   " },
          buildToolOptions("complete_task_empty_summary"),
        )

        expect(toolText(emptySummaryResult)).toContain("summary is required")
        expect(deriveTaskStatus(findTask(taskID)!)).toBe("active")

        const completed = await tools.complete_task.execute(
          { summary: "Completed by Orchestrator after reviewing durable evidence" },
          buildToolOptions("complete_task"),
        )
        expect(toolText(completed)).toContain(`Task ${taskID} completed`)

        const terminalResult = await tools.complete_task.execute(
          { summary: "duplicate completion" },
          buildToolOptions("complete_task_terminal"),
        )
        expect(toolText(terminalResult)).toContain(`Task ${taskID} is terminal (status=completed)`)
        expect(toolText(terminalResult)).toContain("complete_task was not executed")
      },
    })
  })

  test("orchestrator task-level tools refuse terminal tasks before executing", async () => {
    const now = Date.now()
    const taskID = `tsk_terminal_tool_refusal_${now.toString(16)}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "terminal tool refusal parent" })
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: parent.id,
              source: "test",
              title: "Terminal tool refusal task",
              request: "already complete",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now - 1,
              time_completed: now,
            })
            .run(),
        )
        const injectMessage = spyOn(EngineService, "injectMessage").mockResolvedValue({
          appended: true,
          orchestratorWoken: true,
          executorResumed: false,
          status: "active",
        })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.inject_operator_message.execute(
          { reason: "operator asked for more work" },
          buildToolOptions("inject_operator_message"),
        )

        expect(toolText(result)).toContain(`Task ${taskID} is terminal (status=completed)`)
        expect(toolText(result)).toContain("Task-level scheduler tools may act only while the task is active")
        expect(injectMessage).not.toHaveBeenCalled()
        expect(deriveTaskStatus(findTask(taskID)!)).toBe("completed")
      },
    })
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
    const taskID = `tsk_audit_drift_${stamp}`
    const goalID = `gol_audit_drift_${stamp}`

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
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
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
          insertProject: false,
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

  test("goal build rejects persisted contract graph blockers before build starts", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_graph_blocker_${stamp}`
    const goalID = `gol_graph_blocker_${stamp}`

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
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          sessionID: null,
          worktree: tmp.path,
          projectName: "contract graph blocker predispatch",
          taskTitle: "contract graph blocker predispatch",
          request: "Reject persisted graph blockers before build",
          goalTitle: "Build invalid graph goal",
          goalSlug: "build-invalid-graph-goal",
          objective: "Attempt to build a goal whose persisted graph contains a blocker finding.",
          now,
          acceptanceSpecs: [
            {
              id: "acc-contract-graph-blocker",
              source_requirement_id: "REQ-1",
              goal_id: goalID,
              title: "Contract graph blocker",
              severity: "essential",
              scorers: [
                {
                  type: "contract_audit",
                  name: "graph-contract",
                  spec: { kind: "contract_graph", contract_ids: ["contract_scaffold_app_root"] },
                  expect: { status: "passed" },
                },
              ],
            },
          ],
          insertProject: false,
        })
        insertArchitectContractGraphArtifact({
          taskID,
          now: now + 1,
          graph: {
            version: 1,
            contracts: [
              {
                id: "contract_scaffold_app_root",
                kind: "render_surface",
                name: "Production app root scaffold",
                producer_goal_id: goalID,
                consumer_goal_ids: [],
                summary: "Production app root source files consumed by downstream UI goals.",
                artifact_paths: ["package.json", "index.html", "src/**", "public/**", "docs/blank-template-blocker.md"],
              },
            ],
            dependency_contracts: [],
          },
        })
        const parent = await Session.create({ kind: "root", title: "contract graph blocker predispatch" })
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
              reason: "Per-goal build should reject persisted contract graph blockers before starting build.",
            },
            buildToolOptions(),
          ),
        ).rejects.toThrow("render_surface_non_render_artifact_path")
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
          type: "idle",
        })
      },
    })
  })

  test("frontend_research marks a persisted failed child session terminal", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_frontend_research_persisted_failure_${stamp}`
    const taskID = `tsk_frontend_research_persisted_failure_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "frontend research persisted failure parent" })
        Database.use((db) => {
          db.insert(ProjectTable)
            .values({
              id: projectID,
              worktree: tmp.path,
              name: "Frontend research persisted failure project",
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
              title: "Frontend research persisted failure task",
              request: "Investigate a webpage before implementation.",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()
        })

        let childSessionID = ""
        frontendResearchRunImpl = async (input: any) => {
          const child = await Session.create({
            kind: "frontend-research",
            parentID: parent.id,
            title: "frontend research failed child",
          })
          childSessionID = child.id
          input.onSessionCreated?.(child.id)
          throw new Error("frontend research agent crashed after session persistence")
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
        expect(toolText(result)).toContain(`- session: ${childSessionID}`)
        expect(toolText(result)).toContain("frontend research agent crashed after session persistence")
        expect(SessionStatus.get(childSessionID)).toEqual({
          type: "terminal",
          reason: "error",
          error: "frontend research agent crashed after session persistence",
        })
      },
    })
  })

  test("requirements persists a spec snapshot through the shared stage dispatcher", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_requirements_dispatch_${stamp}`
    const taskID = `tsk_requirements_dispatch_${stamp}`
    const goalID = `gol_requirements_dispatch_${stamp}`
    let requirementsInput: any
    let childSessionID = ""

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "requirements dispatcher",
      taskTitle: "requirements dispatcher",
      request: "Define requirements for a durable A2A mailbox.",
      goalTitle: "Collect requirements",
      goalSlug: "collect-requirements",
      objective: "Persist requirements through the ordinary requirements tool path",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "requirements dispatcher root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        requirementsRunImpl = async (input: any) => {
          requirementsInput = input
          const child = await Session.create({
            kind: "requirements",
            parentID: parent.id,
            title: "requirements dispatcher worker",
          })
          childSessionID = child.id
          input.onSessionCreated?.(child.id)
          return minimalRequirementsResult({ sessionID: child.id })
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.requirements.execute(
          { reason: "Need durable protocol requirements before architecture." },
          buildToolOptions("requirements"),
        )

        expect(toolText(result)).toContain("SUCCESS: 1 requirements, 1 decisions parsed.")
        expect(requirementsInput.parentSessionID).toBe(parent.id)
        expect(requirementsInput.taskID).toBe(taskID)
        expect(requirementsInput.reason).toBeUndefined()
        const activeSpec = findActiveSpecForTask(taskID)
        expect(activeSpec?.summary).toBe("Recovered requirements result.")
        const rows = activeSpec ? findRequirements(activeSpec.id) : []
        expect(rows).toHaveLength(1)
        expect(rows[0]?.description).toBe("Persist a durable A2A coordination mailbox.")
        expect(childSessionID).toMatch(/^ses_/)
      },
    })
  })

  test("deep_research persists a research brief through the shared stage dispatcher", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_deep_research_dispatch_${stamp}`
    const taskID = `tsk_deep_research_dispatch_${stamp}`
    const goalID = `gol_deep_research_dispatch_${stamp}`
    const sourceURLs = ["https://example.com/deep-source"]
    let deepResearchInput: any
    let childSessionID = ""

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "deep research dispatcher",
      taskTitle: "deep research dispatcher",
      request: "Collect source-backed research before implementation.",
      goalTitle: "Collect deep research",
      goalSlug: "collect-deep-research",
      objective: "Persist a research_brief through the ordinary deep_research tool path",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "deep research dispatcher root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        deepResearchRunImpl = async (input: any) => {
          deepResearchInput = input
          const child = await Session.create({
            kind: "deep-research",
            parentID: parent.id,
            title: "deep research dispatcher worker",
          })
          childSessionID = child.id
          input.onSessionCreated?.(child.id)
          return {
            sessionID: child.id,
            brief: minimalDeepResearchBrief({ taskID, sessionID: child.id }),
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.deep_research.execute(
          {
            reason: "Need external source-backed implementation facts.",
            target_deliverable: "research_report",
            source_urls: sourceURLs,
            focus: "Focus on durable source facts.",
          },
          buildToolOptions("deep_research"),
        )

        expect(toolText(result)).toContain("Deep research brief persisted as advisory evidence.")
        expect(toolText(result)).toContain("- artifact_id: art_")
        expect(deepResearchInput.parentSessionID).toBe(parent.id)
        expect(deepResearchInput.taskID).toBe(taskID)
        expect(deepResearchInput.targetDeliverable).toBe("research_report")
        expect(deepResearchInput.sourceUrls).toEqual(sourceURLs)
        expect(deepResearchInput.focus).toBe("Focus on durable source facts.")
        expect(deepResearchInput.reason).toBe("Need external source-backed implementation facts.")

        const briefArtifacts = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "research_brief")))
            .all(),
        )
        expect(briefArtifacts).toHaveLength(1)
        expect(briefArtifacts[0]?.payload.metadata.research_session_id).toBe(childSessionID)
      },
    })
  })

  test("visual_qa records a report through the shared stage dispatcher", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_visual_qa_dispatch_${stamp}`
    const goalID = `gol_visual_qa_dispatch_${stamp}`
    let visualQaInput: any
    let childSessionID = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "visual qa dispatcher root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "visual qa dispatcher",
          taskTitle: "visual qa dispatcher",
          request: "Review the browser-visible surface before final integrity.",
          goalTitle: "Review visible surface",
          goalSlug: "review-visible-surface",
          objective: "Record visual QA evidence through the ordinary visual_qa tool path",
          now,
          acceptanceSpecs: [
            {
              id: "acc-visual-evidence-dispatch",
              source_requirement_id: "REQ-visual-dispatch",
              goal_id: goalID,
              title: "final rendered reference evidence",
              scorers: [
                {
                  type: "prebuilt",
                  name: "visual-feedback-verification",
                  spec: { kind: "visual_feedback_verification", viewport: "desktop-primary" },
                },
              ],
              severity: "essential",
            },
          ],
          insertProject: false,
        })
        const run = createRun({
          taskID,
          planVersionID: null,
          sessionID: parent.id,
          executor: "opencorvus",
          status: "running",
          phase: "execute",
          summary: "active visual qa run",
          now,
        })
        visualQaAnalyzeImpl = async (input: any) => {
          visualQaInput = input
          const child = await Session.create({
            kind: "visual-qa",
            parentID: parent.id,
            title: "visual qa dispatcher worker",
          })
          childSessionID = child.id
          input.onSessionCreated?.(child.id)
          return {
            sessionID: child.id,
            report: minimalVisualQaReportWithRequiredReferenceParity(),
            acceptance: minimalVisualQaAcceptance(),
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.visual_qa.execute(
          {
            reason: "Need final frontend GUI review.",
            focus: "Main screen",
            app_url: "http://127.0.0.1:5173",
            preview_command: "npm run dev",
          },
          buildToolOptions("visual_qa"),
        )

        const firstResultText = toolText(result)
        expect(firstResultText).toContain("visual_qa complete: effective_accepted=false")
        expect(firstResultText).toContain("visual_feedback_verification_failed_attempts")
        expect(firstResultText).toContain("1")
        expect(firstResultText).not.toContain("visual_feedback_next_action")
        expect(visualQaInput.parentSessionID).toBe(parent.id)
        expect(visualQaInput.taskID).toBe(taskID)
        expect(visualQaInput.reason).toBe("Need final frontend GUI review.")
        expect(visualQaInput.focus).toBe("Main screen")
        expect(visualQaInput.appUrl).toBe("http://127.0.0.1:5173")
        expect(visualQaInput.previewCommand).toBe("npm run dev")
        expect(childSessionID).toMatch(/^ses_/)
        const visualQaDecisions = createDecisionLog(taskID).readByPhase("visual_qa")
        expect(visualQaDecisions.some((entry) => entry.key === "latest_summary")).toBe(true)
        expect(visualQaDecisions.some((entry) => entry.value.includes("effective_accepted=false"))).toBe(true)
        expect(visualQaDecisions.some((entry) => entry.value.includes("Recovered visual QA report."))).toBe(true)
        const visualFeedbackVerification = visualQaDecisions.find((entry) =>
          entry.key.startsWith("visual_feedback_verification_"),
        )
        expect(visualFeedbackVerification).toBeTruthy()
        const parsedPointer = JSON.parse(visualFeedbackVerification!.value)
        expect(String(parsedPointer.artifact_id)).toMatch(/^art_/)
        const parsedVerification = parsedPointer.visual_feedback_verification
        expect(parsedVerification).toMatchObject({
          taskID,
          runID: run.id,
          status: "failed",
          requiredReferenceRegions: ["main surface"],
          referenceComparisonEvidenceRefs: [],
          productionBlockerIDs: ["missing-rendered-reference-comparison", "missing_reference_region:main surface"],
        })

        const secondResult = await tools.visual_qa.execute(
          {
            reason: "Re-check after Build repair.",
            focus: "Main screen",
            app_url: "http://127.0.0.1:5173",
            preview_command: "npm run dev",
          },
          buildToolOptions("visual_qa_second_failed"),
        )

        const secondResultText = toolText(secondResult)
        expect(secondResultText).toContain("visual_qa complete: effective_accepted=false")
        expect(secondResultText).toContain("visual_feedback_verification_failed_attempts")
        expect(secondResultText).toContain("2")
        expect(secondResultText).not.toContain("visual_feedback_next_action")
        const secondVisualQaDecisions = createDecisionLog(taskID).readByPhase("visual_qa")
        expect(
          secondVisualQaDecisions.filter((entry) => entry.key.startsWith("visual_feedback_verification_")),
        ).toHaveLength(2)
        const latestSummaryEntries = secondVisualQaDecisions.filter((entry) => entry.key === "latest_summary")
        expect(latestSummaryEntries[latestSummaryEntries.length - 1]?.value).toContain(
          "visual_feedback_verification_failed_attempts=2",
        )
        expect(latestSummaryEntries[latestSummaryEntries.length - 1]?.value).not.toContain(
          "visual_feedback_next_action",
        )
      },
    })
  })

  test(
    "visual_qa accepts required parity from direct reference-comparison refs and materializes visual feedback verification",
    async () => {
      const now = Date.now()
      const stamp = now.toString(16)
      const taskID = `tsk_visual_qa_materialized_${stamp}`
      const goalID = `gol_visual_qa_materialized_${stamp}`
      const preview = await startVisualQaMatchingPreviewServer()
      try {
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const parent = await Session.create({
              kind: "root",
              title: "visual qa materialized root",
              metadata: { configOverlay: { model: "openai/gpt-5.5" } },
            })
            insertWorkflowTaskWithGoal({
              projectID: Instance.project.id,
              taskID,
              goalID,
              sessionID: parent.id,
              worktree: tmp.path,
              projectName: "visual qa materialized",
              taskTitle: "visual qa materialized",
              request: "Review the browser-visible reference surface before final integrity.",
              goalTitle: "Review materialized surface",
              goalSlug: "review-materialized-surface",
              objective: "Record materialized visual evidence through the ordinary visual_qa tool path",
              now,
              acceptanceSpecs: [
                {
                  id: "acc-visual-evidence-materialized",
                  source_requirement_id: "REQ-visual-materialized",
                  goal_id: goalID,
                  title: "final rendered reference evidence",
                  scorers: [
                    {
                      type: "prebuilt",
                      name: "visual-feedback-verification",
                      spec: { kind: "visual_feedback_verification", viewport: "desktop-primary" },
                    },
                  ],
                  severity: "essential",
                },
              ],
              insertProject: false,
            })
            createRun({
              taskID,
              planVersionID: null,
              sessionID: parent.id,
              executor: "opencorvus",
              status: "running",
              phase: "execute",
              summary: "active visual qa materialized run",
              now,
            })
            await writeVisualQaReferenceImage(tmp.path, taskID)
            const target = await persistTestBrowserPreviewTarget({
              taskID,
              url: preview.url,
              viewports: [
                {
                  id: "desktop",
                  labelKey: "browser_preview.viewport.desktop",
                  width: 800,
                  height: 600,
                },
              ],
            })
            const activeRun = findActiveRunForTask(taskID)
            expect(activeRun?.id).toBeTruthy()
            const comparisonRef = await seedVisualQaReferenceComparisonEvidence({
              projectRoot: tmp.path,
              taskID,
              runID: activeRun!.id,
              targetID: target.id,
              regionID: "economy-page",
              viewportID: "desktop",
            })
            visualQaAnalyzeImpl = async (input: any) => {
              const child = await Session.create({
                kind: "visual-qa",
                parentID: parent.id,
                title: "visual qa reference-comparison worker",
              })
              input.onSessionCreated?.(child.id)
              const report = minimalVisualQaReport()
              return {
                sessionID: child.id,
                report: {
                  ...report,
                  summary: "Reference-comparison visual QA evidence accepted.",
                  check_items: report.check_items.map((item) => ({
                    ...item,
                    region: "economy-page",
                    reference_region_key: "economy-page@desktop",
                    viewports: [{ width: 800, height: 600 }],
                    source_refs: ["web-clone-source/reference.png"],
                    evidence_refs: [comparisonRef],
                  })),
                  coverage: [
                    {
                      check_ids: ["check-main-surface"],
                      region: "economy-page",
                      viewports: [{ width: 800, height: 600 }],
                      states: ["default"],
                      source_refs: ["web-clone-source/reference.png"],
                      evidence_refs: [comparisonRef],
                      notes: "Checked task-scoped rendered reference-comparison evidence.",
                    },
                  ],
                  evidence: [
                    {
                      check_ids: ["check-main-surface"],
                      type: "screenshot" as const,
                      ref: comparisonRef,
                      viewport: { width: 800, height: 600 },
                      state: "default",
                      note: "Task-scoped reference-comparison evidence for Visual QA acceptance.",
                    },
                  ],
                  reference_parity: {
                    required: true,
                    required_regions: ["economy-page@desktop"],
                    reference_comparison_evidence_refs: [comparisonRef],
                    missing_regions: [],
                    blocker_ids: [],
                  },
                },
                acceptance: minimalAcceptedVisualQaAcceptance(),
              }
            }

            const { tools } = createOrchestratorTools({
              taskID,
              agentSessionID: parent.id,
              signal: new AbortController().signal,
            })
            const result = await tools.visual_qa.execute(
              {
                reason: "Need final frontend GUI review.",
                focus: "Economy page",
                app_url: preview.url,
                preview_command: "node node_modules/playwright/cli.js test visual.spec.ts",
              },
              buildToolOptions("visual_qa_materialized"),
            )

            expect(toolText(result)).toContain("visual_qa complete: effective_accepted=true")
            const visualQaDecisions = createDecisionLog(taskID).readByPhase("visual_qa")
            const latestSummary = visualQaDecisions.find((entry) => entry.key === "latest_summary")
            expect(latestSummary?.value).toContain("effective_accepted=true")
            expect(latestSummary?.value).toContain("visual_qa_process_accepted=true")
            expect(
              visualQaDecisions.some((entry) => entry.value.includes("without reference_comparison evidence refs")),
            ).toBe(false)
            const visualFeedbackVerification = visualQaDecisions.find((entry) =>
              entry.key.startsWith("visual_feedback_verification_"),
            )
            expect(visualFeedbackVerification).toBeTruthy()
            const parsedPointer = JSON.parse(visualFeedbackVerification!.value)
            expect(String(parsedPointer.artifact_id)).toMatch(/^art_/)
            const parsedVerification = parsedPointer.visual_feedback_verification
            expect(parsedVerification).toMatchObject({
              taskID,
              runID: activeRun!.id,
              previewTargetID: target.id,
              status: "passed",
              requiredReferenceRegions: ["economy-page@desktop"],
              referenceComparisonEvidenceRefs: [comparisonRef],
              productionBlockerIDs: [],
            })
          },
        })
      } finally {
        await preview.close()
      }
    },
    { timeout: ORCHESTRATOR_TOOLS_TEST_TIMEOUT_MS },
  )

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

  test("respond_agent_coordination rejects unbound tool execution metadata before consuming the request", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_unbound_audit_${stamp}`
    const taskID = `tsk_agent_coordination_unbound_audit_${stamp}`
    const goalID = `gol_agent_coordination_unbound_audit_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination unbound audit",
      taskTitle: "agent coordination unbound audit",
      request: "Reject an A2A response that cannot be tied to a persisted orchestrator tool part",
      goalTitle: "Coordinate audit identity",
      goalSlug: "coordinate-audit-identity",
      objective: "Do not consume pending A2A requests with forged tool metadata",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination unbound audit root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "assistant",
          parentID: parent.id,
          title: "agent coordination unbound audit worker",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "coding",
          messageID: Identifier.ascending("message"),
          summary: "Need scheduler guidance",
          details: "The worker asks for a durable response, but the tool identity is forged.",
          blocking: true,
          requestedDecision: "continue",
          severity: "blocked",
        })
        const forgedOptions = buildToolOptions("respond_agent_coordination_unbound_audit")
        forgedOptions.opencorvus.sessionID = parent.id

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        await expect(
          tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "continue",
              message: "This response must not be accepted without a persisted tool part.",
              reason: "Exercise A2A audit identity validation.",
            },
            forgedOptions,
          ),
        ).rejects.toThrow(/persisted orchestrator message .* was not found/)

        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "pending",
        )
        expect(listAgentCoordinationActions(taskID)).toHaveLength(0)
        const responseRows = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(
              and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "agent_coordination_response")),
            )
            .all(),
        )
        expect(responseRows).toHaveLength(0)
      },
    })
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
        const request = await createAgentCoordinationRequest({
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
        const toolOptions = await buildPersistedToolOptions({
          sessionID: parent.id,
          label: "respond_agent_coordination",
        })

        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "continue",
              message: "Continue with the current evidence and produce the requested finding.",
              reason: "The worker requested scheduler confirmation and the same session remains valid.",
            },
            toolOptions,
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
        expect(
          responseUser?.parts.some((part) => part.type === "text" && part.text.includes(request.payload.summary)),
        ).toBe(true)
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          request_id: request.payload.request_id,
          orchestrator_session_id: parent.id,
          orchestrator_message_id: toolOptions.opencorvus.messageID,
          orchestrator_tool_call_id: toolOptions.opencorvus.toolCallID,
          orchestrator_tool_part_id: toolOptions.opencorvus.toolPartID,
          action: "continue_worker",
          status: "completed",
          target_session_id: worker.id,
          worker_message_id: responseUser?.info.id,
          result: { session_id: worker.id, resumed: true },
        })
        const responseRows = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(
              and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "agent_coordination_response")),
            )
            .all(),
        )
        expect(responseRows).toHaveLength(1)
        expect(responseRows[0]?.payload).toMatchObject({
          orchestrator_session_id: parent.id,
          orchestrator_message_id: toolOptions.opencorvus.messageID,
          orchestrator_tool_call_id: toolOptions.opencorvus.toolCallID,
          orchestrator_tool_part_id: toolOptions.opencorvus.toolPartID,
        })
        expect(findAgentCoordinationAction({ taskID, actionID: actions[0]!.artifactID })?.payload.status).toBe(
          "completed",
        )
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(loopSpy).toHaveBeenCalledWith({ sessionID: worker.id, resume_existing: true })
        const replayResult = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "continue",
              message: "Continue with the current evidence and produce the requested finding.",
              reason: "The worker requested scheduler confirmation and the same session remains valid.",
            },
            toolOptions,
          ),
        )
        expect(replayResult).toContain(`Replayed coordination response ${responseRows[0]!.id}`)
        expect(replayResult).toContain(`action=${actions[0]!.artifactID} already completed as continue_worker`)
        const replayMessages: Message.WithParts[] = []
        for await (const item of Message.stream(worker.id)) replayMessages.push(item)
        expect(
          replayMessages.filter(
            (item) =>
              item.info.role === "user" &&
              item.parts.some(
                (part) => part.type === "text" && part.text.includes("Orchestrator Coordination Response"),
              ),
          ),
        ).toHaveLength(1)
        expect(listAgentCoordinationActions(taskID)).toHaveLength(1)
        const replayResponseRows = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(
              and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "agent_coordination_response")),
            )
            .all(),
        )
        expect(replayResponseRows).toHaveLength(1)
        expect(loopSpy).toHaveBeenCalledTimes(1)
      },
    })
  })

  test("respond_agent_coordination continue recovers a pending action after the worker message was already appended", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_continue_recover_${stamp}`
    const taskID = `tsk_agent_coordination_continue_recover_${stamp}`
    const goalID = `gol_agent_coordination_continue_recover_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination continue recovery",
      taskTitle: "agent coordination continue recovery",
      request: "Worker asks the orchestrator to continue and the host crashes after appending the worker message",
      goalTitle: "Recover continue action",
      goalSlug: "recover-continue-action",
      objective: "Recover a claimed A2A continue action without appending a duplicate worker message",
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
          title: "agent coordination continue recovery root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "assistant",
          parentID: parent.id,
          title: "agent coordination continue recovery worker",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "coding",
          messageID: Identifier.ascending("message"),
          summary: "Need crash-safe continuation",
          details: "The worker has already received the orchestrator response message before the host crashed.",
          blocking: true,
          requestedDecision: "continue after recovery",
          severity: "blocked",
        })
        const toolOptions = await buildPersistedToolOptions({
          sessionID: parent.id,
          label: "respond_agent_coordination_continue_recover",
        })
        const guidance = "Recover from the previous append and resume without writing a second response message."
        const reason = "The worker-visible message was appended before the previous process stopped."
        const response = await createAgentCoordinationResponse({
          taskID,
          requestID: request.payload.request_id,
          orchestratorSessionID: parent.id,
          orchestratorMessageID: toolOptions.opencorvus.messageID,
          orchestratorToolCallID: toolOptions.opencorvus.toolCallID,
          orchestratorToolPartID: toolOptions.opencorvus.toolPartID,
          decision: "continue",
          reason,
          message: guidance,
        })
        const pendingAction = findAgentCoordinationAction({ taskID, actionID: response.payload.action_id })
        expect(pendingAction?.payload.status).toBe("pending")
        expect(pendingAction?.payload.result).toBeUndefined()

        const workerMessageID = `msg_agent_coordination_${response.payload.action_id}`
        const workerMessagePartID = `prt_agent_coordination_${response.payload.action_id}`
        await Session.persistMessage({
          info: {
            id: workerMessageID,
            sessionID: worker.id,
            role: "user",
            time: { created: now + 1 },
            agent: "coding",
            model: { providerID: "test-provider", modelID: "test-model" },
            extra: {
              taskID,
              source: "agent_coordination_response",
              agentCoordination: {
                requestID: request.payload.request_id,
                responseID: response.payload.response_id,
                actionID: response.payload.action_id,
                decision: "continue",
                reason,
                blocking: request.payload.blocking,
                requestedDecision: request.payload.requested_decision,
              },
            },
          } as any,
          parts: [
            {
              id: workerMessagePartID,
              messageID: workerMessageID,
              sessionID: worker.id,
              type: "text",
              text: [
                "# Orchestrator Coordination Response",
                "",
                `request_id: ${request.payload.request_id}`,
                "decision: continue",
                `reason: ${reason}`,
                "",
                "## Guidance",
                guidance,
              ].join("\n"),
            },
          ],
          touchSessionID: worker.id,
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
              message: guidance,
              reason,
            },
            toolOptions,
          ),
        )

        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with continue`)
        const messages: Message.WithParts[] = []
        for await (const item of Message.stream(worker.id)) messages.push(item)
        const responseMessages = messages.filter(
          (item) =>
            item.info.role === "user" &&
            item.parts.some((part) => part.type === "text" && part.text.includes("Orchestrator Coordination Response")),
        )
        expect(responseMessages).toHaveLength(1)
        expect(responseMessages[0]?.info.id).toBe(workerMessageID)
        expect(responseMessages[0]?.parts.map((part) => part.id)).toEqual([workerMessagePartID])
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action_id: response.payload.action_id,
          status: "completed",
          worker_message_id: workerMessageID,
          result: {
            session_id: worker.id,
            worker_message_id: workerMessageID,
            worker_message_part_id: workerMessagePartID,
            message_recovered: true,
            resumed: true,
          },
        })
        expect(loopSpy).toHaveBeenCalledTimes(1)
        expect(loopSpy).toHaveBeenCalledWith({ sessionID: worker.id, resume_existing: true })
      },
    })
  })

  test("respond_agent_coordination continue accepts a goal-run-owned session outside the task session tree", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_goal_run_owner_${stamp}`
    const taskID = `tsk_agent_coordination_goal_run_owner_${stamp}`
    const goalID = `gol_agent_coordination_goal_run_owner_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination goal run owner",
      taskTitle: "agent coordination goal run owner",
      request: "A goal-run-owned child asks the orchestrator to continue",
      goalTitle: "Coordinate goal-run-owned worker",
      goalSlug: "coordinate-goal-run-owned-worker",
      objective: "Continue a worker whose durable ownership comes from goal_run.session_id",
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
        const taskRoot = await Session.create({
          kind: "root",
          title: "agent coordination goal-run task root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const detachedRoot = await Session.create({
          kind: "root",
          title: "agent coordination detached root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "assistant",
          parentID: detachedRoot.id,
          goalID,
          title: "agent coordination goal-run-owned worker",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: taskRoot.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const goalRunID = beginBuildAttempt({
          taskID,
          goalID,
          sessionID: worker.id,
          now,
        })
        expect(findGoalRun(goalRunID)?.session_id).toBe(worker.id)

        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "coding",
          messageID: Identifier.ascending("message"),
          summary: "Need continuation from goal-run-owned worker",
          details: "The worker is not in the task session tree but has durable goal_run ownership.",
          blocking: true,
          requestedDecision: "continue this goal-run-owned worker session",
          severity: "blocked",
          goalID,
          goalRunID,
        })

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: taskRoot.id,
          signal: new AbortController().signal,
        })

        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "continue",
              message: "Continue from the durable goal_run ownership binding.",
              reason:
                "The goal_run row proves this worker belongs to the task even though its parent tree is detached.",
            },
            await buildPersistedToolOptions({
              sessionID: taskRoot.id,
              label: "respond_agent_coordination_goal_run_owned_continue",
            }),
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
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          request_id: request.payload.request_id,
          action: "continue_worker",
          status: "completed",
          target_session_id: worker.id,
          goal_id: goalID,
          goal_run_id: goalRunID,
          worker_message_id: responseUser?.info.id,
          result: { session_id: worker.id, resumed: true },
        })
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(loopSpy).toHaveBeenCalledWith({ sessionID: worker.id, resume_existing: true })
      },
    })
  })

  test("respond_agent_coordination continue supports frontend-research worker sessions", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_frontend_research_${stamp}`
    const taskID = `tsk_agent_coordination_frontend_research_${stamp}`
    const goalID = `gol_agent_coordination_frontend_research_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination frontend research",
      taskTitle: "agent coordination frontend research",
      request: "Frontend research asks the orchestrator to continue the same session",
      goalTitle: "Coordinate frontend research",
      goalSlug: "coordinate-frontend-research",
      objective: "Continue frontend research from the existing session",
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
          title: "agent coordination frontend research root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "frontend-research",
          parentID: parent.id,
          title: "agent coordination frontend research worker",
        })
        installFrontendResearchRuntimeContract({ sessionID: worker.id, taskID })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "frontend-research",
          messageID: Identifier.ascending("message"),
          summary: "Need frontend research routing",
          details: "The worker has a source-evidence conflict and needs scheduler guidance.",
          blocking: true,
          requestedDecision: "continue this frontend-research session",
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
              message: "Continue the source investigation under the existing frontend-research contract.",
              reason: "The worker requested scheduler confirmation and its runtime contract is still installed.",
            },
            await buildPersistedToolOptions({
              sessionID: parent.id,
              label: "respond_agent_coordination_frontend_research",
            }),
          ),
        )

        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with continue`)
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          request_id: request.payload.request_id,
          action: "continue_worker",
          status: "completed",
          target_session_id: worker.id,
          result: { session_id: worker.id, resumed: true },
        })
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(loopSpy).toHaveBeenCalledWith({ sessionID: worker.id, resume_existing: true })
      },
    })
  })

  test("respond_agent_coordination continue records response before starting the same-session loop", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_loop_failed_${stamp}`
    const taskID = `tsk_agent_coordination_loop_failed_${stamp}`
    const goalID = `gol_agent_coordination_loop_failed_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination loop failure",
      taskTitle: "agent coordination loop failure",
      request: "Worker asks the orchestrator to continue but loop cannot start",
      goalTitle: "Coordinate loop failure",
      goalSlug: "coordinate-loop-failure",
      objective: "Keep the response durable when continuation fails",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(SessionPrompt, "loop").mockRejectedValue(new Error("loop failed immediately"))
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination loop failure root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "assistant",
          parentID: parent.id,
          title: "agent coordination loop failure worker",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "coding",
          messageID: Identifier.ascending("message"),
          summary: "Need a routing decision",
          details: "The worker needs the orchestrator to continue it.",
          blocking: true,
          requestedDecision: "continue this worker session",
          severity: "blocked",
        })

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        await expect(
          tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "continue",
              message: "Continue with the current evidence.",
              reason: "Exercise loop startup failure.",
            },
            await buildPersistedToolOptions({
              sessionID: parent.id,
              label: "respond_agent_coordination_loop_failed",
            }),
          ),
        ).rejects.toThrow(/loop failed immediately/)

        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "pending",
        )
        const messages: Message.WithParts[] = []
        for await (const item of Message.stream(worker.id)) messages.push(item)
        const responseUser = messages.find(
          (item) =>
            item.info.role === "user" &&
            item.parts.some((part) => part.type === "text" && part.text.includes("Orchestrator Coordination Response")),
        )
        expect(responseUser).toBeDefined()
        const responseRows = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(
              and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "agent_coordination_response")),
            )
            .all(),
        )
        expect(responseRows).toHaveLength(1)
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          request_id: request.payload.request_id,
          response_id: responseRows[0]?.id,
          action: "continue_worker",
          status: "failed",
          target_session_id: worker.id,
          worker_message_id: responseUser?.info.id,
          error: "loop failed immediately",
          result: { session_id: worker.id },
        })
        const reopened = findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload
        expect(reopened).toMatchObject({
          status: "pending",
          last_failed_response_id: responseRows[0]?.id,
          last_failed_action_id: actions[0]?.payload.action_id,
          last_action_error: "loop failed immediately",
        })
        expect(listPendingAgentCoordinationRequests(taskID).map((row) => row.payload.request_id)).toEqual([
          request.payload.request_id,
        ])
        expect(SessionStatus.get(worker.id)).toMatchObject({
          type: "terminal",
          reason: "error",
          error: "loop failed immediately",
        })
      },
    })
  })

  test("respond_agent_coordination continue keeps completed action when the resumed loop fails later", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_delayed_loop_failed_${stamp}`
    const taskID = `tsk_agent_coordination_delayed_loop_failed_${stamp}`
    const goalID = `gol_agent_coordination_delayed_loop_failed_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination delayed loop failure",
      taskTitle: "agent coordination delayed loop failure",
      request: "Worker asks the orchestrator to continue and the resumed loop fails after action completion",
      goalTitle: "Coordinate delayed loop failure",
      goalSlug: "coordinate-delayed-loop-failure",
      objective: "Represent post-resume loop failure as session status without rolling back completed A2A action",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let rejectLoop: ((error: Error) => void) | undefined
        const loopPromise = new Promise<Message.WithParts>((_resolve, reject) => {
          rejectLoop = reject
        })
        const loopSpy = spyOn(SessionPrompt, "loop").mockImplementation(() => loopPromise as any)
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination delayed loop failure root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "assistant",
          parentID: parent.id,
          title: "agent coordination delayed loop failure worker",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "coding",
          messageID: Identifier.ascending("message"),
          summary: "Need a delayed failure routing decision",
          details: "The worker continuation starts successfully before the resumed loop fails.",
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
              message: "Continue with the current evidence.",
              reason: "Exercise delayed loop failure after action completion.",
            },
            await buildPersistedToolOptions({
              sessionID: parent.id,
              label: "respond_agent_coordination_delayed_loop_failed",
            }),
          ),
        )

        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with continue`)
        expect(loopSpy).toHaveBeenCalledWith({ sessionID: worker.id, resume_existing: true })
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        const actionsBeforeFailure = listAgentCoordinationActions(taskID)
        expect(actionsBeforeFailure).toHaveLength(1)
        expect(actionsBeforeFailure[0]?.payload).toMatchObject({
          request_id: request.payload.request_id,
          action: "continue_worker",
          status: "completed",
          target_session_id: worker.id,
          result: { session_id: worker.id, resumed: true },
        })

        if (!rejectLoop) throw new Error("SessionPrompt.loop was not invoked")
        rejectLoop(new Error("loop failed after action completed"))
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload).toMatchObject({
          status: "responded",
          response_id: actionsBeforeFailure[0]?.payload.response_id,
        })
        expect(listPendingAgentCoordinationRequests(taskID)).toEqual([])
        const actionsAfterFailure = listAgentCoordinationActions(taskID)
        expect(actionsAfterFailure).toHaveLength(1)
        expect(actionsAfterFailure[0]?.payload).toMatchObject({
          action_id: actionsBeforeFailure[0]?.payload.action_id,
          status: "completed",
          target_session_id: worker.id,
          result: { session_id: worker.id, resumed: true },
        })
        expect(SessionStatus.get(worker.id)).toMatchObject({
          type: "terminal",
          reason: "error",
          error: "loop failed after action completed",
        })
      },
    })
  })

  test("respond_agent_coordination keeps same-kind redispatch pending without a concrete binding", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_redispatch_${stamp}`
    const taskID = `tsk_agent_coordination_redispatch_${stamp}`
    const goalID = `gol_agent_coordination_redispatch_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination redispatch",
      taskTitle: "agent coordination redispatch",
      request: "Worker asks for a fresh worker session",
      goalTitle: "Coordinate redispatch",
      goalSlug: "coordinate-redispatch",
      objective: "Redispatch the worker through a durable A2A action",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination redispatch root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "assistant",
          parentID: parent.id,
          title: "agent coordination redispatch source worker",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "coding",
          messageID: Identifier.ascending("message"),
          summary: "Need redispatch",
          details: "The worker is blocked and asks the orchestrator for a scheduler action.",
          blocking: true,
          requestedDecision: "redispatch",
          severity: "blocked",
        })
        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "redispatch",
              message: "Start a fresh worker pass with the clarified scope.",
              reason: "The prior worker asked for a fresh pass under the same task.",
            },
            await buildPersistedToolOptions({
              sessionID: parent.id,
              label: "respond_agent_coordination_redispatch",
            }),
          ),
        )
        expect(result).toContain("refused redispatch")
        expect(result).toContain("same-kind session redispatch is not an accepted A2A action")
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "pending",
        )
        expect(listAgentCoordinationActions(taskID)).toHaveLength(0)
        const children = await Session.children(parent.id)
        expect(children.map((session) => session.id)).toEqual([worker.id])
      },
    })
  })

  test("respond_agent_coordination redispatch starts the architect stage dispatcher", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_architect_redispatch_${stamp}`
    const taskID = `tsk_agent_coordination_architect_redispatch_${stamp}`
    const reqSpecID = `spec_agent_coordination_architect_redispatch_${stamp}`
    let architectInput: any
    let redispatchSessionID = ""

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: tmp.path,
          name: "agent coordination architect redispatch",
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
          title: "agent coordination architect redispatch",
          request: "Runtime-contract architect worker asks for redispatch",
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
          content: "# Requirements\n- REQ-1 durable A2A mailbox",
          scope: "durable A2A mailbox",
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
            title: "Durable A2A mailbox",
            description: "Persist a durable A2A coordination mailbox.",
            acceptance: ["A2A request, response, and action artifacts are visible and recoverable."],
            evidence_refs: [],
            non_goals: ["Do not preserve fallback A2A routes."],
            priority: "blocking",
          },
        ],
      })
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination architect root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "architect",
          parentID: parent.id,
          title: "agent coordination architect source worker",
        })
        installArchitectRuntimeContract({ sessionID: worker.id, taskID })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        architectCoordinateImpl = async (input: any) => {
          architectInput = input
          const redispatched = await Session.create({
            kind: "architect",
            parentID: parent.id,
            title: "agent coordination architect redispatch worker",
          })
          redispatchSessionID = redispatched.id
          input.onSessionCreated?.(redispatched.id)
          return minimalArchitectRedispatchResult({ sessionID: redispatched.id })
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "architect",
          messageID: Identifier.ascending("message"),
          summary: "Need architect redispatch",
          details: "The worker is blocked and asks for a fresh architect decomposition pass.",
          blocking: true,
          requestedDecision: "redispatch",
          severity: "blocked",
        })
        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "redispatch",
              reason: "Start a fresh architect decomposition pass.",
              message: "Focus on the durable A2A protocol goal graph.",
            },
            await buildPersistedToolOptions({
              sessionID: parent.id,
              label: "respond_agent_coordination_architect_redispatch",
            }),
          ),
        )
        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with redispatch`)
        expect(result).toContain(`architect session ${redispatchSessionID} persisted spec`)
        expect(architectInput.parentSessionID).toBe(parent.id)
        expect(architectInput.taskID).toBe(taskID)
        expect(architectInput.requirements.map((requirement: any) => requirement.id)).toEqual(["REQ-1"])
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        const activeSpec = findActiveSpecForTask(taskID)
        expect(activeSpec?.id).not.toBe(reqSpecID)
        expect(activeSpec?.summary).toBe("Recovered architect decomposition.")
        const rows = activeSpec ? findRequirements(activeSpec.id) : []
        expect(rows).toHaveLength(1)
        const goalRows = Database.use((db) =>
          db.select().from(EngineGoalTable).where(eq(EngineGoalTable.task_id, taskID)).all(),
        )
        expect(goalRows).toHaveLength(1)
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action: "redispatch_worker",
          status: "completed",
          result: {
            redispatch_binding: {
              dispatcher: "architect_stage",
              stage: "architect",
              target_kind: "architect",
            },
            dispatcher: "architect_stage",
            stage: "architect",
            source_session_id: worker.id,
            redispatch_session_id: redispatchSessionID,
            spec_snapshot_id: activeSpec?.id,
            goals_count: 1,
            contracts_count: 0,
            target_kind: "architect",
            started: true,
            redispatch_started: true,
            preexisting_architect_session_ids: [worker.id],
            preexisting_spec_snapshot_ids: [reqSpecID],
            preexisting_architect_contract_graph_artifact_ids: [],
            recovered_redispatch: false,
          },
        })
        const contractGraphArtifactID = actions[0]?.payload.result?.architect_contract_graph_artifact_id
        expect(typeof contractGraphArtifactID).toBe("string")
      },
    })
  })

  test("respond_agent_coordination redispatch recovers a pending architect action after spec persistence", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_architect_recover_${stamp}`
    const taskID = `tsk_agent_coordination_architect_recover_${stamp}`
    const reqSpecID = `spec_agent_coordination_architect_recover_req_${stamp}`
    const oldSpecID = `spec_agent_coordination_architect_recover_old_${stamp}`
    const oldGraphID = `artifact_agent_coordination_architect_recover_old_${stamp}`
    const reason = "Recover the architect redispatch action after durable spec persistence."
    const guidance = "Do not call Architect again; bind the completed durable architect output."
    let architectRunCalls = 0

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: tmp.path,
          name: "agent coordination architect recovery",
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
          title: "agent coordination architect recovery",
          request: "Runtime-contract architect worker asks for redispatch and host restarts after spec persistence",
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
          content: "# Requirements\n- REQ-1 durable A2A mailbox",
          scope: "durable A2A mailbox",
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineSpecSnapshotTable)
        .values({
          id: oldSpecID,
          task_id: taskID,
          version: 2,
          status: "superseded",
          summary: "Old architect output",
          content: "# Old architect output\n\n## Goals\n- old",
          scope: "old",
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EngineArtifactTable)
        .values({
          id: oldGraphID,
          task_id: taskID,
          run_id: null,
          goal_run_id: null,
          acceptance_id: null,
          kind: "architect_contract_graph",
          label: "active",
          payload: { version: 1, contracts: [], dependency_contracts: [] },
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
            title: "Durable A2A mailbox",
            description: "Persist a durable A2A coordination mailbox.",
            acceptance: ["A2A request, response, and action artifacts are visible and recoverable."],
            evidence_refs: [],
            non_goals: ["Do not preserve fallback A2A routes."],
            priority: "blocking",
          },
        ],
      })
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination architect recovery root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "architect",
          parentID: parent.id,
          title: "agent coordination architect source worker for recovery",
        })
        installArchitectRuntimeContract({ sessionID: worker.id, taskID })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const oldArchitect = await Session.create({
          kind: "architect",
          parentID: parent.id,
          title: "agent coordination old architect worker",
        })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "architect",
          messageID: Identifier.ascending("message"),
          summary: "Need architect redispatch recovery",
          details:
            "The worker is blocked and the prior redispatch persisted architect output before action completion.",
          blocking: true,
          requestedDecision: "redispatch",
          severity: "blocked",
        })
        const options = await buildPersistedToolOptions({
          sessionID: parent.id,
          label: "respond_agent_coordination_architect_recover",
        })
        const response = await createAgentCoordinationResponse({
          taskID,
          requestID: request.payload.request_id,
          orchestratorSessionID: options.opencorvus.sessionID,
          orchestratorMessageID: options.opencorvus.messageID,
          orchestratorToolCallID: options.opencorvus.toolCallID,
          orchestratorToolPartID: options.opencorvus.toolPartID,
          decision: "redispatch",
          reason,
          message: guidance,
          redispatchBinding: {
            dispatcher: "architect_stage",
            stage: "architect",
            target_kind: "architect",
          },
        })
        await recordAgentCoordinationActionProgress({
          taskID,
          actionID: response.payload.action_id,
          result: {
            dispatcher: "architect_stage",
            stage: "architect",
            source_session_id: worker.id,
            target_kind: "architect",
            redispatch_started: true,
            redispatch_started_at: Date.now(),
            preexisting_architect_session_ids: [worker.id, oldArchitect.id],
            preexisting_spec_snapshot_ids: [reqSpecID, oldSpecID],
            preexisting_architect_contract_graph_artifact_ids: [oldGraphID],
          },
          summary: "redispatch_worker architect stage dispatch started",
        })
        const redispatched = await Session.create({
          kind: "architect",
          parentID: parent.id,
          title: "agent coordination architect recovered worker",
        })
        const specID = `spec_recovered_architect_${stamp}`
        const goalID = `gol_recovered_architect_${stamp}`
        const graphID = `artifact_recovered_architect_graph_${stamp}`
        const recoveredAt = Date.now()
        Database.transaction((db) => {
          db.update(EngineSpecSnapshotTable)
            .set({ status: "superseded", time_updated: recoveredAt })
            .where(eq(EngineSpecSnapshotTable.task_id, taskID))
            .run()
          db.insert(EngineSpecSnapshotTable)
            .values({
              id: specID,
              task_id: taskID,
              version: 2,
              status: "ready",
              summary: "Recovered architect decomposition.",
              content:
                "# Recovered architect decomposition\n\n## Requirements\n- REQ-1 durable A2A mailbox\n\n## Goals\n- recovered architect goal\n\n## Architect Contracts\n_(none)_",
              scope: "Durable A2A mailbox",
              time_created: recoveredAt,
              time_updated: recoveredAt,
            })
            .run()
          insertRequirements(db, {
            taskID,
            specSnapshotID: specID,
            requirements: [
              {
                id: "REQ-1",
                title: "Durable A2A mailbox",
                description: "Persist request, response, and action artifacts.",
                acceptance: ["Recovered action links to persisted architect spec"],
                evidence_refs: [],
                non_goals: ["Do not retry the architect dispatcher"],
                priority: "blocking",
              },
            ],
            now: recoveredAt,
          })
          db.insert(EngineGoalTable)
            .values({
              id: goalID,
              task_id: taskID,
              spec_snapshot_id: specID,
              title: "Recovered A2A protocol goal",
              slug: "recovered-a2a-protocol-goal",
              objective: "Bind the durable A2A protocol repair to persisted architect output.",
              acceptance_specs: [],
              owned_paths: ["packages/opencorvus/src/engine/agent-coordination.ts"],
              depends_on: [],
              exports: [],
              imports: [],
              kind: "feature",
              requirement_ids: ["REQ-1"],
              priority: "blocking",
              source: "spec",
              status: "pending",
              order_index: 0,
              time_created: recoveredAt,
              time_updated: recoveredAt,
            })
            .run()
          db.insert(EngineArtifactTable)
            .values({
              id: graphID,
              task_id: taskID,
              run_id: null,
              goal_run_id: null,
              acceptance_id: null,
              kind: "architect_contract_graph",
              label: "active",
              payload: { version: 1, contracts: [], dependency_contracts: [] },
              time_created: recoveredAt,
              time_updated: recoveredAt,
            })
            .run()
        })
        architectCoordinateImpl = async () => {
          architectRunCalls += 1
          throw new Error("architect dispatcher must not run during pending action recovery")
        }

        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "redispatch",
              reason,
              message: guidance,
            },
            options,
          ),
        )

        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with redispatch`)
        expect(result).toContain(`architect session ${redispatched.id} recovered persisted spec ${specID}`)
        expect(architectRunCalls).toBe(0)
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        const activeSpec = findActiveSpecForTask(taskID)
        expect(activeSpec?.id).toBe(specID)
        expect(findRequirements(specID)).toHaveLength(1)
        const goalRows = Database.use((db) =>
          db.select().from(EngineGoalTable).where(eq(EngineGoalTable.spec_snapshot_id, specID)).all(),
        )
        expect(goalRows).toHaveLength(1)
        const graphArtifact = Database.use((db) =>
          db.select().from(EngineArtifactTable).where(eq(EngineArtifactTable.id, graphID)).get(),
        )
        expect(graphArtifact?.kind).toBe("architect_contract_graph")
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action: "redispatch_worker",
          status: "completed",
          result: {
            dispatcher: "architect_stage",
            stage: "architect",
            source_session_id: worker.id,
            redispatch_session_id: redispatched.id,
            spec_snapshot_id: specID,
            architect_contract_graph_artifact_id: graphID,
            goals_count: 1,
            contracts_count: 0,
            target_kind: "architect",
            started: true,
            redispatch_started: true,
            recovered_redispatch: true,
            preexisting_architect_session_ids: [worker.id, oldArchitect.id],
            preexisting_spec_snapshot_ids: [reqSpecID, oldSpecID],
            preexisting_architect_contract_graph_artifact_ids: [oldGraphID],
          },
        })
      },
    })
  })

  test("respond_agent_coordination redispatch starts the requirements stage dispatcher", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_requirements_redispatch_${stamp}`
    const taskID = `tsk_agent_coordination_requirements_redispatch_${stamp}`
    const goalID = `gol_agent_coordination_requirements_redispatch_${stamp}`
    let requirementsInput: any
    let redispatchSessionID = ""

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination requirements redispatch",
      taskTitle: "agent coordination requirements redispatch",
      request: "Runtime-contract requirements worker asks for redispatch",
      goalTitle: "Coordinate requirements redispatch",
      goalSlug: "coordinate-requirements-redispatch",
      objective: "Redispatch requirements through a concrete stage dispatcher binding",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination requirements root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "requirements",
          parentID: parent.id,
          title: "agent coordination requirements source worker",
        })
        installRequirementsRuntimeContract({ sessionID: worker.id, taskID })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        requirementsRunImpl = async (input: any) => {
          requirementsInput = input
          const redispatched = await Session.create({
            kind: "requirements",
            parentID: parent.id,
            title: "agent coordination requirements redispatch worker",
          })
          redispatchSessionID = redispatched.id
          input.onSessionCreated?.(redispatched.id)
          return minimalRequirementsResult({ sessionID: redispatched.id })
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "requirements",
          messageID: Identifier.ascending("message"),
          summary: "Need requirements redispatch",
          details: "The worker is blocked and asks for a fresh requirements pass.",
          blocking: true,
          requestedDecision: "redispatch",
          severity: "blocked",
        })
        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "redispatch",
              reason: "Start a fresh requirements pass.",
              message: "Focus on the durable A2A mailbox contract.",
            },
            await buildPersistedToolOptions({
              sessionID: parent.id,
              label: "respond_agent_coordination_requirements_redispatch",
            }),
          ),
        )
        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with redispatch`)
        expect(result).toContain(`requirements session ${redispatchSessionID} persisted spec`)
        expect(requirementsInput.parentSessionID).toBe(parent.id)
        expect(requirementsInput.taskID).toBe(taskID)
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        const activeSpec = findActiveSpecForTask(taskID)
        expect(activeSpec?.summary).toBe("Recovered requirements result.")
        const rows = activeSpec ? findRequirements(activeSpec.id) : []
        expect(rows).toHaveLength(1)
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action: "redispatch_worker",
          status: "completed",
          result: {
            redispatch_binding: {
              dispatcher: "requirements_stage",
              stage: "requirements",
              target_kind: "requirements",
            },
            dispatcher: "requirements_stage",
            stage: "requirements",
            source_session_id: worker.id,
            redispatch_session_id: redispatchSessionID,
            spec_snapshot_id: activeSpec?.id,
            requirements_count: 1,
            decisions_count: 1,
            target_kind: "requirements",
            started: true,
            redispatch_started: true,
            recovered_redispatch: false,
          },
        })
      },
    })
  })

  test("respond_agent_coordination redispatch recovers a pending requirements action after spec persistence", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_requirements_recover_${stamp}`
    const taskID = `tsk_agent_coordination_requirements_recover_${stamp}`
    const goalID = `gol_agent_coordination_requirements_recover_${stamp}`
    const reason = "Start a fresh requirements pass and recover the persisted spec."
    const guidance = "Recover from the requirements spec that was already persisted before action completion."
    let requirementsRunCalls = 0

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination requirements redispatch recovery",
      taskTitle: "agent coordination requirements redispatch recovery",
      request: "Runtime-contract requirements worker asks for redispatch recovery",
      goalTitle: "Coordinate requirements redispatch recovery",
      goalSlug: "coordinate-requirements-redispatch-recovery",
      objective: "Recover a requirements redispatch action from durable spec evidence",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination requirements recovery root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "requirements",
          parentID: parent.id,
          title: "agent coordination requirements source worker for recovery",
        })
        installRequirementsRuntimeContract({ sessionID: worker.id, taskID })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const oldRequirements = await Session.create({
          kind: "requirements",
          parentID: parent.id,
          title: "agent coordination old requirements worker",
        })
        const oldSpecID = `spec_old_requirements_${stamp}`
        Database.transaction((db) => {
          db.insert(EngineSpecSnapshotTable)
            .values({
              id: oldSpecID,
              task_id: taskID,
              version: 1,
              status: "superseded",
              summary: "Old requirements result.",
              content:
                "# Old requirements\n\n## Requirements\n- old\n\n## Decisions\n- **old** = ignored — prior result",
              scope: "old",
              time_created: now,
              time_updated: now,
            })
            .run()
          insertRequirements(db, {
            taskID,
            specSnapshotID: oldSpecID,
            requirements: [
              {
                id: "REQ-OLD",
                title: "Old requirement",
                description: "Old requirement",
                acceptance: ["old acceptance"],
                evidence_refs: [],
                non_goals: ["old non-goal"],
                priority: "advisory",
              },
            ],
            now,
          })
        })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "requirements",
          messageID: Identifier.ascending("message"),
          summary: "Need requirements redispatch recovery",
          details:
            "The worker is blocked and the prior redispatch persisted a requirements spec before action completion.",
          blocking: true,
          requestedDecision: "redispatch",
          severity: "blocked",
        })
        const options = await buildPersistedToolOptions({
          sessionID: parent.id,
          label: "respond_agent_coordination_requirements_recover",
        })
        const response = await createAgentCoordinationResponse({
          taskID,
          requestID: request.payload.request_id,
          orchestratorSessionID: options.opencorvus.sessionID,
          orchestratorMessageID: options.opencorvus.messageID,
          orchestratorToolCallID: options.opencorvus.toolCallID,
          orchestratorToolPartID: options.opencorvus.toolPartID,
          decision: "redispatch",
          reason,
          message: guidance,
          redispatchBinding: {
            dispatcher: "requirements_stage",
            stage: "requirements",
            target_kind: "requirements",
          },
        })
        await recordAgentCoordinationActionProgress({
          taskID,
          actionID: response.payload.action_id,
          result: {
            dispatcher: "requirements_stage",
            stage: "requirements",
            source_session_id: worker.id,
            target_kind: "requirements",
            redispatch_started: true,
            redispatch_started_at: Date.now(),
            preexisting_requirements_session_ids: [worker.id, oldRequirements.id],
            preexisting_spec_snapshot_ids: [oldSpecID],
          },
          summary: "redispatch_worker requirements stage dispatch started",
        })
        const redispatched = await Session.create({
          kind: "requirements",
          parentID: parent.id,
          title: "agent coordination requirements recovered worker",
        })
        const specID = `spec_recovered_requirements_${stamp}`
        const recoveredAt = Date.now()
        Database.transaction((db) => {
          db.update(EngineSpecSnapshotTable)
            .set({ status: "superseded", time_updated: recoveredAt })
            .where(eq(EngineSpecSnapshotTable.task_id, taskID))
            .run()
          db.insert(EngineSpecSnapshotTable)
            .values({
              id: specID,
              task_id: taskID,
              version: 1,
              status: "ready",
              summary: "Recovered requirements result.",
              content:
                "# Recovered requirements\n\n## Requirements\n- **REQ-1** [explicit]: Durable A2A mailbox.\n\n## Decisions\n- **communication_protocol** = durable_a2a_mailbox — A2A must be recoverable.",
              scope: "Durable A2A mailbox",
              time_created: recoveredAt,
              time_updated: recoveredAt,
            })
            .run()
          insertRequirements(db, {
            taskID,
            specSnapshotID: specID,
            requirements: [
              {
                id: "REQ-1",
                title: "Durable A2A mailbox",
                description: "Persist request, response, and action artifacts.",
                acceptance: ["Recovered action links to persisted spec"],
                evidence_refs: [],
                non_goals: ["Do not retry the dispatcher"],
                priority: "blocking",
              },
            ],
            now: recoveredAt,
          })
        })
        requirementsRunImpl = async () => {
          requirementsRunCalls += 1
          throw new Error("requirements dispatcher must not run during pending action recovery")
        }

        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "redispatch",
              reason,
              message: guidance,
            },
            options,
          ),
        )

        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with redispatch`)
        expect(result).toContain(`requirements session ${redispatched.id} recovered persisted spec ${specID}`)
        expect(requirementsRunCalls).toBe(0)
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        const activeSpec = findActiveSpecForTask(taskID)
        expect(activeSpec?.id).toBe(specID)
        expect(findRequirements(specID)).toHaveLength(1)
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action: "redispatch_worker",
          status: "completed",
          result: {
            dispatcher: "requirements_stage",
            stage: "requirements",
            source_session_id: worker.id,
            redispatch_session_id: redispatched.id,
            spec_snapshot_id: specID,
            requirements_count: 1,
            decisions_count: 1,
            target_kind: "requirements",
            started: true,
            redispatch_started: true,
            recovered_redispatch: true,
            preexisting_requirements_session_ids: [worker.id, oldRequirements.id],
            preexisting_spec_snapshot_ids: [oldSpecID],
          },
        })
      },
    })
  })

  test("respond_agent_coordination redispatch starts the frontend-research stage dispatcher", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_frontend_research_redispatch_${stamp}`
    const taskID = `tsk_agent_coordination_frontend_research_redispatch_${stamp}`
    const goalID = `gol_agent_coordination_frontend_research_redispatch_${stamp}`
    const sourceURL = "https://example.com/a2a-source"
    let frontendResearchInput: any
    let redispatchSessionID = ""

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination frontend research redispatch",
      taskTitle: "agent coordination frontend research redispatch",
      request: "Runtime-contract worker asks for redispatch",
      goalTitle: "Coordinate frontend research redispatch",
      goalSlug: "coordinate-frontend-research-redispatch",
      objective: "Redispatch frontend research through a concrete stage dispatcher binding",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination refusal root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "frontend-research",
          parentID: parent.id,
          title: "agent coordination frontend research source worker",
        })
        installFrontendResearchRuntimeContract({ sessionID: worker.id, taskID })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        frontendResearchRunImpl = async (input: any) => {
          frontendResearchInput = input
          const redispatched = await Session.create({
            kind: "frontend-research",
            parentID: parent.id,
            title: "agent coordination frontend research redispatch worker",
          })
          redispatchSessionID = redispatched.id
          input.onSessionCreated?.(redispatched.id)
          return {
            sessionID: redispatched.id,
            brief: minimalFrontendResearchBrief({
              taskID,
              sessionID: redispatched.id,
              sourceURL,
              request: input.request,
            }),
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "frontend-research",
          messageID: Identifier.ascending("message"),
          summary: "Need redispatch",
          details: "The worker is blocked and asks the orchestrator for a scheduler action.",
          blocking: true,
          requestedDecision: "redispatch",
          evidenceRefs: [sourceURL],
          severity: "blocked",
        })
        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "redispatch",
              reason: "Start a fresh frontend research investigation for the same page scope.",
              message: "Focus on the missing pricing table evidence.",
            },
            await buildPersistedToolOptions({
              sessionID: parent.id,
              label: "respond_agent_coordination_frontend_research_redispatch",
            }),
          ),
        )
        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with redispatch`)
        expect(result).toContain(`frontend_research session ${redispatchSessionID} persisted brief`)
        expect(frontendResearchInput.sourceUrls).toEqual([sourceURL])
        expect(frontendResearchInput.focus).toBe("Focus on the missing pricing table evidence.")
        expect(frontendResearchInput.reason).toContain(
          `A2A redispatch_worker for request ${request.payload.request_id}`,
        )
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )

        const responseRows = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(
              and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "agent_coordination_response")),
            )
            .all(),
        )
        expect(responseRows).toHaveLength(1)
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action: "redispatch_worker",
          status: "completed",
          result: {
            redispatch_binding: {
              dispatcher: "frontend_research_stage",
              stage: "frontend-research",
              target_kind: "frontend-research",
            },
            dispatcher: "frontend_research_stage",
            stage: "frontend-research",
            source_session_id: worker.id,
            redispatch_session_id: redispatchSessionID,
            source_url: sourceURL,
            target_kind: "frontend-research",
            started: true,
            redispatch_started: true,
            recovered_redispatch: false,
          },
        })
        const artifactID = actions[0]?.payload.result?.frontend_research_brief_artifact_id
        expect(typeof artifactID).toBe("string")
        const briefArtifact = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.id, String(artifactID))))
            .get(),
        )
        expect(briefArtifact?.kind).toBe("frontend_research_brief")
      },
    })
  })

  test("respond_agent_coordination redispatch recovers a pending frontend-research action after brief persistence", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_frontend_research_recover_${stamp}`
    const taskID = `tsk_agent_coordination_frontend_research_recover_${stamp}`
    const goalID = `gol_agent_coordination_frontend_research_recover_${stamp}`
    const sourceURL = "https://example.com/a2a-recovered-source"
    const reason = "Start a fresh frontend research investigation and recover the persisted brief."
    const guidance = "Recover from the brief that was already persisted before action completion."
    let frontendResearchRunCalls = 0

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination frontend research redispatch recovery",
      taskTitle: "agent coordination frontend research redispatch recovery",
      request: "Runtime-contract worker asks for redispatch recovery",
      goalTitle: "Coordinate frontend research redispatch recovery",
      goalSlug: "coordinate-frontend-research-redispatch-recovery",
      objective: "Recover a redispatch_worker pending action from durable brief evidence",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination frontend research recovery root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "frontend-research",
          parentID: parent.id,
          title: "agent coordination frontend research source worker for recovery",
        })
        installFrontendResearchRuntimeContract({ sessionID: worker.id, taskID })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "frontend-research",
          messageID: Identifier.ascending("message"),
          summary: "Need redispatch recovery",
          details: "The worker is blocked and the prior redispatch persisted a brief before action completion.",
          blocking: true,
          requestedDecision: "redispatch",
          evidenceRefs: [sourceURL],
          severity: "blocked",
        })
        const options = await buildPersistedToolOptions({
          sessionID: parent.id,
          label: "respond_agent_coordination_frontend_research_recover",
        })
        const response = await createAgentCoordinationResponse({
          taskID,
          requestID: request.payload.request_id,
          orchestratorSessionID: options.opencorvus.sessionID,
          orchestratorMessageID: options.opencorvus.messageID,
          orchestratorToolCallID: options.opencorvus.toolCallID,
          orchestratorToolPartID: options.opencorvus.toolPartID,
          decision: "redispatch",
          reason,
          message: guidance,
          redispatchBinding: {
            dispatcher: "frontend_research_stage",
            stage: "frontend-research",
            target_kind: "frontend-research",
          },
        })
        await recordAgentCoordinationActionProgress({
          taskID,
          actionID: response.payload.action_id,
          result: {
            dispatcher: "frontend_research_stage",
            stage: "frontend-research",
            source_session_id: worker.id,
            source_url: sourceURL,
            target_kind: "frontend-research",
            redispatch_started: true,
            redispatch_started_at: Date.now(),
          },
          summary: "redispatch_worker frontend_research stage dispatch started",
        })
        const redispatched = await Session.create({
          kind: "frontend-research",
          parentID: parent.id,
          title: "agent coordination frontend research recovered worker",
        })
        const artifactID = persistTaskFrontendResearchBrief({
          taskID,
          brief: minimalFrontendResearchBrief({
            taskID,
            sessionID: redispatched.id,
            sourceURL,
            request: "Recovered frontend research request.",
          }),
        })
        frontendResearchRunImpl = async () => {
          frontendResearchRunCalls += 1
          throw new Error("frontend research dispatcher must not run during pending action recovery")
        }

        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "redispatch",
              reason,
              message: guidance,
            },
            options,
          ),
        )

        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with redispatch`)
        expect(result).toContain(`frontend_research session ${redispatched.id} recovered persisted brief ${artifactID}`)
        expect(frontendResearchRunCalls).toBe(0)
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action: "redispatch_worker",
          status: "completed",
          result: {
            dispatcher: "frontend_research_stage",
            stage: "frontend-research",
            source_session_id: worker.id,
            redispatch_session_id: redispatched.id,
            frontend_research_brief_artifact_id: artifactID,
            source_url: sourceURL,
            target_kind: "frontend-research",
            started: true,
            redispatch_started: true,
            recovered_redispatch: true,
          },
        })
      },
    })
  })

  test("respond_agent_coordination redispatch starts the frontend-design stage dispatcher", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_agent_coordination_frontend_design_redispatch_${stamp}`
    const goalID = `gol_agent_coordination_frontend_design_redispatch_${stamp}`
    const specID = `spec_agent_coordination_frontend_design_redispatch_${stamp}`
    let frontendDesignInput: any
    let redispatchSessionID = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination frontend design root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          specID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "agent coordination frontend design redispatch",
          taskTitle: "agent coordination frontend design redispatch",
          request: "Runtime-contract frontend-design worker asks for redispatch",
          goalTitle: "Coordinate frontend design redispatch",
          goalSlug: "coordinate-frontend-design-redispatch",
          objective: "Redispatch frontend design through a concrete stage dispatcher binding",
          now,
          insertProject: false,
        })
        Database.use((db) =>
          db
            .update(EngineTaskTable)
            .set({
              attachments: [
                {
                  sha: "8".repeat(64),
                  url: "attachment://frontend-design-reference.png",
                  mime: "image/png",
                  size: 12,
                  filename: "frontend-design-reference.png",
                  intent: "visual_reference",
                  source: "user",
                },
              ],
            })
            .where(eq(EngineTaskTable.id, taskID))
            .run(),
        )
        const worker = await Session.create({
          kind: "frontend-design",
          parentID: parent.id,
          title: "agent coordination frontend design source worker",
        })
        installFrontendDesignRuntimeContract({ sessionID: worker.id, taskID })
        designAnalyzeImpl = async (input: any) => {
          frontendDesignInput = input
          const redispatched = await Session.create({
            kind: "frontend-design",
            parentID: parent.id,
            title: "agent coordination frontend design redispatch worker",
          })
          redispatchSessionID = redispatched.id
          input.onSessionCreated?.(redispatched.id)
          return minimalFrontendDesignResult({ sessionID: redispatched.id })
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "frontend-design",
          messageID: Identifier.ascending("message"),
          summary: "Need frontend-design redispatch",
          details: "The worker needs a fresh frontend-design handoff for the same visual reference.",
          blocking: true,
          requestedDecision: "redispatch",
          severity: "blocked",
        })
        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "redispatch",
              reason: "Start a fresh frontend-design handoff.",
              message: "Preserve the existing visual reference and regenerate the frontend template.",
            },
            await buildPersistedToolOptions({
              sessionID: parent.id,
              label: "respond_agent_coordination_frontend_design_redispatch",
            }),
          ),
        )
        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with redispatch`)
        expect(result).toContain(`frontend_design session ${redispatchSessionID} persisted`)
        expect(frontendDesignInput.parentSessionID).toBe(parent.id)
        expect(frontendDesignInput.taskID).toBe(taskID)
        expect(frontendDesignInput.request).toBe("Runtime-contract frontend-design worker asks for redispatch")
        expect(frontendDesignInput.attachments?.[0]?.sha).toBe("8".repeat(64))
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        expect(findTask(taskID)?.design_specs).toHaveLength(1)
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action: "redispatch_worker",
          status: "completed",
          result: {
            redispatch_binding: {
              dispatcher: "frontend_design_stage",
              stage: "frontend-design",
              target_kind: "frontend-design",
            },
            dispatcher: "frontend_design_stage",
            stage: "frontend-design",
            source_session_id: worker.id,
            redispatch_session_id: redispatchSessionID,
            design_specs_count: 1,
            template_review_passes: 2,
            reference_artifacts_count: 1,
            frontend_project_status: "not_created",
            source_url_count: 0,
            target_kind: "frontend-design",
            started: true,
          },
        })
        expect(Number(actions[0]?.payload.result?.decision_entries_count ?? 0)).toBeGreaterThan(0)
      },
    })
  })

  test("respond_agent_coordination redispatch starts the deep-research stage dispatcher", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_deep_research_redispatch_${stamp}`
    const taskID = `tsk_agent_coordination_deep_research_redispatch_${stamp}`
    const goalID = `gol_agent_coordination_deep_research_redispatch_${stamp}`
    const sourceURLs = ["https://example.com/research-source", "https://example.org/secondary-source"]
    let deepResearchInput: any
    let redispatchSessionID = ""

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination deep research redispatch",
      taskTitle: "agent coordination deep research redispatch",
      request: "Runtime-contract deep research worker asks for redispatch",
      goalTitle: "Coordinate deep research redispatch",
      goalSlug: "coordinate-deep-research-redispatch",
      objective: "Redispatch deep research through a concrete stage dispatcher binding",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination deep research root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "deep-research",
          parentID: parent.id,
          title: "agent coordination deep research source worker",
        })
        installDeepResearchRuntimeContract({ sessionID: worker.id, taskID })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        deepResearchRunImpl = async (input: any) => {
          deepResearchInput = input
          const redispatched = await Session.create({
            kind: "deep-research",
            parentID: parent.id,
            title: "agent coordination deep research redispatch worker",
          })
          redispatchSessionID = redispatched.id
          input.onSessionCreated?.(redispatched.id)
          return {
            sessionID: redispatched.id,
            brief: minimalDeepResearchBrief({
              taskID,
              sessionID: redispatched.id,
            }),
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "deep-research",
          messageID: Identifier.ascending("message"),
          summary: "Need deep research redispatch",
          details: "The worker is blocked and asks for a fresh research evidence pass.",
          blocking: true,
          requestedDecision: "redispatch",
          evidenceRefs: sourceURLs,
          severity: "blocked",
        })
        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "redispatch",
              reason: "Start a fresh deep research evidence pass.",
              message: "Focus on current documentation and source-map facts.",
            },
            await buildPersistedToolOptions({
              sessionID: parent.id,
              label: "respond_agent_coordination_deep_research_redispatch",
            }),
          ),
        )
        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with redispatch`)
        expect(result).toContain(`deep_research session ${redispatchSessionID} persisted brief`)
        expect(deepResearchInput.targetDeliverable).toBe("research_report")
        expect(deepResearchInput.sourceUrls).toEqual(sourceURLs)
        expect(deepResearchInput.focus).toBe("Focus on current documentation and source-map facts.")
        expect(deepResearchInput.reason).toContain(`A2A redispatch_worker for request ${request.payload.request_id}`)
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action: "redispatch_worker",
          status: "completed",
          result: {
            redispatch_binding: {
              dispatcher: "deep_research_stage",
              stage: "deep-research",
              target_kind: "deep-research",
            },
            dispatcher: "deep_research_stage",
            stage: "deep-research",
            source_session_id: worker.id,
            redispatch_session_id: redispatchSessionID,
            source_urls: sourceURLs,
            target_kind: "deep-research",
            started: true,
            redispatch_started: true,
            recovered_redispatch: false,
          },
        })
        const artifactID = actions[0]?.payload.result?.research_brief_artifact_id
        expect(typeof artifactID).toBe("string")
        const briefArtifact = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.id, String(artifactID))))
            .get(),
        )
        expect(briefArtifact?.kind).toBe("research_brief")
      },
    })
  })

  test("respond_agent_coordination redispatch recovers a pending deep-research action after brief persistence", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_deep_research_recover_${stamp}`
    const taskID = `tsk_agent_coordination_deep_research_recover_${stamp}`
    const goalID = `gol_agent_coordination_deep_research_recover_${stamp}`
    const sourceURLs = ["https://example.com/recovered-research", "https://example.org/recovered-secondary"]
    const reason = "Start a fresh deep research evidence pass and recover the persisted brief."
    const guidance = "Recover from the deep research brief that was already persisted before action completion."
    let deepResearchRunCalls = 0

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination deep research redispatch recovery",
      taskTitle: "agent coordination deep research redispatch recovery",
      request: "Runtime-contract deep research worker asks for redispatch recovery",
      goalTitle: "Coordinate deep research redispatch recovery",
      goalSlug: "coordinate-deep-research-redispatch-recovery",
      objective: "Recover a deep research redispatch action from durable brief evidence",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination deep research recovery root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "deep-research",
          parentID: parent.id,
          title: "agent coordination deep research source worker for recovery",
        })
        installDeepResearchRuntimeContract({ sessionID: worker.id, taskID })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const oldResearch = await Session.create({
          kind: "deep-research",
          parentID: parent.id,
          title: "agent coordination old deep research worker",
        })
        const oldArtifactID = persistTaskResearchBrief({
          taskID,
          brief: minimalDeepResearchBrief({ taskID, sessionID: oldResearch.id }),
        })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "deep-research",
          messageID: Identifier.ascending("message"),
          summary: "Need deep research redispatch recovery",
          details:
            "The worker is blocked and the prior redispatch persisted a research brief before action completion.",
          blocking: true,
          requestedDecision: "redispatch",
          evidenceRefs: sourceURLs,
          severity: "blocked",
        })
        const options = await buildPersistedToolOptions({
          sessionID: parent.id,
          label: "respond_agent_coordination_deep_research_recover",
        })
        const response = await createAgentCoordinationResponse({
          taskID,
          requestID: request.payload.request_id,
          orchestratorSessionID: options.opencorvus.sessionID,
          orchestratorMessageID: options.opencorvus.messageID,
          orchestratorToolCallID: options.opencorvus.toolCallID,
          orchestratorToolPartID: options.opencorvus.toolPartID,
          decision: "redispatch",
          reason,
          message: guidance,
          redispatchBinding: {
            dispatcher: "deep_research_stage",
            stage: "deep-research",
            target_kind: "deep-research",
          },
        })
        await recordAgentCoordinationActionProgress({
          taskID,
          actionID: response.payload.action_id,
          result: {
            dispatcher: "deep_research_stage",
            stage: "deep-research",
            source_session_id: worker.id,
            source_urls: sourceURLs,
            target_kind: "deep-research",
            redispatch_started: true,
            redispatch_started_at: Date.now(),
            preexisting_deep_research_session_ids: [worker.id, oldResearch.id],
            preexisting_research_brief_artifact_ids: [oldArtifactID],
          },
          summary: "redispatch_worker deep_research stage dispatch started",
        })
        const redispatched = await Session.create({
          kind: "deep-research",
          parentID: parent.id,
          title: "agent coordination deep research recovered worker",
        })
        const artifactID = persistTaskResearchBrief({
          taskID,
          brief: minimalDeepResearchBrief({ taskID, sessionID: redispatched.id }),
        })
        deepResearchRunImpl = async () => {
          deepResearchRunCalls += 1
          throw new Error("deep research dispatcher must not run during pending action recovery")
        }

        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "redispatch",
              reason,
              message: guidance,
            },
            options,
          ),
        )

        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with redispatch`)
        expect(result).toContain(`deep_research session ${redispatched.id} recovered persisted brief ${artifactID}`)
        expect(deepResearchRunCalls).toBe(0)
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action: "redispatch_worker",
          status: "completed",
          result: {
            dispatcher: "deep_research_stage",
            stage: "deep-research",
            source_session_id: worker.id,
            redispatch_session_id: redispatched.id,
            research_brief_artifact_id: artifactID,
            source_urls: sourceURLs,
            target_kind: "deep-research",
            started: true,
            redispatch_started: true,
            recovered_redispatch: true,
            preexisting_deep_research_session_ids: [worker.id, oldResearch.id],
            preexisting_research_brief_artifact_ids: [oldArtifactID],
          },
        })
      },
    })
  })

  test("respond_agent_coordination redispatch starts the visual-qa stage dispatcher", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_agent_coordination_visual_qa_redispatch_${stamp}`
    const goalID = `gol_agent_coordination_visual_qa_redispatch_${stamp}`
    let visualQaInput: any
    let redispatchSessionID = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination visual qa root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "agent coordination visual qa redispatch",
          taskTitle: "agent coordination visual qa redispatch",
          request: "Runtime-contract visual QA worker asks for redispatch",
          goalTitle: "Coordinate visual QA redispatch",
          goalSlug: "coordinate-visual-qa-redispatch",
          objective: "Redispatch visual QA through a concrete stage dispatcher binding",
          now,
          insertProject: false,
        })
        const worker = await Session.create({
          kind: "visual-qa",
          parentID: parent.id,
          title: "agent coordination visual qa source worker",
        })
        installVisualQaRuntimeContract({ sessionID: worker.id, taskID })
        visualQaAnalyzeImpl = async (input: any) => {
          visualQaInput = input
          const redispatched = await Session.create({
            kind: "visual-qa",
            parentID: parent.id,
            title: "agent coordination visual qa redispatch worker",
          })
          redispatchSessionID = redispatched.id
          input.onSessionCreated?.(redispatched.id)
          return {
            sessionID: redispatched.id,
            report: minimalVisualQaReport(),
            acceptance: minimalVisualQaAcceptance(),
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "visual-qa",
          messageID: Identifier.ascending("message"),
          summary: "Need visual QA redispatch",
          details: "The worker needs a fresh visual QA pass for the same task surface.",
          blocking: true,
          requestedDecision: "redispatch",
          severity: "blocked",
        })
        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "redispatch",
              reason: "Start a fresh visual QA pass.",
              message: "Focus on the main visible surface.",
            },
            await buildPersistedToolOptions({
              sessionID: parent.id,
              label: "respond_agent_coordination_visual_qa_redispatch",
            }),
          ),
        )
        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with redispatch`)
        expect(result).toContain(`visual_qa session ${redispatchSessionID} recorded report`)
        expect(visualQaInput.parentSessionID).toBe(parent.id)
        expect(visualQaInput.taskID).toBe(taskID)
        expect(visualQaInput.reason).toContain(`A2A redispatch_worker for request ${request.payload.request_id}.`)
        expect(visualQaInput.focus).toBe("Focus on the main visible surface.")
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        const visualQaDecisions = createDecisionLog(taskID).readByPhase("visual_qa")
        expect(visualQaDecisions.some((entry) => entry.key === "latest_summary")).toBe(true)
        expect(visualQaDecisions.some((entry) => entry.value.includes("Recovered visual QA report."))).toBe(true)
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action: "redispatch_worker",
          status: "completed",
          result: {
            redispatch_binding: {
              dispatcher: "visual_qa_stage",
              stage: "visual-qa",
              target_kind: "visual-qa",
            },
            dispatcher: "visual_qa_stage",
            stage: "visual-qa",
            source_session_id: worker.id,
            redispatch_session_id: redispatchSessionID,
            accepted: false,
            submitted_accepted: true,
            findings_count: 0,
            production_blockers_count: 0,
            evidence_count: 1,
            repairs_count: 0,
            changed_files_count: 0,
            target_kind: "visual-qa",
            started: true,
            redispatch_started: true,
            preexisting_visual_qa_session_ids: [worker.id],
            preexisting_visual_qa_decision_ids: [],
            recovered_redispatch: false,
          },
        })
      },
    })
  })

  test("respond_agent_coordination redispatch recovers a pending visual-qa action after report persistence", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_agent_coordination_visual_qa_recover_${stamp}`
    const goalID = `gol_agent_coordination_visual_qa_recover_${stamp}`
    const reason = "Recover the visual QA redispatch action after durable report persistence."
    const guidance = "Do not call Visual QA again; bind the completed durable report."
    let visualQaRunCalls = 0

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination visual qa recovery root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "agent coordination visual qa recovery",
          taskTitle: "agent coordination visual qa recovery",
          request: "Runtime-contract visual QA worker asks for redispatch and host restarts after report persistence",
          goalTitle: "Recover visual QA redispatch",
          goalSlug: "recover-visual-qa-redispatch",
          objective: "Recover visual QA through a durable decision-log report without duplicate analysis",
          now,
          insertProject: false,
        })
        const worker = await Session.create({
          kind: "visual-qa",
          parentID: parent.id,
          title: "agent coordination visual qa source worker for recovery",
        })
        installVisualQaRuntimeContract({ sessionID: worker.id, taskID })
        const oldVisualQa = await Session.create({
          kind: "visual-qa",
          parentID: parent.id,
          title: "agent coordination old visual qa worker",
        })
        const decisionLog = createDecisionLog(taskID)
        decisionLog.append({
          phase: "visual_qa",
          key: `report_old_${stamp}`,
          value: JSON.stringify(minimalVisualQaDecisionRecord(), null, 2),
          reason: `Dedicated frontend GUI and functional QA report from session ${oldVisualQa.id}`,
        })
        decisionLog.append({
          phase: "visual_qa",
          key: "latest_summary",
          value: "summary=Old visual QA report.",
          reason: "Latest structured visual QA summary for read_context and integrity review.",
        })
        const oldDecisionIDs = decisionLog.readByPhase("visual_qa").map((entry) => entry.id)
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "visual-qa",
          messageID: Identifier.ascending("message"),
          summary: "Need visual QA redispatch recovery",
          details: "The worker needs a fresh visual QA pass and the previous redispatch persisted report rows.",
          blocking: true,
          requestedDecision: "redispatch",
          severity: "blocked",
        })
        const options = await buildPersistedToolOptions({
          sessionID: parent.id,
          label: "respond_agent_coordination_visual_qa_recover",
        })
        const response = await createAgentCoordinationResponse({
          taskID,
          requestID: request.payload.request_id,
          orchestratorSessionID: options.opencorvus.sessionID,
          orchestratorMessageID: options.opencorvus.messageID,
          orchestratorToolCallID: options.opencorvus.toolCallID,
          orchestratorToolPartID: options.opencorvus.toolPartID,
          decision: "redispatch",
          reason,
          message: guidance,
          redispatchBinding: {
            dispatcher: "visual_qa_stage",
            stage: "visual-qa",
            target_kind: "visual-qa",
          },
        })
        await recordAgentCoordinationActionProgress({
          taskID,
          actionID: response.payload.action_id,
          result: {
            dispatcher: "visual_qa_stage",
            stage: "visual-qa",
            source_session_id: worker.id,
            target_kind: "visual-qa",
            redispatch_started: true,
            redispatch_started_at: Date.now(),
            preexisting_visual_qa_session_ids: [worker.id, oldVisualQa.id],
            preexisting_visual_qa_decision_ids: oldDecisionIDs,
          },
          summary: "redispatch_worker visual_qa stage dispatch started",
        })
        const redispatched = await Session.create({
          kind: "visual-qa",
          parentID: parent.id,
          title: "agent coordination visual qa recovered worker",
        })
        const report = minimalVisualQaReport()
        const acceptance = minimalVisualQaAcceptance()
        decisionLog.append({
          phase: "visual_qa",
          key: `report_${Date.now()}`,
          value: JSON.stringify({ report, acceptance }, null, 2),
          reason: `Dedicated frontend GUI and functional QA report from session ${redispatched.id}`,
        })
        decisionLog.append({
          phase: "visual_qa",
          key: "latest_summary",
          value: [
            "accepted=false",
            "submitted_accepted=true",
            "effective_accepted=false",
            "self_report_issues=1",
            `summary=${report.summary}`,
            "coverage=1",
            "findings=0",
            "production_blockers=0",
            "unresolved_code_module_problems=0",
            "evidence=1",
            "reference_parity_required=false",
            "reference_comparison_evidence=(none)",
            "reference_missing_regions=(none)",
            "changed_files=(none)",
          ].join("\n"),
          reason: "Latest structured visual QA summary for read_context and integrity review.",
        })
        const recoveredDecisions = decisionLog
          .readByPhase("visual_qa")
          .filter((entry) => !oldDecisionIDs.includes(entry.id))
        const reportDecision = recoveredDecisions.find((entry) => entry.key.startsWith("report_"))
        const summaryDecision = recoveredDecisions.find((entry) => entry.key === "latest_summary")
        visualQaAnalyzeImpl = async () => {
          visualQaRunCalls += 1
          throw new Error("visual QA dispatcher must not run during pending action recovery")
        }

        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "redispatch",
              reason,
              message: guidance,
            },
            options,
          ),
        )

        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with redispatch`)
        expect(result).toContain(`visual_qa session ${redispatched.id} recovered persisted report`)
        expect(visualQaRunCalls).toBe(0)
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action: "redispatch_worker",
          status: "completed",
          result: {
            dispatcher: "visual_qa_stage",
            stage: "visual-qa",
            source_session_id: worker.id,
            redispatch_session_id: redispatched.id,
            visual_qa_report_decision_id: reportDecision?.id,
            visual_qa_summary_decision_id: summaryDecision?.id,
            accepted: false,
            submitted_accepted: true,
            findings_count: 0,
            production_blockers_count: 0,
            evidence_count: 1,
            repairs_count: 0,
            changed_files_count: 0,
            target_kind: "visual-qa",
            started: true,
            redispatch_started: true,
            recovered_redispatch: true,
            preexisting_visual_qa_session_ids: [worker.id, oldVisualQa.id],
            preexisting_visual_qa_decision_ids: oldDecisionIDs,
          },
        })
      },
    })
  })

  test("respond_agent_coordination redispatch starts the integrity stage dispatcher", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_agent_coordination_integrity_redispatch_${stamp}`
    const goalID = `gol_agent_coordination_integrity_redispatch_${stamp}`
    const specID = `spec_agent_coordination_integrity_redispatch_${stamp}`
    let integrityInput: any
    let redispatchSessionID = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination integrity root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          specID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "agent coordination integrity redispatch",
          taskTitle: "agent coordination integrity redispatch",
          request: "Runtime-contract integrity worker asks for redispatch",
          goalTitle: "Coordinate integrity redispatch",
          goalSlug: "coordinate-integrity-redispatch",
          objective: "Redispatch integrity through a concrete stage dispatcher binding",
          now,
          insertProject: false,
        })
        const worker = await Session.create({
          kind: "integrity",
          parentID: parent.id,
          title: "agent coordination integrity source worker",
        })
        installIntegrityRuntimeContract({ sessionID: worker.id, taskID })
        computeRequirementStatusSnapshotImpl = () => [
          {
            requirementID: "REQ-1",
            claimingGoals: [{ goalID, runStatus: "completed" }],
          },
        ]
        reviewIntegrityImpl = async (input: any) => {
          integrityInput = input
          const redispatched = await Session.create({
            kind: "integrity",
            parentID: parent.id,
            title: "agent coordination integrity redispatch worker",
          })
          redispatchSessionID = redispatched.id
          input.onSessionCreated?.(redispatched.id)
          return integrityTeamResult({
            sessionID: redispatched.id,
            verdict: "pass",
            summary: "Recovered integrity review.",
          })
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "integrity",
          messageID: Identifier.ascending("message"),
          summary: "Need integrity redispatch",
          details: "The worker needs a fresh final integrity review for the same task.",
          blocking: true,
          requestedDecision: "redispatch",
          severity: "blocked",
        })
        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "redispatch",
              reason: "Start a fresh integrity review.",
              message: "Review the current active spec and terminal build evidence.",
            },
            await buildPersistedToolOptions({
              sessionID: parent.id,
              label: "respond_agent_coordination_integrity_redispatch",
            }),
          ),
        )
        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with redispatch`)
        expect(result).toContain(`integrity session ${redispatchSessionID} recorded pass review`)
        expect(integrityInput.parentSessionID).toBe(parent.id)
        expect(integrityInput.taskID).toBe(taskID)
        expect(integrityInput.task.id).toBe(taskID)
        expect(integrityInput.goals.map((goal: any) => goal.id)).toEqual([goalID])
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        const latest = findLatestIntegrityAttemptArtifact({
          taskID,
          specSnapshotID: specID,
          phase: "post_build",
        })
        expect((latest?.payload as any)?.session_id).toBe(redispatchSessionID)
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action: "redispatch_worker",
          status: "completed",
          result: {
            redispatch_binding: {
              dispatcher: "integrity_stage",
              stage: "integrity",
              target_kind: "integrity",
            },
            dispatcher: "integrity_stage",
            stage: "integrity",
            source_session_id: worker.id,
            redispatch_session_id: redispatchSessionID,
            spec_snapshot_id: specID,
            phase: "post_build",
            verdict: "pass",
            reviewer_count: 2,
            findings_count: 0,
            required_repairs_count: 0,
            unresolved_disagreements_count: 0,
            integrity_attempt_id: latest?.artifactID,
            target_kind: "integrity",
            started: true,
            redispatch_started: true,
            preexisting_integrity_session_ids: [worker.id],
            preexisting_integrity_attempt_artifact_ids: [],
            recovered_redispatch: false,
          },
        })
      },
    })
  })

  test("respond_agent_coordination redispatch recovers a pending integrity action after attempt persistence", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_agent_coordination_integrity_recover_${stamp}`
    const goalID = `gol_agent_coordination_integrity_recover_${stamp}`
    const specID = `spec_agent_coordination_integrity_recover_${stamp}`
    const reason = "Recover the integrity redispatch action after durable attempt persistence."
    const guidance = "Do not call integrity again; bind the completed durable integrity attempt."
    let integrityRunCalls = 0

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination integrity recovery root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          specID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "agent coordination integrity recovery",
          taskTitle: "agent coordination integrity recovery",
          request: "Runtime-contract integrity worker asks for redispatch and host restarts after attempt persistence",
          goalTitle: "Recover integrity redispatch",
          goalSlug: "recover-integrity-redispatch",
          objective: "Recover integrity through a durable integrity_attempt without duplicate review",
          now,
          insertProject: false,
        })
        const worker = await Session.create({
          kind: "integrity",
          parentID: parent.id,
          title: "agent coordination integrity source worker for recovery",
        })
        installIntegrityRuntimeContract({ sessionID: worker.id, taskID })
        const oldIntegrity = await Session.create({
          kind: "integrity",
          parentID: parent.id,
          title: "agent coordination old integrity worker",
        })
        const oldAttemptID = recordIntegrityAttempt({
          taskID,
          sessionID: oldIntegrity.id,
          lineage: activeOnlyLineage(taskID, specID),
          verdict: "needs_correction",
          phase: "post_build",
          reviewers: [{ reviewerID: "acceptance_surface", scope: "Acceptance", verdict: "needs_correction" }],
          findings: [integrityFinding({ id: "OLD-INTEGRITY", description: "Old integrity finding." })],
          requiredRepairs: [integrityRepair({ id: "OLD-REPAIR", description: "Old repair." })],
          unresolvedDisagreements: [],
          teamReportMarkdown: "Old integrity attempt",
          now: now + 1,
        })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "integrity",
          messageID: Identifier.ascending("message"),
          summary: "Need integrity redispatch recovery",
          details: "The worker needs a fresh integrity review and the prior redispatch persisted an attempt.",
          blocking: true,
          requestedDecision: "redispatch",
          severity: "blocked",
        })
        const options = await buildPersistedToolOptions({
          sessionID: parent.id,
          label: "respond_agent_coordination_integrity_recover",
        })
        const response = await createAgentCoordinationResponse({
          taskID,
          requestID: request.payload.request_id,
          orchestratorSessionID: options.opencorvus.sessionID,
          orchestratorMessageID: options.opencorvus.messageID,
          orchestratorToolCallID: options.opencorvus.toolCallID,
          orchestratorToolPartID: options.opencorvus.toolPartID,
          decision: "redispatch",
          reason,
          message: guidance,
          redispatchBinding: {
            dispatcher: "integrity_stage",
            stage: "integrity",
            target_kind: "integrity",
          },
        })
        await recordAgentCoordinationActionProgress({
          taskID,
          actionID: response.payload.action_id,
          result: {
            dispatcher: "integrity_stage",
            stage: "integrity",
            source_session_id: worker.id,
            target_kind: "integrity",
            redispatch_started: true,
            redispatch_started_at: Date.now(),
            preexisting_integrity_session_ids: [worker.id, oldIntegrity.id],
            preexisting_integrity_attempt_artifact_ids: [oldAttemptID],
          },
          summary: "redispatch_worker integrity stage dispatch started",
        })
        const redispatched = await Session.create({
          kind: "integrity",
          parentID: parent.id,
          title: "agent coordination integrity recovered worker",
        })
        const attemptID = recordIntegrityAttempt({
          taskID,
          sessionID: redispatched.id,
          lineage: activeOnlyLineage(taskID, specID),
          verdict: "pass",
          phase: "post_build",
          reviewers: [
            { reviewerID: "requirements_surface", scope: "Requirement fidelity", verdict: "pass" },
            { reviewerID: "acceptance_surface", scope: "Acceptance", verdict: "pass" },
          ],
          findings: [],
          requiredRepairs: [],
          unresolvedDisagreements: [],
          teamReportMarkdown: "Recovered integrity pass",
          now: Date.now(),
        })
        reviewIntegrityImpl = async () => {
          integrityRunCalls += 1
          throw new Error("integrity dispatcher must not run during pending action recovery")
        }

        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "redispatch",
              reason,
              message: guidance,
            },
            options,
          ),
        )

        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with redispatch`)
        expect(result).toContain(`integrity session ${redispatched.id} recovered persisted pass review`)
        expect(integrityRunCalls).toBe(0)
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        const latest = findLatestIntegrityAttemptArtifact({
          taskID,
          specSnapshotID: specID,
          phase: "post_build",
        })
        expect(latest?.artifactID).toBe(attemptID)
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action: "redispatch_worker",
          status: "completed",
          result: {
            dispatcher: "integrity_stage",
            stage: "integrity",
            source_session_id: worker.id,
            redispatch_session_id: redispatched.id,
            spec_snapshot_id: specID,
            phase: "post_build",
            verdict: "pass",
            reviewer_count: 2,
            findings_count: 0,
            required_repairs_count: 0,
            unresolved_disagreements_count: 0,
            integrity_attempt_id: attemptID,
            target_kind: "integrity",
            started: true,
            redispatch_started: true,
            recovered_redispatch: true,
            preexisting_integrity_session_ids: [worker.id, oldIntegrity.id],
            preexisting_integrity_attempt_artifact_ids: [oldAttemptID],
          },
        })
      },
    })
  })

  test("respond_agent_coordination redispatch starts the build stage dispatcher", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_agent_coordination_build_redispatch_${stamp}`
    const goalID = `gol_agent_coordination_build_redispatch_${stamp}`
    const specID = `spec_agent_coordination_build_redispatch_${stamp}`
    const redispatchSessionID = `ses_build_stage_redispatch_${stamp}`
    const sourceContractID = `art_build_source_contract_${stamp}`
    const sourceWorkspaceBranch = (await $`git branch --show-current`.cwd(tmp.path).quiet().text()).trim() || "master"
    let buildInput: any

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination build root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          specID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "agent coordination build redispatch",
          taskTitle: "agent coordination build redispatch",
          request: "Runtime-contract build worker asks for redispatch",
          goalTitle: "Build redispatch target",
          goalSlug: "build-redispatch-target",
          objective: "Start a replacement build through a concrete A2A build stage binding",
          now,
          insertProject: false,
        })
        const source = await Session.create({
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "agent coordination build source worker",
        })
        const targetRef = await AttachmentStore.write(
          Instance.project.id,
          Buffer.from(minimalPngBytes()),
          "image/png",
          "redispatch-source-reference.png",
        )
        const sourceRunID = await createAbortableCoordinatorRun({ taskID, sessionID: source.id, now })
        const sourceGoalRunID = beginBuildAttempt({
          taskID,
          goalID,
          runID: sourceRunID,
          sessionID: source.id,
          workspaceDir: tmp.path,
          workspaceBranch: sourceWorkspaceBranch,
        })
        expect(findGoalRun(sourceGoalRunID)?.workspace_dir).toBe(tmp.path)
        expect(findGoalRun(sourceGoalRunID)?.workspace_branch).toBe(sourceWorkspaceBranch)
        const sourceManifest = await composeBuildInputEvidenceManifest({
          projectID: Instance.project.id,
          taskID,
          goalID,
          sessionID: source.id,
          evidencePack: {
            targetReferences: [{ ...targetRef, intent: "visual_reference", source: "redispatch-source-contract" }],
          },
        })
        Database.use((db) =>
          db
            .insert(EngineArtifactTable)
            .values({
              id: sourceContractID,
              task_id: taskID,
              run_id: sourceRunID,
              goal_run_id: sourceGoalRunID,
              kind: "build_session_contract",
              label: "build-session-contract",
              payload: {
                session_id: source.id,
                task_id: taskID,
                goal_id: goalID,
                goal_run_id: sourceGoalRunID,
                input_evidence: sourceManifest,
                digest: "source-contract",
              },
              time_created: now + 5,
              time_updated: now + 5,
            })
            .run(),
        )
        installBuildRuntimeContract({ sessionID: source.id, taskID, goalID, goalRunID: sourceGoalRunID })
        const ownershipPayload = createOrchestratorToolOwnershipPayload({
          taskID,
          orchestratorSessionID: parent.id,
          orchestratorMessageID: `msg_a2a_build_redispatch_${stamp}`,
          toolCallID: `cal_a2a_build_redispatch_${stamp}`,
          toolPartID: `prt_a2a_build_redispatch_${stamp}`,
          childSessionID: source.id,
          scope: "goal",
          goalID,
          goalRunID: sourceGoalRunID,
        })
        insertOrchestratorToolOwnershipArtifact({
          taskID,
          goalRunID: sourceGoalRunID,
          label: "tool-ownership-start",
          payload: ownershipPayload,
        })
        buildAgentRunImpl = async (input: any) => {
          buildInput = input
          await markBuildSlotAcquired(input, redispatchSessionID)
          return {
            result: {
              status: "passed",
              summary: "Replacement build started from A2A build_stage redispatch.",
              files_changed: [],
              tests: [],
              commit_ref: "abc1234",
            },
            sessionID: redispatchSessionID,
            worktreeDir: input.managedWorktree.directory,
            worktreeBranch: input.managedWorktree.branch,
            worktreeBaseRef: input.managedWorktree.baseRef,
            mergeBackStatus: "not_invoked",
            actualChangedFiles: [],
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: source.id,
          agent: "build",
          messageID: Identifier.ascending("message"),
          summary: "Need replacement build",
          details: "The active build found its current attempt is unrecoverable and needs a fresh attempt.",
          blocking: true,
          requestedDecision: "redispatch",
          severity: "blocked",
          goalID,
          goalRunID: sourceGoalRunID,
        })
        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "redispatch",
              reason: "Stop the stuck build attempt and start a replacement build.",
              message: "Preserve the same goal contract and retry from the durable build facts.",
            },
            await buildPersistedToolOptions({
              sessionID: parent.id,
              label: "respond_agent_coordination_build_redispatch",
            }),
          ),
        )

        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with redispatch`)
        expect(result).toContain(`build session ${redispatchSessionID} started goal_run`)
        expect(findGoalRun(sourceGoalRunID)?.status).toBe("aborted")
        expect(findGoalRun(sourceGoalRunID)?.error).toContain("respond_agent_coordination:")
        expect(buildInput.target.id).toBe(goalID)
        expect(buildInput.parentSessionID).toBe(parent.id)
        expect(buildInput.context?.retryGuidance).toContain("Worker summary: Need replacement build")
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )

        const newRuns = listGoalRunsByGoal(goalID).filter((goalRun) => goalRun.id !== sourceGoalRunID)
        expect(newRuns).toHaveLength(1)
        const redispatchGoalRun = newRuns[0]!
        expect(redispatchGoalRun.session_id).toBe(redispatchSessionID)
        const contractRow = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "build_session_contract")))
            .all(),
        ).find((row) => (row.payload as any)?.goal_run_id === redispatchGoalRun.id)
        expect(contractRow?.id).toBeDefined()

        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action: "redispatch_worker",
          status: "completed",
          result: {
            redispatch_binding: {
              dispatcher: "build_stage",
              stage: "build",
              target_kind: "build",
            },
            dispatcher: "build_stage",
            stage: "build",
            source_session_id: source.id,
            source_goal_run_id: sourceGoalRunID,
            source_goal_run_status: "aborted",
            redispatch_session_id: redispatchSessionID,
            redispatch_goal_run_id: redispatchGoalRun.id,
            build_session_contract_id: contractRow?.id,
            goal_id: goalID,
            target_kind: "build",
            started: true,
            redispatch_started: true,
            preexisting_build_goal_run_ids: [sourceGoalRunID],
            preexisting_build_session_contract_ids: [sourceContractID],
            recovered_redispatch: false,
          },
        })
      },
    })
  })

  test("respond_agent_coordination redispatch recovers a pending build action after goal_run persistence", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_agent_coordination_build_recover_${stamp}`
    const goalID = `gol_agent_coordination_build_recover_${stamp}`
    const specID = `spec_agent_coordination_build_recover_${stamp}`
    const sourceContractID = `art_build_source_contract_${stamp}`
    const redispatchContractID = `art_build_redispatch_contract_${stamp}`
    const sourceWorkspaceBranch = (await $`git branch --show-current`.cwd(tmp.path).quiet().text()).trim() || "master"
    const reason = "Recover the build redispatch action after durable goal_run persistence."
    const guidance = "Do not call build again; bind the completed durable build start."
    let buildRunCalls = 0

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination build recovery root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          specID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "agent coordination build recovery",
          taskTitle: "agent coordination build recovery",
          request: "Runtime-contract build worker asks for redispatch and host restarts after build start persistence",
          goalTitle: "Recover build redispatch",
          goalSlug: "recover-build-redispatch",
          objective: "Recover build redispatch through durable goal_run and build_session_contract evidence",
          now,
          insertProject: false,
        })
        const source = await Session.create({
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "agent coordination build source worker for recovery",
        })
        const sourceRunID = await createAbortableCoordinatorRun({ taskID, sessionID: source.id, now })
        const sourceGoalRunID = beginBuildAttempt({
          taskID,
          goalID,
          runID: sourceRunID,
          sessionID: source.id,
          workspaceDir: tmp.path,
          workspaceBranch: sourceWorkspaceBranch,
          extraArtifacts: ({ goalRunID }) => [
            {
              id: sourceContractID,
              kind: "build_session_contract",
              label: "build-session-contract",
              runID: sourceRunID,
              goalRunID,
              payload: {
                session_id: source.id,
                task_id: taskID,
                goal_id: goalID,
                goal_run_id: goalRunID,
                digest: "source-contract",
              },
            },
          ],
        })
        installBuildRuntimeContract({ sessionID: source.id, taskID, goalID, goalRunID: sourceGoalRunID })
        const ownershipPayload = createOrchestratorToolOwnershipPayload({
          taskID,
          orchestratorSessionID: parent.id,
          orchestratorMessageID: `msg_a2a_build_recover_${stamp}`,
          toolCallID: `cal_a2a_build_recover_${stamp}`,
          toolPartID: `prt_a2a_build_recover_${stamp}`,
          childSessionID: source.id,
          scope: "goal",
          goalID,
          goalRunID: sourceGoalRunID,
        })
        insertOrchestratorToolOwnershipArtifact({
          taskID,
          goalRunID: sourceGoalRunID,
          label: "tool-ownership-start",
          payload: ownershipPayload,
        })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: source.id,
          agent: "build",
          messageID: Identifier.ascending("message"),
          summary: "Need build redispatch recovery",
          details: "The source build needs a replacement and the replacement build start already persisted.",
          blocking: true,
          requestedDecision: "redispatch",
          severity: "blocked",
          goalID,
          goalRunID: sourceGoalRunID,
        })
        const options = await buildPersistedToolOptions({
          sessionID: parent.id,
          label: "respond_agent_coordination_build_recover",
        })
        const response = await createAgentCoordinationResponse({
          taskID,
          requestID: request.payload.request_id,
          orchestratorSessionID: options.opencorvus.sessionID,
          orchestratorMessageID: options.opencorvus.messageID,
          orchestratorToolCallID: options.opencorvus.toolCallID,
          orchestratorToolPartID: options.opencorvus.toolPartID,
          decision: "redispatch",
          reason,
          message: guidance,
          redispatchBinding: {
            dispatcher: "build_stage",
            stage: "build",
            target_kind: "build",
          },
        })
        updateGoalRun(sourceGoalRunID, {
          status: "aborted",
          error: "respond_agent_coordination: source stopped before redispatch",
        })
        await recordAgentCoordinationActionProgress({
          taskID,
          actionID: response.payload.action_id,
          result: {
            dispatcher: "build_stage",
            stage: "build",
            source_session_id: source.id,
            source_goal_run_id: sourceGoalRunID,
            source_cancel_summary: ` goal_run ${sourceGoalRunID} aborted.`,
            goal_id: goalID,
            target_kind: "build",
            redispatch_started: true,
            redispatch_started_at: Date.now(),
            preexisting_build_goal_run_ids: [sourceGoalRunID],
            preexisting_build_session_contract_ids: [sourceContractID],
          },
          summary: "redispatch_worker build stage dispatch started",
        })
        const redispatched = await Session.create({
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "agent coordination build recovered worker",
        })
        const redispatchRunID = await createAbortableCoordinatorRun({ taskID, sessionID: redispatched.id, now })
        const redispatchGoalRunID = beginBuildAttempt({
          taskID,
          goalID,
          runID: redispatchRunID,
          sessionID: redispatched.id,
          workspaceDir: tmp.path,
          workspaceBranch: sourceWorkspaceBranch,
          extraArtifacts: ({ goalRunID }) => [
            {
              id: redispatchContractID,
              kind: "build_session_contract",
              label: "build-session-contract",
              runID: redispatchRunID,
              goalRunID,
              payload: {
                session_id: redispatched.id,
                task_id: taskID,
                goal_id: goalID,
                goal_run_id: goalRunID,
                digest: "redispatch-contract",
              },
            },
          ],
        })
        buildAgentRunImpl = async () => {
          buildRunCalls += 1
          throw new Error("build dispatcher must not run during pending action recovery")
        }

        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "redispatch",
              reason,
              message: guidance,
            },
            options,
          ),
        )

        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with redispatch`)
        expect(result).toContain(`build session ${redispatched.id} recovered persisted goal_run ${redispatchGoalRunID}`)
        expect(buildRunCalls).toBe(0)
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        expect(findGoalRun(sourceGoalRunID)?.status).toBe("aborted")
        expect(findGoalRun(redispatchGoalRunID)?.session_id).toBe(redispatched.id)
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action: "redispatch_worker",
          status: "completed",
          result: {
            dispatcher: "build_stage",
            stage: "build",
            source_session_id: source.id,
            source_goal_run_id: sourceGoalRunID,
            source_goal_run_status: "aborted",
            source_cancel_summary: ` goal_run ${sourceGoalRunID} aborted.`,
            redispatch_session_id: redispatched.id,
            redispatch_goal_run_id: redispatchGoalRunID,
            redispatch_goal_run_status: "running",
            build_session_contract_id: redispatchContractID,
            worktree_dir: tmp.path,
            worktree_branch: sourceWorkspaceBranch,
            goal_id: goalID,
            target_kind: "build",
            started: true,
            redispatch_started: true,
            recovered_redispatch: true,
            preexisting_build_goal_run_ids: [sourceGoalRunID],
            preexisting_build_session_contract_ids: [sourceContractID],
          },
        })
      },
    })
  })

  test("respond_agent_coordination redispatch starts the intent-analysis stage dispatcher", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_intent_redispatch_${stamp}`
    const taskID = `tsk_agent_coordination_intent_redispatch_${stamp}`
    const goalID = `gol_agent_coordination_intent_redispatch_${stamp}`
    let intentAnalysisInput: any
    let redispatchSessionID = ""

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination intent redispatch",
      taskTitle: "agent coordination intent redispatch",
      request: "Runtime-contract intent-analysis worker asks for redispatch",
      goalTitle: "Coordinate intent redispatch",
      goalSlug: "coordinate-intent-redispatch",
      objective: "Redispatch intent analysis through a concrete stage dispatcher binding",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination intent root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "intent-analysis",
          parentID: parent.id,
          title: "agent coordination intent source worker",
        })
        installIntentAnalysisRuntimeContract({ sessionID: worker.id, taskID })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        intentAnalysisAnalyzeImpl = async (input: any) => {
          intentAnalysisInput = input
          const redispatched = await Session.create({
            kind: "intent-analysis",
            parentID: parent.id,
            title: "agent coordination intent redispatch worker",
          })
          redispatchSessionID = redispatched.id
          input.onSessionCreated?.(redispatched.id)
          return {
            sessionID: redispatched.id,
            result: {
              intent_class: "feature",
              complexity: "medium",
              extracted_slots: [{ key: "target_protocol", value: "A2A", confidence: 0.97 }],
              missing_info: [],
              clarifications: [],
              confidence: 0.91,
              summary: "Build a mature A2A protocol.",
            },
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "intent-analysis",
          messageID: Identifier.ascending("message"),
          summary: "Need intent-analysis redispatch",
          details: "The worker needs a fresh intent-analysis pass before downstream planning.",
          blocking: true,
          requestedDecision: "redispatch",
          severity: "blocked",
        })
        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "redispatch",
              reason: "Start a fresh intent-analysis pass.",
              message: "Focus on the enterprise A2A protocol objective.",
            },
            await buildPersistedToolOptions({
              sessionID: parent.id,
              label: "respond_agent_coordination_intent_redispatch",
            }),
          ),
        )

        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with redispatch`)
        expect(result).toContain(`intent_analysis session ${redispatchSessionID} recorded intent_summary`)
        expect(intentAnalysisInput.parentSessionID).toBe(parent.id)
        expect(intentAnalysisInput.taskID).toBe(taskID)
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        const intentEntries = createDecisionLog(taskID).readByPhase("intent_analysis")
        expect(intentEntries.some((entry) => entry.key === "intent_summary")).toBe(true)
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action: "redispatch_worker",
          status: "completed",
          result: {
            redispatch_binding: {
              dispatcher: "intent_analysis_stage",
              stage: "intent-analysis",
              target_kind: "intent-analysis",
            },
            dispatcher: "intent_analysis_stage",
            stage: "intent-analysis",
            source_session_id: worker.id,
            redispatch_session_id: redispatchSessionID,
            decision_entries_count: 2,
            target_kind: "intent-analysis",
            started: true,
            redispatch_started: true,
            preexisting_intent_analysis_session_ids: [worker.id],
            preexisting_intent_analysis_decision_ids: [],
            recovered_redispatch: false,
          },
        })
        expect(actions[0]?.payload.result?.intent_summary).toContain("feature / medium / confidence=0.91")
      },
    })
  })

  test("respond_agent_coordination redispatch recovers a pending intent-analysis action after decision persistence", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_intent_recover_${stamp}`
    const taskID = `tsk_agent_coordination_intent_recover_${stamp}`
    const goalID = `gol_agent_coordination_intent_recover_${stamp}`
    const reason = "Recover intent-analysis redispatch after durable intent evidence."
    const guidance = "Do not call analyze_intent again; bind the persisted intent_summary."
    let intentAnalysisCalls = 0

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination intent recovery",
      taskTitle: "agent coordination intent recovery",
      request: "Runtime-contract intent-analysis worker asks for redispatch and host restarts after intent persistence",
      goalTitle: "Recover intent redispatch",
      goalSlug: "recover-intent-redispatch",
      objective: "Recover intent redispatch through durable decision-log evidence",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination intent recovery root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "intent-analysis",
          parentID: parent.id,
          title: "agent coordination intent source worker for recovery",
        })
        installIntentAnalysisRuntimeContract({ sessionID: worker.id, taskID })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "intent-analysis",
          messageID: Identifier.ascending("message"),
          summary: "Need intent-analysis redispatch recovery",
          details: "The worker needs a fresh intent pass and the prior redispatch persisted intent evidence.",
          blocking: true,
          requestedDecision: "redispatch",
          severity: "blocked",
        })
        const options = await buildPersistedToolOptions({
          sessionID: parent.id,
          label: "respond_agent_coordination_intent_recover",
        })
        const response = await createAgentCoordinationResponse({
          taskID,
          requestID: request.payload.request_id,
          orchestratorSessionID: options.opencorvus.sessionID,
          orchestratorMessageID: options.opencorvus.messageID,
          orchestratorToolCallID: options.opencorvus.toolCallID,
          orchestratorToolPartID: options.opencorvus.toolPartID,
          decision: "redispatch",
          reason,
          message: guidance,
          redispatchBinding: {
            dispatcher: "intent_analysis_stage",
            stage: "intent-analysis",
            target_kind: "intent-analysis",
          },
        })
        await recordAgentCoordinationActionProgress({
          taskID,
          actionID: response.payload.action_id,
          result: {
            dispatcher: "intent_analysis_stage",
            stage: "intent-analysis",
            source_session_id: worker.id,
            target_kind: "intent-analysis",
            redispatch_started: true,
            redispatch_started_at: Date.now(),
            preexisting_intent_analysis_session_ids: [worker.id],
            preexisting_intent_analysis_decision_ids: [],
          },
          summary: "redispatch_worker intent_analysis stage dispatch started",
        })
        const redispatched = await Session.create({
          kind: "intent-analysis",
          parentID: parent.id,
          title: "agent coordination intent recovered worker",
        })
        const decisionLog = createDecisionLog(taskID)
        decisionLog.append({
          phase: "intent_analysis",
          key: "intent_summary",
          value: "feature / medium / confidence=0.94. Recover the mature A2A protocol intent.",
          reason: "Recovered persisted intent summary.",
        })
        decisionLog.append({
          phase: "intent_analysis",
          key: "intent_slots",
          value: "target_protocol=A2A (conf=0.99)",
          reason: "Recovered persisted intent slots.",
        })
        const summaryEntry = decisionLog.readByPhase("intent_analysis").find((entry) => entry.key === "intent_summary")
        expect(summaryEntry?.id).toBeDefined()
        intentAnalysisAnalyzeImpl = async () => {
          intentAnalysisCalls += 1
          throw new Error("intent-analysis dispatcher must not run during pending action recovery")
        }

        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "redispatch",
              reason,
              message: guidance,
            },
            options,
          ),
        )

        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with redispatch`)
        expect(result).toContain(`intent_analysis session ${redispatched.id} recovered persisted intent_summary`)
        expect(intentAnalysisCalls).toBe(0)
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action: "redispatch_worker",
          status: "completed",
          result: {
            dispatcher: "intent_analysis_stage",
            stage: "intent-analysis",
            source_session_id: worker.id,
            redispatch_session_id: redispatched.id,
            decision_entries_count: 2,
            intent_summary: "feature / medium / confidence=0.94. Recover the mature A2A protocol intent.",
            intent_summary_decision_id: summaryEntry?.id,
            target_kind: "intent-analysis",
            started: true,
            redispatch_started: true,
            preexisting_intent_analysis_session_ids: [worker.id],
            preexisting_intent_analysis_decision_ids: [],
            recovered_redispatch: true,
          },
        })
      },
    })
  })

  test("respond_agent_coordination redispatch starts the explore stage dispatcher", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_explore_redispatch_${stamp}`
    const taskID = `tsk_agent_coordination_explore_redispatch_${stamp}`
    const goalID = `gol_agent_coordination_explore_redispatch_${stamp}`
    let exploreInput: any
    let redispatchSessionID = ""

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination explore redispatch",
      taskTitle: "agent coordination explore redispatch",
      request: "Runtime-contract explore worker asks for redispatch",
      goalTitle: "Coordinate explore redispatch",
      goalSlug: "coordinate-explore-redispatch",
      objective: "Redispatch repository investigation through a concrete explore stage dispatcher binding",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination explore root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "explore",
          parentID: parent.id,
          title: "agent coordination explore source worker",
        })
        installExploreRuntimeContract({ sessionID: worker.id, taskID })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        exploreRunImpl = async (input: any) => {
          exploreInput = input
          const redispatched = await Session.create({
            kind: "explore",
            parentID: parent.id,
            title: "agent coordination explore redispatch worker",
          })
          redispatchSessionID = redispatched.id
          return {
            sessionID: redispatched.id,
            finalText: "Explored A2A scheduler code paths in packages/opencorvus/src/orchestrator/tools.ts.",
            finalMessage: {} as any,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "explore",
          messageID: Identifier.ascending("message"),
          summary: "Need repository investigation",
          details: "Find scheduler/A2A call sites before changing protocol.",
          blocking: true,
          requestedDecision: "redispatch",
          severity: "blocked",
        })
        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "redispatch",
              reason: "Start a fresh repository investigation from durable A2A context.",
              message: "Inspect durable request/action evidence and scheduler entry points.",
            },
            await buildPersistedToolOptions({
              sessionID: parent.id,
              label: "respond_agent_coordination_explore_redispatch",
            }),
          ),
        )

        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with redispatch`)
        expect(result).toContain(`explore session ${redispatchSessionID} recorded repository investigation`)
        expect(exploreInput.parentSessionID).toBe(parent.id)
        expect(exploreInput.taskID).toBe(taskID)
        expect(exploreInput.prompt).toContain("Need repository investigation")
        expect(exploreInput.prompt).toContain("Find scheduler/A2A call sites before changing protocol.")
        expect(exploreInput.prompt).toContain("Inspect durable request/action evidence and scheduler entry points.")
        expect(exploreInput.toolSwitches).toMatchObject({
          bash: false,
          edit: false,
          write: false,
          task: false,
          todowrite: false,
          todoread: false,
        })
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )

        const exploreEntries = createDecisionLog(taskID).readByPhase("explore")
        expect(exploreEntries).toHaveLength(1)
        expect(exploreEntries[0]?.key).toBe(`repo_investigation_${redispatchSessionID}`)
        expect(exploreEntries[0]?.value).toContain("Explored A2A scheduler code paths")
        const explorationArtifacts = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "exploration")))
            .all(),
        )
        expect(explorationArtifacts).toHaveLength(1)
        expect((explorationArtifacts[0]?.payload as any)?.session_id).toBe(redispatchSessionID)
        expect((explorationArtifacts[0]?.payload as any)?.question).toContain("Need repository investigation")

        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action: "redispatch_worker",
          status: "completed",
          result: {
            redispatch_binding: {
              dispatcher: "explore_stage",
              stage: "explore",
              target_kind: "explore",
            },
            dispatcher: "explore_stage",
            stage: "explore",
            source_session_id: worker.id,
            redispatch_session_id: redispatchSessionID,
            decision_entries_count: 1,
            exploration_artifacts_count: 1,
            explore_decision_id: exploreEntries[0]?.id,
            exploration_artifact_id: explorationArtifacts[0]?.id,
            target_kind: "explore",
            started: true,
            redispatch_started: true,
            preexisting_explore_session_ids: [worker.id],
            preexisting_explore_decision_ids: [],
            preexisting_exploration_artifact_ids: [],
            recovered_redispatch: false,
          },
        })
        expect(actions[0]?.payload.result?.question).toContain("Need repository investigation")
      },
    })
  })

  test("respond_agent_coordination redispatch recovers a pending explore action after investigation persistence", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_explore_recover_${stamp}`
    const taskID = `tsk_agent_coordination_explore_recover_${stamp}`
    const goalID = `gol_agent_coordination_explore_recover_${stamp}`
    const reason = "Recover explore redispatch after durable repository investigation."
    const guidance = "Do not call explore again; bind the persisted investigation."
    const summary = "Need repository investigation recovery"
    const details = "Find scheduler/A2A replay recovery gaps before changing protocol."
    const question = [summary, details, `Orchestrator guidance: ${guidance}`].join("\n\n")
    const explorationArtifactID = `art_explore_recover_${stamp}`
    let exploreCalls = 0

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination explore recovery",
      taskTitle: "agent coordination explore recovery",
      request: "Runtime-contract explore worker asks for redispatch and host restarts after investigation persistence",
      goalTitle: "Recover explore redispatch",
      goalSlug: "recover-explore-redispatch",
      objective: "Recover explore redispatch through durable investigation evidence",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination explore recovery root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "explore",
          parentID: parent.id,
          title: "agent coordination explore source worker for recovery",
        })
        installExploreRuntimeContract({ sessionID: worker.id, taskID })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "explore",
          messageID: Identifier.ascending("message"),
          summary,
          details,
          blocking: true,
          requestedDecision: "redispatch",
          severity: "blocked",
        })
        const options = await buildPersistedToolOptions({
          sessionID: parent.id,
          label: "respond_agent_coordination_explore_recover",
        })
        const response = await createAgentCoordinationResponse({
          taskID,
          requestID: request.payload.request_id,
          orchestratorSessionID: options.opencorvus.sessionID,
          orchestratorMessageID: options.opencorvus.messageID,
          orchestratorToolCallID: options.opencorvus.toolCallID,
          orchestratorToolPartID: options.opencorvus.toolPartID,
          decision: "redispatch",
          reason,
          message: guidance,
          redispatchBinding: {
            dispatcher: "explore_stage",
            stage: "explore",
            target_kind: "explore",
          },
        })
        await recordAgentCoordinationActionProgress({
          taskID,
          actionID: response.payload.action_id,
          result: {
            dispatcher: "explore_stage",
            stage: "explore",
            source_session_id: worker.id,
            question,
            target_kind: "explore",
            redispatch_started: true,
            redispatch_started_at: Date.now(),
            preexisting_explore_session_ids: [worker.id],
            preexisting_explore_decision_ids: [],
            preexisting_exploration_artifact_ids: [],
          },
          summary: "redispatch_worker explore stage dispatch started",
        })
        const redispatched = await Session.create({
          kind: "explore",
          parentID: parent.id,
          title: "agent coordination explore recovered worker",
        })
        const resultText = "Recovered persisted investigation of A2A scheduler replay paths."
        const decisionLog = createDecisionLog(taskID)
        decisionLog.append({
          phase: "explore",
          key: `repo_investigation_${redispatched.id}`,
          value: resultText,
          reason,
        })
        const decisionEntry = decisionLog
          .readByPhase("explore")
          .find((entry) => entry.key === `repo_investigation_${redispatched.id}`)
        expect(decisionEntry?.id).toBeDefined()
        Database.use((db) =>
          db
            .insert(EngineArtifactTable)
            .values({
              id: explorationArtifactID,
              task_id: taskID,
              kind: "exploration",
              label: "explore",
              payload: {
                question,
                reason,
                session_id: redispatched.id,
                result: resultText,
              },
              time_created: Date.now(),
              time_updated: Date.now(),
            })
            .run(),
        )
        exploreRunImpl = async () => {
          exploreCalls += 1
          throw new Error("explore dispatcher must not run during pending action recovery")
        }

        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "redispatch",
              reason,
              message: guidance,
            },
            options,
          ),
        )

        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with redispatch`)
        expect(result).toContain(`explore session ${redispatched.id} recovered persisted repository investigation`)
        expect(exploreCalls).toBe(0)
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action: "redispatch_worker",
          status: "completed",
          result: {
            dispatcher: "explore_stage",
            stage: "explore",
            source_session_id: worker.id,
            redispatch_session_id: redispatched.id,
            decision_entries_count: 1,
            exploration_artifacts_count: 1,
            explore_decision_id: decisionEntry?.id,
            exploration_artifact_id: explorationArtifactID,
            question,
            target_kind: "explore",
            started: true,
            redispatch_started: true,
            preexisting_explore_session_ids: [worker.id],
            preexisting_explore_decision_ids: [],
            preexisting_exploration_artifact_ids: [],
            recovered_redispatch: true,
          },
        })
      },
    })
  })

  test("respond_agent_coordination redispatch starts the workload-analysis stage dispatcher", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_agent_coordination_workload_redispatch_${stamp}`
    const goalID = `gol_agent_coordination_workload_redispatch_${stamp}`
    const specID = `spec_agent_coordination_workload_redispatch_${stamp}`
    let workloadInput: any
    let redispatchSessionID = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          specID,
          sessionID: null,
          worktree: tmp.path,
          projectName: "agent coordination workload redispatch",
          taskTitle: "agent coordination workload redispatch",
          request: "Runtime-contract workload analyst asks for redispatch",
          goalTitle: "Coordinate workload redispatch",
          goalSlug: "coordinate-workload-redispatch",
          objective: "Redispatch workload analysis through a concrete stage dispatcher binding",
          now,
          insertProject: false,
        })
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination workload root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "goal-workload-analyst",
          parentID: parent.id,
          title: "agent coordination workload source worker",
        })
        installGoalWorkloadRuntimeContract({ sessionID: worker.id, taskID })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        goalWorkloadAnalyzeImpl = async (input: any) => {
          workloadInput = input
          const redispatched = await Session.create({
            kind: "goal-workload-analyst",
            parentID: parent.id,
            title: "agent coordination workload redispatch worker",
          })
          redispatchSessionID = redispatched.id
          input.onSessionCreated?.(redispatched.id)
          return {
            sessionID: redispatched.id,
            specSnapshotID: input.specSnapshotID,
            summary: "1 goal analyzed, 1 flagged for decomposition review.",
            briefs: [
              {
                goal_id: goalID,
                decomposition_concern: "The goal crosses protocol, tests, and replay evidence in one build.",
                why_not_smaller: ["A2A persistence and replay verification are separate work surfaces."],
                underestimation_traps: ["Do not stop after adding only a request/response row."],
                execution_inventory: {
                  surfaces: 3,
                  states: 2,
                  data_contracts: 2,
                  verification_points: 4,
                },
                verification_inventory: ["A2A action is durable.", "Task conversation replay exposes the action."],
                references: {
                  contract_ids: [],
                  reference_coverage_ids: [],
                  acceptance_spec_ids: [],
                  visual_spec_ids: [],
                  prd_sections: ["A2A protocol"],
                },
              },
            ],
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "goal-workload-analyst",
          messageID: Identifier.ascending("message"),
          summary: "Need workload analysis redispatch",
          details: "The workload analyst needs a fresh run against the active spec and goal graph.",
          blocking: true,
          requestedDecision: "redispatch",
          severity: "blocked",
        })
        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "redispatch",
              reason: "Start a fresh workload analysis pass from durable A2A context.",
              message: "Re-check goal sizing before dispatching build.",
            },
            await buildPersistedToolOptions({
              sessionID: parent.id,
              label: "respond_agent_coordination_workload_redispatch",
            }),
          ),
        )

        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with redispatch`)
        expect(result).toContain(`workload_analysis session ${redispatchSessionID} persisted workload artifact`)
        expect(workloadInput.parentSessionID).toBe(parent.id)
        expect(workloadInput.taskID).toBe(taskID)
        expect(workloadInput.specSnapshotID).toBe(specID)
        expect(workloadInput.goals.map((goal: { id: string }) => goal.id)).toEqual([goalID])
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )

        const workloadArtifacts = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "goal_workload")))
            .all(),
        )
        expect(workloadArtifacts).toHaveLength(1)
        expect((workloadArtifacts[0]?.payload as any)?.spec_snapshot_id).toBe(specID)
        expect((workloadArtifacts[0]?.payload as any)?.briefs?.[0]?.goal_id).toBe(goalID)

        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action: "redispatch_worker",
          status: "completed",
          result: {
            redispatch_binding: {
              dispatcher: "workload_analysis_stage",
              stage: "goal-workload-analyst",
              target_kind: "goal-workload-analyst",
            },
            dispatcher: "workload_analysis_stage",
            stage: "goal-workload-analyst",
            source_session_id: worker.id,
            redispatch_session_id: redispatchSessionID,
            goal_workload_artifact_id: workloadArtifacts[0]?.id,
            spec_snapshot_id: specID,
            briefs_count: 1,
            flagged_goals_count: 1,
            expected_goals_count: 1,
            target_kind: "goal-workload-analyst",
            started: true,
            redispatch_started: true,
            preexisting_goal_workload_session_ids: [worker.id],
            preexisting_goal_workload_artifact_ids: [],
            recovered_redispatch: false,
          },
        })
      },
    })
  })

  test("respond_agent_coordination redispatch recovers a pending workload-analysis action after artifact persistence", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_agent_coordination_workload_recover_${stamp}`
    const goalID = `gol_agent_coordination_workload_recover_${stamp}`
    const specID = `spec_agent_coordination_workload_recover_${stamp}`
    const artifactID = `art_goal_workload_recover_${stamp}`
    const reason = "Recover workload-analysis redispatch after durable workload evidence."
    const guidance = "Do not call workload_analysis again; bind the persisted goal_workload artifact."
    let workloadCalls = 0

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          specID,
          sessionID: null,
          worktree: tmp.path,
          projectName: "agent coordination workload recovery",
          taskTitle: "agent coordination workload recovery",
          request: "Runtime-contract workload analyst asks for redispatch and host restarts after artifact persistence",
          goalTitle: "Recover workload redispatch",
          goalSlug: "recover-workload-redispatch",
          objective: "Recover workload redispatch through durable goal_workload evidence",
          now,
          insertProject: false,
        })
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination workload recovery root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "goal-workload-analyst",
          parentID: parent.id,
          title: "agent coordination workload source worker for recovery",
        })
        installGoalWorkloadRuntimeContract({ sessionID: worker.id, taskID })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "goal-workload-analyst",
          messageID: Identifier.ascending("message"),
          summary: "Need workload-analysis redispatch recovery",
          details: "The workload analyst persisted its artifact but the A2A action did not complete.",
          blocking: true,
          requestedDecision: "redispatch",
          severity: "blocked",
        })
        const options = await buildPersistedToolOptions({
          sessionID: parent.id,
          label: "respond_agent_coordination_workload_recover",
        })
        const response = await createAgentCoordinationResponse({
          taskID,
          requestID: request.payload.request_id,
          orchestratorSessionID: options.opencorvus.sessionID,
          orchestratorMessageID: options.opencorvus.messageID,
          orchestratorToolCallID: options.opencorvus.toolCallID,
          orchestratorToolPartID: options.opencorvus.toolPartID,
          decision: "redispatch",
          reason,
          message: guidance,
          redispatchBinding: {
            dispatcher: "workload_analysis_stage",
            stage: "goal-workload-analyst",
            target_kind: "goal-workload-analyst",
          },
        })
        await recordAgentCoordinationActionProgress({
          taskID,
          actionID: response.payload.action_id,
          result: {
            dispatcher: "workload_analysis_stage",
            stage: "goal-workload-analyst",
            source_session_id: worker.id,
            spec_snapshot_id: specID,
            expected_goals_count: 1,
            target_kind: "goal-workload-analyst",
            redispatch_started: true,
            redispatch_started_at: Date.now(),
            preexisting_goal_workload_session_ids: [worker.id],
            preexisting_goal_workload_artifact_ids: [],
          },
          summary: "redispatch_worker workload_analysis stage dispatch started",
        })
        const redispatched = await Session.create({
          kind: "goal-workload-analyst",
          parentID: parent.id,
          title: "agent coordination workload recovered worker",
        })
        Database.use((db) =>
          db
            .insert(EngineArtifactTable)
            .values({
              id: artifactID,
              task_id: taskID,
              kind: "goal_workload",
              label: "active",
              payload: {
                spec_snapshot_id: specID,
                summary: "Recovered workload analysis with one flagged goal.",
                briefs: [
                  {
                    goal_id: goalID,
                    decomposition_concern: "Goal spans durable protocol, replay, and E2E evidence.",
                    why_not_smaller: ["A2A persistence and replay tests are separate proof surfaces."],
                    underestimation_traps: ["Do not stop at request/response persistence."],
                    execution_inventory: {
                      surfaces: 3,
                      states: 2,
                      data_contracts: 2,
                      verification_points: 4,
                    },
                    verification_inventory: ["A2A action recovery is tested."],
                    references: {
                      contract_ids: [],
                      reference_coverage_ids: [],
                      acceptance_spec_ids: [],
                      visual_spec_ids: [],
                      prd_sections: ["A2A protocol"],
                    },
                  },
                ],
              },
              time_created: Date.now(),
              time_updated: Date.now(),
            })
            .run(),
        )
        goalWorkloadAnalyzeImpl = async () => {
          workloadCalls += 1
          throw new Error("workload dispatcher must not run during pending action recovery")
        }

        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "redispatch",
              reason,
              message: guidance,
            },
            options,
          ),
        )

        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with redispatch`)
        expect(result).toContain(
          `workload_analysis session ${redispatched.id} recovered persisted workload artifact ${artifactID}`,
        )
        expect(workloadCalls).toBe(0)
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action: "redispatch_worker",
          status: "completed",
          result: {
            dispatcher: "workload_analysis_stage",
            stage: "goal-workload-analyst",
            source_session_id: worker.id,
            redispatch_session_id: redispatched.id,
            goal_workload_artifact_id: artifactID,
            spec_snapshot_id: specID,
            briefs_count: 1,
            flagged_goals_count: 1,
            expected_goals_count: 1,
            target_kind: "goal-workload-analyst",
            started: true,
            redispatch_started: true,
            preexisting_goal_workload_session_ids: [worker.id],
            preexisting_goal_workload_artifact_ids: [],
            recovered_redispatch: true,
          },
        })
      },
    })
  })

  test("respond_agent_coordination redispatch resumes a fact-check continuation artifact", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_fact_check_redispatch_${stamp}`
    const taskID = `tsk_agent_coordination_fact_check_redispatch_${stamp}`
    const goalID = `gol_agent_coordination_fact_check_redispatch_${stamp}`
    const factCheckItem = {
      claim: "OpenAI released the Responses API before this test fixture was written",
      confidence: "medium" as const,
      category: "api" as const,
      source: "worker terminal report",
    }
    let factCheckInput: any

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination fact-check redispatch",
      taskTitle: "agent coordination fact-check redispatch",
      request: "Runtime-contract fact-check worker asks for redispatch",
      goalTitle: "Coordinate fact-check redispatch",
      goalSlug: "coordinate-fact-check-redispatch",
      objective: "Resume fact-check through a concrete continuation-backed A2A binding",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination fact-check root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const target = await seedTerminalAssistantMessage({
          parentID: parent.id,
          kind: "build",
          text: "The worker claims the Responses API existed before this fixture.",
          now,
        })
        const worker = await Session.create({
          kind: "fact-check",
          parentID: parent.id,
          title: "agent coordination fact-check source worker",
        })
        installFactCheckRuntimeContract({ sessionID: worker.id, taskID })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )

        const normalizedStageInput = {
          target_session_id: target.sessionID,
          target_agent: "build",
          fact_check_items: [factCheckItem],
          reason: "The original fact-check run missed its terminal report and must continue.",
          target_message_id: target.messageID,
          target_message_content_hash: target.contentHash,
        }
        const continuation = createStageContinuationRequest({
          taskID,
          stage: "fact-check",
          sessionID: worker.id,
          parentSessionID: parent.id,
          normalizedStageInput,
          inputDigest: testStageInputDigest(normalizedStageInput),
          failureName: "TerminalToolMissingError",
          failureMessage: "Fact-check ended without report_fact_check_result.",
          finalizerName: "report_fact_check_result",
          reason: "Continue fact-check in the same child session.",
          now,
        })

        factCheckAgentRunImpl = async (input: any) => {
          factCheckInput = input
          expect(input.continuation).toMatchObject({
            sessionID: worker.id,
            artifactID: continuation.artifactID,
            finalizerName: "report_fact_check_result",
          })
          return {
            sessionID: worker.id,
            report: {
              scope: {
                target_session_id: input.targetSessionID,
                target_agent: input.targetAgent,
                target_message_id: input.targetMessageID,
                target_message_content_hash: input.targetMessageContentHash,
                items_total: input.factCheckItems.length,
                items_inspected: input.factCheckItems.length,
              },
              verified: [
                {
                  claim: factCheckItem.claim,
                  evidence: [{ kind: "web", pointer: "https://example.com/fact", excerpt: "verified" }],
                },
              ],
              corrected: [],
              unresolved: [],
              overall_verdict: "clean",
            },
            outcome: "completed",
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "fact-check",
          messageID: Identifier.ascending("message"),
          summary: "Need fact-check continuation redispatch",
          details: "The fact-check worker has a terminal finalizer miss and needs same-session continuation.",
          blocking: true,
          requestedDecision: "redispatch",
          severity: "blocked",
        })
        const options = await buildPersistedToolOptions({
          sessionID: parent.id,
          label: "respond_agent_coordination_fact_check_redispatch",
        })
        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "redispatch",
              reason: "Resume the pending fact-check continuation from its durable stage artifact.",
              message: "Do not infer scope from free text; use the continuation artifact.",
            },
            options,
          ),
        )

        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with redispatch`)
        expect(result).toContain(`fact_check session ${worker.id} resumed continuation ${continuation.artifactID}`)
        expect(factCheckInput.targetSessionID).toBe(target.sessionID)
        expect(factCheckInput.targetMessageID).toBe(target.messageID)
        expect(factCheckInput.targetMessageContentHash).toBe(target.contentHash)
        expect(factCheckInput.factCheckItems).toEqual([factCheckItem])
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )

        const factCheckAttempts = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "fact_check_attempt")))
            .all(),
        )
        expect(factCheckAttempts).toHaveLength(1)
        expect((factCheckAttempts[0]?.payload as any)?.fact_check_session_id).toBe(worker.id)
        expect((factCheckAttempts[0]?.payload as any)?.target_message_id).toBe(target.messageID)
        expect((factCheckAttempts[0]?.payload as any)?.outcome).toBe("completed")

        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action: "redispatch_worker",
          status: "completed",
          result: {
            redispatch_binding: {
              dispatcher: "fact_check_stage",
              stage: "fact-check",
              target_kind: "fact-check",
            },
            dispatcher: "fact_check_stage",
            stage: "fact-check",
            source_session_id: worker.id,
            redispatch_session_id: worker.id,
            continuation_artifact_id: continuation.artifactID,
            fact_check_attempt_id: factCheckAttempts[0]?.id,
            target_session_id: target.sessionID,
            target_agent: "build",
            target_message_id: target.messageID,
            target_message_content_hash: target.contentHash,
            verdict: "clean",
            outcome: "completed",
            items_total: 1,
            items_inspected: 1,
            verified_count: 1,
            corrected_count: 0,
            unresolved_count: 0,
            same_session_continuation: true,
            target_kind: "fact-check",
            started: true,
            redispatch_started: true,
            preexisting_fact_check_attempt_ids: [],
            recovered_redispatch: false,
          },
        })
        const replayResult = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "redispatch",
              reason: "Resume the pending fact-check continuation from its durable stage artifact.",
              message: "Do not infer scope from free text; use the continuation artifact.",
            },
            options,
          ),
        )
        expect(replayResult).toContain(`Replayed coordination response ${actions[0]?.payload.response_id}`)
        expect(replayResult).toContain(`action=${actions[0]?.payload.action_id} already completed as redispatch_worker`)
      },
    })
  })

  test("respond_agent_coordination redispatch recovers a pending fact-check action after attempt persistence", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_fact_check_recover_${stamp}`
    const taskID = `tsk_agent_coordination_fact_check_recover_${stamp}`
    const goalID = `gol_agent_coordination_fact_check_recover_${stamp}`
    const reason = "Recover fact-check redispatch after durable attempt persistence."
    const guidance = "Do not call fact_check again; bind the persisted fact_check_attempt artifact."
    const factCheckItem = {
      claim: "The recovered fact-check attempt is bound to the original continuation scope",
      confidence: "high" as const,
      category: "protocol" as const,
      source: "worker terminal report",
    }
    let factCheckCalls = 0

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination fact-check recovery",
      taskTitle: "agent coordination fact-check recovery",
      request: "Runtime-contract fact-check worker asks for redispatch and host restarts after attempt persistence",
      goalTitle: "Recover fact-check redispatch",
      goalSlug: "recover-fact-check-redispatch",
      objective: "Recover fact-check redispatch through durable continuation-bound attempt evidence",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination fact-check recovery root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const target = await seedTerminalAssistantMessage({
          parentID: parent.id,
          kind: "build",
          text: "The recovered fact-check target message is immutable.",
          now,
        })
        const worker = await Session.create({
          kind: "fact-check",
          parentID: parent.id,
          title: "agent coordination fact-check source worker for recovery",
        })
        installFactCheckRuntimeContract({ sessionID: worker.id, taskID })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )

        const normalizedStageInput = {
          target_session_id: target.sessionID,
          target_agent: "build",
          fact_check_items: [factCheckItem],
          reason: "The fact-check finalizer missed its terminal report and must recover from durable scope.",
          target_message_id: target.messageID,
          target_message_content_hash: target.contentHash,
        }
        const continuation = createStageContinuationRequest({
          taskID,
          stage: "fact-check",
          sessionID: worker.id,
          parentSessionID: parent.id,
          normalizedStageInput,
          inputDigest: testStageInputDigest(normalizedStageInput),
          failureName: "TerminalToolMissingError",
          failureMessage: "Fact-check ended without report_fact_check_result.",
          finalizerName: "report_fact_check_result",
          reason: "Continue fact-check in the same child session.",
          now,
        })

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "fact-check",
          messageID: Identifier.ascending("message"),
          summary: "Need fact-check redispatch recovery",
          details: "The fact-check worker persisted its attempt but the A2A action did not complete.",
          blocking: true,
          requestedDecision: "redispatch",
          severity: "blocked",
        })
        const options = await buildPersistedToolOptions({
          sessionID: parent.id,
          label: "respond_agent_coordination_fact_check_recover",
        })
        const response = await createAgentCoordinationResponse({
          taskID,
          requestID: request.payload.request_id,
          orchestratorSessionID: options.opencorvus.sessionID,
          orchestratorMessageID: options.opencorvus.messageID,
          orchestratorToolCallID: options.opencorvus.toolCallID,
          orchestratorToolPartID: options.opencorvus.toolPartID,
          decision: "redispatch",
          reason,
          message: guidance,
          redispatchBinding: {
            dispatcher: "fact_check_stage",
            stage: "fact-check",
            target_kind: "fact-check",
          },
        })
        await recordAgentCoordinationActionProgress({
          taskID,
          actionID: response.payload.action_id,
          result: {
            dispatcher: "fact_check_stage",
            stage: "fact-check",
            source_session_id: worker.id,
            continuation_artifact_id: continuation.artifactID,
            target_session_id: normalizedStageInput.target_session_id,
            target_agent: normalizedStageInput.target_agent,
            target_message_id: normalizedStageInput.target_message_id,
            target_message_content_hash: normalizedStageInput.target_message_content_hash,
            target_kind: "fact-check",
            redispatch_started: true,
            redispatch_started_at: Date.now(),
            preexisting_fact_check_attempt_ids: [],
          },
          summary: "redispatch_worker fact_check stage dispatch started",
        })
        const claim = claimStageContinuationRequest({
          taskID,
          artifactID: continuation.artifactID,
          sessionID: worker.id,
          finalizerName: "report_fact_check_result",
          now: now + 1,
        })
        markStageContinuationConsumed({
          taskID,
          artifactID: continuation.artifactID,
          claimID: claim.claimID,
          messageID: claim.messageID,
          now: now + 2,
        })
        const factCheckAttemptID = recordFactCheckAttempt({
          taskID,
          factCheckSessionID: worker.id,
          targetSessionID: target.sessionID,
          targetAgent: "build",
          targetMessageID: target.messageID,
          targetMessageContentHash: target.contentHash,
          invokedByOrchestratorSessionID: parent.id,
          report: {
            scope: {
              target_session_id: target.sessionID,
              target_agent: "build",
              target_message_id: target.messageID,
              target_message_content_hash: target.contentHash,
              items_total: 1,
              items_inspected: 1,
            },
            verified: [
              {
                claim: factCheckItem.claim,
                evidence: [{ kind: "code", pointer: continuation.artifactID, excerpt: "scope matched" }],
              },
            ],
            corrected: [],
            unresolved: [],
            overall_verdict: "clean",
          },
          timeStarted: now + 3,
          timeCompleted: now + 4,
          outcome: "completed",
          now: Date.now(),
        })
        factCheckAgentRunImpl = async () => {
          factCheckCalls += 1
          throw new Error("fact_check dispatcher must not run during pending action recovery")
        }

        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "redispatch",
              reason,
              message: guidance,
            },
            options,
          ),
        )

        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with redispatch`)
        expect(result).toContain(
          `fact_check session ${worker.id} recovered persisted fact_check_attempt ${factCheckAttemptID}`,
        )
        expect(factCheckCalls).toBe(0)
        expect(findStageContinuationRequest({ taskID, artifactID: continuation.artifactID })?.payload.consumed_at).toBe(
          now + 2,
        )
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action: "redispatch_worker",
          status: "completed",
          result: {
            redispatch_binding: {
              dispatcher: "fact_check_stage",
              stage: "fact-check",
              target_kind: "fact-check",
            },
            dispatcher: "fact_check_stage",
            stage: "fact-check",
            source_session_id: worker.id,
            redispatch_session_id: worker.id,
            continuation_artifact_id: continuation.artifactID,
            fact_check_attempt_id: factCheckAttemptID,
            target_session_id: target.sessionID,
            target_agent: "build",
            target_message_id: target.messageID,
            target_message_content_hash: target.contentHash,
            verdict: "clean",
            outcome: "completed",
            items_total: 1,
            items_inspected: 1,
            verified_count: 1,
            corrected_count: 0,
            unresolved_count: 0,
            same_session_continuation: true,
            target_kind: "fact-check",
            started: true,
            redispatch_started: true,
            preexisting_fact_check_attempt_ids: [],
            recovered_redispatch: true,
          },
        })
      },
    })
  })

  test("respond_agent_coordination keeps fact-check redispatch pending without a continuation artifact", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_refuse_${stamp}`
    const taskID = `tsk_agent_coordination_refuse_${stamp}`
    const goalID = `gol_agent_coordination_refuse_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination refused decisions",
      taskTitle: "agent coordination refused decisions",
      request: "Runtime-contract worker asks for redispatch",
      goalTitle: "Coordinate refusal",
      goalSlug: "coordinate-refusal",
      objective: "Keep unsupported A2A redispatch decisions pending until a concrete action binding exists",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination refusal root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "fact-check",
          parentID: parent.id,
          title: "agent coordination unsupported runtime worker",
        })
        installFactCheckRuntimeContract({ sessionID: worker.id, taskID })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "fact-check",
          messageID: Identifier.ascending("message"),
          summary: "Need redispatch",
          details: "The worker is blocked and asks the orchestrator for a scheduler action.",
          blocking: true,
          requestedDecision: "redispatch",
          severity: "blocked",
        })
        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "redispatch",
              reason: "Exercise refused redispatch",
            },
            await buildPersistedToolOptions({
              sessionID: parent.id,
              label: "respond_agent_coordination_redispatch_refused",
            }),
          ),
        )
        expect(result).toContain("refused redispatch")
        expect(result).toContain("requires a pending fact-check stage_continuation_request")
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "pending",
        )

        const responseRows = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(
              and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "agent_coordination_response")),
            )
            .all(),
        )
        expect(responseRows).toHaveLength(0)
        expect(listAgentCoordinationActions(taskID)).toHaveLength(0)
      },
    })
  })

  test("respond_agent_coordination ask_user links a real question interaction to the action", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_ask_${stamp}`
    const taskID = `tsk_agent_coordination_ask_${stamp}`
    const goalID = `gol_agent_coordination_ask_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination ask user",
      taskTitle: "agent coordination ask user",
      request: "Worker asks the orchestrator to ask the user",
      goalTitle: "Coordinate user question",
      goalSlug: "coordinate-user-question",
      objective: "Ask the user through a durable A2A action",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        EngineInteraction.subscribe(hooks())
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination ask root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "assistant",
          parentID: parent.id,
          title: "agent coordination ask worker",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "coding",
          messageID: Identifier.ascending("message"),
          summary: "Need operator choice",
          details: "The worker has two valid approaches and needs a user decision.",
          blocking: true,
          requestedDecision: "ask_user",
          severity: "blocked",
        })

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const toolPromise = tools.respond_agent_coordination.execute(
          {
            request_id: request.payload.request_id,
            decision: "ask_user",
            questions: [
              {
                header: "Approach",
                question: "Which implementation approach should the worker use?",
                options: [
                  { label: "Minimal", description: "Use the smaller scoped change." },
                  { label: "Deep", description: "Use the broader root-cause change." },
                ],
              },
            ],
            reason: "The worker needs an operator decision before proceeding.",
          },
          await buildPersistedToolOptions({
            sessionID: parent.id,
            label: "respond_agent_coordination_ask_user",
          }),
        )

        let pendingQuestion: Awaited<ReturnType<typeof Question.list>>[number] | undefined
        let observedQuestions = 0
        let inactiveSince = Date.now()
        while (!pendingQuestion && Date.now() - inactiveSince < 2_500) {
          const currentQuestions = await Question.list()
          if (currentQuestions.length > observedQuestions) {
            observedQuestions = currentQuestions.length
            inactiveSince = Date.now()
          }
          pendingQuestion = currentQuestions.find((question) => question.sessionID === parent.id)
          if (!pendingQuestion) await Bun.sleep(25)
        }
        expect(pendingQuestion).toBeDefined()

        let progressAction: ReturnType<typeof listAgentCoordinationActions>[number] | undefined
        let observedProgress = ""
        inactiveSince = Date.now()
        while (!progressAction && Date.now() - inactiveSince < 2_500) {
          const action = listAgentCoordinationActions(taskID)[0]
          const serialized = JSON.stringify(action?.payload.result ?? {})
          if (serialized !== observedProgress) {
            observedProgress = serialized
            inactiveSince = Date.now()
          }
          if (
            action?.payload.status === "pending" &&
            action.payload.result?.question_id === pendingQuestion!.id &&
            typeof action.payload.result?.interaction_id === "string"
          ) {
            progressAction = action
            break
          }
          await Bun.sleep(25)
        }
        expect(progressAction?.payload).toMatchObject({
          request_id: request.payload.request_id,
          action: "ask_user",
          status: "pending",
          result: {
            question_id: pendingQuestion!.id,
            interaction_status: "pending",
          },
        })
        await Question.reply({ requestID: pendingQuestion!.id, answers: [["Deep"]] })

        const result = toolText(await toolPromise)
        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with ask_user`)
        expect(result).toContain("User answered")
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        const interaction = Database.use((db) =>
          db
            .select()
            .from(EngineInteractionRequestTable)
            .where(eq(EngineInteractionRequestTable.external_id, pendingQuestion!.id))
            .get(),
        )
        expect(interaction?.status).toBe("answered")
        expect(interaction?.task_id).toBe(taskID)
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          request_id: request.payload.request_id,
          action: "ask_user",
          status: "completed",
          target_session_id: worker.id,
          result: {
            question_id: pendingQuestion!.id,
            interaction_id: interaction?.id,
            interaction_status: "answered",
            answers: [["Deep"]],
          },
        })
      },
    })
  })

  test("respond_agent_coordination ask_user recovers a pending durable interaction without duplicating the question", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_ask_recover_${stamp}`
    const taskID = `tsk_agent_coordination_ask_recover_${stamp}`
    const goalID = `gol_agent_coordination_ask_recover_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination ask recovery",
      taskTitle: "agent coordination ask recovery",
      request: "Worker asks the orchestrator to ask the user and the host restarts after the interaction is durable",
      goalTitle: "Recover user question",
      goalSlug: "recover-user-question",
      objective: "Recover a claimed A2A ask_user action without creating a duplicate question",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        EngineInteraction.subscribe(hooks())
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination ask recovery root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "assistant",
          parentID: parent.id,
          title: "agent coordination ask recovery worker",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "coding",
          messageID: Identifier.ascending("message"),
          summary: "Need recovered operator choice",
          details: "The question interaction is already durable but the A2A action was not completed.",
          blocking: true,
          requestedDecision: "ask_user",
          severity: "blocked",
        })
        const toolOptions = await buildPersistedToolOptions({
          sessionID: parent.id,
          label: "respond_agent_coordination_ask_recover",
        })
        const questions = [
          {
            header: "Approach",
            question: "Which recovered implementation approach should the worker use?",
            options: [
              { label: "Minimal", description: "Use the smaller scoped change." },
              { label: "Deep", description: "Use the broader root-cause change." },
            ],
          },
        ]
        const reason = "The durable question exists and the action must recover it."
        const response = await createAgentCoordinationResponse({
          taskID,
          requestID: request.payload.request_id,
          orchestratorSessionID: parent.id,
          orchestratorMessageID: toolOptions.opencorvus.messageID,
          orchestratorToolCallID: toolOptions.opencorvus.toolCallID,
          orchestratorToolPartID: toolOptions.opencorvus.toolPartID,
          decision: "ask_user",
          reason,
        })
        const pendingAction = findAgentCoordinationAction({ taskID, actionID: response.payload.action_id })
        expect(pendingAction?.payload.status).toBe("pending")
        expect(pendingAction?.payload.result).toBeUndefined()

        const questionID = `que_agent_coordination_${response.payload.action_id}`
        const interactionID = Identifier.ascending("interaction")
        Database.use((db) =>
          db
            .insert(EngineInteractionRequestTable)
            .values({
              id: interactionID,
              task_id: taskID,
              run_id: null,
              session_id: parent.id,
              external_id: questionID,
              request_type: "question",
              status: "pending",
              title: "Approach",
              body: questions[0]!.question,
              payload: {
                questions,
                tool: {
                  messageID: toolOptions.opencorvus.messageID,
                  callID: toolOptions.opencorvus.toolCallID,
                },
              },
              time_created: now + 1,
              time_updated: now + 1,
            })
            .run(),
        )

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const toolPromise = tools.respond_agent_coordination.execute(
          {
            request_id: request.payload.request_id,
            decision: "ask_user",
            questions,
            reason,
          },
          toolOptions,
        )

        let progressAction: ReturnType<typeof listAgentCoordinationActions>[number] | undefined
        let inactiveSince = Date.now()
        while (!progressAction && Date.now() - inactiveSince < 2_500) {
          const action = listAgentCoordinationActions(taskID)[0]
          if (
            action?.payload.status === "pending" &&
            action.payload.result?.question_id === questionID &&
            action.payload.result?.interaction_id === interactionID
          ) {
            progressAction = action
            break
          }
          await Bun.sleep(25)
        }
        expect(progressAction?.payload).toMatchObject({
          request_id: request.payload.request_id,
          action: "ask_user",
          status: "pending",
          result: {
            question_id: questionID,
            interaction_id: interactionID,
            interaction_status: "pending",
          },
        })
        const pendingQuestions = await Question.list()
        expect(pendingQuestions.filter((question) => question.id === questionID)).toHaveLength(1)
        const interactionRows = Database.use((db) =>
          db
            .select()
            .from(EngineInteractionRequestTable)
            .where(eq(EngineInteractionRequestTable.external_id, questionID))
            .all(),
        )
        expect(interactionRows).toHaveLength(1)

        await Question.reply({ requestID: questionID, answers: [["Deep"]] })
        const result = toolText(await toolPromise)
        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with ask_user`)
        expect(result).toContain("User answered")
        const finalInteraction = Database.use((db) =>
          db
            .select()
            .from(EngineInteractionRequestTable)
            .where(eq(EngineInteractionRequestTable.id, interactionID))
            .get(),
        )
        expect(finalInteraction?.status).toBe("answered")
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action_id: response.payload.action_id,
          action: "ask_user",
          status: "completed",
          result: {
            question_id: questionID,
            interaction_id: interactionID,
            interaction_status: "answered",
            answers: [["Deep"]],
          },
        })
      },
    })
  })

  test("respond_agent_coordination fail_task links the terminal task failure to the action", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_fail_${stamp}`
    const taskID = `tsk_agent_coordination_fail_${stamp}`
    const goalID = `gol_agent_coordination_fail_${stamp}`
    const interruptTaskLoop = spyOn(TaskLoop, "interruptTaskLoop")

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination fail",
      taskTitle: "agent coordination fail",
      request: "Worker asks the orchestrator to fail the task",
      goalTitle: "Coordinate task failure",
      goalSlug: "coordinate-task-failure",
      objective: "Fail the task through a durable A2A action",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination fail root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "assistant",
          parentID: parent.id,
          title: "agent coordination fail worker",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "coding",
          messageID: Identifier.ascending("message"),
          summary: "Fail the task",
          details: "The worker proved there is no responsible same-task repair.",
          blocking: true,
          requestedDecision: "fail_task",
          severity: "failure",
        })

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const toolOptions = await buildPersistedToolOptions({
          sessionID: parent.id,
          label: "respond_agent_coordination_fail_task",
        })

        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "fail_task",
              message: "Persistent external blocker from worker evidence.",
              reason: "No responsible same-task repair remains.",
            },
            toolOptions,
          ),
        )

        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with fail_task`)
        expect(deriveTaskStatus(findTask(taskID)!)).toBe("failed")
        expect(findTask(taskID)?.error).toContain(`A2A request ${request.payload.request_id}`)
        expect(interruptTaskLoop).toHaveBeenCalledWith(taskID, "task failed")
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          request_id: request.payload.request_id,
          action: "fail_task",
          status: "completed",
          target_session_id: worker.id,
          result: {
            task_id: taskID,
            task_status: "failed",
          },
        })
        const replay = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "fail_task",
              message: "Persistent external blocker from worker evidence.",
              reason: "No responsible same-task repair remains.",
            },
            toolOptions,
          ),
        )
        expect(replay).toContain("already completed as fail_task")
        expect(interruptTaskLoop).toHaveBeenCalledTimes(1)
        expect(listAgentCoordinationActions(taskID)).toHaveLength(1)
      },
    })
  })

  test("respond_agent_coordination fail_task recovers a pending action after terminal failure is durable", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_fail_recover_${stamp}`
    const taskID = `tsk_agent_coordination_fail_recover_${stamp}`
    const goalID = `gol_agent_coordination_fail_recover_${stamp}`
    const interruptTaskLoop = spyOn(TaskLoop, "interruptTaskLoop")

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination fail recovery",
      taskTitle: "agent coordination fail recovery",
      request: "Worker asks the orchestrator to fail the task and the host restarts after task failure is durable",
      goalTitle: "Recover task failure",
      goalSlug: "recover-task-failure",
      objective: "Recover a claimed A2A fail_task action without writing a second terminal task transition",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination fail recovery root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "assistant",
          parentID: parent.id,
          title: "agent coordination fail recovery worker",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "coding",
          messageID: Identifier.ascending("message"),
          summary: "Need recovered task failure",
          details: "The task failure row is already durable but the A2A action was not completed.",
          blocking: true,
          requestedDecision: "fail_task",
          severity: "failure",
        })
        const toolOptions = await buildPersistedToolOptions({
          sessionID: parent.id,
          label: "respond_agent_coordination_fail_recover",
        })
        const message = "Persistent external blocker from worker evidence."
        const reason = "No responsible same-task repair remains."
        const response = await createAgentCoordinationResponse({
          taskID,
          requestID: request.payload.request_id,
          orchestratorSessionID: parent.id,
          orchestratorMessageID: toolOptions.opencorvus.messageID,
          orchestratorToolCallID: toolOptions.opencorvus.toolCallID,
          orchestratorToolPartID: toolOptions.opencorvus.toolPartID,
          decision: "fail_task",
          reason,
          message,
        })
        const pendingAction = findAgentCoordinationAction({ taskID, actionID: response.payload.action_id })
        expect(pendingAction?.payload.status).toBe("pending")
        expect(pendingAction?.payload.result).toBeUndefined()

        const error = `A2A request ${request.payload.request_id}: ${message}`
        await terminalTask(findTask(taskID)!, { status: "failed", error, time_completed: now + 1 }, `Failed: ${error}`)
        expect(deriveTaskStatus(findTask(taskID)!)).toBe("failed")
        expect(findTask(taskID)?.error).toBe(error)

        const taskFailedEventCount = () =>
          Database.use((db) =>
            db
              .select({ id: ProtocolEventTable.id })
              .from(ProtocolEventTable)
              .where(and(eq(ProtocolEventTable.task_id, taskID), eq(ProtocolEventTable.type, "task.failed")))
              .all(),
          ).length
        let failedEventCountBeforeReplay = taskFailedEventCount()
        let inactiveSince = Date.now()
        while (failedEventCountBeforeReplay === 0 && Date.now() - inactiveSince < 2_500) {
          await Bun.sleep(25)
          failedEventCountBeforeReplay = taskFailedEventCount()
        }
        expect(failedEventCountBeforeReplay).toBe(1)

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "fail_task",
              message,
              reason,
            },
            toolOptions,
          ),
        )

        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with fail_task`)
        expect(result).toContain("Recovered existing terminal task failure")
        expect(deriveTaskStatus(findTask(taskID)!)).toBe("failed")
        expect(findTask(taskID)?.error).toBe(error)
        expect(taskFailedEventCount()).toBe(failedEventCountBeforeReplay)
        expect(interruptTaskLoop).toHaveBeenCalledWith(taskID, "task failed")
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action_id: response.payload.action_id,
          request_id: request.payload.request_id,
          action: "fail_task",
          status: "completed",
          target_session_id: worker.id,
          result: {
            task_id: taskID,
            task_status: "failed",
            recovered_terminal_failure: true,
          },
        })
      },
    })
  })

  test("respond_agent_coordination cancel_worker completes the bound action", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_cancel_${stamp}`
    const taskID = `tsk_agent_coordination_cancel_${stamp}`
    const goalID = `gol_agent_coordination_cancel_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination cancel",
      taskTitle: "agent coordination cancel",
      request: "Worker asks the orchestrator to cancel its current session",
      goalTitle: "Coordinate cancellation",
      goalSlug: "coordinate-cancellation",
      objective: "Cancel the worker through a durable A2A action",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination cancel root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "assistant",
          parentID: parent.id,
          title: "agent coordination cancel worker",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "coding",
          messageID: Identifier.ascending("message"),
          summary: "Cancel this worker",
          details: "The worker found its path is invalid and asks the orchestrator to stop it.",
          blocking: true,
          requestedDecision: "cancel this worker session",
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
              decision: "cancel_worker",
              reason: "The worker identified an invalid path and should stop before redispatch.",
            },
            await buildPersistedToolOptions({
              sessionID: parent.id,
              label: "respond_agent_coordination_cancel_worker",
            }),
          ),
        )

        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with cancel_worker`)
        const cancelStatusEvent = await waitForSessionStatusEvent({
          taskID,
          sessionID: worker.id,
          reason: "aborted",
        })
        expect(SessionStatus.get(worker.id)).toMatchObject({ type: "terminal", reason: "aborted" })
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          request_id: request.payload.request_id,
          action: "cancel_worker",
          status: "completed",
          target_session_id: worker.id,
          result: {
            session_id: worker.id,
            kind: "assistant",
            cancel_status_event_id: cancelStatusEvent.id,
            cancel_status: { type: "terminal", reason: "aborted" },
            recovered_cancel_status: false,
          },
        })
        const responseRows = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(
              and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "agent_coordination_response")),
            )
            .all(),
        )
        expect(responseRows).toHaveLength(1)
        expect(actions[0]?.payload.response_id).toBe(responseRows[0]?.id)
      },
    })
  })

  test("respond_agent_coordination cancel_worker preserves completed stale worker status", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_stale_cancel_${stamp}`
    const taskID = `tsk_agent_coordination_stale_cancel_${stamp}`
    const goalID = `gol_agent_coordination_stale_cancel_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination stale cancel",
      taskTitle: "agent coordination stale cancel",
      request: "Worker asked for a decision but completed before the orchestrator responded",
      goalTitle: "Preserve stale terminal worker",
      goalSlug: "preserve-stale-terminal-worker",
      objective: "Close a stale A2A request without rewriting a completed worker status",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination stale cancel root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "assistant",
          parentID: parent.id,
          title: "agent coordination stale cancel worker",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "coding",
          messageID: Identifier.ascending("message"),
          summary: "Cancel this worker if it is still live",
          details: "The worker asked for cancellation, but it completed before the orchestrator answered.",
          blocking: true,
          requestedDecision: "cancel this worker session",
          severity: "blocked",
        })
        ensureTaskMessageProtocolBridge()
        await Bus.publish(SessionStatus.Event.Status, {
          sessionID: worker.id,
          orderKey: sessionLifecycleOrderKey(worker.id),
          status: { type: "terminal", reason: "completed" },
        })
        const completedStatusEvent = await waitForSessionStatusEvent({
          taskID,
          sessionID: worker.id,
          reason: "completed",
        })
        expect(SessionStatus.get(worker.id)).toEqual({ type: "idle" })

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "cancel_worker",
              reason: "The worker is already terminal_ok; close the stale request.",
            },
            await buildPersistedToolOptions({
              sessionID: parent.id,
              label: "respond_agent_coordination_stale_cancel",
            }),
          ),
        )

        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with cancel_worker`)
        expect(result).toContain(`Preserved existing worker terminal status ${completedStatusEvent.id} (completed)`)
        expect(SessionStatus.get(worker.id)).toEqual({ type: "idle" })
        const statusRows = Database.use((db) =>
          db
            .select({ payload: ProtocolEventTable.payload })
            .from(ProtocolEventTable)
            .where(
              and(
                eq(ProtocolEventTable.task_id, taskID),
                eq(ProtocolEventTable.session_id, worker.id),
                eq(ProtocolEventTable.type, "session.status"),
              ),
            )
            .orderBy(sql`${ProtocolEventTable.emitted_at} ASC`, sql`${ProtocolEventTable.seq} ASC`)
            .all(),
        )
        const terminalReasons = statusRows.map((row) => {
          const status =
            row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
              ? (row.payload as Record<string, unknown>).status
              : undefined
          return status && typeof status === "object" && !Array.isArray(status)
            ? (status as Record<string, unknown>).reason
            : undefined
        })
        expect(terminalReasons).toEqual(["completed"])
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          request_id: request.payload.request_id,
          action: "cancel_worker",
          status: "completed",
          target_session_id: worker.id,
          result: {
            session_id: worker.id,
            kind: "assistant",
            terminal_status_event_id: completedStatusEvent.id,
            terminal_status: { type: "terminal", reason: "completed" },
            stale_terminal_worker: true,
          },
        })
        expect((actions[0]?.payload.result as Record<string, unknown> | undefined)?.cancel_status).toBeUndefined()
      },
    })
  })

  test("respond_agent_coordination cancel_worker closes stale live-ownership request after ownership completed", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_ownership_stale_${stamp}`
    const taskID = `tsk_agent_coordination_ownership_stale_${stamp}`
    const goalID = `gol_agent_coordination_ownership_stale_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination ownership stale",
      taskTitle: "agent coordination ownership stale",
      request: "Detached worker asks for cancellation and finishes before the orchestrator responds",
      goalTitle: "Close stale detached ownership",
      goalSlug: "close-stale-detached-ownership",
      objective: "Close a stale A2A request that was authorized by live ownership at request time",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination ownership stale root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "build",
          title: "agent coordination detached build worker",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const ownershipPayload = createOrchestratorToolOwnershipPayload({
          taskID,
          orchestratorSessionID: parent.id,
          orchestratorMessageID: "msg_ownership_stale_orchestrator",
          toolCallID: "cal_ownership_stale_build",
          toolPartID: "prt_ownership_stale_build",
          childSessionID: worker.id,
          toolName: "build",
          scope: "task",
          now,
        })
        insertOrchestratorToolOwnershipArtifact({
          taskID,
          label: "tool-ownership-start",
          payload: ownershipPayload,
          now,
        })
        const requestMessageID = Identifier.ascending("message")
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "build",
          messageID: requestMessageID,
          summary: "Cancel detached worker if still live",
          details: "The request is authorized by live tool ownership, but the worker finishes before response.",
          blocking: true,
          requestedDecision: "cancel_worker",
          severity: "blocked",
        })
        expect(request.payload).toMatchObject({
          session_ownership_source: "live_tool_ownership",
          tool_ownership_id: ownershipPayload.ownership_id,
        })
        completeOrchestratorToolOwnership({
          taskID,
          ownershipID: ownershipPayload.ownership_id,
          outcome: "completed",
          now: now + 1,
        })
        const replay = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "build",
          messageID: requestMessageID,
          summary: "Cancel detached worker if still live",
          details: "The request is authorized by live tool ownership, but the worker finishes before response.",
          blocking: true,
          requestedDecision: "cancel_worker",
          severity: "blocked",
        })
        expect(replay.artifactID).toBe(request.artifactID)
        expect(replay.createdNow).toBe(false)
        const statusRowsBefore = Database.use((db) =>
          db
            .select({ payload: ProtocolEventTable.payload })
            .from(ProtocolEventTable)
            .where(
              and(
                eq(ProtocolEventTable.task_id, taskID),
                eq(ProtocolEventTable.session_id, worker.id),
                eq(ProtocolEventTable.type, "session.status"),
              ),
            )
            .all(),
        )
        expect(statusRowsBefore).toHaveLength(0)

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "cancel_worker",
              reason: "The detached worker already completed; close the stale request.",
            },
            await buildPersistedToolOptions({
              sessionID: parent.id,
              label: "respond_agent_coordination_ownership_stale",
            }),
          ),
        )

        expect(result).toContain(`Preserved terminal tool ownership ${ownershipPayload.ownership_id} (completed)`)
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        const statusRowsAfter = Database.use((db) =>
          db
            .select({ payload: ProtocolEventTable.payload })
            .from(ProtocolEventTable)
            .where(
              and(
                eq(ProtocolEventTable.task_id, taskID),
                eq(ProtocolEventTable.session_id, worker.id),
                eq(ProtocolEventTable.type, "session.status"),
              ),
            )
            .all(),
        )
        expect(statusRowsAfter).toHaveLength(0)
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          request_id: request.payload.request_id,
          action: "cancel_worker",
          status: "completed",
          target_session_id: worker.id,
          result: {
            session_id: worker.id,
            kind: "build",
            terminal_ownership_id: ownershipPayload.ownership_id,
            terminal_ownership_outcome: "completed",
            stale_terminal_ownership: true,
          },
        })
        expect((actions[0]?.payload.result as Record<string, unknown> | undefined)?.cancel_status).toBeUndefined()
        expect((actions[0]?.payload.result as Record<string, unknown> | undefined)?.terminal_status).toBeUndefined()
      },
    })
  })

  test("respond_agent_coordination cancel_worker recovers a pending action after terminal status is durable", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_cancel_recover_${stamp}`
    const taskID = `tsk_agent_coordination_cancel_recover_${stamp}`
    const goalID = `gol_agent_coordination_cancel_recover_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination cancel recovery",
      taskTitle: "agent coordination cancel recovery",
      request: "Worker asks the orchestrator to cancel and the host restarts after the terminal status is durable",
      goalTitle: "Recover cancellation",
      goalSlug: "recover-cancellation",
      objective: "Recover a claimed A2A cancel_worker action without repeating prompt cancellation",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination cancel recovery root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "assistant",
          parentID: parent.id,
          title: "agent coordination cancel recovery worker",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "coding",
          messageID: Identifier.ascending("message"),
          summary: "Cancel this worker after restart",
          details: "The worker terminal status is already durable but the A2A action was not completed.",
          blocking: true,
          requestedDecision: "cancel this worker session",
          severity: "blocked",
        })
        const toolOptions = await buildPersistedToolOptions({
          sessionID: parent.id,
          label: "respond_agent_coordination_cancel_recover",
        })
        const reason = "The worker was already cancelled before the host stopped."
        const response = await createAgentCoordinationResponse({
          taskID,
          requestID: request.payload.request_id,
          orchestratorSessionID: parent.id,
          orchestratorMessageID: toolOptions.opencorvus.messageID,
          orchestratorToolCallID: toolOptions.opencorvus.toolCallID,
          orchestratorToolPartID: toolOptions.opencorvus.toolPartID,
          decision: "cancel_worker",
          reason,
        })
        const pendingAction = findAgentCoordinationAction({ taskID, actionID: response.payload.action_id })
        expect(pendingAction?.payload.status).toBe("pending")
        expect(pendingAction?.payload.result).toBeUndefined()

        ensureTaskMessageProtocolBridge()
        SessionStatus.set(worker.id, {
          type: "terminal",
          reason: "aborted",
          error: `respond_agent_coordination: ${reason}`,
        })
        const statusEvent = await waitForSessionStatusEvent({
          taskID,
          sessionID: worker.id,
          reason: "aborted",
          afterMs: response.timeCreated,
        })
        const promptCancel = spyOn(SessionPrompt, "cancel")

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "cancel_worker",
              reason,
            },
            toolOptions,
          ),
        )

        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with cancel_worker`)
        expect(result).toContain(`Recovered existing worker cancellation status ${statusEvent.id}`)
        expect(promptCancel).not.toHaveBeenCalled()
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action_id: response.payload.action_id,
          request_id: request.payload.request_id,
          action: "cancel_worker",
          status: "completed",
          target_session_id: worker.id,
          result: {
            session_id: worker.id,
            kind: "assistant",
            cancel_status_event_id: statusEvent.id,
            cancel_status: { type: "terminal", reason: "aborted" },
            recovered_cancel_status: true,
          },
        })
      },
    })
  })

  test("respond_agent_coordination cancel_worker projects a missing durable status for an already aborted worker", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_agent_coordination_cancel_project_${stamp}`
    const taskID = `tsk_agent_coordination_cancel_project_${stamp}`
    const goalID = `gol_agent_coordination_cancel_project_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "agent coordination cancel projection",
      taskTitle: "agent coordination cancel projection",
      request: "Worker cancellation reached the process latch before protocol projection",
      goalTitle: "Project cancellation",
      goalSlug: "project-cancellation",
      objective: "Project a missing durable session.status event before completing cancel_worker",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({
          kind: "root",
          title: "agent coordination cancel projection root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "assistant",
          parentID: parent.id,
          title: "agent coordination cancel projection worker",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "coding",
          messageID: Identifier.ascending("message"),
          summary: "Cancel this worker with missing projection",
          details: "The process latch is terminal but protocol_event has no status projection yet.",
          blocking: true,
          requestedDecision: "cancel this worker session",
          severity: "blocked",
        })
        const toolOptions = await buildPersistedToolOptions({
          sessionID: parent.id,
          label: "respond_agent_coordination_cancel_project",
        })
        const reason = "The worker prompt cancellation already reached the process latch."
        const response = await createAgentCoordinationResponse({
          taskID,
          requestID: request.payload.request_id,
          orchestratorSessionID: parent.id,
          orchestratorMessageID: toolOptions.opencorvus.messageID,
          orchestratorToolCallID: toolOptions.opencorvus.toolCallID,
          orchestratorToolPartID: toolOptions.opencorvus.toolPartID,
          decision: "cancel_worker",
          reason,
        })
        ensureTaskMessageProtocolBridge()
        SessionStatus.set(
          worker.id,
          {
            type: "terminal",
            reason: "aborted",
            error: `respond_agent_coordination: ${reason}`,
          },
          { publish: false },
        )
        const statusRowsBefore = Database.use((db) =>
          db
            .select({ id: ProtocolEventTable.id })
            .from(ProtocolEventTable)
            .where(
              and(
                eq(ProtocolEventTable.task_id, taskID),
                eq(ProtocolEventTable.session_id, worker.id),
                eq(ProtocolEventTable.type, "session.status"),
              ),
            )
            .all(),
        )
        expect(statusRowsBefore).toHaveLength(0)

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const result = toolText(
          await tools.respond_agent_coordination.execute(
            {
              request_id: request.payload.request_id,
              decision: "cancel_worker",
              reason,
            },
            toolOptions,
          ),
        )

        expect(result).toContain(`Responded to coordination request ${request.payload.request_id} with cancel_worker`)
        const statusEvent = await waitForSessionStatusEvent({
          taskID,
          sessionID: worker.id,
          reason: "aborted",
          afterMs: response.timeCreated,
        })
        const actions = listAgentCoordinationActions(taskID)
        expect(actions).toHaveLength(1)
        expect(actions[0]?.payload).toMatchObject({
          action_id: response.payload.action_id,
          request_id: request.payload.request_id,
          action: "cancel_worker",
          status: "completed",
          result: {
            session_id: worker.id,
            kind: "assistant",
            cancel_status_event_id: statusEvent.id,
            cancel_status: { type: "terminal", reason: "aborted" },
            recovered_cancel_status: false,
          },
        })
      },
    })
  })

  test("cancel_subagent refuses a live build goal attempt without live ownership", async () => {
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
      request: "Do not cancel a live build child session from missing root ownership",
      goalTitle: "Do not cancel missing ownership child session",
      goalSlug: "do-not-cancel-missing-ownership-child-session",
      objective: "Keep the live goal attempt running when only root ownership is missing",
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
              reason: "root ownership is missing, but that is not child lifecycle evidence",
            },
            buildToolOptions(),
          ),
        )

        expect(findGoalRun(goalRunID)?.status).toBe("running")
        expect(findGoalRun(goalRunID)?.error).toBeNull()
        expect(result).toContain("Error: cancel_subagent refused")
        expect(result).toContain(`goal_run ${goalRunID} status=running`)
        expect(result).toContain("Missing ownership is not cancellation evidence")
      },
    })
  })

  test("cancel_subagent refuses live goal run with no root ownership", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_cancel_subagent_no_owner_${stamp}`
    const taskID = `tsk_cancel_subagent_no_owner_${stamp}`
    const goalID = `gol_cancel_subagent_no_owner_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "cancel_subagent no owner",
      taskTitle: "cancel_subagent no owner",
      request: "Cancellation must not treat missing root ownership as child lifecycle proof",
      goalTitle: "Cancel no owner",
      goalSlug: "cancel-no-owner",
      objective: "Keep live child lifecycle facts separate from root tool ownership",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "cancel no owner parent" })
        const child = await Session.create({
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "cancel no owner child",
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
              session_id: child.id,
              reason: "no live ownership row was found",
            },
            buildToolOptions(),
          ),
        )

        expect(result).toContain("Error: cancel_subagent refused")
        expect(result).toContain(`goal_run ${goalRunID} status=running`)
        expect(result).toContain("Root build ownership only proves the dispatch tool lifecycle")
        expect(findGoalRun(goalRunID)?.status).toBe("running")
      },
    })
  })

  test("cancel_subagent refuses to bypass a pending A2A cancellation request", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_cancel_subagent_a2a_${stamp}`
    const taskID = `tsk_cancel_subagent_a2a_${stamp}`
    const goalID = `gol_cancel_subagent_a2a_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "cancel_subagent A2A guard",
      taskTitle: "cancel_subagent A2A guard",
      request: "A pending A2A cancellation request must be answered through respond_agent_coordination",
      goalTitle: "Do not bypass A2A cancellation",
      goalSlug: "do-not-bypass-a2a-cancellation",
      objective: "Keep cancellation bound to the coordination response/action artifacts",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "cancel_subagent A2A parent" })
        const child = await Session.create({
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "cancel_subagent A2A child",
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
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: child.id,
          agent: "build",
          messageID: "msg_cancel_subagent_a2a_request",
          callID: "cal_cancel_subagent_a2a_request",
          summary: "Worker asks to be cancelled",
          details: "The build worker cannot continue and asks the orchestrator to cancel it.",
          blocking: true,
          requestedDecision: "cancel_worker",
          goalID,
          goalRunID,
          now: now + 1,
        })

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const result = toolText(
          await tools.cancel_subagent.execute(
            {
              session_id: child.id,
              reason: "The pending A2A request asks for cancellation.",
            },
            buildToolOptions(),
          ),
        )

        expect(result).toContain("cancel_subagent refused")
        expect(result).toContain(request.payload.request_id)
        expect(result).toContain("respond_agent_coordination")
        expect(result).toContain("cancel_worker")
        expect(findGoalRun(goalRunID)?.status).not.toBe("aborted")
        expect(listPendingAgentCoordinationRequests(taskID).map((row) => row.payload.request_id)).toEqual([
          request.payload.request_id,
        ])
        expect(listAgentCoordinationActions(taskID)).toHaveLength(0)
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
        const ownershipPayload = createOrchestratorToolOwnershipPayload({
          taskID,
          orchestratorSessionID: parent.id,
          orchestratorMessageID: `msg_cancel_subagent_goal_${stamp}`,
          toolCallID: `cal_cancel_subagent_goal_${stamp}`,
          toolPartID: `prt_cancel_subagent_goal_${stamp}`,
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
        expect(toolText(result)).toContain(`Cancelled live-owned build session ${child.id}`)
        expect(toolText(result)).toContain(`source=${goalID} -> goal_run ${goalRunID} -> session ${child.id}`)
      },
    })
  })

  test("cancel_subagent goal_id refuses audit-only latest goal_run", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_cancel_subagent_goal_audit_${stamp}`
    const taskID = `tsk_cancel_subagent_goal_audit_${stamp}`
    const goalID = `gol_cancel_subagent_goal_audit_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "cancel_subagent audit goal id",
      taskTitle: "cancel_subagent audit goal id",
      request: "Do not cancel a stale latest goal_run just because it is marked running",
      goalTitle: "Audit-only latest goal_run",
      goalSlug: "audit-only-latest-goal-run",
      objective: "Keep goal_id cancellation bound to a real active worker.",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "cancel_subagent audit parent" })
        const child = await Session.create({
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "cancel_subagent audit child",
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

        await expect(
          tools.cancel_subagent.execute(
            {
              goal_id: goalID,
              reason: "should not auto-cancel audit-only latest tip",
            },
            buildToolOptions("cancel_subagent_goal_audit"),
          ),
        ).rejects.toThrow(/no live build ownership or active build session/)
        expect(findGoalRun(goalRunID)?.status).toBe("running")
      },
    })
  })

  test("live build ownership blocks goal mutation but cancel_subagent can stop the running build", async () => {
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
        expect(modifyResult).toContain("live build tool")
        expect(findGoal(goalID)?.objective).toBe("Guard live build ownership")
        expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(1)

        const completeResult = toolText(
          await tools.complete_goal.execute(
            {
              goalID,
              reason: "should be rejected while live owned",
            },
            buildToolOptions("complete_goal_live_owner"),
          ),
        )
        const deleteResult = toolText(
          await tools.delete_goal.execute(
            {
              goalID,
              reason: "should be rejected while live owned",
            },
            buildToolOptions("delete_goal_live_owner"),
          ),
        )
        expect(completeResult).toContain("Error: complete_goal refused")
        expect(completeResult).toContain("live build tool")
        expect(deleteResult).toContain("Error: delete_goal refused")
        expect(deleteResult).toContain("live build tool")
        expect(findGoal(goalID)).toBeDefined()

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

  for (const statusKind of ["streaming", "retry"] as const) {
    test(`${statusKind} build session blocks goal mutation without tool ownership`, async () => {
      const now = Date.now()
      const stamp = `${now.toString(16)}_${statusKind}`
      const projectID = `project_active_session_guard_${stamp}`
      const taskID = `tsk_active_session_guard_${stamp}`
      const goalID = `gol_active_session_guard_${stamp}`

      insertWorkflowTaskWithGoal({
        projectID,
        taskID,
        goalID,
        sessionID: null,
        worktree: tmp.path,
        projectName: "active session guard",
        taskTitle: "active session guard",
        request: "Do not mutate a goal while its build session is active",
        goalTitle: "Active session goal",
        goalSlug: "active-session-goal",
        objective: "Stay unchanged while the build session is active.",
        now,
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const parent = await Session.create({ kind: "root", title: "active session parent" })
          const child = await Session.create({
            kind: "build",
            parentID: parent.id,
            goalID,
            title: "active session child",
          })
          Database.use((db) =>
            db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
          )
          const goalRunID = beginBuildAttempt({
            taskID,
            goalID,
            sessionID: child.id,
          })
          SessionStatus.set(
            child.id,
            statusKind === "streaming"
              ? { type: "streaming" }
              : { type: "retry", attempt: 1, message: "provider retry", next: now + 1_000 },
            { publish: false },
          )
          expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(0)

          const { tools } = createOrchestratorTools({
            taskID,
            agentSessionID: parent.id,
            signal: new AbortController().signal,
          })

          const modifyResult = toolText(
            await tools.modify_goal.execute(
              {
                goalID,
                updates: { objective: "Mutated while session active" },
                reason: "should be rejected while session active",
              },
              buildToolOptions(`modify_goal_${statusKind}`),
            ),
          )
          const completeResult = toolText(
            await tools.complete_goal.execute(
              {
                goalID,
                reason: "should be rejected while session active",
              },
              buildToolOptions(`complete_goal_${statusKind}`),
            ),
          )
          const deleteResult = toolText(
            await tools.delete_goal.execute(
              {
                goalID,
                reason: "should be rejected while session active",
              },
              buildToolOptions(`delete_goal_${statusKind}`),
            ),
          )

          expect(modifyResult).toContain("active build session")
          expect(completeResult).toContain("active build session")
          expect(deleteResult).toContain("active build session")
          expect(findGoal(goalID)?.objective).toBe("Stay unchanged while the build session is active.")
          expect(findGoalRun(goalRunID)?.status).toBe("running")
          SessionStatus.set(
            child.id,
            { type: "terminal", reason: "aborted", error: "test cleanup" },
            { publish: false },
          )
        },
      })
    })
  }

  test("stale live goal_run without live ownership or active session does not block modify_goal", async () => {
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
      request: "Do not let stale goal_run lifecycle facts block contract repair",
      goalTitle: "Async build goal",
      goalSlug: "async-build-goal",
      objective: "Original stale goal_run objective",
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
              reason: "stale lifecycle row has no live ownership or active session",
            },
            buildToolOptions(),
          ),
        )

        expect(modifyResult).toContain(`Goal ${goalID} modified`)
        expect(modifyResult).not.toContain("Error: modify_goal refused")
        expect(findGoal(goalID)?.objective).toBe("Mutated while live goal_run exists")
        expect(findGoalRun(goalRunID)?.status).toBe("running")
        expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(0)
      },
    })
  })

  test("modify_goal records retry intent without clearing a completed workspace pointer", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_modify_preserve_workspace_${stamp}`
    const taskID = `tsk_modify_preserve_workspace_${stamp}`
    const goalID = `gol_modify_preserve_workspace_${stamp}`
    const workspaceDir = path.join(tmp.path, ".opencorvus", "r", "w", "mo", "presrv", "worktree")
    const workspaceBranch = `opencorvus/modify-preserve-${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "modify_goal workspace preservation",
      taskTitle: "modify_goal workspace preservation",
      request: "Changing a completed goal contract should not delete its recorded workspace.",
      goalTitle: "Completed goal",
      goalSlug: "completed-goal",
      objective: "Original completed objective",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await fs.mkdir(workspaceDir, { recursive: true })
        await Bun.write(path.join(workspaceDir, "sentinel.txt"), "keep completed workspace")
        seedGoalRunAttemptWithWorkspace({
          taskID,
          goalID,
          workspaceDir,
          workspaceBranch,
          status: "completed",
          now: now + 1,
        })
        expect(findGoalLatestWorkspace(goalID).directory).toBe(workspaceDir)

        const parent = await Session.create({ kind: "root", title: "modify_goal preserve workspace parent" })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = toolText(
          await tools.modify_goal.execute(
            {
              goalID,
              updates: { objective: "Clarified completed objective" },
              reason: "record retry intent while preserving worktree reuse context",
            },
            buildToolOptions(),
          ),
        )

        expect(result).toContain(`Goal ${goalID} modified`)
        expect(result).toContain("retry intent recorded")
        expect(result).not.toContain("stale worktree cleaned")
        const workspace = findGoalLatestWorkspace(goalID)
        expect(workspace.directory).toBe(workspaceDir)
        expect(workspace.branch).toBe(workspaceBranch)
        expect(await Filesystem.exists(path.join(workspaceDir, "sentinel.txt"))).toBe(true)
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

  test("complete_goal marks an undispatched goal complete through goal_run facts", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_complete_goal_${stamp}`
    const taskID = `tsk_complete_goal_${stamp}`
    const goalID = `gol_complete_goal_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "complete goal",
      taskTitle: "complete goal from scheduler",
      request: "Mark a proven no-op goal complete",
      goalTitle: "Already satisfied goal",
      goalSlug: "already-satisfied-goal",
      objective: "Represent work already proven satisfied by current task evidence.",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "complete goal parent" })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = toolText(
          await tools.complete_goal.execute(
            {
              goalID,
              reason: "Current task evidence proves this goal is already satisfied without a build attempt.",
            },
            buildToolOptions("complete_goal"),
          ),
        )

        expect(result).toContain("Goal marked complete")
        expect(goalStatusByID(goalID)).toBe("passed")
        const runs = listGoalRunsByGoal(goalID)
        expect(runs).toHaveLength(1)
        expect(runs[0]?.status).toBe("completed")
        expect(runs[0]?.session_id).toBeNull()
        expect(runs[0]?.time_started).toBeNull()
        expect(runs[0]?.metadata?.manual_completion).toMatchObject({
          source: "orchestrator.complete_goal",
          reason: "Current task evidence proves this goal is already satisfied without a build attempt.",
        })
        const decisions = createDecisionLog(taskID).readByPhase("orchestrator")
        expect(decisions.some((entry) => entry.key === `completed_goal_${goalID}`)).toBe(true)
      },
    })
  })

  test("complete_goal clears synthetic start time on a sessionless stale goal_run", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_complete_sessionless_stale_${stamp}`
    const taskID = `tsk_complete_sessionless_stale_${stamp}`
    const goalID = `gol_complete_sessionless_stale_${stamp}`
    const goalRunID = `glr_complete_sessionless_stale_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "complete sessionless stale",
      taskTitle: "complete sessionless stale",
      request: "Mark a sessionless stale goal_run complete",
      goalTitle: "Sessionless stale goal",
      goalSlug: "sessionless-stale-goal",
      objective: "Represent a stale audit row without a live executor session.",
      now,
    })

    Database.use((db) =>
      db
        .insert(EngineArtifactTable)
        .values({
          id: goalRunID,
          task_id: taskID,
          run_id: null,
          goal_run_id: goalRunID,
          kind: "goal_run_attempt",
          label: "sessionless-running",
          payload: {
            goal_id: goalID,
            session_id: null,
            status: "running",
            retry_count: 0,
            time_started: now - 5_000,
            time_completed: null,
          },
          time_created: now - 5_000,
          time_updated: now - 5_000,
        })
        .run(),
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "complete sessionless stale parent" })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = toolText(
          await tools.complete_goal.execute(
            {
              goalID,
              reason: "Current task evidence proves this stale audit row is already satisfied.",
            },
            buildToolOptions("complete_goal_sessionless_stale"),
          ),
        )

        expect(result).toContain("Goal marked complete")
        const run = findGoalRun(goalRunID)
        expect(run?.status).toBe("completed")
        expect(run?.session_id).toBeNull()
        expect(run?.time_started).toBeNull()
        expect(run?.metadata?.manual_completion).toMatchObject({
          source: "orchestrator.complete_goal",
          reason: "Current task evidence proves this stale audit row is already satisfied.",
        })
      },
    })
  })

  test("delete_goal deletes an obsolete goal and prunes graph dependency references", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_delete_goal_${stamp}`
    const taskID = `tsk_delete_goal_${stamp}`
    const removedGoalID = `gol_delete_goal_removed_${stamp}`
    const dependentGoalID = `gol_delete_goal_dependent_${stamp}`
    const planID = `plan_delete_goal_${stamp}`
    const removedPlanNodeID = `plan_node_delete_goal_removed_${stamp}`
    const dependentPlanNodeID = `plan_node_delete_goal_dependent_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID: removedGoalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "delete goal",
      taskTitle: "delete goal from scheduler",
      request: "Remove an obsolete goal from the graph",
      goalTitle: "Obsolete goal",
      goalSlug: "obsolete-goal",
      objective: "This goal is obsolete and should be removed.",
      now,
    })
    Database.use((db) => {
      db.insert(EnginePlanVersionTable)
        .values({
          id: planID,
          task_id: taskID,
          spec_snapshot_id: `spec_${removedGoalID}`,
          version: 1,
          status: "active",
          summary: "2 goals",
          prompt: "Remove one obsolete goal",
          metadata: {},
          time_created: now,
          time_updated: now,
        })
        .run()
      db.update(EngineGoalTable).set({ plan_version_id: planID }).where(eq(EngineGoalTable.id, removedGoalID)).run()
      db.insert(EngineGoalTable)
        .values({
          id: dependentGoalID,
          task_id: taskID,
          plan_version_id: planID,
          spec_snapshot_id: `spec_${removedGoalID}`,
          title: "Dependent goal",
          slug: "dependent-goal",
          objective: "This goal remains after the obsolete dependency is removed.",
          acceptance_specs: [],
          owned_paths: ["src/dependent.ts"],
          depends_on: [removedGoalID],
          kind: "feature",
          requirement_ids: [],
          priority: "blocking",
          source: "test",
          order_index: 1,
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EnginePlanNodeTable)
        .values({
          id: removedPlanNodeID,
          task_id: taskID,
          plan_version_id: planID,
          kind: "goal",
          goal_id: removedGoalID,
          title: "Obsolete goal",
          brief: "obsolete brief",
          order_index: 0,
          metadata: {},
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(EnginePlanNodeTable)
        .values({
          id: dependentPlanNodeID,
          task_id: taskID,
          plan_version_id: planID,
          kind: "goal",
          goal_id: dependentGoalID,
          title: "Dependent goal",
          brief: "dependent brief",
          depends_on_ids: [removedPlanNodeID],
          order_index: 1,
          metadata: {},
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "delete goal parent" })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = toolText(
          await tools.delete_goal.execute(
            {
              goalID: removedGoalID,
              reason: "Current evidence proves this goal is obsolete and its remaining dependent work is independent.",
            },
            buildToolOptions("delete_goal"),
          ),
        )

        expect(result).toContain("Goal deleted")
        expect(findGoal(removedGoalID)).toBeUndefined()
        expect(findGoal(dependentGoalID)?.depends_on).toEqual([])
        const planNodes = Database.use((db) =>
          db
            .select()
            .from(EnginePlanNodeTable)
            .where(eq(EnginePlanNodeTable.task_id, taskID))
            .orderBy(EnginePlanNodeTable.order_index)
            .all(),
        )
        expect(planNodes).toHaveLength(1)
        expect(planNodes[0]?.id).toBe(dependentPlanNodeID)
        expect(planNodes[0]?.depends_on_ids).toBeNull()
        const decisions = createDecisionLog(taskID).readByPhase("orchestrator")
        expect(decisions.some((entry) => entry.key === `deleted_goal_${removedGoalID}`)).toBe(true)
      },
    })
  })

  test("complete_goal completes stale live goal_run when no live ownership or active session exists", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_complete_stale_live_${stamp}`
    const taskID = `tsk_complete_stale_live_${stamp}`
    const goalID = `gol_complete_stale_live_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "complete stale live",
      taskTitle: "complete stale live",
      request: "Complete a stale live goal_run without cancelling a non-existent worker",
      goalTitle: "Stale live goal",
      goalSlug: "stale-live-goal",
      objective: "Represent work already proven satisfied despite stale lifecycle status.",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "complete stale live parent" })
        const child = await Session.create({
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "complete stale live child",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const goalRunID = beginBuildAttempt({
          taskID,
          goalID,
          sessionID: child.id,
        })
        expect(findGoalRun(goalRunID)?.status).toBe("running")
        expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(0)

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const result = toolText(
          await tools.complete_goal.execute(
            {
              goalID,
              reason: "Current task evidence proves this stale live row has no live worker and is satisfied.",
            },
            buildToolOptions("complete_goal_stale_live"),
          ),
        )

        expect(result).toContain("Goal marked complete")
        expect(goalStatusByID(goalID)).toBe("passed")
        expect(findGoalRun(goalRunID)?.status).toBe("completed")
        expect(findGoalRun(goalRunID)?.metadata?.manual_completion).toMatchObject({
          source: "orchestrator.complete_goal",
          reason: "Current task evidence proves this stale live row has no live worker and is satisfied.",
        })
      },
    })
  })

  test("delete_goal deletes stale live goal_run goal when no live ownership or active session exists", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_delete_stale_live_${stamp}`
    const taskID = `tsk_delete_stale_live_${stamp}`
    const goalID = `gol_delete_stale_live_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "delete stale live",
      taskTitle: "delete stale live",
      request: "Delete obsolete goal despite stale lifecycle status",
      goalTitle: "Obsolete stale live goal",
      goalSlug: "obsolete-stale-live-goal",
      objective: "This stale goal is obsolete.",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "delete stale live parent" })
        const child = await Session.create({
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "delete stale live child",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const goalRunID = beginBuildAttempt({
          taskID,
          goalID,
          sessionID: child.id,
        })
        expect(findGoalRun(goalRunID)?.status).toBe("running")
        expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(0)

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })
        const result = toolText(
          await tools.delete_goal.execute(
            {
              goalID,
              reason: "Current evidence proves this stale live goal is obsolete.",
            },
            buildToolOptions("delete_goal_stale_live"),
          ),
        )

        expect(result).toContain("Goal deleted")
        expect(findGoal(goalID)).toBeUndefined()
      },
    })
  })

  test("complete_goal and delete_goal refuse live build ownership", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_goal_mutation_live_refusal_${stamp}`
    const taskID = `tsk_goal_mutation_live_refusal_${stamp}`
    const goalID = `gol_goal_mutation_live_refusal_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "goal mutation live refusal",
      taskTitle: "goal mutation live refusal",
      request: "Do not complete or delete live goal work",
      goalTitle: "Live goal",
      goalSlug: "live-goal",
      objective: "Stay unchanged while a build attempt is live.",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "live goal mutation parent" })
        const child = await Session.create({
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "live goal mutation child",
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
          orchestratorMessageID: `msg_goal_mutation_live_${stamp}`,
          toolCallID: `cal_goal_mutation_live_${stamp}`,
          toolPartID: `prt_goal_mutation_live_${stamp}`,
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

        const completeResult = toolText(
          await tools.complete_goal.execute(
            {
              goalID,
              reason: "should not complete while build is live",
            },
            buildToolOptions("complete_goal_live"),
          ),
        )
        const deleteResult = toolText(
          await tools.delete_goal.execute(
            {
              goalID,
              reason: "should not delete while build is live",
            },
            buildToolOptions("delete_goal_live"),
          ),
        )

        expect(completeResult).toContain("Error: complete_goal refused")
        expect(completeResult).toContain("live build tool")
        expect(deleteResult).toContain("Error: delete_goal refused")
        expect(deleteResult).toContain("live build tool")
        expect(findGoal(goalID)).toBeDefined()
        expect(findGoalRun(goalRunID)?.status).toBe("running")
      },
    })
  })

  test("cancel_subagent cancels live-owned build by goal_run_id", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_cancel_subagent_live_owned_${stamp}`
    const taskID = `tsk_cancel_subagent_live_owned_${stamp}`
    const goalID = `gol_cancel_subagent_live_owned_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "cancel live-owned build",
      taskTitle: "cancel live-owned build",
      request: "Cancel a live-owned build when explicit cancellation evidence requires it",
      goalTitle: "Cancel live-owned build goal",
      goalSlug: "cancel-subagent-live-owned-goal",
      objective: "Close live build ownership and abort the goal run",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "cancel live-owned parent" })
        const child = await Session.create({
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "cancel live-owned child",
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
        const orchestratorMessageID = `msg_cancel_subagent_live_owned_${stamp}`
        const toolPartID = `prt_cancel_subagent_live_owned_${stamp}`
        const toolCallID = `cal_cancel_subagent_live_owned_${stamp}`
        await Session.persistMessage({
          info: {
            id: orchestratorMessageID,
            sessionID: parent.id,
            role: "assistant",
            time: { created: now },
            parentID: `msg_user_cancel_subagent_live_owned_${stamp}`,
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
              reason: "operator explicitly requested cancellation of this live-owned build session",
            },
            buildToolOptions("cancel_subagent"),
          ),
        )

        expect(toolText(result)).toContain(`Cancelled live-owned build session ${child.id}`)
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

  test("cancel_subagent refuses active build session when live ownership is missing", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_cancel_streaming_no_owner_${stamp}`
    const taskID = `tsk_cancel_streaming_no_owner_${stamp}`
    const goalID = `gol_cancel_streaming_no_owner_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "cancel streaming no owner",
      taskTitle: "cancel streaming no owner",
      request: "Do not cancel an active build when only root ownership is missing",
      goalTitle: "Cancel streaming no-owner build goal",
      goalSlug: "cancel-streaming-no-owner-build-goal",
      objective: "Refuse cancellation while the build session is active but unowned by root dispatch",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "cancel streaming no owner parent" })
        const child = await Session.create({
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "cancel streaming no owner child",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: parent.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const goalRunID = beginBuildAttempt({
          taskID,
          goalID,
          sessionID: child.id,
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
              reason: "root ownership is absent but active session status is still streaming",
            },
            buildToolOptions("cancel_streaming_no_owner"),
          ),
        )

        expect(toolText(result)).toContain("Error: cancel_subagent refused")
        expect(toolText(result)).toContain("Missing ownership is not cancellation evidence")
        expect(findGoalRun(goalRunID)?.status).toBe("running")
        expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(0)
        SessionStatus.set(child.id, { type: "terminal", reason: "aborted", error: "test cleanup" })
      },
    })
  })

  test("cancel_subagent is a no-op when the build session has no live ownership or goal run", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_cancel_no_owner_${stamp}`
    const taskID = `tsk_cancel_no_owner_${stamp}`
    const goalID = `gol_cancel_no_owner_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "cancel no owner",
      taskTitle: "cancel no owner",
      request: "No-op when there is no live build ownership",
      goalTitle: "Cancel no owner goal",
      goalSlug: "cancel-no-owner-goal",
      objective: "Do not mutate state without live ownership",
      now,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "cancel no owner parent" })
        const child = await Session.create({
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "cancel no owner child",
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
              reason: "there is no live ownership to cancel",
            },
            buildToolOptions("cancel_no_owner"),
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

  test("workflow task-level direct build receives active requirements and Visual QA feedback", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_direct_build_feedback_${stamp}`
    const goalID = `gol_direct_build_feedback_${stamp}`
    const specID = `spec_direct_build_feedback_${stamp}`
    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    let capturedContext: any
    let capturedTarget: any
    let capturedRunInput: any
    let capturedLayoutGeometryEvidenceID = ""
    let capturedComparisonEvidenceID = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "direct build visual QA feedback test" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Direct build visual QA feedback test",
          taskTitle: "Direct build feedback task",
          request: "Repair the market page replica after visual QA.",
          goalTitle: "Replica repair goal",
          goalSlug: "replica-repair-goal",
          objective: "Repair the market page visual structure.",
          now,
          specID,
          insertProject: false,
        })
        Database.use((db) =>
          insertRequirements(db, {
            taskID,
            specSnapshotID: specID,
            now,
            requirements: [
              {
                id: "REQ-visual-replica",
                title: "Visual replica fidelity",
                description: "The market page replica preserves the source page layout density and tab hierarchy.",
                acceptance: [
                  "Desktop screenshot comparison shows the tab hierarchy and spacing match the source page.",
                ],
                evidence_refs: ["frontend_design:desktop-reference"],
                non_goals: ["Do not redesign the page into a new marketing layout."],
                priority: "blocking",
              },
            ],
          }),
        )
        const annotatedVisualQaPng = await sharp({
          create: {
            width: 320,
            height: 220,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 },
          },
        })
          .png()
          .toBuffer()
        const annotatedVisualQaRef = await AttachmentStore.write(
          Instance.project.id,
          annotatedVisualQaPng,
          "image/png",
          "dom-market-tabs.annotated.png",
        )
        const layoutGeometryJobID = `art_layout_geometry_${stamp}`
        const layoutGeometryDir = ProjectRuntimePaths.browserPreviewJobRoot(tmp.path, taskID, layoutGeometryJobID)
        await fs.mkdir(layoutGeometryDir, { recursive: true })
        const layoutGeometryManifestPath = path.join(layoutGeometryDir, "layout-geometry.json")
        const layoutGeometryManifest = {
          operation: "layout-geometry",
          status: "passed",
          taskID,
          targetID: "art_preview_target",
          viewportID: "desktop",
          route: "/markets/usa/",
          jobID: layoutGeometryJobID,
          samples: [],
          widthBehavior: [],
          alignmentGroups: [
            {
              sampleID: "desktop",
              groupID: "primary-content-rail",
              edge: "left",
              status: "captured",
              regionIDs: ["market-summary", "index-collections"],
              missingRegionIDs: [],
              values: [
                { regionID: "market-summary", value: 36 },
                { regionID: "index-collections", value: 540 },
              ],
              min: 36,
              max: 540,
              spread: 504,
            },
          ],
          diagnostics: [],
        }
        await fs.writeFile(layoutGeometryManifestPath, `${JSON.stringify(layoutGeometryManifest, null, 2)}\n`, "utf8")
        const layoutGeometryEvidenceID = persistBrowserPreviewEvidence({
          projectRoot: tmp.path,
          taskID,
          targetID: "art_preview_target",
          viewportID: "desktop",
          operationKind: "layout-geometry",
          manifestPath: layoutGeometryManifestPath,
          artifactPaths: { manifest: layoutGeometryManifestPath },
          status: "passed",
          summary: "layout geometry captured primary-content-rail spread=504",
          capture: layoutGeometryManifest,
          diagnostics: [],
        })
        capturedLayoutGeometryEvidenceID = layoutGeometryEvidenceID
        const layoutGeometryEvidenceRef = `browser_preview_evidence:${layoutGeometryEvidenceID}`
        const comparisonJobID = `art_reference_comparison_${stamp}`
        const comparisonDir = ProjectRuntimePaths.browserPreviewJobRoot(tmp.path, taskID, comparisonJobID)
        await fs.mkdir(comparisonDir, { recursive: true })
        const comparisonArtifactPaths = {
          source_crop: path.join(comparisonDir, "source.png"),
          implementation_crop: path.join(comparisonDir, "implementation.png"),
          side_by_side: path.join(comparisonDir, "side-by-side.png"),
          diff: path.join(comparisonDir, "diff.png"),
        }
        const comparisonColors = ["#dde7ff", "#ffe1dd", "#f8f8f8", "#ff00aa"]
        for (const [index, filePath] of Object.values(comparisonArtifactPaths).entries()) {
          await sharp({
            create: {
              width: 24,
              height: 18,
              channels: 4,
              background: comparisonColors[index],
            },
          })
            .png()
            .toFile(filePath)
        }
        const comparisonEvidenceID = persistBrowserPreviewEvidence({
          projectRoot: tmp.path,
          taskID,
          targetID: "art_preview_target",
          viewportID: "desktop",
          operationKind: "reference-comparison",
          regionID: "market-tabs",
          cropIntent: "full-region",
          artifactPaths: comparisonArtifactPaths,
          status: "failed",
          summary: "reference comparison failed market tabs spacing",
          capture: {
            status: "failed",
            regionID: "market-tabs",
            pixel_diff_percent: 31,
          },
          diagnostics: ["reference comparison failed market tabs spacing"],
        })
        capturedComparisonEvidenceID = comparisonEvidenceID
        const comparisonEvidenceRef = `browser_preview_evidence:${comparisonEvidenceID}`

        const visualQaRecord: any = minimalVisualQaDecisionRecord()
        visualQaRecord.report.accepted = false
        visualQaRecord.report.summary = "Market tab row is clipped and spacing is too loose."
        visualQaRecord.report.check_items[0] = {
          ...visualQaRecord.report.check_items[0],
          id: "check-market-tabs",
          category: "reference-structure",
          question: "Does the market tab row preserve the source page hierarchy and spacing?",
          region: "market tabs",
          status: "failed",
          expected: "The market tab row matches the source hierarchy and first-viewport spacing.",
          observed: "The market tab row is clipped and spacing is too loose.",
          evidence_refs: ["screenshot://local/market-tabs.png", layoutGeometryEvidenceRef, comparisonEvidenceRef],
          required_correction: "Restore tab row spacing and hierarchy from the source page.",
        }
        visualQaRecord.report.coverage[0] = {
          ...visualQaRecord.report.coverage[0],
          check_ids: ["check-market-tabs"],
          region: "market tabs",
          evidence_refs: ["screenshot://local/market-tabs.png", layoutGeometryEvidenceRef, comparisonEvidenceRef],
        }
        visualQaRecord.report.evidence[0] = {
          ...visualQaRecord.report.evidence[0],
          check_ids: ["check-market-tabs"],
          type: "screenshot",
          ref: "screenshot://local/market-tabs.png",
          viewport: { width: 1440, height: 900 },
          note: "Market tab row screenshot shows clipping and loose spacing.",
        }
        visualQaRecord.report.evidence.push({
          check_ids: ["check-market-tabs"],
          type: "other",
          ref: layoutGeometryEvidenceRef,
          viewport: { width: 1440, height: 900 },
          note: "Layout geometry manifest shows primary-content-rail left spread=504px.",
        })
        visualQaRecord.report.evidence.push({
          check_ids: ["check-market-tabs"],
          type: "screenshot",
          ref: comparisonEvidenceRef,
          viewport: { width: 1440, height: 900 },
          note: "Browser Preview reference comparison shows market tab spacing mismatch.",
        })
        visualQaRecord.report.production_blockers = [
          {
            id: "blocker-market-tabs",
            check_ids: ["check-market-tabs"],
            principle_ids: ["reference-structure"],
            region: "market tabs",
            reason: "The tab row does not match the source hierarchy.",
            impact: "The first viewport reads as a redesigned page instead of a replica.",
            required_correction: "Restore tab row spacing and hierarchy from the source page.",
            source_refs: ["frontend_design:desktop-reference"],
            evidence_refs: ["screenshot://local/market-tabs.png", layoutGeometryEvidenceRef, comparisonEvidenceRef],
          },
        ]
        visualQaRecord.report.problem_dom_regions = [
          {
            id: "dom-market-tabs",
            check_ids: ["check-market-tabs"],
            blocker_ids: ["blocker-market-tabs"],
            region: "market tabs",
            route: "/markets/usa/",
            viewport: { width: 1440, height: 900 },
            locator: 'main [data-testid="market-tabs"]',
            dom_path: "body > div#root > main > nav.market-tabs",
            outer_html_excerpt: '<nav data-testid="market-tabs" class="market-tabs loose">Stocks ETFs Bonds</nav>',
            ancestor_context: ["main class=market-page"],
            sibling_context: ["h1 United States", "section class=index-overview"],
            text_content: "Stocks ETFs Bonds",
            role: "navigation",
            accessible_name: "Market categories",
            bbox: { x: 64, y: 174, width: 900, height: 42 },
            computed_style: { display: "flex", gap: "32px", "margin-top": "40px" },
            attributes: { class: "market-tabs loose", "data-testid": "market-tabs" },
            code_search_terms: ["market-tabs", "MarketTabs", "loose"],
            evidence_refs: ["screenshot://local/market-tabs.png", layoutGeometryEvidenceRef, comparisonEvidenceRef],
            annotated_evidence_refs: [annotatedVisualQaRef.url],
            notes: "Repair the tab component before repainting adjacent overview cards.",
          },
        ]
        visualQaRecord.report.reference_parity = {
          required: true,
          required_regions: ["market tabs"],
          reference_comparison_evidence_refs: [comparisonEvidenceRef],
          missing_regions: [],
          blocker_ids: ["blocker-market-tabs"],
        }
        visualQaRecord.acceptance = {
          submittedAccepted: false,
          effectiveAccepted: false,
          selfReportIssues: [],
          blockingIssues: ["Visual QA reported blocker-market-tabs."],
        }
        createDecisionLog(taskID).append({
          phase: "visual_qa",
          key: `report_${now}`,
          value: JSON.stringify(visualQaRecord, null, 2),
          reason: "Latest failed Visual Quality Assurance report for direct build feedback.",
        })

        buildAgentRunImpl = async (input: any) => {
          await markBuildSlotAcquired(input, `ses_direct_build_feedback_${stamp}`)
          capturedRunInput = input
          capturedContext = input.context
          capturedTarget = input.target
          return {
            result: {
              status: "passed",
              summary: "Direct build consumed active requirements and Visual QA feedback.",
              files_changed: [
                {
                  path: "src/components/MarketTabs.tsx",
                  summary: "Repaired market tab hierarchy.",
                  reason: "Visual QA blocker and active requirement required tab hierarchy repair.",
                },
              ],
              tests: [],
              commit_ref: "abc1234",
            },
            sessionID: `ses_direct_build_feedback_${stamp}`,
            worktreeDir: input.workDir ?? input.managedWorktree?.directory ?? Instance.directory,
            worktreeBranch: input.managedWorktree?.branch,
            worktreeBaseRef: input.managedWorktree?.baseRef,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
          workflow: pipeline,
          workflowState: createWorkflowState(pipeline),
        })

        const result = await tools.build.execute(
          {
            request: "Repair the market tabs using the latest Visual QA report.",
            reason: "Task-level rework after Visual QA failure.",
            directBuildIntent: "modify_files",
          },
          buildToolOptions(),
        )

        expect(toolText(result)).toContain("Build agent finished (status=passed")
        await waitForCondition("direct build captured context", () => Boolean(capturedContext))
      },
    })

    expect(capturedTarget).toMatchObject({
      kind: "request",
      text: "Repair the market tabs using the latest Visual QA report.",
    })
    expect(capturedRunInput?.workDir).toBe(tmp.path)
    expect(capturedRunInput?.managedWorktree).toBeUndefined()
    expect(capturedContext?.requirements?.map((row: any) => row.id)).toEqual(["REQ-visual-replica"])
    expect(capturedContext?.requirements?.[0]?.description).toContain("source page layout density")
    expect(capturedContext?.visualQaFeedback).toContain("Latest failed Visual QA report for Build repair")
    expect(capturedContext?.visualQaFeedback).toContain("blocker-market-tabs")
    expect(capturedContext?.visualQaFeedback).toContain('locator: main [data-testid="market-tabs"]')
    expect(capturedContext?.visualQaFeedback).toContain("annotated_evidence_refs")
    expect(capturedContext?.visualQaFeedback).toContain("code_search_terms: market-tabs, MarketTabs, loose")
    expect(capturedContext?.evidencePack?.visualQaAnnotations).toHaveLength(1)
    expect(capturedContext?.evidencePack?.visualQaAnnotations?.[0]).toMatchObject({
      url: expect.stringContaining("/attachment/"),
      filename: "dom-market-tabs.annotated.png",
      intent: "visual_qa_annotation",
      source: "visual_qa_problem_dom_region",
      label: "dom-market-tabs",
    })
    expect(capturedContext?.evidencePack?.comparisonArtifacts?.map((item: any) => item.filename)).toEqual([
      `${capturedComparisonEvidenceID}.side_by_side.png`,
      `${capturedComparisonEvidenceID}.diff.png`,
      `${capturedComparisonEvidenceID}.source_crop.png`,
      `${capturedComparisonEvidenceID}.implementation_crop.png`,
    ])
    expect(capturedContext?.evidencePack?.comparisonArtifacts?.[0]).toMatchObject({
      url: expect.stringContaining("/attachment/"),
      mime: "image/png",
      intent: "visual_feedback_comparison",
      source: "browser_preview_reference_comparison",
      label: `${capturedComparisonEvidenceID}:side_by_side`,
    })
    expect(capturedContext?.evidencePack?.visualQaDiagnostics).toHaveLength(1)
    expect(capturedContext?.evidencePack?.visualQaDiagnostics?.[0]).toMatchObject({
      url: expect.stringContaining("/attachment/"),
      filename: `${capturedLayoutGeometryEvidenceID}.layout-geometry.json`,
      mime: "application/json",
      intent: "visual_qa_diagnostic",
      source: "browser_preview_layout_geometry",
      label: capturedLayoutGeometryEvidenceID,
    })
    expect(capturedContext?.acceptanceFeedback).toBeUndefined()
  })

  test("goal build can run in current project without persisting a managed workspace", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_goal_current_project_${stamp}`
    const goalID = `gol_goal_current_project_${stamp}`
    let capturedRunInput: any

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal current project build test" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Goal current project build test",
          taskTitle: "Goal current project task",
          request: "Implement a goal in the current project directory.",
          goalTitle: "Current project goal",
          goalSlug: "current-project-goal",
          objective: "Verify current-project goal build does not register a managed workspace.",
          now,
          insertProject: false,
        })

        const createWorktreeSpy = spyOn(Worktree, "create")
        buildAgentRunImpl = async (input: any) => {
          capturedRunInput = input
          await markBuildSlotAcquired(input, `ses_goal_current_project_${stamp}`)
          return {
            result: {
              status: "passed",
              summary: "Goal build committed in the current project directory.",
              files_changed: [
                {
                  path: "src/index.ts",
                  summary: "Changed the current project implementation.",
                  reason: "The model selected current_project worktree usage.",
                },
              ],
              tests: [],
              commit_ref: "cur1234",
            },
            sessionID: `ses_goal_current_project_${stamp}`,
            worktreeDir: input.workDir,
            mergeBackStatus: "not_invoked",
            worktreeHead: "cur1234",
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
            reason: "Per-goal pipeline execution in the current project directory.",
            worktreeUsage: "current_project",
          },
          buildToolOptions("goal_current_project"),
        )

        expectGoalBuildStarted(result)
        await waitForGoalStatus(goalID, "passed")
        expect(createWorktreeSpy).not.toHaveBeenCalled()
      },
    })

    expect(capturedRunInput?.workDir).toBe(tmp.path)
    expect(capturedRunInput?.managedWorktree).toBeUndefined()

    const latestWorkspace = findGoalLatestWorkspace(goalID)
    expect(latestWorkspace.directory).toBeNull()
    expect(latestWorkspace.branch).toBeNull()

    const goalRun = listGoalRunsByGoal(goalID)[0]
    expect(goalRun?.workspace_dir).toBeNull()
    expect(goalRun?.workspace_branch).toBeNull()
    const outcome = Database.use((db) =>
      db
        .select()
        .from(EngineArtifactTable)
        .where(
          and(eq(EngineArtifactTable.goal_run_id, goalRun!.id), eq(EngineArtifactTable.kind, "build_attempt_outcome")),
        )
        .get(),
    )
    expect((outcome?.payload as any)?.host_facts?.contribution_commit_ref).toBe("cur1234")
    expect((outcome?.payload as any)?.workspace?.dir).toBeNull()
  })

  test("task-level direct build can explicitly request a managed worktree", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_direct_managed_${stamp}`
    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const managedDir = path.join(tmp.path, ".opencorvus", "r", "w", "direct-managed")
    let capturedRunInput: any

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "test",
              title: "Direct managed worktree task",
              request: "Verify direct build can still request a managed worktree",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()
        })
        const parent = await Session.create({ kind: "root", title: "direct managed worktree test" })
        buildAgentRunImpl = async (input: any) => {
          capturedRunInput = input
          await input.onSessionCreated?.(`ses_direct_managed_${stamp}`, {
            worktreeDir: managedDir,
            worktreeBranch: `opencorvus/direct-managed-${stamp}`,
            worktreeBaseRef: "base1234",
          })
          return {
            result: {
              status: "passed",
              summary: "Direct build ran through a managed worktree.",
              files_changed: [],
              tests: [],
              commit_ref: "merged123",
            },
            sessionID: `ses_direct_managed_${stamp}`,
            worktreeDir: managedDir,
            worktreeBranch: `opencorvus/direct-managed-${stamp}`,
            worktreeBaseRef: "base1234",
            mergeBackStatus: "merged",
            publishedCommitRef: "merged123",
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
          workflow: pipeline,
          workflowState: createWorkflowState(pipeline),
        })

        const result = await tools.build.execute(
          {
            request: "Implement through an isolated managed worktree.",
            reason: "Scoped direct implementation with explicit isolation.",
            directBuildIntent: "modify_files",
            worktreeUsage: "managed_worktree",
          },
          buildToolOptions("direct_managed"),
        )

        expect(toolText(result)).toContain("Build agent finished (status=passed")
        expect(toolText(result)).toContain(`worktreeDir: ${managedDir}`)
      },
    })

    expect(capturedRunInput?.workDir).toBeUndefined()
    expect(capturedRunInput?.managedWorktree).toBeUndefined()
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
    const createSpy = spyOn(EngineService, "createSchedulerChildTask").mockResolvedValue("tsk_created_followup")

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
            request:
              "Add focused tests for `packages/app/src/components/GeneratedCard.tsx` because the parent task generated the component without state and long-label coverage.",
            reason:
              "`packages/app/src/components/GeneratedCard.tsx` needs separate quality-hardening after the current request because its generated UI states are not covered by tests.",
            code_module_reference: {
              entity: "packages/app/src/components/GeneratedCard.tsx",
              problem: "The generated UI states are not covered by tests.",
            },
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
            request:
              "Add focused tests for `packages/app/src/components/GeneratedCard.tsx` because the parent task generated the component without state and long-label coverage.",
            parentTaskID: taskID,
            priority: "high",
            kind: "workflow",
            source: "orchestrator:propose_task",
            metadata: {
              origin: "orchestrator_proposed_task",
              inheritance: "orchestrator_follow_up",
              proposal_reason:
                "`packages/app/src/components/GeneratedCard.tsx` needs separate quality-hardening after the current request because its generated UI states are not covered by tests.",
              code_module_reference: {
                entity: "packages/app/src/components/GeneratedCard.tsx",
                problem: "The generated UI states are not covered by tests.",
              },
            },
          }),
        )
      },
    })
  })

  test("propose_task rejects vague follow-up work without a concrete code module reference", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_vague_followup_${stamp}`
    const taskID = `tsk_vague_followup_${stamp}`
    const createSpy = spyOn(EngineService, "createSchedulerChildTask").mockResolvedValue("tsk_should_not_create_vague")

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: tmp.path,
          name: "vague follow-up project",
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
        const parent = await Session.create({ kind: "root", title: "vague follow-up parent" })
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
            title: "Improve project quality",
            request: "Do another polish pass and improve project quality.",
            reason: "The project could benefit from general hardening later.",
            priority: "normal",
            kind: "workflow",
          },
          buildToolOptions(),
        )

        const text = toolText(result)
        expect(text).toContain("Follow-up task proposal rejected")
        expect(text).toContain("concrete code module reference entity")
        expect(text).toContain("no new task was created")
        expect(createSpy).not.toHaveBeenCalled()
      },
    })
  })

  test("propose_task allows a second independent child task for the same parent", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_parallel_child_${stamp}`
    const taskID = `tsk_parallel_parent_${stamp}`
    const existingChildID = `tsk_parallel_existing_${stamp}`
    const createSpy = spyOn(EngineService, "createSchedulerChildTask").mockResolvedValue("tsk_parallel_new_child")

    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectID,
          worktree: tmp.path,
          name: "parallel child task project",
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
      db.insert(EngineTaskTable)
        .values({
          id: existingChildID,
          project_id: projectID,
          session_id: null,
          source: "orchestrator:propose_task",
          title: "Existing independent child",
          request: "Audit the generated documentation.",
          kind: "workflow",
          priority: "normal",
          metadata: { parent_task_id: taskID },
          time_created: now + 1,
          time_updated: now + 1,
          time_started: now + 1,
        })
        .run()
    })

    await fs.writeFile(path.join(tmp.path, "opencorvus.json"), JSON.stringify({ model: "test/model" }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "parallel child parent" })
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
            title: "Validate release notes",
            request:
              "Validate `packages/app/src/release/notes.ts` independently from the existing documentation audit child task because generated release-note rows can omit fixed component names.",
            reason:
              "`packages/app/src/release/notes.ts` uses a separate artifact and does not depend on the existing documentation audit child task.",
            code_module_reference: {
              entity: "packages/app/src/release/notes.ts",
              problem: "Generated release-note rows can omit fixed component names.",
            },
            priority: "normal",
            queue: false,
            kind: "workflow",
          },
          buildToolOptions(),
        )

        const text = toolText(result)
        expect(text).toContain("Follow-up task created automatically")
        expect(text).toContain("tsk_parallel_new_child")
        expect(text).not.toContain("no new task was created")
        expect(createSpy).toHaveBeenCalledTimes(1)
        expect(createSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Validate release notes",
            request:
              "Validate `packages/app/src/release/notes.ts` independently from the existing documentation audit child task because generated release-note rows can omit fixed component names.",
            parentTaskID: taskID,
            queue: false,
            source: "orchestrator:propose_task",
            metadata: {
              origin: "orchestrator_proposed_task",
              inheritance: "orchestrator_follow_up",
              proposal_reason:
                "`packages/app/src/release/notes.ts` uses a separate artifact and does not depend on the existing documentation audit child task.",
              code_module_reference: {
                entity: "packages/app/src/release/notes.ts",
                problem: "Generated release-note rows can omit fixed component names.",
              },
            },
          }),
        )
      },
    })
  })

  test("propose_task refuses a completed parent task without creating follow-up work", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_completed_propose_${stamp}`
    const taskID = `tsk_completed_propose_${stamp}`
    const createSpy = spyOn(EngineService, "createSchedulerChildTask").mockResolvedValue("tsk_completed_followup")

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

        const result = await tools.propose_task.execute(
          {
            title: "Run second verification pass",
            request:
              "Run a second verification pass for `packages/app/src/components/GeneratedCard.tsx` from the completed parent task and fix any regressions found.",
            reason:
              "`packages/app/src/components/GeneratedCard.tsx` is the concrete module that needs separate follow-up verification after the first task completed.",
            code_module_reference: {
              entity: "packages/app/src/components/GeneratedCard.tsx",
              problem: "The completed parent task still needs separate follow-up verification for this module.",
            },
            priority: "high",
            queue: true,
            kind: "workflow",
          },
          buildToolOptions(),
        )

        const text = toolText(result)
        const pending = await Question.list()

        expect(text).toContain(`Task ${taskID} is terminal (status=completed)`)
        expect(text).toContain("Task-level scheduler tools may act only while the task is active")
        expect(pending).toHaveLength(0)
        expect(createSpy).not.toHaveBeenCalled()
        expect(deriveTaskStatus(findTask(taskID)!)).toBe("completed")
      },
    })
  })

  test("propose_task does not create a follow-up task when auto-confirm is disabled and the user declines", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_decline_${stamp}`
    const taskID = `tsk_decline_${stamp}`
    const createSpy = spyOn(EngineService, "createSchedulerChildTask").mockResolvedValue("tsk_should_not_create")

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
        const parent = await Session.create({ kind: "root", title: "decline proposed task parent" })
        Database.use((db) =>
          db
            .update(EngineTaskTable)
            .set({ session_id: parent.id, time_updated: Date.now() })
            .where(eq(EngineTaskTable.id, taskID))
            .run(),
        )
        spyOn(EffectiveConfig, "effective").mockResolvedValue({
          experimental: { auto_confirm_proposed_tasks: false },
        } as never)
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
            request:
              "Clean up optional polish in `packages/app/src/components/GeneratedCard.tsx` where generated labels wrap awkwardly.",
            reason:
              "`packages/app/src/components/GeneratedCard.tsx` has a separate optional label-wrapping cleanup that is outside the current task.",
            code_module_reference: {
              entity: "packages/app/src/components/GeneratedCard.tsx",
              problem: "Generated labels wrap awkwardly.",
            },
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
      expect(input.designResourceManifest?.entries.map((entry: any) => entry.kind).sort()).toEqual(
        ["figma_context", "figma_metadata", "figma_screenshot", "figma_variables"].sort(),
      )
      expect(attachments.some((item: any) => item.source === "figma-mcp" && item.mime === "image/png")).toBe(true)
      expect(
        attachments.filter((item: any) => item.source === "figma-mcp" && item.mime === "text/markdown").length,
      ).toBe(3)
      expect(attachments.some((item: any) => item.intent === "design_resource_manifest")).toBe(false)
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
        expect((task.system_artifacts as any[]).some((item) => item.intent === "design_resource_manifest")).toBe(true)
        const manifests = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(
              and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "design_resource_manifest")),
            )
            .all(),
        )
        expect(manifests).toHaveLength(1)
        expect((manifests[0]?.payload as any).entries.map((entry: any) => entry.kind).sort()).toEqual(
          ["figma_context", "figma_metadata", "figma_screenshot", "figma_variables"].sort(),
        )
      },
    })
  })

  test("frontend_design rejects any explicit materialization failure before agent analysis", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_frontend_design_material_fail_${stamp}`
    const goalID = `gol_frontend_design_material_fail_${stamp}`
    let analyzeCalled = false

    await fs.writeFile(
      path.join(tmp.path, "reference.html"),
      "<!doctype html><html><body><main>reference design</main></body></html>",
      "utf8",
    )
    designAnalyzeImpl = async () => {
      analyzeCalled = true
      return minimalFrontendDesignResult({ sessionID: "ses_should_not_start" })
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "frontend design material failure" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Frontend design material failure",
          taskTitle: "Frontend design material failure",
          request: "Use the supplied HTML design resource.",
          goalTitle: "Implement supplied design",
          goalSlug: "implement-supplied-design",
          objective: "Implement supplied design resource.",
          now,
          insertProject: false,
        })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        await expect(
          tools.frontend_design.execute(
            {
              reason: "Material failure must stop the design handoff.",
              materials: ["reference.html", "missing.html"],
            },
            buildToolOptions("frontend_design_material_fail"),
          ),
        ).rejects.toThrow("frontend_design aborted: explicit material source missing.html failed during read")

        expect(analyzeCalled).toBe(false)
        const abortEntries = createDecisionLog(taskID).readByPhase("frontend_design")
        expect(abortEntries.some((entry) => entry.key === "abort_materialization_failed")).toBe(true)
        expect(
          Database.use((db) =>
            db
              .select()
              .from(EngineArtifactTable)
              .where(
                and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "design_resource_manifest")),
              )
              .all(),
          ),
        ).toHaveLength(0)
      },
    })
  })

  test("frontend_design no longer materializes live URLs through one-shot URL screenshots", async () => {
    const source = await fs.readFile(path.resolve(import.meta.dir, "../../src/orchestrator/tools.ts"), "utf8")

    expect(source).toContain("ensureLiveWebpageEvidence")
    expect(source).toContain("frontend_design dispatch: preparing live webpage evidence")
    expect(source).not.toContain("captureReferenceManifest")
    expect(source).not.toContain("source: \"url-screenshot\"")
    expect(source).not.toContain("frontend_design dispatch: capturing URL screenshot")
  })

  test("frontend_design rejects material paths that only share the project root prefix", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_frontend_design_material_escape_${stamp}`
    const goalID = `gol_frontend_design_material_escape_${stamp}`
    const outsideDir = `${tmp.path}-outside`
    const outsideFile = path.join(outsideDir, "reference.html")
    let analyzeCalled = false

    await fs.mkdir(outsideDir, { recursive: true })
    await fs.writeFile(outsideFile, "<!doctype html><html><body>outside</body></html>", "utf8")
    designAnalyzeImpl = async () => {
      analyzeCalled = true
      return minimalFrontendDesignResult({ sessionID: "ses_should_not_start" })
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "frontend design material escape" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Frontend design material escape",
          taskTitle: "Frontend design material escape",
          request: "Reject a material path outside the project root.",
          goalTitle: "Reject escaped material",
          goalSlug: "reject-escaped-material",
          objective: "Reject escaped material path before frontend design analysis.",
          now,
          insertProject: false,
        })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        await expect(
          tools.frontend_design.execute(
            {
              reason: "Material paths must not escape the project root.",
              materials: [outsideFile],
            },
            buildToolOptions("frontend_design_material_escape"),
          ),
        ).rejects.toThrow("failed during path")

        expect(analyzeCalled).toBe(false)
        const abortEntries = createDecisionLog(taskID).readByPhase("frontend_design")
        const abortFailures = abortEntries.filter((entry) => entry.key === "abort_materialization_failed")
        expect(abortFailures).toHaveLength(1)
        expect(abortFailures[0]?.value).toContain("resolved path escapes project root")
        expect(
          Database.use((db) =>
            db
              .select()
              .from(EngineArtifactTable)
              .where(
                and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "design_resource_manifest")),
              )
              .all(),
          ),
        ).toHaveLength(0)
      },
    })
  })

  test("frontend innovate expert squad runs visible skill selection through design, build drafts, visual QA, and integrity", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const home = process.env.OPENCORVUS_TEST_HOME
    process.env.OPENCORVUS_TEST_HOME = tmp.path
    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_frontend_innovate_flow_${stamp}`
    const specID = `spec_frontend_innovate_flow_${stamp}`
    const consoleDraftGoalID = `gol_console_draft_${stamp}`
    const editorialDraftGoalID = `gol_editorial_draft_${stamp}`
    const selectedImplementationGoalID = `gol_selected_impl_${stamp}`
    const sourceURL = "https://example.com/frontend-innovate-product"
    const buildSessions: string[] = []
    let frontendResearchInput: any
    let visualQaInput: any
    let integrityInput: any

    await fs.writeFile(
      path.join(tmp.path, "reference.html"),
      [
        "<!doctype html>",
        "<html><body>",
        "<main class='terminal-desk'>",
        "<h1>Enterprise market command center</h1>",
        "<section data-density='high'>Positions, alerts, allocation, and compliance evidence.</section>",
        "</main>",
        "</body></html>",
      ].join(""),
      "utf8",
    )

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const parent = await Session.create({ kind: "root", title: "frontend innovate flow root" })
          insertWorkflowTaskWithGoal({
            projectID: Instance.project.id,
            taskID,
            goalID: consoleDraftGoalID,
            specID,
            sessionID: parent.id,
            worktree: tmp.path,
            projectName: "Frontend innovate flow",
            taskTitle: "Frontend innovate flow",
            request:
              "Create a Frontend Innovate expert squad flow to redesign an existing enterprise market webpage from aesthetic, professional, and convenient perspectives using source-page investigation and HTML material. The operator explicitly asks for multiple Build brainstorm drafts.",
            goalTitle: "Build operator console draft",
            goalSlug: "build-operator-console-draft",
            objective: "Build the bounded operator-console design direction draft from the Frontend Design handoff.",
            now,
            requirementIDs: ["REQ-frontend-innovate"],
            insertProject: false,
          })
          Database.use((db) => {
            insertRequirements(db, {
              taskID,
              specSnapshotID: specID,
              now,
              requirements: [
                {
                  id: "REQ-frontend-innovate",
                  title: "Frontend Innovate product surface",
                  description:
                    "The enterprise webpage redesign must be implemented from manifest-backed design directions and rejected generic traits review.",
                  acceptance: [
                    "Frontend Design records user-task audit, directions, selected direction, and rejected generic traits review.",
                    "Build drafts and selected implementation are verified with screenshot, keyboard/focus, accessibility, and state evidence before Visual QA and Integrity.",
                  ],
                  evidence_refs: ["design_resource_manifest"],
                  non_goals: [],
                  priority: "blocking",
                },
              ],
            })
            for (const [index, goal] of (
              [
                {
                  id: editorialDraftGoalID,
                  title: "Build editorial dashboard draft",
                  slug: "build-editorial-dashboard-draft",
                  objective:
                    "Build the bounded editorial-dashboard design direction draft from the Frontend Design handoff.",
                  owned: "src/editorial-dashboard-draft.tsx",
                },
                {
                  id: selectedImplementationGoalID,
                  title: "Implement selected operator console",
                  slug: "implement-selected-operator-console",
                  objective:
                    "Implement the selected direction-operator-console product design as the final webpage surface.",
                  owned: "src/selected-operator-console.tsx",
                },
              ] as const
            ).entries()) {
              db.insert(EngineGoalTable)
                .values({
                  id: goal.id,
                  task_id: taskID,
                  spec_snapshot_id: specID,
                  title: goal.title,
                  slug: goal.slug,
                  objective: goal.objective,
                  acceptance_specs: [],
                  owned_paths: [goal.owned],
                  depends_on: [],
                  exports: [],
                  imports: [],
                  kind: "feature",
                  requirement_ids: ["REQ-frontend-innovate"],
                  priority: "blocking",
                  source: "test",
                  status: "pending",
                  order_index: index + 1,
                  time_created: now,
                  time_updated: now,
                })
                .run()
            }
          })

          const orchestrator = await Agent.get("orchestrator")
          expect(orchestrator).toBeDefined()
          const skillTool = await SkillTool.init({ agent: orchestrator })
          const skillContext = {
            sessionID: parent.id,
            messageID: `msg_skill_${stamp}`,
            callID: `cal_skill_${stamp}`,
            agent: "orchestrator",
            abort: new AbortController().signal,
            messages: [],
            metadata: () => {},
            ask: async () => {},
          } as any
          const skillSearch = await skillTool.execute({ query: "frontend innovate expert squad" }, skillContext)
          expect(skillSearch.output).toContain("<name>frontend-innovate-expert-squad</name>")
          const skillLoad = await skillTool.execute({ name: "frontend-innovate-expert-squad" }, skillContext)
          expect(skillLoad.output).toContain('<skill_content name="frontend-innovate-expert-squad">')
          expect(skillLoad.output).toContain('profile_id: "frontend-innovate"')
          expect(skillLoad.output).toContain("multiple Build brainstorm drafts")
          expect(skillLoad.output).toContain("Design Philosophy Contract")
          expect(skillLoad.output).toContain("Existing URL Redesign Flow")
          expect(skillLoad.output).toContain("Web Content Accessibility Guidelines")

          frontendResearchRunImpl = async (input: any) => {
            frontendResearchInput = input
            const researchSession = await Session.create({
              kind: "frontend-research",
              parentID: parent.id,
              title: "frontend innovate source investigation",
            })
            input.onSessionCreated?.(researchSession.id)
            return {
              sessionID: researchSession.id,
              brief: {
                ...minimalFrontendResearchBrief({
                  taskID,
                  sessionID: researchSession.id,
                  sourceURL,
                  request: input.request,
                }),
                summary:
                  "Frontend Innovate source page investigation identified enterprise command center information architecture, primary task friction, and accessibility risks.",
              },
            }
          }

          designAnalyzeImpl = async (input) => {
            expect(input.parentSessionID).toBe(parent.id)
            expect(input.requireFrontendInnovateContract).toBe(true)
            expect(input.designResourceManifest?.entries).toHaveLength(1)
            expect(input.designResourceManifest.entries[0]).toMatchObject({
              kind: "html",
              origin: "material",
              mime: "text/html",
              region: "reference.html",
            })
            expect(input.attachments).toHaveLength(1)
            expect(input.attachments[0]).toMatchObject({
              label: "reference.html",
              mime: "text/html",
              source: "material",
              intent: "visual_reference",
            })
            return {
              specs: [],
              designSystem: "Enterprise market command system",
              techStack: ["React", "CSS modules", "local data fixtures"],
              frontendTemplate:
                "Implement direction-operator-console: redesign the existing enterprise market command center around the primary monitor-risk-allocate path with audit-ready panels and source-backed HTML material.",
              finalAcceptanceMode: "maintainable_replacement_required",
              fillableModules: "market overview, risk queue, allocation grid, compliance trail",
              componentInventory: "MarketShell, AllocationGrid, RiskQueue, AuditTimeline",
              componentReusePlan: [
                {
                  family_id: "market-shell",
                  name: "Market shell",
                  observed_surface: "reference.html command center",
                  source_refs: ["reference.html", "design_resource_manifest"],
                  implementation_strategy: "project_specific_component",
                  reuse_source: "src/components/MarketShell.tsx",
                  mature_library_candidates: [],
                  props_states: "default, alert, loading",
                  replacement_boundary: "page shell",
                  parity_guard: "Visual QA screenshot inspection",
                },
              ],
              baselineReplacementPlan: [],
              implementationPhaseOutcomes: [],
              qualityProjectContract:
                "Selected direction direction-operator-console must ship as semantic enterprise product UI with visible task hierarchy, keyboard/focus states, and screenshot proof, not generic cards.",
              materialInventory: "design_resource_manifest includes reference.html as the source HTML design material.",
              frontendProject: {
                status: "not_created",
                role: "implementation_target",
                project_root: "packages/overlay",
                source_package: "",
                entrypoints: ["src/selected-operator-console.tsx"],
                generation_tool: "frontend-innovate",
                notes: ["Build implements selected direction after draft evidence."],
              },
              visualConsistencyContract:
                "Selected design direction direction-operator-console wins; reject generic card-heavy dashboards.",
              uiDataContract:
                "Use local fixture rows for positions, alerts, allocation, and compliance events, including loading, empty, and error states.",
              templateIterationNotes: [
                "Audited the existing URL by primary user task, information architecture, visual hierarchy, state coverage, and accessibility risk before comparing directions.",
                "Selected operator-console after rejected-traits review of generic card layouts that weakened the monitor-risk-allocate workflow.",
              ],
              completenessReview:
                "Frontend Innovate handoff is complete: existing URL task audit, two directions, selected direction, rejected generic traits review, accessibility expectations, and manifest-backed HTML material.",
              referenceArtifacts: ["reference.html", "design_resource_manifest"],
              openQuestions: [],
              report: {
                summary: "Selected direction-operator-console for enterprise market command center.",
                detail: [
                  "## Design Directions",
                  "- direction-operator-console: dense command surface for repeated enterprise market work.",
                  "- direction-editorial-dashboard: narrative overview rejected for lower operational density.",
                  "## Selected Design Direction",
                  "direction-operator-console",
                  "## Rejected Generic Traits Review",
                  "- anti-slop-generic-cards: rejected generic card-heavy SaaS layout.",
                  "## Existing URL Redesign Evidence",
                  "- primary_path: monitor risk, allocate exposure, verify compliance trail.",
                  "- accessibility: keyboard focus, visible status, and error recovery must be verified.",
                  "## Design Resource Manifest",
                  "design_resource_manifest includes reference.html.",
                ].join("\n"),
              },
              sessionID: `ses_frontend_design_innovate_${stamp}`,
            }
          }

          buildAgentRunImpl = async (input: any) => {
            const sessionID = `ses_frontend_innovate_build_${buildSessions.length + 1}_${stamp}`
            buildSessions.push(sessionID)
            expect(input.context?.frontendDesign).toContain("direction-operator-console")
            expect(input.context?.frontendDesign).toContain("design_resource_manifest")
            await markBuildSlotAcquired(input, sessionID)
            const targetID = input.target?.id ?? "task"
            const changedPath =
              targetID === editorialDraftGoalID
                ? "src/editorial-dashboard-draft.tsx"
                : targetID === selectedImplementationGoalID
                  ? "src/selected-operator-console.tsx"
                  : "src/operator-console-draft.tsx"
            return {
              result: {
                status: "passed",
                summary: `Build ${targetID} implemented from direction-operator-console handoff evidence.`,
                files_changed: [
                  {
                    path: changedPath,
                    summary: "Implemented frontend innovate surface.",
                    reason: "Required by the selected or draft design direction.",
                  },
                ],
                tests: [
                  {
                    name: `render verification for ${targetID}`,
                    passed: true,
                    detail:
                      "mocked rendered screenshot, keyboard/focus path, loading/empty/error states, and accessibility verification passed",
                  },
                ],
                commit_ref: `abc${buildSessions.length}${stamp.slice(-4)}`,
              },
              sessionID,
              worktreeDir: input.managedWorktree.directory,
              worktreeBranch: input.managedWorktree.branch,
              worktreeBaseRef: input.managedWorktree.baseRef,
              mergeBackStatus: "not_invoked",
              actualChangedFiles: [
                {
                  path: changedPath,
                  status: "modified",
                  additions: 12,
                  deletions: 1,
                },
              ],
            }
          }

          visualQaAnalyzeImpl = async (input: any) => {
            visualQaInput = input
            const child = await Session.create({
              kind: "visual-qa",
              parentID: parent.id,
              title: "frontend innovate visual qa",
            })
            input.onSessionCreated?.(child.id)
            expect(input.frontendDesign).toContain("direction-operator-console")
            expect(input.frontendDesign).toContain("design_resource_manifest")
            return {
              sessionID: child.id,
              report: {
                ...minimalVisualQaReport(),
                summary: "Frontend Innovate selected implementation passed visual QA.",
                evidence: [
                  {
                    check_ids: ["check-main-surface"],
                    type: "screenshot" as const,
                    ref: "browser-preview:frontend-innovate-selected",
                    viewport: { width: 1280, height: 720 },
                    state: "default",
                    note: "Selected direction rendered the monitor-risk-allocate path with clear hierarchy, keyboard focus, and non-generic component structure.",
                  },
                  {
                    check_ids: ["check-main-surface"],
                    type: "other" as const,
                    ref: "browser-preview:frontend-innovate-keyboard-path",
                    viewport: { width: 1280, height: 720 },
                    state: "keyboard-focus",
                    note: "Keyboard path reached the risk queue, allocation grid, and compliance trail without hidden controls.",
                  },
                ],
              },
              acceptance: {
                submittedAccepted: true,
                effectiveAccepted: true,
                selfReportIssues: [],
                blockingIssues: [],
              },
            }
          }

          computeRequirementStatusSnapshotImpl = () => [
            {
              requirementID: "REQ-frontend-innovate",
              claimingGoals: [
                { goalID: consoleDraftGoalID, runStatus: "completed" },
                { goalID: editorialDraftGoalID, runStatus: "completed" },
                { goalID: selectedImplementationGoalID, runStatus: "completed" },
              ],
            },
          ]
          reviewIntegrityImpl = async (input: any) => {
            integrityInput = input
            expect(input.frontendDesign).toContain("direction-operator-console")
            expect(input.frontendDesign).toContain("anti-slop-generic-cards")
            expect(input.frontendDesign).toContain("Existing URL Redesign Evidence")
            expect(input.frontendDesign).toContain("keyboard focus")
            expect(input.visualQa).toContain("Visual QA Implementation Defect Context")
            expect(input.visualQa).toContain("report summary")
            expect(input.visualQa).toContain("This is not a visual acceptance verdict.")
            expect(input.visualQa).not.toContain("Frontend Innovate selected implementation passed visual QA.")
            expect(input.visualQa).not.toContain("effective_accepted=true")
            expect(input.visualQa).not.toContain("reference_comparison_evidence")
            expect(input.visualQa).not.toContain("visual_feedback_verification")
            expect(JSON.stringify(input.replayContext)).toContain(selectedImplementationGoalID)
            return integrityTeamResult({
              sessionID: `ses_integrity_frontend_innovate_${stamp}`,
              verdict: "pass",
              summary: "Frontend Innovate design, build, Visual QA, and Integrity evidence passed.",
            })
          }

          const { tools } = createOrchestratorTools({
            taskID,
            agentSessionID: parent.id,
            signal: new AbortController().signal,
          })

          const selected = await tools.select_expert_squad.execute(
            {
              profile_id: "frontend-innovate",
              reason:
                "The task requires existing URL redesign from aesthetic/professional/convenient goals, HTML material, accessibility expectations, and multiple Build drafts.",
            },
            buildToolOptions("frontend_innovate_select"),
          )
          expect(toolText(selected)).toContain("- active: frontend-innovate")
          expect((await Session.get(parent.id)).metadata?.configOverlay).toMatchObject({
            prompt_profile: { active: "frontend-innovate" },
          })

          const researchResult = await tools.frontend_research.execute(
            {
              reason: "Investigate the source page before design convergence.",
              source_urls: [sourceURL],
              focus:
                "Enterprise command center information architecture, primary task convenience, visual hierarchy, accessibility risks, interaction states, and evidence gaps.",
            },
            buildToolOptions("frontend_innovate_research"),
          )
          expect(toolText(researchResult)).toContain("Frontend research brief persisted")
          expect(frontendResearchInput.sourceUrls).toEqual([sourceURL])
          expect(frontendResearchInput.focus).toContain("Enterprise command center information architecture")
          expect(frontendResearchInput.focus).toContain("primary task convenience")
          expect(
            Database.use((db) =>
              db
                .select()
                .from(EngineArtifactTable)
                .where(
                  and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "frontend_research_brief")),
                )
                .all(),
            ),
          ).toHaveLength(1)

          const designResult = await tools.frontend_design.execute(
            {
              reason: "HTML material must become the Frontend Innovate design handoff.",
              materials: ["reference.html"],
            },
            buildToolOptions("frontend_innovate_design"),
          )
          expect(toolText(designResult)).toContain("SUCCESS")
          const task = Database.use((db) =>
            db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get(),
          )!
          expect((task.system_artifacts as any[]).some((item) => item.intent === "design_resource_manifest")).toBe(true)
          const manifests = Database.use((db) =>
            db
              .select()
              .from(EngineArtifactTable)
              .where(
                and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "design_resource_manifest")),
              )
              .all(),
          )
          expect(manifests).toHaveLength(1)
          expect((manifests[0]?.payload as any).entries.map((entry: any) => entry.kind)).toEqual(["html"])

          for (const goalID of [consoleDraftGoalID, editorialDraftGoalID, selectedImplementationGoalID]) {
            const buildResult = await tools.build.execute(
              {
                goalID,
                reason: "Frontend Innovate bounded Build draft or selected implementation.",
              },
              buildToolOptions(`frontend_innovate_build_${goalID}`),
            )
            expectGoalBuildStarted(buildResult)
            await waitForGoalStatus(goalID, "passed")
          }

          expect(buildSessions).toHaveLength(3)
          expect(new Set(buildSessions).size).toBe(3)
          for (const goalID of [consoleDraftGoalID, editorialDraftGoalID, selectedImplementationGoalID]) {
            expect(listGoalRunsByGoal(goalID)[0]?.status).toBe("completed")
          }
          const buildContracts = Database.use((db) =>
            db
              .select()
              .from(EngineArtifactTable)
              .where(
                and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "build_session_contract")),
              )
              .all(),
          )
          expect(buildContracts).toHaveLength(3)

          const visualResult = await tools.visual_qa.execute(
            {
              reason: "Review the selected Frontend Innovate implementation.",
              focus: "Selected operator console direction",
              app_url: "http://127.0.0.1:5173",
              preview_command: "npm run dev",
            },
            buildToolOptions("frontend_innovate_visual_qa"),
          )
          expect(toolText(visualResult)).toContain("visual_qa complete: effective_accepted=true")
          expect(visualQaInput.frontendDesign).toContain("direction-operator-console")
          expect(
            createDecisionLog(taskID)
              .readByPhase("visual_qa")
              .some((entry) => entry.key === "latest_summary"),
          ).toBe(true)

          const integrityResult = await tools.integrity.execute(
            { reason: "Final Frontend Innovate chain review." },
            buildToolOptions("frontend_innovate_integrity"),
          )
          expect(toolText(integrityResult)).toContain("integrity_attempt_id")
          expect(integrityInput.frontendDesign).toContain("anti-slop-generic-cards")
          expect(
            findLatestIntegrityAttemptArtifact({
              taskID,
              specSnapshotID: specID,
              phase: "post_build",
            })?.artifactID,
          ).toBeTruthy()
        },
      })
    } finally {
      if (home === undefined) delete process.env.OPENCORVUS_TEST_HOME
      else process.env.OPENCORVUS_TEST_HOME = home
    }
  }, 30000)

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

  test("goal build treats dependency no-project-diff outcome as unfinished", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_build_dep_nodiff_${stamp}`
    const taskID = `tsk_build_dep_nodiff_${stamp}`
    const parentGoalID = `gol_dep_nodiff_parent_${stamp}`
    const childGoalID = `gol_dep_nodiff_child_${stamp}`
    const specID = `spec_dep_nodiff_${stamp}`

    insertWorkflowTaskWithGoal({
      projectID,
      taskID,
      goalID: parentGoalID,
      sessionID: null,
      worktree: tmp.path,
      projectName: "No diff dependency guard project",
      taskTitle: "No diff dependency guard task",
      request: "Build dependent goals only after dependencies delivered real files.",
      goalTitle: "Shared source registry",
      goalSlug: "shared-source-registry",
      objective: "Provide shared source registry files for child goals.",
      now,
      specID,
    })
    Database.use((db) => {
      db.insert(EngineGoalTable)
        .values({
          id: childGoalID,
          task_id: taskID,
          spec_snapshot_id: specID,
          title: "Dependent source region",
          slug: "dependent-source-region",
          objective: "Consume delivered registry files.",
          acceptance_specs: [],
          owned_paths: ["src/region.ts"],
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
    const parentGoalRunID = beginBuildAttempt({
      taskID,
      goalID: parentGoalID,
      sessionID: "ses_build_dep_nodiff_parent",
      workspaceDir: tmp.path,
      workspaceBranch: "opencorvus/no-diff-parent",
      workspaceBaseRef: "base123",
      now,
    })
    EnginePersist.finalizeBuildAttempt({
      goalRunID: parentGoalRunID,
      taskID,
      goalID: parentGoalID,
      status: "completed",
      commitRef: "abc1234",
      workspaceDir: tmp.path,
      workspaceBranch: "opencorvus/no-diff-parent",
      workspaceBaseRef: "base123",
      summary: "Build reported success but host diff was empty.",
      diffs: [],
      now: now + 1,
    })
    expect(goalStatusByID(parentGoalID)).toBe("passed")

    let buildStarted = false
    buildAgentRunImpl = async () => {
      buildStarted = true
      return { status: "passed", summary: "should not run", files_changed: ["src/region.ts"], tests: [] }
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "no diff dependency guard test" })
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
        })

        const result = await tools.build.execute(
          {
            goalID: childGoalID,
            reason: "dependency was falsely projected as delivered",
          },
          buildToolOptions(),
        )

        const resultText = toolText(result)
        expect(resultText).toContain("blocked by unfinished dependencies")
        expect(resultText).toContain(`${parentGoalID}=no_project_diff(actual_changed_files_empty; status=passed)`)
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
        const architectSessionsForThisDispatch = Database.use((db) =>
          db
            .select()
            .from(SessionTable)
            .where(and(eq(SessionTable.kind, "architect"), eq(SessionTable.parent_id, parent.id)))
            .all(),
        )
        expect(architectSessionsForThisDispatch).toHaveLength(0)
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

  test("artifact export failures are post-acceptance feedback instead of task lifecycle decisions", async () => {
    const source = await fs.readFile(path.join(import.meta.dir, "../../src/orchestrator/tools.ts"), "utf8")

    expect(source).toContain("publishArtifactExportResult")
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
                summary: "Consumer runs after the feature goal so it can wire the feature output.",
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

  test("goal build session contract records generic evidence without a dispatch manifest", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_goal_input_evidence_${stamp}`
    const goalID = `gol_goal_input_evidence_${stamp}`
    const buildSessionID = `ses_goal_input_evidence_${stamp}`
    let capturedInput: any

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "goal input evidence contract test" })
        const targetRef = await AttachmentStore.write(
          Instance.project.id,
          Buffer.from(minimalPngBytes()),
          "image/png",
          "goal-input-reference.png",
        )
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Goal input evidence contract test",
          taskTitle: "Goal input evidence contract task",
          request: "Build a goal with task-owned visual evidence.",
          goalTitle: "Input evidence goal",
          goalSlug: "input-evidence-goal",
          objective: "Use task-owned visual evidence for this goal build.",
          now,
          insertProject: false,
        })
        Database.use((db) =>
          db
            .update(EngineTaskTable)
            .set({
              attachments: [{ ...targetRef, intent: "visual_reference", source: "task-attachment" }],
            } as any)
            .where(eq(EngineTaskTable.id, taskID))
            .run(),
        )

        buildAgentRunImpl = async (input: any) => {
          capturedInput = input
          await markBuildSlotAcquired(input, buildSessionID)
          return {
            result: {
              status: "passed",
              summary: "Goal consumed task-owned evidence.",
              files_changed: [
                {
                  path: "src/index.ts",
                  summary: "Used visual evidence.",
                  reason: "Evidence pack was present.",
                },
              ],
              tests: [],
              commit_ref: "inputevidence1",
            },
            sessionID: buildSessionID,
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
            reason: "Verify Build input evidence contract persistence.",
          },
          buildToolOptions("goal_input_evidence"),
        )

        expectGoalBuildStarted(result)
        await waitForGoalStatus(goalID, "passed")
        expect(capturedInput.context.inputEvidenceManifest).toBeUndefined()
        expect(capturedInput.context.evidencePack.targetReferences).toHaveLength(1)
        expect(capturedInput.context.evidencePack.targetReferences[0]).toMatchObject({
          url: targetRef.url,
          sha: targetRef.sha,
          mime: targetRef.mime,
          size: targetRef.size,
          intent: "visual_reference",
          source: "task-attachment",
        })
        const contractArtifact = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "build_session_contract")))
            .get(),
        )
        const payload = contractArtifact?.payload as any
        expect(payload.input_evidence).toBeNull()
      },
    })
  }, 15000)

  test("direct build forwards foreign input evidence to BuildAgent", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })
    await using foreignTmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_direct_foreign_input_evidence_${stamp}`
    const goalID = `gol_direct_foreign_input_evidence_${stamp}`
    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    let foreignRef: AttachmentStore.Reference | undefined
    let buildCalls = 0

    await Instance.provide({
      directory: foreignTmp.path,
      fn: async () => {
        foreignRef = await AttachmentStore.write(
          Instance.project.id,
          Buffer.from(minimalPngBytes()),
          "image/png",
          "foreign-input-reference.png",
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        if (!foreignRef) throw new Error("foreign reference was not created")
        const parent = await Session.create({ kind: "root", title: "direct foreign input evidence test" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Direct foreign input evidence test",
          taskTitle: "Direct foreign input evidence task",
          request: "Direct build should forward foreign visual evidence to Build.",
          goalTitle: "Foreign input evidence forwarding",
          goalSlug: "foreign-input-evidence-forwarding",
          objective: "Forward evidence from another project to BuildAgent.run without a dispatch gate.",
          now,
          insertProject: false,
        })
        Database.use((db) =>
          db
            .update(EngineTaskTable)
            .set({
              attachments: [{ ...foreignRef, intent: "visual_reference", source: "task-attachment" }],
            } as any)
            .where(eq(EngineTaskTable.id, taskID))
            .run(),
        )
        let capturedInput: any
        buildAgentRunImpl = async (input: any) => {
          buildCalls += 1
          capturedInput = input
          await markBuildSlotAcquired(input, `ses_direct_foreign_input_evidence_${stamp}`)
          return {
            result: {
              status: "failed",
              summary: "Build execution observed a foreign evidence reference.",
              files_changed: [],
              tests: [],
              error: "foreign evidence reaches the Build boundary",
            },
            sessionID: `ses_direct_foreign_input_evidence_${stamp}`,
            worktreeDir: input.workDir ?? input.managedWorktree?.directory ?? Instance.directory,
            worktreeBranch: input.managedWorktree?.branch,
            worktreeBaseRef: input.managedWorktree?.baseRef,
          }
        }

        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
          workflow: pipeline,
          workflowState: createWorkflowState(pipeline),
        })

        const result = await tools.build.execute(
          {
            request: "Repair implementation using task evidence.",
            reason: "Validate direct build input evidence owner.",
            directBuildIntent: "modify_files",
          },
          buildToolOptions("direct_foreign_input_evidence"),
        )

        expect(toolText(result)).toContain("Build agent finished (status=failed")
        expect(buildCalls).toBe(1)
        expect(capturedInput.context.inputEvidenceManifest).toBeUndefined()
        expect(capturedInput.context.evidencePack.targetReferences).toHaveLength(1)
        expect(capturedInput.context.evidencePack.targetReferences[0]).toMatchObject({
          url: foreignRef.url,
          sha: foreignRef.sha,
          mime: foreignRef.mime,
          size: foreignRef.size,
          intent: "visual_reference",
          source: "task-attachment",
        })
      },
    })
  }, 15000)

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
          db.update(EngineGoalTable)
            .set({
              depends_on: [siblingGoalID],
            })
            .where(eq(EngineGoalTable.id, goalID))
            .run()
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
        const siblingRunID = beginBuildAttempt({
          taskID,
          goalID: siblingGoalID,
          sessionID: `ses_arch_sibling_${stamp}`,
          now: now + 10,
        })
        updateGoalRun(siblingRunID, { status: "completed", time_completed: now + 11 })
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
                  reason: "Prior review feedback is context, not a dispatch decision.",
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
    installControlModel()
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true, config: { model: "mock-control/control" } })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_retry_default_${stamp}`
    const taskID = `tsk_retry_default_${stamp}`
    const goalID = `gol_retry_default_${stamp}`
    const priorSessionID = `ses_prior_retry_default_${stamp}`
    let observedExistingSessionID: unknown
    let observedRetryFeedback: unknown
    let originalRefUrl = ""
    let currentRefUrl = ""

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
          objective: "Verify build retries keep the prior session",
          now,
          insertProject: false,
        })
        const originalRef = await AttachmentStore.write(
          Instance.project.id,
          Buffer.from(minimalPngBytes()),
          "image/png",
          "original-retry-reference.png",
        )
        const currentRef = await AttachmentStore.write(
          Instance.project.id,
          Buffer.concat([Buffer.from(minimalPngBytes()), Buffer.from("current")]),
          "image/png",
          "current-retry-reference.png",
        )
        originalRefUrl = originalRef.url
        currentRefUrl = currentRef.url
        Database.use((db) =>
          db
            .update(EngineTaskTable)
            .set({
              attachments: [{ ...currentRef, intent: "visual_reference", source: "current-task-attachment" }],
            } as any)
            .where(eq(EngineTaskTable.id, taskID))
            .run(),
        )
        await Session.createNext({
          id: priorSessionID,
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "Prior retry build session",
          directory: tmp.path,
        })
        const originalManifest = await composeBuildInputEvidenceManifest({
          projectID: Instance.project.id,
          taskID,
          goalID,
          sessionID: priorSessionID,
          evidencePack: {
            targetReferences: [{ ...originalRef, intent: "visual_reference", source: "original-contract" }],
          },
        })
        Database.use((db) =>
          db
            .insert(EngineArtifactTable)
            .values({
              id: Identifier.ascending("artifact"),
              task_id: taskID,
              run_id: null,
              goal_run_id: null,
              kind: "build_session_contract",
              label: "build-session-contract",
              payload: {
                session_id: priorSessionID,
                task_id: taskID,
                goal_id: goalID,
                goal_run_id: null,
                input_evidence: originalManifest,
                digest: "original-contract",
              },
              time_created: now + 5,
              time_updated: now + 5,
            })
            .run(),
        )
        const priorGoalRunID = seedTerminalFailedBuildRun({
          taskID,
          goalID,
          sessionID: priorSessionID,
          workspaceDir: tmp.path,
          now: now + 10,
        })
        createDecisionLog(taskID).append({
          phase: "retry",
          goalID,
          key: `build_retry_previous_${priorGoalRunID}`,
          value: "Terminal error: exact retry failure from persisted facts",
          reason: "AUDIT_REASON_SHOULD_NOT_ENTER_BUILD_PROMPT",
        })
        createDecisionLog(taskID).append({
          phase: "retry",
          goalID,
          key: `build_retry_previous_${priorGoalRunID}`,
          value: `Previous goal_run ${priorGoalRunID} terminal error (status=failed): exact retry failure from persisted facts`,
          reason: "clarified retry fact",
        })

        const createNextSpy = spyOn(Session, "createNext")
        buildAgentRunImpl = async (input: any) => {
          observedExistingSessionID = input.existingSessionID
          observedRetryFeedback = input.context?.retryFeedback
          expect(input.context?.inputEvidenceManifest).toBeUndefined()
          expect(JSON.stringify(input.context?.evidencePack)).toContain(currentRefUrl)
          expect(JSON.stringify(input.context?.evidencePack)).not.toContain(originalRefUrl)
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
            request: "Retry the failed goal with fresh context wording in the operator text.",
            reason: "Operator text mentions fresh context, but the prior build session is resumable.",
          },
          buildToolOptions(),
        )

        expectGoalBuildStarted(result)
        await waitForGoalStatus(goalID, "failed")
        expect(observedExistingSessionID).toBe(priorSessionID)
        expect(observedRetryFeedback).toBe(
          `Previous goal_run ${priorGoalRunID} terminal error (status=failed): exact retry failure from persisted facts`,
        )
        expect(String(observedRetryFeedback)).not.toContain("AUDIT_REASON_SHOULD_NOT_ENTER_BUILD_PROMPT")
        expect(String(observedRetryFeedback)).not.toContain("Terminal error:")
        expect(createNextSpy).not.toHaveBeenCalled()
        const contracts = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "build_session_contract")))
            .all(),
        )
        const retryContract = contracts.at(-1)?.payload as any
        const originalContract = contracts[0]?.payload as any
        expect(JSON.stringify(originalContract?.input_evidence)).toContain(originalRefUrl)
        expect(retryContract?.session_id).toBe(priorSessionID)
        expect(retryContract?.input_evidence).toBeNull()
      },
    })
  }, 30_000)

  test("goal build retry opens a fresh session on the same worktree when prior replay pressure is too high", async () => {
    installControlModel()
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({
      git: true,
      config: {
        model: "mock-control/control",
        agent: { build: { retry_replay_token_limit: 1_000 } },
      },
    })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_retry_replay_pressure_${stamp}`
    const taskID = `tsk_retry_replay_pressure_${stamp}`
    const goalID = `gol_retry_replay_pressure_${stamp}`
    const priorSessionID = `ses_prior_replay_pressure_${stamp}`
    const freshSessionID = `ses_fresh_replay_pressure_${stamp}`
    let observedExistingSessionID: unknown = "not-observed"
    let observedWorktreeDir = ""
    let observedRetryFeedback = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "fresh retry replay pressure test" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Fresh retry replay pressure test",
          taskTitle: "Fresh retry replay pressure task",
          request: "Retry a failed goal after the prior build session became expensive to replay",
          goalTitle: "Fresh retry after replay pressure",
          goalSlug: "fresh-retry-replay-pressure",
          objective: "Verify replay pressure opens fresh context on the same worktree",
          now,
          insertProject: false,
        })
        await Session.createNext({
          id: priorSessionID,
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "Prior expensive build session",
          directory: tmp.path,
        })
        const priorGoalRunID = seedTerminalFailedBuildRun({
          taskID,
          goalID,
          sessionID: priorSessionID,
          workspaceDir: tmp.path,
          now: now + 10,
        })
        await seedLatestAssistantUsage({
          sessionID: priorSessionID,
          now: now + 20,
          inputTokens: 1_500,
        })
        createDecisionLog(taskID).append({
          phase: "retry",
          goalID,
          key: `build_retry_previous_${priorGoalRunID}`,
          value: "Terminal error: exact replay-pressure failure from persisted facts",
          reason: "replay_pressure_audit",
        })

        buildAgentRunImpl = async (input: any) => {
          observedExistingSessionID = input.existingSessionID
          observedWorktreeDir = input.managedWorktree.directory
          observedRetryFeedback = String(input.context?.retryFeedback ?? "")
          await markBuildSlotAcquired(input, freshSessionID)
          return {
            result: {
              status: "failed",
              summary: "Fresh retry used the preserved worktree after replay pressure.",
              files_changed: [],
              tests: [],
              error: "fresh retry still failed",
            },
            sessionID: freshSessionID,
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
            request: "Retry without replaying the oversized prior transcript.",
            reason: "Prior build session replay pressure is above the configured Build replay limit.",
          },
          buildToolOptions(),
        )

        expectGoalBuildStarted(result)
        await waitForGoalStatus(goalID, "failed")
        expect(observedExistingSessionID).toBeUndefined()
        expect(observedWorktreeDir).toBe(tmp.path)
        expect(observedRetryFeedback).toContain("Terminal error: exact replay-pressure failure from persisted facts")
        expect(observedRetryFeedback).not.toContain("prior_session_replay_pressure")
        expect(observedRetryFeedback).not.toContain("Build retry selected a fresh build session")
        expect(findGoalLatestWorkspace(goalID).directory).toBe(tmp.path)
        const latest = listGoalRunsByGoal(goalID).at(0)
        expect(latest?.session_id).toBe(freshSessionID)
        const decision = createDecisionLog(taskID).readByKey(`build_retry_fresh_session_${priorGoalRunID}`)
        expect(decision?.value).toContain("prior_session_replay_pressure")
        expect(decision?.value).toContain("estimate=1500")
        expect(decision?.value).toContain("limit=1000")
      },
    })
  }, 30_000)

  test("goal build retry opens a fresh session on the same worktree after prior context overflow", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_retry_context_overflow_${stamp}`
    const taskID = `tsk_retry_context_overflow_${stamp}`
    const goalID = `gol_retry_context_overflow_${stamp}`
    const priorSessionID = `ses_prior_context_overflow_${stamp}`
    const freshSessionID = `ses_fresh_context_overflow_${stamp}`
    let observedExistingSessionID: unknown = "not-observed"
    let observedWorktreeDir = ""
    let observedRetryFeedback = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "fresh retry context overflow test" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Fresh retry context overflow test",
          taskTitle: "Fresh retry context overflow task",
          request: "Retry a failed goal after the prior build session overflowed",
          goalTitle: "Fresh retry after context overflow",
          goalSlug: "fresh-retry-context-overflow",
          objective: "Verify typed context overflow opens fresh context on the same worktree",
          now,
          insertProject: false,
        })
        await Session.createNext({
          id: priorSessionID,
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "Prior overflowing build session",
          directory: tmp.path,
        })
        const priorGoalRunID = seedTerminalFailedBuildRun({
          taskID,
          goalID,
          sessionID: priorSessionID,
          workspaceDir: tmp.path,
          now: now + 10,
        })
        await seedLatestAssistantError({
          sessionID: priorSessionID,
          now: now + 20,
          error: new Message.ContextOverflowError({
            message: "Provider reported context overflow after structured compaction could not reduce the prompt.",
          }).toObject(),
        })
        createDecisionLog(taskID).append({
          phase: "retry",
          goalID,
          key: `build_retry_previous_${priorGoalRunID}`,
          value: "Terminal error: exact context overflow failure from persisted facts",
          reason: "context_overflow_audit",
        })

        buildAgentRunImpl = async (input: any) => {
          observedExistingSessionID = input.existingSessionID
          observedWorktreeDir = input.managedWorktree.directory
          observedRetryFeedback = String(input.context?.retryFeedback ?? "")
          await markBuildSlotAcquired(input, freshSessionID)
          return {
            result: {
              status: "failed",
              summary: "Fresh retry used the preserved worktree after context overflow.",
              files_changed: [],
              tests: [],
              error: "fresh retry still failed",
            },
            sessionID: freshSessionID,
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
            request: "Retry in a fresh context using the same worktree.",
            reason: "Prior build session hit context overflow.",
          },
          buildToolOptions(),
        )

        expectGoalBuildStarted(result)
        await waitForGoalStatus(goalID, "failed")
        expect(observedExistingSessionID).toBeUndefined()
        expect(observedWorktreeDir).toBe(tmp.path)
        expect(observedRetryFeedback).toContain("Terminal error: exact context overflow failure from persisted facts")
        expect(observedRetryFeedback).not.toContain("prior_latest_assistant_context_overflow")
        expect(observedRetryFeedback).not.toContain("Build retry selected a fresh build session")
        expect(findGoalLatestWorkspace(goalID).directory).toBe(tmp.path)
        const latest = listGoalRunsByGoal(goalID).at(0)
        expect(latest?.session_id).toBe(freshSessionID)
      },
    })
  })

  for (const compactionFailure of [
    {
      key: "compaction_aborted",
      label: "aborted compaction",
      error: () =>
        new Message.AbortedError({
          message: "external abort signal fired",
        }).toObject(),
      forbiddenReason: "prior_compaction_aborted",
    },
    {
      key: "compaction_structured_output",
      label: "compaction structured output miss",
      error: () =>
        new Message.StructuredOutputError({
          message: "Model did not produce structured output before the compaction turn ended.",
          retries: 0,
        }).toObject(),
      forbiddenReason: "prior_compaction_structured_output_missing",
    },
  ]) {
    test(`goal build retry opens a fresh session on the same worktree after ${compactionFailure.label}`, async () => {
      await tmp?.[Symbol.asyncDispose]?.()
      tmp = await tmpdir({ git: true })

      const now = Date.now()
      const stamp = `${now.toString(16)}_${compactionFailure.key}`
      const projectID = `project_retry_${stamp}`
      const taskID = `tsk_retry_${stamp}`
      const goalID = `gol_retry_${stamp}`
      const priorSessionID = `ses_prior_retry_${stamp}`
      const freshSessionID = `ses_fresh_retry_${stamp}`
      let observedExistingSessionID: unknown = "not-observed"
      let observedWorktreeDir = ""
      let observedRetryFeedback = ""

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const parent = await Session.create({ kind: "root", title: `${compactionFailure.label} retry test` })
          insertWorkflowTaskWithGoal({
            projectID: Instance.project.id,
            taskID,
            goalID,
            sessionID: parent.id,
            worktree: tmp.path,
            projectName: `${compactionFailure.label} retry test`,
            taskTitle: `${compactionFailure.label} retry task`,
            request: "Retry a failed goal after the prior build session compaction failed",
            goalTitle: "Fresh retry after compaction failure",
            goalSlug: "fresh-retry-compaction-failure",
            objective: "Verify compaction failure opens fresh context on the same worktree",
            now,
            insertProject: false,
          })
          await Session.createNext({
            id: priorSessionID,
            kind: "build",
            parentID: parent.id,
            goalID,
            title: "Prior build session with failed compaction",
            directory: tmp.path,
          })
          const priorGoalRunID = seedTerminalFailedBuildRun({
            taskID,
            goalID,
            sessionID: priorSessionID,
            workspaceDir: tmp.path,
            now: now + 10,
          })
          await seedLatestAssistantError({
            sessionID: priorSessionID,
            now: now + 20,
            agent: "compaction",
            error: compactionFailure.error(),
          })
          createDecisionLog(taskID).append({
            phase: "retry",
            goalID,
            key: `build_retry_previous_${priorGoalRunID}`,
            value: `Terminal error: exact ${compactionFailure.label} failure from persisted facts`,
            reason: `${compactionFailure.key}_audit_reason`,
          })

          buildAgentRunImpl = async (input: any) => {
            observedExistingSessionID = input.existingSessionID
            observedWorktreeDir = input.managedWorktree.directory
            observedRetryFeedback = String(input.context?.retryFeedback ?? "")
            await markBuildSlotAcquired(input, freshSessionID)
            return {
              result: {
                status: "failed",
                summary: "Fresh retry used the preserved worktree after compaction failure.",
                files_changed: [],
                tests: [],
                error: "fresh retry still failed",
              },
              sessionID: freshSessionID,
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
              request: "Retry in a fresh context using the same worktree.",
              reason: `Prior build session hit ${compactionFailure.label}.`,
            },
            buildToolOptions(),
          )

          expectGoalBuildStarted(result)
          await waitForGoalStatus(goalID, "failed")
          expect(observedExistingSessionID).toBeUndefined()
          expect(observedWorktreeDir).toBe(tmp.path)
          expect(observedRetryFeedback).toContain(`Terminal error: exact ${compactionFailure.label} failure`)
          expect(observedRetryFeedback).not.toContain(compactionFailure.forbiddenReason)
          expect(observedRetryFeedback).not.toContain("Build retry selected a fresh build session")
          expect(findGoalLatestWorkspace(goalID).directory).toBe(tmp.path)
          const latest = listGoalRunsByGoal(goalID).at(0)
          expect(latest?.session_id).toBe(freshSessionID)
        },
      })
    })
  }

  test("goal build retry opens a fresh session on the same worktree when prior session has pending compaction", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_retry_pending_compaction_${stamp}`
    const taskID = `tsk_retry_pending_compaction_${stamp}`
    const goalID = `gol_retry_pending_compaction_${stamp}`
    const priorSessionID = `ses_prior_pending_compaction_${stamp}`
    const freshSessionID = `ses_fresh_pending_compaction_${stamp}`
    let observedExistingSessionID: unknown = "not-observed"
    let observedWorktreeDir = ""
    let observedRetryFeedback = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "pending compaction retry test" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Pending compaction retry test",
          taskTitle: "Pending compaction retry task",
          request: "Retry a failed goal after the prior build session queued compaction",
          goalTitle: "Fresh retry after pending compaction",
          goalSlug: "fresh-retry-pending-compaction",
          objective: "Verify pending compaction opens fresh context on the same worktree",
          now,
          insertProject: false,
        })
        await Session.createNext({
          id: priorSessionID,
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "Prior build session with pending compaction",
          directory: tmp.path,
        })
        const priorGoalRunID = seedTerminalFailedBuildRun({
          taskID,
          goalID,
          sessionID: priorSessionID,
          workspaceDir: tmp.path,
          now: now + 10,
        })
        const sourceUserMessageID = `msg_pending_compaction_source_${stamp}`
        SessionControl.create({
          sessionID: priorSessionID,
          kind: "compaction_request",
          payload: { source_user_message_id: sourceUserMessageID, overflow: true },
        })
        createDecisionLog(taskID).append({
          phase: "retry",
          goalID,
          key: `build_retry_previous_${priorGoalRunID}`,
          value: "Terminal error: exact pending compaction failure from persisted facts",
          reason: "pending_compaction_audit_reason",
        })

        buildAgentRunImpl = async (input: any) => {
          observedExistingSessionID = input.existingSessionID
          observedWorktreeDir = input.managedWorktree.directory
          observedRetryFeedback = String(input.context?.retryFeedback ?? "")
          await markBuildSlotAcquired(input, freshSessionID)
          return {
            result: {
              status: "failed",
              summary: "Fresh retry used the preserved worktree after pending compaction.",
              files_changed: [],
              tests: [],
              error: "fresh retry still failed",
            },
            sessionID: freshSessionID,
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
            request: "Retry in a fresh context using the same worktree.",
            reason: "Prior build session has a pending compaction request.",
          },
          buildToolOptions(),
        )

        expectGoalBuildStarted(result)
        await waitForGoalStatus(goalID, "failed")
        expect(observedExistingSessionID).toBeUndefined()
        expect(observedWorktreeDir).toBe(tmp.path)
        expect(observedRetryFeedback).toContain("Terminal error: exact pending compaction failure")
        expect(observedRetryFeedback).not.toContain("prior_pending_compaction_request")
        expect(observedRetryFeedback).not.toContain(sourceUserMessageID)
        expect(observedRetryFeedback).not.toContain("Build retry selected a fresh build session")
        expect(findGoalLatestWorkspace(goalID).directory).toBe(tmp.path)
        const latest = listGoalRunsByGoal(goalID).at(0)
        expect(latest?.session_id).toBe(freshSessionID)
      },
    })
  })

  test("goal build retry opens a fresh session on the same worktree when the prior session is missing", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_retry_fresh_missing_${stamp}`
    const taskID = `tsk_retry_fresh_missing_${stamp}`
    const goalID = `gol_retry_fresh_missing_${stamp}`
    const priorSessionID = `ses_missing_retry_${stamp}`
    let observedExistingSessionID: unknown = "not-observed"
    let observedWorktreeDir = ""
    let observedRetryFeedback = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "fresh retry missing session test" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Fresh retry missing session test",
          taskTitle: "Fresh retry missing session task",
          request: "Retry a failed goal when the prior session row is gone",
          goalTitle: "Fresh retry same worktree",
          goalSlug: "fresh-retry-same-worktree",
          objective: "Verify build retry creates a fresh child session without switching worktrees",
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

        buildAgentRunImpl = async (input: any) => {
          observedExistingSessionID = input.existingSessionID
          observedWorktreeDir = input.managedWorktree.directory
          observedRetryFeedback = String(input.context?.retryFeedback ?? "")
          await markBuildSlotAcquired(input, `ses_fresh_retry_${stamp}`)
          return {
            result: {
              status: "failed",
              summary: "Fresh retry used the preserved worktree.",
              files_changed: [],
              tests: [],
              error: "fresh retry still failed",
            },
            sessionID: `ses_fresh_retry_${stamp}`,
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
            request: "Retry in a fresh context using the same worktree.",
            reason: "Prior session row is unavailable.",
          },
          buildToolOptions(),
        )

        expectGoalBuildStarted(result)
        await waitForGoalStatus(goalID, "failed")
        expect(observedExistingSessionID).toBeUndefined()
        expect(observedWorktreeDir).toBe(tmp.path)
        expect(observedRetryFeedback).not.toContain("Previous build session context unavailable")
        expect(observedRetryFeedback).not.toContain("prior_session_row_missing")
        expect(findGoalLatestWorkspace(goalID).directory).toBe(tmp.path)
      },
    })
  })

  test("external goal build retry opens a fresh session on the same worktree when provider resume ref is missing", async () => {
    await tmp?.[Symbol.asyncDispose]?.()
    tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_retry_fresh_external_${stamp}`
    const taskID = `tsk_retry_fresh_external_${stamp}`
    const goalID = `gol_retry_fresh_external_${stamp}`
    let observedExistingSessionID: unknown = "not-observed"
    let observedWorktreeDir = ""
    let observedRetryFeedback = ""

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "fresh retry external ref test" })
        const priorBuildSession = await Session.createNext({
          kind: "build",
          parentID: parent.id,
          goalID,
          title: "Prior external build",
          directory: tmp.path,
        })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Fresh retry external ref test",
          taskTitle: "Fresh retry external ref task",
          request: "Retry an external goal when the provider resume ref is missing",
          goalTitle: "Fresh external retry same worktree",
          goalSlug: "fresh-external-retry-same-worktree",
          objective: "Verify external build retry creates a fresh child session without switching worktrees",
          now,
          insertProject: false,
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ executor: "codex" }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        seedTerminalFailedBuildRun({
          taskID,
          goalID,
          sessionID: priorBuildSession.id,
          workspaceDir: tmp.path,
          now: now + 10,
        })

        buildAgentRunImpl = async (input: any) => {
          observedExistingSessionID = input.existingSessionID
          observedWorktreeDir = input.managedWorktree.directory
          observedRetryFeedback = String(input.context?.retryFeedback ?? "")
          await markBuildSlotAcquired(input, `ses_fresh_external_retry_${stamp}`)
          return {
            result: {
              status: "failed",
              summary: "Fresh external retry used the preserved worktree.",
              files_changed: [],
              tests: [],
              error: "fresh external retry still failed",
            },
            sessionID: `ses_fresh_external_retry_${stamp}`,
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
            request: "Retry in a fresh context using the same external worktree.",
            reason: "Provider-native resume ref is unavailable.",
          },
          buildToolOptions(),
        )

        expectGoalBuildStarted(result)
        await waitForGoalStatus(goalID, "failed")
        expect(observedExistingSessionID).toBeUndefined()
        expect(observedWorktreeDir).toBe(tmp.path)
        expect(observedRetryFeedback).not.toContain("Previous build session context unavailable")
        expect(observedRetryFeedback).not.toContain("prior_executor_ref_missing")
        expect(findGoalLatestWorkspace(goalID).directory).toBe(tmp.path)
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
          await waitForCondition("background goal build cleanup", () => {
            return findGoalLatestWorkspace(goalID).directory === null
          })
          expect(listGoalRunsByGoal(goalID)[0]?.session_id).toBe("ses_build_session_bind")
        },
      })
    },
    { timeout: ORCHESTRATOR_TOOLS_TEST_TIMEOUT_MS },
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

  test(
    "goal build rejects duplicate dispatch while live build ownership exists",
    async () => {
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
            request: "Reject duplicate goal dispatch while live ownership exists",
            goalTitle: "Duplicate live guard",
            goalSlug: "duplicate-live-guard",
            objective: "Ensure duplicate dispatch is keyed by live build ownership facts",
            now,
          })
          const goalRunID = beginBuildAttempt({
            taskID,
            goalID,
            sessionID: `ses_duplicate_live_${stamp}`,
            now: now + 1,
          })
          const ownershipPayload = createOrchestratorToolOwnershipPayload({
            taskID,
            orchestratorSessionID: parent.id,
            orchestratorMessageID: `msg_duplicate_live_${stamp}`,
            toolCallID: `cal_duplicate_live_${stamp}`,
            toolPartID: `prt_duplicate_live_${stamp}`,
            childSessionID: `ses_duplicate_live_${stamp}`,
            scope: "goal",
            goalID,
            goalRunID,
            now: now + 1,
          })
          insertOrchestratorToolOwnershipArtifact({
            taskID,
            goalRunID,
            label: "tool-ownership-start",
            payload: ownershipPayload,
            now: now + 1,
          })
          buildAgentRunImpl = async () => {
            throw new Error("BuildAgent.run must not start for duplicate live ownership")
          }

          const { tools } = createOrchestratorTools({
            taskID,
            agentSessionID: parent.id,
            signal: new AbortController().signal,
          })

          let error: unknown
          try {
            await tools.build.execute(
              {
                goalID,
                request: "Start duplicate build",
                reason: "This should be rejected before BuildAgent starts.",
              },
              buildToolOptions(),
            )
          } catch (err) {
            error = err
          }
          expect(error).toBeInstanceOf(Error)
          const message = error instanceof Error ? error.message : String(error)
          expect(message).toContain("live build tool")
          expect(message).not.toContain("already has live goal_run")
        },
      })
    },
    ORCHESTRATOR_TOOLS_TEST_TIMEOUT_MS,
  )

  test(
    "goal build is not blocked by correction-bearing review history",
    async () => {
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
                    reason: "Review history is context, not a dispatch decision.",
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
    },
    ORCHESTRATOR_TOOLS_TEST_TIMEOUT_MS,
  )

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

  test(
    "goal build success reclaims the completed worktree immediately",
    async () => {
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
            request: "Build a scoped goal and reclaim its worktree after success",
            goalTitle: "Reclaim successful worktree",
            goalSlug: "reclaim-successful-worktree",
            objective: "Verify completed goal worktrees are reclaimed after a passed build",
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
            return !(await Filesystem.exists(buildWorktreeDir)) && findGoalLatestWorkspace(goalID).directory === null
          })
          expect(await Filesystem.exists(buildWorktreeDir)).toBe(false)
          const ws = findGoalLatestWorkspace(goalID)
          expect(ws.directory).toBeNull()
          expect(ws.branch).toBeNull()
          expect(ws.baseRef).toBeNull()
          expect(listGoalRunsByGoal(goalID)[0]?.workspace_dir).toBeNull()
          expect(listGoalRunsByGoal(goalID)[0]?.workspace_branch).toBeNull()
        },
      })
    },
    ORCHESTRATOR_TOOLS_TEST_TIMEOUT_MS,
  )

  test(
    "goal build failure keeps the worktree for diagnosis",
    async () => {
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
    },
    ORCHESTRATOR_TOOLS_TEST_TIMEOUT_MS,
  )

  test(
    "goal build success records completed workspace cleanup refusal without failing the goal",
    async () => {
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
            projectName: "Goal workspace pointer test",
            taskTitle: "Goal workspace pointer task",
            request: "Build a scoped goal and surface refused completed workspace cleanup",
            goalTitle: "Refuse returned workspace cleanup",
            goalSlug: "refuse-returned-workspace-cleanup",
            objective: "Verify refused completed workspace cleanup is visible",
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
              worktreeDir: input.managedWorktree.directory,
              worktreeBranch: input.managedWorktree.branch,
              worktreeBaseRef: input.managedWorktree.baseRef,
            }
          }
          spyOn(EngineWriter, "cleanupGoalWorkspaceForGoal").mockImplementationOnce(async () => {
            throw new Error("WorktreeRemoveFailedError: EBUSY: resource busy or locked, rm 'managed-worktree'")
          })

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
          const goalRunID = listGoalRunsByGoal(goalID)[0]?.id
          expect(goalRunID).toBeString()
          const diagnosticKey = `completed_worktree_cleanup_failed_${goalRunID}`
          await waitForCondition("completed workspace cleanup refusal recorded", async () => {
            return goalStatusByID(goalID) === "passed" && !!createDecisionLog(taskID).readByKey(diagnosticKey)
          })
          const goalRun = listGoalRunsByGoal(goalID)[0]
          expect(goalRun?.status).toBe("completed")
          expect(goalRun?.error).toBeNull()
          expect(goalRun?.workspace_dir).toContain(".opencorvus")
          expect(goalRun?.workspace_dir).toContain("worktree")
          expect(findGoalLatestWorkspace(goalID).directory).toBe(goalRun?.workspace_dir)
          expect(await Filesystem.exists(goalRun?.workspace_dir ?? "")).toBe(true)
          const diagnostic = createDecisionLog(taskID).readByKey(diagnosticKey)
          expect(diagnostic?.value).toContain("completed worktree cleanup failed")
          expect(diagnostic?.value).toContain("EBUSY")
          expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(0)
        },
      })
    },
    ORCHESTRATOR_TOOLS_TEST_TIMEOUT_MS,
  )

  test(
    "goal build uses design resource manifest target once when task artifact has same material image",
    async () => {
      await tmp?.[Symbol.asyncDispose]?.()
      tmp = await tmpdir({ git: true })

    const now = Date.now()
    const stamp = now.toString(16)
    const taskID = `tsk_manifest_build_evidence_${stamp}`
    const goalID = `gol_manifest_build_evidence_${stamp}`
    let capturedContext: any

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "manifest build evidence test" })
        insertWorkflowTaskWithGoal({
          projectID: Instance.project.id,
          taskID,
          goalID,
          sessionID: parent.id,
          worktree: tmp.path,
          projectName: "Manifest build evidence test",
          taskTitle: "Manifest build evidence task",
          request: "Build from a captured design material image.",
          goalTitle: "Implement captured material",
          goalSlug: "implement-captured-material",
          objective: "Use the captured material image exactly once as target evidence.",
          now,
          insertProject: false,
        })
        const screenshot = await AttachmentStore.write(
          Instance.project.id,
          Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          "image/png",
          "material-reference.png",
        )
        Database.use((db) => {
          db.update(EngineTaskTable)
            .set({
              system_artifacts: [{ ...screenshot, intent: "visual_reference", source: "material" }],
              time_updated: now,
            })
            .where(eq(EngineTaskTable.id, taskID))
            .run()
        })
        const manifest = createDesignResourceManifest({
          taskID,
          resources: [{ ...screenshot, intent: "visual_reference", source: "material" }],
          now,
        })
        recordDesignResourceManifest({ taskID, manifest, now })
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
            value: `${key} complete for manifest evidence regression.`,
            reason: "Build prerequisite requires complete frontend-design template first.",
          })
        }

        buildAgentRunImpl = async (input: any) => {
          await markBuildSlotAcquired(input)
          capturedContext = input.context
          return {
            result: {
              status: "passed",
              summary: "Goal built with manifest evidence",
              files_changed: [
                {
                  path: "src/index.ts",
                  summary: "Updated visual implementation.",
                  reason: "Required by the mocked manifest build.",
                },
              ],
              tests: [],
              commit_ref: "abc1234",
            },
            sessionID: "ses_goal_manifest_evidence",
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
            request: "Implement from the captured design material image",
            reason: "Verify manifest evidence projection.",
          },
          buildToolOptions(),
        )

        expectGoalBuildStarted(result)
        await waitForGoalStatus(goalID, "passed")
        expect(capturedContext?.evidencePack?.targetReferences).toHaveLength(1)
        expect(capturedContext.evidencePack.targetReferences[0]).toMatchObject({
          url: screenshot.url,
          label: "material-reference.png",
          intent: "visual_reference",
          source: "material",
        })
        expect(capturedContext.evidencePack.previousOutputs ?? []).toEqual([])
      },
    })
    },
    ORCHESTRATOR_TOOLS_TEST_TIMEOUT_MS,
  )

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
            reason: "Visual build prerequisite requires complete frontend-design template first.",
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
        expect(capturedContext?.evidencePack?.previousOutputs).toHaveLength(1)
        expect(capturedContext?.evidencePack?.targetReferences ?? []).toEqual([])
        const previousOutput = capturedContext!.evidencePack!.previousOutputs![0]
        expect(previousOutput.url).toBe(rendered.url)
        expect(previousOutput.url).toStartWith(`/attachment/${Instance.project.id}/`)
        expect(previousOutput.intent).toBe("rendered_output")
        await expect(AttachmentStore.inlineFileParts([previousOutput])).resolves.toHaveLength(1)
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
