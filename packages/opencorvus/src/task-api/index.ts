import z from "zod"
import { Output } from "ai"
import { NamedError } from "@opencorvus-ai/util/error"
import { streamText } from "@/llm/api"
import { Agent } from "@/agent/agent"
import { AgentRoleContract } from "@/agent/role-contract"
import { PromptProfileResolver } from "@/expert-squad/prompt-profile-resolver"
import { resolveAgentModel, resolveAgentModelRef, resolveConfiguredModelRef } from "@/agent/model"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { EffectiveConfig } from "@/config/effective"
import { discoverChecks, resolveConfig, resolvedChecks } from "@/acceptance/checks/discovery"
import { ExecutorNotConfiguredError } from "@/executor/contract"
import { ExecutorBootstrap } from "@/executor/bootstrap"
import { ExecutorRegistry } from "@/executor/registry"
import { PermissionNext } from "@/permission/next"
import { Provider } from "@/provider/provider"
import { ProviderLLM } from "@/provider/llm"
import { ProviderSchema } from "@/provider/schema"
import { ProtocolStore } from "@/protocol/store"
import { ProtocolEventTable } from "@/protocol/protocol.sql"
import { EngineProtocol } from "@/engine/protocol"
import { clearRewindCursor } from "@/engine/rewind"
import { ensureGitignore } from "@/engine/git"
import { Instance, lazyInstanceState } from "@/project/instance"
import { Project } from "@/project/project"
import { Worktree } from "@/worktree"
import { Question } from "@/question"
import { TaskQueueService } from "@/scheduler/task-queue-service"
import { Scheduler } from "@/scheduler"
import { Session } from "@/session"
import { SessionContext } from "@/session/context"
import { Message } from "@/session/message"
import { decodeRawBase64Payload } from "@/session/text-mime"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { SessionAgentIdentity } from "@/session/agent-identity"
import { Database, NotFoundError, and, desc, eq, inArray } from "@/storage/db"
import { Log } from "@/util/log"
import { compileBoard, boardTag } from "@/workbench/board"
import { compileBrief } from "@/workbench/brief"
import { recordNote } from "@/workbench/note-store"
import {
  EngineArtifactTable,
  EngineChannelBindingTable,
  EngineGoalTable,
  EngineInteractionRequestTable,
  EngineProgressSnapshotTable,
  EngineTaskTable,
  type EngineInteractionStatus,
  type EngineMetadata,
} from "@/engine/engine.sql"
import {
  Budget,
  CreateTaskInput,
  Event,
  AgentSessionOperatorSteerInput,
  RejectInteractionInput,
  ReplyInteractionInput,
  TaskMessageInput,
  CheckConfig,
  UpdateGoalInput,
  UpdateTaskChecksInput,
} from "@/engine/model"
import { ORCHESTRATOR_POLL_INTERVAL_MS, budgetRow, deriveTitle, progressStatus } from "@/engine/helpers"
import { orchestratorState } from "@/engine/orchestrator-state"
import { mergeTaskChecks, writeTaskChecks } from "@/engine/checks"
import {
  discardPendingQueuedOperatorWakeForRequest,
  discardQueuedTaskEvent,
  directoryQueueSnapshot,
  drainPendingQueuedOperatorWakes,
  dispatchTaskLoop,
  dispatchTaskLoopInBackground,
  type DispatchTaskLoopResult,
  listOrphanedActiveInProject,
  reorderQueuedTasksForCwd,
  startQueuedTaskInCwd,
  taskCwd,
} from "@/engine/queue"
import { openTaskForOperatorWake, reopenActiveRunForOperatorWake } from "@/engine/task-message-open"
import { OrchestratorEventNote } from "@/orchestrator/agent"
import {
  updateGoal as updateGoalRow,
  deleteGoal as deleteGoalRow,
  supersedePriorActivePlansForTask,
} from "@/engine/persist"
import { EngineInteraction } from "@/engine/interaction"
import { EngineRuntime } from "@/engine/runtime"
import {
  hooks,
  terminalTask,
  updateRun,
  updateTask,
  upsertTaskCriteria as upsertTaskCriteriaImpl,
} from "@/engine/state"
import {
  deriveTaskStatus,
  isTaskActive,
  isTaskCancelled,
  isTaskCompleted,
  isTaskFailed,
  isTaskQueued,
  isTaskTerminal,
} from "@/engine/task-status"
import { isLiveGoalRunStatus } from "@/engine/catalog"
import { persistQueuedTask, abortTaskPipeline, awaitPipelineSettled } from "@/engine/pipeline"
import { TaskChannelBindingProjectConflictError, TaskGlobalProjectBindingError } from "@/engine/task-project-error"
import {
  assertSessionPromptSubtreeFinished,
  requestSessionPromptSubtreeCancellation,
} from "@/engine/cancellation-scope"
import { createTaskCancellationIncomplete } from "@/engine/cancellation-error"
import { requestTaskAgentLifecycleCancellation } from "@/engine/task-agent-lifecycle"
import {
  AgentCoordinationPendingConflictError,
  cancelPendingAgentCoordinationRequest,
  cancelPendingAgentCoordinationRequestsForTask,
  createOperatorSteerCoordinationRequest,
  listPendingAgentCoordinationSessionControlRequests,
  resolveAgentCoordinationSessionOwnership,
} from "@/engine/agent-coordination"
import { abortGoalRunExecution } from "@/engine/execution-abort"
import { withTimeout, AwaitTimeoutError } from "@/util/await-with-timeout"
import { createDecisionLog } from "@/decision-log"
import { DecisionLogBundle } from "@/decision-log/bundle"
import { EngineEventLog } from "@/engine/event-log"
import { Orchestrator } from "@/orchestrator/agent"
import {
  AgentDirectReplyDisabledError,
  AgentSessionAttachmentReferenceError,
  AgentSessionPendingCoordinationError,
  InvalidReplyTargetKindError,
  ReplyTargetEnvelopeMissingError,
  SessionRuntimeContractMissingError,
  canReceiveDirectAgentReply,
} from "@/orchestrator/direct-reply"
import { OperatorSteerTargetError, OperatorSteerWakeError } from "@/orchestrator/operator-steer"
import { overlayMeta } from "@/orchestrator/protocol/message-bridge"
import { sessionRole, taskIDForSession } from "@/orchestrator/task-event"
import {
  activeRunBySession,
  findArtifacts,
  findAcceptanceByGoalRun,
  findAcceptanceByRun,
  findWorkspaceDiffsForAcceptance,
  findGoalRun,
  findLatestAcceptanceForRun,
  findActivePlanForTask,
  findActiveRunForTask,
  findLatestRunForTask,
  findEvaluationByRun,
  findEvaluations,
  findInteractionByExternal,
  findPendingInteractions,
  findPlan,
  findPlans,
  findRun,
  findRuns,
  findTask,
  findTaskByRequest,
  listGlobalTasks,
  listMissionTasks,
  listProjectTasks,
  listTaskRows,
  searchProjectTasks,
  listActiveSessionsForTask,
  listGoals,
  listGoalsByPlan,
  listGoalRunsForTask,
  listInteractions,
  listMilestones,
  listMilestonesByPlan,
  listSnapshots,
  requireInteraction,
  requireRun,
  requireTask,
  viewArtifact,
  viewAcceptance,
  viewEvaluation,
  viewGoal,
  viewInteraction,
  viewMilestone,
  viewPlan,
  viewRun,
  viewSnapshot,
  viewTask,
  type GoalRow,
  type GoalRunRow,
  type TaskListRow,
  type TaskRow,
  type PlanRow,
  type RunRow,
  type InteractionRow,
} from "@/engine/store"
import { goalStatusByID } from "@/engine/describe"
import { Identifier } from "@/id/id"
import { AttachmentStore } from "@/storage/attachment-store"
import { SessionWake } from "@/session/wake"
import { withTaskCreationOwnerLock } from "@/engine/task-creation-owner"
import { taskPrimaryProjectRoot } from "@/project/task-runtime-root"

const log = Log.create({ service: "assistant" })

type TaskMessageWakeStatus = Extract<DispatchTaskLoopResult, "started" | "queued"> | "not_woken"
type OperatorMessageWakeLabel = Extract<DispatchTaskLoopResult, "started" | "queued"> | "failed"

export const TaskEmptyMessageError = NamedError.create(
  "TaskEmptyMessageError",
  z.object({
    message: z.string(),
    taskID: z.string(),
  }),
)

export const ExternalChildTaskLineageError = NamedError.create(
  "ExternalChildTaskLineageError",
  z.object({
    message: z.string(),
    source: z.string().optional(),
  }),
)

const SCHEDULER_CHILD_TASK_SOURCE = "orchestrator:propose_task"

function hasCallerSuppliedChildTaskLineage(input: z.infer<typeof CreateTaskInput>) {
  const metadata = input.metadata
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false
  return Object.prototype.hasOwnProperty.call(metadata, "parent_task_id")
}

function assertNoCallerSuppliedChildTaskLineage(input: z.infer<typeof CreateTaskInput>) {
  if (!hasCallerSuppliedChildTaskLineage(input)) return
  throw new ExternalChildTaskLineageError({
    message:
      "metadata.parent_task_id is owned by the orchestrator scheduler. Other task creation tools must report the concrete problem instead of creating a child task directly.",
    source: input.source,
  })
}

function assertTaskProjectIsConcrete(task: TaskRow) {
  if (task.project_id !== "global") return
  throw new TaskGlobalProjectBindingError({
    message: `Task ${task.id} is bound to project global. Task workflow state requires a concrete Git project; recreate the task after initializing the directory as a Git repository.`,
    taskID: task.id,
    projectID: task.project_id,
  })
}

function assertTaskBelongsToCurrentProject(task: TaskRow) {
  assertTaskProjectIsConcrete(task)
  const current = Instance.current()
  if (!current) return
  if (task.project_id === current.project.id) return
  throw new NotFoundError({ message: `Task not found: ${task.id}` })
}

function requireTaskInCurrentProject(taskID: string): TaskRow {
  const task = requireTask(taskID)
  assertTaskBelongsToCurrentProject(task)
  return task
}

async function provideTaskRootSessionInstance<T>(task: TaskRow, fn: () => Promise<T>): Promise<T> {
  if (Instance.current() || !task.session_id) return fn()
  const session = await Session.getInProject({ sessionID: task.session_id, projectID: task.project_id })
  return Instance.provide({ directory: session.directory, fn })
}

async function provideActiveTaskRootSessionInstance<T>(task: TaskRow, fn: () => Promise<T>): Promise<T | undefined> {
  if (Instance.current() || !task.session_id) return fn()
  const session = await Session.getInProject({ sessionID: task.session_id, projectID: task.project_id })
  return Instance.tryProvideActive({ directory: session.directory, fn })
}

async function awaitTaskLoopIdleForDelete(taskID: string, idleTimeoutMs: number): Promise<void> {
  const { awaitTaskLoopIdle } = await import("@/orchestrator/loop")
  try {
    await awaitTaskLoopIdle(taskID, idleTimeoutMs)
  } catch (cause) {
    throw createTaskCancellationIncomplete({
      taskID,
      handle: "task loop idle before delete",
      cause,
    })
  }
}

async function awaitTaskQueuePromptsIdle(input: {
  sessionIDs: string[]
  timeoutMs: number
  taskID?: string
  handle: string
}): Promise<void> {
  try {
    await withTimeout(
      TaskQueueService.awaitSessionPromptsIdle({ sessionIDs: input.sessionIDs }),
      input.timeoutMs,
      input.handle,
    )
  } catch (cause) {
    throw createTaskCancellationIncomplete({
      taskID: input.taskID,
      handle: input.handle,
      cause,
    })
  }
}

async function settleTaskSessionWorkBeforePhysicalDelete(task: TaskRow, options?: DeleteTaskOptions): Promise<void> {
  const lifecycle = await requestTaskAgentLifecycleCancellation({
    task,
    reason: "task deleted",
    handle: "task-api.delete-task",
  })
  const queueCancelledInCurrentInstance = Boolean(Instance.current())
  TaskQueueService.cancelSessionPrompts({
    sessionIDs: lifecycle.sessionIDs,
    reason: "task deleted",
  })
  if (queueCancelledInCurrentInstance) {
    await awaitTaskQueuePromptsIdle({
      sessionIDs: lifecycle.sessionIDs,
      timeoutMs: options?.cleanupTimeoutMs ?? CANCEL_CLEANUP_TIMEOUT_MS,
      taskID: task.id,
      handle: "EngineService.deleteTask.TaskQueueService.awaitSessionPromptsIdle",
    })
  } else {
    await provideActiveTaskRootSessionInstance(task, async () => {
      TaskQueueService.cancelSessionPrompts({
        sessionIDs: lifecycle.sessionIDs,
        reason: "task deleted",
      })
      await awaitTaskQueuePromptsIdle({
        sessionIDs: lifecycle.sessionIDs,
        timeoutMs: options?.cleanupTimeoutMs ?? CANCEL_CLEANUP_TIMEOUT_MS,
        taskID: task.id,
        handle: "EngineService.deleteTask.TaskQueueService.awaitSessionPromptsIdle",
      })
    })
  }
  await assertSessionPromptSubtreeFinished({
    sessions: lifecycle.cancelledSessions,
    failures: lifecycle.cancellationFailures,
    taskID: task.id,
    handle: "EngineService.deleteTask",
    inactivityTimeoutMs: options?.promptSettleInactivityMs,
  })
}

async function recordTaskPhysicalDeleteBreadcrumb(
  task: TaskRow,
  origin: "EngineService.deleteTask" | "EngineService.deleteSession.deleteTasks",
  detail: Record<string, unknown> = {},
) {
  const status = deriveTaskStatus(task)
  const value = {
    taskID: task.id,
    projectID: task.project_id,
    sessionID: task.session_id,
    origin,
    statusBeforeDelete: status,
    ...detail,
  }
  createDecisionLog(task.id).append({
    phase: "delete",
    key: "task_physical_delete_breadcrumb",
    value: JSON.stringify(value),
    reason:
      "Task row is about to be physically deleted; this breadcrumb distinguishes explicit deletion from cancellation.",
  })
  EngineEventLog.appendPhysicalDeleteBreadcrumb(task.id, {
    origin,
    projectID: task.project_id,
    sessionID: task.session_id ?? undefined,
    status,
    detail,
  })
  await DecisionLogBundle.write(taskPrimaryProjectRoot(task.id), task.id)
}

