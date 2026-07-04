/**
 * Orchestrator — master agent in the Agent Team architecture.
 *
 * Per specs/current/architecture/16-unified-teardown.md §3, the orchestrator has no typed
 * trigger enum — it is woken by *events* (task creation, goal refill wake,
 * goal-run update, acceptance verdict, operator message) carried as a free-form note. On every
 * wake it reads its full state from the describe layer + the artifact stream
 * and decides what to do next. Callers may pass an optional `event.note`
 * string to hint WHY they just woke the orchestrator; every decision derives
 * from the describe snapshot, not from the note's content.
 *
 * The orchestrator is the only task-level decision maker. It reads the
 * describe/artifact snapshot on every wake and chooses which specialist tool
 * to invoke next: intent analysis, frontend design, requirements, architect,
 * build, integrity, acceptance, or lifecycle controls. MiniWorkflow
 * renders an advisory path; it is not a fixed pipeline or hidden state
 * machine. Specialist agents own their structured artifacts, but task
 * lifecycle stays here.
 *
 * ── Why this file does NOT use `runAgentSession` ───────────────────────────
 *
 * The orchestrator is the HOST of the worker-session pattern that
 * `src/agent/runner.ts` abstracts — not a user of that pattern. Worker
 * agents (build, acceptance, integrity, requirements, architect,
 * frontend-design, intent-analysis) collapse into the runner's shape because
 * they all share: single composed system prompt, terminal collector contract,
 * thrown AgentRunError on stream / abort failure, no step-level coordination.
 *
 * The orchestrator deliberately diverges on every one of those axes:
 *   - Two-part system prompt (static + per-wake describe / iteration / verdict)
 *   - Orchestrator tools return evidence to the same reasoning turn; they do
 *     not end scheduling through host-side deferred-stop gates.
 *   - Stream errors are persisted as `engine_artifact kind="orchestrator-
 *     stream-error"` and consumed by the next wake's LLM via describe; the
 *     orchestrator does NOT throw on them, because rule 23 says recovery is
 *     a decision the LLM owns on the next wake, not a state-machine reaction
 *     in this turn.
 *   - Concurrency state (`running.set(taskID, ctrl)`) and SerialQueue-driven
 *     wake scheduling sit OUTSIDE any single processTask invocation; the
 *     runner has no analog because workers do not own their own dispatch.
 *
 * See the matching NON-GOAL section in `src/agent/runner.ts` for the full
 * rationale. Anyone tempted to "consolidate orchestrator onto the runner"
 * is looking at the abstraction upside-down — the orchestrator IS the host
 * the runner is a building block of.
 * ───────────────────────────────────────────────────────────────────────────
 */
import ORCHESTRATOR_CORE from "@/prompt/core/orchestrator-core.txt"
import { Provider } from "@/provider/provider"
import { EffectiveConfig } from "@/config/effective"
import { PromptProfileResolver } from "@/expert-squad/prompt-profile-resolver"
import { resolveAgentModel } from "@/agent/model"
import { EngineConfig } from "@/engine"
import { appendNonExecutorSourceBoundary } from "@/prompt/non-executor-source-boundary"
import {
  AgentRunError,
  buildHardErrorFromFinalMessage,
  toolErrorPartsFromFinalMessage,
} from "@/agent/runner"
import { Session } from "@/session"
import { SessionContext } from "@/session/context"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { Message } from "@/session/message"
import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import { recordToolExecuteError } from "@/engine/persist"
import { cancelSessionPromptInScope } from "@/engine/cancellation-scope"
import { toolGuard } from "@/util/tool-guard"
import { createOrchestratorTools } from "./tools"
import { SubAgentProtocol } from "@/agent/sub-agent-protocol"
import { attachmentContextPacket, renderAgentContextPacketSection } from "@/agent/context-packet"
import { renderUserRequestSection } from "@/intent/request-prompt"
import { readIterationHistory as readHistForPrompt } from "@/metrics/store"
import {
  findLatestRunForTask,
  findAcceptanceByRun,
  findEvaluationByRun,
  requireTask,
  blockActiveRunForTask,
  updateTask,
  WorkflowRegistry,
  createWorkflowState,
  workflowSelectionSnapshot,
  renderWorkflowPrompt,
} from "@/engine"
import { EngineProtocol } from "@/engine/protocol"
import { Event as EngineEvent } from "@/engine/model"
import { describeTask, renderTaskDescription, type TaskDesc } from "@/engine/describe"
import { deriveTaskStatus, isTaskTerminal } from "@/engine/task-status"
import type { TaskRow, WorkflowState, MiniWorkflow } from "@/engine"
import { AgentTrace } from "@/trace"
import { paragraphSummary, type AgentReport } from "@/agent/report"
import { NamedError } from "@opencorvus-ai/util/error"
import {
  isOrchestratorNoDecisionObservationToolName,
  ORCHESTRATOR_DECISION_EFFECT_METADATA_KEY,
  type OrchestratorDecisionEffect,
} from "./stateful-tool-names"

const log = Log.create({ service: "orchestrator" })
// MAX_STEPS lives on agent.orchestrator.steps in src/agent/agent.ts. SessionLoop
// reads that directly via Agent.get("orchestrator") — no local constant needed.

export interface OrchestratorTaskErrorEnvelope {
  errorName: string
  message: string
  data?: unknown
}

export const ORCHESTRATOR_TASK_ERROR_ENVELOPE_MARKER = "\n[orchestrator-error-envelope]"

const TOOL_CALL_TEXT_SENTINELS = ["<|tool_call_argument_begin|>", "<|tool_calls_section_end|>"]

export class OrchestratorNoDecisionStopError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OrchestratorNoDecisionStopError"
  }
}

export interface OrchestratorWakeToolDecision {
  name: string
  decisionEffect?: OrchestratorDecisionEffect
}

