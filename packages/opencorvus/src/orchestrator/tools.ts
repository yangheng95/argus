/**
 * Orchestrator tools — AI SDK tool() definitions wrapping existing services.
 *
 * Created per-task via createOrchestratorTools({ taskID }).
 * The taskID is captured in the closure — no global registry needed.
 */
import { tool } from "ai"
import z from "zod"
import path from "node:path"
import fs from "node:fs/promises"
import { createHash } from "node:crypto"
import { Bus } from "@/bus"
import { Session } from "@/session"
import { SessionTable } from "@/session/session.sql"
import { SessionContext } from "@/session/context"
import type { AgentReport } from "@/agent/report"
import {
  FactCheckAttemptArtifactSchema,
  FactCheckItemListSchema,
  type FactCheckAttemptArtifact,
  type FactCheckReport,
} from "@/fact-check/schema"
import { resolveAgentModel, resolveAgentModelRef, resolveConfiguredModelRef } from "@/agent/model"
import { PromptProfile, PromptProfileIDSchema } from "@/agent/prompt-profile"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus, sessionLifecycleOrderKey } from "@/session/status"
import { Message } from "@/session/message"
import { SessionControl } from "@/session/control"
import { Database, NotFoundError, desc, eq, and, inArray, sql } from "@/storage/db"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { EffectiveConfig } from "@/config/effective"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { taskPrimaryProjectRoot } from "@/project/task-runtime-root"
import { Log } from "@/util/log"
import { Filesystem } from "@/util/filesystem"
import { createDecisionLog } from "@/decision-log"
import { DecisionLogTable } from "@/decision-log/schema"
import { EngineService } from "@/task-api"
import { canReceiveDirectAgentSessionControl } from "./direct-reply"
import { sessionGoalID, sessionRole, taskIDForSession } from "./task-event"
import { Publisher } from "@/engine/publisher"
import { EngineGit } from "@/engine/git"
import { git as runGit } from "@/util/git"
import { Shell } from "@/shell/shell"
import { DEFAULT_BASH_TIMEOUT_MS } from "@/shell/timeout"
import { ProcessSupervisor } from "@/shell/process-supervisor"
import { isHostKillingCommand } from "@/tool/bash"
import { BrowserPreviewTool, BrowserPreviewToolStaticDefinition } from "@/tool/browser-preview"
import {
  WAIT_MAX_MS,
  WAIT_MIN_MS,
  WAIT_RECOMMENDED_MS,
  WaitToolDescription,
  WaitToolParameters,
  executeWait,
} from "@/tool/wait"
import { CronJobTable } from "@/scheduler/cron.sql"
import { EngineMemoryBridge } from "@/engine/memory-bridge"
import { clarificationTranscriptSection, operatorNotesSection } from "@/engine/helpers"
import { SubAgentProtocol } from "@/agent/sub-agent-protocol"
import { ExploreAgent } from "@/explore/agent"
import { Event as EngineEvent, type TaskMessageTargetInput } from "@/engine/model"
import { EngineProtocol } from "@/engine/protocol"
import { timelineOrderKey } from "@/timeline/order"
import { abortChildExecutionForSession, abortGoalRunExecution } from "@/engine/execution-abort"
import { abortLiveOrchestratorToolOwnership } from "@/engine/writer"
import { ensureTaskMessageProtocolBridge } from "@/orchestrator/protocol/message-bridge"
import { renderFrontendDesignHandoffReference, frontendDesignArtifactPaths } from "@/frontend-design/handoff"
import {
  findNonStaleFrontendResearchBriefs,
  renderFrontendResearchArchitectPromptSection,
  renderFrontendResearchBriefPromptSection,
  renderFrontendResearchBuildPromptSection,
  renderFrontendResearchDesignPromptSection,
  renderResearchBriefPromptSection,
} from "@/research/prompt-section"
import { ensureLiveWebpageEvidence, primaryWebpageEvidenceArtifacts } from "./webpage-evidence"
import { readLatestTaskVisualEvidenceBundleSync } from "@/acceptance/visual-evidence"
import { renderUserRequestSection } from "@/intent/request-prompt"
import {
  renderVisualQaBuildEvidenceContext,
  renderVisualQaFrontendDesignContext,
  renderVisualQaFrontendResearchContext,
  renderVisualQaIntegrityContext,
  renderVisualQaPriorReportContext,
} from "@/visual-qa/context"
import { visualQaReportAcceptanceSemantics } from "@/visual-qa/acceptance-semantics"
import { VisualQaReportSchema } from "@/visual-qa/schema"
import { deriveVisualQaReferenceParityContext } from "@/visual-qa/reference-parity-context"
import { materializeMcpToolResult } from "@/mcp/materialize"
import {
  EngineArtifactTable,
  EngineGoalTable,
  EngineInteractionRequestTable,
  EngineMilestoneTable,
  EnginePlanNodeTable,
  EnginePlanVersionTable,
  EngineRequirementTable,
  EngineSpecItemTable,
  EngineSpecSnapshotTable,
  EngineTaskTable,
  type EngineArtifactKind,
} from "@/engine/engine.sql"
import {
  supersedePriorActivePlansForTask,
  appendGoalToActiveGraph,
  completeGoal,
  deleteGoal as deleteGoalRow,
  ensureBuildRetryFeedbackForGoal,
  persistTaskFrontendResearchBrief,
  persistTaskResearchBrief,
  updateGoalWorkspace,
  updateGoalRun,
} from "@/engine/persist"
import {
  findActivePlanForTask,
  findActiveRunForTask,
  findActiveSpecForTask,
  findDeliveriesForTask,
  findAcceptanceByRun,
  findEvaluationByRun,
  findGoal,
  findGoalRun,
  findInteractionByExternal,
  findRequirements,
  findLatestArchitectContractGraph,
  findLatestArchitectContractGraphArtifact,
  findLatestGoalWorkloadArtifact,
  findLatestIntegrityAttemptArtifact,
  integrityAttemptVerdict,
  findLatestAcceptanceVerdictArtifact,
  findLatestAcceptanceVerdictArtifactForAcceptance,
  findLatestIntegrityArtifactMissingStatus,
  findLatestTipGoalRun,
  findPlan,
  findRun,
  getGoalRetryCount,
  listGoals,
  listGoalsForPlan,
  findBuildOutcomesForTask,
  listGoalRunsByGoal,
  listGoalRunsForTask,
  requireRun,
  requireTask,
  type RunRow,
  type TaskRow,
} from "@/engine/store"
import { goalStatusByID } from "@/engine/describe"
import { isLiveGoalRunStatus, isLiveRunStatus } from "@/engine/catalog"
import { GoalContractFieldsSchema, GoalContractUpdateSchema } from "@/pipeline/goal-contract.schema"
import { blockActiveRunForTask, terminalTask, updateRun, updateTask } from "@/engine/state"
import { deriveTaskStatus, isTaskQueued, isTaskTerminal } from "@/engine/task-status"
import {
  completeOrchestratorToolOwnership,
  createOrchestratorToolOwnershipPayload,
  findLatestOwnershipByID,
  findLiveBuildOwnershipByGoal,
  findLiveBuildOwnershipByGoalRun,
  findLiveBuildOwnershipBySession,
  insertOrchestratorToolOwnershipArtifact,
  type OrchestratorToolOwnershipOutcome,
  type OrchestratorToolOwnershipPayload,
  type OrchestratorToolOwnershipRow,
} from "@/engine/tool-ownership"
import { Ownership } from "@/engine/ownership"
import {
  completeAgentCoordinationAction,
  createAgentCoordinationResponse,
  failAgentCoordinationAction,
  findAgentCoordinationAction,
  findAgentCoordinationRequest,
  findAgentCoordinationResponse,
  listPendingAgentCoordinationSessionControlRequests,
  recordAgentCoordinationActionProgress,
  resolveAgentCoordinationSessionOwnership,
  type AgentCoordinationRedispatchBinding,
  type AgentCoordinationSessionOwnershipSource,
  type AgentCoordinationRequestRow,
} from "@/engine/agent-coordination"
import { ProtocolEventTable } from "@/protocol/protocol.sql"

import {
  createWorkflowState,
  findStepByTool,
  WorkflowRegistry,
  type WorkflowState,
  type MiniWorkflow,
} from "@/engine/workflow"
import { Question } from "@/question"
import {
  buildClarifiedUserRequest,
  clarificationAnswers,
  clarificationToQuestionInfo,
  renderClarificationAnswers,
} from "@/intent-analysis/clarified-request"
import { renderSpecsAsText, type AcceptanceSpec, type ContractAuditScorer } from "@/acceptance/types"
import {
  contractAuditBlocksBuild,
  contractAuditRequired,
  runContractAudit,
  type ContractAuditCriteriaResult,
} from "@/acceptance/contract-audit"
import {
  isOrchestratorNoDecisionObservationToolName,
  ORCHESTRATOR_DECISION_EFFECT_METADATA_KEY,
  type OrchestratorDecisionEffect,
} from "./stateful-tool-names"
import { composeAcceptanceRetryFeedback } from "./acceptance-retry-feedback"
import { parsedRequirementFromRow } from "@/requirements/row"
import {
  architectFidelityIssues,
  AssemblyOwnerEntrySchema,
  ReferenceCoverageEntrySchema,
  SourceCoverageEntrySchema,
  type ArchitectFidelityState,
} from "@/architect/fidelity"
import { contractGraphIRIndex, validateArchitectContractGraph } from "@/architect/contract-graph"
import type {
  IntegrityFinding,
  IntegrityRequiredRepair,
  IntegrityResult,
  IntegrityUnresolvedDisagreement,
} from "@/integrity"
import { renderIntegrityMarkdown } from "@/integrity/render-markdown"
import { AgentRunError } from "@/agent/runner"
import { isHttpWebpageUrl } from "@/util/web-url"
import {
  createStageContinuationRequest,
  failNonCurrentOwnerStageContinuationClaim,
  findStageContinuationRequest,
  type AgentSessionContinuation,
  type StageContinuationFailureName,
  type StageContinuationRequestRow,
  type StageContinuationStage,
} from "@/engine/stage-continuation"

export const ORCHESTRATOR_BASH_DEFAULT_TIMEOUT_MS = DEFAULT_BASH_TIMEOUT_MS
export const ORCHESTRATOR_BASH_MAX_TIMEOUT_MS = 10 * 60 * 1000

// Wait tool bounds. Floor is one second so the LLM cannot use it as a
// cheap busy-wait; recommended and ceiling both come from the single
// wait tool schema so prompt guidance cannot drift from executable bounds.
export const ORCHESTRATOR_WAIT_MIN_MS = WAIT_MIN_MS
export const ORCHESTRATOR_WAIT_RECOMMENDED_MS = WAIT_RECOMMENDED_MS
export const ORCHESTRATOR_WAIT_MAX_MS = WAIT_MAX_MS

const log = Log.create({ service: "task-tools" })

const ProposedTaskCodeModuleReferenceSchema = z.object({
  entity: z
    .string()
    .min(1)
    .describe("Concrete code module reference entity: file path, component, tool, service, route, schema, table, class, or function."),
  problem: z
    .string()
    .min(1)
    .describe("Observed problem tied to that entity. Generic project improvement text is not a valid problem."),
})

function hasConcreteProposedTaskCodeModuleReference(value: unknown): value is z.infer<typeof ProposedTaskCodeModuleReferenceSchema> {
  if (!value || typeof value !== "object") return false
  const candidate = value as { entity?: unknown; problem?: unknown }
  return (
    typeof candidate.entity === "string" &&
    candidate.entity.trim().length > 0 &&
    typeof candidate.problem === "string" &&
    candidate.problem.trim().length > 0
  )
}

const StageContinuationArtifactIDField = z
  .string()
  .min(1)
  .optional()
  .describe(
    "Explicit stage_continuation_request artifact id returned by this same stage after a terminal finalizer miss. " +
      "Use only to continue that exact child session; omit for a fresh stage run.",
  )

function stageInputDigest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex")
}

const EvidenceSnapshotEntrySchema = z
  .object({
    count: z.number().int().nonnegative(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

const EvidenceSnapshotSchema = z.record(z.string(), EvidenceSnapshotEntrySchema)

function evidenceSnapshotCount(value: unknown): number {
  if (value === null || value === undefined) return 0
  if (Array.isArray(value)) return value.length
  return 1
}

function continuationEvidenceSnapshot(input: Record<string, unknown>): z.infer<typeof EvidenceSnapshotSchema> {
  return Object.fromEntries(
    Object.entries(input)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [
        key,
        {
          count: evidenceSnapshotCount(value),
          digest: stageInputDigest(value),
        },
      ]),
  )
}

function taskContinuationScope(task: { title: string; request: string }) {
  return {
    task_title: task.title,
    task_request_digest: stageInputDigest(task.request),
  }
}

function specContinuationScope(
  spec:
    | {
        id: string
        version: number
        status: string
        summary: string | null
        content: string
        scope: string | null
      }
    | undefined,
) {
  if (!spec) return null
  return {
    id: spec.id,
    version: spec.version,
    status: spec.status,
    summary_digest: stageInputDigest(spec.summary ?? null),
    content_digest: stageInputDigest(spec.content),
    scope_digest: stageInputDigest(spec.scope ?? null),
  }
}

function goalsContinuationScope(
  goals: Array<{
    id: string
    spec_snapshot_id: string | null
    title: string
    slug: string
    objective: string
    acceptance_specs: unknown
    owned_paths: unknown
    depends_on: unknown
    kind: string
    requirement_ids: unknown
    priority: string
    order_index: number
  }>,
) {
  return goals
    .slice()
    .sort((a, b) => a.order_index - b.order_index || a.id.localeCompare(b.id))
    .map((goal) => ({
      id: goal.id,
      spec_snapshot_id: goal.spec_snapshot_id,
      title: goal.title,
      slug: goal.slug,
      retry_count: getGoalRetryCount(goal.id),
      objective_digest: stageInputDigest(goal.objective),
      acceptance_specs_digest: stageInputDigest(goal.acceptance_specs),
      owned_paths_digest: stageInputDigest(goal.owned_paths),
      depends_on_digest: stageInputDigest(goal.depends_on),
      kind: goal.kind,
      requirement_ids_digest: stageInputDigest(goal.requirement_ids),
      priority: goal.priority,
      order_index: goal.order_index,
    }))
}

function taskArrayField(
  task: { attachments?: unknown; design_specs?: unknown; system_artifacts?: unknown },
  key: "attachments" | "design_specs" | "system_artifacts",
) {
  const value = task[key]
  return Array.isArray(value) ? value : []
}

function frontendDesignMetadataPromptScope(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const figmaUrl = (metadata as { figma_url?: unknown }).figma_url
  return typeof figmaUrl === "string" && figmaUrl.trim() ? { figma_url: figmaUrl.trim() } : null
}

function architectWorkloadPromptScope(workloadBriefs: unknown) {
  if (!Array.isArray(workloadBriefs)) return []
  return workloadBriefs
    .filter((brief) => brief && typeof brief === "object")
    .map((brief) => brief as Record<string, unknown>)
    .filter((brief) => typeof brief.decomposition_concern === "string" && brief.decomposition_concern.trim())
    .map((brief) => {
      const inventory =
        brief.execution_inventory &&
        typeof brief.execution_inventory === "object" &&
        !Array.isArray(brief.execution_inventory)
          ? (brief.execution_inventory as Record<string, unknown>)
          : {}
      return {
        goal_id: typeof brief.goal_id === "string" ? brief.goal_id : "",
        decomposition_concern: (brief.decomposition_concern as string).trim(),
        execution_inventory: {
          surfaces: inventory.surfaces ?? 0,
          states: inventory.states ?? 0,
          data_contracts: inventory.data_contracts ?? 0,
          verification_points: inventory.verification_points ?? 0,
        },
      }
    })
}

async function hostPreparedFrontendProjectEvidenceSnapshot(taskID: string) {
  const paths = ProjectRuntimePaths.frontendDesignPaths(
    taskPrimaryProjectRoot(taskID, { activeProjectID: Instance.project.id }),
    taskID,
  )
  const [sourcePackageStat, skeletonProjectStat] = await Promise.all([
    fs.stat(paths.sourcePackageAbsolute).catch(() => undefined),
    fs.stat(paths.skeletonProjectAbsolute).catch(() => undefined),
  ])
  if (!sourcePackageStat?.isDirectory() || !skeletonProjectStat?.isDirectory()) return null
  const { readHostPreparedCompactEvidence } = await import("@/frontend-design/host-prepared-source-project")
  const compactEvidence = await readHostPreparedCompactEvidence({
    sourcePackage: paths.sourcePackageAbsolute,
    projectRoot: paths.skeletonProjectAbsolute,
  })
  return {
    project_root: paths.skeletonProjectRelative,
    source_package: paths.sourcePackageRelative,
    compact_evidence_digest: stageInputDigest(compactEvidence),
  }
}

function requirementsPromptEvidenceSnapshot(taskID: string, task: TaskRow, frontendDesign: string) {
  return continuationEvidenceSnapshot({
    attachments: taskArrayField(task, "attachments"),
    design_specs: taskArrayField(task, "design_specs"),
    frontend_design: frontendDesign,
    clarification_transcript: clarificationTranscriptSection(taskID),
    operator_notes: operatorNotesSection(taskID),
    deep_research: renderResearchBriefPromptSection({ taskID, request: task.request }),
    frontend_research: renderFrontendResearchBriefPromptSection({ taskID, request: task.request }),
  })
}

function architectPromptEvidenceSnapshot(input: {
  taskID: string
  task: TaskRow
  requirements: unknown
  requirementDecisions: unknown
  frontendDesign: string
  workloadBriefs: unknown
  decisionLogPrompt: string
}) {
  return continuationEvidenceSnapshot({
    attachments: taskArrayField(input.task, "attachments"),
    design_specs: taskArrayField(input.task, "design_specs"),
    requirements: input.requirements,
    requirement_decisions: input.requirementDecisions,
    frontend_design: input.frontendDesign,
    workload_briefs: architectWorkloadPromptScope(input.workloadBriefs),
    deep_research: renderResearchBriefPromptSection({ taskID: input.taskID, request: input.task.request }),
    frontend_research: renderFrontendResearchArchitectPromptSection({
      taskID: input.taskID,
      request: input.task.request,
    }),
    decision_log: input.decisionLogPrompt,
  })
}

async function frontendDesignPromptEvidenceSnapshot(taskID: string, task: TaskRow) {
  return continuationEvidenceSnapshot({
    attachments: taskArrayField(task, "attachments"),
    system_artifacts: taskArrayField(task, "system_artifacts"),
    design_specs: taskArrayField(task, "design_specs"),
    metadata: frontendDesignMetadataPromptScope(task.metadata),
    host_prepared_frontend_project: await hostPreparedFrontendProjectEvidenceSnapshot(taskID),
    frontend_research: renderFrontendResearchDesignPromptSection({ taskID, request: task.request }),
  })
}

function frontendResearchSourceUrlFromStageInput(input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined
  const value = (input as { source_url?: unknown }).source_url
  return typeof value === "string" && isHttpWebpageUrl(value) ? value : undefined
}

function frontendResearchFocusFromStageInput(input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined
  const value = (input as { focus?: unknown }).focus
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function continuationFromArtifact(input: {
  taskID: string
  stage: StageContinuationStage
  artifactID: string
  finalizerName: string
  expectedNormalizedStageInput?: unknown
}): AgentSessionContinuation {
  let row = findStageContinuationRequest({ taskID: input.taskID, artifactID: input.artifactID })
  if (!row) throw new Error(`stage continuation request not found: ${input.artifactID}`)
  if (row.payload.stage !== input.stage) {
    throw new Error(`stage continuation ${input.artifactID} targets stage ${row.payload.stage}, not ${input.stage}`)
  }
  if (row.payload.finalizer_name !== input.finalizerName) {
    throw new Error(
      `stage continuation ${input.artifactID} targets finalizer ${row.payload.finalizer_name}, not ${input.finalizerName}`,
    )
  }
  if (input.expectedNormalizedStageInput !== undefined) {
    const expectedDigest = stageInputDigest(input.expectedNormalizedStageInput)
    if (row.payload.input_digest !== expectedDigest) {
      throw new Error(
        `stage continuation ${input.artifactID} scope mismatch for ${input.stage}; stored input_digest=${row.payload.input_digest}, current input_digest=${expectedDigest}. Start a fresh ${continuationToolName(input.stage)} run instead of continuing a stale child session.`,
      )
    }
  }
  return {
    sessionID: row.payload.session_id,
    artifactID: input.artifactID,
    reason: row.payload.reason,
    kind: row.payload.kind,
    finalizerName: row.payload.finalizer_name,
    failedAssistantMessageID: row.payload.failed_assistant_message_id,
  }
}

function stageContinuationUnavailableResult(input: {
  taskID: string
  stage: StageContinuationStage
  artifactID: string
  finalizerName: string
  expectedNormalizedStageInput?: unknown
}): ReturnType<typeof SubAgentProtocol.yieldResult> | undefined {
  const toolName = continuationToolName(input.stage)
  let row = findStageContinuationRequest({ taskID: input.taskID, artifactID: input.artifactID })
  if (!row) {
    return SubAgentProtocol.yieldResult({
      headline: `${input.stage}: continuation artifact was not found.`,
      summary:
        `No fresh worker session was started because continuation_artifact_id=${input.artifactID} does not exist for this task. ` +
        `Read the current task context and either use the latest pending continuation artifact or start a fresh ${toolName} run without continuation_artifact_id.`,
      fields: [
        ["stage", input.stage],
        ["continuation_artifact_id", input.artifactID],
        ["state", "not_found"],
      ],
      pointer: `read_context scope=decisions; do not reuse ${input.artifactID}`,
    })
  }
  const mismatch =
    row.payload.stage !== input.stage
      ? `stage ${row.payload.stage}, not ${input.stage}`
      : row.payload.finalizer_name !== input.finalizerName
        ? `finalizer ${row.payload.finalizer_name}, not ${input.finalizerName}`
        : undefined
  if (mismatch) {
    return SubAgentProtocol.yieldResult({
      headline: `${input.stage}: continuation artifact belongs to a different recovery contract.`,
      summary:
        `No fresh worker session was started because continuation_artifact_id=${input.artifactID} targets ${mismatch}. ` +
        `Use the continuation call printed by the original terminal-finalizer-miss result, or start a fresh ${toolName} run without continuation_artifact_id.`,
      fields: [
        ["stage", input.stage],
        ["continuation_artifact_id", input.artifactID],
        ["state", "wrong_contract"],
        ["actual_stage", row.payload.stage],
        ["actual_finalizer", row.payload.finalizer_name],
      ],
      pointer: `read_context scope=decisions; do not reuse ${input.artifactID} with ${toolName}`,
    })
  }
  row = failNonCurrentOwnerStageContinuationClaim({ taskID: input.taskID, artifactID: input.artifactID }) ?? row
  const state = row.payload.consumed_at
    ? "consumed"
    : row.payload.claim_failed_at
      ? "claim_failed"
      : row.payload.claimed_at
        ? "claimed"
        : undefined
  if (state) {
    const detail =
      state === "consumed"
        ? `already consumed by message ${row.payload.continuation_message_id ?? "n/a"}`
        : state === "claim_failed"
          ? `has failed claim state: ${row.payload.claim_error ?? "n/a"}`
          : `already claimed by ${row.payload.claim_id ?? "unknown"}`
    const nextAction =
      state === "claimed"
        ? "wait for the in-flight same-session continuation or inspect the child session before retrying"
        : `start a fresh ${toolName} run without continuation_artifact_id if the work is still required`
    return SubAgentProtocol.yieldResult({
      headline: `${input.stage}: continuation artifact is no longer pending.`,
      summary:
        `No fresh worker session was started because continuation_artifact_id=${input.artifactID} ${detail}. ` +
        `Do not reuse this artifact; ${nextAction}.`,
      fields: [
        ["stage", input.stage],
        ["session_id", row.payload.session_id],
        ["continuation_artifact_id", input.artifactID],
        ["state", state],
        ["detail", detail],
        ["next_action", nextAction],
      ],
      pointer: `read_context scope=decisions; do not reuse ${input.artifactID}`,
    })
  }
  if (input.expectedNormalizedStageInput !== undefined) {
    const currentDigest = stageInputDigest(input.expectedNormalizedStageInput)
    if (row.payload.input_digest !== currentDigest) {
      return SubAgentProtocol.yieldResult({
        headline: `${input.stage}: continuation artifact scope is stale.`,
        summary:
          `No fresh worker session was started because continuation_artifact_id=${input.artifactID} was created for an older ${input.stage} input scope. ` +
          `Do not reuse this stale artifact; start a fresh ${toolName} run without continuation_artifact_id if the work is still required.`,
        fields: [
          ["stage", input.stage],
          ["session_id", row.payload.session_id],
          ["continuation_artifact_id", input.artifactID],
          ["state", "scope_mismatch"],
          ["stored_input_digest", row.payload.input_digest],
          ["current_input_digest", currentDigest],
          ["next_action", `start a fresh ${toolName} run without continuation_artifact_id`],
        ],
        pointer: `read_context scope=decisions; start fresh ${toolName}`,
      })
    }
  }
  return undefined
}

function continuationFromArtifactOrResult(
  input: Parameters<typeof continuationFromArtifact>[0],
): { continuation: AgentSessionContinuation } | { result: ReturnType<typeof SubAgentProtocol.yieldResult> } {
  const result = stageContinuationUnavailableResult(input)
  if (result) return { result }
  return { continuation: continuationFromArtifact(input) }
}

function protocolFinalizerMiss(input: {
  err: unknown
  finalizerName: string
}): { failureName: StageContinuationFailureName; failureMessage: string } | undefined {
  if (!(input.err instanceof AgentRunError)) return undefined
  const cause = input.err.cause
  if (Message.TerminalToolMissingError.isInstance(cause as Error | undefined)) {
    const data = (cause as { data?: { toolName?: string; message?: string } }).data
    if (data?.toolName !== input.finalizerName) return undefined
    return { failureName: "TerminalToolMissingError", failureMessage: data.message ?? input.err.message }
  }
  if (Message.StructuredOutputError.isInstance(cause as Error | undefined)) {
    if (input.finalizerName !== "StructuredOutput") return undefined
    const data = (cause as { data?: { message?: string } }).data
    return { failureName: "StructuredOutputError", failureMessage: data?.message ?? input.err.message }
  }
  return undefined
}

async function latestAssistantMessageForSession(sessionID: string): Promise<Message.Assistant | undefined> {
  for await (const msg of Message.stream(sessionID)) {
    if (msg.info.role === "assistant") return msg.info
  }
  return undefined
}

function contextUnavailableReasonFromAssistantError(message: Message.Assistant | undefined): string | undefined {
  const error = message?.error
  if (!error) return undefined
  if (Message.ContextOverflowError.Schema.safeParse(error).success) {
    return `prior_latest_assistant_context_overflow:${message.id}`
  }
  if (Message.PromptBudgetOverflowError.Schema.safeParse(error).success) {
    return `prior_latest_assistant_prompt_budget_overflow:${message.id}`
  }
  if (message.agent === "compaction" && Message.StructuredOutputPayloadError.Schema.safeParse(error).success) {
    return `prior_compaction_handoff_failed:${message.id}`
  }
  if (message.agent === "compaction" && Message.StructuredOutputError.Schema.safeParse(error).success) {
    return `prior_compaction_structured_output_missing:${message.id}`
  }
  if (message.agent === "compaction" && Message.AbortedError.Schema.safeParse(error).success) {
    return `prior_compaction_aborted:${message.id}`
  }
  return undefined
}

function pendingCompactionControlContextUnavailableReason(sessionID: string): string | undefined {
  const control = SessionControl.pending(sessionID).find(
    (item) => item.kind === "compaction_request" || item.kind === "manual_summarize",
  )
  if (!control) return undefined
  const source =
    typeof control.payload.source_user_message_id === "string" ? `:${control.payload.source_user_message_id}` : ""
  return `prior_pending_${control.kind}:${control.id}${source}`
}

async function selectGoalBuildRetrySession(input: {
  goalID: string
  priorGoalRun?: NonNullable<ReturnType<typeof findLatestTipGoalRun>>
  managedWorktree?: { directory: string; branch: string; baseRef?: string | null }
  executor: TaskRow["executor"] | undefined
}): Promise<{ existingSessionID?: string; priorSessionID?: string; contextUnavailableReason?: string }> {
  const prior = input.priorGoalRun
  if (!prior || isLiveGoalRunStatus(prior.status)) return {}
  const priorSessionID = prior.session_id ?? undefined
  if (!priorSessionID) {
    return { contextUnavailableReason: `prior_terminal_goal_run_missing_session:${prior.id}` }
  }

  let session: Awaited<ReturnType<typeof Session.get>>
  try {
    session = await Session.get(priorSessionID)
  } catch (error) {
    if (!NotFoundError.isInstance(error as Error)) throw error
    return {
      priorSessionID,
      contextUnavailableReason: `prior_session_row_missing:${priorSessionID}`,
    }
  }

  const expectedDirectory = input.managedWorktree?.directory
  if (session.kind !== "build") {
    return {
      priorSessionID,
      contextUnavailableReason: `prior_session_kind_mismatch:${session.kind}`,
    }
  }
  if ((session.goalID ?? undefined) !== input.goalID) {
    return {
      priorSessionID,
      contextUnavailableReason: `prior_session_goal_mismatch:${session.goalID ?? "unset"}`,
    }
  }
  if (expectedDirectory && session.directory !== expectedDirectory) {
    return {
      priorSessionID,
      contextUnavailableReason: `prior_session_directory_mismatch`,
    }
  }

  const pendingCompactionReason = pendingCompactionControlContextUnavailableReason(priorSessionID)
  if (pendingCompactionReason) return { priorSessionID, contextUnavailableReason: pendingCompactionReason }

  const latestAssistant = await latestAssistantMessageForSession(priorSessionID)
  const contextUnavailableReason = contextUnavailableReasonFromAssistantError(latestAssistant)
  if (contextUnavailableReason) return { priorSessionID, contextUnavailableReason }

  const executor = input.executor ?? "opencorvus"
  if (executor !== "opencorvus") {
    const { readExecutorSessionRef } = await import("@/executor/session-ref")
    const ref = await readExecutorSessionRef(priorSessionID)
    if (!ref)
      return { priorSessionID, contextUnavailableReason: `prior_executor_ref_missing:${priorSessionID}:${executor}` }
    if (ref.provider && ref.provider !== executor) {
      return {
        priorSessionID,
        contextUnavailableReason: `prior_executor_ref_provider_mismatch:${ref.provider}:${executor}`,
      }
    }
    if (!ref.nativeSessionID) {
      return { priorSessionID, contextUnavailableReason: `prior_executor_ref_missing_native_session:${executor}` }
    }
  }

  return { existingSessionID: priorSessionID, priorSessionID }
}

function continuationToolName(stage: StageContinuationStage): string {
  const explicit: Partial<Record<StageContinuationStage, string>> = {
    "frontend-design": "frontend_design",
    "frontend-research": "frontend_research",
    "deep-research": "deep_research",
    "visual-qa": "visual_qa",
    "intent-analysis": "analyze_intent",
    "fact-check": "fact_check",
    "goal-workload-analyst": "workload_analysis",
  }
  return explicit[stage] ?? stage.replaceAll("-", "_")
}

function continuationReason(input: {
  stage: StageContinuationStage
  finalizerName: string
  pointerReason?: string | null
  normalizedStageInput: unknown
}) {
  if (typeof input.pointerReason === "string" && input.pointerReason.trim()) {
    return `Continue after missing ${input.finalizerName}: ${input.pointerReason.trim()}`
  }
  const normalized = input.normalizedStageInput
  if (normalized && typeof normalized === "object" && !Array.isArray(normalized)) {
    const reason = (normalized as { reason?: unknown }).reason
    if (typeof reason === "string" && reason.trim())
      return `Continue after missing ${input.finalizerName}: ${reason.trim()}`
  }
  return `Continue ${input.stage} after missing ${input.finalizerName}.`
}

function continuationResultForProtocolFinalizerMiss(input: {
  err: unknown
  taskID: string
  stage: StageContinuationStage
  sessionID: string | undefined
  parentSessionID: string
  finalizerName: string
  normalizedStageInput: unknown
  pointerReason?: string | null
}): ReturnType<typeof SubAgentProtocol.yieldResult> | undefined {
  const miss = protocolFinalizerMiss({ err: input.err, finalizerName: input.finalizerName })
  if (!miss) return undefined
  if (!input.sessionID) return undefined
  const toolName = continuationToolName(input.stage)
  const reason = continuationReason({
    stage: input.stage,
    finalizerName: input.finalizerName,
    pointerReason: input.pointerReason,
    normalizedStageInput: input.normalizedStageInput,
  })
  const request = createStageContinuationRequest({
    taskID: input.taskID,
    stage: input.stage,
    sessionID: input.sessionID,
    parentSessionID: input.parentSessionID,
    normalizedStageInput: input.normalizedStageInput,
    inputDigest: stageInputDigest(input.normalizedStageInput),
    failureName: miss.failureName,
    failureMessage: miss.failureMessage,
    finalizerName: input.finalizerName,
    reason,
  })
  const pointerPayload = JSON.stringify({ reason, continuation_artifact_id: request.artifactID })
  return SubAgentProtocol.yieldResult({
    headline: `${input.stage}: protocol finalizer missing; same-session continuation is ready.`,
    summary:
      `The ${input.stage} worker session ${input.sessionID} ended with ${miss.failureName} before ${input.finalizerName}. ` +
      `No fresh worker session was started. Re-dispatch ${toolName} with reason and continuation_artifact_id=${request.artifactID} to append a visible recovery message to the same child session.`,
    fields: [
      ["stage", input.stage],
      ["session_id", input.sessionID],
      ["continuation_artifact_id", request.artifactID],
      ["continuation_call", `${toolName}(${pointerPayload})`],
      ["finalizer", input.finalizerName],
      ["failure", miss.failureName],
    ],
    pointer: `${toolName}(${pointerPayload})`,
  })
}

export const READ_CONTEXT_OUTPUT_CHAR_BUDGET = SubAgentProtocol.HARD_CHAR_CAP
const READ_CONTEXT_ARTIFACT_STATUS_CHAR_CAP = 1_200
const READ_CONTEXT_INTEGRITY_LATEST_CHAR_CAP = 3_200
const READ_CONTEXT_INTEGRITY_REPORT_CHAR_CAP = 2_400
const READ_CONTEXT_INTEGRITY_HISTORY_DEDICATED_CHAR_CAP = 16_000
const READ_CONTEXT_DECISION_REVIEW_CHAR_CAP = 3_500
const READ_CONTEXT_DECISION_GENERAL_CHAR_CAP = 5_500
const READ_CONTEXT_FACT_CHECK_ATTEMPT_CHAR_CAP = 500

type ReadContextAddOptions = {
  pointer: string
  sectionCap?: number
}

type ReadContextOutput = ReturnType<typeof createReadContextOutput>

function createReadContextOutput() {
  const sections: string[] = []
  let usedChars = 0

  function add(...input: Array<string | ReadContextAddOptions | undefined>): boolean {
    const options = input[input.length - 1]
    if (!options || typeof options !== "object" || !("pointer" in options)) {
      throw new Error("read_context output block missing pointer")
    }
    const rawLines = input.slice(0, -1) as Array<string | undefined>
    const block = normalizeReadContextBlock(rawLines)
    if (!block) return true
    const bounded =
      typeof options.sectionCap === "number" ? readContextTrimText(block, options.pointer, options.sectionCap) : block
    if (!bounded) return true

    const separatorChars = sections.length > 0 ? 1 : 0
    const remaining = READ_CONTEXT_OUTPUT_CHAR_BUDGET - usedChars - separatorChars
    if (remaining <= 0) return false
    const fits = bounded.length <= remaining
    const rendered = fits ? bounded : readContextTrimText(bounded, options.pointer, remaining)
    if (!rendered) return false
    sections.push(rendered)
    usedChars += separatorChars + rendered.length
    return fits
  }

  function result(): string {
    return sections.length > 0 ? sections.join("\n") : "No context available yet."
  }

  return { add, result }
}

function normalizeReadContextBlock(lines: Array<string | undefined>): string {
  return lines
    .filter((line): line is string => typeof line === "string")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function readContextTrimText(text: string, pointer: string, cap: number): string {
  if (cap <= 0) return ""
  if (text.length <= cap) return text
  const marker = `\n[read_context omitted ${text.length - cap} chars; full detail: ${pointer}]`
  if (marker.length >= cap) return `[read_context output budget reached; full detail: ${pointer}]`.slice(0, cap)
  const sliceLength = Math.max(0, cap - marker.length)
  return `${text.slice(0, sliceLength)}${marker}`
}

type OrchestratorToolExecutionContext = {
  orchestratorSessionID: string
  orchestratorMessageID: string
  toolCallID: string
  toolPartID: string
}

type TaskOrchestratorToolExecutionExpectation = {
  taskID: string
  agentSessionID: string
}

function requireOrchestratorToolExecutionContext(options: unknown, toolName: string): OrchestratorToolExecutionContext {
  const meta = (options as { opencorvus?: Record<string, unknown> } | undefined)?.opencorvus
  const orchestratorSessionID = typeof meta?.sessionID === "string" ? meta.sessionID : ""
  const orchestratorMessageID = typeof meta?.messageID === "string" ? meta.messageID : ""
  const toolCallID = typeof meta?.toolCallID === "string" ? meta.toolCallID : ""
  const toolPartID = typeof meta?.toolPartID === "string" ? meta.toolPartID : ""
  if (!orchestratorSessionID || !orchestratorMessageID || !toolCallID || !toolPartID) {
    throw new Error(
      `${toolName}: missing real tool execution identity; refusing to run because ownership cannot be tied to a persisted message/tool part.`,
    )
  }
  return { orchestratorSessionID, orchestratorMessageID, toolCallID, toolPartID }
}

async function requireTaskOrchestratorToolExecutionContext(
  options: unknown,
  toolName: string,
  expected: TaskOrchestratorToolExecutionExpectation,
): Promise<OrchestratorToolExecutionContext> {
  const toolExecution = requireOrchestratorToolExecutionContext(options, toolName)
  const sdkToolCallID =
    typeof (options as { toolCallId?: unknown } | undefined)?.toolCallId === "string"
      ? (options as { toolCallId: string }).toolCallId
      : ""
  if (!sdkToolCallID || sdkToolCallID !== toolExecution.toolCallID) {
    throw new Error(
      `${toolName}: tool execution identity callID does not match the AI SDK tool call identity; refusing to write an unauditable A2A response.`,
    )
  }
  if (toolExecution.orchestratorSessionID !== expected.agentSessionID) {
    throw new Error(
      `${toolName}: tool execution identity session ${toolExecution.orchestratorSessionID} does not match current orchestrator session ${expected.agentSessionID}.`,
    )
  }
  const owningTaskID = taskIDForSession(toolExecution.orchestratorSessionID)
  if (owningTaskID !== expected.taskID) {
    throw new Error(
      `${toolName}: tool execution identity session ${toolExecution.orchestratorSessionID} belongs to task ${owningTaskID ?? "unknown"}, not ${expected.taskID}.`,
    )
  }

  let message: Message.WithParts
  try {
    message = await Message.get({
      sessionID: toolExecution.orchestratorSessionID,
      messageID: toolExecution.orchestratorMessageID,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `${toolName}: persisted orchestrator message ${toolExecution.orchestratorMessageID} was not found in session ${toolExecution.orchestratorSessionID}; ${detail}`,
    )
  }
  if (message.info.role !== "assistant") {
    throw new Error(
      `${toolName}: persisted orchestrator message ${toolExecution.orchestratorMessageID} is ${message.info.role}, not assistant.`,
    )
  }
  const part = message.parts.find((candidate) => candidate.id === toolExecution.toolPartID)
  if (!part) {
    throw new Error(
      `${toolName}: persisted tool part ${toolExecution.toolPartID} was not found on orchestrator message ${toolExecution.orchestratorMessageID}.`,
    )
  }
  if (part.type !== "tool" || part.callID !== toolExecution.toolCallID || part.tool !== toolName) {
    throw new Error(
      `${toolName}: persisted tool part ${toolExecution.toolPartID} does not match tool=${toolName} callID=${toolExecution.toolCallID}.`,
    )
  }
  return toolExecution
}

/**
 * Orchestrator-side bash is narrowly scoped to git merge-state repair only
 * (per the operator's binding directive). The schema rejects any non-git
 * invocation, any pipeline / redirect / command substitution, and any
 * process-killing pattern. This is data-integrity guarding for an
 * irreversible-by-LLM surface (shell execution); prompt-level rules carry only
 * the "what counts as a merge repair" scoping.
 */
export function validateOrchestratorBashCommand(command: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = command.trim()
  if (!trimmed) return { ok: false, reason: "empty command" }
  if (trimmed !== "git" && !/^git[\s]/.test(trimmed)) {
    const head = trimmed.split(/\s+/, 1)[0] ?? ""
    return {
      ok: false,
      reason: `command must begin with 'git' (got '${head}'). Orchestrator bash is git-merge-only — dispatch a sub-agent for any other surface.`,
    }
  }
  // Reject shell metacharacters that turn a single git invocation into a
  // multi-step pipeline / redirect / subshell. Longer tokens first so the
  // reason string reports the most specific match.
  const dangerous: Array<[string, string]> = [
    ["&&", "chain (&&)"],
    ["||", "chain (||)"],
    ["$(", "command substitution ($(...))"],
    ["<(", "process substitution (<(...))"],
    [">(", "process substitution (>(...))"],
    [">>", "redirection (>>)"],
    ["|", "pipeline (|)"],
    [";", "command separator (;)"],
    ["&", "background / chain (&)"],
    [">", "redirection (>)"],
    ["<", "redirection / heredoc (<)"],
    ["`", "command substitution (backtick)"],
    ["\n", "newline command separator"],
    ["\r", "carriage-return command separator"],
  ]
  for (const [tok, why] of dangerous) {
    if (trimmed.includes(tok)) {
      return {
        ok: false,
        reason: `disallowed shell metacharacter ${why}. Orchestrator bash runs a single git invocation only; chain orchestrator tool calls instead of shell.`,
      }
    }
  }
  if (isHostKillingCommand(trimmed)) {
    return {
      ok: false,
      reason:
        "command matches host-process-killing pattern. Use a process-specific path (kill a PID you own); never name-killing.",
    }
  }
  return { ok: true }
}

async function runGoalContractAuditCriteria(input: {
  taskID: string
  goal: ReturnType<typeof findGoal>
  goalRunID?: string
  workDir: string
  task: TaskRow
}): Promise<ContractAuditCriteriaResult[]> {
  const goal = input.goal
  if (!goal) return []
  const acceptanceSpecs = (Array.isArray(goal.acceptance_specs) ? goal.acceptance_specs : []) as AcceptanceSpec[]
  const contractAuditSpecs = acceptanceSpecs.flatMap((spec) =>
    spec.scorers
      .filter((scorer): scorer is ContractAuditScorer => scorer.type === "contract_audit")
      .map((scorer) => ({ spec, scorer })),
  )
  if (contractAuditSpecs.length === 0) return []

  const graph = findLatestArchitectContractGraph(input.taskID)
  if (!graph) {
    return contractAuditSpecs.map(({ spec, scorer }) => ({
      name: `acceptance:${spec.id}:${scorer.name}`,
      label: `${spec.title} / ${scorer.name}`,
      family: "contract_audit",
      status: "failed",
      evidence: `goal=${goal.id}; contract_audit scorer references graph contracts but no architect_contract_graph artifact exists`,
      goal_id: goal.id,
      goal_run_id: input.goalRunID,
    }))
  }
  const graphContractIDs = new Set(graph.contracts.map((contract) => contract.id))
  const missingContractIDs = contractAuditSpecs.flatMap(({ scorer }) =>
    scorer.spec.contract_ids.filter((contractID) => !graphContractIDs.has(contractID)),
  )
  if (missingContractIDs.length > 0) {
    return contractAuditSpecs.map(({ spec, scorer }) => ({
      name: `acceptance:${spec.id}:${scorer.name}`,
      label: `${spec.title} / ${scorer.name}`,
      family: "contract_audit",
      status: "failed",
      evidence: `goal=${goal.id}; contract_audit references unknown graph contract ids: ${[...new Set(missingContractIDs)].join(", ")}`,
      goal_id: goal.id,
      goal_run_id: input.goalRunID,
    }))
  }

  const goalContract = {
    id: goal.id,
    kind: typeof goal.kind === "string" ? goal.kind : undefined,
    owned_paths: Array.isArray(goal.owned_paths) ? (goal.owned_paths as string[]) : [],
  }

  return contractAuditSpecs.map(({ spec, scorer }) => ({
    ...runContractAudit({
      workDir: input.workDir,
      index: contractGraphIRIndex(graph),
      goal: goalContract,
      spec,
      scorer,
    }),
    goal_id: goal.id,
    goal_run_id: input.goalRunID,
  }))
}

type IntegrityReviewOutcome =
  | {
      status: "blocked"
      headline: string
      pointer: string
    }
  | {
      status: "continuation"
      result: ReturnType<typeof SubAgentProtocol.yieldResult>
    }
  | {
      status: "reviewed"
      specSnapshotID: string
      phase: "pre_build" | "post_build"
      verdict: "pass" | "concerns" | "needs_correction"
      summary: string
      sessionID: string
      goalCount: number
      perDimension: Array<string>
      reviewerCount: number
      findingsCount: number
      requiredRepairsCount: number
      unresolvedDisagreementsCount: number
      /** Full per-dimension breakdown including issues / corrections /
       *  missing_goals — kept on the outcome so every consumer (build tool
       *  return, renderIntegrityOutcome, recordIntegrityAttempt persistence,
       *  read_context, acceptance upstream context) renders the same complete
       *  text instead of a count summary. The orchestrator LLM reads this
       *  markdown and decides modify_goal / build / architect / fail_task
       *  itself; nothing in code routes/supersedes from the outcome. */
      markdown: string
      findings: IntegrityFinding[]
      requiredRepairs: IntegrityRequiredRepair[]
      unresolvedDisagreements: IntegrityUnresolvedDisagreement[]
      integrityAttemptID?: string
      artifactMissing?: {
        sessionID: string
        error: string
      }
    }

// renderIntegrityMarkdown lives in @/integrity/render-markdown so it can be
// unit-tested without pulling the full orchestrator import graph; imported below.

// Post-build architecture review is task/spec scoped. Parallel Build tool
// calls can complete in the same orchestrator turn; without this single-flight
// latch they all create independent integrity sessions and duplicate retry
// actions for the same graph snapshot.
const integrityReviewSingleflight = new Map<string, Promise<IntegrityReviewOutcome>>()

const PersistedArchitectFidelitySchema = z.object({
  sourceCoverage: z.array(SourceCoverageEntrySchema).default([]),
  referenceCoverage: z.array(ReferenceCoverageEntrySchema).default([]),
  assemblyOwners: z.array(AssemblyOwnerEntrySchema).default([]),
})

function readPersistedArchitectFidelity(task: TaskRow): ArchitectFidelityState {
  const metadata =
    task.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)
      ? (task.metadata as Record<string, unknown>)
      : {}
  const raw = metadata.architect_fidelity
  const parsed = PersistedArchitectFidelitySchema.safeParse(raw)
  if (parsed.success) return parsed.data
  return {
    sourceCoverage: [],
    referenceCoverage: [],
    assemblyOwners: [],
  }
}

type StoredGoalRow = ReturnType<typeof listGoals>[number]
type ParsedBuildRequirement = ReturnType<typeof parsedRequirementFromRow>

function stringArrayColumn(value: unknown, field: string): string[] {
  if (value == null) return []
  if (!Array.isArray(value)) throw new Error(`${field} must be a JSON string array`)
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

function scopedRequirementsForBuildGoal(input: {
  reqRows: ReturnType<typeof findRequirements>
  goal: StoredGoalRow
}): ParsedBuildRequirement[] {
  const requirementIDs = stringArrayColumn(input.goal.requirement_ids, `engine_goal(${input.goal.id}).requirement_ids`)
  if (requirementIDs.length === 0) return []
  const parsed = input.reqRows.map(parsedRequirementFromRow)
  const byID = new Map(parsed.map((requirement) => [requirement.id, requirement]))
  const missing = requirementIDs.filter((id) => !byID.has(id))
  if (missing.length > 0) {
    throw new Error(`Cannot build goal ${input.goal.id}: active spec is missing requirement ids ${missing.join(", ")}`)
  }
  return requirementIDs.map((id) => byID.get(id)!)
}

function scopedCollaborationGoalsForBuild(input: {
  goals: StoredGoalRow[]
  targetGoalID: string
}): NonNullable<import("@/build/agent").BuildAgent.BuildContext["collaborationGoals"]> {
  const byID = new Map(input.goals.map((goal) => [goal.id, goal]))
  const target = byID.get(input.targetGoalID)
  const relevantIDs = new Set<string>([input.targetGoalID])
  if (target) {
    for (const depID of stringArrayColumn(target.depends_on, `engine_goal(${target.id}).depends_on`)) {
      relevantIDs.add(depID)
    }
  }
  for (const goal of input.goals) {
    const dependsOn = stringArrayColumn(goal.depends_on, `engine_goal(${goal.id}).depends_on`)
    if (dependsOn.includes(input.targetGoalID)) relevantIDs.add(goal.id)
  }
  return input.goals
    .filter((goal) => relevantIDs.has(goal.id))
    .map((goal) => ({
      id: goal.id,
      title: goal.title,
      kind: goal.kind,
      status: goalStatusByID(goal.id),
      owned_paths: stringArrayColumn(goal.owned_paths, `engine_goal(${goal.id}).owned_paths`),
      depends_on: stringArrayColumn(goal.depends_on, `engine_goal(${goal.id}).depends_on`),
    }))
}

function scopedFidelityForBuildGoal(input: {
  goalID: string
  fidelity: ArchitectFidelityState
}): import("@/build/agent").BuildAgent.BuildContext["fidelity"] | undefined {
  const sourceCoverage = input.fidelity.sourceCoverage.filter((row) => row.goal_ids.includes(input.goalID))
  const referenceCoverage = input.fidelity.referenceCoverage.filter((row) => row.goal_ids.includes(input.goalID))
  const assemblyOwners = input.fidelity.assemblyOwners.filter((row) => row.goal_id === input.goalID)
  if (sourceCoverage.length === 0 && referenceCoverage.length === 0 && assemblyOwners.length === 0) return undefined
  return { sourceCoverage, referenceCoverage, assemblyOwners }
}

function findLiveGoalRunByGoalID(goalID: string) {
  return listGoalRunsByGoal(goalID).find((goalRun) => isLiveGoalRunStatus(goalRun.status))
}

function goalMutationBlockedByLiveWork(input: { taskID: string; goalID: string; action: string }): string | undefined {
  const liveGoalRun = findLiveGoalRunByGoalID(input.goalID)
  if (liveGoalRun) {
    return (
      `Error: ${input.action} refused because goal ${input.goalID} already has live goal_run ${liveGoalRun.id} ` +
      `(status=${liveGoalRun.status}, session ${liveGoalRun.session_id ?? "n/a"}). ` +
      `Wait for terminal refill evidence or cancel the live attempt before mutating the goal.`
    )
  }
  const liveOwner = findLiveBuildOwnershipByGoal({ taskID: input.taskID, goalID: input.goalID })
  if (liveOwner) {
    return (
      `Error: ${input.action} refused because goal ${input.goalID} is currently owned by live build tool ` +
      `${liveOwner.payload.tool_part_id} (session ${liveOwner.payload.child_session_id}, ownership ${liveOwner.ownershipID}). ` +
      `Wait for that build result before mutating the goal.`
    )
  }
  return undefined
}

function assertNoLiveGoalRunForBuild(input: { taskID: string; goalID: string; action: string }): void {
  const liveGoalRun = findLiveGoalRunByGoalID(input.goalID)
  if (!liveGoalRun) return
  throw new Error(
    `${input.action}: goal ${input.goalID} already has live goal_run ${liveGoalRun.id} ` +
      `(status=${liveGoalRun.status}, session ${liveGoalRun.session_id ?? "n/a"}); do not call wait for this internal live build. Park this wake until terminal refill evidence appears, or abort the live attempt explicitly.`,
  )
}

function renderEvidenceSourceManifest(input: {
  task: TaskRow
  projectDir: string
  liveUrls: readonly string[]
  figmaUrls: readonly string[]
  materialPaths: readonly string[]
  referenceArtifacts: readonly string[]
  mirrorArtifacts?: readonly string[]
  materializedFiles?: readonly string[]
}): string {
  const lines: string[] = []
  const paths = frontendDesignArtifactPaths(input.projectDir, input.task.id)
  lines.push("## frontend_design Public Report Source Manifest")
  lines.push(`Canonical frontend_design public report file: ${paths.templateRelative}`)
  lines.push(`Canonical source manifest file: ${paths.manifestRelative}`)
  lines.push(
    "Canonical decision-log entries: phase=frontend_design keys public_report, frontend_template, final_acceptance_mode, fillable_modules, component_reuse_plan, baseline_replacement_plan, quality_project_contract, frontend_project, material_inventory, visual_consistency_contract, ui_data_contract, template_iteration_notes, completeness_review, open_questions.",
  )
  lines.push(
    "Optional visual anchors: task.design_specs, when present. They are secondary to visual_consistency_contract.",
  )

  if (input.materializedFiles && input.materializedFiles.length > 0) {
    lines.push("")
    lines.push("### Materialized frontend_design report files")
    for (const item of [...new Set(input.materializedFiles)]) lines.push(`- ${item}`)
  }

  const requestUrls = [...new Set([...input.task.request.matchAll(/https?:\/\/\S+/gi)].map((m) => m[0]))]
  const urls = [...new Set([...requestUrls, ...input.liveUrls])]
  if (urls.length > 0) {
    lines.push("")
    lines.push("### Live URL sources")
    for (const item of urls) lines.push(`- ${item}`)
  }

  if (input.figmaUrls.length > 0) {
    lines.push("")
    lines.push("### Figma sources")
    for (const item of [...new Set(input.figmaUrls)]) lines.push(`- ${item}`)
  }

  if (input.materialPaths.length > 0) {
    lines.push("")
    lines.push("### Local material sources")
    for (const item of [...new Set(input.materialPaths)]) lines.push(`- ${item}`)
  }

  const renderArtifactRows = (title: string, artifacts: readonly unknown[]) => {
    if (artifacts.length === 0) return
    lines.push("")
    lines.push(`### ${title}`)
    artifacts.forEach((raw, index) => {
      const item = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
      const filename =
        typeof item.filename === "string" && item.filename.trim() ? item.filename : `attachment-${index + 1}`
      const mime = typeof item.mime === "string" && item.mime.trim() ? item.mime : "application/octet-stream"
      const source = typeof item.source === "string" && item.source.trim() ? ` source=${item.source}` : ""
      const intent = typeof item.intent === "string" && item.intent.trim() ? ` intent=${item.intent}` : ""
      const sha = typeof item.sha === "string" && item.sha.trim() ? ` sha=${item.sha}` : ""
      const url = typeof item.url === "string" && item.url.trim() ? ` url=${item.url}` : ""
      lines.push(`- ${filename} — ${mime}${source}${intent}${sha}${url}`)
    })
  }

  renderArtifactRows(
    "User/task attachments",
    Array.isArray(input.task.attachments) ? (input.task.attachments as unknown[]) : [],
  )
  renderArtifactRows(
    "frontend_design materialized artifacts",
    Array.isArray(input.task.system_artifacts) ? (input.task.system_artifacts as unknown[]) : [],
  )

  if (input.referenceArtifacts.length > 0) {
    lines.push("")
    lines.push("### Evidence artifacts cited by frontend_design")
    for (const item of input.referenceArtifacts) lines.push(`- ${item}`)
  }

  if (input.mirrorArtifacts && input.mirrorArtifacts.length > 0) {
    lines.push("")
    lines.push("### Host-prepared webpage clone artifacts")
    for (const item of [...new Set(input.mirrorArtifacts)]) lines.push(`- ${item}`)
  }

  return lines.join("\n")
}

function renderMaterializedFrontendDesignReport(input: {
  report: AgentReport
  evidenceSourceManifest: string
}): string {
  return (
    [
      "# Frontend Design Public Report",
      "",
      "This file is the materialized frontend_design terminal report for downstream agents.",
      "The report is the public readable handoff; the evidence manifest below names source files and images to read.",
      "",
      "## Evidence Source Manifest",
      input.evidenceSourceManifest.trim(),
      "",
      input.report.detail.trim(),
    ]
      .join("\n")
      .trimEnd() + "\n"
  )
}

async function writeFrontendDesignArtifacts(input: {
  projectDir: string
  taskID: string
  report: AgentReport
  evidenceSourceManifest: string
}): Promise<{ templateRelative: string; manifestRelative: string }> {
  const paths = frontendDesignArtifactPaths(input.projectDir, input.taskID)
  await Filesystem.writeAtomic(paths.manifestAbsolute, input.evidenceSourceManifest.trimEnd() + "\n")
  await Filesystem.writeAtomic(
    paths.templateAbsolute,
    renderMaterializedFrontendDesignReport({
      report: input.report,
      evidenceSourceManifest: input.evidenceSourceManifest,
    }),
  )
  return {
    templateRelative: paths.templateRelative,
    manifestRelative: paths.manifestRelative,
  }
}

function acceptanceSpecsToPromptLines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map((spec) => {
    if (typeof spec === "string") return spec
    try {
      return renderSpecsAsText([spec as AcceptanceSpec])
    } catch {
      return JSON.stringify(spec)
    }
  })
}

const ModifyGoalInputSchema = z.object({
  goalID: z.string().min(1).describe("The goal ID to modify."),
  updates: GoalContractUpdateSchema.describe(
    "Partial goal contract replacement. Include only fields that must change; every included field fully replaces the prior value.",
  ),
  reason: z.string().min(1).describe("Why you decided to modify this goal."),
})

const AddGoalInputSchema = z.object({
  goal: GoalContractFieldsSchema.omit({ id: true }).describe(
    "Complete goal contract to append, without id. Must include title, objective, owned_paths, requirement_ids, acceptance_specs, dependency fields, priority, and kind from the latest task evidence.",
  ),
  reason: z
    .string()
    .min(1)
    .describe("Evidence that this new goal comes from the latest operator instruction or current task findings."),
})

const CompleteGoalInputSchema = z.object({
  goalID: z.string().min(1).describe("The existing goal ID to mark completed."),
  reason: z.string().min(1).describe("Concrete evidence proving this goal no longer needs build work."),
})

const DeleteGoalInputSchema = z.object({
  goalID: z.string().min(1).describe("The existing goal ID to delete from the current task goal graph."),
  reason: z.string().min(1).describe("Concrete evidence proving this goal is obsolete or out of current task scope."),
})

const FrontendDesignReasonField = z
  .string()
  .describe(
    "Why frontend_design is the right visual implementation-template producer for the current task. Name the requested deliverable, the visual reference source, and why the downstream workflow needs a frontend_design public report/evidence manifest instead of only research notes. For live webpage clones with no non-stale Page Skeleton Blueprint, call frontend_research before frontend_design instead of using frontend_design to discover page information architecture.",
  )
const FrontendDesignUrlsField = z
  .array(z.string().min(1).refine(isHttpWebpageUrl, "frontend_design urls entries must be HTTP(S) URLs"))
  .optional()
  .describe(
    "Fresh frontend_design visual reference URLs. Use the plural field `urls`; do not send legacy `url`, `source_url`, or `source_urls`. Provide at most one non-Figma live/page URL for the primary webpage clone evidence package, plus any Figma design links. Non-Figma URLs are rendered for webpage evidence extraction and screenshot materialization only after the live webpage clone's source-backed Page Skeleton Blueprint is already available or not needed. Figma URLs use the connected Figma MCP path. Use only when the URL is implementation/clone/visual-parity evidence, not merely PRD/SPEC/report source material.",
  )
const FrontendDesignFigmaUrlField = z
  .string()
  .optional()
  .describe(
    "Single Figma file URL materialized through the connected Figma MCP server (figma.com/file/... or figma.com/design/...). Use this field or include the Figma URL in `urls`; do not duplicate the same link in both fields. Requires Figma MCP tools get_design_context, get_screenshot, get_metadata, and get_variable_defs.",
  )
const FrontendDesignMaterialsField = z
  .array(z.string())
  .optional()
  .describe(
    "Fresh frontend_design local visual-material paths, relative to the project root or absolute under it. Supported: images, PDFs, markdown/text style guides, design-tokens JSON, and CSS. Each path is read from disk and materialized as a visual_reference. Do not use this field for generated build output or for webpage source URLs; use `urls` for HTTP(S) visual references.",
  )

const FrontendDesignInputSchema = z
  .object({})
  .extend({ reason: FrontendDesignReasonField })
  .extend({ urls: FrontendDesignUrlsField })
  .extend({ figma_url: FrontendDesignFigmaUrlField })
  .extend({ materials: FrontendDesignMaterialsField })
  .extend({ continuation_artifact_id: StageContinuationArtifactIDField })
  .strict()
  .superRefine((input, ctx) => {
    const hasContinuation =
      typeof input.continuation_artifact_id === "string" && input.continuation_artifact_id.length > 0
    const liveUrls = (Array.isArray(input.urls) ? input.urls : []).filter(
      (url) => typeof url === "string" && url.length > 0 && !isFigmaUrl(url),
    )
    if (!hasContinuation && liveUrls.length > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["urls"],
        message:
          "frontend_design accepts at most one non-Figma live/page URL because the task-scoped webpage clone evidence package has one primary source URL.",
      })
    }
    if (!hasContinuation) return
    const freshFields = [
      Array.isArray(input.urls) && input.urls.length > 0 ? "urls" : undefined,
      typeof input.figma_url === "string" && input.figma_url.length > 0 ? "figma_url" : undefined,
      Array.isArray(input.materials) && input.materials.length > 0 ? "materials" : undefined,
    ].filter((field): field is string => !!field)
    for (const field of freshFields) {
      ctx.addIssue({
        code: "custom",
        path: [field],
        message:
          "frontend_design continuation_artifact_id resumes an existing same-session finalizer recovery and cannot be combined with fresh visual scope fields.",
      })
    }
  })

const FrontendResearchReasonField = z
  .string()
  .min(1)
  .describe(
    "Why frontend_research should publish source-backed webpage investigation packets now. Name the page scope and the downstream requirement/architect/build coverage need. This is not the frontend implementation template; use frontend_design for that. Do not use a new focus on an already-briefed source URL as a reason for a fresh frontend_research call.",
  )
const FrontendResearchSourceUrlsField = z
  .array(
    z.string().min(1).refine(isHttpWebpageUrl, "frontend_research source_urls entries must be HTTP(S) webpage URLs"),
  )
  .min(1)
  .max(1)
  .describe(
    "Fresh frontend_research source page URLs. Use the plural field `source_urls`; do not send `url`, `source_url`, or frontend_design's `urls`. Provide exactly one HTTP(S) webpage URL per fresh call so the host prepares rendered evidence for that page and the agent partitions it into source-backed functional, visual, interaction, content, responsive, and fidelity work packets. Call frontend_research separately only for additional page URLs. Same URL plus a different focus, viewport, interaction state, component, region, fidelity risk, or missing-detail question is still the same source-page scope.",
  )
const FrontendResearchFocusField = z
  .string()
  .optional()
  .describe(
    "Optional fresh-session focus for the frontend_research agent on a not-yet-briefed source URL. Focus narrows the first brief only; it cannot turn an already-briefed source URL into a new source-page scope. Omit during continuation recovery.",
  )

const FrontendResearchInputSchema = z
  .object({})
  .extend({ reason: FrontendResearchReasonField })
  .extend({ source_urls: FrontendResearchSourceUrlsField.optional() })
  .extend({ focus: FrontendResearchFocusField })
  .extend({ continuation_artifact_id: StageContinuationArtifactIDField })
  .strict()
  .superRefine((input, ctx) => {
    const hasSourceUrls = Array.isArray(input.source_urls) && input.source_urls.length > 0
    const hasContinuation =
      typeof input.continuation_artifact_id === "string" && input.continuation_artifact_id.length > 0
    const hasFocus = typeof input.focus === "string" && input.focus.trim().length > 0
    if (hasSourceUrls === hasContinuation) {
      ctx.addIssue({
        code: "custom",
        path: hasSourceUrls ? ["continuation_artifact_id"] : ["source_urls"],
        message:
          "frontend_research requires exactly one input mode: source_urls for a fresh research session, or continuation_artifact_id for same-session finalizer recovery.",
      })
    }
    if (hasContinuation && hasFocus) {
      ctx.addIssue({
        code: "custom",
        path: ["focus"],
        message:
          "frontend_research continuation_artifact_id resumes an existing same-session finalizer recovery and cannot be combined with fresh focus.",
      })
    }
  })

const DeepResearchInputSchema = z
  .object({
    reason: z.string().min(1).describe("Why evidence research is needed for this task."),
    target_deliverable: z
      .enum(["prd", "spec", "research_report", "implementation_input", "mixed"])
      .optional()
      .describe("The likely document/input shape being researched."),
    source_urls: z
      .array(z.string().min(1))
      .default([])
      .describe("Known source URLs the research agent must webfetch before any broader discovery."),
    focus: z.string().optional().describe("Optional narrow focus for the research agent."),
    continuation_artifact_id: StageContinuationArtifactIDField,
  })
  .strict()
  .superRefine((input, ctx) => {
    const hasContinuation =
      typeof input.continuation_artifact_id === "string" && input.continuation_artifact_id.length > 0
    if (!hasContinuation) return

    const freshFields = [
      input.target_deliverable ? "target_deliverable" : undefined,
      Array.isArray(input.source_urls) && input.source_urls.length > 0 ? "source_urls" : undefined,
      typeof input.focus === "string" && input.focus.length > 0 ? "focus" : undefined,
    ].filter((field): field is string => Boolean(field))

    for (const field of freshFields) {
      ctx.addIssue({
        code: "custom",
        path: [field],
        message:
          "deep_research continuation_artifact_id resumes an existing same-session finalizer recovery and cannot be combined with fresh research scope fields.",
      })
    }
  })

const VisualQaInputSchema = z
  .object({
    reason: z
      .string()
      .min(1)
      .describe("Why dedicated frontend visual GUI fidelity and functional testing is useful now."),
    focus: z.string().optional().describe("Optional narrowed region/state/viewport focus for visual QA."),
    app_url: z
      .string()
      .optional()
      .describe("Known preview URL to inspect. Omit when the agent should discover/start preview from scripts."),
    preview_command: z
      .string()
      .optional()
      .describe(
        "Suggested project command to start the real preview target. Use Node for Playwright/browser automation on Windows.",
      ),
    continuation_artifact_id: StageContinuationArtifactIDField,
  })
  .strict()
  .superRefine((input, ctx) => {
    const hasContinuation =
      typeof input.continuation_artifact_id === "string" && input.continuation_artifact_id.length > 0
    if (!hasContinuation) return

    const freshFields = [
      typeof input.focus === "string" && input.focus.length > 0 ? "focus" : undefined,
      typeof input.app_url === "string" && input.app_url.length > 0 ? "app_url" : undefined,
      typeof input.preview_command === "string" && input.preview_command.length > 0 ? "preview_command" : undefined,
    ].filter((field): field is string => Boolean(field))

    for (const field of freshFields) {
      ctx.addIssue({
        code: "custom",
        path: [field],
        message:
          "visual_qa continuation_artifact_id resumes an existing same-session finalizer recovery and cannot be combined with fresh visual QA scope fields.",
      })
    }
  })

const FactCheckInputSchema = z
  .object({
    target_session_id: z
      .string()
      .min(1)
      .optional()
      .describe("Session id of the worker whose terminal report you want fact-checked."),
    target_agent: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Optional consistency check for the worker agent name. The host derives the actual value from target_session_id.",
      ),
    fact_check_items: FactCheckItemListSchema.optional().describe(
      "Copy of the fact_check_items[] array from the worker's terminal report. " +
        "Empty array is allowed only when you also explain `reason` why fact-check is " +
        "still useful (e.g., load-bearing prose claims the worker didn't register).",
    ),
    reason: z.string().min(10).describe("Why you decided to dispatch fact-check on this worker output."),
    continuation_artifact_id: StageContinuationArtifactIDField,
  })
  .strict()
  .superRefine((input, ctx) => {
    const hasContinuation =
      typeof input.continuation_artifact_id === "string" && input.continuation_artifact_id.length > 0
    const freshFields = [
      typeof input.target_session_id === "string" && input.target_session_id.length > 0
        ? "target_session_id"
        : undefined,
      typeof input.target_agent === "string" && input.target_agent.length > 0 ? "target_agent" : undefined,
      Array.isArray(input.fact_check_items) ? "fact_check_items" : undefined,
    ].filter((field): field is string => !!field)
    if (hasContinuation) {
      for (const field of freshFields) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message:
            "fact_check continuation_artifact_id resumes the original same-session finalizer recovery and cannot be combined with fresh target fields.",
        })
      }
      return
    }
    for (const field of ["target_session_id", "fact_check_items"] as const) {
      if (freshFields.includes(field)) continue
      ctx.addIssue({
        code: "custom",
        path: [field],
        message: `fact_check fresh mode requires ${field}.`,
      })
    }
  })

const FactCheckStageInputSchema = z
  .object({
    target_session_id: z.string().min(1),
    target_agent: z.string().min(1),
    fact_check_items: FactCheckItemListSchema,
    reason: z.string().min(10),
    target_message_id: z.string().min(1),
    target_message_content_hash: z.string().min(1),
  })
  .strict()

type FactCheckStageInput = z.infer<typeof FactCheckStageInputSchema>

function resolveFactCheckTargetScope(input: {
  taskID: string
  targetSessionID: string
  assertedTargetAgent?: string
}): { targetAgent: string } | { error: string } {
  const owningTaskID = taskIDForSession(input.targetSessionID)
  if (owningTaskID !== input.taskID) {
    return {
      error:
        owningTaskID === undefined
          ? `target_session_id ${input.targetSessionID} is not owned by any task.`
          : `target_session_id ${input.targetSessionID} belongs to task ${owningTaskID}, not current task ${input.taskID}.`,
    }
  }
  const targetAgent = sessionRole(input.targetSessionID)
  if (!targetAgent) {
    return { error: `target_session_id ${input.targetSessionID} has no session kind to derive target_agent.` }
  }
  const asserted = input.assertedTargetAgent?.trim()
  if (asserted && asserted !== targetAgent) {
    return {
      error:
        `target_agent mismatch for ${input.targetSessionID}: caller asserted ${asserted}, ` +
        `but the session kind is ${targetAgent}.`,
    }
  }
  return { targetAgent }
}

const IntegrityInputSchema = z
  .object({
    reason: z.string().optional().describe("Why you decided to run integrity review"),
    continuation_artifact_id: StageContinuationArtifactIDField,
  })
  .strict()

type IntegrityToolInput = z.infer<typeof IntegrityInputSchema>

const CompleteTaskInputSchema = z
  .object({
    integrity_attempt_id: z.string().min(1).describe("Latest post-build pass integrity_attempt artifact id"),
    summary: z.string().optional().describe("Short terminal summary for the task lifecycle event"),
  })
  .strict()

const IntegrityStageInputSchema = z
  .object({
    reason: z.string().optional(),
    active_spec_snapshot_id: z.string().min(1),
    phase: z.enum(["pre_build", "post_build"]),
    goal_ids: z.array(z.string().min(1)),
    evidence_snapshot: EvidenceSnapshotSchema,
  })
  .strict()

type IntegrityStageInput = z.infer<typeof IntegrityStageInputSchema>

function integrityContinuationFromArtifact(input: { taskID: string; artifactID: string }): {
  continuation: AgentSessionContinuation
  normalizedStageInput: IntegrityStageInput
} {
  const finalizerName = "submit_integrity_consensus"
  const continuation = continuationFromArtifact({
    taskID: input.taskID,
    stage: "integrity",
    artifactID: input.artifactID,
    finalizerName,
  })
  const row = findStageContinuationRequest({ taskID: input.taskID, artifactID: input.artifactID })
  if (!row) throw new Error(`stage continuation request not found: ${input.artifactID}`)
  const parsed = IntegrityStageInputSchema.safeParse(row.payload.normalized_stage_input)
  if (!parsed.success) {
    throw new Error(
      `stage continuation ${input.artifactID} does not contain a valid integrity normalized_stage_input: ${parsed.error.message}`,
    )
  }
  return { continuation, normalizedStageInput: parsed.data }
}

function factCheckContinuationFromArtifact(input: { taskID: string; artifactID: string }): {
  continuation: AgentSessionContinuation
  normalizedStageInput: FactCheckStageInput
} {
  const finalizerName = "report_fact_check_result"
  const continuation = continuationFromArtifact({
    taskID: input.taskID,
    stage: "fact-check",
    artifactID: input.artifactID,
    finalizerName,
  })
  const row = findStageContinuationRequest({ taskID: input.taskID, artifactID: input.artifactID })
  if (!row) throw new Error(`stage continuation request not found: ${input.artifactID}`)
  const parsed = FactCheckStageInputSchema.safeParse(row.payload.normalized_stage_input)
  if (!parsed.success) {
    throw new Error(
      `stage continuation ${input.artifactID} does not contain a valid fact_check normalized_stage_input: ${parsed.error.message}`,
    )
  }
  return { continuation, normalizedStageInput: parsed.data }
}

function factCheckContinuationFromDurableRow(input: {
  taskID: string
  artifactID: string
  sourceSessionID: string
}): { row: StageContinuationRequestRow; normalizedStageInput: FactCheckStageInput } | undefined {
  const row = findStageContinuationRequest({ taskID: input.taskID, artifactID: input.artifactID })
  if (!row) return undefined
  if (row.payload.stage !== "fact-check") {
    throw new Error(
      `agent coordination fact_check redispatch recovery continuation ${input.artifactID} targets stage ${row.payload.stage}, not fact-check`,
    )
  }
  if (row.payload.session_id !== input.sourceSessionID) {
    throw new Error(
      `agent coordination fact_check redispatch recovery continuation ${input.artifactID} targets session ${row.payload.session_id}, not ${input.sourceSessionID}`,
    )
  }
  if (row.payload.finalizer_name !== "report_fact_check_result") {
    throw new Error(
      `agent coordination fact_check redispatch recovery continuation ${input.artifactID} targets finalizer ${row.payload.finalizer_name}, not report_fact_check_result`,
    )
  }
  const parsed = FactCheckStageInputSchema.safeParse(row.payload.normalized_stage_input)
  if (!parsed.success) {
    throw new Error(
      `agent coordination fact_check redispatch recovery continuation ${input.artifactID} has invalid normalized_stage_input: ${parsed.error.message}`,
    )
  }
  const digest = stageInputDigest(parsed.data)
  if (row.payload.input_digest !== digest) {
    throw new Error(
      `agent coordination fact_check redispatch recovery continuation ${input.artifactID} input_digest ${row.payload.input_digest} != normalized digest ${digest}`,
    )
  }
  return { row, normalizedStageInput: parsed.data }
}

function findPendingFactCheckContinuationForSourceSession(input: {
  taskID: string
  sessionID: string
}): { row: StageContinuationRequestRow; normalizedStageInput: FactCheckStageInput } | undefined {
  const rows = Database.use((db) =>
    db
      .select({ id: EngineArtifactTable.id })
      .from(EngineArtifactTable)
      .where(
        and(eq(EngineArtifactTable.task_id, input.taskID), eq(EngineArtifactTable.kind, "stage_continuation_request")),
      )
      .all(),
  )
    .map((row) => findStageContinuationRequest({ taskID: input.taskID, artifactID: row.id }))
    .filter((row): row is StageContinuationRequestRow => Boolean(row))
    .filter(
      (row) =>
        row.payload.stage === "fact-check" &&
        row.payload.session_id === input.sessionID &&
        row.payload.finalizer_name === "report_fact_check_result" &&
        !row.payload.claimed_at &&
        !row.payload.claim_failed_at &&
        !row.payload.consumed_at,
    )
    .sort((left, right) => {
      if (left.timeUpdated !== right.timeUpdated) return right.timeUpdated - left.timeUpdated
      return right.artifactID.localeCompare(left.artifactID)
    })

  const invalid: string[] = []
  for (const row of rows) {
    const parsed = FactCheckStageInputSchema.safeParse(row.payload.normalized_stage_input)
    if (!parsed.success) {
      invalid.push(`${row.artifactID}: ${parsed.error.message}`)
      continue
    }
    const digest = stageInputDigest(parsed.data)
    if (row.payload.input_digest !== digest) {
      invalid.push(`${row.artifactID}: input_digest ${row.payload.input_digest} != normalized digest ${digest}`)
      continue
    }
    return { row, normalizedStageInput: parsed.data }
  }

  if (invalid.length > 0) {
    throw new Error(
      `agent coordination fact_check redispatch found pending fact-check continuation artifacts with invalid normalized_stage_input: ${invalid.join("; ")}`,
    )
  }
  return undefined
}

function findRecoverableFactCheckContinuationForRespondedRequest(input: {
  taskID: string
  request: AgentCoordinationRequestRow
}): { row: StageContinuationRequestRow; normalizedStageInput: FactCheckStageInput } | undefined {
  if (input.request.payload.status !== "responded" || !input.request.payload.response_id) return undefined
  const response = findAgentCoordinationResponse({
    taskID: input.taskID,
    responseID: input.request.payload.response_id,
  })
  if (!response) {
    throw new Error(
      `agent coordination fact_check redispatch recovery request ${input.request.payload.request_id} points to missing response ${input.request.payload.response_id}`,
    )
  }
  const action = findAgentCoordinationAction({
    taskID: input.taskID,
    actionID: response.payload.action_id,
  })
  if (!action) {
    throw new Error(
      `agent coordination fact_check redispatch recovery response ${response.payload.response_id} points to missing action ${response.payload.action_id}`,
    )
  }
  if (action.payload.action !== "redispatch_worker") return undefined
  const priorResult = action.payload.result ?? {}
  const binding = priorResult.redispatch_binding as Partial<AgentCoordinationRedispatchBinding> | undefined
  const dispatcher = typeof priorResult.dispatcher === "string" ? priorResult.dispatcher : binding?.dispatcher
  if (dispatcher !== "fact_check_stage") return undefined
  if (action.payload.status !== "pending" && action.payload.status !== "completed") return undefined
  if (priorResult.redispatch_started !== true) return undefined
  const continuationArtifactID =
    typeof priorResult.continuation_artifact_id === "string" ? priorResult.continuation_artifact_id : undefined
  if (!continuationArtifactID) {
    throw new Error(
      `agent coordination fact_check redispatch recovery action ${action.payload.action_id} has no continuation_artifact_id`,
    )
  }
  return factCheckContinuationFromDurableRow({
    taskID: input.taskID,
    artifactID: continuationArtifactID,
    sourceSessionID: input.request.payload.session_id,
  })
}

function resolveSubagentControlTarget(input: {
  taskID: string
  sessionID?: string
  goalID?: string
  goalRunID?: string
}): {
  sessionID: string
  source: string
  goalRunID?: string
} {
  if (input.goalID) {
    const goal = findGoal(input.goalID)
    if (!goal || goal.task_id !== input.taskID) {
      throw new Error(`goal ${input.goalID} does not belong to task ${input.taskID}`)
    }
    const goalRun = findLatestTipGoalRun(input.goalID)
    if (!goalRun) {
      throw new Error(`goal ${input.goalID} has no goal_run yet; dispatch build before controlling it.`)
    }
    if (!goalRun.session_id) {
      throw new Error(
        `goal ${input.goalID} latest goal_run ${goalRun.id} has no child session_id yet; wait for the build session to start or finalize the stale attempt before controlling it.`,
      )
    }
    return {
      sessionID: goalRun.session_id,
      source: `${input.goalID} -> goal_run ${goalRun.id} -> session ${goalRun.session_id}`,
      goalRunID: goalRun.id,
    }
  }

  if (input.goalRunID) {
    const goalRun = findGoalRun(input.goalRunID)
    if (!goalRun || goalRun.task_id !== input.taskID) {
      throw new Error(`goal_run ${input.goalRunID} does not belong to task ${input.taskID}`)
    }
    if (!goalRun.session_id) {
      throw new Error(
        `goal_run ${input.goalRunID} has no child session_id yet; wait for the build session to start or finalize the stale attempt before controlling it.`,
      )
    }
    return {
      sessionID: goalRun.session_id,
      source: `${input.goalRunID} -> session ${goalRun.session_id}`,
      goalRunID: goalRun.id,
    }
  }

  if (!input.sessionID) {
    throw new Error("sub-agent control requires session_id, goal_id, or goal_run_id")
  }
  const byChildSession = listGoalRunsForTask(input.taskID).find((row) => row.session_id === input.sessionID)
  return {
    sessionID: input.sessionID,
    source: input.sessionID,
    goalRunID: byChildSession?.id,
  }
}

function assertDirectReplySessionKind(input: { sessionID: string }): { kind: string } {
  const kind = sessionRole(input.sessionID)
  if (!kind) {
    throw new Error(`Session ${input.sessionID} has no task agent kind`)
  }
  if (!canReceiveDirectAgentSessionControl(kind)) {
    throw new Error(`Session ${input.sessionID} has kind "${kind}" and cannot receive direct agent control`)
  }
  return { kind }
}

function assertDirectReplySessionOwnership(input: {
  taskID: string
  sessionID: string
  goalID?: string
  goalRunID?: string
}): { kind: string; ownershipSource: AgentCoordinationSessionOwnershipSource } {
  const ownership = resolveAgentCoordinationSessionOwnership(input)
  const { kind } = assertDirectReplySessionKind(input)
  return { kind, ownershipSource: ownership.source }
}

function directReplyModelResolutionContext(input: {
  taskID: string
  sessionID: string
  ownershipSource: AgentCoordinationSessionOwnershipSource
}): { taskID?: string; sessionID: string } {
  if (input.ownershipSource === "task_session_tree") {
    return { taskID: input.taskID, sessionID: input.sessionID }
  }
  return { sessionID: input.sessionID }
}

function requireAgentCoordinationRequestForResponse(input: {
  taskID: string
  requestID: string
}): AgentCoordinationRequestRow {
  const request = findAgentCoordinationRequest({
    taskID: input.taskID,
    requestID: input.requestID,
  })
  if (!request) {
    throw new Error(`agent coordination request ${input.requestID} does not belong to task ${input.taskID}`)
  }
  if (request.payload.status !== "pending" && request.payload.status !== "responded") {
    throw new Error(`agent coordination request ${input.requestID} is ${request.payload.status}`)
  }
  return request
}

const AGENT_COORDINATION_REDISPATCH_REPLAY_BINDINGS = {
  build: { dispatcher: "build_stage", stage: "build", target_kind: "build" },
  "intent-analysis": {
    dispatcher: "intent_analysis_stage",
    stage: "intent-analysis",
    target_kind: "intent-analysis",
  },
  explore: { dispatcher: "explore_stage", stage: "explore", target_kind: "explore" },
  "goal-workload-analyst": {
    dispatcher: "workload_analysis_stage",
    stage: "goal-workload-analyst",
    target_kind: "goal-workload-analyst",
  },
  "fact-check": { dispatcher: "fact_check_stage", stage: "fact-check", target_kind: "fact-check" },
  architect: { dispatcher: "architect_stage", stage: "architect", target_kind: "architect" },
  requirements: { dispatcher: "requirements_stage", stage: "requirements", target_kind: "requirements" },
  "frontend-design": {
    dispatcher: "frontend_design_stage",
    stage: "frontend-design",
    target_kind: "frontend-design",
  },
  "frontend-research": {
    dispatcher: "frontend_research_stage",
    stage: "frontend-research",
    target_kind: "frontend-research",
  },
  "deep-research": { dispatcher: "deep_research_stage", stage: "deep-research", target_kind: "deep-research" },
  "visual-qa": { dispatcher: "visual_qa_stage", stage: "visual-qa", target_kind: "visual-qa" },
  integrity: { dispatcher: "integrity_stage", stage: "integrity", target_kind: "integrity" },
} satisfies Record<string, AgentCoordinationRedispatchBinding>

function redispatchBindingForAgentCoordinationReplay(input: {
  request: AgentCoordinationRequestRow
}): AgentCoordinationRedispatchBinding {
  const binding = AGENT_COORDINATION_REDISPATCH_REPLAY_BINDINGS[input.request.payload.agent]
  if (!binding) {
    throw new Error(
      `agent coordination redispatch replay for ${input.request.payload.agent} has no concrete dispatcher binding`,
    )
  }
  return binding
}

async function validateAgentCoordinationContinueTarget(input: {
  taskID: string
  request: AgentCoordinationRequestRow
}) {
  const session = await Session.get(input.request.payload.session_id)
  const { kind, ownershipSource } = assertDirectReplySessionOwnership({
    taskID: input.taskID,
    sessionID: input.request.payload.session_id,
    goalID: input.request.payload.goal_id,
    goalRunID: input.request.payload.goal_run_id,
  })
  const status = SessionStatus.get(input.request.payload.session_id)
  if (status.type === "streaming" || status.type === "retry") {
    throw new Error(
      `agent coordination continue refused because session ${input.request.payload.session_id} is ${status.type}; answer later or cancel the worker explicitly.`,
    )
  }
  if (status.type === "terminal") {
    throw new Error(
      `agent coordination continue refused because session ${input.request.payload.session_id} is terminal (${status.reason}); redispatch the worker under a visible tool call if more work is needed.`,
    )
  }
  const model = await resolveAgentModelRef(
    input.request.payload.agent,
    directReplyModelResolutionContext({
      taskID: input.taskID,
      sessionID: input.request.payload.session_id,
      ownershipSource,
    }),
  )
  const requiresRuntimeContract =
    SessionPrompt.agentKindRequiresRuntimeContract(input.request.payload.agent) ||
    SessionPrompt.agentKindRequiresRuntimeContract(kind)
  const runtimeContract = SessionPrompt.validateSessionRuntimeContractForContinuation({
    sessionID: input.request.payload.session_id,
    sessionKind: kind,
    expectedAgentKind: input.request.payload.agent,
    expectedGoalID: input.request.payload.goal_id,
    expectedGoalRunID: input.request.payload.goal_run_id,
    expectedModel: {
      providerID: model.providerID,
      modelID: model.modelID,
    },
    expectedResultMode: "reply",
    requireWorkerTurnDescriptor: requiresRuntimeContract && input.request.payload.agent !== "orchestrator",
    requireRuntimeContract: requiresRuntimeContract,
  })
  return { session, kind, model, runtimeContract }
}

async function startAgentCoordinationContinuation(input: {
  session: Awaited<ReturnType<typeof Session.get>>
}): Promise<{ loopPromise: ReturnType<typeof SessionPrompt.loop> }> {
  const loopPromise: ReturnType<typeof SessionPrompt.loop> = Promise.resolve(
    SessionContext.provide(input.session, () =>
      Instance.provide({
        directory: input.session.directory,
        fn: () => SessionPrompt.loop({ sessionID: input.session.id, resume_existing: true }),
      }),
    ),
  ).then((result) => result)
  const immediate = await Promise.race([
    loopPromise.then(
      () => ({ type: "settled" as const }),
      (error) => ({ type: "failed" as const, error }),
    ),
    new Promise<{ type: "scheduled" }>((resolve) => setTimeout(() => resolve({ type: "scheduled" }), 0)),
  ])
  if (immediate.type === "failed") throw immediate.error
  return { loopPromise }
}

async function validateAgentCoordinationBuildRedispatch(input: {
  taskID: string
  request: AgentCoordinationRequestRow
}) {
  const task = requireTask(input.taskID)
  const source = await Session.get(input.request.payload.session_id)
  const { kind, ownershipSource } = assertDirectReplySessionOwnership({
    taskID: input.taskID,
    sessionID: input.request.payload.session_id,
    goalID: input.request.payload.goal_id,
    goalRunID: input.request.payload.goal_run_id,
  })
  if (kind !== "build" || input.request.payload.agent !== "build") {
    throw new Error(`agent coordination build redispatch refused for ${kind}/${input.request.payload.agent}`)
  }
  const goalID = input.request.payload.goal_id
  if (!goalID) {
    throw new Error(
      "agent coordination build redispatch requires goal_id; task-level direct build redispatch is not bound",
    )
  }
  const sourceGoalRunID = input.request.payload.goal_run_id
  if (!sourceGoalRunID) {
    throw new Error("agent coordination build redispatch requires source goal_run_id")
  }
  const goal = findGoal(goalID)
  if (!goal || goal.task_id !== input.taskID) {
    throw new Error(`agent coordination build redispatch goal ${goalID} does not belong to task ${input.taskID}`)
  }
  const sourceGoalRun = findGoalRun(sourceGoalRunID)
  if (!sourceGoalRun || sourceGoalRun.task_id !== input.taskID || sourceGoalRun.goal_id !== goalID) {
    throw new Error(
      `agent coordination build redispatch source goal_run ${sourceGoalRunID} does not belong to goal ${goalID}`,
    )
  }
  await resolveAgentModelRef(
    "build",
    directReplyModelResolutionContext({
      taskID: input.taskID,
      sessionID: input.request.payload.session_id,
      ownershipSource,
    }),
  )
  SessionPrompt.validateSessionRuntimeContractForContinuation({
    sessionID: input.request.payload.session_id,
    sessionKind: kind,
    expectedAgentKind: "build",
    expectedGoalID: goalID,
    expectedGoalRunID: sourceGoalRunID,
    requireWorkerTurnDescriptor: true,
    requireRuntimeContract: true,
    expectedResultMode: "reply",
  })
  return { task, source, kind, goalID, sourceGoalRunID, sourceGoalRun }
}

async function validateAgentCoordinationIntentAnalysisRedispatch(input: {
  taskID: string
  request: AgentCoordinationRequestRow
}) {
  const task = requireTask(input.taskID)
  const source = await Session.get(input.request.payload.session_id)
  const { kind, ownershipSource } = assertDirectReplySessionOwnership({
    taskID: input.taskID,
    sessionID: input.request.payload.session_id,
    goalID: input.request.payload.goal_id,
    goalRunID: input.request.payload.goal_run_id,
  })
  if (kind !== "intent-analysis" || input.request.payload.agent !== "intent-analysis") {
    throw new Error(`agent coordination intent_analysis redispatch refused for ${kind}/${input.request.payload.agent}`)
  }
  await resolveAgentModelRef(
    "intent-analysis",
    directReplyModelResolutionContext({
      taskID: input.taskID,
      sessionID: input.request.payload.session_id,
      ownershipSource,
    }),
  )
  SessionPrompt.validateSessionRuntimeContractForContinuation({
    sessionID: input.request.payload.session_id,
    sessionKind: kind,
    expectedAgentKind: "intent-analysis",
    requireWorkerTurnDescriptor: true,
    requireRuntimeContract: true,
    expectedResultMode: "reply",
  })
  return { task, source, kind }
}

async function validateAgentCoordinationExploreRedispatch(input: {
  taskID: string
  request: AgentCoordinationRequestRow
}) {
  const task = requireTask(input.taskID)
  const source = await Session.get(input.request.payload.session_id)
  const { kind, ownershipSource } = assertDirectReplySessionOwnership({
    taskID: input.taskID,
    sessionID: input.request.payload.session_id,
    goalID: input.request.payload.goal_id,
    goalRunID: input.request.payload.goal_run_id,
  })
  if (kind !== "explore" || input.request.payload.agent !== "explore") {
    throw new Error(`agent coordination explore redispatch refused for ${kind}/${input.request.payload.agent}`)
  }
  await resolveAgentModelRef(
    "explore",
    directReplyModelResolutionContext({
      taskID: input.taskID,
      sessionID: input.request.payload.session_id,
      ownershipSource,
    }),
  )
  SessionPrompt.validateSessionRuntimeContractForContinuation({
    sessionID: input.request.payload.session_id,
    sessionKind: kind,
    expectedAgentKind: "explore",
    requireWorkerTurnDescriptor: true,
    requireRuntimeContract: true,
    expectedResultMode: "reply",
  })
  return { task, source, kind }
}

async function validateAgentCoordinationGoalWorkloadRedispatch(input: {
  taskID: string
  request: AgentCoordinationRequestRow
}) {
  const task = requireTask(input.taskID)
  const source = await Session.get(input.request.payload.session_id)
  const { kind, ownershipSource } = assertDirectReplySessionOwnership({
    taskID: input.taskID,
    sessionID: input.request.payload.session_id,
    goalID: input.request.payload.goal_id,
    goalRunID: input.request.payload.goal_run_id,
  })
  if (kind !== "goal-workload-analyst" || input.request.payload.agent !== "goal-workload-analyst") {
    throw new Error(
      `agent coordination workload_analysis redispatch refused for ${kind}/${input.request.payload.agent}`,
    )
  }
  const activeSpec = findActiveSpecForTask(input.taskID)
  if (!activeSpec) {
    throw new Error("agent coordination workload_analysis redispatch requires an active spec snapshot")
  }
  const goals = listGoals(input.taskID)
  if (goals.length === 0) {
    throw new Error("agent coordination workload_analysis redispatch requires architect goal rows")
  }
  await resolveAgentModelRef(
    "goal-workload-analyst",
    directReplyModelResolutionContext({
      taskID: input.taskID,
      sessionID: input.request.payload.session_id,
      ownershipSource,
    }),
  )
  SessionPrompt.validateSessionRuntimeContractForContinuation({
    sessionID: input.request.payload.session_id,
    sessionKind: kind,
    expectedAgentKind: "goal-workload-analyst",
    requireWorkerTurnDescriptor: true,
    requireRuntimeContract: true,
    expectedResultMode: "reply",
  })
  return { task, source, kind, activeSpecID: activeSpec.id, goalsCount: goals.length }
}

async function validateAgentCoordinationFactCheckRedispatch(input: {
  taskID: string
  request: AgentCoordinationRequestRow
}) {
  const task = requireTask(input.taskID)
  const source = await Session.get(input.request.payload.session_id)
  const { kind, ownershipSource } = assertDirectReplySessionOwnership({
    taskID: input.taskID,
    sessionID: input.request.payload.session_id,
    goalID: input.request.payload.goal_id,
    goalRunID: input.request.payload.goal_run_id,
  })
  if (kind !== "fact-check" || input.request.payload.agent !== "fact-check") {
    throw new Error(`agent coordination fact_check redispatch refused for ${kind}/${input.request.payload.agent}`)
  }
  await resolveAgentModelRef(
    "fact-check",
    directReplyModelResolutionContext({
      taskID: input.taskID,
      sessionID: input.request.payload.session_id,
      ownershipSource,
    }),
  )
  SessionPrompt.validateSessionRuntimeContractForContinuation({
    sessionID: input.request.payload.session_id,
    sessionKind: kind,
    expectedAgentKind: "fact-check",
    requireWorkerTurnDescriptor: true,
    requireRuntimeContract: true,
    expectedResultMode: "reply",
  })
  const continuation =
    findPendingFactCheckContinuationForSourceSession({
      taskID: input.taskID,
      sessionID: input.request.payload.session_id,
    }) ?? findRecoverableFactCheckContinuationForRespondedRequest(input)
  if (!continuation) {
    throw new Error(
      "agent coordination fact_check redispatch requires a pending fact-check stage_continuation_request for the source session",
    )
  }
  return { task, source, kind, continuation }
}

async function validateAgentCoordinationFrontendResearchRedispatch(input: {
  taskID: string
  request: AgentCoordinationRequestRow
}) {
  const task = requireTask(input.taskID)
  const source = await Session.get(input.request.payload.session_id)
  const { kind, ownershipSource } = assertDirectReplySessionOwnership({
    taskID: input.taskID,
    sessionID: input.request.payload.session_id,
    goalID: input.request.payload.goal_id,
    goalRunID: input.request.payload.goal_run_id,
  })
  if (kind !== "frontend-research" || input.request.payload.agent !== "frontend-research") {
    throw new Error(
      `agent coordination frontend_research redispatch refused for ${kind}/${input.request.payload.agent}`,
    )
  }
  const sourceUrls = (input.request.payload.evidence_refs ?? []).filter(isHttpWebpageUrl)
  if (sourceUrls.length !== 1) {
    throw new Error(
      `agent coordination frontend_research redispatch requires exactly one HTTP(S) source URL in evidence_refs; found ${sourceUrls.length}`,
    )
  }
  await resolveAgentModelRef(
    "frontend-research",
    directReplyModelResolutionContext({
      taskID: input.taskID,
      sessionID: input.request.payload.session_id,
      ownershipSource,
    }),
  )
  SessionPrompt.validateSessionRuntimeContractForContinuation({
    sessionID: input.request.payload.session_id,
    sessionKind: kind,
    expectedAgentKind: "frontend-research",
    requireWorkerTurnDescriptor: true,
    requireRuntimeContract: true,
    expectedResultMode: "reply",
  })
  return { task, source, kind, sourceUrls }
}

async function validateAgentCoordinationFrontendDesignRedispatch(input: {
  taskID: string
  request: AgentCoordinationRequestRow
}) {
  const task = requireTask(input.taskID)
  const source = await Session.get(input.request.payload.session_id)
  const { kind, ownershipSource } = assertDirectReplySessionOwnership({
    taskID: input.taskID,
    sessionID: input.request.payload.session_id,
    goalID: input.request.payload.goal_id,
    goalRunID: input.request.payload.goal_run_id,
  })
  if (kind !== "frontend-design" || input.request.payload.agent !== "frontend-design") {
    throw new Error(`agent coordination frontend_design redispatch refused for ${kind}/${input.request.payload.agent}`)
  }
  await resolveAgentModelRef(
    "frontend-design",
    directReplyModelResolutionContext({
      taskID: input.taskID,
      sessionID: input.request.payload.session_id,
      ownershipSource,
    }),
  )
  SessionPrompt.validateSessionRuntimeContractForContinuation({
    sessionID: input.request.payload.session_id,
    sessionKind: kind,
    expectedAgentKind: "frontend-design",
    requireWorkerTurnDescriptor: true,
    requireRuntimeContract: true,
    expectedResultMode: "reply",
  })
  return { task, source, kind, sourceUrls: (input.request.payload.evidence_refs ?? []).filter(isHttpWebpageUrl) }
}

async function validateAgentCoordinationDeepResearchRedispatch(input: {
  taskID: string
  request: AgentCoordinationRequestRow
}) {
  const task = requireTask(input.taskID)
  const source = await Session.get(input.request.payload.session_id)
  const { kind, ownershipSource } = assertDirectReplySessionOwnership({
    taskID: input.taskID,
    sessionID: input.request.payload.session_id,
    goalID: input.request.payload.goal_id,
    goalRunID: input.request.payload.goal_run_id,
  })
  if (kind !== "deep-research" || input.request.payload.agent !== "deep-research") {
    throw new Error(`agent coordination deep_research redispatch refused for ${kind}/${input.request.payload.agent}`)
  }
  await resolveAgentModelRef(
    "deep-research",
    directReplyModelResolutionContext({
      taskID: input.taskID,
      sessionID: input.request.payload.session_id,
      ownershipSource,
    }),
  )
  SessionPrompt.validateSessionRuntimeContractForContinuation({
    sessionID: input.request.payload.session_id,
    sessionKind: kind,
    expectedAgentKind: "deep-research",
    requireWorkerTurnDescriptor: true,
    requireRuntimeContract: true,
    expectedResultMode: "reply",
  })
  return { task, source, kind, sourceUrls: input.request.payload.evidence_refs ?? [] }
}

async function validateAgentCoordinationRequirementsRedispatch(input: {
  taskID: string
  request: AgentCoordinationRequestRow
}) {
  const task = requireTask(input.taskID)
  const source = await Session.get(input.request.payload.session_id)
  const { kind, ownershipSource } = assertDirectReplySessionOwnership({
    taskID: input.taskID,
    sessionID: input.request.payload.session_id,
    goalID: input.request.payload.goal_id,
    goalRunID: input.request.payload.goal_run_id,
  })
  if (kind !== "requirements" || input.request.payload.agent !== "requirements") {
    throw new Error(`agent coordination requirements redispatch refused for ${kind}/${input.request.payload.agent}`)
  }
  await resolveAgentModelRef(
    "requirements",
    directReplyModelResolutionContext({
      taskID: input.taskID,
      sessionID: input.request.payload.session_id,
      ownershipSource,
    }),
  )
  SessionPrompt.validateSessionRuntimeContractForContinuation({
    sessionID: input.request.payload.session_id,
    sessionKind: kind,
    expectedAgentKind: "requirements",
    requireWorkerTurnDescriptor: true,
    requireRuntimeContract: true,
    expectedResultMode: "reply",
  })
  return { task, source, kind }
}

async function validateAgentCoordinationArchitectRedispatch(input: {
  taskID: string
  request: AgentCoordinationRequestRow
}) {
  const task = requireTask(input.taskID)
  const source = await Session.get(input.request.payload.session_id)
  const { kind, ownershipSource } = assertDirectReplySessionOwnership({
    taskID: input.taskID,
    sessionID: input.request.payload.session_id,
    goalID: input.request.payload.goal_id,
    goalRunID: input.request.payload.goal_run_id,
  })
  if (kind !== "architect" || input.request.payload.agent !== "architect") {
    throw new Error(`agent coordination architect redispatch refused for ${kind}/${input.request.payload.agent}`)
  }
  const activeSpec = findActiveSpecForTask(input.taskID)
  if (!activeSpec) {
    throw new Error("agent coordination architect redispatch requires an active requirements spec snapshot")
  }
  await resolveAgentModelRef(
    "architect",
    directReplyModelResolutionContext({
      taskID: input.taskID,
      sessionID: input.request.payload.session_id,
      ownershipSource,
    }),
  )
  SessionPrompt.validateSessionRuntimeContractForContinuation({
    sessionID: input.request.payload.session_id,
    sessionKind: kind,
    expectedAgentKind: "architect",
    requireWorkerTurnDescriptor: true,
    requireRuntimeContract: true,
    expectedResultMode: "reply",
  })
  return { task, source, kind }
}

async function validateAgentCoordinationVisualQaRedispatch(input: {
  taskID: string
  request: AgentCoordinationRequestRow
}) {
  const task = requireTask(input.taskID)
  const source = await Session.get(input.request.payload.session_id)
  const { kind, ownershipSource } = assertDirectReplySessionOwnership({
    taskID: input.taskID,
    sessionID: input.request.payload.session_id,
    goalID: input.request.payload.goal_id,
    goalRunID: input.request.payload.goal_run_id,
  })
  if (kind !== "visual-qa" || input.request.payload.agent !== "visual-qa") {
    throw new Error(`agent coordination visual_qa redispatch refused for ${kind}/${input.request.payload.agent}`)
  }
  await resolveAgentModelRef(
    "visual-qa",
    directReplyModelResolutionContext({
      taskID: input.taskID,
      sessionID: input.request.payload.session_id,
      ownershipSource,
    }),
  )
  SessionPrompt.validateSessionRuntimeContractForContinuation({
    sessionID: input.request.payload.session_id,
    sessionKind: kind,
    expectedAgentKind: "visual-qa",
    requireWorkerTurnDescriptor: true,
    requireRuntimeContract: true,
    expectedResultMode: "reply",
  })
  return { task, source, kind }
}

async function validateAgentCoordinationIntegrityRedispatch(input: {
  taskID: string
  request: AgentCoordinationRequestRow
}) {
  const task = requireTask(input.taskID)
  const source = await Session.get(input.request.payload.session_id)
  const { kind, ownershipSource } = assertDirectReplySessionOwnership({
    taskID: input.taskID,
    sessionID: input.request.payload.session_id,
    goalID: input.request.payload.goal_id,
    goalRunID: input.request.payload.goal_run_id,
  })
  if (kind !== "integrity" || input.request.payload.agent !== "integrity") {
    throw new Error(`agent coordination integrity redispatch refused for ${kind}/${input.request.payload.agent}`)
  }
  await resolveAgentModelRef(
    "integrity",
    directReplyModelResolutionContext({
      taskID: input.taskID,
      sessionID: input.request.payload.session_id,
      ownershipSource,
    }),
  )
  SessionPrompt.validateSessionRuntimeContractForContinuation({
    sessionID: input.request.payload.session_id,
    sessionKind: kind,
    expectedAgentKind: "integrity",
    requireWorkerTurnDescriptor: true,
    requireRuntimeContract: true,
    expectedResultMode: "reply",
  })
  return { task, source, kind }
}

function markAgentCoordinationContinuationFailure(input: { sessionID: string; error: unknown }) {
  SessionStatus.set(input.sessionID, {
    type: "terminal",
    reason: "error",
    error: input.error instanceof Error ? input.error.message : String(input.error),
  })
}

function replayedAgentCoordinationActionResult(input: {
  taskID: string
  response: Awaited<ReturnType<typeof createAgentCoordinationResponse>>
}): string | undefined {
  if (input.response.createdNow !== false) return undefined
  const action = findAgentCoordinationAction({
    taskID: input.taskID,
    actionID: input.response.payload.action_id,
  })
  if (!action) {
    throw new Error(
      `agent coordination replay response ${input.response.payload.response_id} points to missing action ${input.response.payload.action_id}`,
    )
  }
  if (action.payload.status === "completed") {
    return (
      `Replayed coordination response ${input.response.payload.response_id}; ` +
      `action=${action.payload.action_id} already completed as ${action.payload.action}.`
    )
  }
  if (action.payload.status === "failed") {
    return (
      `Replayed coordination response ${input.response.payload.response_id}; ` +
      `action=${action.payload.action_id} already failed and the request remains pending for a new response.`
    )
  }
  return undefined
}

function listBuildSessionContractArtifactsForGoal(input: { taskID: string; goalID: string }) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, input.taskID),
          eq(EngineArtifactTable.kind, "build_session_contract"),
          sql`json_extract(${EngineArtifactTable.payload}, '$.goal_id') = ${input.goalID}`,
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .all(),
  )
}

async function recoverPendingBuildRedispatchAction(input: {
  taskID: string
  response: Awaited<ReturnType<typeof createAgentCoordinationResponse>>
  sourceSessionID: string
  sourceGoalRunID: string
  goalID: string
  targetKind: string
}): Promise<
  | {
      actionID: string
      sessionID: string
      goalRunID: string
      goalRunStatus: string
      contractID: string
    }
  | undefined
> {
  if (input.response.createdNow !== false) return undefined
  const action = findAgentCoordinationAction({
    taskID: input.taskID,
    actionID: input.response.payload.action_id,
  })
  if (!action) {
    throw new Error(
      `agent coordination redispatch response ${input.response.payload.response_id} points to missing action ${input.response.payload.action_id}`,
    )
  }
  if (action.payload.status !== "pending") return undefined
  if (action.payload.action !== "redispatch_worker") return undefined
  const priorResult = action.payload.result ?? {}
  const binding = priorResult.redispatch_binding as Partial<AgentCoordinationRedispatchBinding> | undefined
  const dispatcher = typeof priorResult.dispatcher === "string" ? priorResult.dispatcher : binding?.dispatcher
  if (dispatcher !== "build_stage") return undefined
  if (priorResult.redispatch_started !== true) return undefined
  if (priorResult.goal_id !== input.goalID) {
    throw new Error(
      `build_stage redispatch recovery goal_id mismatch: action=${String(priorResult.goal_id)} request=${input.goalID}`,
    )
  }
  if (priorResult.source_goal_run_id !== input.sourceGoalRunID) {
    throw new Error(
      `build_stage redispatch recovery source_goal_run_id mismatch: action=${String(priorResult.source_goal_run_id)} request=${input.sourceGoalRunID}`,
    )
  }
  const existingGoalRunIDs = new Set(
    Array.isArray(priorResult.preexisting_build_goal_run_ids)
      ? priorResult.preexisting_build_goal_run_ids.filter((value): value is string => typeof value === "string")
      : [],
  )
  const existingContractIDs = new Set(
    Array.isArray(priorResult.preexisting_build_session_contract_ids)
      ? priorResult.preexisting_build_session_contract_ids.filter((value): value is string => typeof value === "string")
      : [],
  )

  const newGoalRuns = listGoalRunsByGoal(input.goalID)
    .filter((goalRun) => !existingGoalRunIDs.has(goalRun.id))
    .sort((left, right) => {
      if (left.time_created !== right.time_created) return right.time_created - left.time_created
      return right.id.localeCompare(left.id)
    })
  if (newGoalRuns.length > 1) {
    throw new Error(
      `build_stage redispatch recovery for action ${action.payload.action_id} is ambiguous: new goal_runs ${newGoalRuns
        .map((goalRun) => goalRun.id)
        .join(", ")}`,
    )
  }

  const contracts = listBuildSessionContractArtifactsForGoal({ taskID: input.taskID, goalID: input.goalID })
    .filter((row) => row.time_created >= action.payload.created_at)
    .filter((row) => !existingContractIDs.has(row.id))
  if (contracts.length > 1) {
    throw new Error(
      `build_stage redispatch recovery for action ${action.payload.action_id} is ambiguous: new build_session_contract artifacts ${contracts
        .map((row) => row.id)
        .join(", ")}`,
    )
  }

  const goalRun = newGoalRuns[0]
  const contract = contracts[0]
  if (!goalRun && !contract) return undefined
  if (!goalRun || !contract) {
    throw new Error(
      `build_stage redispatch recovery for action ${action.payload.action_id} found incomplete durable build start: goal_run=${goalRun?.id ?? "missing"} contract=${contract?.id ?? "missing"}`,
    )
  }
  if (!goalRun.session_id) {
    throw new Error(`build_stage redispatch recovery goal_run ${goalRun.id} has no session_id`)
  }
  const payload = contract.payload as
    | {
        session_id?: unknown
        task_id?: unknown
        goal_id?: unknown
        goal_run_id?: unknown
      }
    | undefined
  if (payload?.task_id !== input.taskID) {
    throw new Error(`build_stage redispatch recovery contract ${contract.id} task_id mismatch`)
  }
  if (payload.goal_id !== input.goalID) {
    throw new Error(`build_stage redispatch recovery contract ${contract.id} goal_id mismatch`)
  }
  if (payload.goal_run_id !== goalRun.id) {
    throw new Error(
      `build_stage redispatch recovery contract ${contract.id} goal_run_id ${String(payload.goal_run_id)} does not match recovered goal_run ${goalRun.id}`,
    )
  }
  if (payload.session_id !== goalRun.session_id) {
    throw new Error(
      `build_stage redispatch recovery contract ${contract.id} session_id ${String(payload.session_id)} does not match recovered build session ${goalRun.session_id}`,
    )
  }
  const sourceAfter = findGoalRun(input.sourceGoalRunID)
  await completeAgentCoordinationAction({
    taskID: input.taskID,
    actionID: action.payload.action_id,
    result: {
      dispatcher: "build_stage",
      stage: "build",
      source_session_id: input.sourceSessionID,
      source_goal_run_id: input.sourceGoalRunID,
      source_goal_run_status: sourceAfter?.status ?? "unknown",
      source_cancel_summary:
        typeof priorResult.source_cancel_summary === "string" ? priorResult.source_cancel_summary : "",
      redispatch_session_id: goalRun.session_id,
      redispatch_goal_run_id: goalRun.id,
      redispatch_goal_run_status: goalRun.status,
      build_session_contract_id: contract.id,
      worktree_dir: goalRun.workspace_dir,
      worktree_branch: goalRun.workspace_branch,
      goal_id: input.goalID,
      target_kind: input.targetKind,
      started: true,
      recovered_redispatch: true,
    },
    summary: "redispatch_worker build stage recovered persisted goal_run",
  })
  return {
    actionID: action.payload.action_id,
    sessionID: goalRun.session_id,
    goalRunID: goalRun.id,
    goalRunStatus: goalRun.status,
    contractID: contract.id,
  }
}

function listDecisionLogEntriesForPhase(input: { taskID: string; phase: string }) {
  return Database.use((db) =>
    db
      .select()
      .from(DecisionLogTable)
      .where(and(eq(DecisionLogTable.task_id, input.taskID), eq(DecisionLogTable.phase, input.phase)))
      .orderBy(desc(DecisionLogTable.time_created), desc(DecisionLogTable.id))
      .all(),
  )
}

async function recoverPendingIntentAnalysisRedispatchAction(input: {
  taskID: string
  response: Awaited<ReturnType<typeof createAgentCoordinationResponse>>
  orchestratorSessionID: string
  sourceSessionID: string
  targetKind: string
}): Promise<
  | {
      actionID: string
      sessionID: string
      decisionEntriesCount: number
      intentSummary: string
    }
  | undefined
> {
  if (input.response.createdNow !== false) return undefined
  const action = findAgentCoordinationAction({
    taskID: input.taskID,
    actionID: input.response.payload.action_id,
  })
  if (!action) {
    throw new Error(
      `agent coordination redispatch response ${input.response.payload.response_id} points to missing action ${input.response.payload.action_id}`,
    )
  }
  if (action.payload.status !== "pending") return undefined
  if (action.payload.action !== "redispatch_worker") return undefined
  const priorResult = action.payload.result ?? {}
  const binding = priorResult.redispatch_binding as Partial<AgentCoordinationRedispatchBinding> | undefined
  const dispatcher = typeof priorResult.dispatcher === "string" ? priorResult.dispatcher : binding?.dispatcher
  if (dispatcher !== "intent_analysis_stage") return undefined
  if (priorResult.redispatch_started !== true) return undefined
  const existingSessionIDs = new Set(
    Array.isArray(priorResult.preexisting_intent_analysis_session_ids)
      ? priorResult.preexisting_intent_analysis_session_ids.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  )
  const existingDecisionIDs = new Set(
    Array.isArray(priorResult.preexisting_intent_analysis_decision_ids)
      ? priorResult.preexisting_intent_analysis_decision_ids.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  )

  const newSessions = (await Session.children(input.orchestratorSessionID))
    .filter((session) => session.kind === "intent-analysis" && !existingSessionIDs.has(session.id))
    .sort((left, right) => {
      if (left.time.created !== right.time.created) return right.time.created - left.time.created
      return right.id.localeCompare(left.id)
    })
  if (newSessions.length > 1) {
    throw new Error(
      `intent_analysis_stage redispatch recovery for action ${action.payload.action_id} is ambiguous: new sessions ${newSessions
        .map((session) => session.id)
        .join(", ")}`,
    )
  }
  const decisionEntries = listDecisionLogEntriesForPhase({ taskID: input.taskID, phase: "intent_analysis" })
    .filter((entry) => entry.time_created >= action.payload.created_at)
    .filter((entry) => !existingDecisionIDs.has(entry.id))
  const summaryEntries = decisionEntries.filter((entry) => entry.key === "intent_summary")
  if (summaryEntries.length > 1) {
    throw new Error(
      `intent_analysis_stage redispatch recovery for action ${action.payload.action_id} is ambiguous: intent_summary entries ${summaryEntries
        .map((entry) => entry.id)
        .join(", ")}`,
    )
  }

  const session = newSessions[0]
  const summaryEntry = summaryEntries[0]
  if (!session && !summaryEntry) return undefined
  if (!session || !summaryEntry) {
    throw new Error(
      `intent_analysis_stage redispatch recovery for action ${action.payload.action_id} found incomplete durable intent evidence: session=${session?.id ?? "missing"} intent_summary=${summaryEntry?.id ?? "missing"}`,
    )
  }
  if (summaryEntry.value.trim().length === 0) {
    throw new Error(`intent_analysis_stage redispatch recovery intent_summary ${summaryEntry.id} is empty`)
  }
  await completeAgentCoordinationAction({
    taskID: input.taskID,
    actionID: action.payload.action_id,
    result: {
      dispatcher: "intent_analysis_stage",
      stage: "intent-analysis",
      source_session_id: input.sourceSessionID,
      redispatch_session_id: session.id,
      decision_entries_count: decisionEntries.length,
      intent_summary: summaryEntry.value,
      intent_summary_decision_id: summaryEntry.id,
      target_kind: input.targetKind,
      started: true,
      recovered_redispatch: true,
    },
    summary: "redispatch_worker intent_analysis stage recovered persisted intent",
  })
  return {
    actionID: action.payload.action_id,
    sessionID: session.id,
    decisionEntriesCount: decisionEntries.length,
    intentSummary: summaryEntry.value,
  }
}

function listExplorationArtifacts(input: { taskID: string }) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.task_id, input.taskID), eq(EngineArtifactTable.kind, "exploration")))
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .all(),
  )
}

function listGoalWorkloadArtifacts(input: { taskID: string }) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.task_id, input.taskID), eq(EngineArtifactTable.kind, "goal_workload")))
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .all(),
  )
}

function listFactCheckAttemptArtifacts(input: { taskID: string }) {
  return Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.task_id, input.taskID), eq(EngineArtifactTable.kind, "fact_check_attempt")))
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .all(),
  )
}

async function recoverPendingExploreRedispatchAction(input: {
  taskID: string
  response: Awaited<ReturnType<typeof createAgentCoordinationResponse>>
  orchestratorSessionID: string
  sourceSessionID: string
  question: string
  targetKind: string
}): Promise<
  | {
      actionID: string
      sessionID: string
      decisionEntryID: string
      artifactID: string
    }
  | undefined
> {
  if (input.response.createdNow !== false) return undefined
  const action = findAgentCoordinationAction({
    taskID: input.taskID,
    actionID: input.response.payload.action_id,
  })
  if (!action) {
    throw new Error(
      `agent coordination redispatch response ${input.response.payload.response_id} points to missing action ${input.response.payload.action_id}`,
    )
  }
  if (action.payload.status !== "pending") return undefined
  if (action.payload.action !== "redispatch_worker") return undefined
  const priorResult = action.payload.result ?? {}
  const binding = priorResult.redispatch_binding as Partial<AgentCoordinationRedispatchBinding> | undefined
  const dispatcher = typeof priorResult.dispatcher === "string" ? priorResult.dispatcher : binding?.dispatcher
  if (dispatcher !== "explore_stage") return undefined
  if (priorResult.redispatch_started !== true) return undefined
  if (priorResult.question !== input.question) {
    throw new Error(
      `explore_stage redispatch recovery question mismatch: action=${String(priorResult.question)} request=${input.question}`,
    )
  }
  const existingSessionIDs = new Set(
    Array.isArray(priorResult.preexisting_explore_session_ids)
      ? priorResult.preexisting_explore_session_ids.filter((value): value is string => typeof value === "string")
      : [],
  )
  const existingDecisionIDs = new Set(
    Array.isArray(priorResult.preexisting_explore_decision_ids)
      ? priorResult.preexisting_explore_decision_ids.filter((value): value is string => typeof value === "string")
      : [],
  )
  const existingArtifactIDs = new Set(
    Array.isArray(priorResult.preexisting_exploration_artifact_ids)
      ? priorResult.preexisting_exploration_artifact_ids.filter((value): value is string => typeof value === "string")
      : [],
  )

  const newSessions = (await Session.children(input.orchestratorSessionID))
    .filter((session) => session.kind === "explore" && !existingSessionIDs.has(session.id))
    .sort((left, right) => {
      if (left.time.created !== right.time.created) return right.time.created - left.time.created
      return right.id.localeCompare(left.id)
    })
  if (newSessions.length > 1) {
    throw new Error(
      `explore_stage redispatch recovery for action ${action.payload.action_id} is ambiguous: new sessions ${newSessions
        .map((session) => session.id)
        .join(", ")}`,
    )
  }
  const decisionEntries = listDecisionLogEntriesForPhase({ taskID: input.taskID, phase: "explore" })
    .filter((entry) => entry.time_created >= action.payload.created_at)
    .filter((entry) => !existingDecisionIDs.has(entry.id))
  if (decisionEntries.length > 1) {
    throw new Error(
      `explore_stage redispatch recovery for action ${action.payload.action_id} is ambiguous: decision entries ${decisionEntries
        .map((entry) => entry.id)
        .join(", ")}`,
    )
  }
  const artifacts = listExplorationArtifacts({ taskID: input.taskID })
    .filter((row) => row.time_created >= action.payload.created_at)
    .filter((row) => !existingArtifactIDs.has(row.id))
  if (artifacts.length > 1) {
    throw new Error(
      `explore_stage redispatch recovery for action ${action.payload.action_id} is ambiguous: exploration artifacts ${artifacts
        .map((row) => row.id)
        .join(", ")}`,
    )
  }

  const session = newSessions[0]
  const decisionEntry = decisionEntries[0]
  const artifact = artifacts[0]
  if (!session && !decisionEntry && !artifact) return undefined
  if (!session || !decisionEntry || !artifact) {
    throw new Error(
      `explore_stage redispatch recovery for action ${action.payload.action_id} found incomplete durable explore evidence: session=${session?.id ?? "missing"} decision=${decisionEntry?.id ?? "missing"} artifact=${artifact?.id ?? "missing"}`,
    )
  }
  const payload = artifact.payload as
    | {
        question?: unknown
        session_id?: unknown
        result?: unknown
      }
    | undefined
  if (payload?.session_id !== session.id) {
    throw new Error(
      `explore_stage redispatch recovery exploration artifact ${artifact.id} session_id ${String(payload?.session_id)} does not match recovered session ${session.id}`,
    )
  }
  if (payload.question !== input.question) {
    throw new Error(`explore_stage redispatch recovery exploration artifact ${artifact.id} question mismatch`)
  }
  if (typeof payload.result !== "string" || payload.result.trim().length === 0) {
    throw new Error(`explore_stage redispatch recovery exploration artifact ${artifact.id} has empty result`)
  }
  if (decisionEntry.key !== `repo_investigation_${session.id}`) {
    throw new Error(
      `explore_stage redispatch recovery decision ${decisionEntry.id} key ${decisionEntry.key} is not bound to recovered session ${session.id}`,
    )
  }
  if (decisionEntry.value !== payload.result) {
    throw new Error(
      `explore_stage redispatch recovery decision ${decisionEntry.id} value does not match exploration artifact ${artifact.id}`,
    )
  }
  await completeAgentCoordinationAction({
    taskID: input.taskID,
    actionID: action.payload.action_id,
    result: {
      dispatcher: "explore_stage",
      stage: "explore",
      source_session_id: input.sourceSessionID,
      redispatch_session_id: session.id,
      decision_entries_count: decisionEntries.length,
      exploration_artifacts_count: artifacts.length,
      explore_decision_id: decisionEntry.id,
      exploration_artifact_id: artifact.id,
      question: input.question,
      target_kind: input.targetKind,
      started: true,
      recovered_redispatch: true,
    },
    summary: "redispatch_worker explore stage recovered persisted investigation",
  })
  return {
    actionID: action.payload.action_id,
    sessionID: session.id,
    decisionEntryID: decisionEntry.id,
    artifactID: artifact.id,
  }
}

async function recoverPendingGoalWorkloadRedispatchAction(input: {
  taskID: string
  response: Awaited<ReturnType<typeof createAgentCoordinationResponse>>
  orchestratorSessionID: string
  sourceSessionID: string
  activeSpecID: string
  expectedGoalsCount: number
  targetKind: string
}): Promise<
  | {
      actionID: string
      sessionID: string
      artifactID: string
      briefsCount: number
      flaggedGoalsCount: number
      summary?: string
    }
  | undefined
> {
  if (input.response.createdNow !== false) return undefined
  const action = findAgentCoordinationAction({
    taskID: input.taskID,
    actionID: input.response.payload.action_id,
  })
  if (!action) {
    throw new Error(
      `agent coordination redispatch response ${input.response.payload.response_id} points to missing action ${input.response.payload.action_id}`,
    )
  }
  if (action.payload.status !== "pending") return undefined
  if (action.payload.action !== "redispatch_worker") return undefined
  const priorResult = action.payload.result ?? {}
  const binding = priorResult.redispatch_binding as Partial<AgentCoordinationRedispatchBinding> | undefined
  const dispatcher = typeof priorResult.dispatcher === "string" ? priorResult.dispatcher : binding?.dispatcher
  if (dispatcher !== "workload_analysis_stage") return undefined
  if (priorResult.redispatch_started !== true) return undefined
  if (priorResult.spec_snapshot_id !== input.activeSpecID) {
    throw new Error(
      `workload_analysis_stage redispatch recovery spec_snapshot_id mismatch: action=${String(priorResult.spec_snapshot_id)} request=${input.activeSpecID}`,
    )
  }
  const existingSessionIDs = new Set(
    Array.isArray(priorResult.preexisting_goal_workload_session_ids)
      ? priorResult.preexisting_goal_workload_session_ids.filter((value): value is string => typeof value === "string")
      : [],
  )
  const existingArtifactIDs = new Set(
    Array.isArray(priorResult.preexisting_goal_workload_artifact_ids)
      ? priorResult.preexisting_goal_workload_artifact_ids.filter((value): value is string => typeof value === "string")
      : [],
  )

  const newSessions = (await Session.children(input.orchestratorSessionID))
    .filter((session) => session.kind === "goal-workload-analyst" && !existingSessionIDs.has(session.id))
    .sort((left, right) => {
      if (left.time.created !== right.time.created) return right.time.created - left.time.created
      return right.id.localeCompare(left.id)
    })
  if (newSessions.length > 1) {
    throw new Error(
      `workload_analysis_stage redispatch recovery for action ${action.payload.action_id} is ambiguous: new sessions ${newSessions
        .map((session) => session.id)
        .join(", ")}`,
    )
  }
  const artifacts = listGoalWorkloadArtifacts({ taskID: input.taskID })
    .filter((row) => row.time_created >= action.payload.created_at)
    .filter((row) => !existingArtifactIDs.has(row.id))
  if (artifacts.length > 1) {
    throw new Error(
      `workload_analysis_stage redispatch recovery for action ${action.payload.action_id} is ambiguous: goal_workload artifacts ${artifacts
        .map((row) => row.id)
        .join(", ")}`,
    )
  }
  const session = newSessions[0]
  const artifact = artifacts[0]
  if (!session && !artifact) return undefined
  if (!session || !artifact) {
    throw new Error(
      `workload_analysis_stage redispatch recovery for action ${action.payload.action_id} found incomplete durable workload evidence: session=${session?.id ?? "missing"} artifact=${artifact?.id ?? "missing"}`,
    )
  }
  const payload = artifact.payload as
    | {
        briefs?: Array<{ decomposition_concern?: unknown }>
        spec_snapshot_id?: unknown
        summary?: unknown
      }
    | undefined
  if (payload?.spec_snapshot_id !== input.activeSpecID) {
    throw new Error(
      `workload_analysis_stage redispatch recovery goal_workload ${artifact.id} spec_snapshot_id mismatch`,
    )
  }
  const briefs = Array.isArray(payload.briefs) ? payload.briefs : []
  if (briefs.length < input.expectedGoalsCount) {
    throw new Error(
      `workload_analysis_stage redispatch recovery goal_workload ${artifact.id} has ${briefs.length} briefs for ${input.expectedGoalsCount} goals`,
    )
  }
  const flaggedGoalsCount = briefs.filter(
    (brief) => typeof brief.decomposition_concern === "string" && brief.decomposition_concern.trim().length > 0,
  ).length
  const summary = typeof payload.summary === "string" ? payload.summary : undefined
  await completeAgentCoordinationAction({
    taskID: input.taskID,
    actionID: action.payload.action_id,
    result: {
      dispatcher: "workload_analysis_stage",
      stage: "goal-workload-analyst",
      source_session_id: input.sourceSessionID,
      redispatch_session_id: session.id,
      goal_workload_artifact_id: artifact.id,
      spec_snapshot_id: input.activeSpecID,
      briefs_count: briefs.length,
      flagged_goals_count: flaggedGoalsCount,
      expected_goals_count: input.expectedGoalsCount,
      target_kind: input.targetKind,
      started: true,
      recovered_redispatch: true,
    },
    summary: "redispatch_worker workload_analysis stage recovered persisted workload",
  })
  return {
    actionID: action.payload.action_id,
    sessionID: session.id,
    artifactID: artifact.id,
    briefsCount: briefs.length,
    flaggedGoalsCount,
    summary,
  }
}

async function recoverPendingFactCheckRedispatchAction(input: {
  taskID: string
  response: Awaited<ReturnType<typeof createAgentCoordinationResponse>>
  sourceSessionID: string
  continuationArtifactID: string
  normalizedStageInput: FactCheckStageInput
  targetKind: string
}): Promise<
  | {
      actionID: string
      sessionID: string
      artifactID: string
      verdict: FactCheckReport["overall_verdict"]
      outcome: FactCheckAttemptArtifact["outcome"]
    }
  | undefined
> {
  if (input.response.createdNow !== false) return undefined
  const action = findAgentCoordinationAction({
    taskID: input.taskID,
    actionID: input.response.payload.action_id,
  })
  if (!action) {
    throw new Error(
      `agent coordination redispatch response ${input.response.payload.response_id} points to missing action ${input.response.payload.action_id}`,
    )
  }
  if (action.payload.status !== "pending") return undefined
  if (action.payload.action !== "redispatch_worker") return undefined
  const priorResult = action.payload.result ?? {}
  const binding = priorResult.redispatch_binding as Partial<AgentCoordinationRedispatchBinding> | undefined
  const dispatcher = typeof priorResult.dispatcher === "string" ? priorResult.dispatcher : binding?.dispatcher
  if (dispatcher !== "fact_check_stage") return undefined
  if (priorResult.redispatch_started !== true) return undefined
  if (priorResult.continuation_artifact_id !== input.continuationArtifactID) {
    throw new Error(
      `fact_check_stage redispatch recovery continuation_artifact_id mismatch: action=${String(priorResult.continuation_artifact_id)} request=${input.continuationArtifactID}`,
    )
  }
  const existingAttemptIDs = new Set(
    Array.isArray(priorResult.preexisting_fact_check_attempt_ids)
      ? priorResult.preexisting_fact_check_attempt_ids.filter((value): value is string => typeof value === "string")
      : [],
  )
  const artifacts = listFactCheckAttemptArtifacts({ taskID: input.taskID })
    .filter((row) => row.time_created >= action.payload.created_at)
    .filter((row) => !existingAttemptIDs.has(row.id))
  if (artifacts.length > 1) {
    throw new Error(
      `fact_check_stage redispatch recovery for action ${action.payload.action_id} is ambiguous: fact_check_attempt artifacts ${artifacts
        .map((row) => row.id)
        .join(", ")}`,
    )
  }
  const artifact = artifacts[0]
  if (!artifact) return undefined
  const parsed = FactCheckAttemptArtifactSchema.safeParse(artifact.payload)
  if (!parsed.success) {
    throw new Error(
      `fact_check_stage redispatch recovery fact_check_attempt ${artifact.id} has invalid payload: ${parsed.error.message}`,
    )
  }
  const payload = parsed.data
  const expected = input.normalizedStageInput
  if (payload.fact_check_session_id !== input.sourceSessionID) {
    throw new Error(
      `fact_check_stage redispatch recovery fact_check_attempt ${artifact.id} session ${payload.fact_check_session_id} does not match source ${input.sourceSessionID}`,
    )
  }
  if (payload.invoked_by_orchestrator_session_id !== action.payload.orchestrator_session_id) {
    throw new Error(
      `fact_check_stage redispatch recovery fact_check_attempt ${artifact.id} invoked_by_orchestrator_session_id mismatch`,
    )
  }
  const mismatches: string[] = []
  if (payload.target_session_id !== expected.target_session_id) mismatches.push("target_session_id")
  if (payload.target_agent !== expected.target_agent) mismatches.push("target_agent")
  if (payload.target_message_id !== expected.target_message_id) mismatches.push("target_message_id")
  if (payload.target_message_content_hash !== expected.target_message_content_hash) {
    mismatches.push("target_message_content_hash")
  }
  if (payload.report.scope.target_session_id !== expected.target_session_id) {
    mismatches.push("report.scope.target_session_id")
  }
  if (payload.report.scope.target_agent !== expected.target_agent) mismatches.push("report.scope.target_agent")
  if (payload.report.scope.target_message_id !== expected.target_message_id) {
    mismatches.push("report.scope.target_message_id")
  }
  if (payload.report.scope.target_message_content_hash !== expected.target_message_content_hash) {
    mismatches.push("report.scope.target_message_content_hash")
  }
  if (payload.report.scope.items_total !== expected.fact_check_items.length) mismatches.push("report.scope.items_total")
  if (payload.report.scope.items_inspected > payload.report.scope.items_total) {
    mismatches.push("report.scope.items_inspected")
  }
  if (mismatches.length > 0) {
    throw new Error(
      `fact_check_stage redispatch recovery fact_check_attempt ${artifact.id} scope mismatch: ${mismatches.join(", ")}`,
    )
  }

  await completeAgentCoordinationAction({
    taskID: input.taskID,
    actionID: action.payload.action_id,
    result: {
      dispatcher: "fact_check_stage",
      stage: "fact-check",
      source_session_id: input.sourceSessionID,
      redispatch_session_id: payload.fact_check_session_id,
      continuation_artifact_id: input.continuationArtifactID,
      fact_check_attempt_id: artifact.id,
      target_session_id: payload.target_session_id,
      target_agent: payload.target_agent,
      target_message_id: payload.target_message_id,
      target_message_content_hash: payload.target_message_content_hash,
      verdict: payload.report.overall_verdict,
      outcome: payload.outcome,
      items_total: payload.report.scope.items_total,
      items_inspected: payload.report.scope.items_inspected,
      verified_count: payload.report.verified.length,
      corrected_count: payload.report.corrected.length,
      unresolved_count: payload.report.unresolved.length,
      same_session_continuation: payload.fact_check_session_id === input.sourceSessionID,
      target_kind: input.targetKind,
      started: true,
      recovered_redispatch: true,
    },
    summary: "redispatch_worker fact_check stage recovered persisted attempt",
  })
  return {
    actionID: action.payload.action_id,
    sessionID: payload.fact_check_session_id,
    artifactID: artifact.id,
    verdict: payload.report.overall_verdict,
    outcome: payload.outcome,
  }
}

async function recoverPendingFrontendResearchRedispatchAction(input: {
  taskID: string
  response: Awaited<ReturnType<typeof createAgentCoordinationResponse>>
  orchestratorSessionID: string
  sourceSessionID: string
  sourceURL: string
  targetKind: string
}): Promise<{ actionID: string; sessionID: string; artifactID: string } | undefined> {
  if (input.response.createdNow !== false) return undefined
  const action = findAgentCoordinationAction({
    taskID: input.taskID,
    actionID: input.response.payload.action_id,
  })
  if (!action) {
    throw new Error(
      `agent coordination redispatch response ${input.response.payload.response_id} points to missing action ${input.response.payload.action_id}`,
    )
  }
  if (action.payload.status !== "pending") return undefined
  if (action.payload.action !== "redispatch_worker") return undefined
  const priorResult = action.payload.result ?? {}
  const binding = priorResult.redispatch_binding as Partial<AgentCoordinationRedispatchBinding> | undefined
  const dispatcher = typeof priorResult.dispatcher === "string" ? priorResult.dispatcher : binding?.dispatcher
  if (dispatcher !== "frontend_research_stage") return undefined
  if (priorResult.redispatch_started !== true) return undefined
  const recordedSourceURL = typeof priorResult.source_url === "string" ? priorResult.source_url : undefined
  if (recordedSourceURL !== input.sourceURL) {
    throw new Error(
      `frontend_research_stage redispatch recovery source_url mismatch: action=${recordedSourceURL ?? "missing"} request=${input.sourceURL}`,
    )
  }

  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, input.taskID),
          eq(EngineArtifactTable.kind, "frontend_research_brief"),
          sql`${EngineArtifactTable.time_created} >= ${action.payload.created_at}`,
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .all(),
  )
  const matches: Array<{ artifactID: string; sessionID: string }> = []
  for (const row of rows) {
    const payload = row.payload as
      | {
          metadata?: { research_session_id?: unknown }
          webpage_contract?: { source_url?: unknown }
        }
      | undefined
    const sessionID = payload?.metadata?.research_session_id
    const sourceURL = payload?.webpage_contract?.source_url
    if (typeof sessionID !== "string" || typeof sourceURL !== "string") continue
    if (sourceURL !== input.sourceURL) continue
    const session = await Session.get(sessionID)
    if (session.kind !== "frontend-research") continue
    if (session.parentID !== input.orchestratorSessionID) continue
    matches.push({ artifactID: row.id, sessionID })
  }
  if (matches.length > 1) {
    throw new Error(
      `frontend_research_stage redispatch recovery for action ${action.payload.action_id} is ambiguous: ${matches
        .map((match) => `${match.sessionID}/${match.artifactID}`)
        .join(", ")}`,
    )
  }
  const match = matches[0]
  if (!match) return undefined
  await completeAgentCoordinationAction({
    taskID: input.taskID,
    actionID: action.payload.action_id,
    result: {
      dispatcher: "frontend_research_stage",
      stage: "frontend-research",
      source_session_id: input.sourceSessionID,
      redispatch_session_id: match.sessionID,
      frontend_research_brief_artifact_id: match.artifactID,
      source_url: input.sourceURL,
      target_kind: input.targetKind,
      started: true,
      recovered_redispatch: true,
    },
    summary: "redispatch_worker frontend_research stage recovered persisted brief",
  })
  return { actionID: action.payload.action_id, sessionID: match.sessionID, artifactID: match.artifactID }
}

async function recoverPendingDeepResearchRedispatchAction(input: {
  taskID: string
  response: Awaited<ReturnType<typeof createAgentCoordinationResponse>>
  orchestratorSessionID: string
  sourceSessionID: string
  sourceURLs: string[]
  targetKind: string
}): Promise<{ actionID: string; sessionID: string; artifactID: string } | undefined> {
  if (input.response.createdNow !== false) return undefined
  const action = findAgentCoordinationAction({
    taskID: input.taskID,
    actionID: input.response.payload.action_id,
  })
  if (!action) {
    throw new Error(
      `agent coordination redispatch response ${input.response.payload.response_id} points to missing action ${input.response.payload.action_id}`,
    )
  }
  if (action.payload.status !== "pending") return undefined
  if (action.payload.action !== "redispatch_worker") return undefined
  const priorResult = action.payload.result ?? {}
  const binding = priorResult.redispatch_binding as Partial<AgentCoordinationRedispatchBinding> | undefined
  const dispatcher = typeof priorResult.dispatcher === "string" ? priorResult.dispatcher : binding?.dispatcher
  if (dispatcher !== "deep_research_stage") return undefined
  if (priorResult.redispatch_started !== true) return undefined
  const recordedSourceURLs = Array.isArray(priorResult.source_urls)
    ? priorResult.source_urls.filter((value): value is string => typeof value === "string")
    : []
  if (JSON.stringify(recordedSourceURLs) !== JSON.stringify(input.sourceURLs)) {
    throw new Error(
      `deep_research_stage redispatch recovery source_urls mismatch: action=${JSON.stringify(recordedSourceURLs)} request=${JSON.stringify(input.sourceURLs)}`,
    )
  }
  const existingSessionIDs = new Set(
    Array.isArray(priorResult.preexisting_deep_research_session_ids)
      ? priorResult.preexisting_deep_research_session_ids.filter((value): value is string => typeof value === "string")
      : [],
  )
  const existingArtifactIDs = new Set(
    Array.isArray(priorResult.preexisting_research_brief_artifact_ids)
      ? priorResult.preexisting_research_brief_artifact_ids.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  )

  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, input.taskID),
          eq(EngineArtifactTable.kind, "research_brief"),
          sql`${EngineArtifactTable.time_created} >= ${action.payload.created_at}`,
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .all(),
  )
  const matches: Array<{ artifactID: string; sessionID: string }> = []
  for (const row of rows) {
    if (existingArtifactIDs.has(row.id)) continue
    const payload = row.payload as { metadata?: { research_session_id?: unknown } } | undefined
    const sessionID = payload?.metadata?.research_session_id
    if (typeof sessionID !== "string") continue
    if (existingSessionIDs.has(sessionID)) continue
    const session = await Session.get(sessionID)
    if (session.kind !== "deep-research") continue
    if (session.parentID !== input.orchestratorSessionID) continue
    matches.push({ artifactID: row.id, sessionID })
  }
  if (matches.length > 1) {
    throw new Error(
      `deep_research_stage redispatch recovery for action ${action.payload.action_id} is ambiguous: ${matches
        .map((match) => `${match.sessionID}/${match.artifactID}`)
        .join(", ")}`,
    )
  }
  const match = matches[0]
  if (!match) return undefined
  await completeAgentCoordinationAction({
    taskID: input.taskID,
    actionID: action.payload.action_id,
    result: {
      dispatcher: "deep_research_stage",
      stage: "deep-research",
      source_session_id: input.sourceSessionID,
      redispatch_session_id: match.sessionID,
      research_brief_artifact_id: match.artifactID,
      source_urls: input.sourceURLs,
      target_kind: input.targetKind,
      started: true,
      recovered_redispatch: true,
    },
    summary: "redispatch_worker deep_research stage recovered persisted brief",
  })
  return { actionID: action.payload.action_id, sessionID: match.sessionID, artifactID: match.artifactID }
}

async function recoverPendingRequirementsRedispatchAction(input: {
  taskID: string
  response: Awaited<ReturnType<typeof createAgentCoordinationResponse>>
  orchestratorSessionID: string
  sourceSessionID: string
  targetKind: string
}): Promise<
  | {
      actionID: string
      sessionID: string
      specSnapshotID: string
      requirementsCount: number
      decisionsCount: number
    }
  | undefined
> {
  if (input.response.createdNow !== false) return undefined
  const action = findAgentCoordinationAction({
    taskID: input.taskID,
    actionID: input.response.payload.action_id,
  })
  if (!action) {
    throw new Error(
      `agent coordination redispatch response ${input.response.payload.response_id} points to missing action ${input.response.payload.action_id}`,
    )
  }
  if (action.payload.status !== "pending") return undefined
  if (action.payload.action !== "redispatch_worker") return undefined
  const priorResult = action.payload.result ?? {}
  const binding = priorResult.redispatch_binding as Partial<AgentCoordinationRedispatchBinding> | undefined
  const dispatcher = typeof priorResult.dispatcher === "string" ? priorResult.dispatcher : binding?.dispatcher
  if (dispatcher !== "requirements_stage") return undefined
  if (priorResult.redispatch_started !== true) return undefined
  const existingSessionIDs = new Set(
    Array.isArray(priorResult.preexisting_requirements_session_ids)
      ? priorResult.preexisting_requirements_session_ids.filter((value): value is string => typeof value === "string")
      : [],
  )
  const existingSpecSnapshotIDs = new Set(
    Array.isArray(priorResult.preexisting_spec_snapshot_ids)
      ? priorResult.preexisting_spec_snapshot_ids.filter((value): value is string => typeof value === "string")
      : [],
  )

  const newSessions = (await Session.children(input.orchestratorSessionID))
    .filter((session) => session.kind === "requirements" && !existingSessionIDs.has(session.id))
    .sort((left, right) => {
      if (left.time.created !== right.time.created) return right.time.created - left.time.created
      return right.id.localeCompare(left.id)
    })
  if (newSessions.length > 1) {
    throw new Error(
      `requirements_stage redispatch recovery for action ${action.payload.action_id} is ambiguous: new sessions ${newSessions
        .map((session) => session.id)
        .join(", ")}`,
    )
  }
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineSpecSnapshotTable)
      .where(
        and(
          eq(EngineSpecSnapshotTable.task_id, input.taskID),
          sql`${EngineSpecSnapshotTable.time_created} >= ${action.payload.created_at}`,
        ),
      )
      .orderBy(desc(EngineSpecSnapshotTable.time_created), desc(EngineSpecSnapshotTable.id))
      .all(),
  ).filter((row) => !existingSpecSnapshotIDs.has(row.id))
  if (rows.length > 1) {
    throw new Error(
      `requirements_stage redispatch recovery for action ${action.payload.action_id} is ambiguous: new specs ${rows
        .map((row) => row.id)
        .join(", ")}`,
    )
  }
  const session = newSessions[0]
  const spec = rows[0]
  if (!session || !spec) return undefined
  const requirementsCount = findRequirements(spec.id).length
  if (requirementsCount < 1) return undefined
  const decisionsSection = spec.content.split(/\r?\n## Decisions\r?\n/)[1] ?? ""
  const decisionsCount = decisionsSection
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- **")).length
  await completeAgentCoordinationAction({
    taskID: input.taskID,
    actionID: action.payload.action_id,
    result: {
      dispatcher: "requirements_stage",
      stage: "requirements",
      source_session_id: input.sourceSessionID,
      redispatch_session_id: session.id,
      spec_snapshot_id: spec.id,
      requirements_count: requirementsCount,
      decisions_count: decisionsCount,
      target_kind: input.targetKind,
      started: true,
      recovered_redispatch: true,
    },
    summary: "redispatch_worker requirements stage recovered persisted spec",
  })
  return {
    actionID: action.payload.action_id,
    sessionID: session.id,
    specSnapshotID: spec.id,
    requirementsCount,
    decisionsCount,
  }
}

async function recoverPendingArchitectRedispatchAction(input: {
  taskID: string
  response: Awaited<ReturnType<typeof createAgentCoordinationResponse>>
  orchestratorSessionID: string
  sourceSessionID: string
  targetKind: string
}): Promise<
  | {
      actionID: string
      sessionID: string
      specSnapshotID: string
      contractGraphArtifactID: string
      goalsCount: number
      contractsCount: number
    }
  | undefined
> {
  if (input.response.createdNow !== false) return undefined
  const action = findAgentCoordinationAction({
    taskID: input.taskID,
    actionID: input.response.payload.action_id,
  })
  if (!action) {
    throw new Error(
      `agent coordination redispatch response ${input.response.payload.response_id} points to missing action ${input.response.payload.action_id}`,
    )
  }
  if (action.payload.status !== "pending") return undefined
  if (action.payload.action !== "redispatch_worker") return undefined
  const priorResult = action.payload.result ?? {}
  const binding = priorResult.redispatch_binding as Partial<AgentCoordinationRedispatchBinding> | undefined
  const dispatcher = typeof priorResult.dispatcher === "string" ? priorResult.dispatcher : binding?.dispatcher
  if (dispatcher !== "architect_stage") return undefined
  if (priorResult.redispatch_started !== true) return undefined
  const existingSessionIDs = new Set(
    Array.isArray(priorResult.preexisting_architect_session_ids)
      ? priorResult.preexisting_architect_session_ids.filter((value): value is string => typeof value === "string")
      : [],
  )
  const existingSpecSnapshotIDs = new Set(
    Array.isArray(priorResult.preexisting_spec_snapshot_ids)
      ? priorResult.preexisting_spec_snapshot_ids.filter((value): value is string => typeof value === "string")
      : [],
  )
  const existingContractGraphArtifactIDs = new Set(
    Array.isArray(priorResult.preexisting_architect_contract_graph_artifact_ids)
      ? priorResult.preexisting_architect_contract_graph_artifact_ids.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  )

  const newSessions = (await Session.children(input.orchestratorSessionID))
    .filter((session) => session.kind === "architect" && !existingSessionIDs.has(session.id))
    .sort((left, right) => {
      if (left.time.created !== right.time.created) return right.time.created - left.time.created
      return right.id.localeCompare(left.id)
    })
  if (newSessions.length > 1) {
    throw new Error(
      `architect_stage redispatch recovery for action ${action.payload.action_id} is ambiguous: new sessions ${newSessions
        .map((session) => session.id)
        .join(", ")}`,
    )
  }

  const specs = Database.use((db) =>
    db
      .select()
      .from(EngineSpecSnapshotTable)
      .where(
        and(
          eq(EngineSpecSnapshotTable.task_id, input.taskID),
          eq(EngineSpecSnapshotTable.version, 2),
          sql`${EngineSpecSnapshotTable.time_created} >= ${action.payload.created_at}`,
        ),
      )
      .orderBy(desc(EngineSpecSnapshotTable.time_created), desc(EngineSpecSnapshotTable.id))
      .all(),
  ).filter((row) => !existingSpecSnapshotIDs.has(row.id))
  if (specs.length > 1) {
    throw new Error(
      `architect_stage redispatch recovery for action ${action.payload.action_id} is ambiguous: new specs ${specs
        .map((row) => row.id)
        .join(", ")}`,
    )
  }

  const contractGraphArtifacts = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, input.taskID),
          eq(EngineArtifactTable.kind, "architect_contract_graph"),
          sql`${EngineArtifactTable.time_created} >= ${action.payload.created_at}`,
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .all(),
  ).filter((row) => !existingContractGraphArtifactIDs.has(row.id))
  if (contractGraphArtifacts.length > 1) {
    throw new Error(
      `architect_stage redispatch recovery for action ${action.payload.action_id} is ambiguous: new contract graphs ${contractGraphArtifacts
        .map((row) => row.id)
        .join(", ")}`,
    )
  }

  const session = newSessions[0]
  const spec = specs[0]
  const contractGraphArtifact = contractGraphArtifacts[0]
  if (!session || !spec || !contractGraphArtifact) return undefined
  const goalsCount = Database.use((db) =>
    db
      .select({ id: EngineGoalTable.id })
      .from(EngineGoalTable)
      .where(and(eq(EngineGoalTable.task_id, input.taskID), eq(EngineGoalTable.spec_snapshot_id, spec.id)))
      .all(),
  ).length
  if (goalsCount < 1) return undefined
  const contracts = (contractGraphArtifact.payload as { contracts?: unknown } | undefined)?.contracts
  const contractsCount = Array.isArray(contracts) ? contracts.length : 0
  await completeAgentCoordinationAction({
    taskID: input.taskID,
    actionID: action.payload.action_id,
    result: {
      dispatcher: "architect_stage",
      stage: "architect",
      source_session_id: input.sourceSessionID,
      redispatch_session_id: session.id,
      spec_snapshot_id: spec.id,
      architect_contract_graph_artifact_id: contractGraphArtifact.id,
      goals_count: goalsCount,
      contracts_count: contractsCount,
      target_kind: input.targetKind,
      started: true,
      recovered_redispatch: true,
    },
    summary: "redispatch_worker architect stage recovered persisted spec",
  })
  return {
    actionID: action.payload.action_id,
    sessionID: session.id,
    specSnapshotID: spec.id,
    contractGraphArtifactID: contractGraphArtifact.id,
    goalsCount,
    contractsCount,
  }
}

async function recoverPendingVisualQaRedispatchAction(input: {
  taskID: string
  response: Awaited<ReturnType<typeof createAgentCoordinationResponse>>
  orchestratorSessionID: string
  sourceSessionID: string
  targetKind: string
}): Promise<
  | {
      actionID: string
      sessionID: string
      accepted: boolean
      submittedAccepted: boolean
      findingsCount: number
      productionBlockersCount: number
      evidenceCount: number
      repairsCount: number
      changedFilesCount: number
    }
  | undefined
> {
  if (input.response.createdNow !== false) return undefined
  const action = findAgentCoordinationAction({
    taskID: input.taskID,
    actionID: input.response.payload.action_id,
  })
  if (!action) {
    throw new Error(
      `agent coordination redispatch response ${input.response.payload.response_id} points to missing action ${input.response.payload.action_id}`,
    )
  }
  if (action.payload.status !== "pending") return undefined
  if (action.payload.action !== "redispatch_worker") return undefined
  const priorResult = action.payload.result ?? {}
  const binding = priorResult.redispatch_binding as Partial<AgentCoordinationRedispatchBinding> | undefined
  const dispatcher = typeof priorResult.dispatcher === "string" ? priorResult.dispatcher : binding?.dispatcher
  if (dispatcher !== "visual_qa_stage") return undefined
  if (priorResult.redispatch_started !== true) return undefined
  const existingSessionIDs = new Set(
    Array.isArray(priorResult.preexisting_visual_qa_session_ids)
      ? priorResult.preexisting_visual_qa_session_ids.filter((value): value is string => typeof value === "string")
      : [],
  )
  const existingDecisionIDs = new Set(
    Array.isArray(priorResult.preexisting_visual_qa_decision_ids)
      ? priorResult.preexisting_visual_qa_decision_ids.filter((value): value is string => typeof value === "string")
      : [],
  )

  const newSessions = (await Session.children(input.orchestratorSessionID))
    .filter((session) => session.kind === "visual-qa" && !existingSessionIDs.has(session.id))
    .sort((left, right) => {
      if (left.time.created !== right.time.created) return right.time.created - left.time.created
      return right.id.localeCompare(left.id)
    })
  if (newSessions.length > 1) {
    throw new Error(
      `visual_qa_stage redispatch recovery for action ${action.payload.action_id} is ambiguous: new sessions ${newSessions
        .map((session) => session.id)
        .join(", ")}`,
    )
  }
  const entries = Database.use((db) =>
    db
      .select()
      .from(DecisionLogTable)
      .where(
        and(
          eq(DecisionLogTable.task_id, input.taskID),
          eq(DecisionLogTable.phase, "visual_qa"),
          sql`${DecisionLogTable.time_created} >= ${action.payload.created_at}`,
        ),
      )
      .orderBy(desc(DecisionLogTable.time_created), desc(DecisionLogTable.id))
      .all(),
  ).filter((row) => !existingDecisionIDs.has(row.id))
  const reportEntries = entries.filter((entry) => entry.key.startsWith("report_"))
  const summaryEntries = entries.filter((entry) => entry.key === "latest_summary")
  if (reportEntries.length > 1) {
    throw new Error(
      `visual_qa_stage redispatch recovery for action ${action.payload.action_id} is ambiguous: report entries ${reportEntries
        .map((entry) => entry.id)
        .join(", ")}`,
    )
  }
  if (summaryEntries.length > 1) {
    throw new Error(
      `visual_qa_stage redispatch recovery for action ${action.payload.action_id} is ambiguous: latest_summary entries ${summaryEntries
        .map((entry) => entry.id)
        .join(", ")}`,
    )
  }
  const session = newSessions[0]
  const reportEntry = reportEntries[0]
  const summaryEntry = summaryEntries[0]
  if (!session || !reportEntry || !summaryEntry) return undefined
  if (!reportEntry.reason.includes(`session ${session.id}`)) {
    throw new Error(
      `visual_qa_stage redispatch recovery for action ${action.payload.action_id} found report ${reportEntry.id} not bound to recovered session ${session.id}`,
    )
  }
  let reportPayload: unknown
  try {
    reportPayload = JSON.parse(reportEntry.value)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`visual_qa_stage redispatch recovery report ${reportEntry.id} is not JSON: ${detail}`)
  }
  const parsed = VisualQaReportSchema.safeParse(reportPayload)
  if (!parsed.success) {
    throw new Error(
      `visual_qa_stage redispatch recovery report ${reportEntry.id} is malformed: ${parsed.error.message}`,
    )
  }
  const semantics = visualQaReportAcceptanceSemantics(parsed.data)
  await completeAgentCoordinationAction({
    taskID: input.taskID,
    actionID: action.payload.action_id,
    result: {
      dispatcher: "visual_qa_stage",
      stage: "visual-qa",
      source_session_id: input.sourceSessionID,
      redispatch_session_id: session.id,
      visual_qa_report_decision_id: reportEntry.id,
      visual_qa_summary_decision_id: summaryEntry.id,
      accepted: semantics.effectiveAccepted,
      submitted_accepted: semantics.submittedAccepted,
      findings_count: parsed.data.findings.length,
      production_blockers_count: parsed.data.production_blockers.length,
      evidence_count: parsed.data.evidence.length,
      repairs_count: parsed.data.repairs.length,
      changed_files_count: parsed.data.changed_files.length,
      target_kind: input.targetKind,
      started: true,
      recovered_redispatch: true,
    },
    summary: "redispatch_worker visual_qa stage recovered persisted report",
  })
  return {
    actionID: action.payload.action_id,
    sessionID: session.id,
    accepted: semantics.effectiveAccepted,
    submittedAccepted: semantics.submittedAccepted,
    findingsCount: parsed.data.findings.length,
    productionBlockersCount: parsed.data.production_blockers.length,
    evidenceCount: parsed.data.evidence.length,
    repairsCount: parsed.data.repairs.length,
    changedFilesCount: parsed.data.changed_files.length,
  }
}

async function recoverPendingIntegrityRedispatchAction(input: {
  taskID: string
  response: Awaited<ReturnType<typeof createAgentCoordinationResponse>>
  orchestratorSessionID: string
  sourceSessionID: string
  targetKind: string
}): Promise<
  | {
      actionID: string
      sessionID: string
      artifactID: string
      specSnapshotID: string
      phase: "pre_build" | "post_build"
      verdict: "pass" | "concerns" | "needs_correction"
      reviewerCount: number
      findingsCount: number
      requiredRepairsCount: number
      unresolvedDisagreementsCount: number
    }
  | undefined
> {
  if (input.response.createdNow !== false) return undefined
  const action = findAgentCoordinationAction({
    taskID: input.taskID,
    actionID: input.response.payload.action_id,
  })
  if (!action) {
    throw new Error(
      `agent coordination redispatch response ${input.response.payload.response_id} points to missing action ${input.response.payload.action_id}`,
    )
  }
  if (action.payload.status !== "pending") return undefined
  if (action.payload.action !== "redispatch_worker") return undefined
  const priorResult = action.payload.result ?? {}
  const binding = priorResult.redispatch_binding as Partial<AgentCoordinationRedispatchBinding> | undefined
  const dispatcher = typeof priorResult.dispatcher === "string" ? priorResult.dispatcher : binding?.dispatcher
  if (dispatcher !== "integrity_stage") return undefined
  if (priorResult.redispatch_started !== true) return undefined
  const existingSessionIDs = new Set(
    Array.isArray(priorResult.preexisting_integrity_session_ids)
      ? priorResult.preexisting_integrity_session_ids.filter((value): value is string => typeof value === "string")
      : [],
  )
  const existingArtifactIDs = new Set(
    Array.isArray(priorResult.preexisting_integrity_attempt_artifact_ids)
      ? priorResult.preexisting_integrity_attempt_artifact_ids.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  )

  const newSessions = (await Session.children(input.orchestratorSessionID))
    .filter((session) => session.kind === "integrity" && !existingSessionIDs.has(session.id))
    .sort((left, right) => {
      if (left.time.created !== right.time.created) return right.time.created - left.time.created
      return right.id.localeCompare(left.id)
    })
  if (newSessions.length > 1) {
    throw new Error(
      `integrity_stage redispatch recovery for action ${action.payload.action_id} is ambiguous: new sessions ${newSessions
        .map((session) => session.id)
        .join(", ")}`,
    )
  }
  const artifacts = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, input.taskID),
          eq(EngineArtifactTable.kind, "integrity_attempt"),
          sql`${EngineArtifactTable.time_created} >= ${action.payload.created_at}`,
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .all(),
  ).filter((row) => !existingArtifactIDs.has(row.id))
  if (artifacts.length > 1) {
    throw new Error(
      `integrity_stage redispatch recovery for action ${action.payload.action_id} is ambiguous: new integrity_attempt artifacts ${artifacts
        .map((row) => row.id)
        .join(", ")}`,
    )
  }

  const session = newSessions[0]
  const artifact = artifacts[0]
  if (!session || !artifact) return undefined
  const payload = artifact.payload as
    | {
        session_id?: unknown
        spec_snapshot_id?: unknown
        phase?: unknown
        verdict?: unknown
        reviewers?: unknown
        findings_count?: unknown
        required_repairs_count?: unknown
        unresolved_disagreements_count?: unknown
      }
    | undefined
  if (payload?.session_id !== session.id) {
    throw new Error(
      `integrity_stage redispatch recovery for action ${action.payload.action_id} found integrity_attempt ${artifact.id} not bound to recovered session ${session.id}`,
    )
  }
  if (typeof payload.spec_snapshot_id !== "string") {
    throw new Error(`integrity_stage redispatch recovery integrity_attempt ${artifact.id} has no spec_snapshot_id`)
  }
  const phase = payload.phase
  if (phase !== "pre_build" && phase !== "post_build") {
    throw new Error(`integrity_stage redispatch recovery integrity_attempt ${artifact.id} has invalid phase`)
  }
  const verdict = payload.verdict
  if (verdict !== "pass" && verdict !== "concerns" && verdict !== "needs_correction") {
    throw new Error(`integrity_stage redispatch recovery integrity_attempt ${artifact.id} has invalid verdict`)
  }
  const reviewers = Array.isArray(payload.reviewers) ? payload.reviewers : []
  const findingsCount = typeof payload.findings_count === "number" ? payload.findings_count : 0
  const requiredRepairsCount = typeof payload.required_repairs_count === "number" ? payload.required_repairs_count : 0
  const unresolvedDisagreementsCount =
    typeof payload.unresolved_disagreements_count === "number" ? payload.unresolved_disagreements_count : 0
  await completeAgentCoordinationAction({
    taskID: input.taskID,
    actionID: action.payload.action_id,
    result: {
      dispatcher: "integrity_stage",
      stage: "integrity",
      source_session_id: input.sourceSessionID,
      redispatch_session_id: session.id,
      spec_snapshot_id: payload.spec_snapshot_id,
      phase,
      verdict,
      reviewer_count: reviewers.length,
      findings_count: findingsCount,
      required_repairs_count: requiredRepairsCount,
      unresolved_disagreements_count: unresolvedDisagreementsCount,
      integrity_attempt_id: artifact.id,
      target_kind: input.targetKind,
      started: true,
      recovered_redispatch: true,
    },
    summary: "redispatch_worker integrity stage recovered persisted attempt",
  })
  return {
    actionID: action.payload.action_id,
    sessionID: session.id,
    artifactID: artifact.id,
    specSnapshotID: payload.spec_snapshot_id,
    phase,
    verdict,
    reviewerCount: reviewers.length,
    findingsCount,
    requiredRepairsCount,
    unresolvedDisagreementsCount,
  }
}

function agentCoordinationWorkerMessageID(actionID: string): string {
  return Identifier.ascending("message", `msg_agent_coordination_${actionID}`)
}

function agentCoordinationWorkerMessagePartID(actionID: string): string {
  return Identifier.ascending("part", `prt_agent_coordination_${actionID}`)
}

function agentCoordinationQuestionID(actionID: string): string {
  return Identifier.ascending("question", `que_agent_coordination_${actionID}`)
}

function recordedAgentCoordinationWorkerMessageID(
  action: NonNullable<ReturnType<typeof findAgentCoordinationAction>>,
): string | undefined {
  const value = action.payload.result?.worker_message_id
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function recordedAgentCoordinationQuestionID(
  action: NonNullable<ReturnType<typeof findAgentCoordinationAction>>,
): string | undefined {
  const value = action.payload.result?.question_id
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function answersFromInteraction(
  interaction: NonNullable<ReturnType<typeof findInteractionByExternal>>,
): Question.Answer[] {
  const answers = interaction.response?.answers
  return Array.isArray(answers) ? (answers as Question.Answer[]) : []
}

async function findAgentCoordinationWorkerMessage(input: {
  sessionID: string
  messageID: string
}): Promise<Awaited<ReturnType<typeof Message.get>> | undefined> {
  try {
    return await Message.get({ sessionID: input.sessionID, messageID: input.messageID })
  } catch (error) {
    if (!NotFoundError.isInstance(error as Error)) throw error
    return undefined
  }
}

async function requireAgentCoordinationWorkerMessage(input: {
  sessionID: string
  messageID: string
  actionID: string
}): Promise<Awaited<ReturnType<typeof Message.get>>> {
  const message = await findAgentCoordinationWorkerMessage({
    sessionID: input.sessionID,
    messageID: input.messageID,
  })
  if (!message) {
    throw new Error(
      `A2A continue action ${input.actionID} records worker message ${input.messageID}, but the message is missing`,
    )
  }
  return message
}

async function waitForQuestionInteraction(input: { questionID: string; taskID: string; resolved?: boolean }) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const interaction = findInteractionByExternal(input.questionID)
    if (interaction) {
      if (interaction.task_id !== input.taskID) {
        throw new Error(
          `A2A ask_user question ${input.questionID} projected to task ${interaction.task_id}, not ${input.taskID}`,
        )
      }
      if (input.resolved !== true || interaction.status !== "pending") return interaction
    }
    await Bun.sleep(25)
  }
  throw new Error(
    input.resolved === true
      ? `A2A ask_user question ${input.questionID} interaction did not resolve`
      : `A2A ask_user question ${input.questionID} did not project to an engine interaction`,
  )
}

type AgentCoordinationCancelStatusEvent = {
  eventID: string
  emittedAt: number
  seq: number
  status: { type: "terminal"; reason: "aborted"; error?: string }
}

type AgentCoordinationSessionStatusEvent = {
  eventID: string
  emittedAt: number
  seq: number
  status: SessionStatus.Info
}

type AgentCoordinationTerminalToolOwnership = {
  ownershipID: string
  artifactID: string
  outcome: OrchestratorToolOwnershipOutcome
  timeCompleted: number
}

function sessionStatusFromPayload(payload: unknown): SessionStatus.Info | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined
  const status = (payload as Record<string, unknown>).status
  if (!status || typeof status !== "object" || Array.isArray(status)) return undefined
  const parsed = SessionStatus.Info.safeParse(status)
  if (!parsed.success) return undefined
  return parsed.data
}

function cancelledWorkerStatusFromPayload(payload: unknown): AgentCoordinationCancelStatusEvent["status"] | undefined {
  const status = sessionStatusFromPayload(payload)
  if (status?.type !== "terminal" || status.reason !== "aborted") return undefined
  return {
    type: "terminal",
    reason: "aborted",
    ...(typeof status.error === "string" ? { error: status.error } : {}),
  }
}

function findLatestAgentCoordinationSessionStatusEvent(input: {
  taskID: string
  sessionID: string
}): AgentCoordinationSessionStatusEvent | undefined {
  const rows = Database.use((db) =>
    db
      .select({
        id: ProtocolEventTable.id,
        payload: ProtocolEventTable.payload,
        emittedAt: ProtocolEventTable.emitted_at,
        seq: ProtocolEventTable.seq,
      })
      .from(ProtocolEventTable)
      .where(
        and(
          eq(ProtocolEventTable.task_id, input.taskID),
          eq(ProtocolEventTable.session_id, input.sessionID),
          eq(ProtocolEventTable.type, "session.status"),
        ),
      )
      .orderBy(desc(ProtocolEventTable.emitted_at), desc(ProtocolEventTable.seq))
      .all(),
  )
  for (const row of rows) {
    const status = sessionStatusFromPayload(row.payload)
    if (status) return { eventID: row.id, emittedAt: row.emittedAt, seq: row.seq, status }
  }
  return undefined
}

function findRequestTerminalToolOwnership(input: {
  taskID: string
  request: AgentCoordinationRequestRow
}): AgentCoordinationTerminalToolOwnership | undefined {
  if (input.request.payload.session_ownership_source !== "live_tool_ownership") return undefined
  const ownershipID = input.request.payload.tool_ownership_id
  if (!ownershipID) {
    throw new Error(
      `A2A request ${input.request.payload.request_id} records live_tool_ownership without tool_ownership_id`,
    )
  }
  const ownership = findLatestOwnershipByID(input.taskID, ownershipID)
  if (!ownership) {
    throw new Error(`A2A request ${input.request.payload.request_id} references missing ownership ${ownershipID}`)
  }
  if (ownership.payload.child_session_id !== input.request.payload.session_id) {
    throw new Error(
      `A2A request ${input.request.payload.request_id} ownership ${ownershipID} belongs to session ${ownership.payload.child_session_id}, not ${input.request.payload.session_id}`,
    )
  }
  if (!ownership.payload.time_completed || !ownership.payload.outcome) return undefined
  return {
    ownershipID,
    artifactID: ownership.artifactID,
    outcome: ownership.payload.outcome,
    timeCompleted: ownership.payload.time_completed,
  }
}

function findAgentCoordinationCancelStatusEvent(input: {
  taskID: string
  sessionID: string
  afterMs: number
}): AgentCoordinationCancelStatusEvent | undefined {
  const rows = Database.use((db) =>
    db
      .select({
        id: ProtocolEventTable.id,
        payload: ProtocolEventTable.payload,
        emittedAt: ProtocolEventTable.emitted_at,
        seq: ProtocolEventTable.seq,
      })
      .from(ProtocolEventTable)
      .where(
        and(
          eq(ProtocolEventTable.task_id, input.taskID),
          eq(ProtocolEventTable.session_id, input.sessionID),
          eq(ProtocolEventTable.type, "session.status"),
        ),
      )
      .orderBy(desc(ProtocolEventTable.emitted_at), desc(ProtocolEventTable.seq))
      .all(),
  )
  for (const row of rows) {
    if (row.emittedAt < input.afterMs) continue
    const status = cancelledWorkerStatusFromPayload(row.payload)
    if (status) return { eventID: row.id, emittedAt: row.emittedAt, seq: row.seq, status }
  }
  return undefined
}

async function waitForAgentCoordinationCancelStatusEvent(input: {
  taskID: string
  sessionID: string
  afterMs: number
  reason: string
}): Promise<AgentCoordinationCancelStatusEvent> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const event = findAgentCoordinationCancelStatusEvent(input)
    if (event) return event
    await Bun.sleep(25)
  }
  throw new Error(
    `A2A cancel_worker for session ${input.sessionID} did not project a durable terminal aborted session.status event: ${input.reason}`,
  )
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function cancelLiveOwnedBuild(input: {
  taskID: string
  sessionID: string
  goalRunID?: string
  owner: OrchestratorToolOwnershipRow
  reason: string
  reasonPrefix?: string
  originSite?: string
  metadata?: Record<string, unknown>
}) {
  const cancelReason = `${input.reasonPrefix ?? "cancel_subagent"}: ${input.reason}`
  const goalRunID = input.goalRunID ?? input.owner.payload.goal_run_id
  const before = goalRunID ? findGoalRun(goalRunID) : undefined
  const aborted = await abortLiveOrchestratorToolOwnership({
    taskID: input.taskID,
    ownerships: [input.owner],
    reason: cancelReason,
    originSite: input.originSite ?? "orchestrator.tools.cancel-subagent-live-build",
    metadata: input.metadata ?? { cancelled_live_build: true },
  })
  let goalFact = ""
  if (goalRunID) {
    const goalRun = findGoalRun(goalRunID)
    if (goalRun && (aborted.goalRuns > 0 || before?.status !== goalRun.status)) {
      goalFact = ` goal_run ${goalRun.id} aborted.`
    } else if (goalRun) {
      goalFact = ` goal_run ${goalRun.id} was already terminal (${goalRun.status}); ownership closed.`
    }
  }
  return goalFact
}

/**
 * Returns the subset of `updates` whose value differs from the persisted
 * `goal` row. Used by `modify_goal` to filter out no-op updates so the
 * orchestrator LLM cannot trigger phase=retry decision_log feedback by
 * resubmitting the SAME contract — that pattern was misused as a side
 * channel when build failures had unrelated root causes (e.g. missing
 * terminal tool call), polluting the next attempt's retry feedback with
 * a generic "contract changed, re-read acceptance_specs" template that
 * had nothing to do with the actual failure.
 *
 * Compared via JSON serialization: arrays / strings / primitive unions
 * round-trip identically as long as both sides are already deserialized
 * to the same shape (the goal row from listGoals is, and Zod-validated
 * `updates` is).
 */
export function computeContractFieldChanges(
  updates: Record<string, unknown>,
  goal: Record<string, unknown>,
): Record<string, unknown> {
  const contractFields = [
    "title",
    "objective",
    "acceptance_specs",
    "owned_paths",
    "depends_on",
    "priority",
    "kind",
    "requirement_ids",
  ] as const
  const setValues: Record<string, unknown> = {}
  for (const f of contractFields) {
    const incoming = updates[f]
    if (incoming === undefined) continue
    const current = goal[f]
    if (JSON.stringify(incoming) === JSON.stringify(current)) continue
    setValues[f] = incoming
  }
  return setValues
}

export function validatePersistedArchitectFidelity(input: {
  task: TaskRow
  goals: Array<{ id: string; owned_paths?: string[] }>
  workDir?: string
  executionStarted?: boolean
}) {
  return architectFidelityIssues({
    goals: input.goals.map((goal) => ({ id: goal.id, owned_paths: goal.owned_paths ?? [] })),
    fidelity: readPersistedArchitectFidelity(input.task),
    designSpecs: Array.isArray(input.task.design_specs) ? (input.task.design_specs as any) : undefined,
    workDir: input.workDir ?? Instance.directory,
    requireSourceCoverage: input.executionStarted !== true,
    requireReferenceCoverage: (Array.isArray(input.task.design_specs) ? input.task.design_specs.length : 0) > 0,
  })
}

export async function composeLatestAcceptanceFeedbackForBuild(input: {
  taskID: string
  goalID?: string
}): Promise<string | undefined> {
  const verdictArtifact = findLatestAcceptanceVerdictArtifact(input.taskID)
  const verdictPayload = (verdictArtifact?.payload ?? {}) as Record<string, unknown>
  if (!verdictArtifact || verdictPayload.verdict !== "rejected") return undefined

  const rejectionDetails = Array.isArray(verdictPayload.rejection_details)
    ? (verdictPayload.rejection_details as Array<Record<string, unknown>>)
    : []
  const scopedDetails = input.goalID
    ? rejectionDetails.filter((detail) => detail.goal_id === input.goalID)
    : rejectionDetails

  const { findLatestAcceptanceEvidenceManifest, formatAcceptanceManifestFailureDetails } = await import(
    "@/acceptance/manifest"
  )
  const acceptanceID = verdictArtifact.acceptance_id ?? undefined
  const manifest = acceptanceID ? findLatestAcceptanceEvidenceManifest({ acceptanceID }) : undefined
  const manifestFailureDetails = manifest ? formatAcceptanceManifestFailureDetails(manifest) : []
  return composeAcceptanceRetryFeedback({
    iteration: typeof manifest?.iteration === "number" ? manifest.iteration : 0,
    verdict: String(verdictPayload.verdict),
    summary: typeof verdictPayload.summary === "string" ? verdictPayload.summary : "",
    manifestFailureDetails,
    ownDetails: scopedDetails.map((detail) => ({
      category: typeof detail.category === "string" ? detail.category : "unknown",
      error: typeof detail.error === "string" ? detail.error : JSON.stringify(detail),
      goal_id: typeof detail.goal_id === "string" ? detail.goal_id : undefined,
      check_id: typeof detail.check_id === "string" ? detail.check_id : undefined,
      file: typeof detail.file === "string" ? detail.file : undefined,
      suggestion: typeof detail.suggestion === "string" ? detail.suggestion : undefined,
      visual_spec_id: typeof detail.visual_spec_id === "string" ? detail.visual_spec_id : undefined,
    })),
    scope: input.goalID ? "goal" : "integrated_tree",
  })
}

async function composeIntegrityFeedbackMarkdownForBuild(input: {
  taskID: string
  activeSpecSnapshotID?: string
}): Promise<string | undefined> {
  if (!input.activeSpecSnapshotID) return undefined
  const { buildSpecSnapshotLineage } = await import("@/integrity/replay-context")
  const { composeIntegrityFeedbackForBuild } = await import("@/integrity/build-feedback")
  const { getSharedIntegrityPromptBudget } = await import("@/integrity/shared-prompt")
  const lineage = buildSpecSnapshotLineage({
    taskID: input.taskID,
    activeSpecSnapshotID: input.activeSpecSnapshotID,
  })
  return composeIntegrityFeedbackForBuild({
    taskID: input.taskID,
    specSnapshotLineage: lineage,
    promptBudget: getSharedIntegrityPromptBudget(),
    runtimeMarkdownDir: ProjectRuntimePaths.taskAbsolute(
      taskPrimaryProjectRoot(input.taskID),
      input.taskID,
      "integrity-feedback",
    ),
  })?.promptMarkdown
}

async function loadLatestRenderedRetryAttachment(input: {
  taskID: string
  enabled: boolean
}): Promise<import("@/build/agent").BuildAgent.BuildContext["retryAttachments"]> {
  if (!input.enabled) return undefined
  try {
    const task = requireTask(input.taskID)
    const artifacts = Array.isArray(task.system_artifacts) ? task.system_artifacts : []
    const rendered = [...artifacts]
      .reverse()
      .find(
        (artifact) =>
          artifact?.intent === "rendered_output" &&
          typeof artifact.url === "string" &&
          typeof artifact.mime === "string" &&
          artifact.mime.startsWith("image/"),
      )
    if (!rendered) return undefined
    const { AttachmentStore } = await import("@/storage/attachment-store")
    const located = AttachmentStore.nameFromUrl(rendered.url)
    if (!located) {
      throw new Error(
        `rendered_output artifact has no resolvable attachment url: ${rendered.filename ?? rendered.sha ?? rendered.url}`,
      )
    }
    const abs = AttachmentStore.resolveAbsolute(located.projectID, located.name)
    if (!abs) {
      throw new Error(`rendered_output artifact ${located.projectID}/${located.name} is not resolvable on disk`)
    }
    return [
      {
        url: rendered.url,
        mime: rendered.mime,
        filename: "previous-attempt-rendered.png",
      },
    ]
  } catch (err) {
    log.warn("build retry: failed to load previous rendered screenshot attachment", {
      taskID: input.taskID,
      error: err instanceof Error ? err.message : String(err),
    })
    return undefined
  }
}

/**
 * Lightweight MIME guess from filename extension. Covers the design-material
 * spectrum: images (inlined multimodal), PDFs (multimodal), text / markdown /
 * JSON / CSS / YAML (reference-only, read via read_attachment). Falls back to
 * `application/octet-stream` so AttachmentStore.write still accepts the file
 * — the multimodal-vs-reference partition then decides how it's surfaced.
 */
function guessMimeFromFilename(filename: string): string {
  const ext = (filename.split(".").pop() || "").toLowerCase()
  const table: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    avif: "image/avif",
    heic: "image/heic",
    heif: "image/heif",
    pdf: "application/pdf",
    md: "text/markdown",
    markdown: "text/markdown",
    txt: "text/plain",
    log: "text/plain",
    json: "application/json",
    jsonc: "application/json",
    yaml: "text/yaml",
    yml: "text/yaml",
    css: "text/css",
    scss: "text/css",
    less: "text/css",
    html: "text/html",
    htm: "text/html",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    mp3: "audio/mpeg",
    wav: "audio/wav",
  }
  return table[ext] ?? "application/octet-stream"
}

const FIGMA_URL_PATTERN = /\bhttps?:\/\/(?:[\w-]+\.)?figma\.com\/(?:file|design|proto|board)\/[^\s)]+/i

function isFigmaUrl(value: string): boolean {
  return FIGMA_URL_PATTERN.test(value)
}

function parseFigmaMaterialUrl(value: string): { nodeID: string } {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch (err) {
    throw new Error(`invalid Figma URL for frontend_design MCP materialization: ${value}`, { cause: err })
  }
  if (!/(^|\.)figma\.com$/i.test(parsed.hostname)) {
    throw new Error(`frontend_design Figma MCP materialization expected a figma.com URL: ${value}`)
  }
  const node = parsed.searchParams.get("node-id")
  if (!node?.trim()) {
    throw new Error(`frontend_design Figma MCP materialization requires a node-id query parameter: ${value}`)
  }
  return { nodeID: node.replace(/-/g, ":") }
}

type FigmaMcpToolName = "get_design_context" | "get_screenshot" | "get_metadata" | "get_variable_defs"

async function resolveFigmaMcpToolKeys(): Promise<Record<FigmaMcpToolName, string>> {
  const { MCP } = await import("@/mcp")
  const tools = await MCP.serverTools()

  const pick = (name: FigmaMcpToolName): string => {
    const matches = tools.filter(
      (item) => item.name === name || item.key === `Figma_${name}` || item.key === `figma_${name}`,
    )
    if (matches.length === 0) {
      throw new Error(
        `Figma MCP tool missing: ${name}. Connect a Figma MCP server that exposes get_design_context, get_screenshot, get_metadata, and get_variable_defs.`,
      )
    }
    if (matches.length > 1) {
      throw new Error(`Ambiguous Figma MCP tool ${name}: ${matches.map((item) => item.key).join(", ")}`)
    }
    return matches[0]!.key
  }

  return {
    get_design_context: pick("get_design_context"),
    get_screenshot: pick("get_screenshot"),
    get_metadata: pick("get_metadata"),
    get_variable_defs: pick("get_variable_defs"),
  }
}

async function materializeFigmaMcpReference(input: {
  taskID: string
  projectID: string
  figmaUrl: string
}): Promise<number> {
  const { MCP } = await import("@/mcp")
  const tools = await resolveFigmaMcpToolKeys()
  const { nodeID } = parseFigmaMaterialUrl(input.figmaUrl)
  const nodeId = nodeID
  const common = {
    nodeId,
    clientLanguages: "typescript,html,css",
    clientFrameworks: "react,tailwindcss",
  }

  const [designContextRaw, screenshotRaw, metadataRaw, variableDefsRaw] = await Promise.all([
    MCP.callTool({
      key: tools.get_design_context,
      args: {
        ...common,
        artifactType: "WEB_PAGE_OR_APP_SCREEN",
        taskType: "CREATE_ARTIFACT",
      },
    }),
    MCP.callTool({
      key: tools.get_screenshot,
      args: { nodeId },
    }),
    MCP.callTool({
      key: tools.get_metadata,
      args: common,
    }),
    MCP.callTool({
      key: tools.get_variable_defs,
      args: common,
    }),
  ])

  const screenshot = await materializeMcpToolResult({
    projectID: input.projectID,
    result: screenshotRaw as any,
    imageFilename: `figma-${nodeID.replace(/[^a-zA-Z0-9]/g, "_")}.png`,
  })
  if (screenshot.attachments.length === 0) {
    throw new Error(`Figma MCP get_screenshot produced no image content for node ${nodeID}`)
  }
  for (const ref of screenshot.attachments) {
    await EngineService.appendTaskAttachment(input.taskID, {
      ...ref,
      intent: "visual_reference",
      source: "figma-mcp",
    })
  }

  const textArtifacts = [
    ["figma-design-context", designContextRaw],
    ["figma-metadata", metadataRaw],
    ["figma-variable-defs", variableDefsRaw],
  ] as const
  for (const [label, raw] of textArtifacts) {
    const materialized = await materializeMcpToolResult({
      projectID: input.projectID,
      result: raw as any,
    })
    if (!materialized.text.trim()) {
      throw new Error(`Figma MCP ${label} produced no text content for node ${nodeID}`)
    }
    const body = [
      `# ${label}`,
      ``,
      `- Source: ${input.figmaUrl}`,
      `- Node: ${nodeID}`,
      ``,
      materialized.text.trim(),
    ].join("\n")
    const ref = await (
      await import("@/storage/attachment-store")
    ).AttachmentStore.write(
      input.projectID,
      Buffer.from(body, "utf8"),
      "text/markdown",
      `${label}-${nodeID.replace(/[^a-zA-Z0-9]/g, "_")}.md`,
    )
    await EngineService.appendTaskSystemArtifact(input.taskID, {
      ...ref,
      intent: "design_reference",
      source: "figma-mcp",
    })
  }

  return 1
}

// Re-export the stateful-tool registry (defined in a dependency-free module
// so `session/message.ts` can import it without creating a circular graph
// through `@/session`). Surfacing it from this module keeps it visible to
// developers reading tool definitions.
export { STATEFUL_SNAPSHOT_TOOL_NAMES, type StatefulSnapshotToolName } from "./stateful-tool-names"

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

/**
 * Synthesize a `FactCheckReport` for tool-error / aborted / scope-mismatch
 * paths where the LLM never returned a valid report.  Single construction
 * site so every error path persists a schema-valid artifact (rule 8 single
 * source; codex impl review §1).  The synthetic report carries the snapshot
 * scope (so the idempotency lookup still works) plus one `unresolved` entry
 * naming the host-side reason — read_context surfaces this verbatim.
 *
 * **Verdict is unconditionally `inconclusive`** — tool failure / cancel /
 * scope-mismatch is by definition "we could not verify", which is exactly
 * what inconclusive means.  This is NOT the same category as
 * `deriveFactCheckVerdict()`'s decision tree, which assumes a SUCCESSFUL
 * agent run: that tree's `items_total === 0 → clean` boundary fires when
 * a worker registered zero claims AND the agent ran cleanly through
 * verification.  Here the agent never operated, so the items_total=0
 * boundary doesn't apply — a tool-error artifact must never be marked
 * clean (codex impl review round 3 §B-1; round 2 §B-1 backstory).
 *
 * Severity on the unresolved entry is `minor` — tool failure says
 * "could not verify", not "the worker is wrong".  Blocking severity
 * would trigger `needs_orchestrator_action`, which is reserved for
 * cases where the agent SUCCESSFULLY found something wrong.
 */
function synthesizeToolErrorReport(input: {
  snap: { messageID?: string; contentHash?: string }
  args: { target_session_id: string; target_agent: string; fact_check_items: unknown[] }
  reason: string
}): FactCheckReport {
  const itemsTotal = input.args.fact_check_items.length
  return {
    scope: {
      target_session_id: input.args.target_session_id,
      target_agent: input.args.target_agent,
      target_message_id: input.snap.messageID ?? "",
      target_message_content_hash: input.snap.contentHash ?? "",
      items_total: itemsTotal,
      items_inspected: 0,
    },
    verified: [],
    corrected: [],
    unresolved: [
      {
        claim: input.reason.slice(0, 600),
        why_unresolved: "tool_failed" as const,
        severity: "minor" as const,
      },
    ],
    overall_verdict: "inconclusive",
  }
}

/**
 * Render a FactCheckReport as orchestrator-facing markdown.  Single-file
 * inline because the orchestrator yield is a string; the agent's own
 * markdown renderer at fact-check/tools.ts uses a different shape.
 */
function renderFactCheckReport(report: FactCheckReport): string {
  const sections: string[] = []
  sections.push(
    `**scope**: target_session=\`${report.scope.target_session_id}\` agent=\`${report.scope.target_agent}\` ` +
      `items=${report.scope.items_inspected}/${report.scope.items_total}`,
  )
  if (report.verified.length > 0) {
    sections.push(
      `### Verified (${report.verified.length})\n` +
        report.verified
          .map(
            (v, i) =>
              `${i + 1}. ${v.claim}\n` +
              v.evidence.map((e) => `   - [${e.kind}] ${e.pointer}: ${e.excerpt.slice(0, 240)}`).join("\n"),
          )
          .join("\n\n"),
    )
  }
  if (report.corrected.length > 0) {
    sections.push(
      `### Corrected (${report.corrected.length})\n` +
        report.corrected
          .map(
            (c, i) =>
              `${i + 1}. [${c.severity}] ${c.claim}\n` +
              `   → **${c.correction}**\n` +
              `   recommended_action: \`${c.recommended_action}\`\n` +
              c.evidence.map((e) => `   - [${e.kind}] ${e.pointer}: ${e.excerpt.slice(0, 240)}`).join("\n"),
          )
          .join("\n\n"),
    )
  }
  if (report.unresolved.length > 0) {
    sections.push(
      `### Unresolved (${report.unresolved.length})\n` +
        report.unresolved.map((u, i) => `${i + 1}. [${u.severity}, ${u.why_unresolved}] ${u.claim}`).join("\n"),
    )
  }
  return sections.join("\n\n")
}

export function createOrchestratorTools(input: {
  taskID: string
  agentSessionID: string
  signal?: AbortSignal
  workflow?: import("@/engine/workflow").MiniWorkflow
  workflowState?: import("@/engine/workflow").WorkflowState
  operatorMessage?: {
    text: string
    attachmentSummary?: string
    source?: string
    target?: TaskMessageTargetInput
    messageID?: string
  }
}) {
  const { taskID } = input

  async function cleanupTerminalGoalWorkspaces(reason: string): Promise<number> {
    const { cleanupGoalWorkspaceForGoal } = await import("@/engine/writer")
    let cleaned = 0
    const errors: string[] = []
    for (const goal of listGoals(taskID)) {
      try {
        if (await cleanupGoalWorkspaceForGoal(goal.id)) cleaned += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`${goal.id}: ${message}`)
      }
    }
    if (errors.length > 0) {
      const message = `${reason}: failed to clean ${errors.length} goal worktree(s): ${errors.join("; ")}`
      log.error("goal workspace terminal cleanup failed", { taskID, reason, errors })
      throw new Error(message)
    }
    return cleaned
  }

  async function failCurrentTask(input: {
    error: string
    cleanupReason: string
    a2aRequestID?: string
  }): Promise<{ cleaned: number; recoveredTerminalFailure: boolean }> {
    const task = requireTask(taskID)
    const recoveredTerminalFailure =
      input.a2aRequestID !== undefined &&
      deriveTaskStatus(task) === "failed" &&
      input.error.startsWith(`A2A request ${input.a2aRequestID}:`) &&
      task.error === input.error
    if (!recoveredTerminalFailure) {
      await terminalTask(
        task,
        { status: "failed", error: input.error, time_completed: Date.now() },
        `Failed: ${input.error}`,
      )
    }
    const cleaned = await cleanupTerminalGoalWorkspaces(input.cleanupReason)
    const { interruptTaskLoop } = await import("@/orchestrator/loop")
    interruptTaskLoop(taskID, "task failed")
    return { cleaned, recoveredTerminalFailure }
  }

  function goalDependencyDispatchState(goalID: string): string {
    const status = goalStatusByID(goalID)
    const rows = listGoalRunsByGoal(goalID)
    const supersededIDs = new Set(rows.flatMap((row) => (row.supersede_of ? [row.supersede_of] : [])))
    const tip = rows.find((row) => !supersededIDs.has(row.id))
    if (tip?.superseded_reason) return `needs_redispatch(${tip.superseded_reason}; status=${status})`
    return status
  }

  async function publishGateArtifactResult(input: {
    acceptanceID: string
    runID: string
    summary: string
    source: "artifact_export"
  }) {
    const detail =
      `Publish gate blocked acceptance ${input.acceptanceID}: ${input.summary}. ` +
      `This is an artifact/export failure, not a acceptance verdict. Task lifecycle is unchanged; ` +
      `integrity is the workflow completion authority.`
    const { createDecisionLog } = await import("@/decision-log")
    createDecisionLog(taskID).append({
      phase: "acceptance",
      key: `publish_gate_rework_${Date.now()}`,
      value: detail,
      reason: input.source,
    })
    return SubAgentProtocol.yieldResult({
      headline: `Publish gate blocked acceptance artifact export. Task lifecycle is unchanged.`,
      fields: [
        ["acceptance_id", input.acceptanceID],
        ["run_id", input.runID],
        ["publish_gate", input.summary],
        [
          "next",
          "inspect declared changed files vs exported workspace; artifact export needs a separate non-gate tool",
        ],
      ],
      pointer: `acceptance ${input.acceptanceID}; publish gate failure is post-acceptance export feedback`,
    })
  }

  function activeGoalChoices(limit = 16) {
    const activePlan = findActivePlanForTask(taskID)
    if (!activePlan) return ""
    const goals = listGoalsForPlan(activePlan)
    return goals
      .slice(0, limit)
      .map((goal, index) => `G${index + 1}=${goal.id} (${goal.title})`)
      .join("; ")
  }

  function parseGoalOrdinal(reference: string): number | undefined {
    const match = reference.trim().match(/^(?:#|g)?(\d+)$/i)
    if (!match) return undefined
    const value = Number.parseInt(match[1]!, 10)
    return Number.isSafeInteger(value) && value > 0 ? value : undefined
  }

  function resolveGoalReferenceForBuild(
    reference: string,
  ): { ok: true; goalID: string } | { ok: false; message: string } {
    const raw = reference.trim()
    if (!raw) {
      return {
        ok: false,
        message: "build: empty goalID. Use a durable engine_goal.id or an active-plan ordinal such as G12.",
      }
    }

    const exact = findGoal(raw)
    if (exact) {
      if (exact.task_id !== taskID) {
        return {
          ok: false,
          message:
            `build: goal reference "${raw}" belongs to another task. ` +
            `Re-read this task's collaboration_closure and use one of: ${activeGoalChoices() || "(no active goals)"}.`,
        }
      }
      return { ok: true, goalID: exact.id }
    }

    const ordinal = parseGoalOrdinal(raw)
    if (ordinal !== undefined) {
      const activePlan = findActivePlanForTask(taskID)
      if (!activePlan) {
        return {
          ok: false,
          message:
            `build: ordinal goal reference "${raw}" requires an active plan. ` +
            `Use a durable engine_goal.id from collaboration_closure instead.`,
        }
      }
      const goals = listGoalsForPlan(activePlan)
      const goal = goals[ordinal - 1]
      if (!goal) {
        return {
          ok: false,
          message:
            `build: ordinal goal reference "${raw}" is outside the active plan range ` +
            `(1-${goals.length}). Use one of: ${activeGoalChoices() || "(no active goals)"}.`,
        }
      }
      return { ok: true, goalID: goal.id }
    }

    return {
      ok: false,
      message:
        `build: goal reference "${raw}" did not match a durable engine_goal.id or active-plan ordinal. ` +
        `Re-read collaboration_closure and use one of: ${activeGoalChoices() || "(no active goals)"}.`,
    }
  }

  function missingResolvedGoalMessage(goalID: string) {
    return (
      `build: resolved goal ${goalID} no longer exists in this task's active goal graph. ` +
      `Re-read collaboration_closure and dispatch a current goal id; do not re-run architect unless the goal contract itself is wrong.`
    )
  }

  async function switchExplicitBuildTaskToDirectWorkflow(attachedGoalID?: string): Promise<void> {
    if (attachedGoalID) return
    if (!input.workflowState) return
    if (input.workflow?.id !== "pipeline") return

    const task = requireTask(taskID)
    if (task.kind !== "build") return
    if (findActivePlanForTask(task.id) || findActiveRunForTask(task.id)) return
    if (listGoals(taskID).length > 0) return

    const direct = WorkflowRegistry.resolveSync("direct")
    if (!direct) return

    const nextState = createWorkflowState(direct)
    input.workflow = direct
    input.workflowState = nextState

    // Phase-6-f-3-bis-b: workflow selection is no longer persisted on
    // engine_task. Explicit kind=build tasks resolve to the direct workflow
    // on each wake, so this in-memory switch only keeps the current prompt
    // and overlay event aligned when a custom default started as pipeline.
    void task
    EngineProtocol.emit(EngineEvent.WorkflowSelected, {
      taskID,
      workflowID: direct.id,
      workflowName: direct.name,
      summary: `Workflow "${direct.name}" selected`,
    })
  }

  // ── Workflow step tracking — event-emit only (rule 23) ──
  //
  // History: trackStepStart/Complete used to mutate ws.taskSteps[].status
  // and walk ws.currentStepID forward — a coded FSM. Step status is now
  // projected from artifacts (workflow.ts::projectTaskSteps reads decision
  // log / spec snapshot / goals / runs / deliveries), so the cells were
  // pure duplication. Both functions are now thin event emitters: overlay
  // still gets live `running` / `completed` / `failed` transitions via
  // WorkflowStepUpdated, but no parallel state is maintained server-side.

  async function trackStepStart(toolName: string, goalID?: string): Promise<void> {
    if (!input.workflow) return
    const step = findStepByTool(input.workflow, toolName)
    if (!step) return
    try {
      EngineProtocol.emit(EngineEvent.WorkflowStepUpdated, {
        taskID,
        stepID: step.id,
        goalID,
        status: "running",
        summary: `Step "${step.label}" started`,
      })
    } catch {
      /* best effort */
    }
  }

  async function trackStepComplete(toolName: string, goalID?: string, failed = false): Promise<void> {
    if (!input.workflow) return
    const step = findStepByTool(input.workflow, toolName)
    if (!step) return
    const status = failed ? ("failed" as const) : ("completed" as const)
    try {
      EngineProtocol.emit(EngineEvent.WorkflowStepUpdated, {
        taskID,
        stepID: step.id,
        goalID,
        status,
        summary: `Step "${step.label}" ${status}`,
      })
    } catch {
      /* best effort */
    }
  }

  async function trackStepProgress(toolName: string, summary: string, goalID?: string): Promise<void> {
    if (!input.workflow) return
    const step = findStepByTool(input.workflow, toolName)
    if (!step) return
    try {
      await EngineProtocol.emit(EngineEvent.WorkflowStepUpdated, {
        taskID,
        stepID: step.id,
        goalID,
        status: "running",
        summary,
      })
    } catch (err) {
      log.warn("workflow step progress emit failed", {
        taskID,
        toolName,
        summary,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async function createExecutionRunRecord() {
    const task = requireTask(taskID)
    const dbGoals = listGoals(taskID)
    if (dbGoals.length === 0) return { error: "No goals found. Run requirements first." } as const
    const activeSpec = findActiveSpecForTask(taskID)
    if (!activeSpec) {
      return { error: "No active spec snapshot found. Run architect before creating an execution run." } as const
    }

    const now = Date.now()
    const executor = task.executor
    const sessionID = task.session_id!
    const planID = Identifier.ascending("plan")
    const { EnginePlanVersionTable, EnginePlanNodeTable, EngineGoalTable } = await import("@/engine/engine.sql")

    Database.transaction((db) => {
      // Single-active-plan invariant: retire every prior active plan for this
      // task before inserting the new one. Without this, a second
      // createExecutionRunRecord call would leave two rows with
      // status='active' / version=1; findActivePlanForTask's
      // `ORDER BY version DESC LIMIT 1` then returns whichever rowid wins the
      // tie (typically the older row, whose goals were re-pointed to the new
      // plan), and the board loads zero goals.
      supersedePriorActivePlansForTask(db, { taskID, now })
      db.insert(EnginePlanVersionTable)
        .values({
          id: planID,
          task_id: taskID,
          spec_snapshot_id: activeSpec.id,
          version: 1,
          status: "active",
          summary: `${dbGoals.length} goals`,
          prompt: task.request,
          metadata: {},
          time_created: now,
          time_updated: now,
        })
        .run()

      const goalToPlanNode = new Map<string, string>()
      const planNodeIDs: string[] = []
      for (const goal of dbGoals) {
        const pnID = Identifier.ascending("plan_node")
        planNodeIDs.push(pnID)
        goalToPlanNode.set(goal.id, pnID)
      }

      for (const [index, goal] of dbGoals.entries()) {
        const resolvedDeps = (goal.depends_on ?? []).flatMap((depGoalID: string) => {
          const pnID = goalToPlanNode.get(depGoalID)
          if (!pnID) {
            log.warn("create_run: goal.depends_on references unknown goal ID — dropping", {
              goalID: goal.id,
              goalTitle: goal.title,
              unknownDep: depGoalID,
            })
          }
          return pnID ? [pnID] : []
        })

        db.insert(EnginePlanNodeTable)
          .values({
            id: planNodeIDs[index],
            task_id: taskID,
            plan_version_id: planID,
            kind: "goal",
            goal_id: goal.id,
            title: goal.title,
            brief: renderSpecsAsText((goal.acceptance_specs ?? []) as AcceptanceSpec[]),
            depends_on_ids: resolvedDeps.length > 0 ? resolvedDeps : undefined,
            order_index: index,
            metadata: {},
            time_created: now,
            time_updated: now,
          })
          .run()
      }

      for (const goal of dbGoals) {
        db.update(EngineGoalTable)
          .set({ plan_version_id: planID, time_updated: now })
          .where(eq(EngineGoalTable.id, goal.id))
          .run()
      }
    })

    const { createRun } = await import("@/engine/writer")
    const created = createRun({
      taskID,
      planVersionID: planID,
      sessionID,
      executor,
      status: "queued",
      phase: "dispatch",
      summary: `create_run: ${dbGoals.length} goals queued`,
      now,
    })
    const runID = created.id

    await updateTask(
      requireTask(taskID),
      {
        status: "active",
      },
      `create_run: planID=${planID} runID=${runID}`,
    )

    return { runID, planID, goalsCount: dbGoals.length } as const
  }

  async function ensureDispatchableRunForSingleGoal() {
    let task = requireTask(taskID)
    let createdRun = false
    let activatedRun = false

    if (!findActiveRunForTask(task.id)) {
      const created = await createExecutionRunRecord()
      if ("error" in created) return { error: created.error } as const
      createdRun = true
      task = requireTask(taskID)
    }

    let run = findActiveRunForTask(task.id)
    if (!run || !run.plan_version_id || !isLiveRunStatus(run.status)) {
      const created = await createExecutionRunRecord()
      if ("error" in created) return { error: created.error } as const
      createdRun = true
      task = requireTask(taskID)
      run = requireRun(created.runID)
    }

    const planVersionID = run.plan_version_id
    if (!planVersionID) {
      return { error: `Run ${run.id} has no plan_version_id. Create a fresh run before dispatching goals.` } as const
    }

    let plan = findPlan(planVersionID)
    if (!plan) {
      return { error: `No plan found for run ${run.id}. Create a fresh run before dispatching goals.` } as const
    }

    if (run.status === "queued") {
      await updateTask(task, { status: "active", error: null }, "Execution submitted")
      await updateRun(run, { status: "running" }, "Execution submitted")
      activatedRun = true
      task = requireTask(taskID)
      run = requireRun(run.id)
      plan = findPlan(planVersionID) ?? plan
    }

    return { task, run, plan, createdRun, activatedRun } as const
  }

  async function ensureTaskLevelBuildRun(): Promise<{ readonly run: RunRow } | { readonly error: string }> {
    const task = requireTask(taskID)
    const existing = findActiveRunForTask(task.id)
    if (existing && isLiveRunStatus(existing.status)) return { run: existing } as const

    const { createRun } = await import("@/engine/writer")
    const now = Date.now()
    const created = createRun({
      taskID,
      planVersionID: null,
      sessionID: task.session_id ?? null,
      executor: task.executor,
      status: "running",
      phase: "execute",
      summary: "direct build run created",
      now,
    })
    await updateTask(
      requireTask(taskID),
      {
        status: "active",
        error: null,
      },
      `direct_build_run: runID=${created.id}`,
    )
    return { run: created } as const
  }

  /** ensureGoalInWorkflow was the workflow_state.goalSteps pre-allocator. The
   *  shadow table is gone — goal step status is derived from engine_goal_run
   *  at read time. This remains as a no-op for callers still referencing it;
   *  those call sites will be removed as the architecture settles. */
  function ensureGoalInWorkflow(_goalID: string, _goalTitle: string): void {
    // intentional no-op: see workflow.ts::projectGoalSteps
  }

  // Architecture review findings are actionable feedback: the review itself does not rewrite requirements or goals, and the orchestrator chooses the next repair lane from durable decision-log context.
  function renderIntegrityOutcome(outcome: IntegrityReviewOutcome) {
    if (outcome.status === "blocked") {
      return SubAgentProtocol.yieldResult({
        headline: outcome.headline,
        pointer: outcome.pointer,
      })
    }
    if (outcome.status === "continuation") {
      return outcome.result
    }
    if (outcome.status === "reviewed") {
      const headline = outcome.artifactMissing
        ? `Integrity session completed but status=artifact_missing — durable integrity_attempt persistence failed. ` +
          `Do not treat an older artifact as the current verdict until recovery or explicit user confirmation.`
        : outcome.verdict === "pass" && outcome.phase === "post_build"
          ? `Integrity verdict: pass — ${outcome.perDimension.join(", ")}. ` +
            `Pass evidence persisted; call complete_task with integrity_attempt_id=${outcome.integrityAttemptID ?? "(missing)"} to complete the task.`
          : outcome.verdict === "pass"
            ? `Integrity verdict: pass — ${outcome.perDimension.join(", ")}. ` +
              `Pre-build integrity passed, but task is not complete until post-build pass evidence exists and complete_task records the terminal decision.`
            : `Integrity verdict: ${outcome.verdict} — ${outcome.perDimension.join(", ")}. ` +
              `Task is not accepted. Nothing in code supersedes goals, opens new attempts, or mutates the graph based on this verdict. ` +
              `Read the full markdown below and choose modify_goal / build({goalID}) / architect / fail_task explicitly.`
      return SubAgentProtocol.yieldResult({
        headline,
        fields: [
          ["goal_count", String(outcome.goalCount)],
          ["spec_snapshot_id", outcome.specSnapshotID],
          ["phase", outcome.phase],
          ["reviewer_count", String(outcome.reviewerCount)],
          ["findings_count", String(outcome.findingsCount)],
          ["required_repairs_count", String(outcome.requiredRepairsCount)],
          ["unresolved_disagreements_count", String(outcome.unresolvedDisagreementsCount)],
          ...(outcome.artifactMissing
            ? ([["artifact_persistence_status", `artifact_missing: ${outcome.artifactMissing.error}`]] as Array<
                [string, string]
              >)
            : []),
          ...(outcome.integrityAttemptID
            ? ([["integrity_attempt_id", outcome.integrityAttemptID]] as Array<[string, string]>)
            : []),
          ["summary", outcome.summary],
          // Full review text — every issue, every correction proposal,
          // every missing-goal proposal, with goal_ids preserved.
          ["team_report_markdown", outcome.markdown],
        ],
        pointer: `integrity session ${outcome.sessionID}`,
      })
    }
    throw new Error(`Unknown integrity outcome: ${(outcome as { status?: string }).status ?? "unknown"}`)
  }

  async function runIntegrityReview(
    toolExecution: OrchestratorToolExecutionContext,
    toolInput: IntegrityToolInput,
  ): Promise<IntegrityReviewOutcome> {
    const task = requireTask(taskID)
    const activeSpec = findActiveSpecForTask(task.id)
    if (!activeSpec) {
      return {
        status: "blocked",
        headline: "integrity: no active spec snapshot — call `architect` first.",
        pointer: `task ${taskID}`,
      }
    }
    const dbGoals = listGoals(taskID).filter((g) => g.spec_snapshot_id === activeSpec.id)
    if (dbGoals.length === 0) {
      return {
        status: "blocked",
        headline: "integrity: no goals on the active spec snapshot — call `architect` first.",
        pointer: `spec ${activeSpec.id}`,
      }
    }

    const singleflightKey = `${task.id}:${activeSpec.id}:${
      toolInput.continuation_artifact_id ? `continuation:${toolInput.continuation_artifact_id}` : "fresh"
    }`
    const inflight = integrityReviewSingleflight.get(singleflightKey)
    if (inflight) return inflight

    const reviewPromise = runIntegrityReviewOnce({ task, activeSpec, dbGoals, toolExecution, toolInput })
    integrityReviewSingleflight.set(singleflightKey, reviewPromise)
    try {
      return await reviewPromise
    } finally {
      if (integrityReviewSingleflight.get(singleflightKey) === reviewPromise) {
        integrityReviewSingleflight.delete(singleflightKey)
      }
    }
  }

  async function runIntegrityReviewOnce(ctx: {
    task: TaskRow
    activeSpec: NonNullable<ReturnType<typeof findActiveSpecForTask>>
    dbGoals: ReturnType<typeof listGoals>
    toolExecution: OrchestratorToolExecutionContext
    toolInput: IntegrityToolInput
  }): Promise<IntegrityReviewOutcome> {
    const { task, activeSpec, dbGoals, toolExecution, toolInput } = ctx

    const { findDeliveriesForTask, findRequirements, listGoalRunsForTask } = await import("@/engine/store")
    const reqRows = findRequirements(activeSpec.id)
    const requirements = reqRows.map(parsedRequirementFromRow)
    const decisionLog = createDecisionLog(taskID)
    const requirementDecisions = decisionLog.readByPhase("requirements").map((d) => ({
      key: d.key,
      value: d.value,
      reason: d.reason,
    }))

    const goalsForReview = dbGoals.map((g) => ({
      id: g.id,
      title: g.title,
      objective: g.objective,
      acceptance_specs: (typeof g.acceptance_specs === "string"
        ? JSON.parse(g.acceptance_specs)
        : (g.acceptance_specs ?? [])) as AcceptanceSpec[],
      owned_paths: typeof g.owned_paths === "string" ? JSON.parse(g.owned_paths) : (g.owned_paths ?? []),
      depends_on: typeof g.depends_on === "string" ? JSON.parse(g.depends_on) : (g.depends_on ?? []),
      priority: g.priority as "blocking" | "advisory",
      kind: g.kind,
      requirement_ids:
        typeof g.requirement_ids === "string" ? JSON.parse(g.requirement_ids) : (g.requirement_ids ?? []),
    }))
    const deliveriesForAcceptance = findDeliveriesForTask(taskID)
    const acceptanceChangedFiles = Array.from(
      new Set(
        deliveriesForAcceptance.flatMap((acceptance) => {
          const result = acceptance.result as
            | { changed_files?: string[]; changedFiles?: string[]; diffs?: Array<{ file?: string }> }
            | null
            | undefined
          return [
            ...(Array.isArray(result?.changed_files) ? result.changed_files : []),
            ...(Array.isArray(result?.changedFiles) ? result.changedFiles : []),
            ...(Array.isArray(result?.diffs)
              ? result.diffs.map((diff) => diff.file).filter((file): file is string => typeof file === "string")
              : []),
          ]
        }),
      ),
    )
    const acceptanceDiffs = deliveriesForAcceptance.flatMap((acceptance) => {
      const result = acceptance.result as
        | {
            diffs?: Array<{
              file: string
              diff?: string
              before?: string
              after?: string
              additions?: number
              deletions?: number
              status?: string
            }>
          }
        | null
        | undefined
      return Array.isArray(result?.diffs) ? result.diffs : []
    })
    const acceptanceSummary =
      deliveriesForAcceptance.length > 0
        ? deliveriesForAcceptance
            .map((acceptance) => acceptance.summary)
            .filter(Boolean)
            .join("\n")
        : "No acceptance artifact rows were found; review the requirement status snapshot and repository directly."

    const {
      reviewIntegrity,
      computeRequirementStatusSnapshot,
      buildIntegrityReplayContext,
      buildSpecSnapshotLineage,
      buildIntegrityRootHistory,
      persistentRootSummary,
    } = await import("@/integrity")
    // Project REQ status from DB BEFORE the review fires. The host does not
    // pre-compute completion verdicts (rule 6.1) — it only lays out raw
    // claiming-goal × tip-run × per-spec evidence; the LLM walks it inside
    // the prompt. An empty snapshot (pre-build, or no REQs at all) is the
    // signal that the prompt's Requirement Status Snapshot section should
    // not render — handled in buildIntegrityPrompt.
    const requirementStatus = computeRequirementStatusSnapshot({
      taskID,
      specSnapshotID: activeSpec.id,
    })
    // Phase classification: post_build iff at least one claiming goal has a
    // tip run whose status is TERMINAL (`completed | failed | aborted`). A
    // queued / running / blocked tip means the build is still in flight —
    // its evidence is incomplete and integrity has nothing real to judge
    // beyond the structural decomposition. Treating in-flight runs as
    // post_build would let the acceptance freshness gate accept attempts that
    // were taken mid-build, which is what codex review §6.4 #8 flagged.
    // Per @/engine/catalog GOAL_RUN_STATUS_CATALOG: completed = terminal,
    // failed/aborted = retriable, everything else = live.
    const TERMINAL_RUN_STATUSES = new Set<string>(["completed", "failed", "aborted"])
    const phase: "pre_build" | "post_build" = requirementStatus.some((r) =>
      r.claimingGoals.some((g) => TERMINAL_RUN_STATUSES.has(g.runStatus)),
    )
      ? "post_build"
      : "pre_build"
    const lineage = buildSpecSnapshotLineage({
      taskID,
      activeSpecSnapshotID: activeSpec.id,
    })
    const goalRunsForReview = listGoalRunsForTask(taskID)
    const buildOutcomesForReview = findBuildOutcomesForTask(taskID)
    const replayContext = buildIntegrityReplayContext({
      taskID,
      lineage,
      phase,
      goals: goalsForReview,
      requirements,
      buildRecords: deliveriesForAcceptance,
      goalRuns: goalRunsForReview,
      buildOutcomes: buildOutcomesForReview,
    })
    const frontendDesignEntries = decisionLog.readByPhase("frontend_design")
    const visualQaEntries = decisionLog.readByPhase("visual_qa")
    const frontendDesignContract = frontendDesignEntries
      .map((entry) => `## ${entry.key}\nreason: ${entry.reason}\n\n${entry.value}`)
      .join("\n\n")
    const visualQaContract = visualQaEntries
      .map((entry) => `## ${entry.key}\nreason: ${entry.reason}\n\n${entry.value}`)
      .join("\n\n")
    const projectDir = taskPrimaryProjectRoot(taskID, { activeProjectID: Instance.project.id })
    const visualEvidence = readLatestTaskVisualEvidenceBundleSync({ projectDir, taskID })
    const latestIntegrityAttempt = findLatestIntegrityAttemptArtifact({
      taskID,
      specSnapshotID: activeSpec.id,
      phase,
    })
    const referenceParity = deriveVisualQaReferenceParityContext({
      taskID,
      specSnapshotID: activeSpec.id,
      goals: listGoals(taskID),
      frontendDesignEntries,
      visualEvidence,
    })
    const normalizedStageInput = IntegrityStageInputSchema.parse({
      reason: toolInput.reason,
      active_spec_snapshot_id: activeSpec.id,
      phase,
      goal_ids: dbGoals.map((goal) => goal.id).sort(),
      evidence_snapshot: continuationEvidenceSnapshot({
        acceptance_deliveries: deliveriesForAcceptance,
        acceptance_changed_files: acceptanceChangedFiles,
        acceptance_diffs: acceptanceDiffs,
        frontend_design_decisions: frontendDesignEntries,
        goal_runs: goalRunsForReview,
        latest_integrity_attempt: latestIntegrityAttempt,
        latest_visual_evidence_bundle: visualEvidence,
        requirement_decisions: requirementDecisions,
        requirement_status: requirementStatus,
        requirements,
        replay_context: replayContext,
        visual_qa_decisions: visualQaEntries,
      }),
    })
    const unavailableContinuation = toolInput.continuation_artifact_id
      ? stageContinuationUnavailableResult({
          taskID: task.id,
          stage: "integrity",
          artifactID: toolInput.continuation_artifact_id,
          finalizerName: "submit_integrity_consensus",
        })
      : undefined
    if (unavailableContinuation) return { status: "continuation", result: unavailableContinuation }
    const continuationInput = toolInput.continuation_artifact_id
      ? integrityContinuationFromArtifact({ taskID: task.id, artifactID: toolInput.continuation_artifact_id })
      : undefined
    const continuation = continuationInput?.continuation
    if (continuationInput) {
      const expected = normalizedStageInput
      const actual = continuationInput.normalizedStageInput
      const sameGoalIDs =
        actual.goal_ids.length === expected.goal_ids.length &&
        actual.goal_ids.every((goalID, index) => goalID === expected.goal_ids[index])
      if (
        actual.active_spec_snapshot_id !== expected.active_spec_snapshot_id ||
        actual.phase !== expected.phase ||
        !sameGoalIDs ||
        stageInputDigest(actual.evidence_snapshot) !== stageInputDigest(expected.evidence_snapshot)
      ) {
        const continuationArtifactID = continuationInput.continuation.artifactID
        return {
          status: "continuation",
          result: SubAgentProtocol.yieldResult({
            headline: "integrity: continuation artifact scope is stale.",
            summary:
              `No fresh integrity session was started because continuation_artifact_id=${continuationArtifactID} was created for an older integrity review scope. ` +
              "Do not reuse this stale artifact; start a fresh integrity run without continuation_artifact_id if the review is still required.",
            fields: [
              ["stage", "integrity"],
              ["session_id", continuationInput.continuation.sessionID],
              ["continuation_artifact_id", continuationArtifactID],
              ["state", "scope_mismatch"],
              ["stored_active_spec_snapshot_id", actual.active_spec_snapshot_id],
              ["current_active_spec_snapshot_id", expected.active_spec_snapshot_id],
              ["stored_phase", actual.phase],
              ["current_phase", expected.phase],
              ["stored_goal_ids", actual.goal_ids],
              ["current_goal_ids", expected.goal_ids],
              ["stored_evidence_digest", stageInputDigest(actual.evidence_snapshot)],
              ["current_evidence_digest", stageInputDigest(expected.evidence_snapshot)],
              ["next_action", "start a fresh integrity run without continuation_artifact_id"],
            ],
            pointer: "read_context scope=decisions; start fresh integrity",
          }),
        }
      }
    }

    let activeOwnership: OrchestratorToolOwnershipPayload | undefined
    let ownershipClosed = false
    const openIntegrityOwnership = (sessionID: string) => {
      if (activeOwnership) return
      const ownershipPayload = createOrchestratorToolOwnershipPayload({
        taskID,
        orchestratorSessionID: toolExecution.orchestratorSessionID,
        orchestratorMessageID: toolExecution.orchestratorMessageID,
        toolCallID: toolExecution.toolCallID,
        toolPartID: toolExecution.toolPartID,
        childSessionID: sessionID,
        toolName: "integrity",
        scope: "task",
      })
      insertOrchestratorToolOwnershipArtifact({
        taskID,
        runID: findActiveRunForTask(taskID)?.id ?? null,
        goalRunID: null,
        label: "tool-ownership-start",
        payload: ownershipPayload,
      })
      activeOwnership = ownershipPayload
    }
    const closeIntegrityOwnership = (outcome: "completed" | "failed" | "cancelled", error?: string) => {
      if (!activeOwnership || ownershipClosed) return
      ownershipClosed = true
      completeOrchestratorToolOwnership({
        taskID,
        ownershipID: activeOwnership.ownership_id,
        outcome,
        error,
      })
    }

    let verdict: Awaited<ReturnType<typeof reviewIntegrity>>
    let runnerSessionID = continuation?.sessionID
    try {
      if (runnerSessionID) openIntegrityOwnership(runnerSessionID)
      verdict = await reviewIntegrity({
        userRequest: task.request,
        taskTitle: task.title,
        goals: goalsForReview,
        requirements,
        requirementDecisions,
        requirementStatus,
        attachments: Array.isArray(task.attachments) ? (task.attachments as any) : undefined,
        acceptance: {
          summary: acceptanceSummary,
          changedFiles: acceptanceChangedFiles,
          diffs: acceptanceDiffs,
        },
        frontendDesign: frontendDesignContract,
        visualQa: visualQaContract,
        visualEvidence,
        visualEvidenceRequired: phase === "post_build" && referenceParity.required,
        projectRoot: projectDir,
        replayContext,
        signal: input.signal,
        taskID,
        task,
        parentSessionID: input.agentSessionID,
        continuation,
        onSessionCreated: (sessionID) => {
          runnerSessionID = sessionID
          openIntegrityOwnership(sessionID)
        },
      })
      closeIntegrityOwnership("completed")
    } catch (err) {
      closeIntegrityOwnership("failed", err instanceof Error ? err.message : String(err))
      const continuationResult = continuationResultForProtocolFinalizerMiss({
        err,
        taskID: task.id,
        stage: "integrity",
        sessionID: runnerSessionID,
        parentSessionID: input.agentSessionID,
        finalizerName: "submit_integrity_consensus",
        normalizedStageInput,
        pointerReason: toolInput.reason ?? null,
      })
      if (continuationResult) {
        return { status: "continuation", result: continuationResult }
      }
      throw err
    }

    const { recordIntegrityAttempt } = await import("@/engine/persist")

    const markdown = renderIntegrityMarkdown({ verdict, sessionID: verdict.sessionID })
    let artifactMissing: { sessionID: string; error: string } | undefined
    let integrityAttemptID: string | undefined
    let persistentRootsValue = "persistent_roots=[]"
    let artifactPersisted = false
    try {
      integrityAttemptID = recordIntegrityAttempt({
        taskID,
        sessionID: verdict.sessionID,
        lineage,
        verdict: verdict.verdict,
        phase,
        reviewers: verdict.reviewers,
        findingsCount: verdict.findings.length,
        requiredRepairsCount: verdict.requiredRepairs.length,
        unresolvedDisagreementsCount: verdict.unresolvedDisagreements.length,
        reason: verdict.summary,
        teamReportMarkdown: markdown,
        findings: verdict.findings,
        rounds: verdict.rounds,
        requiredRepairs: verdict.requiredRepairs,
        unresolvedDisagreements: verdict.unresolvedDisagreements,
      })
      artifactPersisted = true
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      artifactMissing = {
        sessionID: verdict.sessionID,
        error,
      }
      SessionStatus.markArtifactMissing(verdict.sessionID, error)
      await persistIntegrityArtifactMissingStatus({
        taskID,
        sessionID: verdict.sessionID,
        parentSessionID: input.agentSessionID,
        error,
      })
      log.error("integrity: recordIntegrityAttempt failed", {
        taskID,
        error,
      })
    }
    if (artifactPersisted) {
      try {
        persistentRootsValue = persistentRootSummary(
          buildIntegrityRootHistory({ taskID, specSnapshotLineage: lineage }),
        )
      } catch (err) {
        log.warn("integrity: persistent root summary failed (non-fatal)", {
          taskID,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    // Append a compact decision_log row so the orchestrator's read_context
    // automatically surfaces the accumulated review history (latest 20
    // entries, ≤ 600 chars per value). The full review_markdown stays in
    // engine_artifact for one-shot fidelity; this row is the cumulative
    // signal the orchestrator LLM needs to spot recurring issues across
    // multiple post-build reviews — same issues reappearing means the
    // current goal graph cannot absorb them and architect re-run / fail_task
    // becomes the cheaper repair (per orchestrator-core.txt's repair ladder).
    if (!artifactMissing) {
      try {
        const topIssues = verdict.findings
          .slice(0, 5)
          .map((i) => `[${i.severity}] ${i.title}: ${i.description}`)
          .join("; ")
        const issueTail =
          verdict.findings.length > 5 ? ` (+${verdict.findings.length - 5} more in engine_artifact)` : ""
        const value =
          `verdict=${verdict.verdict} | reviewers=${verdict.reviewers.length} | findings=${verdict.findings.length} | required_repairs=${verdict.requiredRepairs.length} | unresolved=${verdict.unresolvedDisagreements.length}` +
          ` | ${persistentRootsValue}` +
          (verdict.summary ? ` | summary=${verdict.summary}` : "") +
          (topIssues ? ` | top: ${topIssues}${issueTail}` : "")
        decisionLog.append({
          phase: "review",
          key: `review_${verdict.verdict}_${verdict.sessionID}`,
          value,
          reason: "post-build architecture_review",
        })
      } catch (err) {
        log.warn("integrity: decision_log review append failed (non-fatal)", {
          taskID,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    return {
      status: "reviewed",
      specSnapshotID: activeSpec.id,
      phase,
      verdict: verdict.verdict,
      summary: verdict.summary,
      sessionID: verdict.sessionID,
      goalCount: goalsForReview.length,
      perDimension: [`reviewers=${verdict.reviewers.length}`, `findings=${verdict.findings.length}`],
      reviewerCount: verdict.reviewers.length,
      findingsCount: verdict.findings.length,
      requiredRepairsCount: verdict.requiredRepairs.length,
      unresolvedDisagreementsCount: verdict.unresolvedDisagreements.length,
      markdown,
      findings: verdict.findings,
      requiredRepairs: verdict.requiredRepairs,
      unresolvedDisagreements: verdict.unresolvedDisagreements,
      integrityAttemptID,
      artifactMissing,
    }
  }

  async function persistIntegrityArtifactMissingStatus(input: {
    taskID: string
    sessionID: string
    parentSessionID: string
    error: string
  }) {
    try {
      const { ProtocolStore } = await import("@/protocol/store")
      const sessionRow = Database.use((db) =>
        db
          .select({ timeCreated: SessionTable.time_created })
          .from(SessionTable)
          .where(eq(SessionTable.id, input.sessionID))
          .get(),
      )
      if (!sessionRow) throw new Error(`integrity session ${input.sessionID} missing persisted row`)
      const orderKey = timelineOrderKey({
        domain: "session",
        time: sessionRow.timeCreated,
        id: input.sessionID,
      })
      await ProtocolStore.appendEvent({
        kind: "event",
        type: "session.status",
        aggregate: "task",
        aggregate_id: input.taskID,
        task_id: input.taskID,
        run_id: null,
        goal_run_id: null,
        session_id: input.sessionID,
        interaction_id: null,
        stream_id: null,
        source: "integrity.artifact_missing",
        target: null,
        correlation_id: null,
        causation_id: null,
        reply_to: null,
        emitted_at: Date.now(),
        order_key: orderKey,
        payload: {
          orderKey,
          sessionID: input.sessionID,
          status: {
            type: "terminal",
            reason: "artifact_missing",
            error: input.error,
          },
          channel: "integrity",
          resolvedRole: "integrity",
          parentSessionID: input.parentSessionID,
        },
      })
    } catch (err) {
      log.warn("integrity: artifact_missing status persist failed", {
        taskID: input.taskID,
        sessionID: input.sessionID,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // (removed) postBuildReviewReworkGoalIDs / dependentGoalClosure /
  // openArchitectureReviewRework / architecture_review_rework — these were the auto-supersede +
  // auto-startNewAttempt + dependent-cascade chain that violated
  // CLAUDE.md rule 13 (no state-machine flow control). The orchestrator LLM
  // now reads the full review markdown returned in the build tool result
  // and chooses modify_goal / build({goalID}) / architect / fail_task /
  // integrity itself.

  // Agents that need to ask the user a question do so directly via
  // `Question.ask`. Workflow steps never pause for input here.

  const decisionControlTools = new Set([
    "question",
    "propose_task",
    "complete_task",
    "inject_operator_message",
    "respond_agent_coordination",
    "cancel_subagent",
  ])

  function taskDecisionSignature() {
    return Database.use((db) => {
      const aggregate = (table: { task_id: unknown; time_updated: unknown }) =>
        db
          .select({
            count: sql<number>`count(*)`,
            updated: sql<number | null>`max(${table.time_updated})`,
          })
          .from(table as never)
          .where(eq(table.task_id as never, taskID))
          .get()
      const task = db
        .select({
          time_updated: EngineTaskTable.time_updated,
          time_completed: EngineTaskTable.time_completed,
          error: EngineTaskTable.error,
        })
        .from(EngineTaskTable)
        .where(eq(EngineTaskTable.id, taskID))
        .get()
      return JSON.stringify({
        task,
        artifacts: aggregate(EngineArtifactTable),
        goals: aggregate(EngineGoalTable),
        interactions: aggregate(EngineInteractionRequestTable),
        milestones: aggregate(EngineMilestoneTable),
        planNodes: aggregate(EnginePlanNodeTable),
        planVersions: aggregate(EnginePlanVersionTable),
        requirements: aggregate(EngineRequirementTable),
        specItems: aggregate(EngineSpecItemTable),
        specSnapshots: aggregate(EngineSpecSnapshotTable),
        cronJobs: aggregate(CronJobTable),
      })
    })
  }

  function normalizeOrchestratorToolResult(result: unknown): { output: string; title: string; metadata: object } {
    if (typeof result === "string") return { output: result, title: "", metadata: {} }
    if (result && typeof result === "object") {
      const record = result as Record<string, unknown>
      const output =
        typeof record.output === "string"
          ? record.output
          : typeof record.text === "string"
            ? record.text
            : JSON.stringify(record.output ?? record)
      return {
        ...record,
        output,
        title: typeof record.title === "string" ? record.title : "",
        metadata: record.metadata && typeof record.metadata === "object" ? record.metadata : {},
      } as { output: string; title: string; metadata: object }
    }
    return { output: String(result ?? ""), title: "", metadata: {} }
  }

  function decisionEffectForTool(name: string, before: string, after: string): OrchestratorDecisionEffect {
    if (isOrchestratorNoDecisionObservationToolName(name)) return "observation"
    if (before !== after) return "decision"
    if (decisionControlTools.has(name)) return "decision"
    return "none"
  }

  function terminalTaskToolRefusal(name: string, task: TaskRow) {
    const status = deriveTaskStatus(task)
    return {
      output:
        `Task ${task.id} is terminal (status=${status}); ${name} was not executed. ` +
        "Task-level scheduler tools may act only while the task is active. Start a new task for follow-up work instead of continuing this terminal task.",
      title: "Task is terminal",
      metadata: {
        [ORCHESTRATOR_DECISION_EFFECT_METADATA_KEY]: "observation" satisfies OrchestratorDecisionEffect,
      },
    }
  }

  function isTerminalAgentCoordinationFailTaskReplay(name: string, args: unknown, task: TaskRow): boolean {
    if (name !== "respond_agent_coordination") return false
    if (deriveTaskStatus(task) !== "failed") return false
    if (!args || typeof args !== "object" || Array.isArray(args)) return false
    const record = args as Record<string, unknown>
    if (record.decision !== "fail_task") return false
    if (typeof record.request_id !== "string" || record.request_id.length === 0) return false
    if (typeof record.reason !== "string" || record.reason.length === 0) return false
    const guidance = typeof record.message === "string" ? record.message.trim() : undefined
    const expectedError = `A2A request ${record.request_id}: ${
      guidance && guidance.length > 0 ? guidance : record.reason
    }`
    if (task.error !== expectedError) return false
    const request = findAgentCoordinationRequest({ taskID, requestID: record.request_id })
    if (!request || request.payload.status !== "responded" || !request.payload.response_id) return false
    const response = findAgentCoordinationResponse({ taskID, responseID: request.payload.response_id })
    if (!response) return false
    if (response.payload.decision !== "fail_task") return false
    if (response.payload.reason !== record.reason) return false
    if ((response.payload.message ?? undefined) !== (guidance && guidance.length > 0 ? guidance : undefined)) {
      return false
    }
    const action = findAgentCoordinationAction({ taskID, actionID: response.payload.action_id })
    if (!action) return false
    if (action.payload.request_id !== record.request_id) return false
    if (action.payload.action !== "fail_task") return false
    return action.payload.status === "pending" || action.payload.status === "completed"
  }

  function withDecisionEffectMetadata(name: string, raw: unknown): unknown {
    const toolDef = raw as { execute?: (args: unknown, options: unknown) => Promise<unknown> }
    if (typeof toolDef.execute !== "function") return raw
    const execute = toolDef.execute
    return {
      ...(raw as object),
      execute: async (args: unknown, options: unknown) => {
        const currentTask = requireTask(taskID)
        if (isTaskTerminal(currentTask) && !isTerminalAgentCoordinationFailTaskReplay(name, args, currentTask)) {
          return terminalTaskToolRefusal(name, currentTask)
        }
        const before = taskDecisionSignature()
        const result = await execute(args, options)
        const after = taskDecisionSignature()
        const normalized = normalizeOrchestratorToolResult(result)
        const effect = decisionEffectForTool(name, before, after)
        return {
          ...normalized,
          metadata: {
            ...normalized.metadata,
            [ORCHESTRATOR_DECISION_EFFECT_METADATA_KEY]: effect,
          },
        }
      },
    }
  }

  async function dispatchArchitectStage(dispatch: {
    task: TaskRow
    reason?: string
    continuationArtifactID?: string
  }): Promise<{
    result: ReturnType<typeof SubAgentProtocol.yieldResult>
    status: "persisted" | "continuation" | "missing_requirements"
    sessionID?: string
    specSnapshotID?: string
    contractGraphArtifactID?: string
    goalsCount?: number
    contractsCount?: number
  }> {
    const task = dispatch.task
    const activeSpec = findActiveSpecForTask(task.id)
    if (!activeSpec) {
      return {
        status: "missing_requirements",
        result: SubAgentProtocol.yieldResult({
          headline: "architect: no active requirements spec snapshot — call `requirements` first.",
          summary:
            "Architect decomposition requires the durable REQ-N requirements snapshot. " +
            "No architect session was started because the prior spec has been cleared or has not been created.",
          fields: [["next_action", "requirements"]],
          pointer: "read_context scope=decisions",
        }),
      }
    }
    const existingGoals = listGoals(taskID)
    const decisionLog = createDecisionLog(taskID)
    const reqRows = findRequirements(activeSpec.id)
    const requirements = reqRows.map(parsedRequirementFromRow)
    const requirementDecisions = decisionLog.readByPhase("requirements").map((d) => ({
      key: d.key,
      value: d.value,
      reason: d.reason,
    }))
    const frontendDesign = renderFrontendDesignHandoffReference(taskID)
    const workloadArtifact = findLatestGoalWorkloadArtifact(taskID)
    const decisionLogPrompt = decisionLog.toPromptSection()

    await trackStepStart("architect")

    let runnerSessionID: string | undefined
    const normalizedStageInput = {
      task: taskContinuationScope(task),
      active_spec: specContinuationScope(activeSpec),
      existing_goals: goalsContinuationScope(existingGoals),
      evidence_snapshot: architectPromptEvidenceSnapshot({
        taskID,
        task,
        requirements,
        requirementDecisions,
        frontendDesign,
        workloadBriefs: workloadArtifact?.briefs,
        decisionLogPrompt,
      }),
    }
    let continuation: AgentSessionContinuation | undefined
    try {
      if (dispatch.continuationArtifactID) {
        const resolvedContinuation = continuationFromArtifactOrResult({
          taskID,
          stage: "architect",
          artifactID: dispatch.continuationArtifactID,
          finalizerName: "submit_architect",
          expectedNormalizedStageInput: normalizedStageInput,
        })
        if ("result" in resolvedContinuation) {
          await trackStepComplete("architect")
          return { result: resolvedContinuation.result, status: "continuation" }
        }
        continuation = resolvedContinuation.continuation
      }
      runnerSessionID = continuation?.sessionID

      const { ArchitectAgent } = await import("@/architect/agent")
      const { copyRequirementsToSpecSnapshot, persistArchitectContractGraph, upsertGoalsFromArchitect } = await import(
        "@/engine/persist"
      )
      const {
        assertArchitectContractGraphMatchesExecutableGoals,
        remapArchitectContractGraphGoalIDs,
        renderContractGraphForPrompt,
      } = await import("@/architect/contract-graph")
      const { EngineSpecSnapshotTable } = await import("@/engine/engine.sql")

      const result = await ArchitectAgent.coordinate({
        goals: existingGoals.map((g) => ({
          id: g.id,
          title: g.title,
          objective: g.objective,
          acceptance_specs: (typeof g.acceptance_specs === "string"
            ? JSON.parse(g.acceptance_specs)
            : (g.acceptance_specs ?? [])) as AcceptanceSpec[],
          owned_paths: typeof g.owned_paths === "string" ? JSON.parse(g.owned_paths) : (g.owned_paths ?? []),
          depends_on: typeof g.depends_on === "string" ? JSON.parse(g.depends_on) : (g.depends_on ?? []),
          priority: g.priority as "blocking" | "advisory",
          kind: g.kind,
          requirement_ids:
            typeof g.requirement_ids === "string" ? JSON.parse(g.requirement_ids) : (g.requirement_ids ?? []),
          order_index: g.order_index,
          retry_count: getGoalRetryCount(g.id),
        })),
        taskRequest: task.request,
        taskTitle: task.title,
        taskID,
        decisionLog,
        requirements,
        requirementDecisions,
        designSpecs: Array.isArray(task.design_specs) ? (task.design_specs as any) : undefined,
        frontendDesign: frontendDesign.trim().length > 0 ? frontendDesign : undefined,
        workloadBriefs: workloadArtifact?.briefs,
        attachments: Array.isArray(task.attachments) ? (task.attachments as any) : undefined,
        signal: input.signal,
        parentSessionID: input.agentSessionID,
        continuation,
        onStatus: () => {},
        onSessionCreated: (id) => {
          runnerSessionID = id
        },
      })

      const newSpecSnapshotID = Identifier.ascending("spec")
      const priorSpecSnapshotID = findActiveSpecForTask(task.id)?.id
      const reqLines = requirements.map(
        (r) =>
          `- **${r.id}** [${r.type}]: ${r.description} Acceptance: ${r.acceptance} Non-goals: ${r.non_goals} Evidence: ${r.evidence_refs.join(", ") || "(none)"}`,
      )
      const decisionLines = requirementDecisions.map((d) => `- **${d.key}** = ${d.value} — ${d.reason}`)
      let persisted: Array<{
        id: string
        title: string
        llmID: string
        depends_on: string[]
        acceptance_specs: AcceptanceSpec[]
      }> = []
      let llmToDBID = new Map<string, string>()
      let deletedIDs: string[] = []
      let contractGraphArtifactID: string | undefined
      try {
        Database.transaction((db) => {
          const now = Date.now()
          db.insert(EngineSpecSnapshotTable)
            .values({
              id: newSpecSnapshotID,
              task_id: taskID,
              version: 2,
              status: "ready",
              summary: result.summary,
              content: `${task.title}\n\n${result.summary}\n\n${result.decompositionAnalysis}`,
              scope: requirements.map((r) => r.description).join("; "),
              time_created: now,
              time_updated: now,
            })
            .run()

          if (priorSpecSnapshotID) {
            copyRequirementsToSpecSnapshot(db, {
              taskID,
              fromSpecSnapshotID: priorSpecSnapshotID,
              toSpecSnapshotID: newSpecSnapshotID,
              now,
            })

            db.update(EngineSpecSnapshotTable)
              .set({ status: "superseded", time_updated: now })
              .where(eq(EngineSpecSnapshotTable.id, priorSpecSnapshotID))
              .run()
          }

          const out = upsertGoalsFromArchitect(db, {
            taskID,
            specSnapshotID: newSpecSnapshotID,
            architectGoals: result.goals.map((g) => ({
              llmID: g.id,
              title: g.title,
              objective: g.objective,
              acceptance_specs: g.acceptance_specs,
              owned_paths: g.owned_paths,
              depends_on: g.depends_on,
              kind: g.kind,
              requirement_ids: g.requirement_ids,
              priority: g.priority,
              source: g.requirement_ids.length > 0 ? ("spec" as const) : ("system" as const),
            })),
            removedLLMIDs: result.removedGoalIDs,
            now,
          })
          persisted = out.persisted
          llmToDBID = out.llmToDBID
          deletedIDs = out.deletedIDs

          const mappedContractGraph = remapArchitectContractGraphGoalIDs(
            result.contractGraph,
            (goalID) =>
              llmToDBID.get(goalID) ?? (existingGoals.some((goal) => goal.id === goalID) ? goalID : undefined),
          )
          assertArchitectContractGraphMatchesExecutableGoals({
            graph: mappedContractGraph,
            goals: out.persisted.map((goal) => ({
              id: goal.id,
              depends_on: goal.depends_on,
              acceptance_specs: goal.acceptance_specs,
            })),
          })
          contractGraphArtifactID = persistArchitectContractGraph(db, {
            taskID,
            graph: mappedContractGraph,
            now,
          })

          const mappedArchitectFidelity = {
            sourceCoverage: result.fidelity.sourceCoverage.map((row) => ({
              ...row,
              goal_ids: row.goal_ids.map((goalID) => llmToDBID.get(goalID) ?? goalID),
            })),
            referenceCoverage: result.fidelity.referenceCoverage.map((row) => ({
              ...row,
              goal_ids: row.goal_ids.map((goalID) => llmToDBID.get(goalID) ?? goalID),
            })),
            assemblyOwners: result.fidelity.assemblyOwners.map((row) => ({
              ...row,
              goal_id: llmToDBID.get(row.goal_id) ?? row.goal_id,
            })),
          }

          const mappedGoalLines = result.goals.map((g) => {
            const goalID = llmToDBID.get(g.id) ?? g.id
            return `- **${goalID}** (${g.kind}, ${g.priority}): ${g.title}`
          })
          const mappedTraceLines = result.traceability.map(
            (t) => `- ${t.requirementID} → ${t.goalIDs.map((goalID) => llmToDBID.get(goalID) ?? goalID).join(", ")}`,
          )
          const mappedSourceCoverageLines = mappedArchitectFidelity.sourceCoverage.map(
            (row) =>
              `- **${row.id}** [${row.action}] paths=${row.paths.join(", ")} goals=${row.goal_ids.join(", ")} — ${row.rationale}`,
          )
          const mappedReferenceCoverageLines = mappedArchitectFidelity.referenceCoverage.map((row) => {
            const specIDs = row.visual_spec_ids.length > 0 ? ` visual_specs=${row.visual_spec_ids.join(", ")}` : ""
            return `- **${row.id}** surface=${row.surface} goals=${row.goal_ids.join(", ")}${specIDs} — ${row.expectation}`
          })
          const mappedAssemblyOwnerLines = mappedArchitectFidelity.assemblyOwners.map(
            (row) => `- surface=${row.surface} owner=${row.goal_id} — ${row.rationale}`,
          )
          const mappedContractLines = renderContractGraphForPrompt(mappedContractGraph).split("\n")
          const mappedSpecContent = [
            `# ${task.title}`,
            "",
            result.summary,
            "",
            "## Decomposition Analysis",
            result.decompositionAnalysis,
            "",
            "## Requirements",
            ...(reqLines.length > 0 ? reqLines : ["_(none — Requirements produced an empty REQ-N list)_"]),
            "",
            "## Decisions",
            ...(decisionLines.length > 0 ? decisionLines : ["_(none)_"]),
            "",
            "## Goals",
            ...(mappedGoalLines.length > 0 ? mappedGoalLines : ["_(none)_"]),
            "",
            "## Traceability",
            ...(mappedTraceLines.length > 0 ? mappedTraceLines : ["_(none)_"]),
            "",
            "## Source Coverage",
            ...(mappedSourceCoverageLines.length > 0 ? mappedSourceCoverageLines : ["_(none)_"]),
            "",
            "## Reference Coverage",
            ...(mappedReferenceCoverageLines.length > 0 ? mappedReferenceCoverageLines : ["_(none)_"]),
            "",
            "## Assembly Ownership",
            ...(mappedAssemblyOwnerLines.length > 0 ? mappedAssemblyOwnerLines : ["_(none)_"]),
            "",
            "## Architect Contracts",
            ...(mappedContractLines.length > 0 ? mappedContractLines : ["_(none)_"]),
          ].join("\n")
          db.update(EngineSpecSnapshotTable)
            .set({ content: mappedSpecContent, time_updated: now })
            .where(eq(EngineSpecSnapshotTable.id, newSpecSnapshotID))
            .run()
          const taskMetadata =
            task.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)
              ? (task.metadata as Record<string, unknown>)
              : {}

          db.update(EngineTaskTable)
            .set({
              metadata: {
                ...taskMetadata,
                architect_fidelity: mappedArchitectFidelity,
              },
              time_updated: now,
            })
            .where(eq(EngineTaskTable.id, taskID))
            .run()

          Database.effect(() =>
            EngineProtocol.emit(
              EngineEvent.TaskUpdated,
              { taskID, status: deriveTaskStatus(task), summary: "Goals decomposed by Architect" },
              { source: "orchestrator.architect" },
            ),
          )
        })
      } catch (dbErr) {
        log.error("architect: failed to persist goals to DB", {
          taskID,
          error: dbErr instanceof Error ? dbErr.message : String(dbErr),
          stack: dbErr instanceof Error ? dbErr.stack : undefined,
        })
        throw dbErr
      }

      for (const g of persisted) ensureGoalInWorkflow(g.id, g.title)

      await trackStepComplete("architect")

      return {
        status: "persisted",
        sessionID: (result as { sessionID?: string }).sessionID ?? runnerSessionID,
        specSnapshotID: newSpecSnapshotID,
        contractGraphArtifactID,
        goalsCount: persisted.length,
        contractsCount: result.contractGraph.contracts.length,
        result: SubAgentProtocol.yieldResult({
          headline:
            `Architect decomposition complete: ${persisted.length} goals, ${result.contractGraph.contracts.length} contracts.` +
            (deletedIDs.length > 0 ? ` Removed ${deletedIDs.length} prior goal(s).` : "") +
            ` Eligible per-goal builds are now visible; read each build report and worktree facts, then decide modify_goal / build / architect / integrity / fail_task explicitly from current evidence.`,
          summary: result.summary,
          fields: [
            ["goals", persisted.map((g) => `${g.id} ${g.title}`)],
            [
              "contract_graph",
              `${result.contractGraph.contracts.length} contracts / ${result.contractGraph.dependency_contracts.length} dependency reasons`,
            ],
            ["spec_snapshot_id", newSpecSnapshotID],
          ],
          pointer: `read_context scope=decisions (spec ${newSpecSnapshotID})`,
        }),
      }
    } catch (err) {
      try {
        await trackStepComplete("architect", undefined, true)
      } catch (trackErr) {
        log.warn("architect: trackStepComplete(failed) emit failed", {
          taskID,
          error: trackErr instanceof Error ? trackErr.message : String(trackErr),
        })
      }
      const { createDecisionLog } = await import("@/decision-log")
      const failureReason = err instanceof Error ? err.message : String(err)
      const continuationResult = continuationResultForProtocolFinalizerMiss({
        err,
        taskID,
        stage: "architect",
        sessionID: runnerSessionID,
        parentSessionID: input.agentSessionID,
        finalizerName: "submit_architect",
        normalizedStageInput,
        pointerReason: failureReason,
      })
      if (continuationResult) return { result: continuationResult, status: "continuation", sessionID: runnerSessionID }
      createDecisionLog(taskID).append({
        phase: "architect",
        key: "abort_architect_failed",
        value: `Architect stage aborted: ${failureReason.slice(0, 400)}`,
        reason: "architect_threw",
      })
      throw err
    }
  }

  async function dispatchRequirementsStage(dispatch: {
    task: TaskRow
    reason?: string
    continuationArtifactID?: string
  }): Promise<{
    result: ReturnType<typeof SubAgentProtocol.yieldResult>
    status: "persisted" | "continuation" | "clarification"
    sessionID?: string
    specSnapshotID?: string
    requirementsCount?: number
    decisionsCount?: number
  }> {
    let task = dispatch.task
    log.info("requirements guard check", { taskID, hasSpec: !!findActiveSpecForTask(task.id) })
    await trackStepStart("requirements")
    task = await updateTask(task, { status: "active" }, "Requirements analysis started")
    let runnerSessionID: string | undefined
    const decisionLog = createDecisionLog(taskID)
    const maturityScopePendingBeforeID = decisionLog.readByKey("maturity_scope_pending")?.id
    const frontendDesign = renderFrontendDesignHandoffReference(taskID)
    const normalizedStageInput = {
      task: taskContinuationScope(task),
      evidence_snapshot: requirementsPromptEvidenceSnapshot(taskID, task, frontendDesign),
    }
    let continuation: AgentSessionContinuation | undefined
    try {
      if (dispatch.continuationArtifactID) {
        const resolvedContinuation = continuationFromArtifactOrResult({
          taskID,
          stage: "requirements",
          artifactID: dispatch.continuationArtifactID,
          finalizerName: "submit_requirements",
          expectedNormalizedStageInput: normalizedStageInput,
        })
        if ("result" in resolvedContinuation) {
          await trackStepComplete("requirements")
          return { result: resolvedContinuation.result, status: "continuation" }
        }
        continuation = resolvedContinuation.continuation
      }
      runnerSessionID = continuation?.sessionID
      const { RequirementsAgent } = await import("@/requirements")
      const result = await RequirementsAgent.run({
        title: task.title,
        request: task.request,
        attachments: Array.isArray(task.attachments) ? (task.attachments as any) : undefined,
        designSpecs: Array.isArray(task.design_specs) ? (task.design_specs as any) : undefined,
        frontendDesign: frontendDesign.trim().length > 0 ? frontendDesign : undefined,
        taskID,
        parentSessionID: input.agentSessionID,
        signal: input.signal,
        decisionLog,
        continuation,
        onStatus: () => {},
        onSessionCreated: (id) => {
          runnerSessionID = id
        },
      })
      if (result.requirements.length === 0) {
        throw new Error("requirements agent produced no REQ-N entries")
      }

      const { insertRequirements } = await import("@/engine/persist")
      const { EngineSpecSnapshotTable } = await import("@/engine/engine.sql")
      const now = Date.now()
      const specSnapshotID = Identifier.ascending("spec")
      const specContent = [
        `# ${task.title}`,
        "",
        result.summary,
        "",
        "## Requirements",
        ...result.requirements.map(
          (r) =>
            `- **${r.id}** [${r.type}]: ${r.description} Acceptance: ${r.acceptance} Non-goals: ${r.non_goals} Evidence: ${r.evidence_refs.join(", ") || "(none)"}`,
        ),
        "",
        "## Decisions",
        ...result.decisions.map((d) => `- **${d.key}** = ${d.value} — ${d.reason}`),
      ].join("\n")

      try {
        Database.transaction((db) => {
          db.update(EngineSpecSnapshotTable)
            .set({ status: "superseded", time_updated: now })
            .where(
              and(eq(EngineSpecSnapshotTable.task_id, taskID), sql`${EngineSpecSnapshotTable.status} != 'superseded'`),
            )
            .run()
          db.insert(EngineSpecSnapshotTable)
            .values({
              id: specSnapshotID,
              task_id: taskID,
              version: 1,
              status: "ready",
              summary: result.summary,
              content: specContent,
              scope: result.requirements.map((r) => r.description).join("; "),
              time_created: now,
              time_updated: now,
            })
            .run()

          if (result.requirements.length > 0) {
            insertRequirements(db, {
              taskID,
              specSnapshotID,
              requirements: result.requirements.map((r) => ({
                id: r.id,
                title: r.description,
                description: r.description,
                acceptance: [r.acceptance],
                evidence_refs: r.evidence_refs,
                non_goals: [r.non_goals],
                priority: r.type === "explicit" ? ("blocking" as const) : ("advisory" as const),
              })),
              now,
            })
          }

          db.update(EngineTaskTable)
            .set({
              time_updated: now,
            })
            .where(eq(EngineTaskTable.id, taskID))
            .run()
          Database.effect(() =>
            EngineProtocol.emit(
              EngineEvent.TaskUpdated,
              { taskID, status: deriveTaskStatus(task), summary: "Requirements parsed" },
              { source: "orchestrator.requirements" },
            ),
          )
        })
      } catch (dbErr) {
        log.error("requirements: failed to persist to DB", {
          taskID,
          error: dbErr instanceof Error ? dbErr.message : String(dbErr),
          stack: dbErr instanceof Error ? dbErr.stack : undefined,
        })
        throw dbErr
      }
      await trackStepComplete("requirements")

      return {
        status: "persisted",
        sessionID: result.sessionID,
        specSnapshotID,
        requirementsCount: result.requirements.length,
        decisionsCount: result.decisions.length,
        result: SubAgentProtocol.yieldResult({
          headline: `SUCCESS: ${result.requirements.length} requirements, ${result.decisions.length} decisions parsed. Architect decomposition is now available if the full task context still needs a goal graph.`,
          summary: result.summary,
          fields: [
            ["decisions", result.decisions.map((d) => `${d.key}=${d.value}`)],
            ["requirements", String(result.requirements.length)],
          ],
          pointer: `read_context scope=decisions (spec ${specSnapshotID})`,
        }),
      }
    } catch (err) {
      const maturityScopeDecision = decisionLog.readByKey("maturity_scope_pending")
      if (maturityScopeDecision && maturityScopeDecision.id !== maturityScopePendingBeforeID) {
        const { output } = await Question.askAndFormat({
          sessionID: input.agentSessionID,
          questions: [
            {
              header: "Maturity scope",
              question: [
                "The Requirements agent found an ambiguous maturity / quality word and stopped before finalizing requirements.",
                `Recorded assumption: ${maturityScopeDecision.value}`,
                `Reason: ${maturityScopeDecision.reason}`,
                "Please define the maturity boundary so the requirements can be finalized without leaving later integrity review open-ended.",
              ].join("\n\n"),
              options: [
                {
                  label: "Use assumption",
                  description: "Proceed with the recorded bounded interpretation.",
                },
                {
                  label: "Narrow scope",
                  description: "Limit maturity expectations to the explicitly requested behavior.",
                },
              ],
              multiple: false,
              custom: true,
            },
          ],
        })
        return {
          status: "clarification",
          sessionID: runnerSessionID,
          result: SubAgentProtocol.yieldResult({
            headline: "requirements: maturity scope clarification requested.",
            summary: output,
            fields: [
              ["decision", "maturity_scope_pending"],
              ["recorded_assumption", maturityScopeDecision.value],
              ["reason", maturityScopeDecision.reason],
            ],
            pointer: "question lane; answered clarification will be included in the next requirements prompt",
          }),
        }
      }
      try {
        await trackStepComplete("requirements", undefined, true)
      } catch (trackErr) {
        log.warn("requirements: trackStepComplete(failed) emit failed", {
          taskID,
          error: trackErr instanceof Error ? trackErr.message : String(trackErr),
        })
      }
      const continuationResult = continuationResultForProtocolFinalizerMiss({
        err,
        taskID,
        stage: "requirements",
        sessionID: runnerSessionID,
        parentSessionID: input.agentSessionID,
        finalizerName: "submit_requirements",
        normalizedStageInput,
        pointerReason: dispatch.reason ?? null,
      })
      if (continuationResult) {
        return { result: continuationResult, status: "continuation", sessionID: runnerSessionID }
      }
      const { createDecisionLog } = await import("@/decision-log")
      const failureReason = err instanceof Error ? err.message : String(err)
      createDecisionLog(taskID).append({
        phase: "requirements",
        key: "abort_requirements_failed",
        value: `Requirements stage aborted: ${failureReason.slice(0, 400)}`,
        reason: "requirements_threw",
      })
      throw err
    }
  }

  async function dispatchFrontendResearchStage(dispatch: {
    task: TaskRow
    reason: string
    sourceUrls?: string[]
    focus?: string
    continuationArtifactID?: string
  }): Promise<{
    result: ReturnType<typeof SubAgentProtocol.yieldResult>
    status: "persisted" | "continuation" | "failed"
    sessionID?: string
    artifactID?: string
  }> {
    await trackStepStart("frontend_research")
    const continuationRow = dispatch.continuationArtifactID
      ? findStageContinuationRequest({ taskID, artifactID: dispatch.continuationArtifactID })
      : undefined
    const storedContinuationSourceUrl = frontendResearchSourceUrlFromStageInput(
      continuationRow?.payload.normalized_stage_input,
    )
    const storedContinuationFocus = frontendResearchFocusFromStageInput(continuationRow?.payload.normalized_stage_input)
    const sourceUrl = dispatch.continuationArtifactID
      ? storedContinuationSourceUrl
      : dispatch.sourceUrls?.find(isHttpWebpageUrl)
    const normalizedStageInput = {
      task: taskContinuationScope(dispatch.task),
      source_url: sourceUrl ?? null,
      focus: dispatch.continuationArtifactID ? (storedContinuationFocus ?? null) : dispatch.focus?.trim() || null,
    }
    let continuation: AgentSessionContinuation | undefined
    let runnerSessionID: string | undefined
    try {
      if (dispatch.continuationArtifactID) {
        const resolvedContinuation = continuationFromArtifactOrResult({
          taskID,
          stage: "frontend-research",
          artifactID: dispatch.continuationArtifactID,
          finalizerName: "submit_research_brief",
          expectedNormalizedStageInput: normalizedStageInput,
        })
        if ("result" in resolvedContinuation) {
          await trackStepComplete("frontend_research")
          return { result: resolvedContinuation.result, status: "continuation" }
        }
        continuation = resolvedContinuation.continuation
      }
      runnerSessionID = continuation?.sessionID
      const { FrontendResearchAgent } = await import("@/frontend-research")
      const result = await FrontendResearchAgent.run({
        title: dispatch.task.title,
        request: dispatch.task.request,
        targetDeliverable: "implementation_input",
        sourceUrls: sourceUrl ? [sourceUrl] : undefined,
        focus: continuation ? undefined : dispatch.focus,
        reason: dispatch.reason,
        taskID,
        parentSessionID: input.agentSessionID,
        signal: input.signal,
        continuation,
        onStatus: () => {},
        onSessionCreated: (id) => {
          runnerSessionID = id
        },
      })
      const artifactID = persistTaskFrontendResearchBrief({
        taskID,
        brief: result.brief,
      })
      await trackStepComplete("frontend_research")
      const blocking = result.brief.open_questions.filter((item) => item.blocking)
      const subpageTasks = result.brief.subpage_research_tasks
      const contract = result.brief.webpage_contract
      return {
        status: "persisted",
        sessionID: result.sessionID,
        artifactID,
        result: SubAgentProtocol.yieldResult({
          headline: "Frontend research brief persisted as webpage investigation division.",
          summary: result.brief.summary,
          fields: [
            ["session", result.sessionID],
            ["artifact_id", artifactID],
            ["sources", String(result.brief.evidence_index.length)],
            ["facts", String(result.brief.facts.length)],
            ["webpage_contract", contract ? contract.source_url : "missing"],
            ["functional_surfaces", String(contract?.functional_surfaces.length ?? 0)],
            ["visual_layout", String(contract?.visual_layout.length ?? 0)],
            ["style_requirements", String(contract?.style_requirements.length ?? 0)],
            ["subpage_research_tasks", subpageTasks.map((item) => `${item.id}: ${item.url} | ${item.suggested_focus}`)],
            ["blocking_open_questions", blocking.map((item) => `${item.id}: ${item.question}`)],
            ["bundle_paths", Object.values(result.brief.bundle)],
          ],
          pointer:
            `frontend_research_brief artifact ${artifactID}; downstream agents read it as webpage investigation work packets. ` +
            "This result is evidence only; choose the next tool from full task context.",
        }),
      }
    } catch (err) {
      try {
        await trackStepComplete("frontend_research", undefined, true)
      } catch (trackErr) {
        log.warn("frontend_research: trackStepComplete(failed) emit failed", {
          taskID,
          error: trackErr instanceof Error ? trackErr.message : String(trackErr),
        })
      }
      const msg = err instanceof Error ? err.message : String(err)
      const continuationResult = continuationResultForProtocolFinalizerMiss({
        err,
        taskID,
        stage: "frontend-research",
        sessionID: runnerSessionID,
        parentSessionID: input.agentSessionID,
        finalizerName: "submit_research_brief",
        normalizedStageInput,
        pointerReason: dispatch.reason,
      })
      if (continuationResult) return { result: continuationResult, status: "continuation", sessionID: runnerSessionID }
      if (runnerSessionID) {
        SessionStatus.set(runnerSessionID, { type: "terminal", reason: "error", error: msg })
      }
      log.error("frontend_research tool failed", { taskID, error: msg })
      return {
        status: "failed",
        sessionID: runnerSessionID,
        result: SubAgentProtocol.yieldResult({
          headline: "Frontend research failed before producing an artifact.",
          summary: msg,
          fields: [
            ["session", runnerSessionID ?? "not-created"],
            ["status", "failed"],
            ["source_urls", dispatch.sourceUrls ?? []],
            ["focus", dispatch.focus?.trim() ? dispatch.focus : "none"],
            ["artifact_id", "none"],
          ],
          pointer: runnerSessionID
            ? `frontend-research session ${runnerSessionID}; inspect session error status for details`
            : "frontend_research failed before child session creation; inspect orchestrator logs and workflow step failure",
        }),
      }
    }
  }

  async function dispatchDeepResearchStage(dispatch: {
    task: TaskRow
    reason: string
    targetDeliverable?: "prd" | "spec" | "research_report" | "implementation_input" | "mixed"
    sourceUrls?: string[]
    focus?: string
    continuationArtifactID?: string
  }): Promise<{
    result: ReturnType<typeof SubAgentProtocol.yieldResult>
    status: "persisted" | "continuation"
    sessionID?: string
    artifactID?: string
  }> {
    let runnerSessionID: string | undefined
    const normalizedStageInput = {
      task: taskContinuationScope(dispatch.task),
    }
    try {
      let continuation: AgentSessionContinuation | undefined
      if (dispatch.continuationArtifactID) {
        const resolvedContinuation = continuationFromArtifactOrResult({
          taskID,
          stage: "deep-research",
          artifactID: dispatch.continuationArtifactID,
          finalizerName: "submit_research_brief",
          expectedNormalizedStageInput: normalizedStageInput,
        })
        if ("result" in resolvedContinuation) return { result: resolvedContinuation.result, status: "continuation" }
        continuation = resolvedContinuation.continuation
      }
      runnerSessionID = continuation?.sessionID
      const { DeepResearchAgent } = await import("@/research")
      const result = await DeepResearchAgent.run({
        title: dispatch.task.title,
        request: dispatch.task.request,
        targetDeliverable: dispatch.targetDeliverable,
        sourceUrls: continuation ? undefined : dispatch.sourceUrls,
        focus: dispatch.focus,
        reason: dispatch.reason,
        taskID,
        parentSessionID: input.agentSessionID,
        signal: input.signal,
        continuation,
        onStatus: () => {},
        onSessionCreated: (id) => {
          runnerSessionID = id
        },
      })
      const artifactID = persistTaskResearchBrief({
        taskID,
        brief: result.brief,
      })
      const blocking = result.brief.open_questions.filter((item) => item.blocking)
      const subpageTasks = result.brief.subpage_research_tasks
      return {
        status: "persisted",
        sessionID: result.sessionID,
        artifactID,
        result: SubAgentProtocol.yieldResult({
          headline: "Deep research brief persisted as advisory evidence.",
          summary: result.brief.summary,
          fields: [
            ["session", result.sessionID],
            ["artifact_id", artifactID],
            ["sources", String(result.brief.evidence_index.length)],
            ["facts", String(result.brief.facts.length)],
            ["subpage_research_tasks", subpageTasks.map((item) => `${item.id}: ${item.url} | ${item.suggested_focus}`)],
            ["blocking_open_questions", blocking.map((item) => `${item.id}: ${item.question}`)],
            ["bundle_paths", Object.values(result.brief.bundle)],
          ],
          pointer:
            `research_brief artifact ${artifactID}; task snapshot surfaces stale status and bundle paths. ` +
            "This result is evidence only; choose the next tool from full task context.",
        }),
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const continuationResult = continuationResultForProtocolFinalizerMiss({
        err,
        taskID,
        stage: "deep-research",
        sessionID: runnerSessionID,
        parentSessionID: input.agentSessionID,
        finalizerName: "submit_research_brief",
        normalizedStageInput,
        pointerReason: dispatch.reason,
      })
      if (continuationResult) return { result: continuationResult, status: "continuation", sessionID: runnerSessionID }
      if (runnerSessionID) {
        SessionStatus.set(runnerSessionID, { type: "terminal", reason: "error", error: msg })
      }
      log.error("deep_research tool failed", { taskID, error: msg })
      throw err
    }
  }

  async function dispatchVisualQaStage(dispatch: {
    task: TaskRow
    reason: string
    focus?: string
    appUrl?: string
    previewCommand?: string
    continuationArtifactID?: string
  }): Promise<{
    result: ReturnType<typeof SubAgentProtocol.yieldResult>
    status: "reviewed" | "continuation"
    sessionID?: string
    accepted?: boolean
    submittedAccepted?: boolean
    findingsCount?: number
    productionBlockersCount?: number
    evidenceCount?: number
    repairsCount?: number
    changedFilesCount?: number
  }> {
    const task = dispatch.task
    await trackStepStart("visual_qa")
    let closed = false
    let runnerSessionID: string | undefined
    const close = async (failed = false) => {
      if (closed) return
      closed = true
      await trackStepComplete("visual_qa", undefined, failed)
    }

    const decisionLog = createDecisionLog(taskID)
    const frontendDesignEntries = decisionLog.readByPhase("frontend_design")
    const frontendResearchBriefs = findNonStaleFrontendResearchBriefs({
      taskID,
      request: task.request,
    })
    const buildDeliveries = findDeliveriesForTask(taskID)
    const priorVisualQaEntries = decisionLog.readByPhase("visual_qa")
    const frontendDesign = renderVisualQaFrontendDesignContext(frontendDesignEntries)
    const frontendResearch = renderVisualQaFrontendResearchContext(frontendResearchBriefs)
    const buildEvidence = renderVisualQaBuildEvidenceContext(buildDeliveries)
    const priorVisualQa = renderVisualQaPriorReportContext(priorVisualQaEntries)
    const activeSpec = findActiveSpecForTask(taskID)
    const activeGoals = listGoals(taskID)
    const projectRoot = taskPrimaryProjectRoot(taskID, { activeProjectID: Instance.project.id })
    const visualEvidence = readLatestTaskVisualEvidenceBundleSync({ projectDir: projectRoot, taskID })
    const latestIntegrityAttempt = activeSpec
      ? findLatestIntegrityAttemptArtifact({
          taskID,
          specSnapshotID: activeSpec.id,
          phase: "post_build",
        })
      : undefined
    const integrityContext = renderVisualQaIntegrityContext(latestIntegrityAttempt)
    const referenceParity = deriveVisualQaReferenceParityContext({
      taskID,
      specSnapshotID: activeSpec?.id,
      goals: activeGoals,
      frontendDesignEntries,
      visualEvidence,
    })
    const normalizedStageInput = {
      task: taskContinuationScope(task),
      active_spec: specContinuationScope(activeSpec),
      goals: goalsContinuationScope(activeGoals),
      evidence_snapshot: continuationEvidenceSnapshot({
        frontend_design_decisions: frontendDesignEntries,
        frontend_research_briefs: frontendResearchBriefs,
        build_deliveries: buildDeliveries,
        prior_visual_qa_decisions: priorVisualQaEntries,
        latest_visual_evidence_bundle: visualEvidence,
        latest_integrity_attempt: latestIntegrityAttempt,
      }),
    }

    try {
      let continuation: AgentSessionContinuation | undefined
      if (dispatch.continuationArtifactID) {
        const resolvedContinuation = continuationFromArtifactOrResult({
          taskID,
          stage: "visual-qa",
          artifactID: dispatch.continuationArtifactID,
          finalizerName: "submit_visual_qa_report",
          expectedNormalizedStageInput: normalizedStageInput,
        })
        if ("result" in resolvedContinuation) {
          await close(false)
          return { result: resolvedContinuation.result, status: "continuation", sessionID: runnerSessionID }
        }
        continuation = resolvedContinuation.continuation
      }
      runnerSessionID = continuation?.sessionID
      const { VisualQaAgent } = await import("@/visual-qa")
      const result = await VisualQaAgent.analyze({
        taskTitle: task.title,
        taskRequest: task.request,
        reason: dispatch.reason,
        focus: dispatch.focus,
        appUrl: dispatch.appUrl,
        previewCommand: dispatch.previewCommand,
        frontendDesign,
        frontendResearch,
        integrityContext,
        buildEvidence,
        priorVisualQa,
        projectRoot,
        referenceParityRequired: referenceParity.required,
        requiredReferenceRegions: referenceParity.regions,
        taskID,
        parentSessionID: input.agentSessionID,
        signal: input.signal,
        continuation,
        onSessionCreated: (id) => {
          runnerSessionID = id
        },
      })
      const visualQaSemantics = visualQaReportAcceptanceSemantics(result.report)

      decisionLog.append({
        phase: "visual_qa",
        key: `report_${Date.now()}`,
        value: JSON.stringify(result.report, null, 2),
        reason: `Dedicated frontend GUI and functional QA report from session ${result.sessionID}`,
      })
      decisionLog.append({
        phase: "visual_qa",
        key: "latest_summary",
        value: [
          `accepted=${visualQaSemantics.effectiveAccepted}`,
          `submitted_accepted=${visualQaSemantics.submittedAccepted}`,
          `effective_accepted=${visualQaSemantics.effectiveAccepted}`,
          `self_report_issues=${visualQaSemantics.selfReportIssues.length}`,
          `summary=${result.report.summary}`,
          `coverage=${result.report.coverage.length}`,
          `findings=${result.report.findings.length}`,
          `production_blockers=${result.report.production_blockers.length}`,
          `unresolved_code_module_problems=${result.report.unresolved_code_module_problems.length}`,
          `evidence=${result.report.evidence.length}`,
          `reference_parity_required=${result.report.reference_parity.required}`,
          `reference_comparison_evidence=${result.report.reference_parity.reference_comparison_evidence_refs.join(", ") || "(none)"}`,
          `reference_missing_regions=${result.report.reference_parity.missing_regions.join(", ") || "(none)"}`,
          `changed_files=${result.report.changed_files.join(", ") || "(none)"}`,
        ].join("\n"),
        reason: "Latest structured visual QA summary for read_context and integrity review.",
      })

      await close()
      return {
        status: "reviewed",
        sessionID: result.sessionID,
        accepted: visualQaSemantics.effectiveAccepted,
        submittedAccepted: visualQaSemantics.submittedAccepted,
        findingsCount: result.report.findings.length,
        productionBlockersCount: result.report.production_blockers.length,
        evidenceCount: result.report.evidence.length,
        repairsCount: result.report.repairs.length,
        changedFilesCount: result.report.changed_files.length,
        result: SubAgentProtocol.yieldResult({
          headline: `visual_qa complete: effective_accepted=${visualQaSemantics.effectiveAccepted}`,
          summary: result.report.summary,
          fields: [
            ["session", result.sessionID],
            ["accepted", String(visualQaSemantics.effectiveAccepted)],
            ["submitted_accepted", String(visualQaSemantics.submittedAccepted)],
            ["self_report_issues", String(visualQaSemantics.selfReportIssues.length)],
            ["coverage", String(result.report.coverage.length)],
            ["findings", String(result.report.findings.length)],
            ["production_blockers", String(result.report.production_blockers.length)],
            ["unresolved_code_module_problems", String(result.report.unresolved_code_module_problems.length)],
            ["evidence", String(result.report.evidence.length)],
            ["repairs", String(result.report.repairs.length)],
            ["changed_files", result.report.changed_files.join(", ") || "(none)"],
            ["open_questions", String(result.report.open_questions.length)],
          ],
          pointer: "decision_log phase=visual_qa",
        }),
      }
    } catch (err) {
      await close(true)
      const msg = err instanceof Error ? err.message : String(err)
      const continuationResult = continuationResultForProtocolFinalizerMiss({
        err,
        taskID,
        stage: "visual-qa",
        sessionID: runnerSessionID,
        parentSessionID: input.agentSessionID,
        finalizerName: "submit_visual_qa_report",
        normalizedStageInput,
        pointerReason: dispatch.reason,
      })
      if (continuationResult) return { result: continuationResult, status: "continuation", sessionID: runnerSessionID }
      log.error("visual_qa: failed", { taskID, error: msg })
      decisionLog.append({
        phase: "visual_qa",
        key: "abort_visual_qa_failed",
        value: `Visual QA stage aborted: ${msg.slice(0, 400)}`,
        reason: "visual_qa_threw",
      })
      throw err instanceof Error ? err : new Error(msg)
    }
  }

  const tools = {
    select_expert_squad: tool({
      description:
        "Select the active expert squad prompt profile for this task's root session. " +
        "This writes only `prompt_profile.active` to the root session config overlay, so future Orchestrator wakes and dispatched agents compose prompts from that expert squad. " +
        "It does not dispatch work, reroute the workflow, change models, change tools, mutate per-agent prompt fields, or infer the profile from keywords.",
      inputSchema: z
        .object({
          profile_id: PromptProfileIDSchema.describe(
            "Exact prompt profile id from the backend prompt-profile catalog, for example `frontend-replica` or `frontend-automation-debug`.",
          ),
          reason: z
            .string()
            .min(1)
            .describe("Concrete evidence for why this task should use that expert squad from the next turn onward."),
        })
        .strict(),
      execute: async ({ profile_id, reason }) => {
        const task = requireTask(taskID)
        if (!task.session_id) {
          throw new Error(`Task ${taskID} has no root session; cannot select expert squad ${profile_id}.`)
        }
        const baseConfig = await EffectiveConfig.base({ sessionID: task.session_id })
        PromptProfile.assertKnownProfileID(profile_id, baseConfig)
        const before = (await EffectiveConfig.effective({ sessionID: task.session_id })).prompt_profile.active
        await Session.mergeConfigOverlay({
          sessionID: task.session_id,
          patch: { prompt_profile: { active: profile_id } },
        })
        return [
          `Expert squad selected for task ${taskID}.`,
          `- previous: ${before}`,
          `- active: ${profile_id}`,
          `- reason: ${reason}`,
          "This change affects future prompt composition through the root session overlay only.",
        ].join("\n")
      },
    }),
    skill: tool({
      description:
        "Scheduler-only search/load surface for mounted Orchestrator expert-squad skills. Use it to inspect request-matched squad guidance before calling select_expert_squad; never use it to load production, research, report, or implementation skills. The session loop replaces this placeholder with the canonical turn-scoped SkillTool before the model can call it.",
      inputSchema: z
        .object({
          query: z
            .string()
            .optional()
            .describe("Fuzzy search terms for mounted Orchestrator expert-squad skill titles and SKILL.md content."),
          name: z
            .string()
            .optional()
            .describe("Exact mounted Orchestrator expert-squad skill name to load after search identifies it."),
        })
        .strict(),
      execute: async (_input): Promise<string> => {
        throw new Error("Orchestrator skill tool was not rebound to the canonical SkillTool for this turn.")
      },
    }),
    requirements: tool({
      description:
        "OPTIONAL stage agent. Parse the user's task into REQ-N requirements plus " +
        "foundational technical decisions (runtime, framework, test strategy, " +
        "package_manager, communication_protocol). Goal decomposition, " +
        "acceptance_specs, traceability, source/reference coverage, and cross-goal " +
        "contracts are all produced by the Architect — do NOT expect them from " +
        "this step.\n\n" +
        "USE WHEN: the work is multi-file with implicit acceptance criteria, OR you " +
        "intend to call `architect` next (architect needs the REQ-N rows), OR " +
        "foundational decisions are ambiguous and the build agent would otherwise " +
        "guess.\n" +
        "SKIP WHEN: a previous `requirements` result already succeeded and the active " +
        "spec snapshot still matches the current user scope; call `architect` next. " +
        "Only rerun after an operator scope change or concrete evidence that the active REQ snapshot is invalid. " +
        "If the workflow contract is fundamentally wrong after execution has begun, create a separate inheriting workflow task with `propose_task` instead of rerunning earlier stages in place.\n" +
        "SKIP WHEN: trivial direct edit (single-file bug fix, typo / config tweak); " +
        "build agent can run against the user's text alone and integrity has enough " +
        "signal in the request and build evidence to verify. Frontend evidence tools are available candidates when the full task context " +
        "needs visual/reference material for requirements analysis.",
      inputSchema: z
        .object({
          reason: z.string().optional().describe("Why you decided to analyze requirements"),
          continuation_artifact_id: StageContinuationArtifactIDField,
        })
        .strict(),
      execute: async ({ reason, continuation_artifact_id }) => {
        const task = requireTask(taskID)
        const dispatch = await dispatchRequirementsStage({
          task,
          reason,
          continuationArtifactID: continuation_artifact_id,
        })
        return dispatch.result
      },
    }),

    // -----------------------------------------------------------------------
    // Frontend Design — visual reference analysis before decomposition
    // -----------------------------------------------------------------------

    frontend_design: tool({
      description: [
        "Analyze visual/webpage references (images, URLs, Figma, materials) to produce a webpage-evidence-grounded frontend implementation template with fillable modules, component/material inventories, and visual/data contracts.",
        "Single-shot task-scope handoff producer: dispatch once for the relevant visual scope, persist the handoff, then send later repair/refinement through downstream agents that consume the handoff. Do not use frontend_design as a repeated repair, retry, or implementation iteration tool after its public report/evidence manifest exists.",
        "Use when you decide the requested deliverable needs frontend/UI implementation, webpage/app replication, or visual parity evidence AND:",
        "  - Image attachments are provided (screenshots, mockups, design files)",
        "  - The request mentions a URL as a visual reference to clone, implement, reproduce, or refine",
        "  - The request explicitly asks for layout/frontend design as implementation input",
        "For live webpage clones that need source-backed page information architecture, call frontend_research first when the Page Skeleton Blueprint is missing; do not use frontend_design merely to materialize raw webpage evidence or discover page structure.",
        "",
        "The frontend-design agent must complete at least two frontend template review passes: evidence/template completeness, then downstream implementation feasibility.",
        "The full frontend template plus visual_consistency_contract and iteration/completeness review is persisted",
        "into the decision log from the same frontend-design run. Optional task.design_specs rows may exist as anchors, but the",
        "decision-log frontend template is authoritative. The decision log also includes evidence_source_manifest,",
        "which names the source files, images, URLs, materialized artifacts, webpage evidence artifacts, and task-runtime web-clone-source package downstream stages can read so they",
        "consume one source of truth instead of re-running webpage extraction.",
        "",
        "SKIP this step when:",
        "  - No visual references are available",
        "  - The task is purely backend/API/infrastructure",
        "  - You decide the URL is only PRD/SPEC/report source material and does not need frontend implementation-template evidence",
        "  - The request already contains detailed design specifications AND has no URL, screenshot/image, Figma/design-file, webpage-replica, or other visual reference that needs webpage-evidence/web-clone-source evidence for implementation",
      ].join("\n"),
      inputSchema: FrontendDesignInputSchema,
      execute: async ({ reason, urls, figma_url, materials, continuation_artifact_id }) => {
        const task = requireTask(taskID)
        const hasContinuation = typeof continuation_artifact_id === "string" && continuation_artifact_id.length > 0

        // Guard: skip if no visual input available. Figma URL counts as visual.
        const hasAttachments = Array.isArray(task.attachments) && task.attachments.length > 0
        // Auto-detect: any `figma.com` URL passed via `urls` is
        // treated as a Figma URL (uses Figma MCP instead of screenshot).
        const meta = (task.metadata as Record<string, unknown> | null) ?? {}
        const metaFigma = typeof meta.figma_url === "string" ? meta.figma_url : undefined
        const rawInputUrls = (Array.isArray(urls) ? urls : []).filter((u) => typeof u === "string" && u.length > 0)
        const inputUrls = hasContinuation ? [] : rawInputUrls
        const figmaUrls = [
          ...(figma_url ? [figma_url] : []),
          ...(metaFigma ? [metaFigma] : []),
          ...inputUrls.filter((u) => isFigmaUrl(u)),
        ].filter(() => !hasContinuation)
        const liveUrls = inputUrls.filter((u) => !isFigmaUrl(u))
        const rawMaterialPaths = Array.isArray(materials)
          ? materials.filter((m) => typeof m === "string" && m.length > 0)
          : []
        const materialPaths = hasContinuation ? [] : rawMaterialPaths
        let normalizedStageInput = {
          task: taskContinuationScope(task),
          evidence_snapshot: await frontendDesignPromptEvidenceSnapshot(taskID, task),
        }
        let continuation: AgentSessionContinuation | undefined
        if (hasContinuation) {
          const resolvedContinuation = continuationFromArtifactOrResult({
            taskID,
            stage: "frontend-design",
            artifactID: continuation_artifact_id,
            finalizerName: "submit_frontend_template",
            expectedNormalizedStageInput: normalizedStageInput,
          })
          if ("result" in resolvedContinuation) return resolvedContinuation.result
          continuation = resolvedContinuation.continuation
        }
        if (
          !continuation &&
          !hasAttachments &&
          liveUrls.length === 0 &&
          figmaUrls.length === 0 &&
          materialPaths.length === 0
        ) {
          // P4: decision_log entry before throw so downstream stage agents
          // (architect / build) see the abort cause via TaskContext.snapshot
          // and upstream-context.ts. Without this, the abort surfaces only
          // as a stderr WARN and design_specs stays undefined with no
          // explanation in any prompt (audit §11.3 / L3).
          const { createDecisionLog } = await import("@/decision-log")
          createDecisionLog(taskID).append({
            phase: "frontend_design",
            key: "abort_no_visual_input",
            value:
              "frontend_design aborted before agent call: caller provided no visual reference (no attachments, no url, no figma_url, no materials).",
            reason: "no_visual_input_provided",
          })
          throw new Error(
            "frontend_design requires at least one real visual reference: image attachment, URL, Figma URL, or local material path.",
          )
        }

        await trackStepStart("frontend_design")
        await trackStepProgress("frontend_design", "frontend_design dispatch: input accepted")
        let frontendDesignStepClosed = false
        const closeFrontendDesignStep = async (failed = false) => {
          if (frontendDesignStepClosed) return
          frontendDesignStepClosed = true
          await trackStepComplete("frontend_design", undefined, failed)
        }

        log.info("frontend_design: starting", {
          taskID,
          hasAttachments,
          liveUrlCount: liveUrls.length,
          figmaUrlCount: figmaUrls.length,
          materialCount: materialPaths.length,
          reason,
        })

        // Reference materialization: every external design source (Figma
        // frame, URL-screenshot, local file) gets pulled, written to
        // AttachmentStore, and registered on the task. Two destination
        // columns:
        //   • Figma MCP references → attachments (figma URL is part of the
        //     user contract — the user pointed us at it).
        //   • URL screenshots / local materials → system_artifacts (we
        //     captured them ourselves to feed frontend-design; not user
        //     intent — keeping them out of attachments prevents requirements
        //     from treating system-generated PNGs as user input).
        //
        // frontend-design combines both columns when assembling its visual
        // input. Downstream visual/integrity review also reads both. Requirements
        // reads only attachments — it must see user intent, not internal
        // captures.
        const { AttachmentStore } = await import("@/storage/attachment-store")
        const fsMod = await import("node:fs/promises")
        const pathMod = await import("node:path")

        // Track how many external sources actually produced visual bytes. If
        // every URL screenshot and local material fails to
        // materialize AND the task had no pre-existing attachments, we must
        // abort before calling frontend-design — otherwise the agent runs
        // blind, registers nothing, and the orchestrator hangs waiting for
        // a frontend template that cannot exist. See benchmark run on
        // usage-replica-vague: assistant hallucinated ./image-N.png paths,
        // all 3 ENOENT'd, frontend-design still ran for 45s producing
        // nothing, and the pipeline stalled on the empty verdict.
        let materializedCount = 0
        const materializationFailures: Array<{
          source: "url" | "material"
          target: string
          stage: string
          error: string
        }> = []

        // --- Figma MCP references --------------------------------------------
        for (const figmaUrl of figmaUrls) {
          try {
            await trackStepProgress(
              "frontend_design",
              `frontend_design dispatch: materializing Figma reference ${figmaUrl}`,
            )
            materializedCount += await materializeFigmaMcpReference({
              taskID,
              projectID: Instance.project.id,
              figmaUrl,
            })
            log.info("frontend_design: figma MCP reference materialized", {
              taskID,
              figmaUrl,
            })
          } catch (figmaErr) {
            await closeFrontendDesignStep(true)
            throw figmaErr
          }
        }

        // --- Generic URL screenshots -----------------------------------------
        // Any non-Figma URL is rendered in Chromium so design-tool
        // share links (Sketch Cloud, Adobe XD, Framer, InVision, Zeplin, …)
        // and plain live pages contribute pixel references, not just markup.
        //
        // URL captures are evidence materialization, not acceptance gates.
        // Browser/navigation/screenshot failures are recorded; pixel-density
        // heuristics are diagnostics attached to the materialized reference.
        for (const liveUrl of liveUrls) {
          try {
            await trackStepProgress("frontend_design", `frontend_design dispatch: capturing URL screenshot ${liveUrl}`)
            const {
              captureReferenceManifest,
              assessCaptureDiagnostics,
              summarizeCaptureDiagnostics,
              CaptureReferenceError,
            } = await import("@/frontend-design/capture-gate")
            const osMod = await import("node:os")
            const outDir = pathMod.join(
              osMod.tmpdir(),
              "opencorvus-capture",
              `${Identifier.shortPath(taskID)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            )
            const capture = await captureReferenceManifest({ url: liveUrl, outDir })
            const diagnostics = assessCaptureDiagnostics(capture.manifest)
            const diagnosticSummary = diagnostics.length > 0 ? summarizeCaptureDiagnostics(diagnostics) : "none"
            const hostname = (() => {
              try {
                return new URL(capture.manifest.url).hostname
              } catch {
                return "url"
              }
            })()
            const slug = hostname.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 60) || "url"
            const ref = await AttachmentStore.write(
              task.project_id,
              capture.screenshotPng,
              "image/png",
              `url-${slug}-${Date.now()}.png`,
            )
            await EngineService.appendTaskSystemArtifact(taskID, {
              ...ref,
              intent: "visual_reference",
              source: "url-screenshot",
            })
            log.info("frontend_design: url screenshot materialized", {
              taskID,
              url: liveUrl,
              sha: ref.sha,
              size: ref.size,
              non_white: capture.manifest.non_white_pixel_ratio,
              unique_colors: capture.manifest.unique_color_count,
              diagnostics: diagnosticSummary,
            })
            materializedCount++
          } catch (shotErr) {
            const { CaptureReferenceError } = await import("@/frontend-design/capture-gate")
            const stage = shotErr instanceof CaptureReferenceError ? shotErr.stage : "unknown"
            const error = shotErr instanceof Error ? shotErr.message : String(shotErr)
            materializationFailures.push({
              source: "url",
              target: liveUrl,
              stage,
              error,
            })
            log.warn("frontend_design: url screenshot capture failed", {
              taskID,
              url: liveUrl,
              stage,
              error,
            })
          }
        }

        // --- Local material files --------------------------------------------
        // Paths are resolved against the project root and must stay inside
        // it — refusing traversal matches the codebase-tools boundary rule.
        const projectRoot = Instance.project.worktree
        for (const rawPath of materialPaths) {
          try {
            await trackStepProgress(
              "frontend_design",
              `frontend_design dispatch: materializing local material ${rawPath}`,
            )
            const abs = pathMod.isAbsolute(rawPath)
              ? pathMod.normalize(rawPath)
              : pathMod.normalize(pathMod.resolve(projectRoot, rawPath))
            if (!abs.startsWith(pathMod.normalize(projectRoot))) {
              materializationFailures.push({
                source: "material",
                target: rawPath,
                stage: "path",
                error: `resolved path escapes project root: ${abs}`,
              })
              log.warn("frontend_design: material path escapes project root — skipped", {
                taskID,
                rawPath,
                projectRoot,
              })
              continue
            }
            const bytes = await fsMod.readFile(abs)
            const filename = pathMod.basename(abs)
            const mime = guessMimeFromFilename(filename)
            const ref = await AttachmentStore.write(task.project_id, bytes, mime, filename)
            await EngineService.appendTaskSystemArtifact(taskID, {
              ...ref,
              intent: "visual_reference",
              source: "material",
            })
            log.info("frontend_design: material materialized", {
              taskID,
              path: rawPath,
              sha: ref.sha,
              size: ref.size,
              mime,
            })
            materializedCount++
          } catch (matErr) {
            materializationFailures.push({
              source: "material",
              target: rawPath,
              stage: "read",
              error: matErr instanceof Error ? matErr.message : String(matErr),
            })
            log.warn("frontend_design: material materialization failed", {
              taskID,
              path: rawPath,
              error: matErr instanceof Error ? matErr.message : String(matErr),
            })
          }
        }

        let preparedWebpageEvidenceArtifacts: string[] = []
        let preparedWebpageEvidenceStatus: string | undefined
        if (liveUrls.length > 0) {
          try {
            await trackStepProgress("frontend_design", "frontend_design dispatch: preparing live webpage evidence")
            const webpageEvidenceProjectDir = taskPrimaryProjectRoot(taskID, { activeProjectID: Instance.project.id })
            const evidence = await ensureLiveWebpageEvidence({
              projectDir: webpageEvidenceProjectDir,
              worktreeDir: Instance.directory,
              taskID,
              urls: liveUrls,
              signal: input.signal,
            })
            preparedWebpageEvidenceArtifacts =
              evidence.artifacts.length > 0 ? evidence.artifacts : primaryWebpageEvidenceArtifacts(taskID)
            preparedWebpageEvidenceStatus = evidence.status
            log.info("frontend_design: live webpage evidence prepared", {
              taskID,
              url: evidence.url,
              status: evidence.status,
              evidenceDir: evidence.evidenceDir,
              artifacts: preparedWebpageEvidenceArtifacts.length,
            })
            if (evidence.status !== "skipped") {
              const { createDecisionLog } = await import("@/decision-log")
              createDecisionLog(taskID).append({
                phase: "frontend_design",
                key: "webpage_evidence",
                value:
                  `Host-prepared live webpage evidence for ${evidence.url} (${evidence.status}).\n` +
                  preparedWebpageEvidenceArtifacts.map((item) => `- ${item}`).join("\n"),
                reason:
                  "Live webpage clone evidence is prepared deterministically before frontend template synthesis so downstream agents consume source skeleton/IR instead of relying on screenshot-only prose.",
              })
            }
          } catch (evidenceErr) {
            const error = evidenceErr instanceof Error ? evidenceErr.message : String(evidenceErr)
            const { createDecisionLog } = await import("@/decision-log")
            createDecisionLog(taskID).append({
              phase: "frontend_design",
              key: "abort_webpage_evidence_failed",
              value: `Live webpage evidence generation failed before frontend template synthesis: ${error}`,
              reason:
                "A live webpage clone task cannot be grounded by prose alone; extraction/compile/analyze must succeed or surface the real acquisition failure.",
            })
            await closeFrontendDesignStep(true)
            throw evidenceErr instanceof Error ? evidenceErr : new Error(error)
          }
        }

        // Refresh task to pick up any newly-attached references. frontend-design
        // sees the union of user attachments (figma + user uploads) and
        // system_artifacts (URL screenshots + materials we just captured).
        const enrichedTask = requireTask(taskID)
        const designVisuals = [
          ...(Array.isArray(enrichedTask.attachments) ? (enrichedTask.attachments as any[]) : []),
          ...(Array.isArray(enrichedTask.system_artifacts) ? (enrichedTask.system_artifacts as any[]) : []),
        ]
        const enrichedHasAttachments = designVisuals.length > 0
        normalizedStageInput = {
          task: taskContinuationScope(enrichedTask),
          evidence_snapshot: await frontendDesignPromptEvidenceSnapshot(taskID, enrichedTask),
        }

        // Fail-fast if frontend_design was invoked on the strength of URLs /
        // materials but every source failed to materialize. Running
        // frontend-design blind produces zero output tools, which the caller
        // turns into "frontend_design failed" — we surface the real root
        // cause (no usable visual input) back to the orchestrator instead
        // of letting the downstream agent run for 45s and emit nothing.
        if (!enrichedHasAttachments && materializedCount === 0 && preparedWebpageEvidenceArtifacts.length === 0) {
          await closeFrontendDesignStep(true)
          const providedCount = liveUrls.length + figmaUrls.length + materialPaths.length
          const failureDetail =
            materializationFailures.length > 0
              ? " Materialization errors: " +
                materializationFailures
                  .map((failure) => `${failure.source}:${failure.target} [${failure.stage}] ${failure.error}`)
                  .join("; ")
              : ""
          const message =
            `frontend_design aborted: all ${providedCount} provided visual source(s) ` +
            `failed to materialize (URLs unreachable, Figma fetch failed, or local material ` +
            `paths did not exist). Check that the paths/URLs in the 'materials' / 'url' / ` +
            `'urls' / 'figma_url' arguments actually exist, then retry frontend_design ` +
            `with real visual evidence or ask the user for usable reference material.` +
            failureDetail
          log.warn("frontend_design: no visual input materialized — aborting before agent call", {
            taskID,
            liveUrlCount: liveUrls.length,
            figmaUrlCount: figmaUrls.length,
            materialCount: materialPaths.length,
            materializationFailures,
          })
          // P4: write decision_log so downstream agents see "frontend design
          // was attempted but produced no visual context" rather than
          // running blind on designSpecs=undefined (audit §11.3 / L3, bench
          // tsk_dde13a67c001sbz6y2Qe0at8Fc:1729).
          const { createDecisionLog } = await import("@/decision-log")
          createDecisionLog(taskID).append({
            phase: "frontend_design",
            key: "abort_materialization_failed",
            value:
              `frontend_design aborted before agent call: all ${providedCount} provided visual ` +
              `source(s) (live=${liveUrls.length}, figma=${figmaUrls.length}, materials=${materialPaths.length}) ` +
              `failed to materialize.${failureDetail}`,
            reason: "materialization_failed_all_sources",
          })
          await closeFrontendDesignStep(true)
          throw new Error(message)
        }

        // Single session per sub-agent (rule 22). FrontendDesignAgent.analyze
        // creates the runner session internally; the orchestrator captures
        // its id via onSessionCreated for downstream emit attribution.
        let runnerSessionID: string | undefined = continuation?.sessionID
        try {
          await trackStepProgress("frontend_design", "frontend_design dispatch: loading agent module")
          const { FrontendDesignAgent } = await import("@/frontend-design")
          await trackStepProgress(
            "frontend_design",
            "frontend_design dispatch: visual input ready; calling agent analyze",
          )

          const analysis = await FrontendDesignAgent.analyze({
            title: task.title,
            request: task.request,
            // Single-source visual input: every URL / Figma frame / local
            // material the orchestrator resolved has already been turned
            // into a PNG in `designVisuals`. Prefer those pixels; frontend-design
            // does not use webfetch, though it may capture an additional live
            // webpage screenshot with its dedicated `url_screenshot` tool.
            attachments: enrichedHasAttachments ? designVisuals : undefined,
            taskID,
            parentSessionID: input.agentSessionID,
            signal: input.signal,
            continuation,
            onStatus: () => {},
            onSessionCreated: (id) => {
              runnerSessionID = id
              void trackStepProgress("frontend_design", `frontend_design dispatch: agent session created ${id}`)
            },
          })
          await trackStepProgress("frontend_design", "frontend_design dispatch: agent analyze returned")

          // Persist optional visual anchors on task.design_specs (dedicated
          // JSON column, not metadata). The binding contract is the frontend template
          // persisted into the Decision Log below; empty anchors are valid.
          const freshTask = requireTask(taskID)
          await updateTask(
            freshTask,
            { design_specs: analysis.specs },
            preparedWebpageEvidenceArtifacts.length > 0
              ? `Design frontend template stored (webpage clone artifacts: ${preparedWebpageEvidenceArtifacts.length}, optional visual anchors: ${analysis.specs.length})`
              : `Design frontend template stored (optional visual anchors: ${analysis.specs.length})`,
          )

          await closeFrontendDesignStep()

          const countByCategory = analysis.specs.reduce<Record<string, number>>((acc, s) => {
            acc[s.category] = (acc[s.category] ?? 0) + 1
            return acc
          }, {})
          const taskAfterDesignSpecs = requireTask(taskID)
          const projectDir = taskPrimaryProjectRoot(taskID, { activeProjectID: Instance.project.id })
          const materializedDesignFiles = frontendDesignArtifactPaths(projectDir, taskID)
          const evidenceSourceManifest = renderEvidenceSourceManifest({
            task: taskAfterDesignSpecs,
            projectDir,
            liveUrls,
            figmaUrls,
            materialPaths,
            referenceArtifacts: analysis.referenceArtifacts,
            mirrorArtifacts: preparedWebpageEvidenceArtifacts,
            materializedFiles: [materializedDesignFiles.templateRelative, materializedDesignFiles.manifestRelative],
          })
          const writtenDesignArtifacts = await writeFrontendDesignArtifacts({
            projectDir,
            taskID,
            report: analysis.report,
            evidenceSourceManifest,
          })

          const { createDecisionLog } = await import("@/decision-log")
          const decisionLog = createDecisionLog(taskID)
          decisionLog.append({
            phase: "frontend_design",
            key: "public_report",
            value: analysis.report.detail,
            reason:
              "Frontend-design terminal report; public readable handoff for Requirements, Architect, Build, and Acceptance.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "visual_contract_summary",
            value:
              `Optional visual anchors: ${analysis.specs.length}. ` +
              `Color ${countByCategory.color ?? 0}, typography ${countByCategory.typography ?? 0}, ` +
              `spacing ${countByCategory.spacing ?? 0}, layout ${countByCategory.layout ?? 0}, ` +
              `component ${countByCategory.component ?? 0}, interaction ${countByCategory.interaction ?? 0}, ` +
              `responsive ${countByCategory.responsive ?? 0}.`,
            reason: "Frontend-design optional anchor summary; the frontend template entries are authoritative.",
          })
          if (analysis.designSystem.trim()) {
            decisionLog.append({
              phase: "frontend_design",
              key: "design_system",
              value: analysis.designSystem,
              reason: "Frontend-design identified the dominant design system / visual language.",
            })
          }
          if (analysis.techStack.length > 0) {
            decisionLog.append({
              phase: "frontend_design",
              key: "recommended_stack",
              value: analysis.techStack.join(", "),
              reason:
                "Frontend-design's implementation stack hints grounded in the frontend template and observed reference behavior.",
            })
          }
          decisionLog.append({
            phase: "frontend_design",
            key: "frontend_template",
            value: analysis.frontendTemplate,
            reason: "Webpage-evidence-grounded frontend replica scope produced before requirements decomposition.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "final_acceptance_mode",
            value: analysis.finalAcceptanceMode ?? "visual_baseline_allowed",
            reason:
              "Whether downstream Build may keep the visual baseline or must replace requested surfaces with maintainable semantic components/data/API bindings.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "fillable_modules",
            value: analysis.fillableModules,
            reason:
              "Fillable module and slot plan derived from visual evidence, webpage evidence artifacts, and the task-runtime web-clone-source package.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "component_inventory",
            value: analysis.componentInventory,
            reason:
              "Component-family cross-check only; downstream agents should read public_report, reuse constraints, quality_project_contract, completeness_review, and source artifacts instead of treating this as a component checklist.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "component_reuse_plan",
            value: JSON.stringify(analysis.componentReusePlan ?? [], null, 2),
            reason: "Structured reuse/library decision plan for each component family in the frontend template.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "baseline_replacement_plan",
            value: JSON.stringify(analysis.baselineReplacementPlan ?? [], null, 2),
            reason:
              "Generated-baseline deletion/replacement checklist that tells Build which skeleton regions must be replaced, deleted, or temporarily deferred and which existing/mature components own each boundary.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "implementation_phase_outcomes",
            value: JSON.stringify(analysis.implementationPhaseOutcomes ?? [], null, 2),
            reason:
              "Structured maintainable replacement phase outcomes. Architect should consume this before component inventory or region lists.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "quality_project_contract",
            value: analysis.qualityProjectContract,
            reason:
              "High-quality maintainable frontend project contract; raw extracted baseline is not the delivered project.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "material_inventory",
            value: analysis.materialInventory,
            reason: "Material and asset inventory required to fill the frontend template.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "frontend_project",
            value: [
              `status: ${analysis.frontendProject.status}`,
              `role: ${analysis.frontendProject.role}`,
              `project_root: ${analysis.frontendProject.project_root}`,
              `source_package: ${analysis.frontendProject.source_package}`,
              `generation_tool: ${analysis.frontendProject.generation_tool}`,
              `entrypoints: ${analysis.frontendProject.entrypoints.join(", ")}`,
              ...analysis.frontendProject.notes.map((note) => `note: ${note}`),
            ].join("\n"),
            reason: "Concrete frontend-design skeleton/project baseline for downstream Build refinement.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "visual_consistency_contract",
            value: analysis.visualConsistencyContract,
            reason: "Primary visual-fidelity contract for downstream implementation and acceptance review.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "ui_data_contract",
            value: analysis.uiDataContract,
            reason: "UI data contract needed to reproduce observed page behavior; unknowns remain explicit.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "template_iteration_notes",
            value: analysis.templateIterationNotes.join("\n"),
            reason: "Frontend template review passes completed before downstream handoff.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "completeness_review",
            value: analysis.completenessReview,
            reason: "Final frontend-design completeness audit for requirements, architect, and build.",
          })
          decisionLog.append({
            phase: "frontend_design",
            key: "evidence_source_manifest",
            value: evidenceSourceManifest,
            reason:
              "Source manifest naming the frontend template origin, task files, materialized images, webpage evidence artifacts, and task-runtime web-clone-source package downstream agents can read.",
          })
          if (analysis.referenceArtifacts.length > 0) {
            decisionLog.append({
              phase: "frontend_design",
              key: "reference_artifacts",
              value: analysis.referenceArtifacts.join("\n"),
              reason: "Evidence artifacts used by frontend-design.",
            })
          }
          if (analysis.openQuestions.length > 0) {
            decisionLog.append({
              phase: "frontend_design",
              key: "open_questions",
              value: analysis.openQuestions.join("\n"),
              reason: "Facts frontend-design could not observe and downstream agents must not hallucinate.",
            })
          }

          log.info("frontend_design: complete", {
            taskID,
            total: analysis.specs.length,
            byCategory: countByCategory,
          })

          // Card terminal status flows through session.status; counts on
          // the Panel come from boardStore. No phase-completed bus event.

          return SubAgentProtocol.yieldResult({
            headline:
              "SUCCESS: frontend_design public report, visual_consistency_contract, and evidence manifest persisted. " +
              "Downstream agents can now read the public report before requirements, architecture, build, or acceptance work.",
            fields: [
              ["optional_visual_anchors", String(analysis.specs.length)],
              ["color", String(countByCategory.color ?? 0)],
              ["typography", String(countByCategory.typography ?? 0)],
              ["spacing", String(countByCategory.spacing ?? 0)],
              ["layout", String(countByCategory.layout ?? 0)],
              ["component", String(countByCategory.component ?? 0)],
              ["interaction", String(countByCategory.interaction ?? 0)],
              ["responsive", String(countByCategory.responsive ?? 0)],
              ["design_system", analysis.designSystem],
              ["recommended_stack", analysis.techStack],
              ["template_review_passes", String(analysis.templateIterationNotes.length)],
              ["reference_artifacts", String(analysis.referenceArtifacts.length)],
              ["frontend_project_status", analysis.frontendProject.status],
              ["frontend_project_root", analysis.frontendProject.project_root],
              ["webpage_evidence", preparedWebpageEvidenceStatus ?? "none"],
              ["webpage_clone_artifacts", String(preparedWebpageEvidenceArtifacts.length)],
              ["source_manifest", "decision_log:frontend_design/evidence_source_manifest"],
              ["frontend_template_file", writtenDesignArtifacts.templateRelative],
              ["source_manifest_file", writtenDesignArtifacts.manifestRelative],
              ["open_questions", String(analysis.openQuestions.length)],
            ],
            pointer: "decision_log phase=frontend_design",
          })
        } catch (err) {
          await closeFrontendDesignStep(true)
          const msg = err instanceof Error ? err.message : String(err)
          log.error("frontend_design: failed", { taskID, error: msg })
          const continuationResult = continuationResultForProtocolFinalizerMiss({
            err,
            taskID,
            stage: "frontend-design",
            sessionID: runnerSessionID,
            parentSessionID: input.agentSessionID,
            finalizerName: "submit_frontend_template",
            normalizedStageInput,
            pointerReason: reason ?? null,
          })
          if (continuationResult) return continuationResult
          throw err instanceof Error ? err : new Error(msg)
        }
      },
    }),

    // -----------------------------------------------------------------------
    // Cross-goal coordination — Architect Agent
    // -----------------------------------------------------------------------

    architect: tool({
      description:
        "OPTIONAL stage agent. Decompose the task into goals. The Architect reads the " +
        "REQ-N list + foundational decisions produced by requirements, explores the " +
        "codebase, and registers the final goal set with acceptance_specs, " +
        "traceability, source/reference coverage, and cross-goal contracts.\n\n" +
        "USE WHEN: the work fans into multiple parallel goals (independent " +
        "owned_paths, cross-goal contracts), OR you need explicit acceptance specs " +
        "per goal so per-goal builds and `integrity` have something concrete to verify " +
        "against. Requires a `requirements` spec snapshot to run against — call " +
        "`requirements` first.\n" +
        "SKIP WHEN: the work fits one goal (the build agent's own todo list is " +
        "enough); every fix lives inside one file or one symbol's call sites.\n" +
        "Re-run on integrity non-pass or explicit structural restart when evidence " +
        "points at structural / coverage problems. During an active run, do not " +
        "re-run architect merely to widen owned_paths or bless ordinary shared-file " +
        "edits; build sessions may edit outside responsibility paths when needed " +
        "and must explain every touched file in files_changed[]. For contract-level " +
        "point fixes prefer `modify_goal`. Frontend evidence tools are available candidates when the full task context " +
        "needs visual/reference material for architecture.",
      inputSchema: z
        .object({
          reason: z.string().optional().describe("Why you decided to run architect"),
          continuation_artifact_id: StageContinuationArtifactIDField,
        })
        .strict(),
      execute: async ({ reason, continuation_artifact_id }) => {
        const task = requireTask(taskID)
        const dispatch = await dispatchArchitectStage({
          task,
          reason,
          continuationArtifactID: continuation_artifact_id,
        })
        return dispatch.result
      },
    }),

    // -----------------------------------------------------------------------
    // Goal Workload Analyst — independent, read-only goal-sizing reviewer.
    //
    // Runs after architect, before per-goal build (advisory, not a gate). It
    // deep-reads the full frontend template (inlined into its prompt) plus the architect
    // goal graph and, per goal, produces a compact brief: countable work
    // surface + why_not_smaller + underestimation_traps + verification_inventory
    // + a decomposition_concern when a goal is too large / under-specified for
    // one autonomous build. It only references existing surfaces/contracts by
    // id — it never re-decomposes goals (that is architect's job). The brief is
    // persisted as a single task-level `goal_workload` artifact (latest-wins,
    // staleness-bound to the active spec snapshot). Concern findings feed an
    // architect re-size; the brief feeds build against premature minimization.
    // Failure surfacing mirrors the architect tool's catch.
    // -----------------------------------------------------------------------

    workload_analysis: tool({
      description:
        "OPTIONAL read-only stage agent. After architect, before per-goal build, the Goal Workload " +
        "Analyst deep-reads the FULL frontend template + the architect goal graph and produces a per-goal " +
        "workload brief: countable work surface, why-it-is-not-smaller, underestimation traps, a " +
        "verification inventory, and a `decomposition_concern` when a goal is too large or " +
        "under-specified for one autonomous build. It is an independent sizing reviewer with no " +
        "implementation bias — it never writes code and never creates / modifies / splits goals.\n\n" +
        "USE WHEN: architect just produced a multi-goal graph and you want an independent check that " +
        "no goal is oversized before dispatching builds, OR you want each build to receive an " +
        "anti-underestimation brief. Requires architect goals on the active spec snapshot.\n" +
        "SKIP WHEN: the goal set is trivial (one obvious goal). Advisory — the workflow can proceed " +
        "without it.\n" +
        "AFTER it returns: goals flagged with `decomposition_concern` are evidence for an architect " +
        "re-size — prefer `modify_goal` for single-field fixes, re-enter `architect` only for genuinely " +
        "new structure (a split). Briefs feed the next per-goal `build` automatically.",
      inputSchema: z
        .object({
          reason: z.string().optional().describe("Why you decided to run workload analysis"),
          continuation_artifact_id: StageContinuationArtifactIDField,
        })
        .strict(),
      execute: async ({ reason, continuation_artifact_id }) => {
        const task = requireTask(taskID)
        const activeSpec = findActiveSpecForTask(task.id)
        if (!activeSpec) {
          return SubAgentProtocol.yieldResult({
            headline: "workload_analysis: no active spec — call requirements/architect first.",
            fields: [["next_action", "architect"]],
            pointer: "read_context scope=decisions",
          })
        }
        const goals = listGoals(taskID)
        if (goals.length === 0) {
          return SubAgentProtocol.yieldResult({
            headline: "workload_analysis: no goals on the active spec — call architect first.",
            summary:
              "The Goal Workload Analyst sizes an existing goal graph. No architect goals exist yet, " +
              "so there is nothing to analyze.",
            fields: [["next_action", "architect"]],
            pointer: "read_context scope=decisions",
          })
        }

        await trackStepStart("workload_analysis")
        let runnerSessionID: string | undefined
        const contractGraphArtifact = findLatestArchitectContractGraphArtifact(taskID)
        const normalizedStageInput = {
          task: taskContinuationScope(task),
          active_spec: specContinuationScope(activeSpec),
          goals: goalsContinuationScope(goals),
          architect_contract_graph_artifact_id: contractGraphArtifact?.id ?? null,
        }
        try {
          let continuation: AgentSessionContinuation | undefined
          if (continuation_artifact_id) {
            const resolvedContinuation = continuationFromArtifactOrResult({
              taskID,
              stage: "goal-workload-analyst",
              artifactID: continuation_artifact_id,
              finalizerName: "submit_workload_analysis",
              expectedNormalizedStageInput: normalizedStageInput,
            })
            if ("result" in resolvedContinuation) {
              await trackStepComplete("workload_analysis")
              return resolvedContinuation.result
            }
            continuation = resolvedContinuation.continuation
          }
          runnerSessionID = continuation?.sessionID
          const { findRequirements } = await import("@/engine/store")
          const requirements = findRequirements(activeSpec.id).map(parsedRequirementFromRow)
          const frontendDesign = renderFrontendDesignHandoffReference(taskID)
          const contractGraph = findLatestArchitectContractGraph(taskID)

          // referenceCoverage: architect persists `architect_fidelity` into task
          // metadata with referenceCoverage rows {id, surface, visual_spec_ids,
          // expectation, goal_ids}. Map to the analyst's input shape when present;
          // it is optional, so a missing / malformed shape degrades to undefined
          // rather than inventing rows.
          let referenceCoverage:
            | Array<{ id: string; surface: string; visual_spec_ids: string[]; expectation: string }>
            | undefined
          const taskMetadata =
            task.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)
              ? (task.metadata as Record<string, unknown>)
              : {}
          const fidelity = taskMetadata.architect_fidelity as
            | { referenceCoverage?: Array<Record<string, unknown>> }
            | undefined
          if (fidelity && Array.isArray(fidelity.referenceCoverage)) {
            referenceCoverage = fidelity.referenceCoverage.map((row) => ({
              id: String(row.id ?? ""),
              surface: String(row.surface ?? ""),
              visual_spec_ids: Array.isArray(row.visual_spec_ids) ? (row.visual_spec_ids as string[]) : [],
              expectation: String(row.expectation ?? ""),
            }))
          }

          // prdFullText: inline the materialized template when it exists (the analyst
          // is the one agent whose whole job is to digest it). Optional —
          // wrapped so a missing / unreadable file falls back to the handoff
          // reference the prompt already renders.
          let prdFullText: string | undefined
          try {
            const projectDir = taskPrimaryProjectRoot(taskID, { activeProjectID: Instance.project.id })
            const templatePath = frontendDesignArtifactPaths(projectDir, taskID).templateAbsolute
            const nodeFs = await import("node:fs")
            prdFullText = nodeFs.existsSync(templatePath) ? nodeFs.readFileSync(templatePath, "utf8") : undefined
          } catch (prdErr) {
            log.warn("workload_analysis: template inline read failed (non-fatal)", {
              taskID,
              error: prdErr instanceof Error ? prdErr.message : String(prdErr),
            })
          }

          const { GoalWorkloadAnalystAgent } = await import("@/goal-workload-analyst")
          const result = await GoalWorkloadAnalystAgent.analyze({
            taskTitle: task.title,
            goals: goals.map((g) => ({
              id: g.id,
              title: g.title,
              objective: g.objective,
              acceptance_specs: acceptanceSpecsToPromptLines(g.acceptance_specs),
              owned_paths: Array.isArray(g.owned_paths) ? (g.owned_paths as string[]) : [],
              depends_on: Array.isArray(g.depends_on) ? (g.depends_on as string[]) : [],
              kind: g.kind,
              requirement_ids: Array.isArray(g.requirement_ids) ? (g.requirement_ids as string[]) : [],
            })),
            contractGraph: contractGraph ?? undefined,
            referenceCoverage,
            requirements: requirements.length > 0 ? requirements : undefined,
            prdFullText,
            frontendDesign: frontendDesign.trim().length > 0 ? frontendDesign : undefined,
            specSnapshotID: activeSpec.id,
            taskID,
            parentSessionID: input.agentSessionID,
            signal: input.signal,
            continuation,
            onSessionCreated: (id) => {
              runnerSessionID = id
            },
          })

          const { persistGoalWorkload } = await import("@/engine/persist")
          Database.use((db) =>
            persistGoalWorkload(db, {
              taskID,
              specSnapshotID: activeSpec.id,
              briefs: result.briefs,
              summary: result.summary,
              now: Date.now(),
            }),
          )

          await trackStepComplete("workload_analysis")

          const flagged = result.briefs.filter((b) => b.decomposition_concern?.trim()).map((b) => b.goal_id)
          return SubAgentProtocol.yieldResult({
            headline:
              `Workload analysis complete: ${result.briefs.length} goals analyzed, ${flagged.length} flagged with decomposition_concern. ` +
              "For flagged goals consider Architect re-sizing (modify_goal for single-field fixes / architect for a split); " +
              "otherwise dispatch per-goal build — each build now carries its workload brief.",
            summary: result.summary,
            fields: [
              ["goals_flagged", flagged],
              ["spec_snapshot_id", activeSpec.id],
            ],
            pointer: "read_context scope=decisions",
          })
        } catch (err) {
          // Same shape as the architect tool's catch (rule 4 — failure
          // surfacing is uniform across stage agents): mark the workflow step
          // failed and record the abort in the decision log so the operator
          // can see WHICH stage broke, then rethrow.
          try {
            await trackStepComplete("workload_analysis", undefined, true)
          } catch (trackErr) {
            log.warn("workload_analysis: trackStepComplete(failed) emit failed", {
              taskID,
              error: trackErr instanceof Error ? trackErr.message : String(trackErr),
            })
          }
          const continuationResult = continuationResultForProtocolFinalizerMiss({
            err,
            taskID,
            stage: "goal-workload-analyst",
            sessionID: runnerSessionID,
            parentSessionID: input.agentSessionID,
            finalizerName: "submit_workload_analysis",
            normalizedStageInput,
            pointerReason: reason ?? null,
          })
          if (continuationResult) return continuationResult
          const { createDecisionLog } = await import("@/decision-log")
          const failureReason = err instanceof Error ? err.message : String(err)
          createDecisionLog(taskID).append({
            phase: "architect",
            key: "abort_workload_analysis_failed",
            value: `Workload analysis stage aborted: ${failureReason.slice(0, 400)}`,
            reason: "workload_analysis_threw",
          })
          throw err
        }
      },
    }),

    // -----------------------------------------------------------------------
    // Visual QA — final frontend GUI product review and focused repair
    // -----------------------------------------------------------------------

    visual_qa: tool({
      description:
        "Dedicated final frontend visual GUI and functional product review agent. GUI means Graphical User Interface. " +
        "Use once near task completion after all blocking build work is terminal and before final task acceptance: screenshot comparison, screen-by-screen desktop screenshots, explicitly requested non-desktop screenshots, " +
        "interaction-state checks, console/network review, or direct repair of visual or functional defects. " +
        "It consumes task-scoped frontend_design/build evidence plus any prior integrity evidence and repairs coarse-to-fine: component truth and visible functionality first, layout/composition second, micro-style polish last. " +
        "It reviews from a picky professional design QA perspective, lists production_blockers when the product cannot generate or ship, and does not use visual scores, one-shot whole-page screenshots, or judge verdicts as the verdict. " +
        "If it returns accepted=false with unresolved_code_module_problems, the scheduler must decide whether to repair in the current task or call propose_task from that evidence. " +
        "It may use skills, bash/edit/write/apply_patch, and task-scoped browser_preview evidence. " +
        "It does NOT acquire new webpage clone evidence and is NOT the final acceptance gate; integrity remains final. Visual QA and integrity are peer review agents; visual_qa does not replace integrity and is not integrity's workflow prerequisite.",
      inputSchema: VisualQaInputSchema,
      execute: async ({ reason, focus, app_url, preview_command, continuation_artifact_id }) => {
        const task = requireTask(taskID)
        const dispatch = await dispatchVisualQaStage({
          task,
          reason,
          focus,
          appUrl: app_url,
          previewCommand: preview_command,
          continuationArtifactID: continuation_artifact_id,
        })
        return dispatch.result
      },
    }),

    // -----------------------------------------------------------------------
    // Integrity / Architecture review — advisory review of the current graph.
    //
    // Lifted out of architect/agent.ts (audit 2026-04-25): per the agent
    // boundary rule (agents do not call agents; only the orchestrator
    // routes messages between agents), the integrity reviewer must be a
    // sibling of architect at the orchestrator level, not a nested call
    // inside architect's run(). This tool reads the persisted goal set,
    // invokes the reviewer, and records findings only. It never rewrites
    // requirements or goals; a non-pass post-build review routes rework to
    // the affected goal IDs named by review issues/corrections so Build
    // consumes the feedback in the next prompt.
    // -----------------------------------------------------------------------

    integrity: tool({
      description:
        "Final adversarial integrity evidence review of the active " +
        "architect graph and delivered system. The supervisor creates task-specific reviewer " +
        "sessions, reviewers freely inspect/test within read-only evidence tools, and the final " +
        "output is a consensus team report with findings, evidence, required repairs, and unresolved " +
        "disagreements. A post-build pass verdict records completion evidence; call complete_task with the returned integrity_attempt_id to record task completion. Non-pass findings " +
        "are persisted as evidence only: this review never rewrites requirements, " +
        "never upserts goals, and the host never auto-supersedes attempts or " +
        "auto-routes findings — you read the markdown and choose modify_goal / " +
        "build({goalID}) / architect / fail_task explicitly. Goal builds record " +
        "build reports as review input.\n\n" +
        "USE WHEN: architect just produced a non-trivial goal graph (≥3 goals, OR " +
        "cross-goal contracts, OR foundational decisions architect derived rather " +
        "than user-stated), OR build evidence needs architecture feedback. " +
        "Build reports are already recorded as review input for goal builds.\n" +
        "SKIP WHEN: architect produced exactly one goal whose contract trivially " +
        "matches the user request, OR you already ran integrity for this spec " +
        "snapshot and have no new signal. Requires architect goals on the active " +
        "spec snapshot.",
      inputSchema: IntegrityInputSchema,
      execute: async (toolInput, options) => {
        const toolExecution = requireOrchestratorToolExecutionContext(options, "integrity")
        await trackStepStart("integrity")
        let integrityStepFailed = true
        try {
          const outcome = await runIntegrityReview(toolExecution, toolInput)
          integrityStepFailed = !(
            outcome.status === "reviewed" &&
            outcome.verdict === "pass" &&
            outcome.phase === "post_build"
          )
          if (outcome.status === "reviewed" && outcome.artifactMissing && outcome.phase === "post_build") {
            await blockActiveRunForTask(taskID, {
              blockingReason: "integrity artifact_missing",
              error: outcome.artifactMissing.error,
              summary: "Run blocked by missing integrity attempt artifact",
            })
          } else if (outcome.status === "reviewed" && outcome.phase === "post_build") {
            await blockActiveRunForTask(taskID, {
              blockingReason: `integrity verdict ${outcome.verdict}`,
              error: outcome.summary,
              summary: "Run blocked by non-pass integrity verdict",
            })
          }
          return renderIntegrityOutcome(outcome)
        } finally {
          await trackStepComplete("integrity", undefined, integrityStepFailed)
        }
      },
    }),

    // -----------------------------------------------------------------------
    // Fact-check — verifies factual claims registered by a worker agent's
    // terminal report.  Specs: fact-check agent contract §4.3.
    //
    // Trigger rule (rule 13 — you, the orchestrator LLM, decide):
    //   You MAY call fact_check after integrity verdict = pass when
    //   the upstream worker's terminal report has fact_check_items.length > 0
    //   OR the worker's narrative makes load-bearing factual claims about
    //   external systems.  The tool dedupes automatically across repeats;
    //   if the target session is still streaming, the tool will reject —
    //   retry after it finishes.
    // -----------------------------------------------------------------------

    fact_check: tool({
      description:
        "Verify factual claims a worker agent registered in its terminal report. " +
        "Use when (1) integrity verdict=pass AND (2) the worker's terminal report has " +
        "non-empty fact_check_items OR makes load-bearing factual claims about external " +
        "systems (APIs, library versions, third-party protocols, numbers, paths). " +
        "Pass target_session_id from the current task; target_agent is derived from that session " +
        "and an explicit target_agent is only a consistency assertion. " +
        "The tool dedupes automatically across repeated calls — you do NOT need to " +
        "track 'already checked'.  If the target session is still streaming, the tool " +
        "will reject; retry after it finishes.\n" +
        "DO NOT call for trivial / opinion / preference outputs, or when integrity " +
        "verdict ≠ pass.\n" +
        "After fact_check returns:\n" +
        "- verdict=clean → proceed.\n" +
        "- verdict=minor_corrections → quote corrections in your next user-facing " +
        "message, proceed.\n" +
        "- verdict=needs_orchestrator_action → invoke modify_goal / propose_task / " +
        "fail_task per the corrected[i].recommended_action.\n" +
        "- verdict=inconclusive → retry fact_check or proceed with a caveat note.",
      inputSchema: FactCheckInputSchema,
      execute: async (args) => {
        const task = requireTask(taskID)
        await trackStepStart("fact_check")
        const { FactCheckAgent } = await import("@/fact-check")
        const { findFactCheckAttempt, recordFactCheckAttempt } = await import("@/fact-check/persist")
        const { Session } = await import("@/session")
        let factCheckStepFailed = true
        try {
          const unavailableContinuation = args.continuation_artifact_id
            ? stageContinuationUnavailableResult({
                taskID: task.id,
                stage: "fact-check",
                artifactID: args.continuation_artifact_id,
                finalizerName: "report_fact_check_result",
              })
            : undefined
          if (unavailableContinuation) {
            factCheckStepFailed = false
            return unavailableContinuation
          }
          const continuationInput = args.continuation_artifact_id
            ? factCheckContinuationFromArtifact({ taskID: task.id, artifactID: args.continuation_artifact_id })
            : undefined
          const continuation = continuationInput?.continuation

          // Step 1: snapshot — also acts as the terminal-state precondition.
          let resolvedArgs: FactCheckStageInput
          if (continuationInput) {
            resolvedArgs = continuationInput.normalizedStageInput
          } else {
            const targetScope = resolveFactCheckTargetScope({
              taskID: task.id,
              targetSessionID: args.target_session_id!,
              assertedTargetAgent: args.target_agent,
            })
            if ("error" in targetScope) {
              return `fact_check rejected: ${targetScope.error}`
            }
            const snap = await Session.snapshotLatestAssistant(args.target_session_id!)
            if (!snap.finished) {
              return (
                `fact_check rejected: target session is not in a terminal state ` +
                `(reason=${snap.reason ?? "unknown"}). Retry after the worker finishes streaming.`
              )
            }
            if (!snap.messageID || !snap.contentHash) {
              return (
                "fact_check rejected: target session has no terminal assistant message. " +
                "Confirm you passed the correct target_session_id."
              )
            }
            resolvedArgs = FactCheckStageInputSchema.parse({
              target_session_id: args.target_session_id,
              target_agent: targetScope.targetAgent,
              fact_check_items: args.fact_check_items,
              reason: args.reason,
              target_message_id: snap.messageID,
              target_message_content_hash: snap.contentHash,
            })
          }

          // Step 2: idempotency cache.
          const cached = findFactCheckAttempt({
            invokedByOrchestratorSessionID: input.agentSessionID,
            targetSessionID: resolvedArgs.target_session_id,
            targetMessageID: resolvedArgs.target_message_id,
            targetMessageContentHash: resolvedArgs.target_message_content_hash,
          })
          if (cached) {
            factCheckStepFailed = false
            return (
              `fact_check (cached, no LLM work) — verdict=\`${cached.payload.report.overall_verdict}\`\n\n` +
              renderFactCheckReport(cached.payload.report)
            )
          }

          // Step 3: run agent.
          const timeStarted = Date.now()
          let runnerSessionID = continuation?.sessionID
          try {
            const result = await FactCheckAgent.run({
              targetSessionID: resolvedArgs.target_session_id,
              targetAgent: resolvedArgs.target_agent,
              targetMessageID: resolvedArgs.target_message_id,
              targetMessageContentHash: resolvedArgs.target_message_content_hash,
              factCheckItems: resolvedArgs.fact_check_items,
              reason: resolvedArgs.reason,
              orchestratorSessionID: input.agentSessionID,
              taskID: task.id,
              signal: input.signal,
              continuation,
              onSessionCreated: (sessionID) => {
                runnerSessionID = sessionID
              },
            })
            // Step 3a: scope consistency check (codex impl review §3).  The
            // LLM populates report.scope itself; we must assert it matches
            // the snapshot the host took so a wrong scope cannot poison the
            // idempotency cache or read_context downstream.  Mismatch is
            // a contract violation, not a soft warning — return tool error
            // and persist outcome=tool_error so the orchestrator knows to
            // retry (rule 7: no silent fallback).
            const scope = result.report.scope
            const scopeMismatch =
              scope.target_session_id !== resolvedArgs.target_session_id ||
              scope.target_agent !== resolvedArgs.target_agent ||
              scope.target_message_id !== resolvedArgs.target_message_id ||
              scope.target_message_content_hash !== resolvedArgs.target_message_content_hash
            if (scopeMismatch) {
              const synthetic = synthesizeToolErrorReport({
                snap: {
                  messageID: resolvedArgs.target_message_id,
                  contentHash: resolvedArgs.target_message_content_hash,
                },
                args: resolvedArgs,
                reason:
                  `fact-check returned a report.scope inconsistent with the host snapshot ` +
                  `(expected target_session=${resolvedArgs.target_session_id} agent=${resolvedArgs.target_agent} ` +
                  `message_id=${resolvedArgs.target_message_id}; got session=${scope.target_session_id} ` +
                  `agent=${scope.target_agent} message_id=${scope.target_message_id})`,
              })
              recordFactCheckAttempt({
                taskID: task.id,
                factCheckSessionID: result.sessionID,
                targetSessionID: resolvedArgs.target_session_id,
                targetAgent: resolvedArgs.target_agent,
                targetMessageID: resolvedArgs.target_message_id,
                targetMessageContentHash: resolvedArgs.target_message_content_hash,
                invokedByOrchestratorSessionID: input.agentSessionID,
                report: synthetic,
                timeStarted,
                outcome: "tool_error",
              })
              return `fact_check tool_error: ${synthetic.unresolved[0].claim}`
            }
            recordFactCheckAttempt({
              taskID: task.id,
              factCheckSessionID: result.sessionID,
              targetSessionID: resolvedArgs.target_session_id,
              targetAgent: resolvedArgs.target_agent,
              targetMessageID: resolvedArgs.target_message_id,
              targetMessageContentHash: resolvedArgs.target_message_content_hash,
              invokedByOrchestratorSessionID: input.agentSessionID,
              report: result.report,
              timeStarted,
              outcome: result.outcome,
            })
            // Surface a one-line summary in decision_log so integrity replay
            // and read_context can mention "fact-check verdict was X" without
            // having to parse the full artifact (spec §6.1.2 step 7).
            const { createDecisionLog } = await import("@/decision-log")
            createDecisionLog(task.id).append({
              phase: "fact_check",
              key: `fact_check:${resolvedArgs.target_session_id}:${resolvedArgs.target_message_id}`,
              value:
                `verdict=${result.report.overall_verdict} ` +
                `verified=${result.report.verified.length} ` +
                `corrected=${result.report.corrected.length} ` +
                `unresolved=${result.report.unresolved.length}`,
              reason: `fact-check on ${resolvedArgs.target_agent} (${resolvedArgs.reason.slice(0, 200)})`,
            })
            factCheckStepFailed = result.outcome !== "completed"
            return (
              `fact_check completed — verdict=\`${result.report.overall_verdict}\`\n\n` +
              renderFactCheckReport(result.report)
            )
          } catch (err) {
            // codex impl review §1: persist tool_error / aborted artifacts
            // too. Without this the `outcome` enum would be half-dead and
            // the orchestrator couldn't see that fact-check tried and
            // failed (vs never ran).
            //
            // codex impl review round 4 §findings-1: do NOT swallow persist
            // errors here. The happy/scope-mismatch paths let
            // recordFactCheckAttempt throw; the error-outcome path must
            // behave identically. A persist failure with a swallowed log
            // would return a "fact_check tool_error: …" string claiming
            // the artifact exists when it does not, poisoning read_context
            // / integrity replay (rule 7: no silent fallback).
            const outcome: "aborted" | "tool_error" = input.signal?.aborted ? "aborted" : "tool_error"
            const errMessage = err instanceof Error ? err.message : String(err)
            const synthetic = synthesizeToolErrorReport({
              snap: {
                messageID: resolvedArgs.target_message_id,
                contentHash: resolvedArgs.target_message_content_hash,
              },
              args: resolvedArgs,
              reason: `fact-check ${outcome}: ${errMessage}`,
            })
            recordFactCheckAttempt({
              taskID: task.id,
              factCheckSessionID: runnerSessionID ?? `(no-session:${outcome})`,
              targetSessionID: resolvedArgs.target_session_id,
              targetAgent: resolvedArgs.target_agent,
              targetMessageID: resolvedArgs.target_message_id,
              targetMessageContentHash: resolvedArgs.target_message_content_hash,
              invokedByOrchestratorSessionID: input.agentSessionID,
              report: synthetic,
              timeStarted,
              outcome,
            })
            if (outcome === "tool_error") {
              const continuationResult = continuationResultForProtocolFinalizerMiss({
                err,
                taskID: task.id,
                stage: "fact-check",
                sessionID: runnerSessionID,
                parentSessionID: input.agentSessionID,
                finalizerName: "report_fact_check_result",
                normalizedStageInput: resolvedArgs,
                pointerReason: resolvedArgs.reason,
              })
              if (continuationResult) return continuationResult
            }
            return `fact_check ${outcome}: ${errMessage}`
          }
        } finally {
          await trackStepComplete("fact_check", undefined, factCheckStepFailed)
        }
      },
    }),

    // -----------------------------------------------------------------------
    // Analyze intent — request disambiguation for ambiguous tasks.
    //
    // Lifted out of an unused free-floating IntentAnalysisAgent.analyze
    // module (audit 2026-04-25). The agent runs at the very front of the
    // pipeline (before requirements / architect) to reconstruct the user's
    // real intent from a typically-terse request, the surrounding work
    // record (decision log + prior acceptance feedback when re-entering a
    // task), and a read-only tour of the repository.
    // -----------------------------------------------------------------------

    analyze_intent: tool({
      description:
        "OPTIONAL stage agent. Reconstruct the user's real intent from a (typically " +
        "terse) request. Reads the request, the existing work record on this task " +
        "(decision log, prior acceptance rejections, refine notes when present), and " +
        "uses read-only codebase tools (read/find/search/list) to ground complexity " +
        "and scope estimates in the repo's actual shape. Output: an " +
        "IntentAnalysisResult (intent class, complexity band, extracted slots, " +
        "missing-info keys, blocker / nice clarifications, overall confidence, " +
        "one-sentence summary). When blocker clarifications are generated, this " +
        "tool surfaces them through the real question interaction path and returns " +
        "`clarified_user_request` when the operator answers. Do not ask the same " +
        "blocker again with the standalone `question` tool.\n\n" +
        "USE WHEN: terse request, ambiguous scope, multiple plausible intent classes " +
        "(feature vs refactor vs bug-fix), the user's intent might silently mislead " +
        "downstream stages, OR re-entering after operator_message / refine evidence " +
        "that may have shifted scope. If it returns " +
        "`clarified_user_request`, use that clarified request before spending " +
        "budget on requirements / architect / build. If the operator dismisses " +
        "the follow-up questions, do not invent clarified scope.\n" +
        "SKIP WHEN: the request is already explicit (concrete file path + concrete " +
        "change), OR a previous analyze_intent on this task is still valid, OR the " +
        "work is a clear single-edit fix where downstream agents have nothing to " +
        "misread.",
      inputSchema: z
        .object({
          reason: z
            .string()
            .optional()
            .describe("Why you decided to run intent analysis (first-wake / re-entry / scope change)"),
          continuation_artifact_id: StageContinuationArtifactIDField,
        })
        .strict(),
      execute: async ({ reason, continuation_artifact_id }) => {
        const task = requireTask(taskID)
        await trackStepStart("analyze_intent")
        let out
        let runnerSessionID: string | undefined
        const normalizedStageInput = {
          task: taskContinuationScope(task),
          evidence_snapshot: continuationEvidenceSnapshot({
            attachments: taskArrayField(task, "attachments"),
            design_specs: taskArrayField(task, "design_specs"),
            system_artifacts: taskArrayField(task, "system_artifacts"),
          }),
        }
        try {
          let continuation: AgentSessionContinuation | undefined
          if (continuation_artifact_id) {
            const resolvedContinuation = continuationFromArtifactOrResult({
              taskID,
              stage: "intent-analysis",
              artifactID: continuation_artifact_id,
              finalizerName: "StructuredOutput",
              expectedNormalizedStageInput: normalizedStageInput,
            })
            if ("result" in resolvedContinuation) {
              await trackStepComplete("analyze_intent")
              return resolvedContinuation.result
            }
            continuation = resolvedContinuation.continuation
          }
          runnerSessionID = continuation?.sessionID
          const { IntentAnalysisAgent } = await import("@/intent-analysis/agent")
          out = await IntentAnalysisAgent.analyze({
            request: task.request,
            title: task.title,
            taskID,
            attachments: Array.isArray(task.attachments) ? (task.attachments as any) : undefined,
            parentSessionID: input.agentSessionID,
            signal: input.signal,
            continuation,
            onStatus: () => {},
            onSessionCreated: (id) => {
              runnerSessionID = id
            },
          })
        } catch (err) {
          await trackStepComplete("analyze_intent", undefined, true)
          const continuationResult = continuationResultForProtocolFinalizerMiss({
            err,
            taskID,
            stage: "intent-analysis",
            sessionID: runnerSessionID,
            parentSessionID: input.agentSessionID,
            finalizerName: "StructuredOutput",
            normalizedStageInput,
            pointerReason: reason ?? null,
          })
          if (continuationResult) return continuationResult
          // P4 (rule 4 systemic — bundles intent_analysis abort with
          // frontend_design abort, both audit L7 + L3 same shape): write
          // decision_log so downstream agents see "intent analysis was
          // attempted but failed" instead of silently inheriting an empty
          // intent classification. The success path already writes (lines
          // 1722-1763 below); this commit closes the abort gap.
          const { createDecisionLog } = await import("@/decision-log")
          const errorReason = err instanceof Error ? err.message : String(err)
          createDecisionLog(taskID).append({
            phase: "intent_analysis",
            key: "abort_intent_analysis_failed",
            value: `Intent analysis aborted: ${errorReason.slice(0, 400)}`,
            reason: "intent_analysis_threw",
          })
          throw err
        }
        const r = out.result
        const blockers = r.clarifications.filter((c) => c.priority === "blocker")
        const nices = r.clarifications.filter((c) => c.priority === "nice")
        let clarificationAnswerText: string | undefined
        let clarifiedUserRequest: string | undefined

        // Persist intent reading into the Decision Log so downstream agents
        // (requirements / architect / integrity / build) see the upstream
        // scope_boundary / complexity / slots / clarifications via the
        // TaskContext.snapshot block. Without this the agent runs but its
        // output never reaches any downstream prompt — pure token waste.
        // Same pattern as frontend_design (rule 22, single source).
        const { createDecisionLog } = await import("@/decision-log")
        const decisionLog = createDecisionLog(taskID)
        decisionLog.append({
          phase: "intent_analysis",
          key: "intent_summary",
          value: `${r.intent_class} / ${r.complexity} / confidence=${r.confidence.toFixed(2)}. ${r.summary}`,
          reason: "Intent-analysis terminal classification for downstream stage agents.",
        })
        if (r.extracted_slots.length > 0) {
          decisionLog.append({
            phase: "intent_analysis",
            key: "intent_slots",
            value: r.extracted_slots.map((s) => `${s.key}=${s.value} (conf=${s.confidence.toFixed(2)})`).join("; "),
            reason:
              "Slots extracted from the user request — downstream REQ-N + goal decomposition should reflect these explicitly.",
          })
        }
        if (r.missing_info.length > 0) {
          decisionLog.append({
            phase: "intent_analysis",
            key: "intent_missing_info",
            value: r.missing_info.join(", "),
            reason:
              "Information judged missing from the request — downstream agents must infer from repo / decisions or flag explicitly.",
          })
        }
        if (blockers.length > 0) {
          decisionLog.append({
            phase: "intent_analysis",
            key: "intent_blocker_clarifications",
            value: blockers.map((c) => c.question).join(" | "),
            reason: "Blocker clarifications generated by intent-analysis before downstream stages.",
          })
          const { output, answers } = await Question.askAndFormat({
            sessionID: input.agentSessionID,
            questions: blockers.map(clarificationToQuestionInfo),
          })
          if (answers === null) {
            decisionLog.append({
              phase: "intent_analysis",
              key: "intent_clarification_rejected",
              value: output,
              reason: "The operator dismissed blocker follow-up questions; no clarified request was produced.",
            })
          } else {
            const answered = clarificationAnswers({ clarifications: blockers, answers })
            clarificationAnswerText = renderClarificationAnswers(answered)
            clarifiedUserRequest = buildClarifiedUserRequest({
              originalRequest: task.request,
              answers: answered,
            })
            decisionLog.append({
              phase: "intent_analysis",
              key: "intent_clarification_answers",
              value: clarificationAnswerText,
              reason: "Operator answers to intent-analysis blocker follow-up questions.",
            })
            decisionLog.append({
              phase: "intent_analysis",
              key: "intent_clarified_user_request",
              value: clarifiedUserRequest,
              reason:
                "Clarified user request for downstream Requirements/Architect/Build stages. Preserve the original request separately.",
            })
          }
        }
        if (nices.length > 0) {
          decisionLog.append({
            phase: "intent_analysis",
            key: "intent_nice_clarifications",
            value: nices.map((c) => c.question).join(" | "),
            reason:
              "Nice-to-have clarifications — downstream picks the most reasonable answer if a decision hinges on one.",
          })
        }

        await trackStepComplete("analyze_intent")

        const resultFields: Array<[string, string | string[]]> = [
          ["slots", r.extracted_slots.map((s) => `${s.key}=${s.value}`)],
          ["missing_info", r.missing_info],
          ["blocker_questions", blockers.map((c) => c.question)],
          ["nice_questions", nices.map((c) => c.question)],
        ]
        if (clarificationAnswerText) resultFields.push(["clarification_answers", clarificationAnswerText])
        if (clarifiedUserRequest) resultFields.push(["clarified_user_request", clarifiedUserRequest])

        return SubAgentProtocol.yieldResult({
          headline:
            `Intent: ${r.intent_class} / complexity=${r.complexity} / confidence=${r.confidence.toFixed(2)}. ` +
            (blockers.length > 0
              ? clarifiedUserRequest
                ? `${blockers.length} blocker clarification(s) answered — use clarified_user_request before downstream stages.`
                : `${blockers.length} blocker clarification(s) were not answered — do not invent clarified scope.`
              : `Requirements and frontend_design are available candidate tools when the full task context needs them.`),
          summary: r.summary,
          fields: resultFields,
          pointer: `intent session ${out.sessionID}; decision log keys: intent_summary${r.extracted_slots.length > 0 ? " + intent_slots" : ""}${r.missing_info.length > 0 ? " + intent_missing_info" : ""}${blockers.length > 0 ? " + intent_blocker_clarifications" : ""}${clarifiedUserRequest ? " + intent_clarified_user_request" : ""}${nices.length > 0 ? " + intent_nice_clarifications" : ""}`,
        })
      },
    }),

    frontend_research: tool({
      description:
        "OPTIONAL webpage/UI investigation publisher. Source-page-scoped brief producer: pass exactly one source page URL per fresh call, let the host prepare rendered evidence for that page, persist the brief, and call frontend_research separately only for additional page URLs. Same URL with a different focus, viewport, interaction state, component, region, fidelity risk, or missing-detail question is still the same source-page scope; consume the existing frontend_research_brief plus frontend_design handoff downstream instead of opening another frontend_research session. Do not reuse frontend_research as a repeated crawler, repair, retry, or implementation iteration tool after the same page scope's frontend_research_brief exists. When source URLs are supplied, the host prepares rendered webpage evidence before the frontend-research session; the agent then partitions that evidence into source-backed work packets for page functions, visual layout, style checks, interactions, content/data inventory, scoped layout behavior, fidelity acceptance, risks, and the Page Skeleton Blueprint that frontend_design consumes as page information architecture. For frontend replica tasks, non-desktop packets require explicit current multi-end migration authorization. It persists a frontend_research_brief/webpage_contract artifact built from small update_* result tools, not a giant terminal payload. It is NOT the frontend implementation template owner, NOT requirements, NOT architect, NOT build, NOT a route selector, and NOT final PRD/SPEC/report acceptance.",
      inputSchema: FrontendResearchInputSchema,
      execute: async ({ reason, source_urls, focus, continuation_artifact_id }) => {
        const task = requireTask(taskID)
        const dispatch = await dispatchFrontendResearchStage({
          task,
          reason,
          sourceUrls: source_urls,
          focus,
          continuationArtifactID: continuation_artifact_id,
        })
        return dispatch.result
      },
    }),

    deep_research: tool({
      description:
        "OPTIONAL deep evidence side-tool agent. Use when the task depends on multi-source external facts, current documentation, competitor/industry/API research, source maps, or PRD/SPEC/report source material that should become a durable citation bundle. For supplied webpage URLs that need functional/visual frontend analysis, `frontend_research` is a separate candidate; for implementation-template/source handoff, `frontend_design` is a separate candidate. The result is a compact research_brief artifact plus bundle paths and may include subpage_research_tasks for independent follow-up deep research. It is NOT a workflow step, NOT a route selector, NOT requirements, NOT architect, NOT build, and NOT a acceptance path.",
      inputSchema: DeepResearchInputSchema,
      execute: async ({ reason, target_deliverable, source_urls, focus, continuation_artifact_id }) => {
        const task = requireTask(taskID)
        const dispatch = await dispatchDeepResearchStage({
          task,
          reason,
          targetDeliverable: target_deliverable,
          sourceUrls: source_urls,
          focus,
          continuationArtifactID: continuation_artifact_id,
        })
        return dispatch.result
      },
    }),

    explore: tool({
      description:
        "Read-only repository investigation dispatcher. Runs the registered explore subagent as an explicit " +
        "orchestrator tool so workflow investigation does not get routed through build. Use this for focused " +
        "file, symbol, architecture, or dependency facts needed before requirements or implementation. The " +
        "result is returned to this orchestrator turn and persisted to phase=explore decision log plus an " +
        "exploration artifact for later wakes. Do not use for implementation or file edits.",
      inputSchema: z.object({
        question: z
          .string()
          .min(1)
          .describe("The focused repository question the explore subagent must answer with file/symbol evidence."),
        reason: z.string().optional().describe("Why this repository investigation is needed before the next stage."),
      }),
      execute: async ({ question, reason }) => {
        const task = requireTask(taskID)
        const model = await resolveAgentModelRef("explore", { taskID, sessionID: input.agentSessionID })
        const promptLines = [
          "# Repository Investigation",
          "",
          "You are the Explore subagent. Answer the focused repository question using read-only repository evidence.",
          "Do not modify files, run write-oriented commands, create reports on disk, or delegate to another agent.",
          "Return concrete findings as plain text in your final assistant turn — exact file paths, symbols, and tool evidence.",
          "Tool calls (memory.save and any other tool) are a side channel the orchestrator does NOT read back; only your last assistant turn's text is delivered.",
          "After your tools have returned, continuing tool-result echoes are the same task continuing — not new user requests, not system pings. Keep working until you have emitted your text answer, then stop.",
          "",
          `## Task`,
          task.title,
          "",
          renderUserRequestSection({ heading: "## Original Request", request: task.request, taskID }),
          "",
        ]
        if (reason && reason.trim().length > 0) {
          promptLines.push("## Reason", reason.trim(), "")
        }
        promptLines.push("## Question", question.trim())
        const prompt = promptLines.join("\n")

        const exploreResult = await ExploreAgent.run({
          parentSessionID: input.agentSessionID,
          taskID,
          sessionTitle: `Explore: ${question.slice(0, 80)}`,
          model,
          signal: input.signal,
          prompt,
          toolSwitches: {
            bash: false,
            edit: false,
            write: false,
            task: false,
            todowrite: false,
            todoread: false,
          },
        })
        const resultText = exploreResult.finalText.trim()
        if (resultText.length === 0) {
          throw new Error(`explore: subagent returned no text result (sessionID=${exploreResult.sessionID})`)
        }

        const now = Date.now()
        const decisionLog = createDecisionLog(taskID)
        decisionLog.append({
          phase: "explore",
          key: `repo_investigation_${exploreResult.sessionID}`,
          value: resultText,
          reason: reason?.trim() || question.trim(),
        })
        Database.use((db) => {
          db.insert(EngineArtifactTable)
            .values({
              id: Identifier.ascending("artifact"),
              task_id: taskID,
              kind: "exploration",
              label: "explore",
              payload: {
                question: question.trim(),
                reason: reason?.trim() || null,
                session_id: exploreResult.sessionID,
                result: resultText,
              },
              time_created: now,
              time_updated: now,
            })
            .run()
        })

        return SubAgentProtocol.yieldResult({
          headline: "Explore complete. Repository findings were persisted under phase=explore.",
          summary: resultText,
          fields: [
            ["session", exploreResult.sessionID],
            ["question", question.trim()],
          ],
          pointer: `read_context scope=decisions; decision_log phase=explore key=repo_investigation_${exploreResult.sessionID}`,
        })
      },
    }),

    // -----------------------------------------------------------------------
    // Per-goal tools — Orchestrator decides when to call each
    // -----------------------------------------------------------------------

    add_goal: tool({
      description:
        "Append one new executable goal to the current workflow graph when the latest operator message " +
        "or current task evidence adds a concrete in-scope surface that is not covered by any existing goal. " +
        "Use this instead of `modify_goal` when the work is a new capability/surface, and instead of " +
        "`architect` when the existing graph boundary is still valid and only one well-scoped goal is missing. " +
        "Do not use for broad re-decomposition, vague scope expansion, or follow-up work outside the current " +
        "task contract — use `architect`, `question`, or `propose_task` from evidence in those cases. " +
        "After this returns, dispatch `build({ goalID })` when dependencies are satisfied.",
      inputSchema: AddGoalInputSchema,
      execute: async ({ goal, reason }) => {
        const task = requireTask(taskID)
        if (task.kind !== "workflow") {
          return `add_goal: rejected because task ${taskID} is kind=${task.kind}; direct build tasks do not own a workflow goal graph.`
        }
        const activeSpec = findActiveSpecForTask(taskID)
        if (!activeSpec) {
          return "add_goal: no active requirements/architect spec snapshot. Run requirements and architect before appending goals."
        }
        const activePlan = findActivePlanForTask(taskID)
        const knownGoalIDs = new Set(listGoals(taskID).map((row) => row.id))
        const unknownDeps = (goal.depends_on ?? []).filter((dep) => !knownGoalIDs.has(dep))
        if (unknownDeps.length > 0) {
          return (
            `add_goal: rejected because depends_on references unknown goal id(s): ${unknownDeps.join(", ")}. ` +
            `Use durable engine_goal.id values from the current task snapshot.`
          )
        }

        const now = Date.now()
        const durableGoalID = Identifier.ascending("goal")
        const added = Database.transaction((db) =>
          appendGoalToActiveGraph(db, {
            taskID,
            specSnapshotID: activeSpec.id,
            planVersionID: activePlan?.id ?? null,
            goal: {
              goalID: durableGoalID,
              title: goal.title,
              objective: goal.objective,
              acceptance_specs: (goal.acceptance_specs as AcceptanceSpec[]).map((spec) => ({
                ...spec,
                goal_id: durableGoalID,
              })),
              owned_paths: goal.owned_paths,
              depends_on: goal.depends_on,
              kind: goal.kind,
              requirement_ids: goal.requirement_ids,
              priority: goal.priority,
              source: "system",
              metadata: {
                add_goal_reason: reason,
                operator_instruction_goal: true,
              },
            },
            now,
          }),
        )

        createDecisionLog(taskID).append({
          phase: "orchestrator",
          key: `added_goal_${added.id}`,
          value:
            `Added goal ${added.id}: ${goal.title}\n\n` +
            `Reason: ${reason}\n\n` +
            `Objective: ${goal.objective}\n\n` +
            `Dependencies: ${(goal.depends_on ?? []).join(", ") || "(none)"}`,
          reason: "add_goal",
        })
        EngineProtocol.emit(
          EngineEvent.TaskUpdated,
          {
            taskID,
            status: deriveTaskStatus(requireTask(taskID)),
            summary: `Goal ${added.id} added by Orchestrator`,
          },
          { source: "orchestrator.add_goal" },
        )

        return SubAgentProtocol.yieldResult({
          headline: `Goal added: ${added.id} ${goal.title}`,
          fields: [
            ["goal_id", added.id],
            ["order", `G${added.orderIndex + 1}`],
            ["spec_snapshot_id", activeSpec.id],
            ["plan_version_id", activePlan?.id ?? "(no active plan yet)"],
            ["plan_node_id", added.planNodeID ?? "(no active plan node yet)"],
            ["depends_on", (goal.depends_on ?? []).join(", ") || "(none)"],
          ],
          pointer: `current task snapshot; then build({ goalID: "${added.id}" }) when dependencies are passed`,
        })
      },
    }),

    modify_goal: tool({
      description:
        "Modify an existing goal's contract only to clarify or tighten acceptance for a surface already owned " +
        "by that goal. Use when eval or integrity history shows acceptance_specs need refinement, or owned_paths " +
        "need adjustment, without adding a new capability, new surface, or broader task scope. Scope expansion " +
        "must route through propose_task or question instead. The submitted shape is schema-validated before execution.",
      inputSchema: ModifyGoalInputSchema,
      execute: async (input) => {
        if (!isObjectRecord(input) || typeof input.goalID !== "string" || input.goalID.trim().length === 0) {
          return 'Error: modify_goal requires a non-empty string "goalID"; database unchanged.'
        }
        const goalID = input.goalID
        const updates = input.updates
        requireTask(taskID)
        const dbGoals = listGoals(taskID)
        const goal = dbGoals.find((g) => g.id === goalID)
        if (!goal) return `Goal ${goalID} not found.`
        const liveGoalRun = findLiveGoalRunByGoalID(goalID)
        if (liveGoalRun) {
          return (
            `Error: modify_goal refused because goal ${goalID} already has live goal_run ${liveGoalRun.id} ` +
            `(status=${liveGoalRun.status}, session ${liveGoalRun.session_id ?? "n/a"}). ` +
            `Wait for terminal refill evidence or cancel the live attempt before changing the goal contract.`
          )
        }
        const liveOwner = findLiveBuildOwnershipByGoal({ taskID, goalID })
        if (liveOwner) {
          return (
            `Error: modify_goal refused because goal ${goalID} is currently owned by live build tool ` +
            `${liveOwner.payload.tool_part_id} (session ${liveOwner.payload.child_session_id}, ownership ${liveOwner.ownershipID}). ` +
            `Wait for that build result before changing the goal contract.`
          )
        }

        // Deep-equality no-op detection (rule 2 + rule 7) via the
        // computeContractFieldChanges helper: only fields whose submitted
        // value actually differs from the persisted value are counted as
        // changed. The orchestrator LLM was previously using modify_goal
        // as a side-channel to trigger phase=retry feedback when build
        // attempts failed for unrelated reasons (e.g. missing terminal
        // tool call) — passing the SAME acceptance_specs back in still
        // wrote a "Goal contract changed... re-read acceptance_specs"
        // entry into the decision log, polluting the next build agent's
        // prior-attempt context.
        const setValues = computeContractFieldChanges(
          updates as Record<string, unknown>,
          goal as unknown as Record<string, unknown>,
        )

        const changed = Object.keys(setValues)
        const contractChanged = changed.length > 0
        const statusReset =
          contractChanged && (goalStatusByID(goal.id) === "passed" || goalStatusByID(goal.id) === "failed")

        if (contractChanged) {
          setValues.time_updated = Date.now()
          const { EngineGoalTable } = await import("@/engine/engine.sql")
          Database.use((db) => {
            db.update(EngineGoalTable)
              .set(setValues as any)
              .where(eq(EngineGoalTable.id, goalID))
              .run()
          })
        }

        let abortedRuns = 0
        let supersededTipID: string | undefined
        if (statusReset) {
          const { listGoalRunsForTask } = await import("@/engine/store")
          const { startNewAttempt } = await import("@/engine/persist")
          const { LIVE_GOAL_RUN_STATUSES } = await import("@/engine/catalog")
          // 1. Abort only LIVE goal_runs (queued/accepted/planning/running/
          //    evaluating/blocked). `completed` is never reset — its
          //    verification evidence is load-bearing, and the parent goal
          //    should not regress from passed to pending via a
          //    completed-to-aborted flip.
          const toAbort = listGoalRunsForTask(taskID).filter(
            (row) => row.goal_id === goalID && LIVE_GOAL_RUN_STATUSES.includes(row.status),
          )
          for (const row of toAbort) {
            updateGoalRun(row.id, { status: "aborted", error: "contract modified" })
          }
          abortedRuns = toAbort.length
          // 2. Record retry intent under reason=modify_contract. The
          //    terminal tip remains lifecycle truth; the orchestrator reads
          //    the intent fact and explicitly chooses a follow-up build.
          //    Idempotent if the tip is already superseded.
          const result = startNewAttempt({
            goalID,
            reason: "modify_contract",
            feedback: {
              value:
                `Goal contract changed by modify_goal. Fields updated: ${changed.join(", ")}. ` +
                `The prior attempt ran against an outdated contract — re-read acceptance_specs, ` +
                `owned_paths, the Architect Contract Graph, and the dependency context before re-implementing. ` +
                `Do not assume prior code satisfies the new contract.`,
              reason: `modify_goal: ${changed.length} contract field(s) updated (${changed.join(", ")})`,
            },
          })
          supersededTipID = result.supersededTipID
        }

        const resetSuffix = statusReset
          ? ` (retry intent recorded; current status remains ${goalStatusByID(goal.id)})`
          : ""
        const abortSuffix = abortedRuns > 0 ? `, ${abortedRuns} prior goal_run(s) marked aborted` : ""
        const supersedeSuffix = supersededTipID ? `, tip ${supersededTipID} superseded` : ""

        // Contract edits preserve the durable workspace pointer. The next
        // build reads the retry decision-log feedback and recovers the same
        // verified directory per the 2026-06-25 worktree reuse contract.
        return `Goal ${goalID} modified: ${changed.join(", ") || "(no changes)"}${resetSuffix}${abortSuffix}${supersedeSuffix}`
      },
    }),

    complete_goal: tool({
      description:
        "Mark one existing workflow goal completed when current task evidence proves it is already satisfied or " +
        "no longer needs build work, while the goal should remain in the graph for dependency/traceability purposes. " +
        "This writes an explicit goal_run_attempt completion fact; do not use it to hide failed or unverified work.",
      inputSchema: CompleteGoalInputSchema,
      execute: async ({ goalID, reason }) => {
        requireTask(taskID)
        const goal = listGoals(taskID).find((row) => row.id === goalID)
        if (!goal) return `Goal ${goalID} not found.`
        const blocker = goalMutationBlockedByLiveWork({ taskID, goalID, action: "complete_goal" })
        if (blocker) return blocker

        const beforeStatus = goalStatusByID(goalID)
        const row = completeGoal({ goalID, reason })
        const afterStatus = goalStatusByID(goalID)
        createDecisionLog(taskID).append({
          phase: "orchestrator",
          key: `completed_goal_${goalID}`,
          value:
            `Marked goal ${goalID} complete.\n\n` +
            `Reason: ${reason}\n\n` +
            `Previous status: ${beforeStatus}\n` +
            `Goal run: ${row.id}`,
          reason: "complete_goal",
        })

        return SubAgentProtocol.yieldResult({
          headline:
            beforeStatus === "passed"
              ? `Goal already complete: ${goalID} ${goal.title}`
              : `Goal marked complete: ${goalID} ${goal.title}`,
          fields: [
            ["goal_id", goalID],
            ["goal_run_id", row.id],
            ["previous_status", beforeStatus],
            ["current_status", afterStatus],
            ["reason", reason],
          ],
          pointer: "current task snapshot; continue scheduling from dependency facts",
        })
      },
    }),

    delete_goal: tool({
      description:
        "Delete one obsolete goal from the current workflow graph when task evidence proves the goal is out of " +
        "scope, redundant, or replaced by a corrected graph. This reuses the engine goal deletion writer, which " +
        "also prunes dependent goal and plan-node references. Do not use it while a goal has live work.",
      inputSchema: DeleteGoalInputSchema,
      execute: async ({ goalID, reason }) => {
        requireTask(taskID)
        const goal = listGoals(taskID).find((row) => row.id === goalID)
        if (!goal) return `Goal ${goalID} not found.`
        const blocker = goalMutationBlockedByLiveWork({ taskID, goalID, action: "delete_goal" })
        if (blocker) return blocker

        const result = deleteGoalRow(goalID)
        createDecisionLog(taskID).append({
          phase: "orchestrator",
          key: `deleted_goal_${goalID}`,
          value:
            `Deleted goal ${goalID}: ${goal.title}\n\n` +
            `Reason: ${reason}\n\n` +
            `Deleted goals: ${result.deletedGoals}\n` +
            `Deleted plan nodes: ${result.deletedPlanNodes}\n` +
            `Pruned goal dependency refs: ${result.prunedGoalDependencyRefs}\n` +
            `Pruned plan-node dependency refs: ${result.prunedPlanNodeDependencyRefs}`,
          reason: "delete_goal",
        })
        EngineProtocol.emit(
          EngineEvent.TaskUpdated,
          {
            taskID,
            status: deriveTaskStatus(requireTask(taskID)),
            summary: `Goal ${goalID} deleted by Orchestrator`,
          },
          { source: "orchestrator.delete_goal" },
        )

        return SubAgentProtocol.yieldResult({
          headline: `Goal deleted: ${goalID} ${goal.title}`,
          fields: [
            ["goal_id", goalID],
            ["deleted_goals", String(result.deletedGoals)],
            ["deleted_plan_nodes", String(result.deletedPlanNodes)],
            ["pruned_goal_dependency_refs", String(result.prunedGoalDependencyRefs)],
            ["pruned_plan_node_dependency_refs", String(result.prunedPlanNodeDependencyRefs)],
            ["reason", reason],
          ],
          pointer: "current task snapshot; continue scheduling from the updated goal graph",
        })
      },
    }),

    query_failed_goals: tool({
      description:
        "Query all currently failed goals with their latest acceptance info. Returns one block per failed goal (acceptance_specs truncated, only latest run). Use BEFORE re-running build on a failed goal to understand per-goal failure reasons.",
      inputSchema: z.object({}),
      execute: async () => {
        const dbGoals = listGoals(taskID)
        const failed = dbGoals.filter((g) => goalStatusByID(g.id) === "failed")
        if (failed.length === 0) return "No failed goals."
        const { listGoalRunsForTask, findAcceptanceByGoalRun } = await import("@/engine/store")
        const goalRuns = listGoalRunsForTask(taskID)
        const sections: string[] = [`## Failed Goals (${failed.length})`]
        const ACCEPTANCE_SPEC_CAP = 300
        const ACCEPTANCE_FILES_CAP = 10
        for (const goal of failed) {
          const label = `#G${goal.order_index + 1}V${getGoalRetryCount(goal.id) + 1}`
          sections.push(`\n### ${label} ${goal.id}: ${goal.title}`)
          sections.push(
            `- acceptance_specs:\n${renderSpecsAsText((goal.acceptance_specs ?? []) as AcceptanceSpec[]).slice(0, ACCEPTANCE_SPEC_CAP)}`,
          )
          if (goal.owned_paths?.length) sections.push(`- owned_paths: ${goal.owned_paths.join(", ")}`)
          // listGoalRunsForTask is desc by time_created; first match is latest.
          const latestGr = goalRuns.find((gr) => gr.goal_id === goal.id)
          if (latestGr) {
            const acceptance = findAcceptanceByGoalRun(latestGr.id)
            if (acceptance) {
              sections.push(`- acceptance summary: ${acceptance.summary}`)
              const diffs = (acceptance.result as any)?.diffs as Array<{ file: string }> | undefined
              if (diffs?.length) {
                const shown = diffs
                  .slice(0, ACCEPTANCE_FILES_CAP)
                  .map((f) => f.file)
                  .join(", ")
                const more =
                  diffs.length > ACCEPTANCE_FILES_CAP ? ` (+${diffs.length - ACCEPTANCE_FILES_CAP} more)` : ""
                sections.push(`- acceptance files: ${shown}${more}`)
              }
            } else {
              sections.push(`- acceptance: none`)
            }
            sections.push(`- goal_run status: ${latestGr.status}`)
            sections.push(`- current implementation version: ${label}`)
            if (latestGr.error) {
              sections.push(`- goal_run error: ${latestGr.error}`)
              if (
                latestGr.error.includes("report_build_result") ||
                latestGr.error.includes("missing_terminal_report")
              ) {
                sections.push(
                  `- terminal report hint: retry this goal with explicit report_build_result(files_changed[]) instructions. ` +
                    `Any retained files under .opencorvus/r are diagnostic worktree evidence, not primary workspace pollution; ` +
                    `do not open a new workflow task solely because those diagnostic files exist.`,
                )
              }
            }
          } else {
            sections.push(`- no goal_run found`)
          }
        }
        const result = sections.join("\n")
        SubAgentProtocol.report(result, "tool:query_failed_goals")
        return result
      },
    }),

    read_context: tool({
      description:
        "Drill into persisted audit context that is not already rendered in the scheduler prompt. Use only for integrity_history, fact_checks, or decisions evidence; do not use this as normal task-state refresh.",
      inputSchema: z.object({
        scope: z
          .enum(["decisions", "integrity_history", "fact_checks"])
          .describe("Required persisted audit surface to drill into"),
      }),
      execute: async ({ scope }) => {
        requireTask(taskID)
        const output = createReadContextOutput()
        // This tool intentionally excludes ordinary scheduler state. Current
        // task/goal/research/active-run facts are rendered on every wake by
        // renderTaskDescription() and the latest-run context block in
        // orchestrator/agent.ts. Keeping those facts here would recreate a
        // second task-state refresh path.

        if (scope === "integrity_history") {
          const activeSpec = findActiveSpecForTask(taskID)
          const { buildSpecSnapshotLineage, buildIntegrityRootHistory, renderIntegrityRootHistoryBlock } = await import(
            "@/integrity"
          )
          const { findLatestIntegrityArtifactMissingStatus } = await import("@/engine/store")
          const missingStatus = findLatestIntegrityArtifactMissingStatus(taskID)
          if (missingStatus) {
            output.add(
              `\n## Integrity artifact status`,
              `- session: ${missingStatus.sessionID}`,
              `- status: artifact_missing`,
              `- recorded_at: ${new Date(missingStatus.emittedAt).toISOString()}`,
              `- detail: the completed integrity session has no durable integrity_attempt artifact yet; the prior artifact is not the current result.`,
              missingStatus.error ? `- error: ${missingStatus.error}` : "",
              {
                pointer: "read_context scope=integrity_history artifact status",
                sectionCap: READ_CONTEXT_ARTIFACT_STATUS_CHAR_CAP,
              },
            )
          }
          if (activeSpec) {
            const lineage = buildSpecSnapshotLineage({
              taskID,
              activeSpecSnapshotID: activeSpec.id,
            })
            const history = buildIntegrityRootHistory({
              taskID,
              specSnapshotLineage: lineage,
            })
            if (history.totalAttempts > 0) {
              const latest = history.attempts.at(-1)
              if (latest) {
                const teamReportMarkdown = latest.teamReportMarkdown ?? ""
                const latestLines = [
                  `\n## Integrity (latest)`,
                  `- verdict: ${latest.verdict ?? "unknown"} — issues=${latest.blockingFindings.length} corrections=${latest.requiredRepairs.length} missing=${latest.unresolvedDisagreements.length} (spec snapshot lineage)`,
                ]
                if (teamReportMarkdown) {
                  latestLines.push(
                    "",
                    "Team report excerpt:",
                    readContextTrimText(
                      teamReportMarkdown,
                      `integrity_attempt artifact ${latest.artifactID}`,
                      READ_CONTEXT_INTEGRITY_REPORT_CHAR_CAP,
                    ),
                  )
                }
                output.add(latestLines.join("\n"), {
                  pointer: `integrity_attempt artifact ${latest.artifactID}`,
                  sectionCap: READ_CONTEXT_INTEGRITY_LATEST_CHAR_CAP,
                })
              }
              output.add(renderIntegrityRootHistoryBlock(history), {
                pointer: "read_context scope=integrity_history",
                sectionCap: READ_CONTEXT_INTEGRITY_HISTORY_DEDICATED_CHAR_CAP,
              })
            }
          }
        }

        if (scope === "decisions") {
          const { createDecisionLog, DECISION_LOG_PROMPT_LIMIT } = await import("@/decision-log")
          const log = createDecisionLog(taskID)
          // Architecture review history gets its own section with its own
          // budget. Reviews fire frequently (one per goal build at the
          // most), so without isolation they would crowd architect /
          // requirements / intent decisions out of the latest-N window.
          // Surface the latest 5 review summaries — enough to spot a
          // recurring issue across consecutive reviews (the cumulative
          // signal that drives architect re-run / fail_task per
          // orchestrator-core.txt's repair ladder).
          const reviewSection = log.phasePromptSection("review", "Architecture review history", { limit: 5 })
          if (reviewSection)
            output.add(reviewSection, {
              pointer: "read_context scope=decisions review history",
              sectionCap: READ_CONTEXT_DECISION_REVIEW_CHAR_CAP,
            })
          const section = log.toPromptSection({
            limit: DECISION_LOG_PROMPT_LIMIT,
            excludePhases: ["review"],
          })
          if (section)
            output.add(section, {
              pointer: "read_context scope=decisions",
              sectionCap: READ_CONTEXT_DECISION_GENERAL_CHAR_CAP,
            })
        }

        if (scope === "fact_checks") {
          // Fact-check attempts (one-line per row) — fact-check agent contract
          // §6.1.2 step 7. Integrity replay reads this same artifact stream
          // via listFactCheckAttempts; surfacing summaries in read_context
          // gives the orchestrator LLM a quick "what was already verified"
          // view without re-dispatching fact_check.  Bounded: latest 5 per
          // task to mirror the review-history cap.
          const { listFactCheckAttempts } = await import("@/fact-check/persist")
          const fcRows = listFactCheckAttempts(taskID)
          if (fcRows.length > 0) {
            const latest = fcRows.slice(0, 5)
            const omitted = fcRows.length - latest.length
            const header =
              omitted > 0
                ? `\n## Fact-check attempts (latest ${latest.length} of ${fcRows.length}; ${omitted} older omitted)`
                : `\n## Fact-check attempts (${latest.length})`
            output.add(header, { pointer: "read_context scope=fact_checks" })
            for (const row of latest) {
              const r = row.payload.report
              output.add(
                `- [${r.overall_verdict}] target=\`${row.payload.target_agent}\` ` +
                  `session=\`${row.payload.target_session_id.slice(0, 16)}…\` ` +
                  `verified=${r.verified.length} corrected=${r.corrected.length} ` +
                  `unresolved=${r.unresolved.length} ` +
                  `(${row.payload.outcome})`,
                {
                  pointer: "read_context scope=fact_checks",
                  sectionCap: READ_CONTEXT_FACT_CHECK_ATTEMPT_CHAR_CAP,
                },
              )
            }
          }
        }

        const result = output.result()
        // Telemetry: read_context is structurally bounded by the per-section
        // caps above, but if a future change blows through the budget the
        // protocol layer surfaces it instead of letting it slip silently.
        SubAgentProtocol.report(result, "tool:read_context")
        return result
      },
    }),

    complete_task: tool({
      description:
        "Terminal task lifecycle decision: mark the task completed from the latest post-build pass integrity_attempt evidence. " +
        "Call this only after integrity returns verdict=pass, phase=post_build, and an integrity_attempt_id. " +
        "The tool rejects missing, stale, wrong-phase, or non-pass evidence without mutating the task.",
      inputSchema: CompleteTaskInputSchema,
      execute: async ({ integrity_attempt_id, summary }, options) => {
        requireOrchestratorToolExecutionContext(options, "complete_task")
        const task = requireTask(taskID)
        const taskStatus = deriveTaskStatus(task)
        if (isTaskTerminal(task)) {
          return `complete_task rejected: task ${taskID} is already terminal with status=${taskStatus}.`
        }
        const activeSpec = findActiveSpecForTask(taskID)
        if (!activeSpec) {
          return `complete_task rejected: task ${taskID} has no active spec snapshot. Run architect and integrity before completing.`
        }
        const latest = findLatestIntegrityAttemptArtifact({
          taskID,
          specSnapshotID: activeSpec.id,
          phase: "post_build",
        })
        if (!latest) {
          return (
            `complete_task rejected: no post_build integrity_attempt exists for ` +
            `task=${taskID} spec_snapshot_id=${activeSpec.id}.`
          )
        }
        if (latest.artifactID !== integrity_attempt_id) {
          return (
            `complete_task rejected: integrity_attempt_id=${integrity_attempt_id} is not the latest ` +
            `post_build integrity attempt for task=${taskID} spec_snapshot_id=${activeSpec.id}; latest=${latest.artifactID}.`
          )
        }
        const verdict = integrityAttemptVerdict(latest)
        if (verdict !== "pass") {
          return (
            `complete_task rejected: latest post_build integrity_attempt=${latest.artifactID} ` +
            `has verdict=${verdict ?? "unknown"}, not pass.`
          )
        }

        const cleanedSummary = summary?.trim()
        const terminalSummary =
          cleanedSummary && cleanedSummary.length > 0
            ? cleanedSummary
            : `Task completed from post-build integrity_attempt ${integrity_attempt_id}`
        await terminalTask(task, { status: "completed", error: null, time_completed: Date.now() }, terminalSummary, {
          projectDir: taskPrimaryProjectRoot(taskID, { activeProjectID: Instance.project.id }),
        })

        const cleaned = await cleanupTerminalGoalWorkspaces("complete_task")
        const { interruptTaskLoop } = await import("@/orchestrator/loop")
        interruptTaskLoop(taskID, "task completed")
        return `Task ${taskID} completed from integrity_attempt ${integrity_attempt_id}.${cleaned > 0 ? ` (${cleaned} goal worktree(s) cleaned)` : ""}`
      },
    }),

    fail_task: tool({
      description:
        "Terminal task lifecycle decision: mark the task as failed when no responsible same-task repair remains for evidence the orchestrator can see. " +
        "Typical triggers: (a) integrity history shows >= 3 consecutive rounds with the same persistent blocking root AND modify_goal / architect / question have already been tried inside this task for the same root; " +
        "(b) a hard external blocker the repository cannot supply, such as missing credentials the user already declined to provide or unavailable hardware. " +
        "Not for: a single non-pass integrity round, a transient build error, or a guess that the task is hopeless without integrity evidence. " +
        "Pair with a concrete history excerpt in the error field, including the persistent-root label from read_context Integrity history.",
      inputSchema: z.object({
        error: z.string().describe("Why the task failed"),
      }),
      execute: async ({ error }, options) => {
        requireOrchestratorToolExecutionContext(options, "fail_task")
        const { cleaned } = await failCurrentTask({ error, cleanupReason: "fail_task" })
        return `Task ${taskID} failed: ${error}${cleaned > 0 ? ` (${cleaned} goal worktree(s) cleaned)` : ""}`
      },
    }),

    cancel_task: tool({
      description:
        "Cancel the task immediately. Use when the user explicitly asks to stop or abandon the current work.",
      inputSchema: z.object({
        reason: z.string().describe("Why you are cancelling the task"),
      }),
      execute: async ({ reason }) => {
        await EngineService.cancelTask(taskID)
        return `Task ${taskID} cancelled. Reason: ${reason}`
      },
    }),

    retry_task: tool({
      description: "Retry the same task when the operator wants a fresh scheduling pass from the latest evidence.",
      inputSchema: z.object({
        reason: z.string().describe("Why you are retrying the task"),
      }),
      execute: async ({ reason }) => {
        await EngineService.retryTask(taskID)
        return `Task ${taskID} retried. Reason: ${reason}`
      },
    }),

    inject_operator_message: tool({
      description:
        "Read the latest already-recorded operator message for this orchestrator wake. This does not create another task message and does not resume a child executor/build session; use build({ goalID, request }) for build retry/continuation.",
      inputSchema: z.object({
        reason: z.string().describe("Why this operator message should be injected into the current execution"),
      }),
      execute: async ({ reason }) => {
        const message = input.operatorMessage
        if (!message) {
          return "No operator message is available on this trigger."
        }
        const latest = message.text.trim()
        if (!latest) {
          return "No operator message is available on this trigger."
        }
        const lines = [
          `Operator message is already recorded on the task root session. Reason: ${reason}.`,
          message.source ? `source=${message.source}` : "",
          message.messageID ? `messageID=${message.messageID}` : "",
          message.target
            ? `target=${JSON.stringify({
                kind: message.target.kind,
                sessionID: message.target.sessionID,
                ...(message.target.goalID ? { goalID: message.target.goalID } : {}),
              })}`
            : "",
          "",
          latest,
          message.attachmentSummary ? `\n${message.attachmentSummary}` : "",
        ].filter((line) => line.length > 0)
        return lines.join("\n")
      },
    }),

    respond_agent_coordination: tool({
      description:
        "Answer one pending worker-to-orchestrator coordination request. This is the only orchestrator path for scheduler guidance that continues/cancels a worker, asks the user through a real interaction, or fails the task through a terminal lifecycle event; it requires request_id and writes visible request/response/action artifacts before executing the bound side effect.",
      inputSchema: z
        .object({
          request_id: z.string().min(1).describe("Pending agent_coordination_request artifact id."),
          decision: z
            .enum(["continue", "cancel_worker", "redispatch", "fail_task", "ask_user"])
            .describe(
              "continue appends a visible message to the requesting worker session after runtime-contract validation; cancel_worker aborts the requesting worker; ask_user opens a real task interaction; fail_task marks the task failed through the terminal lifecycle helper; redispatch is valid only when the request's worker kind has a concrete stage/tool dispatcher binding that executes a visible action. Generic same-kind session redispatch is rejected and keeps the request pending.",
            ),
          message: z
            .string()
            .optional()
            .describe(
              "Visible guidance for continue, question text for ask_user when questions is omitted, or failure detail for fail_task.",
            ),
          questions: z
            .array(
              z.object({
                question: z.string().min(1).describe("The complete question text to show the user."),
                header: z.string().min(1).describe("Short label used as a chip/title."),
                options: z
                  .array(
                    z.object({
                      label: z.string().min(1).describe("Display text."),
                      description: z.string().min(1).describe("Explanation of this choice."),
                    }),
                  )
                  .default([]),
                multiple: z.boolean().optional(),
                custom: z.boolean().optional(),
              }),
            )
            .min(1)
            .max(4)
            .optional()
            .describe(
              "Concrete user questions for decision=ask_user. Omit to ask one free-text question from message or reason.",
            ),
          reason: z.string().min(1).describe("Why this is the correct scheduling decision."),
        })
        .strict(),
      execute: async ({ request_id, decision, message, questions, reason }, options) => {
        const toolExecution = await requireTaskOrchestratorToolExecutionContext(options, "respond_agent_coordination", {
          taskID,
          agentSessionID: input.agentSessionID,
        })
        const responseAudit = {
          orchestratorSessionID: toolExecution.orchestratorSessionID,
          orchestratorMessageID: toolExecution.orchestratorMessageID,
          orchestratorToolCallID: toolExecution.toolCallID,
          orchestratorToolPartID: toolExecution.toolPartID,
        }
        const request = requireAgentCoordinationRequestForResponse({ taskID, requestID: request_id })
        const guidance = message?.trim()
        if (request.payload.status === "responded") {
          const response = await createAgentCoordinationResponse({
            taskID,
            requestID: request.payload.request_id,
            ...responseAudit,
            decision,
            reason,
            ...(guidance ? { message: guidance } : {}),
            ...(decision === "redispatch"
              ? { redispatchBinding: redispatchBindingForAgentCoordinationReplay({ request }) }
              : {}),
          })
          const replayResult = replayedAgentCoordinationActionResult({ taskID, response })
          if (replayResult) return replayResult
        }

        if (decision === "continue") {
          const target = await validateAgentCoordinationContinueTarget({ taskID, request })
          const workerMessageText = [
            "# Orchestrator Coordination Response",
            "",
            `request_id: ${request.payload.request_id}`,
            `decision: ${decision}`,
            `reason: ${reason.trim()}`,
            "",
            "## Original Worker Request",
            request.payload.summary,
            "",
            request.payload.details,
            "",
            "## Guidance",
            guidance && guidance.length > 0
              ? guidance
              : "Continue from the current task evidence and resolve the requested scheduling issue under the existing worker contract.",
          ].join("\n")
          const descriptor =
            target.runtimeContract?.identity.workerTurnDescriptorID &&
            target.runtimeContract.identity.workerTurnDescriptorHash
              ? {
                  id: target.runtimeContract.identity.workerTurnDescriptorID,
                  hash: target.runtimeContract.identity.workerTurnDescriptorHash,
                }
              : undefined
          const response = await createAgentCoordinationResponse({
            taskID,
            requestID: request.payload.request_id,
            ...responseAudit,
            decision,
            reason,
            ...(guidance ? { message: guidance } : {}),
          })
          const replayResult = replayedAgentCoordinationActionResult({ taskID, response })
          if (replayResult) return replayResult
          let workerMessage: Awaited<ReturnType<typeof SessionPrompt.prompt>>
          let workerMessageIDForFailure: string | undefined
          try {
            const action = findAgentCoordinationAction({
              taskID,
              actionID: response.payload.action_id,
            })
            if (!action) {
              throw new Error(`agent coordination response ${response.payload.response_id} has no action row`)
            }
            if (action.payload.status !== "pending") {
              throw new Error(`agent coordination action ${response.payload.action_id} is ${action.payload.status}`)
            }
            const recordedWorkerMessageID = recordedAgentCoordinationWorkerMessageID(action)
            if (recordedWorkerMessageID) {
              workerMessageIDForFailure = recordedWorkerMessageID
              workerMessage = await requireAgentCoordinationWorkerMessage({
                sessionID: request.payload.session_id,
                messageID: recordedWorkerMessageID,
                actionID: response.payload.action_id,
              })
            } else {
              const workerMessageID = agentCoordinationWorkerMessageID(response.payload.action_id)
              const workerMessagePartID = agentCoordinationWorkerMessagePartID(response.payload.action_id)
              const existingWorkerMessage = await findAgentCoordinationWorkerMessage({
                sessionID: request.payload.session_id,
                messageID: workerMessageID,
              })
              if (existingWorkerMessage) {
                workerMessage = existingWorkerMessage
                workerMessageIDForFailure = existingWorkerMessage.info.id
                await recordAgentCoordinationActionProgress({
                  taskID,
                  actionID: response.payload.action_id,
                  result: {
                    session_id: target.session.id,
                    worker_message_id: existingWorkerMessage.info.id,
                    worker_message_part_id: workerMessagePartID,
                    message_recovered: true,
                  },
                  summary: "continue_worker message recovered after prior append",
                })
              } else {
                workerMessage = await SessionPrompt.prompt({
                  sessionID: request.payload.session_id,
                  messageID: workerMessageID,
                  model: {
                    providerID: target.model.providerID,
                    modelID: target.model.modelID,
                  },
                  agent: request.payload.agent,
                  noReply: true,
                  extra: {
                    taskID,
                    source: "agent_coordination_response",
                    agentCoordination: {
                      requestID: request.payload.request_id,
                      responseID: response.payload.response_id,
                      actionID: response.payload.action_id,
                      decision,
                      reason,
                      blocking: request.payload.blocking,
                      requestedDecision: request.payload.requested_decision,
                    },
                    ...(descriptor ? { workerTurnDescriptor: descriptor } : {}),
                  },
                  parts: [
                    {
                      type: "text",
                      text: workerMessageText,
                      id: workerMessagePartID,
                    },
                  ],
                })
                workerMessageIDForFailure = workerMessage.info.id
                await recordAgentCoordinationActionProgress({
                  taskID,
                  actionID: response.payload.action_id,
                  result: {
                    session_id: target.session.id,
                    worker_message_id: workerMessage.info.id,
                    worker_message_part_id: workerMessagePartID,
                    message_appended: true,
                  },
                  summary: "continue_worker message appended",
                })
              }
            }
          } catch (error) {
            await failAgentCoordinationAction({
              taskID,
              actionID: response.payload.action_id,
              ...(workerMessageIDForFailure ? { workerMessageID: workerMessageIDForFailure } : {}),
              error,
              result: { session_id: target.session.id },
              summary: "continue_worker message append or recovery failed",
            })
            throw error
          }

          let continuation: { loopPromise: ReturnType<typeof SessionPrompt.loop> }
          try {
            continuation = await startAgentCoordinationContinuation({ session: target.session })
          } catch (error) {
            await failAgentCoordinationAction({
              taskID,
              actionID: response.payload.action_id,
              workerMessageID: workerMessage.info.id,
              error,
              result: { session_id: target.session.id },
              summary: "continue_worker resume failed",
            })
            markAgentCoordinationContinuationFailure({ sessionID: target.session.id, error })
            throw error
          }
          await completeAgentCoordinationAction({
            taskID,
            actionID: response.payload.action_id,
            workerMessageID: workerMessage.info.id,
            result: { session_id: target.session.id, resumed: true },
            summary: "continue_worker message resolved and session resumed",
          })

          void continuation.loopPromise.catch((error) => {
            markAgentCoordinationContinuationFailure({ sessionID: target.session.id, error })
            log.error("agent coordination continue loop failed", {
              taskID,
              requestID: request.payload.request_id,
              responseID: response.payload.response_id,
              sessionID: target.session.id,
              error,
            })
          })
          return (
            `Responded to coordination request ${request.payload.request_id} with continue. ` +
            `response=${response.payload.response_id}; action=${response.payload.action_id}; ` +
            `resolved worker message ${workerMessage.info.id} and resumed session ${request.payload.session_id}.`
          )
        }

        if (decision === "redispatch") {
          if (request.payload.agent === "build") {
            let target: Awaited<ReturnType<typeof validateAgentCoordinationBuildRedispatch>>
            try {
              target = await validateAgentCoordinationBuildRedispatch({ taskID, request })
            } catch (error) {
              const detail = error instanceof Error ? error.message : String(error)
              return (
                `respond_agent_coordination refused redispatch: ${detail}. ` +
                `The request ${request.payload.request_id} remains pending until a concrete dispatcher action binding is available.`
              )
            }
            const response = await createAgentCoordinationResponse({
              taskID,
              requestID: request.payload.request_id,
              ...responseAudit,
              decision,
              reason,
              ...(guidance ? { message: guidance } : {}),
              redispatchBinding: {
                dispatcher: "build_stage",
                stage: "build",
                target_kind: "build",
              },
            })
            const replayResult = replayedAgentCoordinationActionResult({ taskID, response })
            if (replayResult) return replayResult
            const recovered = await recoverPendingBuildRedispatchAction({
              taskID,
              response,
              sourceSessionID: target.source.id,
              sourceGoalRunID: target.sourceGoalRunID,
              goalID: target.goalID,
              targetKind: target.kind,
            })
            if (recovered) {
              return (
                `Responded to coordination request ${request.payload.request_id} with redispatch. ` +
                `response=${response.payload.response_id}; action=${response.payload.action_id}; ` +
                `build session ${recovered.sessionID} recovered persisted goal_run ${recovered.goalRunID}.`
              )
            }
            let sourceCancelSummary = ""
            let dispatch: Awaited<ReturnType<typeof executeBuildStageRedispatch>>
            try {
              const liveOwner =
                findLiveBuildOwnershipByGoalRun({ taskID, goalRunID: target.sourceGoalRunID }) ??
                findLiveBuildOwnershipBySession({ taskID, sessionID: target.source.id })
              if (liveOwner) {
                sourceCancelSummary = await cancelLiveOwnedBuild({
                  taskID,
                  sessionID: target.source.id,
                  goalRunID: target.sourceGoalRunID,
                  owner: liveOwner,
                  reason,
                  reasonPrefix: "respond_agent_coordination",
                  originSite: "orchestrator.tools.respond-agent-coordination-build-redispatch",
                  metadata: {
                    agent_coordination_request_id: request.payload.request_id,
                    agent_coordination_action_id: response.payload.action_id,
                    redispatch_build: true,
                  },
                })
              } else {
                const aborted = await abortGoalRunExecution({
                  taskID,
                  goalRunID: target.sourceGoalRunID,
                  reason: `respond_agent_coordination redispatch: ${reason}`,
                })
                sourceCancelSummary =
                  ` goal_run ${target.sourceGoalRunID} ${aborted.goalRunAborted ? "aborted" : "unchanged"}` +
                  `${aborted.executorAbortAttempted ? `; executor_abort=${aborted.executorAbortSucceeded ? "ok" : "failed"}` : ""}.`
              }
              const existingGoalRunIDs = new Set(listGoalRunsByGoal(target.goalID).map((goalRun) => goalRun.id))
              const existingBuildSessionContractIDs = new Set(
                listBuildSessionContractArtifactsForGoal({ taskID, goalID: target.goalID }).map((row) => row.id),
              )
              await recordAgentCoordinationActionProgress({
                taskID,
                actionID: response.payload.action_id,
                result: {
                  dispatcher: "build_stage",
                  stage: "build",
                  source_session_id: target.source.id,
                  source_goal_run_id: target.sourceGoalRunID,
                  source_cancel_summary: sourceCancelSummary,
                  goal_id: target.goalID,
                  target_kind: target.kind,
                  redispatch_started: true,
                  redispatch_started_at: Date.now(),
                  preexisting_build_goal_run_ids: [...existingGoalRunIDs],
                  preexisting_build_session_contract_ids: [...existingBuildSessionContractIDs],
                },
                summary: "redispatch_worker build stage dispatch started",
              })
              dispatch = await executeBuildStageRedispatch({
                goalID: target.goalID,
                reason: [
                  `A2A redispatch_worker for build request ${request.payload.request_id}.`,
                  reason.trim(),
                  `Source session ${target.source.id} goal_run ${target.sourceGoalRunID} was stopped before redispatch.`,
                  sourceCancelSummary.trim().length > 0 ? `Source stop result: ${sourceCancelSummary.trim()}` : "",
                ]
                  .filter((line) => line.length > 0)
                  .join("\n"),
                request: [
                  `Worker summary: ${request.payload.summary}`,
                  request.payload.details.trim().length > 0 ? `Worker details: ${request.payload.details}` : "",
                  guidance && guidance.length > 0 ? `Guidance: ${guidance}` : "",
                ]
                  .filter((line) => line.length > 0)
                  .join("\n"),
                options,
                existingGoalRunIDs,
              })
            } catch (error) {
              await failAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                error,
                result: {
                  dispatcher: "build_stage",
                  stage: "build",
                  source_session_id: target.source.id,
                  source_goal_run_id: target.sourceGoalRunID,
                  goal_id: target.goalID,
                  source_cancel_summary: sourceCancelSummary,
                },
                summary: "redispatch_worker build stage dispatch failed",
              })
              throw error
            }
            if (!dispatch.sessionID || !dispatch.goalRunID) {
              const error = new Error("build_stage redispatch did not create a build session and goal_run")
              await failAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                error,
                result: {
                  dispatcher: "build_stage",
                  stage: "build",
                  source_session_id: target.source.id,
                  source_goal_run_id: target.sourceGoalRunID,
                  goal_id: target.goalID,
                  source_cancel_summary: sourceCancelSummary,
                  output: dispatch.outputText,
                },
                summary: "redispatch_worker build stage did not complete",
              })
              return (
                `respond_agent_coordination redispatch failed for request ${request.payload.request_id}: ${error.message}. ` +
                `The request remains pending.`
              )
            }
            const sourceAfter = findGoalRun(target.sourceGoalRunID)
            await completeAgentCoordinationAction({
              taskID,
              actionID: response.payload.action_id,
              result: {
                dispatcher: "build_stage",
                stage: "build",
                source_session_id: target.source.id,
                source_goal_run_id: target.sourceGoalRunID,
                source_goal_run_status: sourceAfter?.status ?? "unknown",
                source_cancel_summary: sourceCancelSummary,
                redispatch_session_id: dispatch.sessionID,
                redispatch_goal_run_id: dispatch.goalRunID,
                redispatch_goal_run_status: dispatch.goalRunStatus,
                ...(dispatch.buildSessionContractID
                  ? { build_session_contract_id: dispatch.buildSessionContractID }
                  : {}),
                ...(dispatch.worktreeDir ? { worktree_dir: dispatch.worktreeDir } : {}),
                ...(dispatch.worktreeBranch ? { worktree_branch: dispatch.worktreeBranch } : {}),
                goal_id: target.goalID,
                target_kind: target.kind,
                started: true,
                recovered_redispatch: false,
              },
              summary: "redispatch_worker build stage completed",
            })
            return (
              `Responded to coordination request ${request.payload.request_id} with redispatch. ` +
              `response=${response.payload.response_id}; action=${response.payload.action_id}; ` +
              `build session ${dispatch.sessionID} started goal_run ${dispatch.goalRunID}.`
            )
          }

          if (request.payload.agent === "intent-analysis") {
            let target: Awaited<ReturnType<typeof validateAgentCoordinationIntentAnalysisRedispatch>>
            try {
              target = await validateAgentCoordinationIntentAnalysisRedispatch({ taskID, request })
            } catch (error) {
              const detail = error instanceof Error ? error.message : String(error)
              return (
                `respond_agent_coordination refused redispatch: ${detail}. ` +
                `The request ${request.payload.request_id} remains pending until a concrete dispatcher action binding is available.`
              )
            }
            const response = await createAgentCoordinationResponse({
              taskID,
              requestID: request.payload.request_id,
              ...responseAudit,
              decision,
              reason,
              ...(guidance ? { message: guidance } : {}),
              redispatchBinding: {
                dispatcher: "intent_analysis_stage",
                stage: "intent-analysis",
                target_kind: "intent-analysis",
              },
            })
            const replayResult = replayedAgentCoordinationActionResult({ taskID, response })
            if (replayResult) return replayResult
            const recovered = await recoverPendingIntentAnalysisRedispatchAction({
              taskID,
              response,
              orchestratorSessionID: input.agentSessionID,
              sourceSessionID: target.source.id,
              targetKind: target.kind,
            })
            if (recovered) {
              return (
                `Responded to coordination request ${request.payload.request_id} with redispatch. ` +
                `response=${response.payload.response_id}; action=${response.payload.action_id}; ` +
                `intent_analysis session ${recovered.sessionID} recovered persisted intent_summary.`
              )
            }
            let dispatch: Awaited<ReturnType<typeof executeIntentAnalysisStageRedispatch>>
            try {
              const existingIntentAnalysisSessions = new Set(
                (await Session.children(input.agentSessionID))
                  .filter((session) => session.kind === "intent-analysis")
                  .map((session) => session.id),
              )
              const existingIntentAnalysisDecisionIDs = new Set(
                listDecisionLogEntriesForPhase({ taskID, phase: "intent_analysis" }).map((entry) => entry.id),
              )
              await recordAgentCoordinationActionProgress({
                taskID,
                actionID: response.payload.action_id,
                result: {
                  dispatcher: "intent_analysis_stage",
                  stage: "intent-analysis",
                  source_session_id: target.source.id,
                  target_kind: target.kind,
                  redispatch_started: true,
                  redispatch_started_at: Date.now(),
                  preexisting_intent_analysis_session_ids: [...existingIntentAnalysisSessions],
                  preexisting_intent_analysis_decision_ids: [...existingIntentAnalysisDecisionIDs],
                },
                summary: "redispatch_worker intent_analysis stage dispatch started",
              })
              dispatch = await executeIntentAnalysisStageRedispatch({
                reason: [
                  `A2A redispatch_worker for request ${request.payload.request_id}.`,
                  reason.trim(),
                  `Worker summary: ${request.payload.summary}`,
                  request.payload.details.trim().length > 0 ? `Worker details: ${request.payload.details}` : "",
                  guidance && guidance.length > 0 ? `Guidance: ${guidance}` : "",
                ]
                  .filter((line) => line.length > 0)
                  .join("\n"),
                options,
                existingIntentAnalysisSessions,
              })
            } catch (error) {
              await failAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                error,
                result: {
                  dispatcher: "intent_analysis_stage",
                  stage: "intent-analysis",
                  source_session_id: target.source.id,
                },
                summary: "redispatch_worker intent_analysis stage dispatch failed",
              })
              throw error
            }
            if (!dispatch.sessionID || dispatch.decisionEntriesCount < 1 || !dispatch.intentSummary) {
              const error = new Error("intent_analysis_stage redispatch did not create intent analysis evidence")
              await failAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                error,
                result: {
                  dispatcher: "intent_analysis_stage",
                  stage: "intent-analysis",
                  source_session_id: target.source.id,
                  ...(dispatch.sessionID ? { redispatch_session_id: dispatch.sessionID } : {}),
                  decision_entries_count: dispatch.decisionEntriesCount,
                  output: dispatch.outputText,
                },
                summary: "redispatch_worker intent_analysis stage did not complete",
              })
              return (
                `respond_agent_coordination redispatch failed for request ${request.payload.request_id}: ${error.message}. ` +
                `The request remains pending.`
              )
            }
            await completeAgentCoordinationAction({
              taskID,
              actionID: response.payload.action_id,
              result: {
                dispatcher: "intent_analysis_stage",
                stage: "intent-analysis",
                source_session_id: target.source.id,
                redispatch_session_id: dispatch.sessionID,
                decision_entries_count: dispatch.decisionEntriesCount,
                intent_summary: dispatch.intentSummary,
                target_kind: target.kind,
                started: true,
                recovered_redispatch: false,
              },
              summary: "redispatch_worker intent_analysis stage completed",
            })
            return (
              `Responded to coordination request ${request.payload.request_id} with redispatch. ` +
              `response=${response.payload.response_id}; action=${response.payload.action_id}; ` +
              `intent_analysis session ${dispatch.sessionID} recorded intent_summary.`
            )
          }

          if (request.payload.agent === "explore") {
            let target: Awaited<ReturnType<typeof validateAgentCoordinationExploreRedispatch>>
            try {
              target = await validateAgentCoordinationExploreRedispatch({ taskID, request })
            } catch (error) {
              const detail = error instanceof Error ? error.message : String(error)
              return (
                `respond_agent_coordination refused redispatch: ${detail}. ` +
                `The request ${request.payload.request_id} remains pending until a concrete dispatcher action binding is available.`
              )
            }
            const response = await createAgentCoordinationResponse({
              taskID,
              requestID: request.payload.request_id,
              ...responseAudit,
              decision,
              reason,
              ...(guidance ? { message: guidance } : {}),
              redispatchBinding: {
                dispatcher: "explore_stage",
                stage: "explore",
                target_kind: "explore",
              },
            })
            const replayResult = replayedAgentCoordinationActionResult({ taskID, response })
            if (replayResult) return replayResult
            const exploreQuestion = [
              request.payload.summary.trim(),
              request.payload.details.trim().length > 0 ? request.payload.details.trim() : "",
              guidance && guidance.length > 0 ? `Orchestrator guidance: ${guidance}` : "",
            ]
              .filter((line) => line.length > 0)
              .join("\n\n")
            const recovered = await recoverPendingExploreRedispatchAction({
              taskID,
              response,
              orchestratorSessionID: input.agentSessionID,
              sourceSessionID: target.source.id,
              question: exploreQuestion,
              targetKind: target.kind,
            })
            if (recovered) {
              return (
                `Responded to coordination request ${request.payload.request_id} with redispatch. ` +
                `response=${response.payload.response_id}; action=${response.payload.action_id}; ` +
                `explore session ${recovered.sessionID} recovered persisted repository investigation.`
              )
            }
            let dispatch: Awaited<ReturnType<typeof executeExploreStageRedispatch>>
            try {
              const existingExploreSessions = new Set(
                (await Session.children(input.agentSessionID))
                  .filter((session) => session.kind === "explore")
                  .map((session) => session.id),
              )
              const existingExploreDecisionIDs = new Set(
                listDecisionLogEntriesForPhase({ taskID, phase: "explore" }).map((entry) => entry.id),
              )
              const existingExplorationArtifactIDs = new Set(listExplorationArtifacts({ taskID }).map((row) => row.id))
              await recordAgentCoordinationActionProgress({
                taskID,
                actionID: response.payload.action_id,
                result: {
                  dispatcher: "explore_stage",
                  stage: "explore",
                  source_session_id: target.source.id,
                  question: exploreQuestion,
                  target_kind: target.kind,
                  redispatch_started: true,
                  redispatch_started_at: Date.now(),
                  preexisting_explore_session_ids: [...existingExploreSessions],
                  preexisting_explore_decision_ids: [...existingExploreDecisionIDs],
                  preexisting_exploration_artifact_ids: [...existingExplorationArtifactIDs],
                },
                summary: "redispatch_worker explore stage dispatch started",
              })
              dispatch = await executeExploreStageRedispatch({
                question: exploreQuestion,
                reason: [
                  `A2A redispatch_worker for explore request ${request.payload.request_id}.`,
                  reason.trim(),
                  `Source session: ${target.source.id}.`,
                ]
                  .filter((line) => line.length > 0)
                  .join("\n"),
                options,
                existingExploreSessions,
                existingExploreDecisionIDs,
                existingExplorationArtifactIDs,
              })
            } catch (error) {
              await failAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                error,
                result: {
                  dispatcher: "explore_stage",
                  stage: "explore",
                  source_session_id: target.source.id,
                },
                summary: "redispatch_worker explore stage dispatch failed",
              })
              throw error
            }
            if (
              !dispatch.sessionID ||
              dispatch.decisionEntriesCount !== 1 ||
              dispatch.explorationArtifactsCount !== 1 ||
              !dispatch.decisionEntryID ||
              !dispatch.artifactID
            ) {
              const error = new Error("explore_stage redispatch did not create explore evidence")
              await failAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                error,
                result: {
                  dispatcher: "explore_stage",
                  stage: "explore",
                  source_session_id: target.source.id,
                  ...(dispatch.sessionID ? { redispatch_session_id: dispatch.sessionID } : {}),
                  decision_entries_count: dispatch.decisionEntriesCount,
                  exploration_artifacts_count: dispatch.explorationArtifactsCount,
                  output: dispatch.outputText,
                },
                summary: "redispatch_worker explore stage did not complete",
              })
              return (
                `respond_agent_coordination redispatch failed for request ${request.payload.request_id}: ${error.message}. ` +
                `The request remains pending.`
              )
            }
            await completeAgentCoordinationAction({
              taskID,
              actionID: response.payload.action_id,
              result: {
                dispatcher: "explore_stage",
                stage: "explore",
                source_session_id: target.source.id,
                redispatch_session_id: dispatch.sessionID,
                decision_entries_count: dispatch.decisionEntriesCount,
                exploration_artifacts_count: dispatch.explorationArtifactsCount,
                explore_decision_id: dispatch.decisionEntryID,
                exploration_artifact_id: dispatch.artifactID,
                question: dispatch.question,
                target_kind: target.kind,
                started: true,
                recovered_redispatch: false,
              },
              summary: "redispatch_worker explore stage completed",
            })
            return (
              `Responded to coordination request ${request.payload.request_id} with redispatch. ` +
              `response=${response.payload.response_id}; action=${response.payload.action_id}; ` +
              `explore session ${dispatch.sessionID} recorded repository investigation.`
            )
          }

          if (request.payload.agent === "goal-workload-analyst") {
            let target: Awaited<ReturnType<typeof validateAgentCoordinationGoalWorkloadRedispatch>>
            try {
              target = await validateAgentCoordinationGoalWorkloadRedispatch({ taskID, request })
            } catch (error) {
              const detail = error instanceof Error ? error.message : String(error)
              return (
                `respond_agent_coordination refused redispatch: ${detail}. ` +
                `The request ${request.payload.request_id} remains pending until a concrete dispatcher action binding is available.`
              )
            }
            const response = await createAgentCoordinationResponse({
              taskID,
              requestID: request.payload.request_id,
              ...responseAudit,
              decision,
              reason,
              ...(guidance ? { message: guidance } : {}),
              redispatchBinding: {
                dispatcher: "workload_analysis_stage",
                stage: "goal-workload-analyst",
                target_kind: "goal-workload-analyst",
              },
            })
            const replayResult = replayedAgentCoordinationActionResult({ taskID, response })
            if (replayResult) return replayResult
            const recovered = await recoverPendingGoalWorkloadRedispatchAction({
              taskID,
              response,
              orchestratorSessionID: input.agentSessionID,
              sourceSessionID: target.source.id,
              activeSpecID: target.activeSpecID,
              expectedGoalsCount: target.goalsCount,
              targetKind: target.kind,
            })
            if (recovered) {
              return (
                `Responded to coordination request ${request.payload.request_id} with redispatch. ` +
                `response=${response.payload.response_id}; action=${response.payload.action_id}; ` +
                `workload_analysis session ${recovered.sessionID} recovered persisted workload artifact ${recovered.artifactID}.`
              )
            }
            let dispatch: Awaited<ReturnType<typeof executeGoalWorkloadStageRedispatch>>
            try {
              const existingGoalWorkloadSessions = new Set(
                (await Session.children(input.agentSessionID))
                  .filter((session) => session.kind === "goal-workload-analyst")
                  .map((session) => session.id),
              )
              const existingGoalWorkloadArtifactIDs = new Set(
                listGoalWorkloadArtifacts({ taskID }).map((row) => row.id),
              )
              await recordAgentCoordinationActionProgress({
                taskID,
                actionID: response.payload.action_id,
                result: {
                  dispatcher: "workload_analysis_stage",
                  stage: "goal-workload-analyst",
                  source_session_id: target.source.id,
                  spec_snapshot_id: target.activeSpecID,
                  expected_goals_count: target.goalsCount,
                  target_kind: target.kind,
                  redispatch_started: true,
                  redispatch_started_at: Date.now(),
                  preexisting_goal_workload_session_ids: [...existingGoalWorkloadSessions],
                  preexisting_goal_workload_artifact_ids: [...existingGoalWorkloadArtifactIDs],
                },
                summary: "redispatch_worker workload_analysis stage dispatch started",
              })
              dispatch = await executeGoalWorkloadStageRedispatch({
                reason: [
                  `A2A redispatch_worker for workload_analysis request ${request.payload.request_id}.`,
                  reason.trim(),
                  `Worker summary: ${request.payload.summary}`,
                  request.payload.details.trim().length > 0 ? `Worker details: ${request.payload.details}` : "",
                  guidance && guidance.length > 0 ? `Guidance: ${guidance}` : "",
                ]
                  .filter((line) => line.length > 0)
                  .join("\n"),
                options,
                existingGoalWorkloadSessions,
                existingGoalWorkloadArtifactIDs,
              })
            } catch (error) {
              await failAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                error,
                result: {
                  dispatcher: "workload_analysis_stage",
                  stage: "goal-workload-analyst",
                  source_session_id: target.source.id,
                  spec_snapshot_id: target.activeSpecID,
                },
                summary: "redispatch_worker workload_analysis stage dispatch failed",
              })
              throw error
            }
            if (!dispatch.sessionID || !dispatch.artifactID || dispatch.briefsCount < target.goalsCount) {
              const error = new Error("workload_analysis_stage redispatch did not create complete workload evidence")
              await failAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                error,
                result: {
                  dispatcher: "workload_analysis_stage",
                  stage: "goal-workload-analyst",
                  source_session_id: target.source.id,
                  spec_snapshot_id: target.activeSpecID,
                  ...(dispatch.sessionID ? { redispatch_session_id: dispatch.sessionID } : {}),
                  ...(dispatch.artifactID ? { goal_workload_artifact_id: dispatch.artifactID } : {}),
                  briefs_count: dispatch.briefsCount,
                  expected_goals_count: target.goalsCount,
                  output: dispatch.outputText,
                },
                summary: "redispatch_worker workload_analysis stage did not complete",
              })
              return (
                `respond_agent_coordination redispatch failed for request ${request.payload.request_id}: ${error.message}. ` +
                `The request remains pending.`
              )
            }
            await completeAgentCoordinationAction({
              taskID,
              actionID: response.payload.action_id,
              result: {
                dispatcher: "workload_analysis_stage",
                stage: "goal-workload-analyst",
                source_session_id: target.source.id,
                redispatch_session_id: dispatch.sessionID,
                goal_workload_artifact_id: dispatch.artifactID,
                spec_snapshot_id: dispatch.specSnapshotID,
                briefs_count: dispatch.briefsCount,
                flagged_goals_count: dispatch.flaggedGoalsCount,
                expected_goals_count: target.goalsCount,
                target_kind: target.kind,
                started: true,
                recovered_redispatch: false,
              },
              summary: "redispatch_worker workload_analysis stage completed",
            })
            return (
              `Responded to coordination request ${request.payload.request_id} with redispatch. ` +
              `response=${response.payload.response_id}; action=${response.payload.action_id}; ` +
              `workload_analysis session ${dispatch.sessionID} persisted workload artifact ${dispatch.artifactID}.`
            )
          }

          if (request.payload.agent === "fact-check") {
            let target: Awaited<ReturnType<typeof validateAgentCoordinationFactCheckRedispatch>>
            try {
              target = await validateAgentCoordinationFactCheckRedispatch({ taskID, request })
            } catch (error) {
              const detail = error instanceof Error ? error.message : String(error)
              return (
                `respond_agent_coordination refused redispatch: ${detail}. ` +
                `The request ${request.payload.request_id} remains pending until a concrete dispatcher action binding is available.`
              )
            }
            const response = await createAgentCoordinationResponse({
              taskID,
              requestID: request.payload.request_id,
              ...responseAudit,
              decision,
              reason,
              ...(guidance ? { message: guidance } : {}),
              redispatchBinding: {
                dispatcher: "fact_check_stage",
                stage: "fact-check",
                target_kind: "fact-check",
              },
            })
            const replayResult = replayedAgentCoordinationActionResult({ taskID, response })
            if (replayResult) return replayResult
            const recovered = await recoverPendingFactCheckRedispatchAction({
              taskID,
              response,
              sourceSessionID: target.source.id,
              continuationArtifactID: target.continuation.row.artifactID,
              normalizedStageInput: target.continuation.normalizedStageInput,
              targetKind: target.kind,
            })
            if (recovered) {
              return (
                `Responded to coordination request ${request.payload.request_id} with redispatch. ` +
                `response=${response.payload.response_id}; action=${response.payload.action_id}; ` +
                `fact_check session ${recovered.sessionID} recovered persisted fact_check_attempt ${recovered.artifactID}.`
              )
            }
            let dispatch: Awaited<ReturnType<typeof executeFactCheckStageRedispatch>>
            try {
              const existingFactCheckAttemptIDs = new Set(
                listFactCheckAttemptArtifacts({ taskID }).map((row) => row.id),
              )
              await recordAgentCoordinationActionProgress({
                taskID,
                actionID: response.payload.action_id,
                result: {
                  dispatcher: "fact_check_stage",
                  stage: "fact-check",
                  source_session_id: target.source.id,
                  continuation_artifact_id: target.continuation.row.artifactID,
                  target_session_id: target.continuation.normalizedStageInput.target_session_id,
                  target_agent: target.continuation.normalizedStageInput.target_agent,
                  target_message_id: target.continuation.normalizedStageInput.target_message_id,
                  target_message_content_hash: target.continuation.normalizedStageInput.target_message_content_hash,
                  target_kind: target.kind,
                  redispatch_started: true,
                  redispatch_started_at: Date.now(),
                  preexisting_fact_check_attempt_ids: [...existingFactCheckAttemptIDs],
                },
                summary: "redispatch_worker fact_check stage dispatch started",
              })
              dispatch = await executeFactCheckStageRedispatch({
                continuationArtifactID: target.continuation.row.artifactID,
                sourceSessionID: target.source.id,
                orchestratorSessionID: input.agentSessionID,
                normalizedStageInput: target.continuation.normalizedStageInput,
                reason: [
                  `A2A redispatch_worker for fact_check request ${request.payload.request_id}.`,
                  reason.trim(),
                  `Continuation artifact: ${target.continuation.row.artifactID}.`,
                  `Target session: ${target.continuation.normalizedStageInput.target_session_id}.`,
                  `Target message: ${target.continuation.normalizedStageInput.target_message_id}.`,
                  request.payload.summary.trim().length > 0 ? `Worker summary: ${request.payload.summary}` : "",
                  request.payload.details.trim().length > 0 ? `Worker details: ${request.payload.details}` : "",
                  guidance && guidance.length > 0 ? `Guidance: ${guidance}` : "",
                ]
                  .filter((line) => line.length > 0)
                  .join("\n"),
                options,
                existingFactCheckAttemptIDs,
              })
            } catch (error) {
              await failAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                error,
                result: {
                  dispatcher: "fact_check_stage",
                  stage: "fact-check",
                  source_session_id: target.source.id,
                  continuation_artifact_id: target.continuation.row.artifactID,
                  target_session_id: target.continuation.normalizedStageInput.target_session_id,
                  target_message_id: target.continuation.normalizedStageInput.target_message_id,
                },
                summary: "redispatch_worker fact_check stage continuation failed",
              })
              throw error
            }
            if (!dispatch.sessionID || !dispatch.artifactID || !dispatch.verdict || !dispatch.outcome) {
              const error = new Error("fact_check_stage redispatch did not create fact_check_attempt evidence")
              await failAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                error,
                result: {
                  dispatcher: "fact_check_stage",
                  stage: "fact-check",
                  source_session_id: target.source.id,
                  continuation_artifact_id: target.continuation.row.artifactID,
                  ...(dispatch.sessionID ? { redispatch_session_id: dispatch.sessionID } : {}),
                  ...(dispatch.artifactID ? { fact_check_attempt_id: dispatch.artifactID } : {}),
                  output: dispatch.outputText,
                },
                summary: "redispatch_worker fact_check stage did not complete",
              })
              return (
                `respond_agent_coordination redispatch failed for request ${request.payload.request_id}: ${error.message}. ` +
                `The coordination action is failed and visible for retry diagnosis.`
              )
            }
            await completeAgentCoordinationAction({
              taskID,
              actionID: response.payload.action_id,
              result: {
                dispatcher: "fact_check_stage",
                stage: "fact-check",
                source_session_id: target.source.id,
                redispatch_session_id: dispatch.sessionID,
                continuation_artifact_id: target.continuation.row.artifactID,
                fact_check_attempt_id: dispatch.artifactID,
                target_session_id: dispatch.targetSessionID,
                target_agent: dispatch.targetAgent,
                target_message_id: dispatch.targetMessageID,
                target_message_content_hash: dispatch.targetMessageContentHash,
                verdict: dispatch.verdict,
                outcome: dispatch.outcome,
                items_total: dispatch.itemsTotal,
                items_inspected: dispatch.itemsInspected,
                verified_count: dispatch.verifiedCount,
                corrected_count: dispatch.correctedCount,
                unresolved_count: dispatch.unresolvedCount,
                same_session_continuation: dispatch.sessionID === target.source.id,
                target_kind: target.kind,
                started: true,
                recovered_redispatch: false,
              },
              summary: "redispatch_worker fact_check stage completed",
            })
            return (
              `Responded to coordination request ${request.payload.request_id} with redispatch. ` +
              `response=${response.payload.response_id}; action=${response.payload.action_id}; ` +
              `fact_check session ${dispatch.sessionID} resumed continuation ${target.continuation.row.artifactID} ` +
              `and persisted fact_check_attempt ${dispatch.artifactID}.`
            )
          }

          if (request.payload.agent === "architect") {
            let target: Awaited<ReturnType<typeof validateAgentCoordinationArchitectRedispatch>>
            try {
              target = await validateAgentCoordinationArchitectRedispatch({ taskID, request })
            } catch (error) {
              const detail = error instanceof Error ? error.message : String(error)
              return (
                `respond_agent_coordination refused redispatch: ${detail}. ` +
                `The request ${request.payload.request_id} remains pending until a concrete dispatcher action binding is available.`
              )
            }
            const response = await createAgentCoordinationResponse({
              taskID,
              requestID: request.payload.request_id,
              ...responseAudit,
              decision,
              reason,
              ...(guidance ? { message: guidance } : {}),
              redispatchBinding: {
                dispatcher: "architect_stage",
                stage: "architect",
                target_kind: "architect",
              },
            })
            const replayResult = replayedAgentCoordinationActionResult({ taskID, response })
            if (replayResult) return replayResult
            const recovered = await recoverPendingArchitectRedispatchAction({
              taskID,
              response,
              orchestratorSessionID: input.agentSessionID,
              sourceSessionID: target.source.id,
              targetKind: target.kind,
            })
            if (recovered) {
              return (
                `Responded to coordination request ${request.payload.request_id} with redispatch. ` +
                `response=${response.payload.response_id}; action=${recovered.actionID}; ` +
                `architect session ${recovered.sessionID} recovered persisted spec ${recovered.specSnapshotID}.`
              )
            }
            let dispatch: Awaited<ReturnType<typeof dispatchArchitectStage>>
            try {
              const startedAt = Date.now()
              const preexistingArchitectSessionIDs = (await Session.children(input.agentSessionID))
                .filter((session) => session.kind === "architect")
                .map((session) => session.id)
              const preexistingSpecSnapshotIDs = Database.use((db) =>
                db
                  .select({ id: EngineSpecSnapshotTable.id })
                  .from(EngineSpecSnapshotTable)
                  .where(eq(EngineSpecSnapshotTable.task_id, taskID))
                  .all()
                  .map((row) => row.id),
              )
              const preexistingArchitectContractGraphArtifactIDs = Database.use((db) =>
                db
                  .select({ id: EngineArtifactTable.id })
                  .from(EngineArtifactTable)
                  .where(
                    and(
                      eq(EngineArtifactTable.task_id, taskID),
                      eq(EngineArtifactTable.kind, "architect_contract_graph"),
                    ),
                  )
                  .all()
                  .map((row) => row.id),
              )
              await recordAgentCoordinationActionProgress({
                taskID,
                actionID: response.payload.action_id,
                result: {
                  dispatcher: "architect_stage",
                  stage: "architect",
                  source_session_id: target.source.id,
                  target_kind: target.kind,
                  redispatch_started: true,
                  redispatch_started_at: startedAt,
                  preexisting_architect_session_ids: preexistingArchitectSessionIDs,
                  preexisting_spec_snapshot_ids: preexistingSpecSnapshotIDs,
                  preexisting_architect_contract_graph_artifact_ids: preexistingArchitectContractGraphArtifactIDs,
                },
                summary: "redispatch_worker architect stage dispatch started",
                now: startedAt,
              })
              dispatch = await dispatchArchitectStage({
                task: target.task,
                reason: [
                  `A2A redispatch_worker for request ${request.payload.request_id}.`,
                  reason.trim(),
                  guidance && guidance.length > 0 ? `Guidance: ${guidance}` : "",
                ]
                  .filter((line) => line.length > 0)
                  .join("\n"),
              })
            } catch (error) {
              await failAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                error,
                result: {
                  dispatcher: "architect_stage",
                  stage: "architect",
                  source_session_id: target.source.id,
                },
                summary: "redispatch_worker architect stage dispatch failed",
              })
              throw error
            }
            if (dispatch.status !== "persisted" || !dispatch.sessionID || !dispatch.specSnapshotID) {
              const error = new Error(
                `architect_stage redispatch did not persist an architect spec; status=${dispatch.status}`,
              )
              await failAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                error,
                result: {
                  dispatcher: "architect_stage",
                  stage: "architect",
                  source_session_id: target.source.id,
                  dispatch_status: dispatch.status,
                  ...(dispatch.sessionID ? { redispatch_session_id: dispatch.sessionID } : {}),
                  ...(dispatch.specSnapshotID ? { spec_snapshot_id: dispatch.specSnapshotID } : {}),
                },
                summary: "redispatch_worker architect stage did not complete",
              })
              return (
                `respond_agent_coordination redispatch failed for request ${request.payload.request_id}: ${error.message}. ` +
                `The request remains pending.`
              )
            }
            await completeAgentCoordinationAction({
              taskID,
              actionID: response.payload.action_id,
              result: {
                dispatcher: "architect_stage",
                stage: "architect",
                source_session_id: target.source.id,
                redispatch_session_id: dispatch.sessionID,
                spec_snapshot_id: dispatch.specSnapshotID,
                ...(dispatch.contractGraphArtifactID
                  ? { architect_contract_graph_artifact_id: dispatch.contractGraphArtifactID }
                  : {}),
                goals_count: dispatch.goalsCount ?? 0,
                contracts_count: dispatch.contractsCount ?? 0,
                target_kind: target.kind,
                started: true,
                recovered_redispatch: false,
              },
              summary: "redispatch_worker architect stage completed",
            })
            return (
              `Responded to coordination request ${request.payload.request_id} with redispatch. ` +
              `response=${response.payload.response_id}; action=${response.payload.action_id}; ` +
              `architect session ${dispatch.sessionID} persisted spec ${dispatch.specSnapshotID}.`
            )
          }

          if (request.payload.agent === "requirements") {
            let target: Awaited<ReturnType<typeof validateAgentCoordinationRequirementsRedispatch>>
            try {
              target = await validateAgentCoordinationRequirementsRedispatch({ taskID, request })
            } catch (error) {
              const detail = error instanceof Error ? error.message : String(error)
              return (
                `respond_agent_coordination refused redispatch: ${detail}. ` +
                `The request ${request.payload.request_id} remains pending until a concrete dispatcher action binding is available.`
              )
            }
            const response = await createAgentCoordinationResponse({
              taskID,
              requestID: request.payload.request_id,
              ...responseAudit,
              decision,
              reason,
              ...(guidance ? { message: guidance } : {}),
              redispatchBinding: {
                dispatcher: "requirements_stage",
                stage: "requirements",
                target_kind: "requirements",
              },
            })
            const replayResult = replayedAgentCoordinationActionResult({ taskID, response })
            if (replayResult) return replayResult
            const recovered = await recoverPendingRequirementsRedispatchAction({
              taskID,
              response,
              orchestratorSessionID: input.agentSessionID,
              sourceSessionID: target.source.id,
              targetKind: target.kind,
            })
            if (recovered) {
              return (
                `Responded to coordination request ${request.payload.request_id} with redispatch. ` +
                `response=${response.payload.response_id}; action=${recovered.actionID}; ` +
                `requirements session ${recovered.sessionID} recovered persisted spec ${recovered.specSnapshotID}.`
              )
            }
            let dispatch: Awaited<ReturnType<typeof dispatchRequirementsStage>>
            try {
              const startedAt = Date.now()
              const preexistingRequirementsSessionIDs = (await Session.children(input.agentSessionID))
                .filter((session) => session.kind === "requirements")
                .map((session) => session.id)
              const preexistingSpecSnapshotIDs = Database.use((db) =>
                db
                  .select({ id: EngineSpecSnapshotTable.id })
                  .from(EngineSpecSnapshotTable)
                  .where(eq(EngineSpecSnapshotTable.task_id, taskID))
                  .all()
                  .map((row) => row.id),
              )
              await recordAgentCoordinationActionProgress({
                taskID,
                actionID: response.payload.action_id,
                result: {
                  dispatcher: "requirements_stage",
                  stage: "requirements",
                  source_session_id: target.source.id,
                  target_kind: target.kind,
                  redispatch_started: true,
                  redispatch_started_at: startedAt,
                  preexisting_requirements_session_ids: preexistingRequirementsSessionIDs,
                  preexisting_spec_snapshot_ids: preexistingSpecSnapshotIDs,
                },
                summary: "redispatch_worker requirements stage dispatch started",
                now: startedAt,
              })
              dispatch = await dispatchRequirementsStage({
                task: target.task,
                reason: [
                  `A2A redispatch_worker for request ${request.payload.request_id}.`,
                  reason.trim(),
                  guidance && guidance.length > 0 ? `Guidance: ${guidance}` : "",
                ]
                  .filter((line) => line.length > 0)
                  .join("\n"),
              })
            } catch (error) {
              await failAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                error,
                result: {
                  dispatcher: "requirements_stage",
                  stage: "requirements",
                  source_session_id: target.source.id,
                },
                summary: "redispatch_worker requirements stage dispatch failed",
              })
              throw error
            }
            if (dispatch.status !== "persisted" || !dispatch.sessionID || !dispatch.specSnapshotID) {
              const error = new Error(
                `requirements_stage redispatch did not persist a requirements spec; status=${dispatch.status}`,
              )
              await failAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                error,
                result: {
                  dispatcher: "requirements_stage",
                  stage: "requirements",
                  source_session_id: target.source.id,
                  dispatch_status: dispatch.status,
                  ...(dispatch.sessionID ? { redispatch_session_id: dispatch.sessionID } : {}),
                  ...(dispatch.specSnapshotID ? { spec_snapshot_id: dispatch.specSnapshotID } : {}),
                },
                summary: "redispatch_worker requirements stage did not complete",
              })
              return (
                `respond_agent_coordination redispatch failed for request ${request.payload.request_id}: ${error.message}. ` +
                `The request remains pending.`
              )
            }
            await completeAgentCoordinationAction({
              taskID,
              actionID: response.payload.action_id,
              result: {
                dispatcher: "requirements_stage",
                stage: "requirements",
                source_session_id: target.source.id,
                redispatch_session_id: dispatch.sessionID,
                spec_snapshot_id: dispatch.specSnapshotID,
                requirements_count: dispatch.requirementsCount ?? 0,
                decisions_count: dispatch.decisionsCount ?? 0,
                target_kind: target.kind,
                started: true,
                recovered_redispatch: false,
              },
              summary: "redispatch_worker requirements stage completed",
            })
            return (
              `Responded to coordination request ${request.payload.request_id} with redispatch. ` +
              `response=${response.payload.response_id}; action=${response.payload.action_id}; ` +
              `requirements session ${dispatch.sessionID} persisted spec ${dispatch.specSnapshotID}.`
            )
          }

          if (request.payload.agent === "frontend-design") {
            let target: Awaited<ReturnType<typeof validateAgentCoordinationFrontendDesignRedispatch>>
            try {
              target = await validateAgentCoordinationFrontendDesignRedispatch({ taskID, request })
            } catch (error) {
              const detail = error instanceof Error ? error.message : String(error)
              return (
                `respond_agent_coordination refused redispatch: ${detail}. ` +
                `The request ${request.payload.request_id} remains pending until a concrete dispatcher action binding is available.`
              )
            }
            const response = await createAgentCoordinationResponse({
              taskID,
              requestID: request.payload.request_id,
              ...responseAudit,
              decision,
              reason,
              ...(guidance ? { message: guidance } : {}),
              redispatchBinding: {
                dispatcher: "frontend_design_stage",
                stage: "frontend-design",
                target_kind: "frontend-design",
              },
            })
            const replayResult = replayedAgentCoordinationActionResult({ taskID, response })
            if (replayResult) return replayResult
            let dispatch: Awaited<ReturnType<typeof executeFrontendDesignStageRedispatch>>
            try {
              const existingFrontendDesignSessions = new Set(
                (await Session.children(input.agentSessionID))
                  .filter((session) => session.kind === "frontend-design")
                  .map((session) => session.id),
              )
              dispatch = await executeFrontendDesignStageRedispatch({
                reason: [
                  `A2A redispatch_worker for request ${request.payload.request_id}.`,
                  reason.trim(),
                  `Worker summary: ${request.payload.summary}`,
                  request.payload.details.trim().length > 0 ? `Worker details: ${request.payload.details}` : "",
                  guidance && guidance.length > 0 ? `Guidance: ${guidance}` : "",
                ]
                  .filter((line) => line.length > 0)
                  .join("\n"),
                sourceUrls: target.sourceUrls,
                options,
                existingFrontendDesignSessions,
              })
            } catch (error) {
              await failAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                error,
                result: {
                  dispatcher: "frontend_design_stage",
                  stage: "frontend-design",
                  source_session_id: target.source.id,
                },
                summary: "redispatch_worker frontend_design stage dispatch failed",
              })
              throw error
            }
            if (!dispatch.sessionID) {
              const error = new Error("frontend_design_stage redispatch did not create a frontend-design session")
              await failAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                error,
                result: {
                  dispatcher: "frontend_design_stage",
                  stage: "frontend-design",
                  source_session_id: target.source.id,
                  decision_entries_count: dispatch.decisionEntriesCount,
                  design_specs_count: dispatch.designSpecsCount,
                },
                summary: "redispatch_worker frontend_design stage did not complete",
              })
              return (
                `respond_agent_coordination redispatch failed for request ${request.payload.request_id}: ${error.message}. ` +
                `The request remains pending.`
              )
            }
            await completeAgentCoordinationAction({
              taskID,
              actionID: response.payload.action_id,
              result: {
                dispatcher: "frontend_design_stage",
                stage: "frontend-design",
                source_session_id: target.source.id,
                redispatch_session_id: dispatch.sessionID,
                design_specs_count: dispatch.designSpecsCount,
                decision_entries_count: dispatch.decisionEntriesCount,
                template_review_passes: dispatch.templateReviewPasses,
                reference_artifacts_count: dispatch.referenceArtifactsCount,
                frontend_project_status: dispatch.frontendProjectStatus,
                source_url_count: target.sourceUrls.length,
                target_kind: target.kind,
                started: true,
              },
              summary: "redispatch_worker frontend_design stage completed",
            })
            return (
              `Responded to coordination request ${request.payload.request_id} with redispatch. ` +
              `response=${response.payload.response_id}; action=${response.payload.action_id}; ` +
              `frontend_design session ${dispatch.sessionID} persisted ${dispatch.decisionEntriesCount} decision entries.`
            )
          }

          if (request.payload.agent === "frontend-research") {
            let target: Awaited<ReturnType<typeof validateAgentCoordinationFrontendResearchRedispatch>>
            try {
              target = await validateAgentCoordinationFrontendResearchRedispatch({ taskID, request })
            } catch (error) {
              const detail = error instanceof Error ? error.message : String(error)
              return (
                `respond_agent_coordination refused redispatch: ${detail}. ` +
                `The request ${request.payload.request_id} remains pending until a concrete dispatcher action binding is available.`
              )
            }
            const response = await createAgentCoordinationResponse({
              taskID,
              requestID: request.payload.request_id,
              ...responseAudit,
              decision,
              reason,
              ...(guidance ? { message: guidance } : {}),
              redispatchBinding: {
                dispatcher: "frontend_research_stage",
                stage: "frontend-research",
                target_kind: "frontend-research",
              },
            })
            const replayResult = replayedAgentCoordinationActionResult({ taskID, response })
            if (replayResult) return replayResult
            const recovered = await recoverPendingFrontendResearchRedispatchAction({
              taskID,
              response,
              orchestratorSessionID: input.agentSessionID,
              sourceSessionID: target.source.id,
              sourceURL: target.sourceUrls[0],
              targetKind: target.kind,
            })
            if (recovered) {
              return (
                `Responded to coordination request ${request.payload.request_id} with redispatch. ` +
                `response=${response.payload.response_id}; action=${recovered.actionID}; ` +
                `frontend_research session ${recovered.sessionID} recovered persisted brief ${recovered.artifactID}.`
              )
            }
            let dispatch: Awaited<ReturnType<typeof dispatchFrontendResearchStage>>
            try {
              const startedAt = Date.now()
              await recordAgentCoordinationActionProgress({
                taskID,
                actionID: response.payload.action_id,
                result: {
                  dispatcher: "frontend_research_stage",
                  stage: "frontend-research",
                  source_session_id: target.source.id,
                  source_url: target.sourceUrls[0],
                  target_kind: target.kind,
                  redispatch_started: true,
                  redispatch_started_at: startedAt,
                },
                summary: "redispatch_worker frontend_research stage dispatch started",
                now: startedAt,
              })
              dispatch = await dispatchFrontendResearchStage({
                task: target.task,
                sourceUrls: target.sourceUrls,
                focus: guidance,
                reason: [
                  `A2A redispatch_worker for request ${request.payload.request_id}.`,
                  reason.trim(),
                  guidance && guidance.length > 0 ? `Guidance: ${guidance}` : "",
                ]
                  .filter((line) => line.length > 0)
                  .join("\n"),
              })
            } catch (error) {
              await failAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                error,
                result: {
                  dispatcher: "frontend_research_stage",
                  stage: "frontend-research",
                  source_session_id: target.source.id,
                  source_url: target.sourceUrls[0],
                },
                summary: "redispatch_worker frontend_research stage dispatch failed",
              })
              throw error
            }
            if (dispatch.status !== "persisted" || !dispatch.sessionID || !dispatch.artifactID) {
              const error = new Error(
                `frontend_research_stage redispatch did not persist a frontend_research_brief; status=${dispatch.status}`,
              )
              await failAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                error,
                result: {
                  dispatcher: "frontend_research_stage",
                  stage: "frontend-research",
                  source_session_id: target.source.id,
                  source_url: target.sourceUrls[0],
                  dispatch_status: dispatch.status,
                  ...(dispatch.sessionID ? { redispatch_session_id: dispatch.sessionID } : {}),
                },
                summary: "redispatch_worker frontend_research stage did not complete",
              })
              return (
                `respond_agent_coordination redispatch failed for request ${request.payload.request_id}: ${error.message}. ` +
                `The request remains pending.`
              )
            }
            await completeAgentCoordinationAction({
              taskID,
              actionID: response.payload.action_id,
              result: {
                dispatcher: "frontend_research_stage",
                stage: "frontend-research",
                source_session_id: target.source.id,
                redispatch_session_id: dispatch.sessionID,
                frontend_research_brief_artifact_id: dispatch.artifactID,
                source_url: target.sourceUrls[0],
                target_kind: target.kind,
                started: true,
                recovered_redispatch: false,
              },
              summary: "redispatch_worker frontend_research stage completed",
            })
            return (
              `Responded to coordination request ${request.payload.request_id} with redispatch. ` +
              `response=${response.payload.response_id}; action=${response.payload.action_id}; ` +
              `frontend_research session ${dispatch.sessionID} persisted brief ${dispatch.artifactID}.`
            )
          }

          if (request.payload.agent === "deep-research") {
            let target: Awaited<ReturnType<typeof validateAgentCoordinationDeepResearchRedispatch>>
            try {
              target = await validateAgentCoordinationDeepResearchRedispatch({ taskID, request })
            } catch (error) {
              const detail = error instanceof Error ? error.message : String(error)
              return (
                `respond_agent_coordination refused redispatch: ${detail}. ` +
                `The request ${request.payload.request_id} remains pending until a concrete dispatcher action binding is available.`
              )
            }
            const response = await createAgentCoordinationResponse({
              taskID,
              requestID: request.payload.request_id,
              ...responseAudit,
              decision,
              reason,
              ...(guidance ? { message: guidance } : {}),
              redispatchBinding: {
                dispatcher: "deep_research_stage",
                stage: "deep-research",
                target_kind: "deep-research",
              },
            })
            const replayResult = replayedAgentCoordinationActionResult({ taskID, response })
            if (replayResult) return replayResult
            const recovered = await recoverPendingDeepResearchRedispatchAction({
              taskID,
              response,
              orchestratorSessionID: input.agentSessionID,
              sourceSessionID: target.source.id,
              sourceURLs: target.sourceUrls,
              targetKind: target.kind,
            })
            if (recovered) {
              return (
                `Responded to coordination request ${request.payload.request_id} with redispatch. ` +
                `response=${response.payload.response_id}; action=${recovered.actionID}; ` +
                `deep_research session ${recovered.sessionID} recovered persisted brief ${recovered.artifactID}.`
              )
            }
            let dispatch: Awaited<ReturnType<typeof dispatchDeepResearchStage>>
            try {
              const startedAt = Date.now()
              const preexistingDeepResearchSessionIDs = (await Session.children(input.agentSessionID))
                .filter((session) => session.kind === "deep-research")
                .map((session) => session.id)
              const preexistingResearchBriefArtifactIDs = Database.use((db) =>
                db
                  .select({ id: EngineArtifactTable.id })
                  .from(EngineArtifactTable)
                  .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "research_brief")))
                  .all()
                  .map((row) => row.id),
              )
              await recordAgentCoordinationActionProgress({
                taskID,
                actionID: response.payload.action_id,
                result: {
                  dispatcher: "deep_research_stage",
                  stage: "deep-research",
                  source_session_id: target.source.id,
                  source_urls: target.sourceUrls,
                  target_kind: target.kind,
                  redispatch_started: true,
                  redispatch_started_at: startedAt,
                  preexisting_deep_research_session_ids: preexistingDeepResearchSessionIDs,
                  preexisting_research_brief_artifact_ids: preexistingResearchBriefArtifactIDs,
                },
                summary: "redispatch_worker deep_research stage dispatch started",
                now: startedAt,
              })
              dispatch = await dispatchDeepResearchStage({
                task: target.task,
                targetDeliverable: "research_report",
                sourceUrls: target.sourceUrls,
                focus: guidance,
                reason: [
                  `A2A redispatch_worker for request ${request.payload.request_id}.`,
                  reason.trim(),
                  guidance && guidance.length > 0 ? `Guidance: ${guidance}` : "",
                ]
                  .filter((line) => line.length > 0)
                  .join("\n"),
              })
            } catch (error) {
              await failAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                error,
                result: {
                  dispatcher: "deep_research_stage",
                  stage: "deep-research",
                  source_session_id: target.source.id,
                  source_urls: target.sourceUrls,
                },
                summary: "redispatch_worker deep_research stage dispatch failed",
              })
              throw error
            }
            if (dispatch.status !== "persisted" || !dispatch.sessionID || !dispatch.artifactID) {
              const error = new Error(
                `deep_research_stage redispatch did not persist a research_brief; status=${dispatch.status}`,
              )
              await failAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                error,
                result: {
                  dispatcher: "deep_research_stage",
                  stage: "deep-research",
                  source_session_id: target.source.id,
                  source_urls: target.sourceUrls,
                  dispatch_status: dispatch.status,
                  ...(dispatch.sessionID ? { redispatch_session_id: dispatch.sessionID } : {}),
                },
                summary: "redispatch_worker deep_research stage did not complete",
              })
              return (
                `respond_agent_coordination redispatch failed for request ${request.payload.request_id}: ${error.message}. ` +
                `The request remains pending.`
              )
            }
            await completeAgentCoordinationAction({
              taskID,
              actionID: response.payload.action_id,
              result: {
                dispatcher: "deep_research_stage",
                stage: "deep-research",
                source_session_id: target.source.id,
                redispatch_session_id: dispatch.sessionID,
                research_brief_artifact_id: dispatch.artifactID,
                source_urls: target.sourceUrls,
                target_kind: target.kind,
                started: true,
                recovered_redispatch: false,
              },
              summary: "redispatch_worker deep_research stage completed",
            })
            return (
              `Responded to coordination request ${request.payload.request_id} with redispatch. ` +
              `response=${response.payload.response_id}; action=${response.payload.action_id}; ` +
              `deep_research session ${dispatch.sessionID} persisted brief ${dispatch.artifactID}.`
            )
          }

          if (request.payload.agent === "visual-qa") {
            let target: Awaited<ReturnType<typeof validateAgentCoordinationVisualQaRedispatch>>
            try {
              target = await validateAgentCoordinationVisualQaRedispatch({ taskID, request })
            } catch (error) {
              const detail = error instanceof Error ? error.message : String(error)
              return (
                `respond_agent_coordination refused redispatch: ${detail}. ` +
                `The request ${request.payload.request_id} remains pending until a concrete dispatcher action binding is available.`
              )
            }
            const response = await createAgentCoordinationResponse({
              taskID,
              requestID: request.payload.request_id,
              ...responseAudit,
              decision,
              reason,
              ...(guidance ? { message: guidance } : {}),
              redispatchBinding: {
                dispatcher: "visual_qa_stage",
                stage: "visual-qa",
                target_kind: "visual-qa",
              },
            })
            const replayResult = replayedAgentCoordinationActionResult({ taskID, response })
            if (replayResult) return replayResult
            const recovered = await recoverPendingVisualQaRedispatchAction({
              taskID,
              response,
              orchestratorSessionID: input.agentSessionID,
              sourceSessionID: target.source.id,
              targetKind: target.kind,
            })
            if (recovered) {
              return (
                `Responded to coordination request ${request.payload.request_id} with redispatch. ` +
                `response=${response.payload.response_id}; action=${recovered.actionID}; ` +
                `visual_qa session ${recovered.sessionID} recovered persisted report.`
              )
            }
            let dispatch: Awaited<ReturnType<typeof dispatchVisualQaStage>>
            try {
              const startedAt = Date.now()
              const preexistingVisualQaSessionIDs = (await Session.children(input.agentSessionID))
                .filter((session) => session.kind === "visual-qa")
                .map((session) => session.id)
              const preexistingVisualQaDecisionIDs = Database.use((db) =>
                db
                  .select({ id: DecisionLogTable.id })
                  .from(DecisionLogTable)
                  .where(and(eq(DecisionLogTable.task_id, taskID), eq(DecisionLogTable.phase, "visual_qa")))
                  .all()
                  .map((row) => row.id),
              )
              await recordAgentCoordinationActionProgress({
                taskID,
                actionID: response.payload.action_id,
                result: {
                  dispatcher: "visual_qa_stage",
                  stage: "visual-qa",
                  source_session_id: target.source.id,
                  target_kind: target.kind,
                  redispatch_started: true,
                  redispatch_started_at: startedAt,
                  preexisting_visual_qa_session_ids: preexistingVisualQaSessionIDs,
                  preexisting_visual_qa_decision_ids: preexistingVisualQaDecisionIDs,
                },
                summary: "redispatch_worker visual_qa stage dispatch started",
                now: startedAt,
              })
              dispatch = await dispatchVisualQaStage({
                task: target.task,
                focus: guidance,
                reason: [
                  `A2A redispatch_worker for request ${request.payload.request_id}.`,
                  reason.trim(),
                  `Worker summary: ${request.payload.summary}`,
                  request.payload.details.trim().length > 0 ? `Worker details: ${request.payload.details}` : "",
                  guidance && guidance.length > 0 ? `Guidance: ${guidance}` : "",
                ]
                  .filter((line) => line.length > 0)
                  .join("\n"),
              })
            } catch (error) {
              await failAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                error,
                result: {
                  dispatcher: "visual_qa_stage",
                  stage: "visual-qa",
                  source_session_id: target.source.id,
                },
                summary: "redispatch_worker visual_qa stage dispatch failed",
              })
              throw error
            }
            if (dispatch.status !== "reviewed" || !dispatch.sessionID) {
              const error = new Error(
                `visual_qa_stage redispatch did not produce a visual QA report; status=${dispatch.status}`,
              )
              await failAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                error,
                result: {
                  dispatcher: "visual_qa_stage",
                  stage: "visual-qa",
                  source_session_id: target.source.id,
                  dispatch_status: dispatch.status,
                  ...(dispatch.sessionID ? { redispatch_session_id: dispatch.sessionID } : {}),
                },
                summary: "redispatch_worker visual_qa stage did not complete",
              })
              return (
                `respond_agent_coordination redispatch failed for request ${request.payload.request_id}: ${error.message}. ` +
                `The request remains pending.`
              )
            }
            await completeAgentCoordinationAction({
              taskID,
              actionID: response.payload.action_id,
              result: {
                dispatcher: "visual_qa_stage",
                stage: "visual-qa",
                source_session_id: target.source.id,
                redispatch_session_id: dispatch.sessionID,
                accepted: dispatch.accepted ?? false,
                submitted_accepted: dispatch.submittedAccepted ?? false,
                findings_count: dispatch.findingsCount ?? 0,
                production_blockers_count: dispatch.productionBlockersCount ?? 0,
                evidence_count: dispatch.evidenceCount ?? 0,
                repairs_count: dispatch.repairsCount ?? 0,
                changed_files_count: dispatch.changedFilesCount ?? 0,
                target_kind: target.kind,
                started: true,
                recovered_redispatch: false,
              },
              summary: "redispatch_worker visual_qa stage completed",
            })
            return (
              `Responded to coordination request ${request.payload.request_id} with redispatch. ` +
              `response=${response.payload.response_id}; action=${response.payload.action_id}; ` +
              `visual_qa session ${dispatch.sessionID} recorded report.`
            )
          }

          if (request.payload.agent === "integrity") {
            let target: Awaited<ReturnType<typeof validateAgentCoordinationIntegrityRedispatch>>
            try {
              target = await validateAgentCoordinationIntegrityRedispatch({ taskID, request })
            } catch (error) {
              const detail = error instanceof Error ? error.message : String(error)
              return (
                `respond_agent_coordination refused redispatch: ${detail}. ` +
                `The request ${request.payload.request_id} remains pending until a concrete dispatcher action binding is available.`
              )
            }
            const response = await createAgentCoordinationResponse({
              taskID,
              requestID: request.payload.request_id,
              ...responseAudit,
              decision,
              reason,
              ...(guidance ? { message: guidance } : {}),
              redispatchBinding: {
                dispatcher: "integrity_stage",
                stage: "integrity",
                target_kind: "integrity",
              },
            })
            const replayResult = replayedAgentCoordinationActionResult({ taskID, response })
            if (replayResult) return replayResult
            const recovered = await recoverPendingIntegrityRedispatchAction({
              taskID,
              response,
              orchestratorSessionID: input.agentSessionID,
              sourceSessionID: target.source.id,
              targetKind: target.kind,
            })
            if (recovered) {
              return (
                `Responded to coordination request ${request.payload.request_id} with redispatch. ` +
                `response=${response.payload.response_id}; action=${recovered.actionID}; ` +
                `integrity session ${recovered.sessionID} recovered persisted ${recovered.verdict} review.`
              )
            }
            let outcome: Awaited<ReturnType<typeof runIntegrityReview>>
            try {
              const startedAt = Date.now()
              const preexistingIntegritySessionIDs = (await Session.children(input.agentSessionID))
                .filter((session) => session.kind === "integrity")
                .map((session) => session.id)
              const preexistingIntegrityAttemptArtifactIDs = Database.use((db) =>
                db
                  .select({ id: EngineArtifactTable.id })
                  .from(EngineArtifactTable)
                  .where(
                    and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "integrity_attempt")),
                  )
                  .all()
                  .map((row) => row.id),
              )
              await recordAgentCoordinationActionProgress({
                taskID,
                actionID: response.payload.action_id,
                result: {
                  dispatcher: "integrity_stage",
                  stage: "integrity",
                  source_session_id: target.source.id,
                  target_kind: target.kind,
                  redispatch_started: true,
                  redispatch_started_at: startedAt,
                  preexisting_integrity_session_ids: preexistingIntegritySessionIDs,
                  preexisting_integrity_attempt_artifact_ids: preexistingIntegrityAttemptArtifactIDs,
                },
                summary: "redispatch_worker integrity stage dispatch started",
                now: startedAt,
              })
              outcome = await runIntegrityReview(toolExecution, {
                reason: [
                  `A2A redispatch_worker for request ${request.payload.request_id}.`,
                  reason.trim(),
                  `Worker summary: ${request.payload.summary}`,
                  request.payload.details.trim().length > 0 ? `Worker details: ${request.payload.details}` : "",
                  guidance && guidance.length > 0 ? `Guidance: ${guidance}` : "",
                ]
                  .filter((line) => line.length > 0)
                  .join("\n"),
              })
            } catch (error) {
              await failAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                error,
                result: {
                  dispatcher: "integrity_stage",
                  stage: "integrity",
                  source_session_id: target.source.id,
                },
                summary: "redispatch_worker integrity stage dispatch failed",
              })
              throw error
            }
            if (outcome.status !== "reviewed") {
              const blockedHeadline =
                outcome.status === "blocked"
                  ? outcome.headline
                  : "integrity_stage redispatch produced a continuation recovery result instead of a fresh review"
              const error = new Error(
                `integrity_stage redispatch did not produce an integrity review; ${blockedHeadline}`,
              )
              await failAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                error,
                result: {
                  dispatcher: "integrity_stage",
                  stage: "integrity",
                  source_session_id: target.source.id,
                  dispatch_status: outcome.status,
                },
                summary: "redispatch_worker integrity stage did not complete",
              })
              return (
                `respond_agent_coordination redispatch failed for request ${request.payload.request_id}: ${error.message}. ` +
                `The request remains pending.`
              )
            }
            await completeAgentCoordinationAction({
              taskID,
              actionID: response.payload.action_id,
              result: {
                dispatcher: "integrity_stage",
                stage: "integrity",
                source_session_id: target.source.id,
                redispatch_session_id: outcome.sessionID,
                spec_snapshot_id: outcome.specSnapshotID,
                phase: outcome.phase,
                verdict: outcome.verdict,
                reviewer_count: outcome.reviewerCount,
                findings_count: outcome.findingsCount,
                required_repairs_count: outcome.requiredRepairsCount,
                unresolved_disagreements_count: outcome.unresolvedDisagreementsCount,
                ...(outcome.integrityAttemptID ? { integrity_attempt_id: outcome.integrityAttemptID } : {}),
                ...(outcome.artifactMissing
                  ? {
                      artifact_persistence_status: "artifact_missing",
                      artifact_missing_error: outcome.artifactMissing.error,
                    }
                  : {}),
                target_kind: target.kind,
                started: true,
                recovered_redispatch: false,
              },
              summary: "redispatch_worker integrity stage completed",
            })
            return (
              `Responded to coordination request ${request.payload.request_id} with redispatch. ` +
              `response=${response.payload.response_id}; action=${response.payload.action_id}; ` +
              `integrity session ${outcome.sessionID} recorded ${outcome.verdict} review.`
            )
          }

          return (
            `respond_agent_coordination refused redispatch: agent coordination redispatch for ` +
            `${sessionRole(request.payload.session_id) ?? "unknown"}/${request.payload.agent} requires a concrete ` +
            `stage or tool dispatcher binding. same-kind session redispatch is not an accepted A2A action. ` +
            `The request ${request.payload.request_id} remains pending until a concrete dispatcher action binding is available.`
          )
        }

        if (decision === "cancel_worker") {
          const { kind } = assertDirectReplySessionKind({ sessionID: request.payload.session_id })
          let cancelSummary = ""
          const response = await createAgentCoordinationResponse({
            taskID,
            requestID: request.payload.request_id,
            ...responseAudit,
            decision,
            reason,
            ...(guidance ? { message: guidance } : {}),
          })
          const replayResult = replayedAgentCoordinationActionResult({ taskID, response })
          if (replayResult) return replayResult
          const action = findAgentCoordinationAction({
            taskID,
            actionID: response.payload.action_id,
          })
          if (!action) {
            throw new Error(`agent coordination response ${response.payload.response_id} has no action row`)
          }
          if (action.payload.status !== "pending") {
            throw new Error(`agent coordination action ${response.payload.action_id} is ${action.payload.status}`)
          }
          const latestStatusEvent = findLatestAgentCoordinationSessionStatusEvent({
            taskID,
            sessionID: request.payload.session_id,
          })
          if (latestStatusEvent?.status.type === "terminal") {
            if (latestStatusEvent.status.reason === "aborted") {
              const existingCancelStatus: AgentCoordinationCancelStatusEvent["status"] = {
                type: "terminal",
                reason: "aborted",
                ...(latestStatusEvent.status.error ? { error: latestStatusEvent.status.error } : {}),
              }
              await recordAgentCoordinationActionProgress({
                taskID,
                actionID: response.payload.action_id,
                result: {
                  session_id: request.payload.session_id,
                  kind,
                  cancel_status_event_id: latestStatusEvent.eventID,
                  cancel_status: existingCancelStatus,
                  recovered_cancel_status: true,
                },
                summary: "cancel_worker existing cancellation status preserved",
              })
              await completeAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                result: {
                  session_id: request.payload.session_id,
                  kind,
                  summary: " worker cancellation status was already durable.",
                  cancel_status_event_id: latestStatusEvent.eventID,
                  cancel_status: existingCancelStatus,
                  recovered_cancel_status: true,
                },
                summary: "cancel_worker completed",
              })
              return (
                `Responded to coordination request ${request.payload.request_id} with cancel_worker. ` +
                `response=${response.payload.response_id}; action=${response.payload.action_id}; session=${request.payload.session_id}; kind=${kind}. ` +
                `Recovered existing worker cancellation status ${latestStatusEvent.eventID}.`
              )
            }
            await recordAgentCoordinationActionProgress({
              taskID,
              actionID: response.payload.action_id,
              result: {
                session_id: request.payload.session_id,
                kind,
                terminal_status_event_id: latestStatusEvent.eventID,
                terminal_status: latestStatusEvent.status,
                stale_terminal_worker: true,
              },
              summary: "cancel_worker stale terminal status preserved",
            })
            await completeAgentCoordinationAction({
              taskID,
              actionID: response.payload.action_id,
              result: {
                session_id: request.payload.session_id,
                kind,
                summary: ` worker already terminal (${latestStatusEvent.status.reason}); stale coordination request closed.`,
                terminal_status_event_id: latestStatusEvent.eventID,
                terminal_status: latestStatusEvent.status,
                stale_terminal_worker: true,
              },
              summary: "cancel_worker completed",
            })
            return (
              `Responded to coordination request ${request.payload.request_id} with cancel_worker. ` +
              `response=${response.payload.response_id}; action=${response.payload.action_id}; session=${request.payload.session_id}; kind=${kind}. ` +
              `Preserved existing worker terminal status ${latestStatusEvent.eventID} (${latestStatusEvent.status.reason}).`
            )
          }
          let terminalOwnership: AgentCoordinationTerminalToolOwnership | undefined
          try {
            terminalOwnership = findRequestTerminalToolOwnership({ taskID, request })
          } catch (error) {
            await failAgentCoordinationAction({
              taskID,
              actionID: response.payload.action_id,
              error,
              result: { session_id: request.payload.session_id, kind },
              summary: "cancel_worker failed",
            })
            throw error
          }
          if (terminalOwnership) {
            await recordAgentCoordinationActionProgress({
              taskID,
              actionID: response.payload.action_id,
              result: {
                session_id: request.payload.session_id,
                kind,
                terminal_ownership_id: terminalOwnership.ownershipID,
                terminal_ownership_artifact_id: terminalOwnership.artifactID,
                terminal_ownership_outcome: terminalOwnership.outcome,
                terminal_ownership_completed_at: terminalOwnership.timeCompleted,
                stale_terminal_ownership: true,
              },
              summary: "cancel_worker stale terminal ownership preserved",
            })
            await completeAgentCoordinationAction({
              taskID,
              actionID: response.payload.action_id,
              result: {
                session_id: request.payload.session_id,
                kind,
                summary: ` worker ownership already terminal (${terminalOwnership.outcome}); stale coordination request closed.`,
                terminal_ownership_id: terminalOwnership.ownershipID,
                terminal_ownership_artifact_id: terminalOwnership.artifactID,
                terminal_ownership_outcome: terminalOwnership.outcome,
                terminal_ownership_completed_at: terminalOwnership.timeCompleted,
                stale_terminal_ownership: true,
              },
              summary: "cancel_worker completed",
            })
            return (
              `Responded to coordination request ${request.payload.request_id} with cancel_worker. ` +
              `response=${response.payload.response_id}; action=${response.payload.action_id}; session=${request.payload.session_id}; kind=${kind}. ` +
              `Preserved terminal tool ownership ${terminalOwnership.ownershipID} (${terminalOwnership.outcome}).`
            )
          }
          const recoveredCancelStatus = findAgentCoordinationCancelStatusEvent({
            taskID,
            sessionID: request.payload.session_id,
            afterMs: response.timeCreated,
          })
          if (recoveredCancelStatus) {
            await recordAgentCoordinationActionProgress({
              taskID,
              actionID: response.payload.action_id,
              result: {
                session_id: request.payload.session_id,
                kind,
                cancel_status_event_id: recoveredCancelStatus.eventID,
                cancel_status: recoveredCancelStatus.status,
                recovered_cancel_status: true,
              },
              summary: "cancel_worker cancellation status recovered",
            })
            await completeAgentCoordinationAction({
              taskID,
              actionID: response.payload.action_id,
              result: {
                session_id: request.payload.session_id,
                kind,
                summary: " worker cancellation status was already durable.",
                cancel_status_event_id: recoveredCancelStatus.eventID,
                cancel_status: recoveredCancelStatus.status,
                recovered_cancel_status: true,
              },
              summary: "cancel_worker completed",
            })
            return (
              `Responded to coordination request ${request.payload.request_id} with cancel_worker. ` +
              `response=${response.payload.response_id}; action=${response.payload.action_id}; session=${request.payload.session_id}; kind=${kind}. ` +
              `Recovered existing worker cancellation status ${recoveredCancelStatus.eventID}.`
            )
          }
          try {
            assertDirectReplySessionOwnership({
              taskID,
              sessionID: request.payload.session_id,
              goalID: request.payload.goal_id,
              goalRunID: request.payload.goal_run_id,
            })
            const liveOwner =
              (request.payload.goal_run_id
                ? findLiveBuildOwnershipByGoalRun({ taskID, goalRunID: request.payload.goal_run_id })
                : undefined) ?? findLiveBuildOwnershipBySession({ taskID, sessionID: request.payload.session_id })
            ensureTaskMessageProtocolBridge()
            if (kind === "build" && liveOwner) {
              cancelSummary = await cancelLiveOwnedBuild({
                taskID,
                sessionID: request.payload.session_id,
                goalRunID: request.payload.goal_run_id,
                owner: liveOwner,
                reason,
                reasonPrefix: "respond_agent_coordination",
                originSite: "orchestrator.tools.respond-agent-coordination-cancel-worker",
                metadata: {
                  agent_coordination_request_id: request.payload.request_id,
                  agent_coordination_action_id: response.payload.action_id,
                  cancelled_live_build: true,
                },
              })
            } else if (request.payload.goal_run_id) {
              const aborted = await abortGoalRunExecution({
                taskID,
                goalRunID: request.payload.goal_run_id,
                reason: `respond_agent_coordination: ${reason}`,
              })
              cancelSummary = ` goal_run ${request.payload.goal_run_id} ${aborted.goalRunAborted ? "aborted" : "unchanged"}.`
            } else {
              const aborted = await abortChildExecutionForSession({
                taskID,
                sessionID: request.payload.session_id,
                reason: `respond_agent_coordination: ${reason}`,
              })
              cancelSummary = ` prompt_cancelled=${aborted.promptCancelled}; executor_abort=${aborted.executorAbortAttempted ? (aborted.executorAbortSucceeded ? "ok" : "failed") : "not-applicable"}.`
            }
            let cancelStatusEvent = findAgentCoordinationCancelStatusEvent({
              taskID,
              sessionID: request.payload.session_id,
              afterMs: response.timeCreated,
            })
            if (!cancelStatusEvent) {
              const currentStatus = SessionStatus.get(request.payload.session_id)
              if (currentStatus.type === "terminal" && currentStatus.reason === "aborted") {
                await Bus.publish(SessionStatus.Event.Status, {
                  sessionID: request.payload.session_id,
                  orderKey: sessionLifecycleOrderKey(request.payload.session_id),
                  status: currentStatus,
                })
              } else {
                SessionStatus.set(request.payload.session_id, {
                  type: "terminal",
                  reason: "aborted",
                  error: `respond_agent_coordination: ${reason}`,
                })
              }
              cancelStatusEvent = await waitForAgentCoordinationCancelStatusEvent({
                taskID,
                sessionID: request.payload.session_id,
                afterMs: response.timeCreated,
                reason,
              })
            }
            await recordAgentCoordinationActionProgress({
              taskID,
              actionID: response.payload.action_id,
              result: {
                session_id: request.payload.session_id,
                kind,
                cancel_status_event_id: cancelStatusEvent.eventID,
                cancel_status: cancelStatusEvent.status,
                recovered_cancel_status: false,
              },
              summary: "cancel_worker cancellation status projected",
            })
          } catch (error) {
            await failAgentCoordinationAction({
              taskID,
              actionID: response.payload.action_id,
              error,
              result: { session_id: request.payload.session_id, kind },
              summary: "cancel_worker failed",
            })
            throw error
          }
          await completeAgentCoordinationAction({
            taskID,
            actionID: response.payload.action_id,
            result: { session_id: request.payload.session_id, kind, summary: cancelSummary },
            summary: "cancel_worker completed",
          })
          return (
            `Responded to coordination request ${request.payload.request_id} with cancel_worker. ` +
            `response=${response.payload.response_id}; action=${response.payload.action_id}; session=${request.payload.session_id}; kind=${kind}.` +
            cancelSummary
          )
        }

        if (decision === "ask_user") {
          const response = await createAgentCoordinationResponse({
            taskID,
            requestID: request.payload.request_id,
            ...responseAudit,
            decision,
            reason,
            ...(guidance ? { message: guidance } : {}),
          })
          const replayResult = replayedAgentCoordinationActionResult({ taskID, response })
          if (replayResult) return replayResult
          const action = findAgentCoordinationAction({
            taskID,
            actionID: response.payload.action_id,
          })
          if (!action) {
            throw new Error(`agent coordination response ${response.payload.response_id} has no action row`)
          }
          if (action.payload.status !== "pending") {
            throw new Error(`agent coordination action ${response.payload.action_id} is ${action.payload.status}`)
          }
          const questionItems = questions?.length
            ? questions.map((question) => ({
                question: question.question,
                header: question.header,
                options: question.options ?? [],
                multiple: question.multiple,
                custom: question.custom,
              }))
            : [
                {
                  question:
                    guidance && guidance.length > 0
                      ? guidance
                      : `${reason.trim()}\n\nWorker request: ${request.payload.summary}\n${request.payload.details}`,
                  header: "A2A question",
                  options: [],
                  custom: true,
                },
              ]
          const questionID =
            recordedAgentCoordinationQuestionID(action) ?? agentCoordinationQuestionID(response.payload.action_id)
          let interaction = findInteractionByExternal(questionID)
          if (interaction && interaction.task_id !== taskID) {
            throw new Error(`A2A ask_user question ${questionID} belongs to task ${interaction.task_id}, not ${taskID}`)
          }
          if (interaction && interaction.status !== "pending") {
            if (interaction.status === "answered") {
              const answers = answersFromInteraction(interaction)
              await completeAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                result: {
                  question_id: questionID,
                  interaction_id: interaction.id,
                  interaction_status: interaction.status,
                  answers,
                  recovered: true,
                },
                summary: "ask_user interaction recovered answered",
              })
              const renderedAnswers = questionItems
                .map(
                  (question, index) =>
                    `"${question.question}" -> ${(answers[index] ?? []).join(", ") || "(no answer)"}`,
                )
                .join("\n")
              return (
                `Responded to coordination request ${request.payload.request_id} with ask_user. ` +
                `response=${response.payload.response_id}; action=${response.payload.action_id}; ` +
                `interaction=${interaction.id}; question=${questionID} recovered as answered.\nUser answered:\n${renderedAnswers}`
              )
            }
            await completeAgentCoordinationAction({
              taskID,
              actionID: response.payload.action_id,
              result: {
                question_id: questionID,
                interaction_id: interaction.id,
                interaction_status: interaction.status,
                rejected: true,
                recovered: true,
              },
              summary: "ask_user interaction recovered rejected",
            })
            return (
              `Responded to coordination request ${request.payload.request_id} with ask_user. ` +
              `response=${response.payload.response_id}; action=${response.payload.action_id}; ` +
              `interaction=${interaction.id}; question=${questionID} recovered as ${interaction.status}.`
            )
          }
          let questionPromise: Promise<Question.Answer[]> | undefined
          let setupCompleted = false
          try {
            questionPromise = Question.ask({
              sessionID: input.agentSessionID,
              requestID: questionID,
              questions: questionItems,
              tool: {
                messageID: toolExecution.orchestratorMessageID,
                callID: toolExecution.toolCallID,
              },
            })
            interaction = interaction ?? (await waitForQuestionInteraction({ questionID, taskID }))
            if (recordedAgentCoordinationQuestionID(action) !== questionID) {
              await recordAgentCoordinationActionProgress({
                taskID,
                actionID: response.payload.action_id,
                result: {
                  question_id: questionID,
                  interaction_id: interaction.id,
                  interaction_status: interaction.status,
                },
                summary: "ask_user interaction opened",
              })
            }
            setupCompleted = true
            try {
              const answers = await questionPromise
              const resolvedInteraction = await waitForQuestionInteraction({ questionID, taskID, resolved: true })
              await completeAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                result: {
                  question_id: questionID,
                  interaction_id: interaction!.id,
                  interaction_status: resolvedInteraction.status,
                  answers,
                },
                summary: "ask_user interaction answered",
              })
              const renderedAnswers = questionItems
                .map(
                  (question, index) =>
                    `"${question.question}" -> ${(answers[index] ?? []).join(", ") || "(no answer)"}`,
                )
                .join("\n")
              return (
                `Responded to coordination request ${request.payload.request_id} with ask_user. ` +
                `response=${response.payload.response_id}; action=${response.payload.action_id}; ` +
                `interaction=${interaction!.id}; question=${questionID}.\nUser answered:\n${renderedAnswers}`
              )
            } catch (error) {
              if (error instanceof Question.RejectedError) {
                const resolvedInteraction = await waitForQuestionInteraction({ questionID, taskID, resolved: true })
                await completeAgentCoordinationAction({
                  taskID,
                  actionID: response.payload.action_id,
                  result: {
                    question_id: questionID,
                    interaction_id: interaction!.id,
                    interaction_status: resolvedInteraction.status,
                    rejected: true,
                  },
                  summary: "ask_user interaction rejected",
                })
                return (
                  `Responded to coordination request ${request.payload.request_id} with ask_user. ` +
                  `response=${response.payload.response_id}; action=${response.payload.action_id}; ` +
                  `interaction=${interaction!.id}; question=${questionID}; user rejected the question.`
                )
              }
              await failAgentCoordinationAction({
                taskID,
                actionID: response.payload.action_id,
                error,
                result: { question_id: questionID, ...(interaction ? { interaction_id: interaction.id } : {}) },
                summary: "ask_user interaction failed",
              })
              throw error
            }
          } catch (error) {
            if (setupCompleted) throw error
            await failAgentCoordinationAction({
              taskID,
              actionID: response.payload.action_id,
              error,
              result: { question_id: questionID },
              summary: "ask_user setup failed",
            })
            if (!interaction) {
              await Question.reject(questionID).catch((rejected) => {
                if (NotFoundError.isInstance(rejected as Error)) return
                throw rejected
              })
              if (questionPromise) {
                await questionPromise.catch((rejected) => {
                  if (rejected instanceof Question.RejectedError) return
                  throw rejected
                })
              }
            }
            throw error
          }
        }

        if (decision === "fail_task") {
          const response = await createAgentCoordinationResponse({
            taskID,
            requestID: request.payload.request_id,
            ...responseAudit,
            decision,
            reason,
            ...(guidance ? { message: guidance } : {}),
          })
          const replayResult = replayedAgentCoordinationActionResult({ taskID, response })
          if (replayResult) return replayResult
          const errorText = guidance && guidance.length > 0 ? guidance : reason
          const errorMessage = `A2A request ${request.payload.request_id}: ${errorText}`
          try {
            const { cleaned, recoveredTerminalFailure } = await failCurrentTask({
              error: errorMessage,
              cleanupReason: "respond_agent_coordination.fail_task",
              a2aRequestID: request.payload.request_id,
            })
            await completeAgentCoordinationAction({
              taskID,
              actionID: response.payload.action_id,
              result: {
                task_id: taskID,
                task_status: "failed",
                cleaned_goal_worktrees: cleaned,
                recovered_terminal_failure: recoveredTerminalFailure,
              },
              summary: "fail_task completed",
            })
            return (
              `Responded to coordination request ${request.payload.request_id} with fail_task. ` +
              `response=${response.payload.response_id}; action=${response.payload.action_id}; task=${taskID} failed.` +
              `${recoveredTerminalFailure ? " Recovered existing terminal task failure." : ""}` +
              `${cleaned > 0 ? ` (${cleaned} goal worktree(s) cleaned)` : ""}`
            )
          } catch (error) {
            await failAgentCoordinationAction({
              taskID,
              actionID: response.payload.action_id,
              error,
              result: { task_id: taskID },
              summary: "fail_task failed",
            })
            throw error
          }
        }
      },
    }),

    cancel_subagent: tool({
      description:
        "Abort a specific child agent session, or recover a stale live-owned build via mode='recover_stale'. " +
        "This is the session-level resume rung: cancel the child, then explicitly re-dispatch the SAME goal or stage under the SAME contract before escalating to modify_goal, architect, propose_task, fail_task, or question. " +
        "You may pass session_id directly, goal_id for the latest live attempt, or goal_run_id directly. " +
        "Do not use this to answer a pending A2A coordination request; use respond_agent_coordination decision='cancel_worker' so the cancellation is bound to request/response/action artifacts.",
      inputSchema: z
        .object({
          session_id: z.string().min(1).optional().describe("Child agent session id to cancel."),
          goal_id: z
            .string()
            .min(1)
            .optional()
            .describe("Goal id whose latest live child session should be cancelled."),
          goal_run_id: z
            .string()
            .min(1)
            .optional()
            .describe("Live goal_run id whose child session should be cancelled."),
          mode: z
            .enum(["cancel", "recover_stale"])
            .optional()
            .describe(
              "Use 'cancel' for explicit cancellation. Use 'recover_stale' only when evidence shows a live-owned build is no longer executing; this refuses streaming/retry sessions.",
            ),
          reason: z
            .string()
            .describe("Why this child session must be cancelled before re-dispatching the same stage/goal"),
        })
        .refine((value) => !!value.session_id || !!value.goal_id || !!value.goal_run_id, {
          message: "cancel_subagent requires session_id, goal_id, or goal_run_id",
          path: ["session_id"],
        }),
      execute: async ({ session_id, goal_id, goal_run_id, mode, reason }) => {
        const target = resolveSubagentControlTarget({
          taskID,
          sessionID: session_id,
          goalID: goal_id,
          goalRunID: goal_run_id,
        })
        const { kind } = assertDirectReplySessionOwnership({
          taskID,
          sessionID: target.sessionID,
          goalID: goal_id,
          goalRunID: target.goalRunID,
        })
        const pendingCoordination = listPendingAgentCoordinationSessionControlRequests({
          taskID,
          sessionID: target.sessionID,
          goalRunID: target.goalRunID,
        })
        if (pendingCoordination.length > 0) {
          return (
            `Error: cancel_subagent refused because ${target.source} has pending A2A coordination request(s) ` +
            `${pendingCoordination.map((request) => request.payload.request_id).join(", ")}. ` +
            `Answer the request through respond_agent_coordination with decision="cancel_worker" so the cancellation is bound to visible response/action artifacts.`
          )
        }

        const liveOwner =
          (target.goalRunID ? findLiveBuildOwnershipByGoalRun({ taskID, goalRunID: target.goalRunID }) : undefined) ??
          findLiveBuildOwnershipBySession({ taskID, sessionID: target.sessionID })
        const staleRecovery = mode === "recover_stale"
        if (staleRecovery && kind !== "build") {
          return `Error: cancel_subagent mode='recover_stale' only handles build sessions; ${target.sessionID} has kind=${kind}.`
        }
        if (staleRecovery && kind === "build" && !liveOwner) {
          const targetGoalRun = target.goalRunID ? findGoalRun(target.goalRunID) : undefined
          if (targetGoalRun && isLiveGoalRunStatus(targetGoalRun.status)) {
            return (
              `Error: cancel_subagent mode='recover_stale' refused because ${target.source} has live ` +
              `goal_run ${targetGoalRun.id} status=${targetGoalRun.status}, but no live root build ownership. ` +
              "Root build ownership only proves the dispatch tool lifecycle, not the child build lifecycle. " +
              "Use durable goal_run/session/refill evidence, or use mode='cancel' only for explicit cancellation."
            )
          }
          if (targetGoalRun) {
            return (
              `No live build ownership found for ${target.source}; goal_run ${targetGoalRun.id} is ` +
              `${targetGoalRun.status}. Stale recovery did not mutate the worker.`
            )
          }
          return `No live build ownership found for ${target.source}; no goal_run lifecycle fact was available to recover.`
        }
        if (kind === "build" && liveOwner) {
          if (staleRecovery) {
            const currentStatus = SessionStatus.get(target.sessionID)
            if (currentStatus.type === "streaming" || currentStatus.type === "retry") {
              return (
                `Error: cancel_subagent refused stale recovery because build session ${target.sessionID} is ${currentStatus.type}. ` +
                "Leave the live child running and return to this orchestration only after terminal refill or operator evidence, or use mode='cancel' for explicit operator cancellation."
              )
            }
          }
          const goalFact = await cancelLiveOwnedBuild({
            taskID,
            sessionID: target.sessionID,
            goalRunID: target.goalRunID,
            owner: liveOwner,
            reason,
            originSite: staleRecovery
              ? "orchestrator.tools.cancel-subagent-stale-recovery"
              : "orchestrator.tools.cancel-subagent-live-build",
            metadata: staleRecovery ? { stale_recovery: true } : { cancelled_live_build: true },
          })
          return (
            `${staleRecovery ? "Recovered stale live-owned build" : "Cancelled live-owned build session"} ${target.sessionID} (kind=${kind}). ` +
            `source=${target.source}. ownership=${liveOwner.ownershipID}. Reason: ${reason}.` +
            goalFact +
            " If you still need work from it, re-dispatch the same stage/goal under the same contract explicitly."
          )
        }

        const aborted = target.goalRunID
          ? await abortGoalRunExecution({
              taskID,
              goalRunID: target.goalRunID,
              reason: `cancel_subagent: ${reason}`,
            })
          : await abortChildExecutionForSession({
              taskID,
              sessionID: target.sessionID,
              reason: `cancel_subagent: ${reason}`,
            })
        const abortedFact =
          aborted.goalRunAborted || aborted.executorAbortAttempted
            ? ` goal_run ${target.goalRunID ?? "(unknown)"} ${aborted.goalRunAborted ? "aborted" : "unchanged"}` +
              `${aborted.executorAbortAttempted ? `; executor_abort=${aborted.executorAbortSucceeded ? "ok" : "failed"}` : ""}.`
            : ""

        return (
          `Cancelled sub-agent session ${target.sessionID} (kind=${kind}). ` +
          `source=${target.source}. Reason: ${reason}.` +
          `${abortedFact} If you still need work from it, re-dispatch the same stage/goal under the same contract explicitly.`
        )
      },
    }),

    refine: tool({
      description: [
        "Explore the completed project, analyze what was built, and suggest improvements for the next iteration.",
        "Use after task completion (or user re-trigger) to start a new development cycle.",
        "Reads all goal deliveries, explores the codebase, and produces structured suggestions.",
        "After receiving suggestions, surface them in your reply for the user.",
      ].join("\n"),
      inputSchema: z.object({
        focus: z
          .enum(["features", "quality", "tests", "performance", "all"])
          .default("all")
          .describe("What aspect to focus the analysis on"),
        reason: z.string().optional().describe("Why you decided to refine"),
      }),
      execute: async ({ focus }) => {
        await trackStepStart("refine")
        const task = requireTask(taskID)

        // Gather acceptance context
        const goals = listGoals(taskID)
        const { listGoalRunsForTask, findAcceptanceByGoalRun } = await import("@/engine/store")
        const goalRuns = listGoalRunsForTask(taskID)

        const goalSummaries: string[] = []
        const allChangedFiles: string[] = []
        for (const goal of goals) {
          const gr = goalRuns.find((r) => r.goal_id === goal.id)
          const acceptance = gr ? findAcceptanceByGoalRun(gr.id) : undefined
          const files = (acceptance?.result as any)?.diffs?.map((d: any) => d.file) ?? []
          allChangedFiles.push(...files)
          goalSummaries.push(
            `- [${goalStatusByID(goal.id)}] ${goal.title}: ${renderSpecsAsText((goal.acceptance_specs ?? []) as AcceptanceSpec[]).slice(0, 300)}`,
          )
          if (files.length > 0) goalSummaries.push(`  files: ${files.join(", ")}`)
        }

        // Read Decision Log for architectural context. Refine runs once per
        // task (not per turn), but an unbounded decision log can still push
        // this prompt past the model context; cap is the shared
        // DECISION_LOG_PROMPT_LIMIT (single source — previously a divergent
        // literal 30, a rule-8 double-source). Refine is a rework step, so it
        // intentionally keeps `phase:"review"` — prior verdicts are its repair
        // signal, unlike the integrity reviewer which must stay independent.
        const { createDecisionLog, DECISION_LOG_PROMPT_LIMIT } = await import("@/decision-log")
        const decisionLog = createDecisionLog(taskID)
        const decisionSection = decisionLog.toPromptSection({ limit: DECISION_LOG_PROMPT_LIMIT }) ?? ""

        // Run refine analysis via SessionPrompt. No tools, plain text
        // generation driven by system + user prompts; the child session
        // persists transcript for the overlay.
        const model = await resolveAgentModel("orchestrator", { taskID })

        const refineSession = await Session.createNext({
          kind: "assistant",
          parentID: input.agentSessionID,
          title: `Refine: ${task.title}`,
          directory: Instance.directory,
        })
        const RefineResultSchema = z.object({
          summary: z.string(),
          suggestions: z.array(
            z.object({
              category: z.enum(["feature", "quality", "test", "performance", "refactor"]),
              title: z.string(),
              description: z.string(),
              priority: z.enum(["high", "medium", "low"]),
              effort: z.enum(["small", "medium", "large"]),
            }),
          ),
        })

        const systemPrompt = [
          "You are a project analyst reviewing a completed software project.",
          "Analyze the delivered code and suggest concrete improvements for the next iteration.",
          "Use the required StructuredOutput schema for the final assessment and suggestions.",
          "",
          `Focus: ${focus}`,
          "Respond in the same language as the original task request.",
        ].join("\n")

        const userPrompt = [
          `## Original Task`,
          renderUserRequestSection({ heading: "## Original Task Request", request: task.request, taskID }),
          "",
          `## Completed Goals (${goals.length})`,
          ...goalSummaries,
          "",
          `## Changed Files (${allChangedFiles.length})`,
          allChangedFiles.join(", "),
          "",
          decisionSection,
        ].join("\n")

        let finalMessage: Awaited<ReturnType<typeof SessionPrompt.prompt>>
        try {
          finalMessage = await SessionPrompt.prompt({
            sessionID: refineSession.id,
            model: { providerID: model.providerID, modelID: model.api.id },
            agent: "general",
            system: systemPrompt,
            systemMode: "complete",
            parts: [{ type: "text", text: userPrompt, id: Identifier.ascending("part") }],
            format: {
              type: "json_schema",
              schema: z.toJSONSchema(RefineResultSchema) as Record<string, any>,
              retryCount: 1,
            },
          })
        } catch (err) {
          // Refine dispatch boundary — surface terminal to overlay so the
          // refine card flips out of `running` when this single dispatch
          // ends, mirroring agent/runner.ts.
          SessionStatus.set(refineSession.id, {
            type: "terminal",
            reason: "error",
            error: err instanceof Error ? err.message : String(err),
          })
          throw err
        }
        const parsed =
          finalMessage.info.role === "assistant" && finalMessage.info.structured
            ? RefineResultSchema.safeParse(finalMessage.info.structured)
            : { success: false as const, error: new Error("refine session ended without StructuredOutput") }
        if (!parsed.success) {
          const error = parsed.error instanceof z.ZodError ? z.prettifyError(parsed.error) : parsed.error.message
          SessionStatus.set(refineSession.id, { type: "terminal", reason: "error", error })
          throw new Error(`refine: LLM did not return schema-valid StructuredOutput. ${error}`)
        }

        await trackStepComplete("refine")
        SessionStatus.set(refineSession.id, { type: "terminal", reason: "completed" })

        const suggestions = parsed.data.suggestions
        const summaryRaw = parsed.data.summary
        const suggestionLines = suggestions.map(
          (s) =>
            `[${s.priority ?? "?"}] ${s.title ?? "(untitled)"} (${s.category ?? "?"}, ${s.effort ?? "?"}): ${s.description ?? ""}`,
        )
        return SubAgentProtocol.yieldResult({
          headline:
            "Project Analysis complete. To start the next iteration: surface these suggestions to the user " +
            "and let them pick which to roll into a new task.",
          summary: summaryRaw,
          fields: [["suggestions", suggestionLines]],
          pointer: "refine session id (full LLM output) — narrow focus param and re-run to see filtered subsets",
        })
      },
    }),

    question: tool({
      description:
        "Ask the user one or more clarification questions and block until they answer. " +
        "The questions appear in the task's InteractionPanel (with option buttons + free-text input). " +
        "Use SPARINGLY — only when you genuinely cannot proceed without a human decision. " +
        "Valid triggers: (1) incoming request is too vague for requirements decomposition, " +
        "(2) mid-execute missing critical info (tech stack, data source, conflicting goals), " +
        "(3) before final integrity review you have multiple viable approaches and need the user to pick, " +
        "(4) post-refine suggestions — let the user select which improvements to roll in. " +
        "Each question may provide options for click-selection; omit options for free-text. " +
        "Set multiple=true to allow multi-select. Returns the answers in the same order as questions. " +
        "Timeout: 5 minutes; rejected questions throw an error you must handle.",
      inputSchema: z.object({
        questions: z
          .array(
            z.object({
              question: z.string().describe("The complete question text to show the user."),
              header: z.string().describe("Short label (≤30 chars) used as a chip/title."),
              options: z
                .array(
                  z.object({
                    label: z.string().describe("Display text (1-5 words)."),
                    description: z.string().describe("Explanation of this choice."),
                  }),
                )
                .default([])
                .describe("Click-selectable options. Leave empty for free-text-only answers."),
              multiple: z.boolean().optional().describe("Allow multi-select (default false)."),
              custom: z.boolean().optional().describe("Allow a custom typed answer (default true)."),
            }),
          )
          .min(1)
          .max(4)
          .describe("1-4 questions to ask in a single turn."),
        reason: z.string().optional().describe("Why you're asking (short, shown in logs — not to the user)."),
      }),
      execute: async ({ questions, reason }) => {
        log.info("question", { taskID, count: questions.length, reason })
        const { output } = await Question.askAndFormat({
          sessionID: input.agentSessionID,
          questions: questions.map((q) => ({
            question: q.question,
            header: q.header,
            options: q.options ?? [],
            multiple: q.multiple,
            custom: q.custom,
          })),
        })
        return output
      },
    }),

    propose_task: tool({
      description:
        "Create one polished inheriting engine task from concrete current-task evidence. " +
        "This is the orchestrator's ONLY new-engine-task creation path: it follows `experimental.auto_confirm_proposed_tasks`, " +
        "creating directly by default and asking the user first only when auto-confirm is disabled. Do not call generic `task` or control-plane `panel`. " +
        "Independent child tasks may run in parallel when their scopes do not depend on each other's output, artifact state, decisions, or owned files. Dependent follow-up work must queue or wait for its prerequisite instead of starting in parallel. Use it when execution evidence, artifact state, integrity history, visual QA evidence, or operator scope change proves separate inheriting work is required. " +
        "A proposed task must solve a very specific code-module problem: submit `code_module_reference` with one concrete code module reference entity such as a file path, component, tool, service, route, schema, table, class, or function, plus the observed problem for that entity. Refuse generic follow-up work that has no structured code module reference; it cannot be solved by creating a child task. " +
        "Workflow tasks do not rewind earlier stages in place: when the active workflow contract is fundamentally wrong and cannot be repaired by modify_goal, architect, or targeted build inside the current task, create a new inheriting workflow task instead of rerunning requirements/plan/executor. " +
        "Use it when failed visual_qa evidence reports unresolved_code_module_problems for unrepairable production blockers and the scheduler decides the problem belongs in separate inheriting work. " +
        "It is also the right path when reviewers keep demanding a capability the original user request never authorised, and adding it inside the current task would expand scope beyond what the user agreed to.",
      inputSchema: z.object({
        title: z.string().min(1).describe("Concise title for the proposed new task."),
        request: z
          .string()
          .min(1)
          .describe(
            "Complete, self-contained request for the proposed new task. Must name the concrete code module reference entity and describe the specific observed problem it must solve.",
          ),
        reason: z
          .string()
          .min(1)
          .describe(
            "Evidence-backed reason this should inherit from the current task as separate follow-up work instead of changing the current task. Must include or point to the concrete code module reference entity.",
          ),
        code_module_reference: ProposedTaskCodeModuleReferenceSchema.describe(
          "Required concrete code module reference entity and observed problem. This is the scheduler-owned child-task admission contract; do not infer it from generic prose.",
        ),
        priority: z
          .enum(["critical", "high", "normal", "low"])
          .describe("Priority for the proposed follow-up task. Defaults to normal when no urgency evidence exists.")
          .default("normal"),
        queue: z
          .boolean()
          .default(false)
          .describe(
            "Set false only for independent follow-up work that can start immediately. Set true when this follow-up depends on prerequisite work or should otherwise wait in the directory queue.",
          ),
        kind: z
          .enum(["workflow", "build"])
          .describe(
            "Task engine kind for the follow-up: workflow for planned multi-stage work, build for direct execution.",
          )
          .default("workflow"),
      }),
      execute: async ({ title, request, reason, code_module_reference, priority, queue, kind }) => {
        const task = requireTask(taskID)
        if (!hasConcreteProposedTaskCodeModuleReference(code_module_reference)) {
          return SubAgentProtocol.yieldResult({
            headline: "Follow-up task proposal rejected.",
            summary:
              "propose_task requires a very specific code-module problem before a child task can be created. " +
              "The scheduler input must include code_module_reference.entity as the concrete code module reference entity and code_module_reference.problem as the observed problem. " +
              "Generic follow-up work without a structured concrete code module reference cannot be solved by creating a child task; no new task was created.",
            fields: [
              ["proposal", title],
              ["reason", reason],
              ["required", "code_module_reference.entity plus code_module_reference.problem"],
            ],
            pointer: `current task ${taskID}; no new task was created`,
          })
        }
        const cfg = await EffectiveConfig.effective({ taskID, sessionID: input.agentSessionID })
        const autoConfirmProposedTasks = cfg.experimental?.auto_confirm_proposed_tasks === true
        log.info("propose_task requested", { taskID, title, priority, kind, autoConfirmProposedTasks })
        if (!autoConfirmProposedTasks) {
          const { output, answers } = await Question.askAndFormat({
            sessionID: input.agentSessionID,
            questions: [
              {
                header: "新任务",
                question: `是否创建这个新任务？\n\n${title}\n\n${request}`,
                options: [
                  {
                    label: "创建任务",
                    description: "确认后立即提交为一个新的任务。",
                  },
                  {
                    label: "不创建",
                    description: "保留当前任务，不提交新的任务。",
                  },
                ],
                multiple: false,
                custom: false,
              },
            ],
          })
          const selected = answers?.[0]?.[0]
          if (selected !== "创建任务") {
            return SubAgentProtocol.yieldResult({
              headline: "Follow-up task proposal was not created.",
              summary: output,
              fields: [
                ["proposal", title],
                ["reason", reason],
                ["selection", selected ?? "dismissed"],
              ],
              pointer: `current task ${taskID}; no new task was created`,
            })
          }
        }
        const requestID =
          "orchestrator-proposed-task:" +
          taskID +
          ":" +
          createHash("sha256").update(`${title}\0${request}`).digest("hex").slice(0, 16)
        const inheritedModel = await resolveConfiguredModelRef({ taskID, sessionID: input.agentSessionID })
        const newTaskID = await EngineService.createSchedulerChildTask({
          parentTaskID: taskID,
          requestID,
          title,
          request,
          priority,
          queue,
          kind,
          executor: task.executor,
          model: `${inheritedModel.providerID}/${inheritedModel.modelID}`,
          source: "orchestrator:propose_task",
          metadata: {
            origin: "orchestrator_proposed_task",
            inheritance: "orchestrator_follow_up",
            proposal_reason: reason,
            code_module_reference,
          },
        })
        createDecisionLog(taskID).append({
          phase: "orchestrator",
          key: `proposed_task_${Date.now()}`,
          value: `Created follow-up task ${newTaskID}: ${title}\n\nReason: ${reason}`,
          reason: "propose_task_confirmed",
        })
        return SubAgentProtocol.yieldResult({
          headline: autoConfirmProposedTasks
            ? "Follow-up task created automatically."
            : "Follow-up task created after user confirmation.",
          fields: [
            ["new_task_id", newTaskID],
            ["title", title],
            ["kind", kind],
            ["priority", priority],
            ["queue", queue === true ? "true" : "false"],
            ["parent_task_id", taskID],
          ],
          pointer: `new task ${newTaskID}; parent task ${taskID}`,
        })
      },
    }),

    build: tool({
      description:
        "Implementation dispatcher. Runs the build agent (read / write / edit / bash) in-process to apply " +
        "one scoped change. Two valid shapes exist. `build({ goalID })` is the normal workflow " +
        "shape after architect has registered goals. On retry/rework, omit `request` when persisted " +
        "failure facts already exist; the build retry message is composed from those facts only. " +
        "Retry context recovery is selected from durable prior-session evidence: resumable sessions " +
        "are resumed, while typed non-resumable context failures open a fresh child session on the same " +
        "recorded goal worktree. Do not express this through `reason`, `request`, or a `freshContext` field. " +
        "Use `request` for a per-goal retry only when you have one exact new operator/error fact that " +
        "is not already in persisted build, acceptance, or integrity evidence. `build({ request, directBuildIntent })` without goalID is a task-level " +
        "direct implementation build. It is supported for explicit `kind=build` tasks, whole-task rework after " +
        "acceptance rejection, and rare operator/orchestrator decisions to bypass goal decomposition for a scoped " +
        "workflow implementation task. It also owns same-task stuck-state repairs that require file edits: " +
        "dependency materialization, package metadata/scripts, local dependency wiring, Playwright/browser " +
        "configuration, dynamic port selection, runtime/tool configuration, product fixes proven by verification, " +
        "and unfinished MERGING state inside a goal worktree. It is not a repository investigation tool. For " +
        "fresh `kind=workflow` tasks, requirements → architect → per-goal build remains the recommended path " +
        "when the request needs durable requirements, goal contracts, or decomposition. Fresh workflow direct " +
        "builds must declare directBuildIntent='modify_files' for scoped implementation. Repository investigation " +
        "belongs to analyze_intent, requirements, or the registered explore subagent surface; do not route that work " +
        "through build. " +
        "For `build({ goalID })`, the tool returns after the child build session and goal_run have started; terminal completion arrives later as goal_run/acceptance/decision-log evidence and a terminal refill wake. " +
        "For task-level direct builds, the tool returns the terminal build report. Build does NOT auto-complete " +
        "workflow tasks. The final review is `integrity`, and it is valid only after all blocking builds " +
        "are terminal. A post-build pass returns evidence for explicit complete_task; non-pass integrity returns session-bound review evidence to this same reasoning turn; " +
        'choose the next action from that evidence. If read_context({scope:"integrity_history"}) surfaces integrity status=artifact_missing, ' +
        "recover that artifact or get explicit user confirmation before continuing from stale integrity data. " +
        "DO NOT USE FOR: multi-file features, UI replication from designs, anything with explicit acceptance " +
        "criteria, cross-module refactors, new subsystems — those go through requirements → architect → " +
        "per-goal build → integrity (the pipeline workflow). Frontend evidence tools are available candidates " +
        "when the full task context needs visual/reference material for build dispatch.",
      inputSchema: z
        .object({
          request: z
            .string()
            .optional()
            .describe(
              "For per-goal builds: omit on normal retry when persisted build, acceptance, or integrity failure facts already identify the error. Populate only with one exact new operator/error fact not already persisted. It does not replace the goal's objective / acceptance_specs / owned_paths. For task-level direct builds (no goalID): required; include the user's request plus concise rejected acceptance details the build agent must address.",
            ),
          reason: z
            .string()
            .describe(
              "One sentence explaining why this build is valid now: explicit kind=build, per-goal pipeline execution, post-acceptance whole-task rework, or a conscious direct-build decision for this workflow task.",
            ),
          goalID: z
            .string()
            .optional()
            .describe(
              "Optional goal id this build is scoped to. Set when build is invoked as a per-goal worker inside the pipeline workflow. Omit for task-level direct builds.",
            ),
          directBuildIntent: z
            .literal("modify_files")
            .optional()
            .describe(
              "Required for task-level direct builds on kind=workflow tasks. The only valid direct intent is modify_files: a scoped implementation/rework build. Build is not a repository investigation endpoint.",
            ),
          userConfirmedStaleIntegrityData: z
            .boolean()
            .optional()
            .describe(
              "Set true only after the user explicitly confirmed continuing while the latest completed integrity session is status=artifact_missing and its durable integrity_attempt artifact could not be recovered.",
            ),
        })
        .strict(),
      execute: async (
        { request = "", reason, goalID, directBuildIntent, userConfirmedStaleIntegrityData },
        options,
      ) => {
        const toolExecution = requireOrchestratorToolExecutionContext(options, "build")
        const task = requireTask(taskID)
        const requestText = request.trim()
        const declaredDirectBuildIntent = directBuildIntent as string | undefined
        log.info("build tool invoked", {
          taskID,
          reason,
          requestLen: request.length,
          goalID: goalID || "",
          directBuildIntent: declaredDirectBuildIntent ?? "",
        })

        const missingIntegrityArtifact = findLatestIntegrityArtifactMissingStatus(taskID)
        if (missingIntegrityArtifact && userConfirmedStaleIntegrityData !== true) {
          return (
            `build: blocked by integrity artifact_missing for session ${missingIntegrityArtifact.sessionID}. ` +
            `A completed integrity session has no durable integrity_attempt artifact yet, so the previous artifact is not current data. ` +
            `Recover the artifact or ask the user whether to continue from stale integrity data; then set userConfirmedStaleIntegrityData=true only after that explicit confirmation.`
          )
        }

        // Inherit goalID from the parent agent session if one isn't explicitly
        // passed — this nests the build card under the originating goal in the
        // overlay instead of floating at the conversation root.
        const inheritedGoalID = sessionGoalID(input.agentSessionID)
        const goalReference = goalID || inheritedGoalID
        const resolvedGoalReference = goalReference ? resolveGoalReferenceForBuild(goalReference) : undefined
        if (resolvedGoalReference && !resolvedGoalReference.ok) return resolvedGoalReference.message
        const attachedGoalID = resolvedGoalReference?.goalID
        const isTaskLevelBuild = !attachedGoalID
        if (attachedGoalID) {
          assertNoLiveGoalRunForBuild({
            taskID,
            goalID: attachedGoalID,
            action: "build",
          })
        }

        if (isTaskLevelBuild) {
          if (requestText.length === 0) {
            return `build: rejected task-level build. request is required when build is not scoped to a goal.`
          }
          if (declaredDirectBuildIntent && declaredDirectBuildIntent !== "modify_files") {
            return (
              `build: rejected task-level build. directBuildIntent="${declaredDirectBuildIntent}" is not supported; ` +
              `build is implementation-only. Repository investigation belongs to analyze_intent, requirements, or explore.`
            )
          }
          if (task.kind === "workflow") {
            if (!declaredDirectBuildIntent) {
              return (
                `build: rejected task-level workflow build. directBuildIntent is required when build is not scoped ` +
                `to a goal; use directBuildIntent="modify_files" for scoped direct implementation. ` +
                `Repository investigation belongs in analyze_intent, requirements, or explore.`
              )
            }
          }
          await switchExplicitBuildTaskToDirectWorkflow(attachedGoalID)
          await trackStepStart("build")
        }

        // Phase 5-c: delegate to BuildAgent.run. It owns the child session
        // (kind=build), creates an isolated worktree (parallel-safe for
        // multi-goal fan-out), gates concurrency via AgentSemaphore, and
        // returns a structured BuildResult the orchestrator can judge.
        //
        // For goalID path, build the structured BuildTarget from the DB row
        // so the agent receives acceptance_specs / owned_paths / depends_on
        // directly. For pure request path, the LLM-supplied `request` is
        // the user message.
        //
        // Coordinator Run lazy-create: build is the dispatcher, so every
        // implementation build owns the run that later anchors acceptance
        // evidence. Goal-scoped builds create a dispatchable run from the
        // active goal graph; task-level direct builds create a run without a
        // plan_version_id because there is intentionally no goal graph.
        if (attachedGoalID) {
          const { findGoal } = await import("@/engine/store")
          const goal = findGoal(attachedGoalID)
          if (!goal) {
            if (isTaskLevelBuild) await trackStepComplete("build", undefined, true)
            return missingResolvedGoalMessage(attachedGoalID)
          }
          const activeSpec = findActiveSpecForTask(taskID)
          if (!activeSpec) {
            if (isTaskLevelBuild) await trackStepComplete("build", undefined, true)
            return `build: goal ${attachedGoalID} has no active spec snapshot. Re-run requirements/architect before dispatching build.`
          }
          if (goal.spec_snapshot_id !== activeSpec.id) {
            if (isTaskLevelBuild) await trackStepComplete("build", undefined, true)
            return (
              `build: goal ${attachedGoalID} belongs to superseded spec ${goal.spec_snapshot_id ?? "null"} ` +
              `while active spec is ${activeSpec.id}. Re-read the active goal graph before dispatching build.`
            )
          }
          const dependencyBlockers = (Array.isArray(goal.depends_on) ? (goal.depends_on as string[]) : [])
            .map((depID) => ({ depID, status: goalDependencyDispatchState(depID) }))
            .filter((dep) => dep.status !== "passed")
          if (dependencyBlockers.length > 0) {
            if (isTaskLevelBuild) await trackStepComplete("build", undefined, true)
            return (
              `build: goal ${attachedGoalID} is blocked by unfinished dependencies: ` +
              dependencyBlockers.map((dep) => `${dep.depID}=${dep.status}`).join(", ") +
              `. Re-read collaboration_closure and dispatch only goals whose dependencies are passed.`
            )
          }
        }

        let coordinatorRunID: string | undefined
        if (attachedGoalID) {
          const ensured = await ensureDispatchableRunForSingleGoal()
          if ("error" in ensured) {
            if (isTaskLevelBuild) await trackStepComplete("build", undefined, true)
            return `build: cannot ensure coordinator run for goal ${attachedGoalID} — ${ensured.error}`
          }
          coordinatorRunID = ensured.run.id
        } else {
          const ensured = await ensureTaskLevelBuildRun()
          if ("error" in ensured) {
            if (isTaskLevelBuild) await trackStepComplete("build", undefined, true)
            return `build: cannot ensure task-level run — ${ensured.error}`
          }
          coordinatorRunID = ensured.run.id
        }

        let activeOwnership: OrchestratorToolOwnershipPayload | undefined
        let ownershipClosed = false
        const closeBuildOwnership = (outcome: "completed" | "failed" | "cancelled", error?: string) => {
          if (!activeOwnership || ownershipClosed) return
          ownershipClosed = true
          completeOrchestratorToolOwnership({
            taskID,
            ownershipID: activeOwnership.ownership_id,
            outcome,
            error,
          })
        }

        try {
          const { BuildAgent, collectGoalContributionDiffs } = await import("@/build/agent")
          const { Worktree } = await import("@/worktree")
          let target: import("@/build/types").BuildTarget
          let context: import("@/build/agent").BuildAgent.BuildContext | undefined
          let managedWorktree: import("@/build/agent").BuildAgent.RunInput["managedWorktree"] | undefined
          let existingBuildSessionID: string | undefined
          if (attachedGoalID) {
            const { findGoal, findRequirements, listGoals, findGoalLatestWorkspace } = await import("@/engine/store")
            const goal = findGoal(attachedGoalID)
            if (!goal) {
              if (isTaskLevelBuild) await trackStepComplete("build", undefined, true)
              return missingResolvedGoalMessage(attachedGoalID)
            }
            const activeSpec = findActiveSpecForTask(taskID)
            if (!activeSpec) {
              if (isTaskLevelBuild) await trackStepComplete("build", undefined, true)
              return `build: goal ${attachedGoalID} has no active spec snapshot. Re-run requirements/architect before dispatching build.`
            }
            if (goal.spec_snapshot_id !== activeSpec.id) {
              if (isTaskLevelBuild) await trackStepComplete("build", undefined, true)
              return (
                `build: goal ${attachedGoalID} belongs to superseded spec ${goal.spec_snapshot_id ?? "null"} ` +
                `while active spec is ${activeSpec.id}. Re-read the active goal graph before dispatching build.`
              )
            }
            const contractGraph = findLatestArchitectContractGraph(taskID)
            if (!contractGraph) {
              throw new Error(
                `Cannot build goal ${goal.id}: missing architect_contract_graph artifact for task ${taskID}. ` +
                  "Re-run architect so dependency reasons and graph contracts are available before build.",
              )
            }
            const priorGoalRunForRetry = findLatestTipGoalRun(attachedGoalID)

            const siblingGoals = listGoals(taskID)
            const contractAuditUnknownContractFindings = validateArchitectContractGraph({
              goals: siblingGoals.map((g) => ({
                id: g.id,
                depends_on: g.depends_on as string[],
                acceptance_specs: g.acceptance_specs as AcceptanceSpec[],
              })),
              graph: contractGraph,
            }).filter((finding) => finding.code === "contract_audit_unknown_contract")
            if (contractAuditUnknownContractFindings.length > 0) {
              throw new Error(
                `Cannot build goal ${goal.id}: architect contract_audit references unknown graph contract ids. ` +
                  `${contractAuditUnknownContractFindings.map((finding) => finding.message).join(" ")} ` +
                  "Re-run architect so contract_audit.contract_ids are copied from registered graph contract ids.",
              )
            }
            // Phase B (2026-05-05): persistent worktree pointer comes from
            // the latest goal_run_attempt artifact, not engine_goal columns.
            // findGoalLatestWorkspace returns the triple from the newest
            // payload — null when no attempt has run yet OR when terminal
            // cleanup nulled the pointer.
            const recorded = findGoalLatestWorkspace(attachedGoalID)
            const recordedWorkspaceDir = recorded.directory?.trim() ?? ""
            const recordedWorkspaceBranch = recorded.branch?.trim() ?? ""
            const recordedWorkspaceBaseRef = recorded.baseRef ?? null
            if (recordedWorkspaceDir || recordedWorkspaceBranch) {
              if (!recordedWorkspaceDir || !recordedWorkspaceBranch) {
                return (
                  `build: goal ${attachedGoalID} has inconsistent workspace metadata ` +
                  `(workspace_dir=${recordedWorkspaceDir || "null"}, ` +
                  `workspace_branch=${recordedWorkspaceBranch || "null"}). ` +
                  `This is a structural error; clean or reset the goal workspace explicitly.`
                )
              }
              const valid = await Worktree.isValid(recordedWorkspaceDir)
              if (!valid.valid) {
                const recovered = await Worktree.recoverRecorded({
                  directory: recordedWorkspaceDir,
                  branch: recordedWorkspaceBranch,
                })
                if (recovered.status !== "recovered") {
                  return (
                    `build: recorded workspace for goal ${attachedGoalID} is invalid: ` +
                    `${recordedWorkspaceDir} (${valid.reason ?? "unknown reason"}). ` +
                    `Automatic reattach failed: ${recovered.reason}. Preserve that directory and fix or reset the goal workspace explicitly.`
                  )
                }
                managedWorktree = {
                  directory: recovered.directory,
                  branch: recovered.branch,
                  baseRef: recordedWorkspaceBaseRef,
                }
                // Phase G (2026-05-05): the recovered pointer rides the new
                // attempt artifact via beginBuildAttempt below — no extra
                // updateGoalWorkspace write needed. The previous explicit
                // call routed through the synthetic-runID createGoalRun
                // branch when a tip happened to be missing; both branches
                // are now redundant since beginBuildAttempt always carries
                // the workspace triple.
                log.warn("reattached invalid goal workspace before build", {
                  goalID: goal.id,
                  reason: valid.reason ?? "unknown reason",
                  workspaceDir: recovered.directory,
                  workspaceBranch: recovered.branch,
                })
              }
              if (!managedWorktree) {
                managedWorktree = {
                  directory: recordedWorkspaceDir,
                  branch: recordedWorkspaceBranch,
                  baseRef: recordedWorkspaceBaseRef,
                }
              }
            } else {
              if (priorGoalRunForRetry && !isLiveGoalRunStatus(priorGoalRunForRetry.status)) {
                throw new Error(
                  `build: goal ${attachedGoalID} prior terminal goal_run ${priorGoalRunForRetry.id} has no recorded worktree; fresh context retry cannot reuse worktree.`,
                )
              }
              const info = await Worktree.create({
                name: `goal-${goal.id.slice(-8)}`,
                taskID,
                goalID: goal.id,
                runID: coordinatorRunID ?? taskID,
              })
              managedWorktree = {
                directory: info.directory,
                branch: info.branch,
                baseRef: null,
              }
              // Phase G (2026-05-05): see comment above. The freshly created
              // worktree's pointer flows into the first goal_run_attempt
              // artifact via beginBuildAttempt — the prior pre-attempt
              // updateGoalWorkspace call hit the no-tip synthetic-runID
              // branch and was a no-op once the artifact landed.
            }
            if (priorGoalRunForRetry && !isLiveGoalRunStatus(priorGoalRunForRetry.status)) {
              const selectedBuildSession = await selectGoalBuildRetrySession({
                goalID: attachedGoalID,
                priorGoalRun: priorGoalRunForRetry,
                managedWorktree,
                executor: task.executor,
              })
              existingBuildSessionID = selectedBuildSession.existingSessionID
              if (!existingBuildSessionID) {
                if (!managedWorktree?.directory) {
                  throw new Error(
                    `build: goal ${attachedGoalID} prior terminal goal_run ${priorGoalRunForRetry.id} cannot resume session and has no reusable worktree: ${selectedBuildSession.contextUnavailableReason ?? "unknown reason"}`,
                  )
                }
                createDecisionLog(taskID).append({
                  phase: "orchestrator",
                  goalID: attachedGoalID,
                  key: `build_retry_fresh_session_${priorGoalRunForRetry.id}`,
                  value:
                    `Build retry selected a fresh build session because the previous build session context is unavailable ` +
                    `(${selectedBuildSession.contextUnavailableReason ?? "unknown reason"}); reusing worktree ${managedWorktree.directory}.`,
                  reason: "build_retry_session_context_unavailable",
                })
              }
            }
            const taskFidelity = readPersistedArchitectFidelity(task)
            const dependsOn = stringArrayColumn(goal.depends_on, `engine_goal(${goal.id}).depends_on`)
            target = {
              kind: "goal",
              id: goal.id,
              title: goal.title,
              // Always sourced from goal.objective. The previous
              // "requestText overrides goal.objective" behaviour silently
              // discarded the architect-committed objective when the
              // orchestrator LLM filled `request` for retry guidance —
              // which is why the LLM never filled it (rule preservation
              // beat retry signal). requestText now flows into
              // context.retryGuidance instead, leaving the architect
              // contract intact.
              objective: goal.objective,
              requirement_ids: stringArrayColumn(goal.requirement_ids, `engine_goal(${goal.id}).requirement_ids`),
              acceptance_specs: acceptanceSpecsToPromptLines(goal.acceptance_specs),
              owned_paths: stringArrayColumn(goal.owned_paths, `engine_goal(${goal.id}).owned_paths`),
              depends_on: dependsOn,
            }

            // ── Compose upstream context for the goal-path build:
            //    only the current goal's requirements, graph contracts,
            //    directly related goals, design specs, and retry feedback.
            //    Missing structural sources are rejected before this point.
            const activeSpecForContext = findActiveSpecForTask(task.id)
            const reqRows = activeSpecForContext ? findRequirements(activeSpecForContext.id) : []
            const requirements = scopedRequirementsForBuildGoal({ reqRows, goal })

            const decisionLog = createDecisionLog(taskID)
            const dependencies =
              dependsOn.length > 0
                ? siblingGoals
                    .filter((g) => dependsOn.includes(g.id))
                    .map((g) => ({
                      id: g.id,
                      title: g.title,
                    }))
                : []
            const collaborationGoals = scopedCollaborationGoalsForBuild({
              goals: siblingGoals,
              targetGoalID: goal.id,
            })

            const designSpecs = Array.isArray(task.design_specs) ? (task.design_specs as any) : undefined
            const projectDir = taskPrimaryProjectRoot(taskID, { activeProjectID: Instance.project.id })
            const frontendDesign = renderFrontendDesignHandoffReference(taskID, {
              pathMode: "absolute",
              projectDir,
            })
            const frontendResearch = renderFrontendResearchBuildPromptSection({
              taskID,
              request: task.request,
            })
            // Retry feedback from decision log. Materialize the terminal
            // build-attempt facts before reading so this new session receives
            // the previous failure context in its first prompt.
            ensureBuildRetryFeedbackForGoal({
              taskID,
              goalID: goal.id,
              source: "orchestrator.build.prompt_context",
            })
            const retryEntries = decisionLog.readByPhase("retry").filter((e) => e.goalID === goal.id)
            const retryFeedback =
              retryEntries.length > 0
                ? retryEntries
                    .map((entry) => entry.value.trim())
                    .filter((value) => value.length > 0)
                    .join("\n\n") || undefined
                : undefined
            const acceptanceFeedback = await composeLatestAcceptanceFeedbackForBuild({
              taskID,
              goalID: goal.id,
            })
            const integrityFeedback = await composeIntegrityFeedbackMarkdownForBuild({
              taskID,
              activeSpecSnapshotID: activeSpecForContext?.id,
            })

            // Visual feedback closure-loop: when acceptance rejected on visual
            // grounds, attach the previous rendered.png so the build LLM
            // physically compares its output to the user reference instead of
            // re-painting from text alone.
            const retryAttachments = await loadLatestRenderedRetryAttachment({
              taskID,
              enabled: retryEntries.length > 0 || Boolean(acceptanceFeedback),
            })

            // Goal Workload Analyst brief for this goal (spec §6B). Injected
            // only when the latest workload artifact targets the active
            // architect snapshot — a stale brief (architect re-ran after the
            // analysis) is dropped so build never scopes against superseded
            // counts. Matched by g.id (the canonical post-persistence goal id).
            const wlArtifact = findLatestGoalWorkloadArtifact(taskID)
            const workloadBrief =
              wlArtifact && activeSpecForContext && wlArtifact.spec_snapshot_id === activeSpecForContext.id
                ? wlArtifact.briefs.find((b) => b.goal_id === goal.id)
                : undefined

            // Phase B (2026-05-07): the orchestrator LLM's `request` text
            // now flows into context.retryGuidance instead of replacing
            // target.objective. Empty string means no current-turn
            // guidance; the renderer drops the section.
            context = {
              requirements: requirements.length > 0 ? requirements : undefined,
              contractGraph,
              dependencies: dependencies.length > 0 ? dependencies : undefined,
              collaborationGoals: collaborationGoals.length > 0 ? collaborationGoals : undefined,
              designSpecs,
              frontendResearch: frontendResearch.trim().length > 0 ? frontendResearch : undefined,
              frontendDesign: frontendDesign.trim().length > 0 ? frontendDesign : undefined,
              projectDir,
              fidelity: scopedFidelityForBuildGoal({ goalID: goal.id, fidelity: taskFidelity }),
              retryGuidance: requestText.length > 0 ? requestText : undefined,
              integrityFeedback,
              retryFeedback,
              acceptanceFeedback,
              retryAttachments,
              workloadBrief,
            }
          } else {
            // Task-level direct build: target.text carries the request
            // verbatim (it IS the work), so retryGuidance does not apply
            // to this branch — there's no separate goal contract for the
            // request to "supplement".
            target = { kind: "request", text: requestText }
            const acceptanceFeedback = await composeLatestAcceptanceFeedbackForBuild({ taskID })
            const activeSpecForContext = findActiveSpecForTask(taskID)
            const integrityFeedback = await composeIntegrityFeedbackMarkdownForBuild({
              taskID,
              activeSpecSnapshotID: activeSpecForContext?.id,
            })
            const retryAttachments = await loadLatestRenderedRetryAttachment({
              taskID,
              enabled: Boolean(acceptanceFeedback),
            })
            const designSpecs = Array.isArray(task.design_specs) ? (task.design_specs as any) : undefined
            const projectDir = taskPrimaryProjectRoot(taskID, { activeProjectID: Instance.project.id })
            const frontendDesign = renderFrontendDesignHandoffReference(taskID, {
              pathMode: "absolute",
              projectDir,
            })
            const frontendResearch = renderFrontendResearchBuildPromptSection({
              taskID,
              request: task.request,
            })
            context =
              integrityFeedback ||
              acceptanceFeedback ||
              retryAttachments ||
              designSpecs ||
              frontendResearch.trim().length > 0 ||
              frontendDesign.trim().length > 0
                ? {
                    designSpecs,
                    frontendResearch: frontendResearch.trim().length > 0 ? frontendResearch : undefined,
                    frontendDesign: frontendDesign.trim().length > 0 ? frontendDesign : undefined,
                    projectDir,
                    integrityFeedback,
                    acceptanceFeedback,
                    retryAttachments,
                  }
                : undefined
          }

          // Open the goal_run after BuildAgent has created or reopened the
          // concrete build session. The first artifact must already contain
          // session_id so retry has exactly one session identity source.
          let goalRunID: string | undefined
          let buildStartedSettled = false
          let resolveBuildStarted: (value: {
            sessionID: string
            goalRunID?: string
            worktreeDir?: string
            worktreeBranch?: string
            worktreeBaseRef?: string
          }) => void = () => {}
          let rejectBuildStarted: (error: unknown) => void = () => {}
          const buildStarted = new Promise<{
            sessionID: string
            goalRunID?: string
            worktreeDir?: string
            worktreeBranch?: string
            worktreeBaseRef?: string
          }>((resolve, reject) => {
            resolveBuildStarted = resolve
            rejectBuildStarted = reject
          })
          const resolveBuildStartedOnce = (value: {
            sessionID: string
            goalRunID?: string
            worktreeDir?: string
            worktreeBranch?: string
            worktreeBaseRef?: string
          }) => {
            if (buildStartedSettled) return
            buildStartedSettled = true
            resolveBuildStarted(value)
          }
          const rejectBuildStartedOnce = (error: unknown) => {
            if (buildStartedSettled) return
            buildStartedSettled = true
            rejectBuildStarted(error)
          }
          const buildSessionContractArtifactForAttempt = (input: { sessionID: string; goalRunID: string }) => {
            if (!attachedGoalID || target.kind !== "goal") return undefined
            const now = Date.now()
            const artifactID = Identifier.ascending("artifact")
            const activePlan = findActivePlanForTask(taskID)
            const graphArtifact = findLatestArchitectContractGraphArtifact(taskID)
            const sourceArtifactIDs = [activePlan?.spec_snapshot_id, activePlan?.id, graphArtifact?.id].filter(
              (item): item is string => typeof item === "string" && item.length > 0,
            )
            const payload = {
              session_id: input.sessionID,
              task_id: taskID,
              goal_id: attachedGoalID,
              goal_run_id: input.goalRunID,
              spec_snapshot_id: activePlan?.spec_snapshot_id ?? null,
              plan_version_id: activePlan?.id ?? null,
              goal_contract_snapshot: {
                title: target.title,
                kind: target.kind,
                objective: target.objective,
                owned_paths: target.owned_paths,
                depends_on: target.depends_on,
                requirement_ids: target.requirement_ids,
                acceptance_specs: target.acceptance_specs,
              },
              collaboration_goals_snapshot: context?.collaborationGoals ?? [],
              requirements_snapshot: context?.requirements ?? [],
              source_artifact_ids: sourceArtifactIDs,
              digest: createHash("sha256")
                .update(
                  JSON.stringify({
                    goal: target,
                    collaborationGoals: context?.collaborationGoals ?? [],
                    requirements: context?.requirements ?? [],
                    sourceArtifactIDs,
                  }),
                )
                .digest("hex"),
            }
            return {
              id: artifactID,
              kind: "build_session_contract" as const,
              label: "build-session-contract",
              runID: coordinatorRunID ?? null,
              goalRunID: input.goalRunID,
              payload,
            }
          }
          const openGoalRunForBuildSession = async (
            sessionID: string,
            buildSessionContext: { worktreeDir?: string; worktreeBranch?: string; worktreeBaseRef?: string },
          ) => {
            if (!attachedGoalID) {
              if (activeOwnership) return
              const ownershipPayload = createOrchestratorToolOwnershipPayload({
                taskID,
                orchestratorSessionID: toolExecution.orchestratorSessionID,
                orchestratorMessageID: toolExecution.orchestratorMessageID,
                toolCallID: toolExecution.toolCallID,
                toolPartID: toolExecution.toolPartID,
                childSessionID: sessionID,
                scope: "task",
              })
              insertOrchestratorToolOwnershipArtifact({
                taskID,
                runID: coordinatorRunID ?? null,
                goalRunID: null,
                label: "tool-ownership-start",
                payload: ownershipPayload,
              })
              activeOwnership = ownershipPayload
              resolveBuildStartedOnce({
                sessionID,
                worktreeDir: buildSessionContext.worktreeDir,
                worktreeBranch: buildSessionContext.worktreeBranch,
                worktreeBaseRef: buildSessionContext.worktreeBaseRef,
              })
              return
            }
            if (goalRunID) return
            try {
              const { beginBuildAttempt } = await import("@/engine/persist")
              goalRunID = beginBuildAttempt({
                taskID,
                goalID: attachedGoalID,
                runID: coordinatorRunID,
                sessionID,
                workspaceDir: buildSessionContext.worktreeDir ?? managedWorktree?.directory,
                // Phase G (2026-05-05): full workspace triple rides the
                // attempt artifact. Pre-fix the orchestrator pre-wrote
                // engine_goal columns then dropped to a synthetic-runID
                // queued artifact when no tip existed; both paths are gone
                // now — single source is the new attempt artifact.
                workspaceBranch: buildSessionContext.worktreeBranch ?? managedWorktree?.branch ?? null,
                workspaceBaseRef: buildSessionContext.worktreeBaseRef ?? managedWorktree?.baseRef ?? null,
                extraArtifacts: ({ goalRunID }) => {
                  const artifacts: Array<{
                    id: string
                    kind: EngineArtifactKind
                    label: string
                    payload: Record<string, unknown>
                    runID?: string | null
                    goalRunID?: string | null
                  }> = []
                  const contract = buildSessionContractArtifactForAttempt({ sessionID, goalRunID })
                  if (contract) artifacts.push(contract)
                  const ownershipPayload = createOrchestratorToolOwnershipPayload({
                    taskID,
                    orchestratorSessionID: toolExecution.orchestratorSessionID,
                    orchestratorMessageID: toolExecution.orchestratorMessageID,
                    toolCallID: toolExecution.toolCallID,
                    toolPartID: toolExecution.toolPartID,
                    childSessionID: sessionID,
                    scope: "goal",
                    goalID: attachedGoalID,
                    goalRunID,
                  })
                  activeOwnership = ownershipPayload
                  artifacts.push({
                    id: Identifier.ascending("artifact"),
                    kind: "orchestrator_tool_ownership",
                    label: "tool-ownership-start",
                    runID: coordinatorRunID ?? null,
                    goalRunID,
                    payload: ownershipPayload,
                  })
                  return artifacts
                },
              })
              resolveBuildStartedOnce({
                sessionID,
                goalRunID,
                worktreeDir: buildSessionContext.worktreeDir ?? managedWorktree?.directory,
                worktreeBranch: buildSessionContext.worktreeBranch ?? managedWorktree?.branch,
                worktreeBaseRef: buildSessionContext.worktreeBaseRef ?? managedWorktree?.baseRef ?? undefined,
              })
              return goalRunID
            } catch (beginErr) {
              // A failure here is structural — overlay won't get the
              // running card and finalizeBuildAttempt has nothing to
              // update. Surface and let the dispatch fail rather than
              // silently degrade to the old "appear at completion" UX.
              log.error("build: beginBuildAttempt failed", {
                taskID,
                goalID: attachedGoalID,
                error: beginErr instanceof Error ? beginErr.message : String(beginErr),
              })
              throw beginErr
            }
          }

          // BuildAgent.run reserves thrown errors for infrastructure faults
          // (model unavailable, worktree creation failed, session stream
          // error — the G4 TLS-mid-stream class). Before this try/finally,
          // a thrown error skipped finalizeBuildAttempt entirely, leaving
          // the goal_run in attempt-running forever (see incident report
          // tsk_ddc529dfd0011ajJTgBqdlroyk G4 in
          // LLM activity redesign contract). Step 4
          // closes that gap by ALWAYS finalising the goal_run when one
          // was opened, with status derived from the BuildAgent outcome
          // or, on throw, from the underlying error class.
          const runBuildToTerminal = async (): Promise<string> => {
            let buildOutcome:
              | { kind: "ok"; result: Awaited<ReturnType<typeof BuildAgent.run>> }
              | { kind: "throw"; error: unknown }
            try {
              const ok = await BuildAgent.run({
                target,
                task,
                context,
                parentSessionID: input.agentSessionID,
                existingSessionID: existingBuildSessionID,
                signal: input.signal,
                managedWorktree,
                onSessionCreated: openGoalRunForBuildSession,
              })
              buildOutcome = { kind: "ok", result: ok }
              if (attachedGoalID && !goalRunID) {
                throw new Error(`build: BuildAgent.run completed for goal ${attachedGoalID} without opening a goal_run`)
              }
            } catch (runErr) {
              // P2: typed BuildAgentContractError converts to a schema-valid
              // failed BuildResult and routes through the normal failed path
              // (NOT rethrow). Preserves the retry-budget contract: the
              // orchestrator's tool result reads as a normal failed build,
              // decision_log gets the contract-violation diagnostics, and
              // generic infra errors keep their existing rethrow shape.
              const { BuildAgentContractError } = await import("@/build/types")
              if (runErr instanceof BuildAgentContractError) {
                // Collect host-side worktree facts on the failure path so the
                // orchestrator LLM sees what the build session actually
                // produced (file changes, HEAD) before deciding next step
                // (build retry / modify_goal / fail_task).
                // Without these facts the build tool result's "Worktree facts"
                // block renders all-undefined, leaving the LLM blind to whether
                // the missing-terminal failure happened with substantial work
                // already on disk vs an empty worktree.
                let collectedDiffs: import("@/snapshot/types").FileDiff[] | undefined
                let collectedHead: string | undefined
                let collectedActualChangedFiles:
                  | NonNullable<Awaited<ReturnType<typeof BuildAgent.run>>["actualChangedFiles"]>
                  | undefined
                if (managedWorktree?.directory) {
                  try {
                    const headResult = await runGit(["rev-parse", "HEAD"], {
                      cwd: managedWorktree.directory,
                      timeoutProfile: "fast",
                    })
                    if (headResult.exitCode === 0) {
                      const head = headResult.text().trim()
                      if (head) collectedHead = head.slice(0, 12)
                    }
                  } catch (gitErr) {
                    log.warn("build catch: rev-parse HEAD failed (non-fatal)", {
                      taskID,
                      goalID: attachedGoalID,
                      error: gitErr instanceof Error ? gitErr.message : String(gitErr),
                    })
                  }
                  if (managedWorktree.baseRef) {
                    try {
                      const fetched = await collectGoalContributionDiffs(
                        managedWorktree.directory,
                        managedWorktree.baseRef,
                      )
                      collectedDiffs = fetched
                      collectedActualChangedFiles = fetched.map((d) => ({
                        path: d.file,
                        status: (d.status ?? "modified") as "added" | "modified" | "deleted",
                        additions: d.additions,
                        deletions: d.deletions,
                      }))
                    } catch (diffErr) {
                      log.warn("build catch: collectGoalContributionDiffs failed (non-fatal)", {
                        taskID,
                        goalID: attachedGoalID,
                        error: diffErr instanceof Error ? diffErr.message : String(diffErr),
                      })
                    }
                  }
                }
                const synthFailed: Awaited<ReturnType<typeof BuildAgent.run>>["result"] = {
                  status: "failed",
                  summary: `Build agent contract violation (${runErr.code}): ${runErr.message.slice(0, 200)}`,
                  tests: [],
                  files_changed: [],
                  error: runErr.message,
                  // Host-synthesised BuildResult on contract violation: the LLM
                  // never reached its terminal tool, so it has no chance to
                  // populate fact_check_items. Empty array is the honest
                  // construction-site default (fact-check agent contract
                  // §6.1.3 — same rationale as external executor factory).
                  fact_check_items: [],
                }
                buildOutcome = {
                  kind: "ok",
                  result: {
                    result: synthFailed,
                    sessionID: runErr.diagnostics.sessionID ?? "",
                    worktreeDir: managedWorktree?.directory,
                    worktreeBranch: managedWorktree?.branch,
                    worktreeBaseRef: managedWorktree?.baseRef,
                    diffs: collectedDiffs,
                    // BuildAgentContractError fires before the agent reached the
                    // post-merge fact collection, so we surface whatever the
                    // tool last reported (or "not_invoked" when nothing).
                    mergeBackStatus: "not_invoked",
                    lastMergeBackOutcome: runErr.diagnostics.lastMergeBackOutcome ?? undefined,
                    publishedCommitRef: undefined,
                    worktreeHead: collectedHead,
                    actualChangedFiles: collectedActualChangedFiles,
                  } as Awaited<ReturnType<typeof BuildAgent.run>>,
                }
                // Drop a phase=retry decision_log entry so the next attempt's
                // prompt receives the structured contract diagnostic instead
                // of just "tool failed". Single source: decision_log; the
                // orchestrator already reads phase=retry filtered by goalID.
                //
                // value carries the LLM-facing recovery hint (rendered into
                // the next build prompt's "Prior Attempt Failed" section by
                // the retryFeedback composer). Use BuildAgentContractError's
                // message directly (single source per rule 8 — the hint text
                // is owned by build/agent.ts:convertMissingTerminalToolError).
                // reason carries the audit metadata.
                if (attachedGoalID) {
                  const { createDecisionLog } = await import("@/decision-log")
                  createDecisionLog(taskID).append({
                    phase: "retry",
                    goalID: attachedGoalID,
                    key: "build_agent_contract_violation",
                    value: runErr.message,
                    reason: `build_agent_contract_violation: code=${runErr.code}; sessionID=${runErr.diagnostics.sessionID ?? "?"}`,
                  })
                }
              } else {
                buildOutcome = { kind: "throw", error: runErr }
              }
            }

            if (buildOutcome.kind === "ok") {
              const { worktreeDir, worktreeBranch, worktreeBaseRef } = buildOutcome.result
              const currentGoalRun = goalRunID ? findGoalRun(goalRunID) : undefined
              if (
                attachedGoalID &&
                worktreeDir &&
                worktreeBranch &&
                (!currentGoalRun || isLiveGoalRunStatus(currentGoalRun.status))
              ) {
                updateGoalWorkspace({
                  goalID: attachedGoalID,
                  workspaceDir: worktreeDir,
                  workspaceBranch: worktreeBranch,
                  workspaceBaseRef: worktreeBaseRef,
                })
              }
              if (attachedGoalID && worktreeDir && (!currentGoalRun || isLiveGoalRunStatus(currentGoalRun.status))) {
                const contractAuditCriteria = await runGoalContractAuditCriteria({
                  taskID,
                  goal: findGoal(attachedGoalID),
                  goalRunID,
                  workDir: worktreeDir,
                  task,
                })
                if (contractAuditCriteria.length > 0) {
                  await EngineService.upsertTaskCriteria(taskID, contractAuditCriteria)
                  const failedEssential = contractAuditCriteria.filter((criteria) => {
                    if (!contractAuditBlocksBuild(criteria.status)) return false
                    const goalRow = findGoal(attachedGoalID)
                    const specs = (
                      Array.isArray(goalRow?.acceptance_specs) ? goalRow.acceptance_specs : []
                    ) as AcceptanceSpec[]
                    return specs.some((spec) =>
                      spec.scorers.some(
                        (scorer) =>
                          scorer.type === "contract_audit" &&
                          contractAuditRequired(spec, scorer) &&
                          `acceptance:${spec.id}:${scorer.name}` === criteria.name,
                      ),
                    )
                  })
                  if (failedEssential.length > 0 && buildOutcome.result.result.status === "passed") {
                    buildOutcome.result.result = {
                      ...buildOutcome.result.result,
                      status: "failed",
                      error: `contract_audit failed:\n${failedEssential.map((criteria) => criteria.evidence).join("\n")}`,
                      summary: `${buildOutcome.result.result.summary}\n\nContract audit failed before goal finalization.`,
                    }
                  }
                }
              }
            }

            // Finalize the goal_run opened above. updateGoalRun writes a new
            // append-only artifact with the terminal status + time_completed,
            // and finalizeBuildAttempt also lays down the per-goal acceptance
            // artifact when the build passed with concrete diffs (overlay's
            // right-side Files panel reads it via findAcceptanceByGoalRun).
            // For the throw branch we synthesise a failed finalisation from
            // the underlying error message — diffs/commit/summary are absent
            // by definition, but the goal_run row reaches a clean terminal
            // state instead of orphaning at attempt-running.
            let goalRunInvalidatedLine = ""
            let goalRunInvalidated = false
            let goalRunFinalizationFailedLine = ""
            if (attachedGoalID && goalRunID) {
              try {
                const { finalizeBuildAttempt } = await import("@/engine/persist")
                const currentGoalRun = findGoalRun(goalRunID)
                if (currentGoalRun && !isLiveGoalRunStatus(currentGoalRun.status)) {
                  goalRunInvalidated = true
                  goalRunInvalidatedLine =
                    `\n- build_result_ignored: goal_run ${goalRunID} is already ${currentGoalRun.status}; ` +
                    `the attempt was invalidated before this build report returned.`
                  log.warn("build: ignoring stale build result for invalidated goal_run", {
                    taskID,
                    goalID: attachedGoalID,
                    goalRunID,
                    status: currentGoalRun.status,
                  })
                } else if (buildOutcome.kind === "ok") {
                  const {
                    result,
                    worktreeDir,
                    worktreeBranch,
                    worktreeBaseRef,
                    diffs,
                    contributionCommitRef,
                    diffBaseRef,
                    diffHeadRef,
                    publishedCommitRef,
                  } = buildOutcome.result
                  finalizeBuildAttempt({
                    goalRunID,
                    taskID,
                    goalID: attachedGoalID,
                    runID: coordinatorRunID,
                    status: result.status === "passed" ? "completed" : "failed",
                    commitRef: contributionCommitRef,
                    publishedCommitRef,
                    diffBaseRef,
                    diffHeadRef,
                    workspaceDir: worktreeDir,
                    // Phase B (2026-05-05): the build outcome carries branch +
                    // baseRef alongside the directory. Persist them on the
                    // attempt artifact so the next dispatch / cleanup / board
                    // view reads the full triple from one source.
                    workspaceBranch: worktreeBranch,
                    workspaceBaseRef: worktreeBaseRef ?? undefined,
                    error: result.status === "failed" ? result.error : undefined,
                    diffs,
                    fileChanges: result.files_changed,
                    summary: result.summary,
                  })
                } else {
                  const errMsg =
                    buildOutcome.error instanceof Error
                      ? `${buildOutcome.error.name}: ${buildOutcome.error.message}`
                      : String(buildOutcome.error)
                  finalizeBuildAttempt({
                    goalRunID,
                    taskID,
                    goalID: attachedGoalID,
                    runID: coordinatorRunID,
                    status: "failed",
                    workspaceDir: managedWorktree?.directory,
                    workspaceBranch: managedWorktree?.branch,
                    workspaceBaseRef: managedWorktree?.baseRef ?? undefined,
                    error: errMsg,
                    summary: `BuildAgent.run threw before producing a verdict: ${errMsg.slice(0, 240)}`,
                  })
                }
              } catch (persistErr) {
                const persistMessage = persistErr instanceof Error ? persistErr.message : String(persistErr)
                log.error("build: finalizeBuildAttempt failed", {
                  taskID,
                  goalID: attachedGoalID,
                  goalRunID,
                  error: persistMessage,
                })
                const currentGoalRun = findGoalRun(goalRunID)
                if (currentGoalRun && isLiveGoalRunStatus(currentGoalRun.status)) {
                  const error = `build finalization failed: ${persistMessage}`
                  updateGoalRun(goalRunID, {
                    status: "failed",
                    error,
                    time_completed: Date.now(),
                  })
                  goalRunFinalizationFailedLine =
                    `\n- build_finalization_failed: goal_run ${goalRunID} was marked failed because terminal persistence failed: ` +
                    `${persistMessage}`
                  if (buildOutcome.kind === "ok") {
                    buildOutcome.result.result = {
                      ...buildOutcome.result.result,
                      status: "failed",
                      error,
                      summary: `${buildOutcome.result.result.summary}\n\nGoal run finalization failed after the build report returned.`,
                    }
                  }
                }
              }
            }

            // If BuildAgent.run threw, surface the original error to the caller
            // AFTER the goal_run is finalised. The throw shape is preserved so
            // the orchestrator's existing tool-error / wake-loop logic isn't
            // disturbed — only the persistent state was previously orphaned.
            if (buildOutcome.kind === "throw") {
              closeBuildOwnership(
                "failed",
                buildOutcome.error instanceof Error ? buildOutcome.error.message : String(buildOutcome.error),
              )
              throw buildOutcome.error
            }
            const { result, sessionID, worktreeDir } = buildOutcome.result
            // diffs is captured by the surrounding scope's destructure for the
            // ok-branch report rendering below; pull it back out for clarity.
            const diffs = buildOutcome.result.diffs
            // Host-truth merge / diff facts (B20). Surfaced inline in the
            // tool result so the orchestrator LLM can cross-check the LLM's
            // self-reported `files_changed[]` and `commit_ref` against what
            // actually happened.
            // Defaults preserve sane rendering for older test fixtures whose
            // mocked BuildAgent.RunOutput predates these fields.
            const mergeBackStatus = buildOutcome.result.mergeBackStatus ?? "not_invoked"
            const lastMergeBackOutcome = buildOutcome.result.lastMergeBackOutcome
            const publishedCommitRef = buildOutcome.result.publishedCommitRef
            const worktreeHead = buildOutcome.result.worktreeHead
            const contributionCommitRef = buildOutcome.result.contributionCommitRef
            const diffBaseRef = buildOutcome.result.diffBaseRef
            const diffHeadRef = buildOutcome.result.diffHeadRef
            const actualChangedFiles = buildOutcome.result.actualChangedFiles ?? []
            // Architecture review is no longer triggered automatically per
            // build. Per-goal automatic review fired N times for N goals,
            // each looking at one goal's worktree in isolation, and crowded
            // the orchestrator's prompt with redundant entries. Build reports
            // are recorded as decision-log evidence; standalone integrity is
            // reserved for task-end or suspicion-triggered system-integrity
            // review, not routine wave-level review.
            if (attachedGoalID && !goalRunInvalidated) {
              const buildReportForReview = {
                status: result.status,
                summary: result.summary,
                files_changed: result.files_changed,
                tests: result.tests,
                error: result.status === "failed" ? result.error : undefined,
                commit_ref: result.commit_ref,
                repair_report: result.repair_report,
              }
              const decisionLog = createDecisionLog(taskID)
              decisionLog.append({
                phase: "build",
                goalID: attachedGoalID,
                key: "build_report_for_architecture_review",
                value: JSON.stringify(buildReportForReview),
                reason: "post_build_architecture_review_input",
              })
            }

            if (isTaskLevelBuild) await trackStepComplete("build")

            // Build session terminal flows through session.status when
            // BuildAgent.run's underlying actor closes. The structured build
            // report below is the orchestrator-facing tool result.

            // Build does NOT mark workflow tasks complete. The final review is
            // post-build integrity after all blocking build evidence is
            // terminal. Return the structured payload so the orchestrator can
            // judge the next explicit action.
            const testLines =
              result.tests.length > 0
                ? result.tests
                    .map((t) => `  - ${t.passed ? "✓" : "✗"} ${t.name}${t.detail ? `: ${t.detail}` : ""}`)
                    .join("\n")
                : "  (none reported)"
            const fileLines =
              result.files_changed.length > 0
                ? result.files_changed.map((f) => `  - ${f.path}: ${f.summary} — ${f.reason}`).join("\n")
                : "  (none reported)"
            const repairReportLines = result.repair_report
              ? [
                  `  repaired_findings=${result.repair_report.repaired_findings.length}`,
                  ...result.repair_report.repaired_findings.map(
                    (item) =>
                      `  - repaired ${item.finding_id} ${item.fingerprint}: files=${item.changed_files.join(", ")}; verification=${item.verification_commands
                        .map(
                          (command) =>
                            `${command.passed ? "passed" : "failed"} ${command.command}${command.detail ? ` (${command.detail})` : ""}`,
                        )
                        .join(" | ")}`,
                  ),
                  `  unrepaired_findings=${result.repair_report.unrepaired_findings.length}`,
                  ...result.repair_report.unrepaired_findings.map(
                    (item) => `  - unrepaired ${item.finding_id} ${item.fingerprint}: ${item.reason}`,
                  ),
                  result.repair_report.unrelated_changes.length > 0
                    ? `  unrelated_changes=${result.repair_report.unrelated_changes.join(", ")}`
                    : "",
                ]
                  .filter(Boolean)
                  .join("\n")
              : "  (none reported)"
            const commitLine = result.commit_ref ? `- commit_ref: ${result.commit_ref}` : "- commit_ref: (none)"
            const errorLine = result.status === "failed" ? `\n- error: ${result.error}` : ""
            const worktreeLine = worktreeDir ? `\n- worktreeDir: ${worktreeDir}` : ""
            // Host-truth merge / diff fact block (B21). LLM may self-report
            // commit_ref / files_changed[] in `result`; below is what actually
            // happened in the worktree from the host's perspective. The
            // orchestrator LLM cross-checks both and decides next.
            const mergeBackLine =
              `- merge_back_status: ${mergeBackStatus}` +
              (lastMergeBackOutcome ? ` (last_outcome: ${lastMergeBackOutcome})` : "")
            const publishedLine = publishedCommitRef
              ? `- published_commit_ref: ${publishedCommitRef} (primary HEAD after merge_back)`
              : `- published_commit_ref: (none — merge_back did not publish)`
            const worktreeHeadLine = worktreeHead ? `- worktree_head: ${worktreeHead}` : ""
            const contributionLine = contributionCommitRef
              ? `- contribution_commit_ref: ${contributionCommitRef}`
              : `- contribution_commit_ref: (none)`
            const diffRangeLine =
              diffBaseRef && diffHeadRef
                ? `- contribution_diff_range: ${diffBaseRef}..${diffHeadRef}`
                : `- contribution_diff_range: (none)`
            const actualFilesLines =
              actualChangedFiles.length > 0
                ? actualChangedFiles
                    .map((f) => `  - [${f.status}] ${f.path} (+${f.additions}/-${f.deletions})`)
                    .join("\n")
                : "  (no changes detected against contribution base)"
            const factBlock =
              `\n\n### Worktree facts (host ground truth)\n` +
              `${mergeBackLine}\n` +
              `${publishedLine}\n` +
              (worktreeHeadLine ? `${worktreeHeadLine}\n` : "") +
              `${contributionLine}\n` +
              `${diffRangeLine}\n` +
              `- actual_changed_files (vs contribution base):\n${actualFilesLines}`

            closeBuildOwnership(
              result.status === "passed" ? "completed" : "failed",
              result.status === "failed" ? result.error : undefined,
            )

            return (
              `Build agent finished (status=${result.status}, session ${sessionID}).\n\n` +
              `### Build report\n` +
              `- summary: ${result.summary}\n` +
              `- files_changed:\n${fileLines}\n` +
              `${commitLine}${errorLine}${worktreeLine}${goalRunInvalidatedLine}${goalRunFinalizationFailedLine}\n` +
              `- repair_report:\n${repairReportLines}\n` +
              `- tests:\n${testLines}` +
              `${factBlock}\n\n` +
              `### Next step\n` +
              `Read the build report and the worktree facts above. Cross-check the LLM's files_changed/commit_ref against the worktree facts; if they disagree, factor that into your next call. ` +
              `When terminal goal refill facts appear, choose build({goalID}) / modify_goal / architect / propose_task / fail_task / question from the build evidence and task context; route product, dependency, git-worktree, port, and toolchain blockers to the responsible same-task owner instead of passively waiting for sibling builds. ` +
              `For frontend/browser-visible work, run \`visual_qa\` only once near task completion after all blocking build work is terminal and before final task acceptance. If visual_qa returns accepted=false with unresolved_code_module_problems, decide whether to repair in the current task or call \`propose_task\` from that evidence only at terminal handoff. ` +
              `Call \`integrity\` as the final review after all blocking builds are terminal; visual_qa and integrity are peer review agents, not replacements for each other. On post-build pass, call \`complete_task\` with the returned integrity_attempt_id. Before final acceptance, use integrity earlier only when integrated evidence raises a real question about requirement mining or system integrity.`
            )
          }

          if (attachedGoalID) {
            const terminalBuild = runBuildToTerminal()
            void terminalBuild
              .then(() => {
                if (!buildStartedSettled) {
                  rejectBuildStartedOnce(
                    new Error(`build: BuildAgent.run completed for goal ${attachedGoalID} without opening a goal_run`),
                  )
                }
              })
              .catch((error) => {
                rejectBuildStartedOnce(error)
                log.error("background goal build failed", {
                  taskID,
                  goalID: attachedGoalID,
                  error: error instanceof Error ? error.message : String(error),
                })
              })

            const started = await buildStarted
            closeBuildOwnership("completed")
            return (
              `Build agent started (status=running, session ${started.sessionID}, goal_run ${started.goalRunID ?? "n/a"}).\n\n` +
              `### Build dispatch\n` +
              `- goal_id: ${attachedGoalID}\n` +
              `- goal_run_id: ${started.goalRunID ?? "n/a"}\n` +
              `- worktreeDir: ${started.worktreeDir ?? "n/a"}\n` +
              `- worktreeBranch: ${started.worktreeBranch ?? "n/a"}\n\n` +
              `### Next step\n` +
              `This build is now running asynchronously. Do not call wait for sibling builds to finish before reacting to terminal goal refill facts. ` +
              `If no next dispatchable, failed, or refill facts exist, stop this wake; terminal goal refill will wake the next decision. ` +
              `When a goal reaches terminal status, the next task snapshot will surface refill evidence and ordered dispatchable goals; choose build({goalID}) / modify_goal / architect / propose_task / fail_task / question from those facts. ` +
              `Call integrity only after all blocking builds are terminal.`
            )
          }

          return await runBuildToTerminal()
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log.error("build tool failed", { taskID, error: msg })
          closeBuildOwnership("failed", msg)
          if (isTaskLevelBuild) await trackStepComplete("build", undefined, true)
          // Build itself failed (LLM error, tool guard fault, worktree
          // creation failed, etc.) — distinct from integrity non-pass evidence.
          // Surface the error so the orchestrator decides (retry / fail_task).
          // Card terminal flows through session.status from the build
          // agent's actor close path.
          throw err
        }
      },
    }),

    browser_preview: tool({
      description: BrowserPreviewToolStaticDefinition.description,
      inputSchema: BrowserPreviewToolStaticDefinition.parameters,
      execute: async (params, options) => {
        const meta = requireOrchestratorToolExecutionContext(options, "browser_preview")
        const initialized = await BrowserPreviewTool.init()
        const abort =
          (options as { abortSignal?: AbortSignal } | undefined)?.abortSignal ??
          input.signal ??
          new AbortController().signal
        const result = await initialized.execute(params, {
          sessionID: meta.orchestratorSessionID,
          messageID: meta.orchestratorMessageID,
          callID: meta.toolCallID,
          agent: "orchestrator",
          abort,
          messages: [],
          extra: { taskID },
          metadata: () => {},
          ask: async () => {},
        })
        return result.output
      },
    }),

    bash: tool({
      description:
        "Git-only merge-state repair shell. Runs ONE `git ...` invocation " +
        "against the project root for resolving an in-progress merge that no " +
        "sub-agent can clear by itself. The schema rejects any non-git " +
        "command, any pipeline / redirect / command substitution, and any " +
        "process-killing pattern. This is NOT a code editor, NOT a test " +
        "runner, NOT a repository inspector for general investigation, NOT a " +
        "research tool, and NOT a shortcut around requirements / architect / " +
        "build / integrity. The system prompt carries merge-repair scope; " +
        "this schema carries command-shape restrictions.",
      inputSchema: z.object({
        command: z
          .string()
          .min(1)
          .superRefine((cmd, ctx) => {
            const result = validateOrchestratorBashCommand(cmd)
            if (!result.ok) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.reason })
            }
          })
          .describe(
            "Single git invocation. MUST start with `git ` and contain no " +
              "pipeline (|), command separator (; / && / ||), background (&), " +
              "redirection (> / <), command substitution ($() / backticks), or " +
              "process-killing pattern. Examples: `git status`, " +
              "`git merge --abort`, `git checkout --ours -- path/to/file`, " +
              "`git diff --name-only --diff-filter=U`.",
          ),
        description: z
          .string()
          .min(1)
          .describe("Concise 5-15 word statement of the git merge-state symptom you are repairing."),
        timeout: z
          .number()
          .int()
          .positive()
          .max(ORCHESTRATOR_BASH_MAX_TIMEOUT_MS)
          .optional()
          .describe(
            `Timeout in ms. Default ${ORCHESTRATOR_BASH_DEFAULT_TIMEOUT_MS}. Hard ceiling ${ORCHESTRATOR_BASH_MAX_TIMEOUT_MS}.`,
          ),
      }),
      execute: async ({ command, description, timeout }) => {
        // Schema-level refine already rejected non-git / pipeline / kill
        // shapes, but re-validate defensively so a future schema regression
        // does not turn into silent shell exposure.
        const validation = validateOrchestratorBashCommand(command)
        if (!validation.ok) {
          log.info("orchestrator bash refused", { taskID, command, reason: validation.reason })
          return `bash refused: ${validation.reason}`
        }
        const cwd = Instance.directory
        const ms = timeout ?? ORCHESTRATOR_BASH_DEFAULT_TIMEOUT_MS
        const shell = await Shell.acceptable()
        const supervisor = await ProcessSupervisor.spawnShell({
          command,
          shell,
          cwd,
          env: { ...process.env },
        })
        let output = ""
        const append = (chunk: Buffer | string) => {
          output += typeof chunk === "string" ? chunk : chunk.toString()
        }
        supervisor.stdout?.on("data", append)
        supervisor.stderr?.on("data", append)

        let timedOut = false
        const terminate = () => supervisor.terminate()
        const timer = setTimeout(() => {
          timedOut = true
          void terminate()
        }, ms)

        const onAbort = () => {
          void terminate()
        }
        input.signal?.addEventListener("abort", onAbort, { once: true })

        let exitCode: number | null = null
        try {
          exitCode = await supervisor.exited
        } catch {
          exitCode = null
        } finally {
          clearTimeout(timer)
          input.signal?.removeEventListener("abort", onAbort)
          await supervisor.dispose()
        }

        const MAX_OUTPUT = 30_000
        const clipped =
          output.length > MAX_OUTPUT
            ? output.slice(0, MAX_OUTPUT) +
              `\n\n[truncated ${output.length - MAX_OUTPUT} bytes — bash is single-shot repair, not a debugger; if you need more output route through a sub-agent]`
            : output
        const trailer = timedOut ? `\n\n[command terminated after ${ms}ms timeout]` : ""
        log.info("orchestrator bash executed", {
          taskID,
          command,
          exit: exitCode,
          timedOut,
          outputBytes: output.length,
        })
        return `purpose=${description}; exit=${exitCode ?? "?"}; cmd=${command}\n\n${clipped}${trailer}`
      },
    }),

    wait: tool({
      description:
        WaitToolDescription +
        " In orchestrator context, wait is NOT a substitute for `question` (operator input required), `fail_task` (no responsible same-task repair), or a real workflow decision from the current task snapshot. Never use wait for live build completion, live sibling goal completion, or terminal refill polling. After wait returns, decide from the refreshed task snapshot before the next dispatch.",
      inputSchema: WaitToolParameters,
      execute: async ({ duration_ms, reason }) => {
        const result = await executeWait({
          duration_ms,
          reason,
          signal: input.signal,
          sessionID: input.agentSessionID,
          taskID,
          logPhase: "orchestrator",
        })
        return {
          title: result.aborted ? "Wait Not Scheduled" : "Wait Scheduled",
          output: `${result.output} This is a scheduled park decision; do not poll with another wait.`,
          metadata: {
            requestedMs: result.requestedMs,
            aborted: result.aborted,
            jobID: result.jobID,
            nextRun: result.nextRun,
            mode: result.mode,
            nonblocking: true,
          },
        }
      },
    }),
  }

  async function executeFrontendDesignStageRedispatch(args: {
    reason: string
    sourceUrls: string[]
    options: unknown
    existingFrontendDesignSessions: Set<string>
  }): Promise<{
    output: unknown
    sessionID?: string
    designSpecsCount: number
    decisionEntriesCount: number
    templateReviewPasses: number
    referenceArtifactsCount: number
    frontendProjectStatus: string
  }> {
    const executeFrontendDesign = tools.frontend_design.execute
    if (typeof executeFrontendDesign !== "function") {
      throw new Error("frontend_design redispatch binding is missing the frontend_design execute handler")
    }
    const output = await (executeFrontendDesign as NonNullable<typeof executeFrontendDesign>)(
      {
        reason: args.reason,
        ...(args.sourceUrls.length > 0 ? { urls: args.sourceUrls } : {}),
      },
      args.options as never,
    )
    const sessions = (await Session.children(input.agentSessionID)).filter(
      (session) => session.kind === "frontend-design" && !args.existingFrontendDesignSessions.has(session.id),
    )
    const sessionID = sessions.sort((left, right) => {
      if (left.time.created !== right.time.created) return right.time.created - left.time.created
      return right.id.localeCompare(left.id)
    })[0]?.id
    const task = requireTask(taskID)
    const designSpecsCount = Array.isArray(task.design_specs) ? task.design_specs.length : 0
    const decisionLog = createDecisionLog(taskID)
    const decisionEntries = decisionLog.readByPhase("frontend_design")
    const templateIterationNotes = decisionLog.readByKey("template_iteration_notes")?.value ?? ""
    const referenceArtifacts = decisionLog.readByKey("reference_artifacts")?.value ?? ""
    const frontendProject = decisionLog.readByKey("frontend_project")?.value ?? ""
    const frontendProjectStatus = frontendProject.match(/^status:\s*(.+)$/m)?.[1]?.trim() ?? "unknown"
    return {
      output,
      sessionID,
      designSpecsCount,
      decisionEntriesCount: decisionEntries.length,
      templateReviewPasses: templateIterationNotes
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0).length,
      referenceArtifactsCount: referenceArtifacts
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0).length,
      frontendProjectStatus,
    }
  }

  async function executeIntentAnalysisStageRedispatch(args: {
    reason: string
    options: unknown
    existingIntentAnalysisSessions: Set<string>
  }): Promise<{
    output: unknown
    outputText: string
    sessionID?: string
    decisionEntriesCount: number
    intentSummary?: string
  }> {
    const executeIntentAnalysis = tools.analyze_intent.execute
    if (!executeIntentAnalysis) {
      throw new Error("intent_analysis redispatch binding is missing the analyze_intent execute handler")
    }
    const output = await executeIntentAnalysis(
      {
        reason: args.reason,
      },
      args.options as never,
    )
    const outputText = typeof output === "string" ? output : JSON.stringify(output)
    const sessions = (await Session.children(input.agentSessionID)).filter(
      (session) => session.kind === "intent-analysis" && !args.existingIntentAnalysisSessions.has(session.id),
    )
    const sessionID = sessions.sort((left, right) => {
      if (left.time.created !== right.time.created) return right.time.created - left.time.created
      return right.id.localeCompare(left.id)
    })[0]?.id
    const decisionLog = createDecisionLog(taskID)
    const decisionEntries = decisionLog.readByPhase("intent_analysis")
    const intentSummary = decisionEntries.find((entry) => entry.key === "intent_summary")?.value
    return {
      output,
      outputText,
      sessionID,
      decisionEntriesCount: decisionEntries.length,
      intentSummary,
    }
  }

  async function executeExploreStageRedispatch(args: {
    question: string
    reason: string
    options: unknown
    existingExploreSessions: Set<string>
    existingExploreDecisionIDs: Set<string>
    existingExplorationArtifactIDs: Set<string>
  }): Promise<{
    output: unknown
    outputText: string
    sessionID?: string
    decisionEntriesCount: number
    explorationArtifactsCount: number
    decisionEntryID?: string
    artifactID?: string
    question: string
  }> {
    const executeExplore = tools.explore.execute
    if (!executeExplore) {
      throw new Error("explore redispatch binding is missing the explore execute handler")
    }
    const question = args.question.trim()
    if (!question) {
      throw new Error("explore redispatch requires a non-empty question")
    }
    const output = await executeExplore(
      {
        question,
        reason: args.reason,
      },
      args.options as never,
    )
    const outputText = typeof output === "string" ? output : JSON.stringify(output)
    const sessions = (await Session.children(input.agentSessionID)).filter(
      (session) => session.kind === "explore" && !args.existingExploreSessions.has(session.id),
    )
    const sessionID = sessions.sort((left, right) => {
      if (left.time.created !== right.time.created) return right.time.created - left.time.created
      return right.id.localeCompare(left.id)
    })[0]?.id
    const decisionLog = createDecisionLog(taskID)
    const decisionEntries = decisionLog
      .readByPhase("explore")
      .filter((entry) => !args.existingExploreDecisionIDs.has(entry.id))
    const explorationArtifacts = listExplorationArtifacts({ taskID }).filter(
      (row) => !args.existingExplorationArtifactIDs.has(row.id),
    )
    return {
      output,
      outputText,
      sessionID,
      decisionEntriesCount: decisionEntries.length,
      explorationArtifactsCount: explorationArtifacts.length,
      decisionEntryID: decisionEntries.length === 1 ? decisionEntries[0]?.id : undefined,
      artifactID: explorationArtifacts.length === 1 ? explorationArtifacts[0]?.id : undefined,
      question,
    }
  }

  async function executeGoalWorkloadStageRedispatch(args: {
    reason: string
    options: unknown
    existingGoalWorkloadSessions: Set<string>
    existingGoalWorkloadArtifactIDs: Set<string>
  }): Promise<{
    output: unknown
    outputText: string
    sessionID?: string
    artifactID?: string
    specSnapshotID?: string
    briefsCount: number
    flaggedGoalsCount: number
    summary?: string
  }> {
    const executeWorkloadAnalysis = tools.workload_analysis.execute
    if (!executeWorkloadAnalysis) {
      throw new Error("workload_analysis redispatch binding is missing the workload_analysis execute handler")
    }
    const output = await executeWorkloadAnalysis(
      {
        reason: args.reason,
      },
      args.options as never,
    )
    const outputText = typeof output === "string" ? output : JSON.stringify(output)
    const sessions = (await Session.children(input.agentSessionID)).filter(
      (session) => session.kind === "goal-workload-analyst" && !args.existingGoalWorkloadSessions.has(session.id),
    )
    const sessionID = sessions.sort((left, right) => {
      if (left.time.created !== right.time.created) return right.time.created - left.time.created
      return right.id.localeCompare(left.id)
    })[0]?.id
    const artifacts = listGoalWorkloadArtifacts({ taskID })
      .filter((row) => !args.existingGoalWorkloadArtifactIDs.has(row.id))
      .sort((left, right) => {
        if (left.time_created !== right.time_created) return right.time_created - left.time_created
        return right.id.localeCompare(left.id)
      })
    if (artifacts.length > 1) {
      throw new Error(
        `workload_analysis redispatch created ambiguous goal_workload artifacts: ${artifacts
          .map((row) => row.id)
          .join(", ")}`,
      )
    }
    const artifact = artifacts[0]
    const payload = artifact?.payload as
      | {
          briefs?: Array<{ decomposition_concern?: unknown }>
          spec_snapshot_id?: unknown
          summary?: unknown
        }
      | undefined
    const briefs = Array.isArray(payload?.briefs) ? payload.briefs : []
    const flaggedGoalsCount = briefs.filter(
      (brief) => typeof brief.decomposition_concern === "string" && brief.decomposition_concern.trim().length > 0,
    ).length
    return {
      output,
      outputText,
      sessionID,
      artifactID: artifact?.id,
      specSnapshotID: typeof payload?.spec_snapshot_id === "string" ? payload.spec_snapshot_id : undefined,
      briefsCount: briefs.length,
      flaggedGoalsCount,
      summary: typeof payload?.summary === "string" ? payload.summary : undefined,
    }
  }

  async function executeFactCheckStageRedispatch(args: {
    continuationArtifactID: string
    sourceSessionID: string
    orchestratorSessionID: string
    normalizedStageInput: FactCheckStageInput
    reason: string
    options: unknown
    existingFactCheckAttemptIDs: Set<string>
  }): Promise<{
    output: unknown
    outputText: string
    sessionID?: string
    artifactID?: string
    targetSessionID?: string
    targetAgent?: string
    targetMessageID?: string
    targetMessageContentHash?: string
    verdict?: FactCheckReport["overall_verdict"]
    outcome?: FactCheckAttemptArtifact["outcome"]
    itemsTotal?: number
    itemsInspected?: number
    verifiedCount?: number
    correctedCount?: number
    unresolvedCount?: number
  }> {
    const executeFactCheck = tools.fact_check.execute
    if (!executeFactCheck) {
      throw new Error("fact_check redispatch binding is missing the fact_check execute handler")
    }
    const output = await executeFactCheck(
      {
        continuation_artifact_id: args.continuationArtifactID,
        reason: args.reason,
      },
      args.options as never,
    )
    const outputText = typeof output === "string" ? output : JSON.stringify(output)
    const artifacts = listFactCheckAttemptArtifacts({ taskID })
      .filter((row) => !args.existingFactCheckAttemptIDs.has(row.id))
      .sort((left, right) => {
        if (left.time_created !== right.time_created) return right.time_created - left.time_created
        return right.id.localeCompare(left.id)
      })
    if (artifacts.length > 1) {
      throw new Error(
        `fact_check redispatch created ambiguous fact_check_attempt artifacts: ${artifacts
          .map((row) => row.id)
          .join(", ")}`,
      )
    }
    const artifact = artifacts[0]
    const parsed = artifact ? FactCheckAttemptArtifactSchema.safeParse(artifact.payload) : undefined
    if (parsed && !parsed.success) {
      throw new Error(
        `fact_check redispatch attempt ${artifact?.id ?? "unknown"} has invalid payload: ${parsed.error.message}`,
      )
    }
    const payload = parsed?.data
    if (artifact && payload) {
      if (payload.fact_check_session_id !== args.sourceSessionID) {
        throw new Error(
          `fact_check redispatch attempt ${artifact.id} session ${payload.fact_check_session_id} does not match source ${args.sourceSessionID}`,
        )
      }
      if (payload.invoked_by_orchestrator_session_id !== args.orchestratorSessionID) {
        throw new Error(`fact_check redispatch attempt ${artifact.id} invoked_by_orchestrator_session_id mismatch`)
      }
      const expected = args.normalizedStageInput
      const mismatches: string[] = []
      if (payload.target_session_id !== expected.target_session_id) mismatches.push("target_session_id")
      if (payload.target_agent !== expected.target_agent) mismatches.push("target_agent")
      if (payload.target_message_id !== expected.target_message_id) mismatches.push("target_message_id")
      if (payload.target_message_content_hash !== expected.target_message_content_hash) {
        mismatches.push("target_message_content_hash")
      }
      if (payload.report.scope.target_session_id !== expected.target_session_id) {
        mismatches.push("report.scope.target_session_id")
      }
      if (payload.report.scope.target_agent !== expected.target_agent) mismatches.push("report.scope.target_agent")
      if (payload.report.scope.target_message_id !== expected.target_message_id) {
        mismatches.push("report.scope.target_message_id")
      }
      if (payload.report.scope.target_message_content_hash !== expected.target_message_content_hash) {
        mismatches.push("report.scope.target_message_content_hash")
      }
      if (payload.report.scope.items_total !== expected.fact_check_items.length) {
        mismatches.push("report.scope.items_total")
      }
      if (payload.report.scope.items_inspected > payload.report.scope.items_total) {
        mismatches.push("report.scope.items_inspected")
      }
      if (mismatches.length > 0) {
        throw new Error(`fact_check redispatch attempt ${artifact.id} scope mismatch: ${mismatches.join(", ")}`)
      }
    }
    return {
      output,
      outputText,
      sessionID: payload?.fact_check_session_id,
      artifactID: artifact?.id,
      targetSessionID: payload?.target_session_id,
      targetAgent: payload?.target_agent,
      targetMessageID: payload?.target_message_id,
      targetMessageContentHash: payload?.target_message_content_hash,
      verdict: payload?.report.overall_verdict,
      outcome: payload?.outcome,
      itemsTotal: payload?.report.scope.items_total,
      itemsInspected: payload?.report.scope.items_inspected,
      verifiedCount: payload?.report.verified.length,
      correctedCount: payload?.report.corrected.length,
      unresolvedCount: payload?.report.unresolved.length,
    }
  }

  function findBuildSessionContractForGoalRun(input: { goalRunID: string }) {
    return Database.use((db) =>
      db
        .select()
        .from(EngineArtifactTable)
        .where(
          and(
            eq(EngineArtifactTable.task_id, taskID),
            eq(EngineArtifactTable.kind, "build_session_contract"),
            sql`json_extract(${EngineArtifactTable.payload}, '$.goal_run_id') = ${input.goalRunID}`,
          ),
        )
        .get(),
    )
  }

  async function executeBuildStageRedispatch(args: {
    goalID: string
    reason: string
    request: string
    options: unknown
    existingGoalRunIDs: Set<string>
  }): Promise<{
    output: unknown
    outputText: string
    sessionID?: string
    goalRunID?: string
    goalRunStatus?: string
    buildSessionContractID?: string
    worktreeDir?: string | null
    worktreeBranch?: string | null
  }> {
    const executeBuild = tools.build.execute
    if (!executeBuild) {
      throw new Error("build redispatch binding is missing the build execute handler")
    }
    const output = await executeBuild(
      {
        goalID: args.goalID,
        reason: args.reason,
        ...(args.request.trim().length > 0 ? { request: args.request } : {}),
      },
      args.options as never,
    )
    const outputText = typeof output === "string" ? output : JSON.stringify(output)
    const newGoalRun = listGoalRunsByGoal(args.goalID).find((goalRun) => !args.existingGoalRunIDs.has(goalRun.id))
    const contract = newGoalRun ? findBuildSessionContractForGoalRun({ goalRunID: newGoalRun.id }) : undefined
    return {
      output,
      outputText,
      sessionID: newGoalRun?.session_id ?? undefined,
      goalRunID: newGoalRun?.id,
      goalRunStatus: newGoalRun?.status,
      buildSessionContractID: contract?.id,
      worktreeDir: newGoalRun?.workspace_dir,
      worktreeBranch: newGoalRun?.workspace_branch,
    }
  }

  // Phase 5-g: the deprecated dispatch tools (dispatch_goal / exec_goal /
  // submit_execution / retry_goal / create_run) that the 5-c filter hid
  // from the LLM are now fully deleted. Build is the single dispatch tool.
  const toolsWithDecisionMetadata = Object.fromEntries(
    Object.entries(tools).map(([name, raw]) => [name, withDecisionEffectMetadata(name, raw)]),
  ) as typeof tools
  return {
    tools: toolsWithDecisionMetadata,
  }
}