function requireGoalInCurrentProject(goalID: string): GoalRow {
  const row = Database.use((db) => db.select().from(EngineGoalTable).where(eq(EngineGoalTable.id, goalID)).get())
  if (!row) throw new NotFoundError({ message: `Goal not found: ${goalID}` })
  requireTaskInCurrentProject(row.task_id)
  return row
}

function requireRunInCurrentProject(runID: string): RunRow {
  const row = requireRun(runID)
  requireTaskInCurrentProject(row.task_id)
  return row
}

function requireGoalRunInCurrentProject(goalRunID: string): GoalRunRow {
  const row = findGoalRun(goalRunID)
  if (!row) throw new NotFoundError({ message: `goal_run ${goalRunID} not found` })
  requireTaskInCurrentProject(row.task_id)
  return row
}

function requireInteractionInCurrentProject(interactionID: string): InteractionRow {
  const row = requireInteraction(interactionID)
  requireTaskInCurrentProject(row.task_id)
  return row
}

async function requireSessionTraceTaskInCurrentProject(sessionID: string): Promise<string> {
  const current = Instance.current()
  if (current) await Session.getInProject({ sessionID, projectID: current.project.id })
  else await Session.get(sessionID)

  const taskID = taskIDForSession(sessionID)
  if (!taskID) throw new NotFoundError({ message: `Session ${sessionID} is not bound to a task trace` })
  requireTaskInCurrentProject(taskID)
  return taskID
}

/**
 * Per-call deadline for `executor.abort()` during cancelTask / abortRun.
 * Mirrorcode and other executors await child-process cooperation; if the
 * child is unresponsive (hung opencorvus adapter, dead network), the abort
 * promise can hang forever. Expiry is fatal to cancellation success: callers
 * surface TaskCancellationIncompleteError instead of marking a zombie-prone
 * task cancelled.
 * Tests can override via CancelTaskOptions.
 */
export const CANCEL_ABORT_TIMEOUT_MS = 5_000

/**
 * Per-call deadline for the abort writer pass. Worktree cleanup is no
 * longer part of cancel; only successful goal completion may delete a
 * worktree. Keep the bound because aborting live rows still must not block
 * the API forever.
 */
export const CANCEL_CLEANUP_TIMEOUT_MS = 60_000

function missionTaskTitleInput(input: z.infer<typeof CreateTaskInput>):
  | {
      missionID: string
      sessionID: string
      semanticTitle: string
    }
  | undefined {
  if (input.source !== "mission") return undefined
  const metadata = input.metadata
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined
  if (metadata.actor !== "mission") return undefined
  const mission = metadata.mission
  if (!mission || typeof mission !== "object" || Array.isArray(mission)) return undefined
  const missionID = (mission as Record<string, unknown>).id
  const sessionID = (mission as Record<string, unknown>).session_id
  if (typeof missionID !== "string" || missionID.length === 0) return undefined
  if (typeof sessionID !== "string" || sessionID.length === 0) return undefined
  const semanticTitle = input.title?.trim().replace(/\s+/g, " ")
  if (!semanticTitle) {
    throw new Error(
      "Mission task creation requires title. " +
        "Provide a short semantic title; EngineService formats the Mission ledger prefix.",
    )
  }
  return { missionID, sessionID, semanticTitle }
}

function formatMissionTaskTitle(input: { ordinal: number; semanticTitle: string }): string {
  return `Phase ${String(input.ordinal).padStart(2, "0")}: ${input.semanticTitle}`
}

function resolveTaskTitle(input: z.infer<typeof CreateTaskInput>): string {
  const mission = missionTaskTitleInput(input)
  if (mission) {
    const existingMissionTasks = listMissionTasks({
      projectID: Instance.project.id,
      missionID: mission.missionID,
      sessionID: mission.sessionID,
    })
    return formatMissionTaskTitle({
      ordinal: existingMissionTasks.length + 1,
      semanticTitle: mission.semanticTitle,
    })
  }
  return input.title?.trim() || deriveTitle(input.request)
}

export interface CancelTaskOptions {
  /** Override the per-abort deadline (ms). Tests use this to keep wall time small. */
  abortTimeoutMs?: number
  /** Override the cleanup deadline (ms). Tests use this to force timeout in <1s. */
  cleanupTimeoutMs?: number
  /** Override prompt-settle inactivity (ms). Tests use this to keep zombie checks small. */
  promptSettleInactivityMs?: number
}

export interface DeleteTaskOptions extends CancelTaskOptions {
  /** Override task-loop idle proof inactivity (ms). Tests use this to keep zombie checks small. */
  taskLoopIdleTimeoutMs?: number
}

async function resolveDirectReplyTarget(taskID: string, sessionID: string) {
  const task = requireTaskInCurrentProject(taskID)
  const owningTask = taskIDForSession(sessionID)
  if (owningTask !== taskID) {
    throw new NotFoundError({ message: `Session ${sessionID} does not belong to task ${taskID}` })
  }
  const kind = sessionRole(sessionID)
  if (!kind) {
    throw new NotFoundError({ message: `Session ${sessionID} has no task agent kind` })
  }
  if (!canReceiveDirectAgentReply(kind)) {
    throw new InvalidReplyTargetKindError({
      message: `Session ${sessionID} has kind "${kind}" and cannot receive direct agent replies`,
      sessionID,
      kind,
    })
  }
  const session = await Session.getInProject({ sessionID, projectID: task.project_id })
  const latest = await latestSessionPromptEnvelope(sessionID)
  if (!latest) {
    throw new ReplyTargetEnvelopeMissingError({
      message: `Session ${sessionID} has no prior user prompt envelope to continue`,
      sessionID,
    })
  }

  return {
    session,
    prompt: latest,
  }
}

async function latestSessionPromptEnvelope(sessionID: string) {
  const messages = await Session.messages({ sessionID })
  const users = messages
    .map((message) => message.info)
    .filter((info): info is Message.User => info.role === "user")
    .sort((left, right) => (right.time.created ?? 0) - (left.time.created ?? 0))

  const latest = users[0]
  if (!latest) return

  const pickLatestDefined = <K extends keyof Message.User>(key: K): Message.User[K] | undefined => {
    for (const user of users) {
      const value = user[key]
      if (value !== undefined) return value
    }
    return undefined
  }

  const mergedExtra = users
    .slice()
    .reverse()
    .reduce<Record<string, unknown>>((acc, user) => {
      if (user.extra && typeof user.extra === "object") Object.assign(acc, user.extra)
      return acc
    }, {})

  // R5.1 item 6: the envelope carries ONLY conversational context — the
  // session's stable agent role plus system/tools/format/extra. The
  // historical model/variant are deliberately NOT carried; the model is
  // resolved fresh from the single resolver (keyed by current taskID + agent)
  // at the call site, so there is no history-derived model double source.
  return {
    agent: latest.agent,
    ...(pickLatestDefined("system") ? { system: pickLatestDefined("system") } : {}),
    ...(pickLatestDefined("systemMode") ? { systemMode: pickLatestDefined("systemMode") } : {}),
    ...(pickLatestDefined("tools") ? { tools: pickLatestDefined("tools") } : {}),
    ...(pickLatestDefined("format") ? { format: pickLatestDefined("format") } : {}),
    ...(Object.keys(mergedExtra).length > 0 ? { extra: mergedExtra } : {}),
  } satisfies Pick<Message.User, "agent" | "system" | "systemMode" | "tools" | "format" | "extra">
}

/**
 * The session's stable agent (its conversation role) from the latest
 * user/assistant message. R5.1 item 6: history may carry conversational
 * context (agent role / system / tools / format / extra) but it must NEVER
 * decide the MODEL — the model is resolved fresh from the single resolver
 * keyed by the current taskID + agent. So this returns the agent only; the
 * historical model/variant are deliberately dropped (rule 8: no
 * history-derived model double source).
 */
async function latestSessionAgent(sessionID: string): Promise<string | undefined> {
  const messages = await Session.messages({ sessionID })
  const latest = messages
    .map((message) => message.info)
    .filter((info) => info.role === "user" || info.role === "assistant")
    .sort((left, right) => (right.time?.created ?? 0) - (left.time?.created ?? 0))[0]
  return latest?.agent
}

async function appendDirectAgentSessionReply(input: {
  taskID: string
  sessionID: string
  message: string
  attachments?: Array<{ mime: string; url: string; filename?: string }>
}) {
  const text = input.message.trim()
  if (!text) throw new Error("message is required")
  const target = await resolveDirectReplyTarget(input.taskID, input.sessionID)
  const pendingCoordination = listPendingAgentCoordinationSessionControlRequests({
    taskID: input.taskID,
    sessionID: target.session.id,
  })
  if (pendingCoordination.length > 0) {
    const requestIDs = pendingCoordination.map((request) => request.payload.request_id)
    throw new AgentSessionPendingCoordinationError({
      message:
        `replyAgentSession: session ${target.session.id} has pending A2A (Agent-to-Agent) coordination request(s) ` +
        `${requestIDs.join(", ")}. Answer through respond_agent_coordination so direct guidance is bound to visible ` +
        `request/response/action artifacts.`,
      taskID: input.taskID,
      sessionID: target.session.id,
      requestIDs,
    })
  }
  const targetPrompt = SessionAgentIdentity.applyToPrompt(target.session.kind, target.prompt)
  if (!canReceiveDirectAgentReply(target.prompt.agent)) {
    throw new AgentDirectReplyDisabledError({
      message:
        `replyAgentSession: session ${target.session.id} (kind=${target.session.kind}) has its latest user envelope ` +
        `tagged agent="${target.prompt.agent}", which cannot receive generic direct replies. Use the agent ` +
        `coordination/operator-steer path so the correct runtime contract is installed.`,
      sessionID: target.session.id,
      sessionKind: target.session.kind,
      envelopeAgent: target.prompt.agent,
      reason: "envelope_agent_not_direct_replyable",
    })
  }
  // Validate the runtime contract BEFORE doing any model resolution.
  // resolveAgentModelRef can throw MissingModelConfigError (mapped to
  // server 500 by default) which would mask the more actionable 410
  // SessionRuntimeContractMissingError when both conditions apply —
  // a misconfigured project with a missing contract would surface as
  // a confusing "model missing" rather than the real "session is gone"
  // story the operator needs to act on. (rule 7 / rule 35 — single
  // unambiguous diagnostic per failure mode.)
  SessionPrompt.validateSessionRuntimeContractForContinuation({
    sessionID: target.session.id,
    sessionKind: target.session.kind,
    expectedAgentKind: targetPrompt.agent,
    expectedGoalID: target.session.goalID,
    requireWorkerTurnDescriptor:
      (SessionPrompt.agentKindRequiresRuntimeContract(targetPrompt.agent) ||
        SessionPrompt.agentKindRequiresRuntimeContract(target.session.kind)) &&
      targetPrompt.agent !== "orchestrator" &&
      target.session.kind !== "orchestrator",
    requireRuntimeContract:
      SessionPrompt.agentKindRequiresRuntimeContract(targetPrompt.agent) ||
      SessionPrompt.agentKindRequiresRuntimeContract(target.session.kind),
  })
  const attachmentRefs: AttachmentStore.Reference[] = []
  for (const attachment of input.attachments ?? []) {
    const located = AttachmentStore.nameFromUrl(attachment.url)
    if (!located) {
      throw new AgentSessionAttachmentReferenceError({
        message: `Direct reply attachment URL must be a stored attachment reference: ${attachment.url}`,
        taskID: input.taskID,
        sessionID: target.session.id,
        url: attachment.url,
        reason: "invalid_url",
      })
    }
    if (located.projectID !== target.session.projectID) {
      throw new AgentSessionAttachmentReferenceError({
        message: `Direct reply attachment belongs to project ${located.projectID}, expected ${target.session.projectID}`,
        taskID: input.taskID,
        sessionID: target.session.id,
        url: attachment.url,
        reason: "wrong_project",
      })
    }
    let reference: AttachmentStore.Reference
    let bytes: Buffer
    try {
      reference = await AttachmentStore.readReference(located.projectID, located.name)
      bytes = await AttachmentStore.read(located.projectID, located.name)
    } catch {
      throw new AgentSessionAttachmentReferenceError({
        message: `Direct reply attachment is not readable from AttachmentStore: ${attachment.url}`,
        taskID: input.taskID,
        sessionID: target.session.id,
        url: attachment.url,
        reason: "missing_attachment",
      })
    }
    if (attachment.mime !== reference.mime) {
      throw new AgentSessionAttachmentReferenceError({
        message: `Direct reply attachment metadata must match stored AttachmentStore metadata: ${attachment.url}`,
        taskID: input.taskID,
        sessionID: target.session.id,
        url: attachment.url,
        reason: "metadata_mismatch",
      })
    }
    attachmentRefs.push(
      await AttachmentStore.write(target.session.projectID, bytes, reference.mime, reference.filename),
    )
  }
  const messageID = Identifier.ascending("message")
  // R5.1 item 6: the agent is the session's stable conversation role from the
  // envelope, but the MODEL is resolved fresh from the single resolver keyed
  // by the current taskID + agent — never reused from the history envelope.
  // The historical `variant` (model-selection family, §14.2) is dropped for
  // the same single-source reason; the effective variant comes from the
  // session overlay at stream time, not from a pinned history value.
  const resolvedModel = await resolveAgentModelRef(targetPrompt.agent, { taskID: input.taskID })
  const message: Message.User = {
    id: messageID,
    sessionID: target.session.id,
    role: "user",
    time: { created: Date.now() },
    agent: targetPrompt.agent,
    model: { providerID: resolvedModel.providerID, modelID: resolvedModel.modelID },
    ...(targetPrompt.system ? { system: targetPrompt.system } : {}),
    ...(targetPrompt.systemMode ? { systemMode: targetPrompt.systemMode } : {}),
    ...(targetPrompt.tools ? { tools: targetPrompt.tools } : {}),
    ...(targetPrompt.format ? { format: targetPrompt.format } : {}),
    extra: {
      ...(targetPrompt.extra ?? {}),
      overlay_direct_reply: true,
      source: "overlay_direct_reply",
      taskID: input.taskID,
      targetSessionID: target.session.id,
    },
  }
  const parts: Message.Part[] = [
    {
      id: Identifier.ascending("part"),
      messageID,
      sessionID: target.session.id,
      type: "text",
      text,
      kind: "user_content",
      source: "user",
      metadata: {
        overlay_direct_reply: true,
        source: "overlay_direct_reply",
        taskID: input.taskID,
        targetSessionID: target.session.id,
      },
    },
  ]
  for (const attachment of attachmentRefs) {
    parts.push({
      id: Identifier.ascending("part"),
      messageID,
      sessionID: target.session.id,
      type: "file",
      mime: attachment.mime,
      url: attachment.url,
      ...(attachment.filename ? { filename: attachment.filename } : {}),
    })
  }
  await Session.persistMessage({
    info: message,
    parts,
    touchSessionID: target.session.id,
  })
  void SessionContext.provide(target.session, () => SessionPrompt.loop({ sessionID: target.session.id })).catch(
    (error) => {
      SessionStatus.set(target.session.id, {
        type: "terminal",
        reason: "error",
        error: error instanceof Error ? error.message : String(error),
      })
      log.error("direct agent session reply loop failed", {
        sessionID: target.session.id,
        taskID: input.taskID,
        error,
      })
    },
  )
  return {
    task_id: input.taskID,
    session_id: target.session.id,
    message_id: messageID,
  }
}