export function classifyOrchestratorDecisionStop(input: {
  taskTerminal: boolean
  schedulerParkAllowed?: boolean
  finish?: string
  finalText?: string
  providerVisiblePartCount: number
  wakeTools: OrchestratorWakeToolDecision[]
}): string | undefined {
  if (input.taskTerminal) return undefined

  const finalText = input.finalText?.trim() ?? ""
  const wakeToolNames = input.wakeTools.map((tool) => tool.name)
  if (TOOL_CALL_TEXT_SENTINELS.some((sentinel) => finalText.includes(sentinel))) {
    return (
      "Orchestrator emitted provider tool-call protocol text instead of a real tool call. " +
      `wake_tools=[${wakeToolNames.join(",") || "none"}]; text=${JSON.stringify(snippet(finalText, 280))}`
    )
  }

  if (!input.finish && input.providerVisiblePartCount === 0) {
    return (
      "Orchestrator produced an empty assistant turn with no finish reason and no persisted parts. " +
      `wake_tools=[${wakeToolNames.join(",") || "none"}]`
    )
  }

  if (input.finish === "tool-calls") return undefined
  if (!input.finish) {
    return (
      "Orchestrator ended without a finish reason on an active task. " +
      `wake_tools=[${wakeToolNames.join(",") || "none"}]; text=${JSON.stringify(snippet(finalText, 280))}`
    )
  }
  if (input.finish !== "stop") {
    return (
      `Orchestrator ended with finish=${input.finish} instead of a completed stop. ` +
      `wake_tools=[${wakeToolNames.join(",") || "none"}]; text=${JSON.stringify(snippet(finalText, 280))}`
    )
  }
  if (input.wakeTools.length === 0) {
    if (input.schedulerParkAllowed && finalText.length > 0 && input.providerVisiblePartCount > 0) return undefined
    return `Orchestrator stopped without calling any tool. text=${JSON.stringify(snippet(finalText, 280))}`
  }

  const hasDecisionEffect = input.wakeTools.some((tool) => tool.decisionEffect === "decision")
  const onlyObservationTools = input.wakeTools.every(
    (tool) => tool.decisionEffect === "observation" || isOrchestratorNoDecisionObservationToolName(tool.name),
  )
  if (onlyObservationTools) {
    return (
      "Orchestrator stopped after only observation or pause tools; no task decision was made. " +
      `wake_tools=[${wakeToolNames.join(",")}]; text=${JSON.stringify(snippet(finalText, 280))}`
    )
  }
  if (!hasDecisionEffect) {
    return (
      "Orchestrator stopped after tool calls that produced no task decision effect. " +
      `wake_tools=[${wakeToolNames.join(",")}]; effects=[${input.wakeTools.map((tool) => tool.decisionEffect ?? "missing").join(",")}]; ` +
      `text=${JSON.stringify(snippet(finalText, 280))}`
    )
  }
  let lastDecisionIndex = -1
  let lastNonDecisionIndex = -1
  for (let index = 0; index < input.wakeTools.length; index++) {
    const tool = input.wakeTools[index]
    if (tool.decisionEffect === "decision") lastDecisionIndex = index
    if (tool.decisionEffect !== "decision" || isOrchestratorNoDecisionObservationToolName(tool.name)) {
      lastNonDecisionIndex = index
    }
  }
  if (lastNonDecisionIndex > lastDecisionIndex) {
    return (
      "Orchestrator stopped after non-decision tools following the latest task decision; no follow-up task decision was made. " +
      `wake_tools=[${wakeToolNames.join(",")}]; effects=[${input.wakeTools.map((tool) => tool.decisionEffect ?? "missing").join(",")}]; ` +
      `text=${JSON.stringify(snippet(finalText, 280))}`
    )
  }

  return undefined
}

function schedulerParkAllowedFromSnapshot(snapshot: TaskDesc): boolean {
  if (snapshot.status !== "active") return false
  if (snapshot.run_orphan) return false
  if ((snapshot.pending_agent_coordination?.length ?? 0) > 0) return false

  const dispatchable = new Set(snapshot.collaboration_closure?.dispatchable_goal_ids ?? [])
  if (dispatchable.size > 0) return false
  if ((snapshot.collaboration_closure?.failed_goal_ids.length ?? 0) > 0) return false

  let hasLiveBlockingGoal = false
  for (const goal of snapshot.goals) {
    if (goal.priority !== "blocking") continue
    if (goal.needs_redispatch || goal.is_terminal_fail || goal.is_aborted || goal.is_orphaned) return false
    if (goal.never_dispatched && dispatchable.has(goal.id)) return false
    if (goal.is_running) hasLiveBlockingGoal = true
  }

  return hasLiveBlockingGoal
}

function snippet(input: string, max: number): string {
  if (input.length <= max) return input
  return `${input.slice(0, max)}...`
}

export function parseOrchestratorTaskErrorEnvelope(input?: string | null): OrchestratorTaskErrorEnvelope | undefined {
  if (!input) return undefined
  const markerIndex = input.indexOf(ORCHESTRATOR_TASK_ERROR_ENVELOPE_MARKER)
  if (markerIndex < 0) return undefined
  const raw = input.slice(markerIndex + ORCHESTRATOR_TASK_ERROR_ENVELOPE_MARKER.length).trim()
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return undefined
    const candidate = parsed as Record<string, unknown>
    if (typeof candidate.errorName !== "string" || typeof candidate.message !== "string") return undefined
    return {
      errorName: candidate.errorName,
      message: candidate.message,
      data: candidate.data,
    }
  } catch {
    return undefined
  }
}

function serializeOrchestratorTaskError(error: unknown): {
  envelope: OrchestratorTaskErrorEnvelope
  message: string
  taskError: string
} {
  const envelope = error instanceof AgentRunError ? hardErrorEnvelope(error) : orchestratorErrorEnvelope(error)
  const message = envelope.message
  return {
    envelope,
    message,
    taskError:
      `Orchestrator error: ${message}` + `${ORCHESTRATOR_TASK_ERROR_ENVELOPE_MARKER}${JSON.stringify(envelope)}`,
  }
}

function orchestratorErrorEnvelope(error: unknown): OrchestratorTaskErrorEnvelope {
  const candidate = error as { name?: unknown; message?: unknown; data?: unknown; constructor?: { name?: string } }
  const data = candidate && typeof candidate === "object" ? candidate.data : undefined
  const dataMessage =
    data && typeof data === "object" && typeof (data as { message?: unknown }).message === "string"
      ? (data as { message: string }).message
      : undefined
  const message = dataMessage ?? (typeof candidate?.message === "string" ? candidate.message : String(error))
  const errorName =
    typeof candidate?.name === "string" && candidate.name.length > 0
      ? candidate.name
      : error instanceof Error && error.constructor.name
        ? error.constructor.name
        : "UnknownError"
  return {
    errorName,
    message,
    ...(error instanceof NamedError ? { data: (error as NamedError & { data: unknown }).data } : {}),
  }
}

function hardErrorEnvelope(error: AgentRunError): OrchestratorTaskErrorEnvelope {
  return error.cause === undefined ? orchestratorErrorEnvelope(error) : orchestratorErrorEnvelope(error.cause)
}

export function recordOrchestratorTraceReportForSession(
  session: Session.Info,
  input: Parameters<typeof AgentTrace.recordAgentReport>[0],
): void {
  SessionContext.provide(session, () => {
    AgentTrace.recordAgentReport(input)
  })
}

function finalTextFromMessage(finalMessage: Message.WithParts | undefined): string | undefined {
  return finalMessage?.parts
    ?.filter((part) => part.type === "text")
    .map((part) => (part as { text: string }).text)
    .join("\n\n")
}

function providerVisiblePartCount(finalMessage: Message.WithParts | undefined): number {
  return finalMessage?.parts.filter((part) => part.type === "text" || part.type === "tool").length ?? 0
}

function renderWakeToolDecision(tool: OrchestratorWakeToolDecision): string {
  return tool.decisionEffect ? `${tool.name}(${tool.decisionEffect})` : tool.name
}

function buildOrchestratorWakeTraceReport(input: {
  finalText?: string
  finish?: string
  wakeTools: OrchestratorWakeToolDecision[]
  streamErrors: Array<{ reason: string; errorName?: string }>
}): AgentReport {
  const finalText = input.finalText?.trim()
  if (finalText) {
    return {
      summary: paragraphSummary(finalText),
      detail: finalText,
    }
  }

  const toolSummary = input.wakeTools.map(renderWakeToolDecision).join(", ")
  const lines = [
    `Orchestrator wake completed with finish=${input.finish ?? "unknown"} and no final text.`,
    toolSummary ? `Wake tools: ${toolSummary}.` : "Wake tools: none.",
  ]
  if (input.streamErrors.length > 0) {
    lines.push(
      `Stream errors: ${input.streamErrors
        .map((error) => `${error.errorName ?? "error"}: ${error.reason}`)
        .join("; ")}`,
    )
  }
  const detail = lines.join("\n")
  return {
    summary: paragraphSummary(detail),
    detail,
  }
}