type OperatorSteerDispatch = typeof dispatchTaskLoop

function isOperatorSteerTargetSessionKind(kind: string): boolean {
  return AgentRoleContract.isAgentOwnedTaskWorkerID(kind)
}

function latestPersistedSessionStatus(sessionID: string): SessionStatus.Info | undefined {
  const row = Database.use((db) =>
    db
      .select({ payload: ProtocolEventTable.payload })
      .from(ProtocolEventTable)
      .where(and(eq(ProtocolEventTable.session_id, sessionID), eq(ProtocolEventTable.type, "session.status")))
      .orderBy(desc(ProtocolEventTable.emitted_at), desc(ProtocolEventTable.seq))
      .get(),
  )
  const parsed = SessionStatus.Info.safeParse((row?.payload as { status?: unknown } | undefined)?.status)
  return parsed.success ? parsed.data : undefined
}

async function resolveOperatorSteerTarget(input: { task: TaskRow; sessionID: string }): Promise<{
  session: Awaited<ReturnType<typeof Session.get>>
  agent: string
  goalID?: string
  goalRunID?: string
}> {
  const session = await Session.get(input.sessionID)
  const owningTask = taskIDForSession(session.id)
  if (owningTask && owningTask !== input.task.id) {
    throw new OperatorSteerTargetError({
      message: `operatorSteerAgentSession: session ${session.id} belongs to task ${owningTask}, not ${input.task.id}.`,
      taskID: input.task.id,
      sessionID: session.id,
      reason: "foreign_task",
    })
  }
  if (input.task.session_id === session.id || session.kind === "root") {
    throw new OperatorSteerTargetError({
      message: `operatorSteerAgentSession: session ${session.id} is the task root; use the task message route for task-level operator input.`,
      taskID: input.task.id,
      sessionID: session.id,
      reason: "task_root",
    })
  }
  if (session.kind === "orchestrator") {
    throw new OperatorSteerTargetError({
      message: `operatorSteerAgentSession: session ${session.id} is an orchestrator session, not a target sub-agent session.`,
      taskID: input.task.id,
      sessionID: session.id,
      reason: "orchestrator_session",
    })
  }
  if (!isOperatorSteerTargetSessionKind(session.kind)) {
    throw new OperatorSteerTargetError({
      message: `operatorSteerAgentSession: session ${session.id} kind=${session.kind} is not an agent-owned worker session.`,
      taskID: input.task.id,
      sessionID: session.id,
      reason: "invalid_kind",
    })
  }

  const runtimeContract = SessionPrompt.getSessionRuntimeContract(session.id)
  const agent = runtimeContract?.identity.agentKind ?? session.kind
  const goalID = runtimeContract?.identity.goalID ?? session.goalID
  const goalRunID = runtimeContract?.identity.goalRunID
  const pendingCoordination = listPendingAgentCoordinationSessionControlRequests({
    taskID: input.task.id,
    sessionID: session.id,
    goalRunID,
  })
  if (pendingCoordination.length > 0) {
    const requestIDs = pendingCoordination.map((request) => request.payload.request_id)
    throw new AgentSessionPendingCoordinationError({
      message:
        `operatorSteerAgentSession: session ${session.id} has pending coordination request(s) ` +
        `${requestIDs.join(", ")}. Answer the existing request through respond_agent_coordination before adding new operator steer.`,
      taskID: input.task.id,
      sessionID: session.id,
      requestIDs,
    })
  }

  const processStatus = SessionStatus.get(session.id)
  const persistedStatus = latestPersistedSessionStatus(session.id)
  const terminalStatus =
    processStatus.type === "terminal"
      ? processStatus
      : persistedStatus?.type === "terminal"
        ? persistedStatus
        : undefined
  if (terminalStatus) {
    throw new SessionRuntimeContractMissingError({
      message: `operatorSteerAgentSession: session ${session.id} is terminal (${terminalStatus.reason}); redispatch or retry through a visible lifecycle action instead of steering a stale session.`,
      sessionID: session.id,
      agentKind: agent,
      reason: "terminal_satisfied",
    })
  }

  try {
    resolveAgentCoordinationSessionOwnership({
      taskID: input.task.id,
      sessionID: session.id,
      goalID,
      goalRunID,
    })
  } catch (error) {
    throw new OperatorSteerTargetError({
      message:
        error instanceof Error
          ? `operatorSteerAgentSession: ${error.message}`
          : `operatorSteerAgentSession: ${String(error)}`,
      taskID: input.task.id,
      sessionID: session.id,
      reason: "unowned_session",
    })
  }

  return { session, agent, goalID, goalRunID }
}

async function continueTaskMessage(
  taskID: string,
  text: string,
  source: string,
  attachments: AttachmentStore.Reference[] = [],
) {
  const attachmentSummary =
    attachments.length > 0
      ? [
          "Attachments:",
          ...attachments.map((ref, index) => {
            const name = AttachmentStore.displayFilename({
              filename: ref.filename,
              mime: ref.mime,
              sha: ref.sha,
              index,
            })
            return `- ${name} — ${ref.mime} — url: ${ref.url}`
          }),
        ].join("\n")
      : undefined
  const wake = await appendAndWakeTaskOperatorMessage({ taskID, text, attachments, attachmentSummary, source })

  return {
    mode: "scheduler" as const,
    resumed: wake.resumed,
    wakeStatus: wake.wakeStatus,
    status: deriveTaskStatus(wake.task) as string,
    user_message: wake.userMessage,
  }
}

async function appendAndWakeTaskOperatorMessage(input: {
  taskID: string
  text: string
  attachments?: AttachmentStore.Reference[]
  attachmentSummary?: string
  source: string
}): Promise<{
  task: TaskRow
  userMessage: { info: Message.User; parts: Message.Part[] }
  resumed: boolean
  wakeStatus: TaskMessageWakeStatus
}> {
  const task = requireTaskInCurrentProject(input.taskID)
  assertTaskOperatorMessageAccepted(task, input.text, input.attachments ?? [])

  // Append the user message to session history. The describe layer and
  // orchestrator prompt both read session messages, so this is the single
  // task-level operator-message owner for /message and /inject.
  const source = input.source
  const userMessage = await appendTaskSessionMessage(task, input.text, source, input.attachments ?? [])
  await clearRewindCursor(input.taskID)
  await EngineProtocol.emit(
    Event.TaskMessageRecorded,
    {
      taskID: input.taskID,
      kind: "note",
      source,
      text: input.text,
      summary: "Operator note recorded",
      messageID: userMessage.info.id,
    },
    { taskID: input.taskID, source: "service.message" },
  )
  const wakeTask = await openTaskForOperatorWake(task, "Operator message reopened task")
  await reopenActiveRunForOperatorWake(wakeTask, "Operator message reopened blocked run")

  const event = {
    note: OrchestratorEventNote.operatorMessage({
      text: input.text,
      attachmentSummary: input.attachmentSummary,
    }),
    operatorMessage: {
      text: input.text,
      attachmentSummary: input.attachmentSummary,
      source,
      messageID: userMessage.info.id,
    },
  }
  let acceptedWakeRecorded = false
  let dispatchResult: DispatchTaskLoopResult
  try {
    dispatchResult = await dispatchTaskLoop({
      taskID: input.taskID,
      event,
      beforeAcceptedWake: async ({ result }) => {
        recordOperatorMessageWake({
          taskID: input.taskID,
          messageID: userMessage.info.id,
          source,
          wakeStatus: result,
        })
        acceptedWakeRecorded = true
      },
    })
  } catch (error) {
    recordOperatorMessageWake({
      taskID: input.taskID,
      messageID: userMessage.info.id,
      source,
      wakeStatus: "failed",
      error,
    })
    throw error
  }
  if (dispatchResult === "ignored") {
    recordOperatorMessageWake({
      taskID: input.taskID,
      messageID: userMessage.info.id,
      source,
      wakeStatus: "failed",
      error: new Error(`dispatchTaskLoop returned ignored for operator message ${userMessage.info.id}`),
    })
    throw new Error(`Task ${input.taskID} operator message was recorded, but the orchestrator wake was ignored.`)
  }
  if (!acceptedWakeRecorded) {
    recordOperatorMessageWake({
      taskID: input.taskID,
      messageID: userMessage.info.id,
      source,
      wakeStatus: "failed",
      error: new Error(`dispatchTaskLoop returned ${dispatchResult} without accepting operator message wake`),
    })
    throw new Error(
      `Task ${input.taskID} operator message ${userMessage.info.id} dispatch returned ${dispatchResult} without wake acceptance.`,
    )
  }

  return {
    task: requireTaskInCurrentProject(input.taskID),
    userMessage,
    resumed: dispatchResult === "started",
    wakeStatus: dispatchResult,
  }
}

function recordOperatorMessageWake(input: {
  taskID: string
  messageID: string
  source: string
  wakeStatus: OperatorMessageWakeLabel
  error?: unknown
}): void {
  const now = Date.now()
  const error =
    input.error instanceof Error
      ? { name: input.error.name, message: input.error.message }
      : input.error === undefined
        ? undefined
        : { name: "Error", message: String(input.error) }
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id: Identifier.ascending("artifact"),
        task_id: input.taskID,
        run_id: null,
        goal_run_id: null,
        acceptance_id: null,
        kind: "operator_message_wake",
        label: input.wakeStatus,
        payload: {
          task_id: input.taskID,
          message_id: input.messageID,
          source: input.source,
          wake_status: input.wakeStatus,
          time_recorded: now,
          recorded_by_process_id: process.pid,
          ...(error ? { error } : {}),
        },
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

function assertTaskOperatorMessageAccepted(task: TaskRow, text: string, attachments: readonly unknown[] = []) {
  if (text.trim().length === 0 && attachments.length === 0) {
    throw new TaskEmptyMessageError({
      message: `Task ${task.id} cannot accept an empty task-level message.`,
      taskID: task.id,
    })
  }
}

function terminalTaskNotificationText(input: {
  task: TaskRow
  status: string
  summary: string
  error?: string
  relation: "parent" | "mission"
}) {
  const lines = [
    input.relation === "parent" ? "Child task terminal update." : "Mission task terminal update.",
    `task_id: ${input.task.id}`,
    `title: ${input.task.title}`,
    `status: ${input.status}`,
    `summary: ${input.summary}`,
  ]
  if (input.error) lines.push(`error: ${input.error}`)
  lines.push("Reconcile this task result now and decide the next action.")
  return lines.join("\n")
}

function missionProvenance(
  metadata: EngineMetadata | null | undefined,
): { id: string; session_id: string } | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined
  const mission = metadata.mission
  if (!mission || typeof mission !== "object" || Array.isArray(mission)) return undefined
  const id = (mission as Record<string, unknown>).id
  const sessionID = (mission as Record<string, unknown>).session_id
  if (typeof id !== "string" || id.length === 0) return undefined
  if (typeof sessionID !== "string" || sessionID.length === 0) return undefined
  return { id, session_id: sessionID }
}

async function appendTaskSessionMessage(
  task: TaskRow,
  text: string,
  source: string,
  attachments: AttachmentStore.Reference[] = [],
): Promise<{ info: Message.User; parts: Message.Part[] }> {
  // Rule 7: no silent fallback. A task without a session_id or whose
  // session has lost its agent/model context cannot accept a message —
  // the previous `return undefined` branch let `injectMessage` think the
  // append succeeded, dispatchTaskLoop fired, and the operator's text
  // was never visible to the orchestrator (memory:
  // feedback_task_terminal_state_revivable.md, second wedge variant).
  // Throw so the caller surfaces the real failure instead of pretending
  // the message landed.
  if (!task.session_id) {
    throw new Error(
      `Task ${task.id} has no root session — cannot append operator message; recreate the task or repair task.session_id`,
    )
  }
  const ctx = await messageContext(task.session_id, task.id)
  if (!ctx) {
    throw new Error(
      `Task ${task.id} session ${task.session_id} has no agent/model context — cannot append operator message`,
    )
  }
  const info = {
    id: Identifier.ascending("message"),
    role: "user",
    sessionID: task.session_id,
    time: {
      created: Date.now(),
    },
    agent: ctx.agent,
    model: ctx.model,
    extra: {
      operator_message: {
        source,
      },
    },
  } satisfies Message.User
  const meta = overlayMeta(task.session_id, task.session_id, info)
  const parts: Message.Part[] = []
  if (text.length > 0) {
    const textPart: Message.TextPart = {
      id: Identifier.ascending("part"),
      messageID: info.id,
      sessionID: task.session_id,
      type: "text",
      text,
      kind: "user_content",
    }
    parts.push(textPart)
  }
  for (const ref of attachments) {
    const filePart: Message.FilePart = {
      id: Identifier.ascending("part"),
      messageID: info.id,
      sessionID: task.session_id,
      type: "file",
      mime: ref.mime,
      url: ref.url,
      filename: ref.filename,
    }
    parts.push(filePart)
  }
  const persisted = await Session.persistMessage({
    info,
    parts,
    touchSessionID: task.session_id,
  })
  return { info: { ...(persisted.info as Message.User), ...meta }, parts: persisted.parts }
}

/**
 * Resolve the {agent, model} a task-owned operator/direct-reply message
 * should carry. R5.1 item 6: the agent is the session's stable conversation
 * role (history-derived agent is conversation context, allowed); the MODEL is
 * resolved fresh from the single resolver keyed by the CURRENT taskID + agent
 * — never reused from history. Strict — a missing model config is a hard
 * project-setup error that must surface, not be papered over.
 */
async function messageContext(sessionID: string, taskID: string) {
  const session = await Session.get(sessionID)
  const task = requireTask(taskID)
  const config = await EffectiveConfig.effective({ taskID, sessionID })
  const name =
    (session.kind === "root" && task.session_id === session.id ? "orchestrator" : undefined) ??
    SessionAgentIdentity.ownedAgentForSessionKind(session.kind) ??
    (await latestSessionAgent(sessionID)) ??
    (await Agent.defaultAgent({ config }).catch(() => undefined))
  const agent = name ? await Agent.get(name, { config }).catch(() => undefined) : undefined
  const model = name ? await resolveAgentModelRef(name, { taskID }) : await resolveConfiguredModelRef({ taskID })
  if (!agent || !model) return
  return {
    agent: agent.name,
    model: {
      providerID: model.providerID,
      modelID: model.modelID,
    },
  }
}

async function prepareProject(project?: string) {
  // Note (W2-V32): a previous version auto-ran `Project.initGit` here when
  // `Instance.directory` was not a git repo. That made task creation a
  // hidden side effect that wrote `.git` to disk without user confirmation
  // (rule 7: no fallback). It also cascaded the darwin failure mode: any
  // failing project bootstrap on the wrong directory would attempt git init
  // before throwing.
  //
  // We now throw WorktreeNotGitError (NamedError → onError 412) so the
  // overlay can render an explicit "Initialize this directory as a git
  // repository?" prompt and call POST /project/current/init-git on a real
  // user gesture. The error message names the directory so the prompt has
  // context.
  if (!Project.isGitRepo(Instance.directory)) {
    throw new Worktree.NotGitError({
      message: `Cannot create a task in ${Instance.directory}: the directory is not a git repository. Initialize it via POST /project/current/init-git or pick a different working directory.`,
    })
  }
  // Create .gitignore before executor starts so the agent's own commits never include node_modules/dist etc.
  await ensureGitignore()
  if (!project) return
  if (project === Instance.project.id) return
  throw new Error(`project mismatch: expected ${Instance.project.id}, got ${project}`)
}

function taskSummary(
  rows: Array<{
    time_started: number | null
    time_completed: number | null
    error?: string | null
    metadata?: Record<string, unknown> | null
  }>,
) {
  const completed = rows
    .filter((row) => typeof row.time_started === "number" && typeof row.time_completed === "number")
    .map((row) => (row.time_completed ?? 0) - (row.time_started ?? 0))
    .filter((value) => value > 0)
    .sort((a, b) => a - b)

  return {
    total_tasks: rows.length,
    open_tasks: rows.filter((row) => !isTaskTerminal(row)).length,
    running_tasks: rows.filter((row) => isTaskActive(row)).length,
    blocked_tasks: 0,
    completed_tasks: rows.filter((row) => isTaskCompleted(row)).length,
    failed_tasks: rows.filter((row) => isTaskFailed(row)).length,
    cancelled_tasks: rows.filter((row) => isTaskCancelled(row)).length,
    median_completion_ms: completed.length === 0 ? undefined : completed[Math.floor((completed.length - 1) / 2)],
  }
}

function taskItems(rows: TaskListRow[]) {
  const queueRevisions = new Map<string, string>()
  const groupedQueued = new Map<string, TaskRow[]>()
  for (const item of rows) {
    if (!item.directory) continue
    if (!isTaskQueued(item.task)) continue
    const list = groupedQueued.get(item.directory) ?? []
    list.push(item.task)
    groupedQueued.set(item.directory, list)
  }
  for (const [directory, tasks] of groupedQueued.entries()) {
    const revision = tasks
      .slice()
      .sort((a, b) => {
        const criticalDelta = (a.priority === "critical" ? 0 : 1) - (b.priority === "critical" ? 0 : 1)
        if (criticalDelta !== 0) return criticalDelta
        if (a.queue_order !== b.queue_order) return a.queue_order - b.queue_order
        if (a.time_created !== b.time_created) return a.time_created - b.time_created
        return a.id.localeCompare(b.id)
      })
      .map((task) => `${task.id}:${task.queue_order}:${task.time_updated}`)
      .join("|")
    queueRevisions.set(directory, revision)
  }

  return rows.map((item) => {
    const task = item.task
    const plan = findActivePlanForTask(task.id)
    const run = projectedRunForTask(task)
    const evaluation = run ? findEvaluationByRun(run.id) : undefined
    const pendingInteractions = listInteractions(task.id).filter((entry) => entry.status === "pending")
    const taskView = viewTask(task, { directory: item.directory })
    if (taskView.queue && item.directory && isTaskQueued(task)) {
      taskView.queue.revision = queueRevisions.get(item.directory)
    }
    return {
      task: taskView,
      project: item.project,
      plan: plan ? viewPlan(plan) : undefined,
      run: run ? viewRun(run) : undefined,
      evaluation: evaluation ? viewEvaluation(evaluation) : undefined,
      active_sessions: listActiveSessionsForTask(task.id),
      pending_interactions: pendingInteractions.length,
      pending_interaction_items: pendingInteractions.map(viewInteraction),
      updated_at: task.time_updated,
    }
  })
}

function projectedRunForTask(task: TaskRow) {
  return findActiveRunForTask(task.id) ?? (isTaskTerminal(task) ? findLatestRunForTask(task.id) : undefined)
}

async function taskChecks(checks?: z.input<typeof CheckConfig>) {
  const found = await discoverChecks()
  const next = structuredClone(resolvedChecks(await resolveConfig(checks ? { checks } : undefined), found))

  if (found.lint.length > 0 && next.lint === false) {
    next.lint = found.lint.map((item) => item.command)
  }

  const current = next.named?.typecheck
  const typecheck = found.named.typecheck
  if (current || typecheck) {
    next.named = {
      ...(next.named ?? {}),
      typecheck: {
        label: current?.label ?? typecheck?.label ?? "Type Check",
        family: current?.family ?? typecheck?.family ?? "lint",
        commands: current?.commands ?? typecheck?.commands.map((item) => item.command) ?? [],
        enabled: true,
        ...(current?.cwd ? { cwd: current.cwd } : {}),
      },
    }
  }

  next.spec_check = {
    ...(next.spec_check ?? {}),
    enabled: true,
    mode: next.spec_check?.mode ?? "strict",
  }

  return CheckConfig.parse(next)
}

/** Thrown when the planning tool role cannot produce a valid plan. Server routes
 *  map this to a 4xx so the user sees the planner failure rather than a
 *  generic 500. */
export class PlannerFailureError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "PlannerFailureError"
  }
}

export class TaskQueueStartError extends Error {
  constructor(
    message: string,
    readonly code: "not_queued" | "no_directory",
  ) {
    super(message)
    this.name = "TaskQueueStartError"
  }
}

type FileRef = {
  sha: string
  url: string
  mime: string
  size: number
  filename?: string
  intent?: string
  source?: string
}
type FileRefColumn = "attachments" | "system_artifacts"

type ApiAttachmentInput = NonNullable<z.infer<typeof CreateTaskInput>["attachments"]>[number]
type DecodedApiAttachment = {
  attachment: ApiAttachmentInput
  bytes: Buffer
}

function decodeApiAttachments(input: {
  attachments: ApiAttachmentInput[] | undefined
  label: string
}): DecodedApiAttachment[] {
  return (input.attachments ?? []).map((attachment) => ({
    attachment,
    bytes: decodeRawBase64Payload(attachment.data, `${input.label} ${attachment.filename ?? attachment.mime}`),
  }))
}

export namespace EngineService {
  const restartLifecycleState = lazyInstanceState(() => ({
    restartLifecycleChecked: false,
    restartLifecycleRunning: false,
  }))

  export function init() {
    const current = orchestratorState()
    if (!current.booted) {
      EngineInteraction.subscribe(hooks())
      current.booted = true
    }
    // Narrow runtime observer: project interaction blockers and terminal-goal
    // refill facts into durable state. This does not restore executor/status
    // polling or the retired no-live-goal batch wake.
    Scheduler.register({
      id: "engine.liveness",
      interval: ORCHESTRATOR_POLL_INTERVAL_MS,
      scope: "instance",
      run: async () => {
        await wakeRestartLifecycleFactsForActiveTasks()
        await EngineRuntime.monitorRuns(hooks())
        await drainPendingQueuedOperatorWakes()
      },
    })
    // Phase-7: no aggressive startup recovery. Live build attempts and
    // terminal refill facts are durable; orphan runs surface via describe.ts
    // `run_orphan` on the next wake and the orchestrator LLM decides whether
    // to retry / re-dispatch / fail_task / drop. OS-level cleanup (worktrees,
    // processes) is owned by the ownership registry, not by a recovery
    // function.
  }

  async function wakeRestartLifecycleFactsForActiveTasks(): Promise<void> {
    const state = restartLifecycleState()
    if (state.restartLifecycleChecked || state.restartLifecycleRunning) return
    state.restartLifecycleRunning = true
    try {
      const tasks = listOrphanedActiveInProject(Instance.project.id)
      state.restartLifecycleChecked = true
      const failures: string[] = []
      for (const task of tasks) {
        await (async () => {
          const event = await EngineProtocol.emit(
            Event.TaskLifecycleFact,
            {
              taskID: task.id,
              fact: "server_restart_active_task_recovered",
              status: deriveTaskStatus(task),
              orphaned: true,
              summary:
                "Server restart found this active task without an in-process task loop; waking orchestrator from lifecycle fact.",
            },
            { source: "engine.liveness", target: "orchestrator" },
          )
          await dispatchTaskLoop({
            taskID: task.id,
            event: {
              lifecycleFact: {
                kind: "server_restart_active_task_recovered",
                eventID: event.id,
              },
            },
          })
        })().catch((error) => {
          failures.push(`${task.id}: ${error instanceof Error ? error.message : String(error)}`)
        })
      }
      if (failures.length > 0) {
        throw new Error(`Failed to wake restart lifecycle facts for active tasks: ${failures.join("; ")}`)
      }
    } finally {
      state.restartLifecycleRunning = false
    }
  }

  export async function createTask(raw: z.input<typeof CreateTaskInput>) {
    const input = CreateTaskInput.parse(raw)
    assertNoCallerSuppliedChildTaskLineage(input)
    return withTaskCreationOwnerLock(input, () => createTaskInner(input))
  }

  export async function createSchedulerChildTask(
    raw: z.input<typeof CreateTaskInput> & {
      parentTaskID: string
    },
  ) {
    const { parentTaskID, ...taskRaw } = raw
    const parsed = CreateTaskInput.parse(taskRaw)
    assertNoCallerSuppliedChildTaskLineage(parsed)
    const parentTaskIDValue = parentTaskID.trim()
    if (!parentTaskIDValue) {
      throw new ExternalChildTaskLineageError({
        message: "Scheduler child task creation requires a non-empty parent task ID.",
        source: SCHEDULER_CHILD_TASK_SOURCE,
      })
    }
    const input = CreateTaskInput.parse({
      ...parsed,
      source: SCHEDULER_CHILD_TASK_SOURCE,
      metadata: {
        ...(parsed.metadata ?? {}),
        parent_task_id: parentTaskIDValue,
      },
    })
    return withTaskCreationOwnerLock(input, () => createTaskInner(input))
  }

  async function createTaskInner(input: z.infer<typeof CreateTaskInput>) {
    await prepareProject(input.project)
    const existingBindingTask = existingTaskByChannelBinding(input.channelBinding)
    if (existingBindingTask) return existingBindingTask
    const requestID = input.requestID?.trim() || undefined
    if (requestID) {
      const existing = findTaskByRequest(Instance.project.id, requestID)
      if (existing) return existing.id
    }
    const title = resolveTaskTitle(input)
    const executor = input.executor ?? "opencorvus"
    if (executor !== "opencorvus" && !ExecutorRegistry.has(executor)) {
      await ExecutorBootstrap.autoRegister(true).catch((err) => {
        log.warn("executor autoRegister failed", { executor, error: String(err) })
      })
    }
    ExecutorRegistry.require(executor)
    if (!input.model) {
      await resolveConfiguredModelRef()
    }
    const now = Date.now()
    const taskID = Identifier.ascending("task")
    const decodedAttachments = decodeApiAttachments({
      attachments: input.attachments,
      label: `Task ${taskID} attachment`,
    })
    // The task's root session: it holds the user's original request and the
    // pointer engine_task.session_id. Its children are the orchestrator's
    // own session and each sub-agent session (planner/executor/...).
    const taskConfigSnapshot = await EffectiveConfig.snapshotCurrent()
    const session = await Session.create({ kind: "root", title })
    await Session.mergeMetadata({
      sessionID: session.id,
      patch: { [EffectiveConfig.TASK_SNAPSHOT_KEY]: taskConfigSnapshot },
    })
    if (input.model) {
      await Session.mergeConfigOverlay({
        sessionID: session.id,
        patch: { model: input.model },
      })
    }
    if (input.promptProfile) {
      await PromptProfileResolver.assertKnownProfileID({
        projectDirectory: Instance.directory,
        profileID: input.promptProfile,
      })
      await Session.mergeConfigOverlay({
        sessionID: session.id,
        patch: { prompt_profile: { active: input.promptProfile } },
      })
    }
    const resolvedChecks = await taskChecks(input.checks)
    const metadata = {
      ...(input.metadata ?? {}),
      ...(input.routing ? { routing: input.routing } : {}),
      ...(Object.keys(resolvedChecks).length > 0 ? { checks: resolvedChecks } : {}),
    } as Record<string, unknown>

    // Phase-6-f-3-bis-b: workflow_state is no longer persisted. The
    // orchestrator resolves the default workflow fresh on each wake and
    // projects step status from side-effects (spec / goals / runs /
    // acceptance presence). board.ts::buildWorkflowFields likewise no
    // longer reads task.workflow_state — it always defaults to pipeline
    // and projects step status from DB rows.

    // Hierarchical permission model (rule 23): built-in tools default to
    // `allow` (see PermissionNext.evaluate). Agent-scoped overlays
    // (orchestrator, acceptance, ...) layer on top via setPermission. Operators
    // restrict via explicit `deny` / `ask` rules under `tool_permissions`
    // in their config — only those keys appear here. We intentionally do
    // NOT inject a `*: "ask"` catch-all; that turned the LLM autonomy path
    // into an indefinite block whenever the agent reached for a tool the
    // catch-all lookup happened to land on (todoread, planner, panel, …).
    const cfg = taskConfigSnapshot
    const tp = cfg.tool_permissions ?? {}
    const overrides: Array<{ permission: string; pattern: string; action: "allow" | "ask" | "deny" }> = []
    for (const [key, action] of Object.entries(tp)) {
      if (!action) continue
      overrides.push({ permission: key, pattern: "*", action })
    }
    // metadata.web_search=true is a per-task override from the chat toggle.
    if ((metadata as any)?.web_search === true) {
      overrides.push({ permission: "websearch", pattern: "*", action: "allow" })
    }
    if (overrides.length > 0) {
      await Session.setPermission({ sessionID: session.id, permission: overrides })
    }
    // Decode any base64 attachments exactly once: persist the bytes under the
    // project's .opencorvus/attachments directory, then carry only references
    // (sha/url/mime/size/filename) through the queue and into every agent.
    // The overlay renders attachments directly from task.attachments via the
    // synthetic user-request bubble — no session message needed (was a dupe).
    const attachmentRefs: AttachmentStore.Reference[] = []
    if (decodedAttachments.length) {
      const projectID = Instance.project.id
      for (const { attachment: att, bytes } of decodedAttachments) {
        const ref = await AttachmentStore.write(projectID, bytes, att.mime, att.filename)
        // Default intent: image MIMEs are visual references (SSIM check
        // consumes them). Anything else is generic spec material until a
        // specific evaluator check claims it.
        const intent = att.mime.startsWith("image/") ? "visual_reference" : "spec_artifact"
        attachmentRefs.push({ ...ref, intent, source: "user-upload" })
      }
    }
    // Materialize the intent bundle on disk BEFORE the queue picks the task
    // up, so when the orchestrator / planner / architect wake their stage
    // prompts (which reference the task-scoped intent bundle path) resolve to
    // a real file. Without this, architect-generated goal objectives like
    // "see the intent bundle §3" point at nothing — the
    // executor either misses the reference or hallucinates a body. See
    // `src/intent/bundle.ts` header for the full rationale.
    const { IntentBundle } = await import("@/intent/bundle")
    await IntentBundle.write({
      projectID: Instance.project.id,
      taskID,
      request: input.request,
      attachments: attachmentRefs.length ? attachmentRefs : undefined,
      source: input.source,
      kind: input.kind,
      createdAt: now,
    })

    // Async pipeline: persist task immediately, run stages in background
    try {
      persistQueuedTask({
        taskID,
        sessionID: session.id,
        now,
        executor,
        title,
        request: input.request,
        attachments: attachmentRefs.length ? attachmentRefs : undefined,
        requestID,
        source: input.source,
        priority: input.priority,
        kind: input.kind,
        budget: input.budget,
        metadata,
        channelBinding: input.channelBinding,
        projectID: Instance.project.id,
        queue: input.queue,
      })
    } catch (error) {
      const existing = requestID ? recoverTaskByRequest(requestID, error) : undefined
      if (existing) return existing
      throw error
    }
    recordNote({
      taskID,
      kind: "user_request",
      content: input.request,
      source: input.source ?? "api",
      userID: slackUser(metadata),
    })
    await dispatchTaskLoop({ taskID })
    return taskID
  }