async function collectOrchestratorWakeToolNames(input: {
  sessionID: string
  boundaryMessageID?: string
}): Promise<OrchestratorWakeToolDecision[]> {
  const tools: OrchestratorWakeToolDecision[] = []
  for await (const message of Message.stream(input.sessionID)) {
    if (input.boundaryMessageID && message.info.id === input.boundaryMessageID) break
    if (message.info.role !== "assistant") continue
    for (const part of message.parts) {
      if (part.type !== "tool") continue
      const toolName = (part as Message.ToolPart).tool
      const state = (part as Message.ToolPart).state
      const metadata = "metadata" in state ? state.metadata : undefined
      const rawEffect = metadata?.[ORCHESTRATOR_DECISION_EFFECT_METADATA_KEY]
      const decisionEffect =
        rawEffect === "decision" || rawEffect === "observation" || rawEffect === "none" ? rawEffect : undefined
      if (toolName) tools.push({ name: toolName, decisionEffect })
    }
  }
  return tools.reverse()
}

async function latestSessionMessageID(sessionID: string): Promise<string | undefined> {
  for await (const message of Message.stream(sessionID)) {
    return message.info.id
  }
  return undefined
}

interface OrchestratorSessionErrorRecordResult {
  streamFuse?: { tripped: boolean; consecutive: number; windowMs: number }
  selfWakeDispatched: boolean
}

function isOrchestratorNoDecisionEnvelope(envelope: OrchestratorTaskErrorEnvelope): boolean {
  return envelope.errorName === "OrchestratorNoDecisionStopError"
}

async function recordOrchestratorSessionHardError(input: { taskID: string; sessionID: string; error: AgentRunError }) {
  return recordOrchestratorSessionErrorEnvelope({
    taskID: input.taskID,
    sessionID: input.sessionID,
    envelope: hardErrorEnvelope(input.error),
    summaryPrefix: "Orchestrator session hard error",
  })
}

async function recordOrchestratorSessionErrorEnvelope(input: {
  taskID: string
  sessionID: string
  envelope: OrchestratorTaskErrorEnvelope
  summaryPrefix: string
}): Promise<OrchestratorSessionErrorRecordResult> {
  const now = Date.now()
  const reason = `${input.envelope.errorName}: ${input.envelope.message}`
  const noDecision = isOrchestratorNoDecisionEnvelope(input.envelope)

  if (noDecision) {
    const { recordOrchestratorDecisionContractFailure } = await import("@/engine/persist")
    recordOrchestratorDecisionContractFailure({
      taskID: input.taskID,
      reason,
      errorName: input.envelope.errorName,
      sessionID: input.sessionID,
      now,
    })
    const { dispatchTaskLoop } = await import("@/engine/queue")
    const dispatchResult = await dispatchTaskLoop({
      taskID: input.taskID,
      event: {
        note: OrchestratorEventNote.noDecisionRecovery({ reason }),
      },
    })
    if (dispatchResult === "ignored") {
      await blockActiveRunForTask(input.taskID, {
        blockingReason: "orchestrator_decision_contract_failure",
        error: reason,
        summary: `${input.summaryPrefix}: ${reason}; recovery dispatch was ignored`,
      })
      log.error("orchestrator no-decision recovery dispatch ignored", { taskID: input.taskID })
      return { selfWakeDispatched: false }
    }
    log.warn("orchestrator no-decision recovery wake scheduled", {
      taskID: input.taskID,
      dispatchResult,
    })
    return { selfWakeDispatched: true }
  }

  const { recordOrchestratorStreamError, maybeTripOrchestratorStreamErrorFuse } = await import("@/engine/persist")
  recordOrchestratorStreamError({
    taskID: input.taskID,
    reason,
    errorName: input.envelope.errorName,
    sessionID: input.sessionID,
    now,
  })
  const fuse = await maybeTripOrchestratorStreamErrorFuse({
    taskID: input.taskID,
    now,
    lastReason: reason,
  })
  if (fuse.tripped) {
    await blockActiveRunForTask(input.taskID, {
      blockingReason: "orchestrator_stream_error",
      error: reason,
      summary: `${input.summaryPrefix}: ${reason}`,
    })
    log.error("orchestrator stream-error fuse tripped - scheduler terminal decision required", {
      taskID: input.taskID,
      consecutive: fuse.consecutive,
      windowMs: fuse.windowMs,
    })
    return { streamFuse: fuse, selfWakeDispatched: false }
  }

  await blockActiveRunForTask(input.taskID, {
    blockingReason: "orchestrator_stream_error",
    error: reason,
    summary: `${input.summaryPrefix}: ${reason}`,
  })
  return { streamFuse: fuse, selfWakeDispatched: false }
}

// ---------------------------------------------------------------------------
// Wake event — context about WHY the orchestrator is being woken.
// Replaces the old typed trigger enum per specs/current/architecture/16-unified-teardown.md
// §3. Callers that previously sent trigger.kind="X" now synthesize the relevant
// context string into `note`. The structured fields below carry user/operator
// payload that host code must not infer from free-form text.
// ---------------------------------------------------------------------------

export interface OrchestratorEvent {
  /** Free-form "reason for wake" string rendered as this wake's model input.
   *  If absent, the task's original request is used. */
  note?: string
  /** Present only when the wake is caused by an operator-typed message.
   *  Passed to `createOrchestratorTools` so the `inject_operator_message`
   *  tool can surface the text/attachments into the running executor. */
  operatorMessage?: {
    text: string
    attachmentSummary?: string
    source?: string
    messageID?: string
  }
  /** Operator lifecycle intent from public controls. Distinct from `note` so
   * retry and replan cannot collapse into the same host event. */
  operatorIntent?: {
    kind: "retry" | "replan"
  }
  /** Worker-to-orchestrator coordination causality for durable wake replay.
   * A2A is Agent-to-Agent; this field keeps request identity out of free text. */
  coordinationRequest?: {
    requestID: string
  }
  /** Durable task lifecycle causality for internal engine wakes. This is not a
   *  user/operator note and must not synthesize a visible user message. */
  lifecycleFact?: {
    kind: "server_restart_active_task_recovered" | "terminal_goal_refill_dispatched"
    eventID: string
  }
}

// ---------------------------------------------------------------------------
// Concurrency guard
// ---------------------------------------------------------------------------

const running = new Map<string, AbortController>()
// Cooldown: when the Orchestrator last finished for each task.
// Orphan recovery checks this to avoid re-triggering immediately.
const lastFinished = new Map<string, number>()

class OrchestratorPromptInactiveError extends Error {
  constructor(input: { taskID: string; sessionID: string; inactivityMs: number }) {
    super(
      `Orchestrator prompt ${input.sessionID} for task ${input.taskID} produced no activity for ${input.inactivityMs}ms`,
    )
    this.name = "OrchestratorPromptInactiveError"
  }
}