  export async function notifyTaskLineageTerminal(input: {
    taskID: string
    status: "completed" | "failed" | "cancelled"
    summary: string
    error?: string
  }) {
    const task = requireTask(input.taskID)
    const metadata =
      task.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)
        ? (task.metadata as Record<string, unknown>)
        : {}
    const parentTaskID = typeof metadata.parent_task_id === "string" ? metadata.parent_task_id : undefined
    if (parentTaskID && parentTaskID !== task.id) {
      await handleTaskMessage(parentTaskID, {
        text: terminalTaskNotificationText({
          task,
          status: input.status,
          summary: input.summary,
          error: input.error,
          relation: "parent",
        }),
        source: "system:child_task_terminal",
      })
    }

    const mission = missionProvenance(task.metadata)
    if (mission) {
      await SessionWake.wake({
        sessionID: mission.session_id,
        agent: "mission",
        reason: {
          source: "mission.child_task_result",
          missionID: mission.id,
          taskID: task.id,
          taskStatus: input.status,
        },
        prompt: terminalTaskNotificationText({
          task,
          status: input.status,
          summary: input.summary,
          error: input.error,
          relation: "mission",
        }),
      })
    }
  }

  export async function getTask(taskID: string) {
    // Read-only — poll loop handles state advancement asynchronously.
    const task = requireTaskInCurrentProject(taskID)
    const item = listTaskRows([task])[0]
    return viewTask(task, { directory: item?.directory })
  }

  /**
   * Validate that a FileRef points at a real on-disk attachment, then merge
   * it into one of the task's two file-reference columns. The merge strategy
   * (`append-dedup-by-sha` vs `replace-by-intent`) is supplied by the caller
   * — keeping both behind one validator guarantees the on-disk-existence
   * rule stays a single source of truth even as new merge modes are added.
   *
   * Throws on a dangling URL: registered-but-missing files would cause
   * downstream multimodal loading to ENOENT-crash on every retry. Failing
   * at the registration boundary keeps the bad state out of the database.
   */
  async function mergeTaskFileRef(
    taskID: string,
    column: FileRefColumn,
    file: FileRef,
    merge: (prev: FileRef[], canonical: FileRef) => { next: FileRef[]; reason: string } | null,
  ): Promise<FileRef[]> {
    const task = requireTaskInCurrentProject(taskID)
    const located = AttachmentStore.nameFromUrl(file.url)
    if (!located) {
      throw new Error(`${column}: file.url is not a valid /attachment/<projectID>/<name> reference: ${file.url}`)
    }
    if (located.projectID !== task.project_id) {
      throw new Error(
        `${column}: file.url belongs to project ${located.projectID}, expected task project ${task.project_id}: ${file.url}`,
      )
    }
    let reference: AttachmentStore.Reference
    try {
      reference = await AttachmentStore.readReference(located.projectID, located.name)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(
        `${column}: cannot read canonical attachment metadata for project ${located.projectID}/${located.name}: ${message}`,
      )
    }
    const metadataMismatches = [
      file.sha !== reference.sha ? "sha" : "",
      file.mime !== reference.mime ? "mime" : "",
      file.size !== reference.size ? "size" : "",
    ].filter(Boolean)
    if (metadataMismatches.length > 0) {
      throw new Error(
        `${column}: file metadata does not match canonical AttachmentStore metadata (${metadataMismatches.join(", ")}): ${file.url}`,
      )
    }
    const canonical: FileRef = {
      sha: reference.sha,
      url: reference.url,
      mime: reference.mime,
      size: reference.size,
      ...(reference.filename ? { filename: reference.filename } : {}),
      ...(file.intent ? { intent: file.intent } : {}),
      ...(file.source ? { source: file.source } : {}),
    }
    const prev = Array.isArray((task as any)[column]) ? ((task as any)[column] as FileRef[]) : []
    const result = merge(prev, canonical)
    if (!result) return prev
    await updateTask(task, { [column]: result.next } as any, result.reason)
    return result.next
  }

  /**
   * Register a USER-CONTRACT attachment on a task. Use for files the user
   * explicitly attached (user-upload) or for assets the user pointed the
   * orchestrator at via a contract-level URL (figma frames). Read by
   * requirements / frontend-design as user intent and by acceptance for visual
   * comparison.
   *
   * For orchestrator-generated evidence (rendered.png, local material reads)
   * use `appendTaskSystemArtifact` instead — those
   * must not contaminate the user-intent stream.
   *
   * Idempotent on sha collision: same content → no-op.
   */
  export async function appendTaskAttachment(taskID: string, attachment: FileRef) {
    return mergeTaskFileRef(taskID, "attachments", attachment, (prev, canonical) => {
      if (prev.some((a) => a?.sha === canonical.sha)) return null
      return {
        next: [...prev, canonical],
        reason: `attachments appended: ${canonical.filename ?? canonical.sha}`,
      }
    })
  }

  /**
   * Register a SYSTEM-GENERATED artifact on a task. Use for evidence the
   * orchestrator/agents produced on the user's behalf — local material reads
   * and rendered evidence. Read only by acceptance for visual diff against the
   * user contract; never fed to requirements or frontend-design as user
   * intent. Idempotent on sha collision.
   */
  export async function appendTaskSystemArtifact(taskID: string, artifact: FileRef) {
    return mergeTaskFileRef(taskID, "system_artifacts", artifact, (prev, canonical) => {
      if (prev.some((a) => a?.sha === canonical.sha)) return null
      return {
        next: [...prev, canonical],
        reason: `system_artifacts appended: ${canonical.filename ?? canonical.sha}`,
      }
    })
  }

  /**
   * Replace all system artifacts carrying a given `intent` with a single new
   * artifact. Use when each rerun should supersede the previous output for
   * that semantic slot (e.g. acceptance rendered_output: keeping every prior
   * rendered.png would balloon the task and confuse the visual diff).
   */
  export async function replaceTaskSystemArtifactByIntent(
    taskID: string,
    intent: string,
    artifact: FileRef,
  ): Promise<FileRef[]> {
    if (artifact.intent !== intent) {
      throw new Error(
        `replaceTaskSystemArtifactByIntent: intent mismatch — slot=${intent} artifact.intent=${artifact.intent}`,
      )
    }
    return mergeTaskFileRef(taskID, "system_artifacts", artifact, (prev, canonical) => {
      const purged = prev.filter((a) => a?.intent !== intent)
      return {
        next: [...purged, canonical],
        reason: `system_artifacts replaced [intent=${intent}]: ${canonical.filename ?? canonical.sha}`,
      }
    })
  }

  /**
   * Merge a batch of evaluation checks into `engine_task.criteria_results`.
   * Upsert by `name` — the latest write for a given check name wins. Called
   * by the in-process visual-diff check (orchestrator/tools.ts) and by the
   * acceptance-verdict sink that flattens AcceptanceVerdict.deferred_checks +
   * rejection_details into the unified criteria stream. Does not change
   * task.status.
   */
  // upsertTaskCriteria lives in engine/state.ts (the business logic layer);
  // the facade just re-exports it so HTTP route consumers keep working.
  export const upsertTaskCriteria = upsertTaskCriteriaImpl

  export async function getProgress(taskID: string) {
    // Do NOT call syncTask here — it triggers synchronous evaluation inside the GET request,
    // which blocks for minutes and causes request timeouts. The poll loop drives state advancement.
    const task = requireTaskInCurrentProject(taskID)
    const item = listTaskRows([task])[0]
    const plan = findActivePlanForTask(task.id)
    const run = projectedRunForTask(task)
    const acceptance = run ? findAcceptanceByRun(run.id) : undefined
    const evaluation = run ? findEvaluationByRun(run.id) : undefined
    const milestones = plan ? listMilestonesByPlan(plan.id) : listMilestones(taskID)
    return {
      task: viewTask(task, { directory: item?.directory }),
      plan: plan ? viewPlan(plan) : undefined,
      goals: (plan ? listGoalsByPlan(plan.id) : listGoals(taskID)).map((g) => ({
        ...viewGoal(g),
        status: goalStatusByID(g.id),
      })),
      milestones: milestones.length > 0 ? milestones.map(viewMilestone) : undefined,
      run: run ? viewRun(run) : undefined,
      pendingInteractions: listInteractions(taskID)
        .filter((item) => item.status === "pending")
        .map(viewInteraction),
      acceptance: acceptance ? viewAcceptance(acceptance) : undefined,
      evaluation: evaluation ? viewEvaluation(evaluation) : undefined,
      snapshots: listSnapshots(taskID).map(viewSnapshot),
      // activeSessions surfaces pre-plan agent work (requirements / architect /
      // integrity / frontend-design) that goals/run miss. Without this, overlay
      // has nothing to render during the 30s–10min architect phase and the
      // benchmark progress signature stalls until goals materialise.
      activeSessions: listActiveSessionsForTask(taskID),
    }
  }

  export async function listRuns(taskID: string) {
    // Read-only — poll loop handles state advancement asynchronously.
    requireTaskInCurrentProject(taskID)
    return findRuns(taskID).map(viewRun)
  }

  export async function getRun(runID: string) {
    // Read-only — poll loop handles state advancement asynchronously.
    return viewRun(requireRunInCurrentProject(runID))
  }

  export async function getBrief(input: { taskID: string; runID?: string }) {
    // Read-only — poll loop handles state advancement asynchronously.
    const task = requireTaskInCurrentProject(input.taskID)
    const run = input.runID ? requireRunInCurrentProject(input.runID) : undefined
    if (run && run.task_id !== task.id) throw new NotFoundError({ message: `Run not found for task: ${input.runID}` })
    return compileBrief({
      taskID: task.id,
      runID: run?.id ?? findLatestRunForTask(task.id)?.id,
      planVersionID: findActivePlanForTask(task.id)?.id,
      sessionID: task.session_id ?? undefined,
    })
  }

  export async function getBoard(taskID: string, _input?: { sync?: boolean }) {
    // Read-only — poll loop handles state advancement asynchronously.
    requireTaskInCurrentProject(taskID)
    return compileBoard({ taskID })
  }

  export async function getBoardTag(taskID: string, _input?: { sync?: boolean }) {
    // Read-only — poll loop handles state advancement asynchronously.
    requireTaskInCurrentProject(taskID)
    return boardTag({ taskID })
  }

  export async function getProjectBoard(opts?: { limit?: number; query?: string; status?: string }) {
    const project = Project.get(Instance.project.id) ?? Instance.project
    const limit = opts?.limit ?? 50
    const rows =
      opts?.query || opts?.status
        ? searchProjectTasks(Instance.project.id, { query: opts.query, status: opts.status, limit })
        : listProjectTasks(Instance.project.id, limit)
    const tasks = taskItems(listTaskRows(rows))

    return {
      project: {
        id: project.id,
        name: project.name,
        worktree: project.worktree,
      },
      summary: taskSummary(rows),
      tasks,
    }
  }

  export async function getGlobalTaskBoard(opts?: {
    limit?: number
    query?: string
    status?: string
    directory?: string
    cursor?: number
    cursorTaskID?: string
  }) {
    const rows = listGlobalTasks({
      directory: opts?.directory,
      cursor: opts?.cursor,
      cursorTaskID: opts?.cursorTaskID,
      query: opts?.query,
      status: opts?.status,
      limit: opts?.limit ?? 100,
    })
    return {
      summary: taskSummary(rows.map((item) => item.task)),
      tasks: taskItems(rows),
    }
  }

  export async function reorderTaskQueue(input: { directory: string; orderedTaskIDs: string[]; revision?: string }) {
    const result = reorderQueuedTasksForCwd({
      cwd: input.directory,
      projectID: Instance.project.id,
      orderedTaskIDs: input.orderedTaskIDs,
      revision: input.revision,
    })
    await Promise.all(
      result.queuedTaskIDs.map((taskID) =>
        EngineProtocol.emit(
          Event.TaskUpdated,
          {
            taskID,
            status: "queued",
            summary: "Task queue reordered",
          },
          { source: "task.queue.reorder" },
        ),
      ),
    )
    return result
  }

  export async function startQueuedTaskNow(taskID: string) {
    const task = requireTaskInCurrentProject(taskID)
    if (!isTaskQueued(task)) {
      throw new TaskQueueStartError(`Task ${taskID} is not queued`, "not_queued")
    }
    const cwd = taskCwd(taskID)
    if (!cwd) {
      throw new TaskQueueStartError(`Task ${taskID} has no working directory`, "no_directory")
    }

    const before = directoryQueueSnapshot(cwd)
    if (!before.queuedTaskIDs.includes(taskID)) {
      throw new TaskQueueStartError(`Task ${taskID} is not in the directory queue`, "not_queued")
    }
    await startQueuedTaskInCwd(taskID, cwd)

    const updated = requireTaskInCurrentProject(taskID)
    const status = deriveTaskStatus(updated) as string
    const after = directoryQueueSnapshot(cwd)
    return {
      task: viewTask(updated, { directory: cwd }),
      directory: cwd,
      status,
      started: status === "active",
      queuedTaskIDs: after.queuedTaskIDs,
    }
  }

  export async function getAcceptance(runID: string) {
    // Read-only — poll loop handles state advancement asynchronously.
    requireRunInCurrentProject(runID)
    // Prefer task-level acceptance (goal_run_id IS NULL); fall back to any acceptance for this run
    // so that goal-run deliveries (shown in the board) are also previewable.
    const acceptance = findAcceptanceByRun(runID) ?? findLatestAcceptanceForRun(runID)
    if (!acceptance) throw new NotFoundError({ message: `Acceptance not found for run ${runID}` })
    return viewAcceptance(acceptance)
  }

  export async function getAcceptanceDiff(runID: string) {
    requireRunInCurrentProject(runID)
    const acceptance = findAcceptanceByRun(runID) ?? findLatestAcceptanceForRun(runID)
    if (!acceptance) throw new NotFoundError({ message: `Acceptance not found for run ${runID}` })
    return findWorkspaceDiffsForAcceptance(acceptance.id)
  }

  export async function getGoalRunAcceptance(goalRunID: string) {
    // Read-only — goal-level diff previews must resolve against the
    // specific goal_run acceptance instead of the task-level aggregate.
    // Distinguish "goal_run does not exist" (true 404) from "goal_run
    // exists but acceptance has not landed yet" (legitimate in-flight state).
    // Mirrors the convention documented on getSessionTrace below: in-flight
    // resources return 200 with an empty payload, not 404.
    requireGoalRunInCurrentProject(goalRunID)
    const acceptance = findAcceptanceByGoalRun(goalRunID)
    if (!acceptance) return null
    return viewAcceptance(acceptance)
  }

  export async function getGoalRunDiff(goalRunID: string) {
    requireGoalRunInCurrentProject(goalRunID)
    const acceptance = findAcceptanceByGoalRun(goalRunID)
    if (!acceptance) return []
    return findWorkspaceDiffsForAcceptance(acceptance.id)
  }

  /** Surface the per-session AgentTrace event stream so the overlay's debug
   *  panel can render llm_request / agent_report bodies inline next to the
   *  session card. Read-only; reads JSONL straight from disk and parses each
   *  line. Returns `events: []` (200, not 404) when the trace file is absent,
   *  because "agent ran but trace was disabled / pre-trace session" is a
   *  legitimate state the UI distinguishes from "session not found". */
  export async function getSessionTrace(sessionID: string): Promise<{
    ok: true
    events: import("@/trace").AgentTrace.TraceEvent[]
    traceDir: string
    enabled: boolean
  }> {
    const taskID = await requireSessionTraceTaskInCurrentProject(sessionID)
    const { AgentTrace } = await import("@/trace")
    return {
      ok: true,
      events: AgentTrace.readSessionEvents(sessionID, taskID),
      traceDir: AgentTrace.getTaskTraceDir(taskID),
      enabled: AgentTrace.isEnabled(),
    }
  }

  /** Aggregate all sessions belonging to a task into one chronological event
   *  stream. Task trace reads the `_task-<id>.jsonl` rollup directly; the
   *  writer appends every task-tagged llm_request and terminal report there.
   *
   *  Also surfaces the resolved trace directory + the enabled flag so the
   *  overlay's empty state can call out path-mismatch and disabled-tracing
   *  failure modes by name (the two failure modes that look identical from
   *  the client's perspective: events:[]). Without this, an operator running
   *  overlay against project root while the agents wrote traces under a
   *  benchmark temp dir gets a "no trace yet" message that hides the real
   *  problem (different Instance.directory). */
  export async function getTaskTrace(taskID: string): Promise<{
    ok: true
    events: import("@/trace").AgentTrace.TraceEvent[]
    traceDir: string
    enabled: boolean
  }> {
    requireTaskInCurrentProject(taskID)
    const { AgentTrace } = await import("@/trace")
    return {
      ok: true,
      events: AgentTrace.readTaskEvents(taskID),
      traceDir: AgentTrace.getTaskTraceDir(taskID),
      enabled: AgentTrace.isEnabled(),
    }
  }

  export async function listArtifacts(runID: string) {
    // Read-only — poll loop handles state advancement asynchronously.
    requireRunInCurrentProject(runID)
    return findArtifacts(runID).map(viewArtifact)
  }

  export async function listEvaluations(runID: string) {
    // Read-only — poll loop handles state advancement asynchronously.
    requireRunInCurrentProject(runID)
    return findEvaluations(runID).map(viewEvaluation)
  }

  export async function listProtocolEvents(taskID: string) {
    // Read-only — protocol_event is the persisted task event source.
    requireTaskInCurrentProject(taskID)
    return ProtocolStore.listTaskEvents(taskID)
  }

  export async function listTaskInteractions(taskID: string) {
    // Read-only — poll loop handles state advancement asynchronously.
    requireTaskInCurrentProject(taskID)
    return listInteractions(taskID).map(viewInteraction)
  }

  export async function selectTaskChecks(taskID: string, selection: Record<string, boolean>) {
    const task = requireTaskInCurrentProject(taskID)
    const next = mergeTaskChecks(task.metadata?.checks, selection)
    return writeTaskChecks(task, next)
  }

  export async function updateTaskChecks(taskID: string, raw: z.input<typeof UpdateTaskChecksInput>) {
    const { checks, selection } = UpdateTaskChecksInput.parse(raw)
    if (selection && Object.keys(selection).length > 0) {
      return selectTaskChecks(taskID, selection)
    }
    return writeTaskChecks(requireTaskInCurrentProject(taskID), checks)
  }

  export async function updateGoal(goalID: string, input: z.input<typeof UpdateGoalInput>) {
    const body = UpdateGoalInput.parse(input)
    requireGoalInCurrentProject(goalID)
    updateGoalRow({
      goalID,
      title: body.description,
      acceptance_specs: body.acceptance_specs,
    })
    return true
  }

  export async function deleteGoal(goalID: string) {
    requireGoalInCurrentProject(goalID)
    deleteGoalRow(goalID)
    return true
  }

  export async function deleteTask(taskID: string, options?: DeleteTaskOptions) {
    let task = requireTaskInCurrentProject(taskID)
    discardQueuedTaskEvent(taskID)
    // Cancel if still active
    if (!isTaskTerminal(task)) {
      await cancelTask(taskID, options)
      task = requireTaskInCurrentProject(taskID)
    }
    // Wait for any in-progress pipeline stage to settle after abort
    await awaitPipelineSettled(taskID)
    await awaitTaskLoopIdleForDelete(taskID, options?.taskLoopIdleTimeoutMs ?? CANCEL_CLEANUP_TIMEOUT_MS)
    await settleTaskSessionWorkBeforePhysicalDelete(task, options)
    await recordTaskPhysicalDeleteBreadcrumb(task, "EngineService.deleteTask")
    // Delete session tree (CASCADE handles plans, goals, runs, etc.)
    if (task.session_id) {
      await Session.removeInProject({ sessionID: task.session_id, projectID: task.project_id })
    }
    // Delete the task row itself (CASCADE handles plans, goals, runs, artifacts, etc.)
    // Snapshot disk reclaim is intentionally NOT triggered here: every tree
    // object emitted by this task's `Snapshot.track()` is dangling (no ref),
    // so `git gc --prune=now` would also collect snapshots that other live
    // tasks/sessions in the same project still reference. Whole-project
    // reclaim is owned by ProjectGC (rm of `snapshot/<id>`).
    Database.use((db) => {
      db.delete(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).run()
      Database.effect(() => Database.incrementalVacuum())
    })
    return true
  }

  export async function updateTaskBudget(taskID: string, budget: z.input<typeof Budget> | null) {
    const task = requireTaskInCurrentProject(taskID)
    const parsed = budget ? budgetRow(budget) : null
    Database.use((db) => db.update(EngineTaskTable).set({ budget: parsed }).where(eq(EngineTaskTable.id, taskID)).run())
    await Bus.publish(Event.TaskUpdated, {
      taskID,
      status: deriveTaskStatus(task),
      summary: "Task budget updated",
    })
    return true
  }

  export async function updateTaskTitle(taskID: string, title: string) {
    const task = requireTaskInCurrentProject(taskID)
    Database.use((db) => db.update(EngineTaskTable).set({ title }).where(eq(EngineTaskTable.id, taskID)).run())
    await Bus.publish(Event.TaskUpdated, {
      taskID,
      status: deriveTaskStatus(task),
      summary: "Task title updated",
    })
    return true
  }
}