async function runOrchestratorPromptWithInactivity<T>(input: {
  taskID: string
  session: Session.Info
  run: () => Promise<T>
}): Promise<T> {
  const timeout = (await EngineConfig.get()).activity.task_queue_run_timeout_ms
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error(`Invalid assistant.activity.task_queue_run_timeout_ms: ${timeout}`)
  }

  const pollMs = Math.min(1_000, Math.max(50, Math.floor(timeout / 20)))
  let timer: ReturnType<typeof setTimeout> | undefined
  let settled = false
  let lastSignature = ""
  let idleDeadline = Date.now() + timeout

  const activitySignature = async () => {
    const sessionIDs = [...new Set([input.session.id, ...(await Session.tree(input.session.id))])]
    return sessionIDs
      .map((sessionID) => {
        const promptActivity = SessionPrompt.ownerActivity(sessionID)
        const streamActivity = SessionStatus.getActivity(sessionID)
        const status = SessionStatus.get(sessionID)
        return [
          sessionID,
          JSON.stringify(status),
          promptActivity?.timeUpdated ?? 0,
          promptActivity?.timeCancelled ?? 0,
          streamActivity?.last_activity_at ?? 0,
        ].join(":")
      })
      .join("|")
  }

  const inactive = new Promise<never>((_, reject) => {
    const tick = async () => {
      if (settled) return
      const signature = await activitySignature()
      if (signature !== lastSignature) {
        lastSignature = signature
        idleDeadline = Date.now() + timeout
      }
      if (Date.now() > idleDeadline) {
        try {
          SessionPrompt.cancel(input.session.id, input.session.directory)
        } catch (error) {
          log.warn("orchestrator prompt inactivity cancellation failed", {
            taskID: input.taskID,
            sessionID: input.session.id,
            error: error instanceof Error ? error.message : String(error),
          })
        }
        reject(
          new OrchestratorPromptInactiveError({
            taskID: input.taskID,
            sessionID: input.session.id,
            inactivityMs: timeout,
          }),
        )
        return
      }
      timer = setTimeout(() => void tick(), pollMs)
    }
    timer = setTimeout(() => void tick(), pollMs)
  })

  try {
    return await Promise.race([input.run(), inactive])
  } finally {
    settled = true
    if (timer) clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export namespace Orchestrator {
  export function abort(taskID: string): void {
    const ctrl = running.get(taskID)
    if (ctrl) {
      ctrl.abort("orchestrator aborted")
      running.delete(taskID)
      log.info("orchestrator aborted", { taskID })
    }
  }

  export function isRunning(taskID: string): boolean {
    return running.has(taskID)
  }

  export async function processTask(taskID: string, event?: OrchestratorEvent): Promise<void> {
    const task = requireTask(taskID)
    if (isTaskTerminal(task)) {
      log.info("terminal task process ignored", { taskID, status: deriveTaskStatus(task), note: event?.note })
      return
    }

    abort(taskID)
    const ctrl = new AbortController()
    running.set(taskID, ctrl)

    let agentSessionID: string | undefined
    let agentSessionInfo: Session.Info | undefined
    let promptInFlight = false
    try {
      if (!task.session_id) {
        log.error("orchestrator: no session_id on task", { taskID })
        return
      }

      // workflow_state is no longer persisted. Every wake asks the scheduler
      // registry for the workflow that applies to this task kind, then derives
      // step status from artifacts instead of mutating a cached FSM cell.
      // "First wake" detection now reads task.time_started (stamped by
      // the serial queue when it picks the task up). Per rule 23 the
      // LLM reads describe output for actual phase identification, not
      // a cached step-FSM cell.
      const workflowID = await WorkflowRegistry.defaultIDForTaskKind(task.kind)
      const workflow = await WorkflowRegistry.resolve(workflowID)
      if (!workflow) {
        throw new Error(`Orchestrator workflow "${workflowID}" is not registered`)
      }
      const workflowState: WorkflowState = createWorkflowState(workflow)
      const isFirstWake = !task.time_started
      if (isFirstWake) {
        EngineProtocol.emit(EngineEvent.WorkflowSelected, {
          taskID,
          workflowID: workflow.id,
          workflowName: workflow.name,
          workflow: workflowSelectionSnapshot(workflow),
          summary: `Workflow "${workflow.name}" selected`,
        })
      }

      // 1. Resolve model — strict config only: agent.orchestrator.model first,
      //    then top-level model. Missing config is a task-visible startup
      //    failure, never a silent return or implicit provider fallback.
      let model: Awaited<ReturnType<typeof resolveAgentModel>>
      try {
        model = await resolveAgentModel("orchestrator", { sessionID: task.session_id })
      } catch (e) {
        const structured = serializeOrchestratorTaskError(e)
        log.error("orchestrator: no LLM model available", {
          taskID,
          errorName: structured.envelope.errorName,
          error: structured.message,
          data: structured.envelope.data,
        })
        await updateTask(task, { error: structured.taskError }, `Orchestrator failed: ${structured.message}`)
        return
      }

      // 2. Resolve the task's single orchestrator child session. LLM context
      //    is still reconstructed from DB state (goals, runs, deliveries,
      //    decision log) via buildSystemParts on each invocation; the session
      //    is the durable task-level conversation/audit surface for every wake.
      const agentSession = await orchestratorSessionForTask(task)
      agentSessionID = agentSession.id
      agentSessionInfo = agentSession

      // 3. Resolve the active expert-squad scheduler projection, then create
      //    and project the exact tool table before guard/enable/runtime setup.
      const profileScope = task.session_id ? { sessionID: task.session_id } : { taskID: task.id }
      const [schedulerConfig, schedulerProjectDirectory] = await Promise.all([
        EffectiveConfig.effective(profileScope),
        EffectiveConfig.directory(profileScope),
      ])
      const schedulerCapability = await PromptProfileResolver.resolveSchedulerCapability({
        projectDirectory: schedulerProjectDirectory,
        config: schedulerConfig,
      })
      const { tools: rawTools } = createOrchestratorTools({
        taskID,
        agentSessionID: agentSession.id,
        signal: ctrl.signal,
        workflow,
        workflowState,
        operatorMessage: event?.operatorMessage,
      })
      const tools = await PromptProfileResolver.projectOrchestratorTools(rawTools, schedulerCapability, {
        projectDirectory: schedulerProjectDirectory,
        signal: ctrl.signal,
        workflow,
      })
      const guard = toolGuard(tools)
      const enableMap: Record<string, boolean> = Object.fromEntries(
        Object.keys(guard.tools).map((name) => [name, true]),
      )

      // 4. Build prompt. Caller-supplied text is a real wake message
      //    (operator text / retry reason). Internal engine wakes reuse the
      //    existing visible user message and carry fresh task state through
      //    the runtime contract instead of synthesizing another user turn.
      const systemContext = await buildSystemParts(task, event, workflow, workflowState)
      const system = systemContext.parts
      const appendUserMessage = Boolean(
        event?.note || event?.operatorMessage || !(await sessionHasUserMessage(agentSession.id)),
      )
      const userText = appendUserMessage ? orchestratorUserText(task, event) : ""
      // Build attachment inventory when the task has file attachments. Wakes
      // carry link/index refs only; no hidden model-only file parts are added.
      // Orchestrator does NOT own a `read` tool. Attachments are forwarded
      // automatically to every sub-agent it dispatches (requirements /
      // frontend_design / architect / build / refine — see orchestrator/tools.ts
      // dispatch sites that pass `attachments: task.attachments`). The
      // inventory below tells the orchestrator what is available when
      // deciding which sub-agent to invoke; the trailing instruction is a
      // HARD design constraint (no read tool here) and a hard requirement
      // that the orchestrator cite the attachments in every dispatch prompt
      // so the sub-agent treats them as primary context, not silent backdrop.
      const allAttachments = Array.isArray(task.attachments)
        ? (task.attachments as Array<{ sha?: string; url?: string; mime?: string; size?: number; filename?: string }>)
        : undefined
      const inlinedNote = !appendUserMessage
        ? "This is an internal engine wake, so no new user message is created. Use this inventory to cite task attachments; do not claim pixel-level inspection unless visible tool/evidence output proves it."
        : "Multimodal items are refs, not hidden prompt bytes. Do not claim pixel-level inspection unless a visible tool/evidence output proves it."
      const attachmentPacket = attachmentContextPacket(allAttachments, {
        title: "Task Attachments (forwarded to sub-agents automatically)",
        note:
          "The user attached the files below to this task. " +
          inlinedNote +
          " " +
          "Text/json refs can be read by sub-agents that expose attachment-reading tools. " +
          "You do NOT have a `read` tool yourself — do not attempt to fetch reference content. " +
          "When you call `requirements` / `frontend_design` / `architect` / `build` / `refine`, the engine forwards every attachment to the sub-agent automatically — but the sub-agent's prompt only cites them when YOU mention them by filename in your dispatch instructions. ALWAYS cite the relevant attachments by EXACT filename and explain their relevance. NEVER reference an attachment that is not listed below — if this section is empty, the user attached nothing in this wake and any phrase implying you saw a file is a hallucination.",
      })
      const inventoryText = renderAgentContextPacketSection(attachmentPacket ? [attachmentPacket] : []) ?? ""
      const enrichedUserText = appendUserMessage ? userText + inventoryText : ""
      const internalWakeNotice = [
        "## Wake Provenance",
        "这是一条 wake 消息，不是用户发送的新消息。",
        "This is a wake message, not a user-authored message. Do not claim the user said, asked, sent, or implied anything unless it appears in the visible user/operator messages.",
      ].join("\n")
      const runtimeSystem = appendUserMessage
        ? system
        : [...system, internalWakeNotice, ...(inventoryText.trim() ? [inventoryText] : [])]
      // Build PromptInput.parts. Text only; attachment media is referenced by
      // URL/index in the prompt inventory.
      const parts: Array<{ type: "text"; text: string }> = appendUserMessage
        ? [{ type: "text", text: enrichedUserText }]
        : []
      const partsWithIds = parts.map((p) => ({ ...p, id: Identifier.ascending("part") }))

      log.info("orchestrator starting", {
        taskID,
        firstWake: isFirstWake,
        note: event?.note,
        sessionID: agentSession.id,
        model: `${model.providerID}/${model.id}`,
        toolCount: Object.keys(tools).length,
        rawToolCount: Object.keys(rawTools).length,
        promptProfileID: schedulerCapability.promptProfileID,
        projectionHash: schedulerCapability.projectionHash,
      })

      // Abort hooks translate external interrupts to SessionPrompt.cancel on
      // the child session so the loop releases its processor cleanly. We
      // ALSO cascade the cancel to every descendant session: orchestrator
      // tools (`explore`, `requirements`, `frontend_design`, `architect`,
      // `build`, ...) spawn their own SessionPrompt loops, and the
      // orchestrator's ctrl signal is not threaded into them — without
      // cascading here, an `interruptTaskLoop` (or a hard abort) returns
      // immediately from the orchestrator while every in-flight subagent
      // keeps burning tokens producing results no one is awaiting. The
      // task-api cancelTask path ALREADY walks the session tree
      // (task-api/index.ts cancelTask), so this brings the in-process
      // interrupt path in line with the explicit-cancel API path.
      // Cancel order is descendants-first so a parent's processor sees its
      // tool's child session already terminal when it unwinds.
      const abortPrompt = () => {
        void (async () => {
          try {
            const ids = await Session.tree(agentSession.id)
            for (const descendantID of ids.slice().reverse()) {
              const descendant = descendantID === agentSession.id ? agentSession : await Session.get(descendantID)
              cancelSessionPromptInScope({
                session: descendant,
                taskID,
                handle: "orchestrator.abort-cascade",
              })
            }
          } catch (err) {
            log.warn("orchestrator abort cascade failed", {
              taskID,
              sessionID: agentSession.id,
              error: err instanceof Error ? err.message : String(err),
            })
            cancelSessionPromptInScope({
              session: agentSession,
              taskID,
              handle: "orchestrator.abort-cascade",
            })
            throw err
          }
        })()
      }
      ctrl.signal.addEventListener("abort", abortPrompt, { once: true })

      // Subscribe to session-level errors so critical stream failures still
      // flip the task to failed. SessionLoop publishes Session.Event.Error on
      // provider / processor faults; collecting them here reproduces the
      // the pre-migration runtime.failures snapshot at a coarser granularity.
      const streamErrors: Array<{ reason: string; errorName?: string }> = []
      const errorUnsub = Bus.subscribe(Session.Event.Error, (evt) => {
        // The published payload is a NamedError-shaped object produced by
        // Message.fromError(...).toObject(): { name, data: { message, ... } }.
        // Reading `props.error.message` directly comes back undefined and
        // surfaced as the generic "unknown session error" — hiding the
        // actual provider error (e.g. HTTP 429 quota) from the orchestrator
        // wake context. Unwrap data.message first so the real reason flows
        // into the artifact and the next decision turn.
        const props = evt.properties as {
          sessionID: string
          error: { name?: string; message?: string; data?: { message?: string } }
        }
        if (props.sessionID !== agentSession.id) return
        const msg = props.error?.data?.message ?? props.error?.message ?? "unknown session error"
        streamErrors.push({ reason: msg, errorName: props.error?.name })
      })

      // 5. Run the orchestrator session — tools via SessionRuntimeContract.
      //    Step limit lives on agent.orchestrator.steps.
      let finalMessage: Message.WithParts | undefined
      const promptBoundaryMessageID = await latestSessionMessageID(agentSession.id)
      try {
        SessionPrompt.setSessionRuntimeContract(agentSession.id, {
          identity: {
            sessionID: agentSession.id,
            agentKind: "orchestrator",
            promptProfileID: schedulerCapability.promptProfileID,
            capabilityProfileID: schedulerCapability.capabilityProfileID,
            projectionHash: schedulerCapability.projectionHash,
            contractKind: "orchestrator-wake",
            installedAt: Date.now(),
          },
          tools: guard.tools as any,
          includeMcpTools: false,
          system: appendUserMessage ? undefined : runtimeSystem,
          systemMode: appendUserMessage ? undefined : "complete",
          runOnce: !appendUserMessage,
        })
        promptInFlight = true
        finalMessage = await runOrchestratorPromptWithInactivity({
          taskID,
          session: agentSession,
          run: async () =>
            appendUserMessage
              ? ((await SessionPrompt.prompt({
                  sessionID: agentSession.id,
                  model: { providerID: model.providerID, modelID: model.api.id },
                  agent: "orchestrator",
                  system: Array.isArray(system) ? system.join("\n\n") : system,
                  systemMode: "complete",
                  tools: enableMap,
                  byteMaterializationProjectID: agentSession.projectID,
                  parts: partsWithIds,
                })) as Message.WithParts)
              : ((await SessionPrompt.loop({
                  sessionID: agentSession.id,
                })) as Message.WithParts),
        })
        promptInFlight = false
      } finally {
        SessionPrompt.clearSessionRuntimeContract(agentSession.id)
        errorUnsub()
        ctrl.signal.removeEventListener("abort", abortPrompt)
      }

      const assistantInfo = finalMessage?.info as Message.Assistant | undefined
      log.info("orchestrator finished", {
        taskID,
        note: event?.note,
        sessionID: agentSession.id,
        finishReason: assistantInfo?.finish,
        streamErrors: streamErrors.length,
      })

      if (finalMessage) {
        const hardError = buildHardErrorFromFinalMessage({
          kind: "orchestrator",
          agentName: "orchestrator",
          finalMessage,
        })
        if (hardError) {
          const now = Date.now()
          for (const part of toolErrorPartsFromFinalMessage(finalMessage)) {
            recordToolExecuteError({
              taskID,
              sessionID: part.sessionID,
              messageID: part.messageID,
              partID: part.id,
              toolName: part.tool,
              callID: part.callID,
              input: part.state.input,
              failure: (part.state as Message.ToolStateError).failure,
              now,
            })
          }
          throw hardError
        }
      }

      const wakeTools = !ctrl.signal.aborted
        ? await collectOrchestratorWakeToolNames({
            sessionID: agentSession.id,
            boundaryMessageID: promptBoundaryMessageID,
          })
        : []

      if (!ctrl.signal.aborted && streamErrors.length === 0) {
        const taskTerminal = isTaskTerminal(requireTask(taskID))
        const noDecision = classifyOrchestratorDecisionStop({
          taskTerminal,
          finish: assistantInfo?.finish,
          finalText: finalTextFromMessage(finalMessage),
          providerVisiblePartCount: providerVisiblePartCount(finalMessage),
          wakeTools,
          schedulerParkAllowed: schedulerParkAllowedFromSnapshot(systemContext.snapshot),
        })
        if (noDecision) {
          throw new AgentRunError("orchestrator", `No-decision orchestrator wake: ${noDecision}`, {
            nonRetryable: true,
            cause: new OrchestratorNoDecisionStopError(noDecision),
          })
        }
      }

      if (AgentTrace.isEnabled()) {
        const finalText = finalTextFromMessage(finalMessage)
        const report = buildOrchestratorWakeTraceReport({
          finalText,
          finish: assistantInfo?.finish,
          wakeTools,
          streamErrors,
        })
        recordOrchestratorTraceReportForSession(agentSession, {
          sessionID: agentSession.id,
          parentSessionID: task.session_id ?? undefined,
          taskID,
          agentName: "orchestrator",
          kind: "orchestrator_wake",
          finishReason: assistantInfo?.finish,
          finalText,
          streamErrors: streamErrors.map((e) => ({ reason: e.reason, name: e.errorName })),
          report,
        })
      }

      // Stream failures (mid-stream protocol violations, provider onError,
      // session-llm idle abort) are recorded as an append-only artifact.
      // Per rule 23 we do NOT transition the task to `failed` here AND we
      // do NOT auto-rewake — both are state-machine reactions. The next
      // external wake re-enters processTask; the LLM reads the abort fact
      // via describe and decides itself (retry, re-dispatch, propose_task,
      // fail_task, or ask the operator).
      if (streamErrors.length > 0) {
        const first = streamErrors[0]
        const reason = `${first?.errorName ?? "stream-error"}: ${first?.reason ?? "unknown"}`
        log.warn("orchestrator stream failure surfaced as artifact", {
          taskID,
          streamErrors: streamErrors.length,
          firstFailureName: first?.errorName,
        })
        const { recordOrchestratorStreamError, maybeTripOrchestratorStreamErrorFuse } = await import("@/engine/persist")
        const now = Date.now()
        recordOrchestratorStreamError({
          taskID,
          reason,
          errorName: first?.errorName,
          sessionID: agentSession.id,
          now,
        })
        await blockActiveRunForTask(taskID, {
          blockingReason: "orchestrator_stream_error",
          error: reason,
          summary: `Orchestrator stream error: ${reason}`,
        })

        // Retry circuit breaker for repeated stream early-death on the same
        // task. The structural side of the historical bug is fixed at
        // `session/message.ts::toModelMessages`; this preserves the resource
        // bound for future provider-side recurrence without involving runtime
        // monitoring or scheduler control.
        const fuse = await maybeTripOrchestratorStreamErrorFuse({
          taskID,
          now,
          lastReason: reason,
        })
        if (fuse.tripped) {
          log.error("orchestrator stream-error fuse tripped — scheduler terminal decision required", {
            taskID,
            consecutive: fuse.consecutive,
            windowMs: fuse.windowMs,
          })
        }
      }
    } catch (error) {
      // SessionLoop persists its own assistant parts; no explicit flush
      // equivalent for the post-phase-3 the pre-migration runtime hooks path.
      //
      // Two distinct catch paths share this handler:
      //  (1) Hard failure mid-prompt — model unavailable, provider 4xx,
      //      stream protocol violation, tool exec error. Recorded as an
      //      orchestrator-stream-error artifact AND stamped on task.error
      //      so the UI surfaces "task is broken" and orphan-recovery can
      //      see the cause.
      //  (2) Ctrl-aborted mid-prompt — `Orchestrator.abort(taskID)` was
      //      called from `interruptTaskLoop` (operator added a new message
      //      → restart with new event) or from `cancelTask` (explicit
      //      cancellation). SessionPromptState.cancel rejected the prompt
      //      with `new Error("session cancelled")`, which lands here.
      //      Previously the handler returned silently on ctrl.signal.aborted,
      //      so the next wake's describe block had no record of the in-flight
      //      turn being killed — the LLM saw a half-conversation with
      //      dangling tool_use blocks and no signal it had been pre-empted.
      //      Per rule 23 the artifact is the single source of truth for
      //      stream failures; the next wake reads it via describe and
      //      decides whether to retry / restart / fail. We do NOT stamp
      //      task.error on an abort: aborts are control-flow signals,
      //      not task-broken states.
      const wasCtrlAborted = ctrl.signal.aborted
      const structured = serializeOrchestratorTaskError(error)
      const abortReasonText = (() => {
        if (!wasCtrlAborted) return undefined
        const reason = ctrl.signal.reason
        if (typeof reason === "string" && reason.length > 0) return reason
        if (reason instanceof Error && reason.message) return reason.message
        return "orchestrator aborted"
      })()
      const logLevel = wasCtrlAborted ? log.info : log.error
      let noDecisionSelfWakeDispatched = false
      logLevel(wasCtrlAborted ? "orchestrator aborted mid-prompt" : "orchestrator failed", {
        taskID,
        note: event?.note,
        errorName: wasCtrlAborted ? "OrchestratorAborted" : structured.envelope.errorName,
        error: wasCtrlAborted ? abortReasonText : structured.message,
        data: wasCtrlAborted ? undefined : structured.envelope.data,
      })
      if (AgentTrace.isEnabled() && agentSessionInfo) {
        recordOrchestratorTraceReportForSession(agentSessionInfo, {
          sessionID: agentSessionInfo.id,
          taskID,
          agentName: "orchestrator",
          kind: "orchestrator_wake_failure",
          error: wasCtrlAborted ? abortReasonText : structured.message,
          report: {
            summary: wasCtrlAborted ? `aborted: ${abortReasonText}` : structured.message,
            detail: wasCtrlAborted ? `aborted: ${abortReasonText}` : structured.message,
          },
        })
      }
      if (agentSessionID) {
        if (error instanceof AgentRunError) {
          const recordResult = await recordOrchestratorSessionHardError({
            taskID,
            sessionID: agentSessionID,
            error,
          })
          noDecisionSelfWakeDispatched =
            isOrchestratorNoDecisionEnvelope(structured.envelope) && recordResult.selfWakeDispatched
        } else if (wasCtrlAborted) {
          // Abort path: synthesize an envelope from the ctrl reason so the
          // artifact records the explicit cancellation reason — the next wake's
          // describe needs to know WHY the prior turn was interrupted, not just
          // that it threw an opaque "session cancelled" Error from
          // SessionPromptState.cancel.
          await recordOrchestratorSessionErrorEnvelope({
            taskID,
            sessionID: agentSessionID,
            envelope: {
              errorName: "OrchestratorAborted",
              message: abortReasonText ?? "orchestrator aborted",
            },
            summaryPrefix: "Orchestrator aborted mid-prompt",
          })
        } else if (promptInFlight) {
          await recordOrchestratorSessionErrorEnvelope({
            taskID,
            sessionID: agentSessionID,
            envelope: structured.envelope,
            summaryPrefix: "Orchestrator prompt error",
          })
        }
      }
      // Surface the error on the task so UI/orphan-recovery can see it.
      // Don't change task status here — runtime-visible stream faults are
      // persisted as artifacts above; missing startup prerequisites are
      // recorded on task.error for the scheduler's terminal decision. Also skip on ctrl abort:
      // aborts are control-flow signals (operator-driven restart or explicit
      // cancel), not "task broken" — task.error would mislead the UI and
      // orphan-recovery into treating the next wake as stuck on a hard failure.
      if (!wasCtrlAborted && !noDecisionSelfWakeDispatched) {
        try {
          const current = requireTask(taskID)
          const { isTaskTerminal } = await import("@/engine/task-status")
          if (!isTaskTerminal(current)) {
            await updateTask(current, { error: structured.taskError }, `Orchestrator failed: ${structured.message}`)
          }
        } catch {
          /* task may have been deleted */
        }
      }
    } finally {
      running.delete(taskID)
    }
  }
}

async function orchestratorSessionForTask(task: TaskRow): Promise<Session.Info> {
  if (!task.session_id) {
    throw new Error(`Task ${task.id} has no root session`)
  }
  const existing = (await Session.children(task.session_id))
    .filter((session) => session.kind === "orchestrator")
    .sort((left, right) => left.time.created - right.time.created)

  const terminal = existing.filter((session) => SessionStatus.get(session.id).type === "terminal")
  const reusable = existing.filter((session) => SessionStatus.get(session.id).type !== "terminal")
  const primary = reusable[0]
  if (primary) {
    if (reusable.length > 1 || terminal.length > 0) {
      log.warn("task has multiple orchestrator sessions; reusing earliest live session", {
        taskID: task.id,
        rootSessionID: task.session_id,
        primarySessionID: primary.id,
        duplicateSessionIDs: reusable.slice(1).map((session) => session.id),
        terminalSessionIDs: terminal.map((session) => session.id),
      })
    }
    await Session.touch(primary.id)
    return primary
  }

  if (terminal.length > 0) {
    log.info("creating new orchestrator session because prior sessions are terminal", {
      taskID: task.id,
      rootSessionID: task.session_id,
      terminalSessionIDs: terminal.map((session) => session.id),
    })
  }

  return Session.createNext({
    kind: "orchestrator",
    parentID: task.session_id,
    title: `Agent: ${task.title}`,
    directory: Instance.directory,
  })
}

async function sessionHasUserMessage(sessionID: string): Promise<boolean> {
  for await (const item of Message.stream(sessionID)) {
    if (item.info.role === "user") return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Standard event notes — free-form hints passed through OrchestratorEvent.note.
// Exported so every caller synthesizes the same wording; changing a note's text
// is a one-point edit. None of these strings gate control flow — the describe
// snapshot is the source of truth the orchestrator reads for every decision.
// ---------------------------------------------------------------------------

export const OrchestratorEventNote = {
  operatorMessage(input: { text: string; attachmentSummary?: string }): string {
    const lines: string[] = [input.text]
    if (input.attachmentSummary) {
      lines.push("", input.attachmentSummary)
    }
    return lines.join("\n")
  },

  retry(task: TaskRow): string {
    const previousError = parseOrchestratorTaskErrorEnvelope(task.error)?.message ?? task.error
    return `User requested retry.${previousError ? ` Previous error: ${previousError}` : ""}\nDecide how to proceed.`
  },

  noDecisionRecovery(input: { reason: string }): string {
    return [
      "This is a wake message, not a user-authored message.",
      "The previous orchestrator wake ended without a workflow decision; a visible orchestrator-decision-contract-failure artifact was recorded.",
      `Error: ${input.reason}`,
      "Read current task state and decide how to proceed.",
    ].join("\n")
  },

  replan(task: TaskRow): string {
    const previousError = parseOrchestratorTaskErrorEnvelope(task.error)?.message ?? task.error
    return (
      `User requested replan.${previousError ? ` Previous error: ${previousError}` : ""}\n` +
      "Create a fresh plan before dispatching implementation work."
    )
  },

  acceptanceRework(input: { reason: string; iteration: number; summary?: string; affectedGoalCount?: number }): string {
    const lines = [
      `Auto iteration is enabled; acceptance iteration ${input.iteration} rejected (reason=${input.reason}).`,
    ]
    if (typeof input.affectedGoalCount === "number") {
      lines.push(
        input.affectedGoalCount > 0
          ? `${input.affectedGoalCount} affected goal attempt(s) were reopened for rework; dispatch them again or escalate.`
          : "No goal attempt was reopened; inspect the integrity acceptance evidence and choose the next repair strategy from manifest evidence.",
      )
    } else {
      lines.push("Affected goal attempts were reopened for rework; dispatch them again or escalate.")
    }
    if (input.summary) lines.push("", `Detail: ${input.summary}`)
    return lines.join("\n")
  },

  stageRestart(input: { stage: "requirements" | "plan" | "executor"; reason: string; detail?: string }): string {
    const lines = [
      `Task was automatically restarted from ${input.stage}.`,
      `Reason: ${input.reason}.`,
      "Read the refreshed task context and continue from the required upstream stage.",
    ]
    if (input.detail) lines.push("", input.detail)
    return lines.join("\n")
  },
}

export function orchestratorUserText(
  task: Pick<TaskRow, "request"> & Partial<Pick<TaskRow, "id">>,
  event?: Pick<OrchestratorEvent, "note">,
): string {
  return event?.note ?? renderUserRequestSection({ heading: "# User Request", request: task.request, taskID: task.id })
}

// ---------------------------------------------------------------------------
// System prompt — split into stable instructions (cacheable) and dynamic context
// ---------------------------------------------------------------------------

/** Static instructions that never change between invocations. */
const ORCHESTRATOR_INSTRUCTIONS = ORCHESTRATOR_CORE

/**
 * Build the orchestrator system prompt as a two-part array:
 *   [0] = static instructions (stable, benefits from 1h cache TTL)
 *   [1] = dynamic context — task state, goals, budget, latest acceptance
 *         feedback, latest run result. All derived from DB state; no trigger
 *         enum branching. The optional `event.note` is the USER MESSAGE,
 *         not a prompt segment — do not thread it through here.
 */
async function buildSystemParts(
  task: TaskRow,
  _event: OrchestratorEvent | undefined,
  workflow?: MiniWorkflow,
  workflowState?: WorkflowState,
): Promise<{ parts: string[]; snapshot: TaskDesc }> {
  const profileScope = task.session_id ? { sessionID: task.session_id } : { taskID: task.id }
  const [config, projectDirectory] = await Promise.all([
    EffectiveConfig.effective(profileScope),
    EffectiveConfig.directory(profileScope),
  ])
  const instructions = appendNonExecutorSourceBoundary({
    agentID: "orchestrator",
    prompt: await PromptProfileResolver.composeAgentPrompt({
      projectDirectory,
      agentID: "orchestrator",
      base: ORCHESTRATOR_INSTRUCTIONS,
      config,
    }),
  })
  const ctx: string[] = []
  // ── Recovery discipline ──
  // Rendered as one invariant instead of a configuration mode: the orchestrator
  // reads facts and routes repair; it does not expose a retry-loop switch.
  ctx.push("## Recovery Discipline")
  ctx.push(
    "- Rejected acceptance reviews and failed terminal waves require same-task diagnosis from the rendered facts. Route product, dependency, toolchain, git-worktree, preview, and browser-runner blockers to Build; route graph or dependency-contract blockers to modify_goal or architect; ask the operator only for external, destructive, or out-of-scope blockers.",
  )
  ctx.push(
    "- Do not restart upstream merely because a Build attempt failed or a retained worktree contains partial files. Reuse `query_failed_goals`, build retry requests, modify_goal, or architect re-entry according to the proven owner, then rerun the relevant verification or integrity path.",
  )
  ctx.push("")

  // ── Follow-up task context ──
  // When an acceptance follow-up spawned this task (for any
  // reason — repair, iteration, or a queued recommendation), we attach the
  // predecessor task id, any failed-criteria evidence, and scope hints so
  // the agent knows what came before and what (if anything) must be fixed.
  const meta = (task.metadata as Record<string, unknown> | null) ?? {}
  const parentTask = typeof meta.parent_task === "string" ? meta.parent_task : undefined
  if (parentTask) {
    const failing = Array.isArray(meta.failing_metrics) ? (meta.failing_metrics as string[]) : []
    const scope = Array.isArray(meta.next_task_scope_files) ? (meta.next_task_scope_files as string[]) : []
    const depth = typeof meta.task_chain_depth === "number" ? meta.task_chain_depth : undefined
    ctx.push("## Follow-up Context")
    ctx.push(`- Predecessor task: ${parentTask}`)
    if (depth !== undefined) ctx.push(`- Task chain depth: ${depth}`)
    if (failing.length > 0) {
      ctx.push(`- Failing metrics from previous iteration: ${failing.join(", ")}`)
      ctx.push(`- Address every failing metric. Do not regress metrics that currently pass.`)
    }
    if (scope.length > 0) ctx.push(`- Suggested scope (focus area): ${scope.join(", ")}`)
    ctx.push("")
  }

  // ── Iteration trajectory ──
  // Source of truth for iteration history is engine_iteration (metric-owned).
  // We render the last few iterations' snapshots + the latest rework signal
  // (verdict summary + issues) so the assistant sees both the aggregated
  // signal AND the concrete review feedback for the most recent round.
  // The orchestrator decides next steps from this rendered snapshot directly;
  // per-metric details live on persisted review/evaluation rows, not in an
  // orchestrator tool surface.
  const iterationHistory = readHistForPrompt(task.id)
  if (iterationHistory.length > 0) {
    const RENDER_RECENT = 3
    const tail = iterationHistory.slice(-RENDER_RECENT)
    ctx.push("## Iteration Trajectory")
    ctx.push(`${iterationHistory.length} prior iteration(s). Last ${tail.length}:`)
    for (const it of tail) {
      ctx.push(
        `  - iter ${it.iteration}: arbiter=${it.arbiter_verdict}, S_k=${it.aggregate_score.toFixed(3)} (Δ=${it.delta_vs_prev.toFixed(3)}), blocking_unmet=${it.blocking_unmet_count}, open_ce=${it.open_counterexamples}, novelty=${it.novelty_score}`,
      )
    }
    // Latest review feedback comes from the most recent
    // review-verdict artifact on the task. Shown only when the
    // most recent verdict was a rejection — per spec there is no trigger
    // enum steering this block, it is derived from persistent artifacts.
    const { findLatestAcceptanceVerdictArtifact } = await import("@/engine/store")
    const latestVerdictArt = findLatestAcceptanceVerdictArtifact(task.id)
    const latestVerdictPayload = (latestVerdictArt?.payload ?? {}) as Record<string, unknown>
    const latest = latestVerdictPayload.verdict === "rejected" ? latestVerdictPayload : undefined
    if (latest) {
      ctx.push("")
      ctx.push("### Latest review feedback")
      const summary = typeof latest.summary === "string" ? latest.summary : ""
      if (summary) ctx.push(`Summary: ${summary}`)
      const details = Array.isArray(latest.rejection_details)
        ? (latest.rejection_details as Array<Record<string, string>>)
        : []
      // Single source of truth (rule 22): the human-readable issues list is
      // derived from rejection_details[].error here, not stored as a
      // separate `issues_found` field on the verdict payload.
      const issues = details.map((d) => (typeof d.error === "string" ? d.error : "")).filter((s) => s.length > 0)
      if (issues.length > 0) {
        ctx.push("Issues found:")
        for (const issue of issues) ctx.push(`  - ${issue}`)
      }
      if (details.length > 0) {
        ctx.push("Rejection details:")
        for (const d of details) {
          const filePart = d.file ? ` [${d.file}]` : ""
          const sugPart = d.suggestion ? ` → ${d.suggestion}` : ""
          ctx.push(`  - [${d.category ?? "unknown"}]${filePart}: ${d.error ?? "no description"}${sugPart}`)
        }
      }
    }
    ctx.push("")
    ctx.push(
      "You decide what to do next from the trajectory + latest review feedback above: " +
        "patch code, modify/add goals, adjust scope — based on where the loop is stuck.",
    )
    ctx.push("")
  }

  // ── Current State ──
  // The describe layer composes the task snapshot from the append-only event
  // stream (engine_goal_run chain, engine_iteration, verdict artifact,
  // decision_log, clarifications / operator notes). It does NOT read
  // engine_goal.status — derived booleans like `needs_redispatch` /
  // `is_running` come from the goal_run tip directly. This keeps the LLM's
  // world-view event-sourced: if the cache diverges, the description still
  // reflects reality, and when Phase 3 retires the cache field entirely,
  // this block keeps working unchanged.
  const snapshot = await describeTask(task.id)
  ctx.push(renderTaskDescription(snapshot))

  // ── Workflow guidance (injected as recommended path, not enforced) ──
  if (workflow && workflowState) {
    ctx.push("")
    ctx.push(renderWorkflowPrompt(workflow, workflowState, task.id))
  }

  // Run context — delivery + evaluation results for the latest run (if any).
  // Rendered on every wake from persistent DB state so the orchestrator
  // sees latest results without depending on a trigger enum to deliver them.
  // The yielded summary is framed as a sub-agent-protocol message with the
  // same per-message ceiling as a tool return; full content stays in the
  // delivery / evaluation rows referenced via the pointer.
  const latestRunID = findLatestRunForTask(task.id)?.id
  if (latestRunID) {
    const acceptance = findAcceptanceByRun(latestRunID)
    const evaluation = findEvaluationByRun(latestRunID)
    if (acceptance || evaluation) {
      const fields: Array<[string, string | string[]]> = []
      if (acceptance) {
        fields.push(["acceptance_summary", acceptance.summary])
        const changedFiles = acceptance.result?.changed_files
        if (changedFiles?.length) fields.push(["changed_files", changedFiles])
      }
      if (evaluation) {
        fields.push([`evaluation_${evaluation.verdict}`, evaluation.summary])
        const checks = evaluation.checks as Array<{ name: string; status: string; evidence?: string }> | undefined
        if (checks?.length) {
          const lines = checks.map((c) => `${c.name}=${c.status}${c.evidence ? `: ${c.evidence}` : ""}`)
          fields.push(["check_results", lines])
        }
      }

      const pointerHints: string[] = []
      if (acceptance) pointerHints.push(`acceptance row ${acceptance.id}`)
      if (evaluation) pointerHints.push(`evaluation row ${evaluation.id}`)
      const pointer = pointerHints.length > 0 ? pointerHints.join("; ") : "latest run result"

      ctx.push("")
      ctx.push(
        SubAgentProtocol.yieldResult({
          headline: `## Latest Run Result (run ${latestRunID})`,
          fields,
          pointer,
        }),
      )
    }
  }

  return { parts: [instructions, ctx.join("\n")], snapshot }
}