function recoverTaskByRequest(requestID: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (!message.includes("UNIQUE constraint failed")) return
  if (!message.includes("engine_task.project_id, engine_task.request_id")) return
  return findTaskByRequest(Instance.project.id, requestID)?.id
}

function existingTaskByChannelBinding(
  binding:
    | {
        platform: string
        channel: string
        thread: string
      }
    | undefined,
) {
  if (!binding) return
  const row = Database.use((db) =>
    db
      .select({ task_id: EngineChannelBindingTable.task_id, project_id: EngineTaskTable.project_id })
      .from(EngineChannelBindingTable)
      .innerJoin(EngineTaskTable, eq(EngineTaskTable.id, EngineChannelBindingTable.task_id))
      .where(
        and(
          eq(EngineChannelBindingTable.platform, binding.platform),
          eq(EngineChannelBindingTable.channel, binding.channel),
          eq(EngineChannelBindingTable.thread, binding.thread),
        ),
      )
      .get(),
  )
  if (!row) return
  if (row.project_id === "global") {
    throw new TaskGlobalProjectBindingError({
      message: `Channel binding ${binding.platform}/${binding.channel}/${binding.thread} points to task ${row.task_id} bound to project global. Task workflow state requires a concrete Git project.`,
      taskID: row.task_id,
      projectID: row.project_id,
    })
  }
  if (row.project_id !== Instance.project.id) {
    throw new TaskChannelBindingProjectConflictError({
      message: `Channel binding ${binding.platform}/${binding.channel}/${binding.thread} points to task ${row.task_id} in project ${row.project_id}, but the active project is ${Instance.project.id}.`,
      platform: binding.platform,
      channel: binding.channel,
      thread: binding.thread,
      taskID: row.task_id,
      projectID: row.project_id,
      activeProjectID: Instance.project.id,
    })
  }
  return row.task_id
}

export namespace EngineService {
  export async function replyAgentSession(
    taskID: string,
    sessionID: string,
    input: {
      message: string
      attachments?: Array<{ mime: string; url: string; filename?: string }>
    },
  ) {
    return await appendDirectAgentSessionReply({
      taskID,
      sessionID,
      message: input.message,
      attachments: input.attachments,
    })
  }

  export async function operatorSteerAgentSession(
    taskID: string,
    sessionID: string,
    raw: z.input<typeof AgentSessionOperatorSteerInput>,
    dispatch: OperatorSteerDispatch = dispatchTaskLoop,
  ) {
    const input = AgentSessionOperatorSteerInput.parse(raw)
    const task = requireTaskInCurrentProject(taskID)
    const target = await resolveOperatorSteerTarget({ task, sessionID })
    let request: Awaited<ReturnType<typeof createOperatorSteerCoordinationRequest>>
    try {
      request = await createOperatorSteerCoordinationRequest({
        taskID: task.id,
        sessionID: target.session.id,
        agent: target.agent,
        operatorMessage: input.message,
        goalID: target.goalID,
        goalRunID: target.goalRunID,
      })
    } catch (error) {
      if (error instanceof AgentCoordinationPendingConflictError) {
        throw new AgentSessionPendingCoordinationError({
          message:
            `operatorSteerAgentSession: session ${target.session.id} has pending coordination request(s) ` +
            `${error.requestIDs.join(", ")}. Answer the existing request through respond_agent_coordination before adding new operator steer.`,
          taskID: task.id,
          sessionID: target.session.id,
          requestIDs: error.requestIDs,
        })
      }
      throw error
    }

    let dispatchResult: Awaited<ReturnType<OperatorSteerDispatch>>
    try {
      dispatchResult = await dispatch({
        taskID: task.id,
        event: {
          coordinationRequest: { requestID: request.payload.request_id },
        },
      })
    } catch (error) {
      await cancelPendingAgentCoordinationRequest({
        taskID: task.id,
        requestID: request.payload.request_id,
        reason: `operator steer wake failed: ${error instanceof Error ? error.message : String(error)}`,
      })
      discardPendingQueuedOperatorWakeForRequest({ taskID: task.id, requestID: request.payload.request_id })
      throw error
    }
    if (dispatchResult === "ignored") {
      await cancelPendingAgentCoordinationRequest({
        taskID: task.id,
        requestID: request.payload.request_id,
        reason: "operator steer wake ignored",
      })
      discardPendingQueuedOperatorWakeForRequest({ taskID: task.id, requestID: request.payload.request_id })
      throw new OperatorSteerWakeError({
        message: `operatorSteerAgentSession: request ${request.payload.request_id} was recorded but orchestrator wake was ignored.`,
        taskID: task.id,
        sessionID: target.session.id,
        requestID: request.payload.request_id,
        reason: "ignored",
      })
    }

    return {
      task_id: task.id,
      session_id: target.session.id,
      request_id: request.payload.request_id,
      wake_status: dispatchResult,
    }
  }

  export async function replyInteraction(interactionID: string, raw: z.input<typeof ReplyInteractionInput>) {
    const input = ReplyInteractionInput.parse(raw)
    const row = requireInteractionInCurrentProject(interactionID)
    if (row.payload?.protocol_request === true) {
      await resolveProtocolInteraction(row, input)
      await EngineRuntime.syncTask(row.task_id, hooks())
      return viewInteraction(requireInteractionInCurrentProject(interactionID))
    }
    if (row.request_type === "permission") {
      await PermissionNext.reply({
        requestID: row.external_id,
        reply: input.reply ?? "once",
        autoReply: input.autoReply,
        message: input.message,
      })
    }
    if (row.request_type === "question") {
      const answers = input.answers ?? answersFromMessage(input.message)
      if (!answers) throw new Error("answers or message are required for question replies")
      await Question.reply({
        requestID: row.external_id,
        answers,
      })
    }
    await EngineRuntime.syncTask(row.task_id, hooks())
    return viewInteraction(requireInteractionInCurrentProject(interactionID))
  }

  export async function rejectInteraction(interactionID: string, raw: z.input<typeof RejectInteractionInput>) {
    const input = RejectInteractionInput.parse(raw)
    const row = requireInteractionInCurrentProject(interactionID)
    if (row.payload?.protocol_request === true) {
      await rejectProtocolInteraction(row, input.message)
      await EngineRuntime.syncTask(row.task_id, hooks())
      return viewInteraction(requireInteractionInCurrentProject(interactionID))
    }
    if (row.request_type === "permission") {
      await PermissionNext.reply({
        requestID: row.external_id,
        reply: "reject",
        autoReply: input.autoReply,
        message: input.message,
      })
    }
    if (row.request_type === "question") {
      await Question.reject(row.external_id)
    }
    await EngineRuntime.syncTask(row.task_id, hooks())
    return viewInteraction(requireInteractionInCurrentProject(interactionID))
  }

  export async function cancelTask(taskID: string, options?: CancelTaskOptions) {
    const task = requireTaskInCurrentProject(taskID)
    discardQueuedTaskEvent(taskID)
    const taskDirectory = taskCwd(taskID)
    const decisions = createDecisionLog(taskID)
    const abortTimeoutMs = options?.abortTimeoutMs ?? CANCEL_ABORT_TIMEOUT_MS
    const cleanupTimeoutMs = options?.cleanupTimeoutMs ?? CANCEL_CLEANUP_TIMEOUT_MS

    // Helper: log + decision_log breadcrumb when an abort cannot be proven.
    // Cancellation success must mean the owned handle stopped; otherwise the
    // route returns a typed conflict instead of stamping a false terminal task.
    const onAbortFailure = (label: string, err: unknown, refs: Record<string, unknown>): never => {
      if (err instanceof AwaitTimeoutError) {
        log.warn(`${label} timed out during cancelTask`, { taskID, ...refs, ms: err.ms })
        decisions.append({
          phase: "cancel",
          key: "abort_timeout",
          value: JSON.stringify({ label, ms: err.ms, ...refs }),
          reason:
            "executor.abort or cleanup did not respond within deadline; cancellation is incomplete and task status was not marked cancelled.",
        })
      } else {
        log.warn(`${label} failed during cancelTask`, {
          taskID,
          ...refs,
          error: err instanceof Error ? err.message : String(err),
        })
        decisions.append({
          phase: "cancel",
          key: "abort_failed",
          value: JSON.stringify({ label, ...refs, error: err instanceof Error ? err.message : String(err) }),
          reason:
            "executor.abort or cleanup failed; cancellation is incomplete and task status was not marked cancelled.",
        })
      }
      throw createTaskCancellationIncomplete({ taskID, handle: label, cause: err })
    }

    // Abort Orchestrator and any in-progress pipeline stage
    Orchestrator.abort(taskID)
    abortTaskPipeline(taskID)
    const lifecycle = await requestTaskAgentLifecycleCancellation({
      task,
      reason: "task cancelled",
      handle: "task-api.cancel-task",
    })
    const queueCancelledInCurrentInstance = Boolean(Instance.current())
    const queuedPromptCancellations = TaskQueueService.cancelSessionPrompts({
      sessionIDs: lifecycle.sessionIDs,
      reason: "task cancelled",
    })
    if (!queueCancelledInCurrentInstance) {
      await provideActiveTaskRootSessionInstance(task, async () => {
        TaskQueueService.cancelSessionPrompts({
          sessionIDs: lifecycle.sessionIDs,
          reason: "task cancelled",
        })
      })
    }
    const liveOwnerships = lifecycle.ownerships
    if (liveOwnerships.length > 0) {
      const { abortLiveOrchestratorToolOwnership } = await import("@/engine/writer")
      await withTimeout(
        provideTaskRootSessionInstance(task, () =>
          abortLiveOrchestratorToolOwnership({
            taskID,
            reason: "task cancelled",
            ownerships: liveOwnerships,
            originSite: "task-api.cancel-task",
            promptDirectory: Project.get(task.project_id)?.worktree,
          }),
        ),
        cleanupTimeoutMs,
        "abortLiveOrchestratorToolOwnership",
      ).catch((err) => onAbortFailure("abortLiveOrchestratorToolOwnership", err, {}))
    }
    const liveGoalRuns = listGoalRunsForTask(taskID).filter((row) => isLiveGoalRunStatus(row.status))
    await Promise.all(
      liveGoalRuns.map(async (row) => {
        await abortGoalRunExecution({
          taskID,
          goalRunID: row.id,
          reason: "task cancelled",
          abortTimeoutMs,
        }).catch((err) =>
          onAbortFailure("abortGoalRunExecution", err, { goalRunID: row.id, runID: row.coordinator_run_id }),
        )
      }),
    )
    const { abortLiveExecutionForTask } = await import("@/engine/writer")
    await withTimeout(
      abortLiveExecutionForTask({
        taskID,
        reason: "task cancelled",
        cleanupGoalWorkspaces: false,
        includeRuns: false,
      }),
      cleanupTimeoutMs,
      "abortLiveExecutionForTask",
    ).catch((err) => onAbortFailure("abortLiveExecutionForTask", err, {}))
    const run = findActiveRunForTask(task.id)
    if (run) {
      const succeeded = await withTimeout(
        ExecutorRegistry.require(run.executor).abort({
          sessionID: run.session_id ?? undefined,
          queueTaskID: run.executor_ref?.queue_task_id,
        }),
        abortTimeoutMs,
        "executor.abort run",
      ).catch((err) => onAbortFailure("executor.abort run", err, { runID: run.id }))
      if (!succeeded) {
        onAbortFailure("executor.abort run", new Error("executor.abort returned false"), { runID: run.id })
      }
    }
    if (run) {
      await updateRun(
        run,
        {
          status: "aborted",
          error: "task cancelled",
          blocking_reason: null,
          time_completed: Date.now(),
        },
        "Run aborted",
      )
    }
    await provideActiveTaskRootSessionInstance(task, () =>
      awaitTaskQueuePromptsIdle({
        sessionIDs: lifecycle.sessionIDs,
        timeoutMs: cleanupTimeoutMs,
        taskID,
        handle: "TaskQueueService.awaitSessionPromptsIdle",
      }),
    )
    await assertSessionPromptSubtreeFinished({
      sessions: lifecycle.cancelledSessions,
      failures: lifecycle.cancellationFailures,
      taskID,
      inactivityTimeoutMs: options?.promptSettleInactivityMs,
    })
    const secondPassCoordinationRequestsCancelled = await cancelPendingAgentCoordinationRequestsForTask({
      taskID,
      reason: "task cancelled",
    })
    decisions.append({
      phase: "cancel",
      key: "agent_lifecycle_report",
      value: JSON.stringify({
        taskID,
        sessionIDs: lifecycle.sessionIDs,
        promptCancellations: lifecycle.cancelledSessions.map((session) => session.id),
        queuedPromptCancellations,
        ownerships: lifecycle.ownerships.map((ownership) => ownership.ownershipID),
        goalRunIDs: lifecycle.goalRunIDs,
        runIDs: lifecycle.runIDs,
        pendingCoordinationRequestsCancelled:
          lifecycle.pendingCoordinationRequestsCancelled + secondPassCoordinationRequestsCancelled,
        cancellationFailures: lifecycle.cancellationFailures.map((error) =>
          error instanceof Error ? error.message : String(error),
        ),
      }),
      reason:
        "Task cancellation collected and cancelled every task-owned agent lifecycle handle before terminal status.",
    })
    await terminalTask(
      task,
      {
        status: "cancelled",
        error: "task cancelled",
        time_completed: Date.now(),
      },
      "Task cancelled",
      { projectDir: taskDirectory },
    )
    // Clean up channel bindings so the thread is not reused
    Database.use((db) =>
      db.delete(EngineChannelBindingTable).where(eq(EngineChannelBindingTable.task_id, taskID)).run(),
    )
    return true
  }

  export async function deleteSession(sessionID: string, input?: { deleteTasks?: boolean; projectID?: string }) {
    const current = Instance.current()
    const root = input?.projectID
      ? await Session.getInProject({ sessionID, projectID: input.projectID })
      : current
        ? await Session.getInProject({ sessionID, projectID: current.project.id })
        : await Session.get(sessionID)
    const requested = await requestSessionPromptSubtreeCancellation({
      sessionID,
      projectID: root.projectID,
      handle: "EngineService.deleteSession",
    })
    const ids = requested.sessionIDs
    const queueCancelledInCurrentInstance = Boolean(Instance.current())
    TaskQueueService.cancelSessionPrompts({
      sessionIDs: ids,
      reason: "session deleted",
    })
    if (queueCancelledInCurrentInstance) {
      await awaitTaskQueuePromptsIdle({
        sessionIDs: ids,
        timeoutMs: CANCEL_CLEANUP_TIMEOUT_MS,
        handle: "EngineService.deleteSession.TaskQueueService.awaitSessionPromptsIdle",
      })
    } else {
      await Instance.tryProvideActive({
        directory: root.directory,
        fn: async () => {
          TaskQueueService.cancelSessionPrompts({
            sessionIDs: ids,
            reason: "session deleted",
          })
          await awaitTaskQueuePromptsIdle({
            sessionIDs: ids,
            timeoutMs: CANCEL_CLEANUP_TIMEOUT_MS,
            handle: "EngineService.deleteSession.TaskQueueService.awaitSessionPromptsIdle",
          })
        },
      })
    }
    await assertSessionPromptSubtreeFinished({
      sessions: requested.cancelledSessions,
      failures: requested.failures,
      handle: "EngineService.deleteSession",
    })
    if (input?.deleteTasks) {
      const tasks = Database.use((db) =>
        db
          .select()
          .from(EngineTaskTable)
          .where(and(eq(EngineTaskTable.project_id, root.projectID), inArray(EngineTaskTable.session_id, ids)))
          .all(),
      )
      const tasksForDelete: TaskRow[] = []
      for (const item of tasks) {
        if (isTaskTerminal(item)) {
          tasksForDelete.push(item)
          continue
        }
        await cancelTask(item.id)
        tasksForDelete.push(requireTaskInCurrentProject(item.id))
      }
      for (const item of tasksForDelete) {
        await awaitPipelineSettled(item.id)
        await awaitTaskLoopIdleForDelete(item.id, CANCEL_CLEANUP_TIMEOUT_MS)
      }
      for (const item of tasksForDelete) {
        await recordTaskPhysicalDeleteBreadcrumb(item, "EngineService.deleteSession.deleteTasks", {
          rootSessionID: sessionID,
          sessionIDs: ids,
        })
      }
      Database.use((db) => {
        db.delete(EngineTaskTable)
          .where(and(eq(EngineTaskTable.project_id, root.projectID), inArray(EngineTaskTable.session_id, ids)))
          .run()
        Database.effect(() => Database.incrementalVacuum())
      })
    }
    await Session.removeInProject({ sessionID, projectID: root.projectID })
    return true
  }

  async function wakeTaskForOperatorIntent(taskID: string, intent: "retry" | "replan") {
    const task = requireTaskInCurrentProject(taskID)
    const metadata =
      task.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)
        ? { ...(task.metadata as Record<string, unknown>) }
        : {}
    delete metadata.cancelled
    delete metadata.interrupted
    const liveRun = findActiveRunForTask(task.id)
    const label = intent === "retry" ? "Retry" : "Replan"
    if (intent === "replan") {
      const now = Date.now()
      Database.transaction((db) => {
        supersedePriorActivePlansForTask(db, { taskID: task.id, now })
      })
    }
    const openedTask =
      isTaskTerminal(task) || !liveRun
        ? await updateTask(task, { status: "queued", error: null, metadata }, `${label} requested by operator`)
        : await updateTask(task, { error: null, metadata }, `${label} requested by operator`)
    if (intent === "retry") {
      await reopenActiveRunForOperatorWake(openedTask, `${label} reopened blocked run`)
    }
    const note = intent === "retry" ? OrchestratorEventNote.retry(task) : OrchestratorEventNote.replan(task)
    dispatchTaskLoopInBackground(
      { taskID, event: { note, operatorIntent: { kind: intent } } },
      "task-api.wakeTaskForOperatorIntent",
    )
    return viewTask(requireTaskInCurrentProject(taskID))
  }

  export async function retryTask(taskID: string) {
    return wakeTaskForOperatorIntent(taskID, "retry")
  }

  export async function replanTask(taskID: string) {
    return wakeTaskForOperatorIntent(taskID, "replan")
  }

  export async function recordOperatorNote(taskID: string, note: string) {
    const task = requireTaskInCurrentProject(taskID)
    const run = findActiveRunForTask(task.id)
    const now = Date.now()
    Database.use((db) =>
      db
        .insert(EngineProgressSnapshotTable)
        .values({
          id: Identifier.ascending("progress"),
          task_id: task.id,
          status: progressStatus(deriveTaskStatus(task)),
          summary: "Operator note recorded",
          payload: {
            note,
            activeRunID: run?.id,
          },
          time_created: now,
          time_updated: now,
        })
        .run(),
    )
    const wakeTask = await openTaskForOperatorWake(task, "Operator note reopened task")
    await reopenActiveRunForOperatorWake(wakeTask, "Operator note reopened blocked run")
    dispatchTaskLoopInBackground(
      { taskID: wakeTask.id, event: { note: OrchestratorEventNote.retry(task) } },
      "task-api.recordOperatorNote",
    )
    return { resumed: true, status: deriveTaskStatus(requireTaskInCurrentProject(taskID)) as string }
  }

  export async function handleTaskMessage(taskID: string, raw: z.input<typeof TaskMessageInput>) {
    const input = TaskMessageInput.parse(raw)
    const task = requireTaskInCurrentProject(taskID)
    assertTaskOperatorMessageAccepted(task, input.text, input.attachments ?? [])
    const decodedAttachments = decodeApiAttachments({
      attachments: input.attachments,
      label: `Task ${taskID} operator attachment`,
    })
    if (input.promptProfile) {
      if (!task.session_id) {
        throw new Error(`Task ${task.id} has no root session; cannot apply prompt profile ${input.promptProfile}.`)
      }
      await PromptProfileResolver.assertKnownProfileID({
        projectDirectory: await EffectiveConfig.directory({ sessionID: task.session_id }),
        profileID: input.promptProfile,
      })
      await Session.mergeConfigOverlay({
        sessionID: task.session_id,
        patch: { prompt_profile: { active: input.promptProfile } },
      })
    }

    // Decode base64 attachments once, write bytes to AttachmentStore, and carry
    // references downstream. Mirrors createTask so that follow-up messages and
    // new-task messages share the same persistence shape. Each ref is also
    // appended to `task.attachments` so subsequent build / architect / design
    // dispatches (which read task.attachments, not session history) can see
    // the new visual reference. Without this, follow-up images persist in
    // session history but never reach the build agent — the orchestrator wakes
    // with task.attachments still equal to the create-time snapshot, build
    // agent's `input.task.attachments` is therefore stale, and a user dropping
    // a screenshot into a follow-up message gets fidelity 0 even though the
    // bytes were saved.
    const attachmentRefs: AttachmentStore.Reference[] = []
    if (decodedAttachments.length) {
      const projectID = Instance.project.id
      for (const { attachment: att, bytes } of decodedAttachments) {
        const ref = await AttachmentStore.write(projectID, bytes, att.mime, att.filename)
        const intent = att.mime.startsWith("image/") ? "visual_reference" : "spec_artifact"
        const annotated = { ...ref, intent, source: "user-upload" }
        attachmentRefs.push(annotated)
        await appendTaskAttachment(taskID, annotated)
      }
    }

    // Natural-language user messages are recorded once as visible task-root
    // user messages. Workbench notes are a separate note/constraint surface;
    // duplicating this text there would create a target-less second source.
    const note = await continueTaskMessage(taskID, input.text, input.source, attachmentRefs)
    const message =
      note.wakeStatus === "started"
        ? "Operator note recorded. Task wake dispatched."
        : note.wakeStatus === "queued"
          ? "Operator note recorded. Task wake queued behind active agent ownership."
          : "Operator note recorded."
    return {
      kind: "note" as const,
      message,
      wake_status: note.wakeStatus,
      should_resume: note.resumed,
      user_message: note.user_message,
    }
  }

  export async function getTaskOperatorModelContext(taskID: string) {
    const task = requireTaskInCurrentProject(taskID)
    if (!task.session_id) {
      throw new Error(
        `Task ${task.id} has no root session — cannot resolve operator model context; recreate the task or repair task.session_id`,
      )
    }
    const ctx = await messageContext(task.session_id, task.id)
    if (!ctx) {
      throw new Error(
        `Task ${task.id} session ${task.session_id} has no agent/model context — cannot resolve operator model context`,
      )
    }
    return {
      taskID: task.id,
      sessionID: task.session_id,
      agent: ctx.agent,
      model: ctx.model,
    }
  }

  /**
   * 向 task 注入用户消息。
   *
   * Task-level input has a single owner: the orchestrator wake path. The active
   * run's session_id is the task root session in workflow mode, so resuming an
   * executor from here writes agent output into root and breaks conversation
   * projection. Targeted operator steer must use
   * /task/:id/session/:sessionID/operator-steer.
   */
  export async function injectMessage(taskID: string, message: string) {
    const wake = await appendAndWakeTaskOperatorMessage({ taskID, text: message, source: "api_inject" })
    return {
      appended: true,
      orchestratorWoken: wake.resumed,
      executorResumed: false,
      status: deriveTaskStatus(requireTaskInCurrentProject(taskID)) as string,
    }
  }

  /**
   * 基于任务结束时的状态推断用户最可能想让 AI 继续做的下一步，返回单条
   * 可直接填入输入框的简短中文建议。仅面向 overlay 输入框体验，不修改
   * 任何任务状态。LLM 失败会抛出错误，调用方自行处理（禁止 fallback）。
   */
  export async function generateFollowup(taskID: string): Promise<{ suggestion: string }> {
    const task = requireTaskInCurrentProject(taskID)
    const sessionID = task.session_id ?? undefined
    const model = await resolveAgentModel("summary", { sessionID })
    const config = await EffectiveConfig.effective(sessionID ? { sessionID } : undefined)
    const language = ProviderLLM.wrapModel(await Provider.getLanguage(model, { config }), model, {})

    const messages = sessionID ? await Session.messages({ sessionID, limit: 6 }) : []
    const transcript = messages
      .flatMap((msg) => {
        const role = msg.info.role
        return msg.parts
          .filter((p: any) => p.type === "text" && typeof p.text === "string")
          .map((p: any) => String(p.text).trim())
          .filter((text: string) => text.length > 0)
          .map((text: string) => `${role}: ${text.slice(0, 600)}`)
      })
      .slice(-6)

    const run = projectedRunForTask(task)
    const context = [
      `title: ${task.title}`,
      `request: ${(task.request ?? "").slice(0, 400)}`,
      `status: ${deriveTaskStatus(task)}`,
      task.error ? `error: ${String(task.error).slice(0, 240)}` : "",
      run?.blocking_reason ? `blocking: ${run.blocking_reason}` : "",
      transcript.length > 0 ? `transcript:\n${transcript.join("\n")}` : "",
    ]
      .filter((part) => part.length > 0)
      .join("\n")

    const followupMessages = [
      {
        role: "system" as const,
        content:
          "你是协作中的助手。基于任务刚刚结束时的状态，推断用户最可能想让 AI 做的下一步，给出一条第一人称口吻的简短中文指令，直接作为用户发给 AI 的消息。要求：不超过 30 字；不使用引号；不解释；当任务明显已无后续时返回空字符串。以 JSON 对象返回，字段名 suggestion。",
      },
      { role: "user" as const, content: context },
    ]
    const stream = streamText({
      model: language,
      temperature: model.providerID.startsWith("moonshotai") ? 1 : 0,
      messages: followupMessages,
      output: Output.object({ schema: ProviderSchema.output(model, z.object({ suggestion: z.string() })) }),
    })

    try {
      for await (const part of stream.fullStream) {
        if (part.type === "error") throw part.error
      }
      const final = await stream.output
      const suggestion = (final?.suggestion ?? "").trim()
      const { AgentTrace } = await import("@/trace")
      if (AgentTrace.isEnabled()) {
        AgentTrace.recordHelperLLMCall({
          agentName: "task-followup",
          model: { providerID: model.providerID, modelID: model.id },
          messages: followupMessages,
          schema: { suggestion: "string" },
          output: final,
        })
      }
      return { suggestion }
    } catch (err) {
      const { AgentTrace } = await import("@/trace")
      if (AgentTrace.isEnabled()) {
        AgentTrace.recordHelperLLMCall({
          agentName: "task-followup",
          model: { providerID: model.providerID, modelID: model.id },
          messages: followupMessages,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      throw err
    }
  }

  export async function abortRun(runID: string, options?: { abortTimeoutMs?: number }) {
    const run = requireRunInCurrentProject(runID)
    const abortTimeoutMs = options?.abortTimeoutMs ?? CANCEL_ABORT_TIMEOUT_MS
    const decisions = createDecisionLog(run.task_id)
    const abortFailure = (err: unknown): never => {
      if (err instanceof AwaitTimeoutError) {
        log.warn("executor.abort timed out during abortRun", { runID, ms: err.ms })
        decisions.append({
          phase: "cancel",
          key: "abort_timeout",
          value: JSON.stringify({ label: "executor.abort run", ms: err.ms, runID }),
          reason:
            "abortRun's executor.abort exceeded deadline; cancellation is incomplete and run status was not marked aborted.",
        })
      } else {
        log.warn("executor.abort failed during abortRun", {
          runID,
          error: err instanceof Error ? err.message : String(err),
        })
        decisions.append({
          phase: "cancel",
          key: "abort_failed",
          value: JSON.stringify({
            label: "executor.abort run",
            runID,
            error: err instanceof Error ? err.message : String(err),
          }),
          reason: "abortRun's executor.abort failed; cancellation is incomplete and run status was not marked aborted.",
        })
      }
      throw createTaskCancellationIncomplete({ taskID: run.task_id, runID, handle: "executor.abort run", cause: err })
    }
    const taskBeforeAbort = requireTaskInCurrentProject(run.task_id)
    const wasActiveRun = findActiveRunForTask(taskBeforeAbort.id)?.id === run.id
    const succeeded = await withTimeout(
      ExecutorRegistry.require(run.executor).abort({
        sessionID: run.session_id ?? undefined,
        queueTaskID: run.executor_ref?.queue_task_id,
      }),
      abortTimeoutMs,
      "executor.abort run",
    ).catch(abortFailure)
    if (!succeeded) abortFailure(new Error("executor.abort returned false"))
    await updateRun(
      run,
      {
        status: "aborted",
        error: "run aborted",
        blocking_reason: null,
        time_completed: Date.now(),
      },
      "Run aborted",
    )
    const task = requireTaskInCurrentProject(run.task_id)
    if (wasActiveRun) {
      await updateTask(task, { error: "run aborted" }, "Run aborted; scheduler decision required")
    }
    return true
  }
}

export { ExecutorNotConfiguredError }

function slackUser(metadata: Record<string, unknown>) {
  const channel = metadata.channel
  if (channel && typeof channel === "object") {
    const user = (channel as Record<string, unknown>).user_id
    if (typeof user === "string" && user) return user
  }
  const slack = metadata.slack
  if (!slack || typeof slack !== "object") return undefined
  const user = (slack as Record<string, unknown>).user
  if (typeof user !== "string" || !user) return undefined
  return user
}

function answersFromMessage(message?: string) {
  const text = message?.trim()
  if (!text) return
  return [[text]]
}

async function resolveProtocolInteraction(row: InteractionRow, input: z.infer<typeof ReplyInteractionInput>) {
  if (!row.run_id) throw new Error(`protocol interaction ${row.id} has no run`)
  const run = requireRun(row.run_id)
  const executor = ExecutorRegistry.require(run.executor)
  if (!executor.resolve) throw new Error(`executor ${run.executor} does not support interaction resolution`)
  const payload = row.payload ?? {}
  const requestID = typeof payload.request_id === "string" ? payload.request_id : row.external_id
  const now = Date.now()

  if (row.request_type === "permission") {
    await executor.resolve({
      sessionID: run.session_id ?? undefined,
      queueTaskID: run.executor_ref?.queue_task_id,
      requestID,
      kind: "approval",
      response: {
        decision: input.reply === "always" ? "acceptForSession" : "accept",
      },
    })
    markProtocolInteraction(
      row,
      "answered",
      {
        reply: input.reply ?? "once",
        message: input.message,
      },
      now,
    )
    return
  }

  const questions = Array.isArray(payload.questions)
    ? payload.questions.flatMap((item) => {
        if (!item || typeof item !== "object") return []
        const next = item as Record<string, unknown>
        if (typeof next.id !== "string" || !next.id) return []
        return [next.id]
      })
    : []
  const answers = input.answers ?? answersFromMessage(input.message)
  if (!answers) throw new Error("answers or message are required for protocol input replies")
  const response = Object.fromEntries(
    questions.map((id, index) => [id, { answers: answers[index] ?? answers[0] ?? [] }]),
  )
  await executor.resolve({
    sessionID: run.session_id ?? undefined,
    queueTaskID: run.executor_ref?.queue_task_id,
    requestID,
    kind: "input",
    response: {
      answers: response,
    },
  })
  markProtocolInteraction(
    row,
    "answered",
    {
      answers: response,
      message: input.message,
    },
    now,
  )
}

async function rejectProtocolInteraction(row: InteractionRow, message?: string) {
  if (!row.run_id) throw new Error(`protocol interaction ${row.id} has no run`)
  const run = requireRun(row.run_id)
  const executor = ExecutorRegistry.require(run.executor)
  if (!executor.resolve) throw new Error(`executor ${run.executor} does not support interaction resolution`)
  const payload = row.payload ?? {}
  const requestID = typeof payload.request_id === "string" ? payload.request_id : row.external_id
  const now = Date.now()
  if (row.request_type === "permission") {
    await executor.resolve({
      sessionID: run.session_id ?? undefined,
      queueTaskID: run.executor_ref?.queue_task_id,
      requestID,
      kind: "approval",
      response: {
        decision: "decline",
      },
    })
    markProtocolInteraction(row, "rejected", { message }, now)
    return
  }
  await executor.resolve({
    sessionID: run.session_id ?? undefined,
    queueTaskID: run.executor_ref?.queue_task_id,
    requestID,
    kind: "input",
    error: {
      code: -32000,
      message: message?.trim() || "Rejected by operator",
    },
  })
  markProtocolInteraction(row, "rejected", { message }, now)
}

function markProtocolInteraction(
  row: InteractionRow,
  status: EngineInteractionStatus,
  response: Record<string, unknown>,
  now: number,
) {
  Database.transaction((db) => {
    db.update(EngineInteractionRequestTable)
      .set({
        status,
        response,
        time_resolved: now,
        time_updated: now,
      })
      .where(eq(EngineInteractionRequestTable.id, row.id))
      .run()
    if (row.run_id) {
      const runID = row.run_id
      Database.effect(() =>
        EngineProtocol.emit(
          Event.InteractionResolved,
          {
            taskID: row.task_id,
            runID,
            interactionID: row.id,
            status,
            summary: status === "answered" ? "Interaction answered" : "Interaction rejected",
          },
          { taskID: row.task_id, runID, interactionID: row.id, source: "service.interaction" },
        ),
      )
    }
  })
}
