/**
 * runAgentSession — the single entry point every OpenCorvus WORKER agent runs through.
 *
 * Position in the architecture: agents have one shape. Each agent module
 * (architect / requirements / build / integrity / intent-analysis /
 * frontend-design / orchestrator-children…) contributes only what is
 * genuinely agent-specific:
 *
 *   - `kind`: session.kind for routing/persistence/overlay attribution.
 *   - `core`: the agent's `prompt/core/<kind>-core.txt` contents (loaded by
 *     the caller via `import CORE from "@/prompt/core/<kind>-core.txt"`).
 *   - `buildUserPrompt`: stage-specific user message constructor.
 *   - `tools`: an `AgentToolKit` returning Zod-validated `ai.tool()` extras
 *     plus a getCollector() function. Pure stage-specific output surface.
 *   - `format` (optional): JSON-schema for the StructuredOutput tool when
 *     the agent has a terminal structured payload.
 *
 * Everything else — model resolution, child session creation, resumable
 * session-runtime wiring, SessionPrompt invocation, abort propagation,
 * stream-error capture, `config.agent.<kind>.prompt_append` user-append
 * — is centralised here.
 *
 * Per CLAUDE.md rule 24, this is the deliberate abstraction of a repeating
 * pattern. Per rule 22, no worker agent owns its own copy of this loop. Per
 * rule 1 there is no alternate default path: a missing model, an aborted signal, or a
 * collector that violates its agent's own contract throws.
 *
 * ── NON-GOAL: the orchestrator agent does NOT use this entry point ─────────
 *
 * `src/orchestrator/agent.ts::Orchestrator.processTask` is the HOST of the
 * worker-session pattern this runner abstracts, not one of its users. It
 * deliberately bypasses runAgentSession because three of its concerns
 * cannot collapse into the worker shape without forcing `if (kind ===
 * "orchestrator")` branches into the runner body — which would violate
 * rule 22 (no double source) and rule 26 (no over-engineering):
 *
 *   1. Two-part system prompt (cacheable static + dynamic per-wake context
 *      from describe / iteration history / latest verdict). The runner takes
 *      a single composed string; the orchestrator's static / dynamic split
 *      is a 1h-cache optimisation that has no analog for worker agents.
 *
 *   2. Orchestrator tools return evidence to the same reasoning turn. Worker
 *      agents terminate on the collector's contract being met (build)
 *      or stepCountIs (integrity), while the orchestrator owns the
 *      next decision itself instead of relying on a worker-style collector.
 *
 *   3. Stream errors are persisted as `engine_artifact kind="orchestrator-
 *      stream-error"` and consumed by the next wake's LLM via describe (rule
 *      23 — orchestrator decides recovery). The runner converts stream
 *      errors into thrown AgentRunError; that's the right shape for workers
 *      whose caller decides recovery, but it's the wrong shape for an agent
 *      whose recovery loop is itself driven by another LLM turn.
 *
 * The orchestrator additionally owns concurrency state (`running.set(taskID,
 * ctrl)`) and SerialQueue-driven wake scheduling — neither of which the runner
 * models, by design.
 *
 * Anyone considering "consolidating orchestrator onto runAgentSession":
 * stop. The orchestrator is the worker abstraction's HOST, not a worker.
 * If the runner ever needs to gain features for the orchestrator, you are
 * almost certainly looking at a missing capability that should be added to
 * the orchestrator's own shape (orchestrator/agent.ts), not pushed through
 * this entry point.
 * ───────────────────────────────────────────────────────────────────────────
 */
import type { LanguageModel } from "ai"
import type { TextHooks } from "@/llm/api"
import { resolveAgentModel, resolveSessionOverlay } from "@/agent/model"
import { Agent } from "@/agent/agent"
import { PromptProfile } from "@/agent/prompt-profile"
import { Provider } from "@/provider/provider"
import { EffectiveConfig } from "@/config/effective"
import { EngineConfig } from "@/engine"
import { appendInformationMissingDiagnostic } from "@/prompt/information-missing"
import { appendNonExecutorSourceBoundary } from "@/prompt/non-executor-source-boundary"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { WorkerTurnDescriptor } from "./worker-turn-descriptor"
import { SessionStatus } from "@/session/status"
import { Bus } from "@/bus"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import { Message } from "@/session/message"
import { renderToolFailureCause, type ToolFailureCause } from "@/session/tool-failure-cause"
import type { SessionKind } from "@/session/session.sql"
import type { ToolSet } from "ai"
import { AgentTrace } from "@/trace"
import { TaskContext } from "@/task-context"
import type { AgentReport, AgentReportContext } from "@/agent/report"
import { SessionContext } from "@/session/context"
import { recordToolExecuteError } from "@/engine/persist"
import { cancelSessionPromptInScope } from "@/engine/cancellation-scope"
import {
  claimStageContinuationRequest,
  markStageContinuationClaimFailed,
  markStageContinuationConsumed,
  type AgentSessionContinuation,
} from "@/engine/stage-continuation"

const log = Log.create({ service: "agent-runner" })

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Stage-specific tool kit. `tools` is the tool surface registered on the
 * child session's runtime contract. `getCollector()` returns whatever the
 * agent collected during the run; the runner does not interpret it.
 */
export interface AgentToolKit<C> {
  tools: ToolSet
  getCollector: () => C
  buildReport: (context?: AgentReportContext) => AgentReport
}

/**
 * Optional structured-output (JSON schema) for agents whose final tool
 * call terminates the loop with a typed payload that needs to be returned
 * outside the collector (e.g. requirements / intent-analysis summaries).
 */
export interface StructuredFormat {
  schema: Record<string, unknown>
  retryCount?: number
  validate?: (output: unknown) => string | undefined | Promise<string | undefined>
}

export interface RunAgentSessionInput<C> {
  /** session.kind — determines how the overlay renders the child session
   *  and how session_id downstream readers route. Constrained to the
   *  SessionKind union; the runner does not accept free-form strings
   *  (rule 25). */
  kind: SessionKind
  /** Agent name for model resolution / system-prompt composition /
   *  SessionPrompt.agent dispatch. Defaults to `kind`. Supply a separate
   *  value when session.kind and agent name diverge. */
  agentName?: string
  /** Loaded core prompt text from `prompt/core/<kind>-core.txt`. */
  core: string
  /** Display title for the child session (overlay shows this). */
  sessionTitle: string
  /** Override `directory` on the child session. Defaults to
   *  `Instance.directory`. Used by agents that run inside a worktree
   *  (currently just the build agent) so the session + its tools root
   *  at the worktree path, not the primary. */
  sessionDirectory?: string
  /** Existing session to continue. Used by build retries, which must append
   *  one incremental user message to the original build conversation instead
   *  of creating a replacement child session. When set, the runner validates
   *  the row's kind/goal/directory against this invocation before prompting. */
  existingSessionID?: string
  /** Explicit visible continuation of a worker session after a protocol-level
   *  finalizer miss. The runner reopens this session, claims the matching
   *  continuation artifact, appends one visible recovery user message, and
   *  installs the fresh runtime contract for the same finalizer. */
  continuation?: AgentSessionContinuation
  /** Parent session id (orchestrator wake child / pipeline parent). */
  parentSessionID?: string
  /** Goal this session belongs to (per-goal build / planner / evaluator).
   *  Stamped onto the SessionTable row so `sessionGoalID()` returns it
   *  without inferring from parent chains. The protocol bridge
   *  (server/routes/task-message-protocol-bridge.ts:enrichProperties) reads
   *  this column to stamp goalID on every emitted message / part event,
   *  which is what the overlay tree-writer needs to route the session
   *  card under its goal phase instead of leaking it as a top-level card.
   *  Per-task agents (orchestrator, requirements, architect, integrity, …)
   *  leave this undefined. */
  goalID?: string
  /** Task id for cache stickiness + per-agent model resolution. */
  taskID?: string
  /** Explicit model override; bypasses `resolveAgentModel`. */
  model?: { providerID: string; modelID: string }
  /** Cancellation. The runner cancels the in-flight prompt + rethrows. */
  signal?: AbortSignal
  /** Optional liveness hook. */
  onStatus?: (summary: string) => void | Promise<void>
  /** Fires AFTER the child session is created and BEFORE the prompt call
   *  begins. Return value is a disposer that runs after the prompt
   *  completes (success or failure). Use for stage-specific lifecycle
   *  instrumentation: "Started" event emission, heartbeat tickers,
   *  stream-chunk forwarders. The runner owns the session; the hook is
   *  strictly observer-scope, not control-scope. */
  onSessionCreated?: (
    session: Awaited<ReturnType<typeof Session.createNext>>,
  ) => Promise<{ dispose: () => void }> | { dispose: () => void } | void
  /** Attempt identity installed on SessionRuntimeContract and mirrored into
   *  the user message envelope so SessionLoop can reject stale retry
   *  collectors before model contact. */
  runtimeContract?: {
    goalRunID?: string
    attemptID?: string
    contractKind?: "stage-attempt" | "orchestrator-wake"
    /** Controls Model Context Protocol tool loading for this worker session. */
    includeMcpTools?: boolean
    /** Uses only runtime contract tools, skipping registry and Model Context Protocol tools. */
    exactTools?: boolean
  }
  /** Additional per-run registry/runtime tool switches merged after defaults. */
  toolSwitches?: Record<string, boolean>
  /** Stage-specific extra tool surface + collector. */
  toolKit: AgentToolKit<C>
  /** Stage-specific user-message text. */
  buildUserPrompt: () => string | Promise<string>
  /** Optional ai-sdk Message.Part array assembled by the caller — used by
   *  agents that emit multimodal parts (image attachments etc.). When
   *  provided, the runner sends these instead of synthesising a single
   *  text part from `buildUserPrompt`. The text from `buildUserPrompt`
   *  is still built and prepended as the first part so the prompt
   *  user-text is never silently dropped. */
  buildUserParts?: () => Promise<SessionPrompt.PromptInput["parts"]>
  /** When set, registers a JSON-schema StructuredOutput format. The
   *  resulting `Message.Assistant.structured` value is returned to the
   *  caller alongside the collector. */
  format?: StructuredFormat
  /** Required terminal collector tool for stages whose structured facts are
   *  already captured by tool calls and whose final action is an explicit
   *  validator/submit tool. The session loop keeps work tools available until
   *  `shouldExposeOnlyTerminalTool`, then pins the provider to this terminal tool. */
  terminalTool?: {
    toolName: string
    isSatisfied: (collector: C) => boolean
    shouldExposeOnlyTerminalTool: (collector: C) => boolean
  }
  /** When true, treat `core` as the already-composed system prompt and
   *  skip the runner's config-append pass. */
  rawSystemPrompt?: boolean
  /** Legacy passthrough; not wired after the SessionPrompt migration. */
  stream?: TextHooks
}

export interface RunAgentSessionOutput<C> {
  /** Child session created for this run. */
  session: Awaited<ReturnType<typeof Session.createNext>>
  /** Final assistant message returned by SessionPrompt. */
  finalMessage: Message.WithParts
  /** Stage-specific collector after the run completes. */
  collector: C
  /** Structured-output payload when `format` was provided. Undefined
   *  when the agent did not register a format. */
  structured: unknown | undefined
  /** Stream errors captured during the run. */
  streamErrors: Array<{ reason: string; name?: string }>
  /** Resolved model the run used. */
  model: { providerID: string; modelID: string; id: string }
}

function recordAgentTraceReportForSession(
  session: Awaited<ReturnType<typeof Session.createNext>>,
  input: Parameters<typeof AgentTrace.recordAgentReport>[0],
): void {
  SessionContext.provide(session, () => {
    AgentTrace.recordAgentReport(input)
  })
}

function errorReport(message: string): AgentReport {
  const text = message.trim() || "agent failed"
  return { summary: text, detail: text }
}

function buildTraceReport<C>(toolKit: AgentToolKit<C>, context?: AgentReportContext): AgentReport {
  try {
    return toolKit.buildReport(context)
  } catch (err) {
    if (context?.error) return errorReport(context.error)
    throw err
  }
}

function finalTextFromMessage(message: Message.WithParts | undefined): string | undefined {
  const text = message?.parts
    ?.filter((part) => part.type === "text")
    .map((part) => (part as { text?: string }).text?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n")
  return text || undefined
}

const BUILD_DEFAULT_DISABLED_TOOLS = [
  "task",
  "webfetch",
  "websearch",
  "external_code_search",
  "memory",
  "planner",
  "goal_report",
] as const

export function promptToolSwitchesForAgentRun(input: {
  extraToolNames: string[]
  kind?: SessionKind
}): Record<string, boolean> {
  const switches: Record<string, boolean> = Object.fromEntries(input.extraToolNames.map((name) => [name, true]))
  if (input.kind !== "build") return switches

  switches.skill = true
  for (const toolName of BUILD_DEFAULT_DISABLED_TOOLS) {
    switches[toolName] = false
  }
  return switches
}

function isReferenceModality(mime: string): boolean {
  const normalized = mime.toLowerCase()
  return normalized.startsWith("image/") || normalized === "application/pdf"
}

export function shouldFailUnreadableBuildReference(input: {
  kind: SessionKind
  userText: string
  droppedFileParts: Array<{ mime: string }>
}): boolean {
  return (
    input.kind === "build" &&
    input.userText.includes("## Visual Reference Contract (binding for this dispatch)") &&
    input.droppedFileParts.some((part) => isReferenceModality(part.mime))
  )
}

// ---------------------------------------------------------------------------
// Error types — every failure surfaces as AgentRunError so callers do not
// need to know about kind-specific exception classes.
// ---------------------------------------------------------------------------

export class AgentRunError extends Error {
  /**
   * Marks the wrapped failure as deterministically non-retryable. Set when
   * the underlying provider error carries `isRetryable: false` (e.g. HTTP
   * 400 schema rejections — retrying the identical request guarantees the
   * same response and only burns budget). `runAgentSessionWithRetry`'s
   * classifier short-circuits to fail-fast when this is true.
   */
  public readonly nonRetryable: boolean
  constructor(
    public readonly kind: SessionKind,
    message: string,
    options?: ErrorOptions & { nonRetryable?: boolean },
  ) {
    super(`[${kind}] ${message}`, options)
    this.name = "AgentRunError"
    this.nonRetryable = options?.nonRetryable === true
  }
}

/**
 * Pure assertion that converts a finished `finalMessage.info.error` into a
 * thrown AgentRunError when the error must abort the agent run. Returns
 * `null` when no failure should be raised — i.e. no error stamped, or the
 * error is `Message.AbortedError` (soft cancellation already represented
 * by SessionStatus terminal "aborted").
 *
 * Extracted from runAgentSession so the conversion logic (provider error
 * shape → AgentRunError, isRetryable propagation) can be exercised by unit
 * tests without standing up SessionPrompt / Provider mocks.
 *
 * Spec: surface hard LLM failures so the orchestrator's catch path runs.
 * Root cause of the intent-analysis "秒退" incident on tsk_ddf383614
 * (2026-04-30) — see runAgentSession callsite below.
 */
export function buildHardErrorFromFinalMessage(input: {
  kind: SessionKind
  agentName: string
  finalMessage: {
    info: { role: string; error?: unknown }
    parts?: ReadonlyArray<Message.Part>
  }
}): AgentRunError | null {
  const { kind, agentName, finalMessage } = input
  if (finalMessage.info.role !== "assistant") return null
  const err = finalMessage.info.error
  if (!err) {
    const partFailure = (toolErrorPartsFromFinalMessage(finalMessage)[0]?.state as Message.ToolStateError | undefined)
      ?.failure
    if (!partFailure) return null
    return agentRunErrorFromToolFailure({ kind, agentName, failure: partFailure })
  }
  if (Message.AbortedError.isInstance(err as Error)) return null
  const errName = (err as { name?: string }).name ?? "UnknownError"
  const errMessage = (err as { data?: { message?: string } }).data?.message ?? errName
  // Provider errors carry an `isRetryable` flag (AI SDK APIError surfaces
  // it through `.data.isRetryable`). Honour it so retry helpers do not
  // loop deterministically-failing requests.
  const isRetryable = (err as { data?: { isRetryable?: boolean } }).data?.isRetryable
  // TerminalToolMissingError is deterministic: the same prompt produces the
  // same finish=stop without the tool call. Treat it as non-retryable so
  // outer helpers do not restart a whole child session for the same protocol
  // miss; visible continuation handling belongs at the orchestrator boundary.
  const isTerminalToolMissing = Message.TerminalToolMissingError.isInstance(err as Error)
  return new AgentRunError(kind, `LLM error during ${agentName}: ${errName}: ${errMessage}`, {
    nonRetryable: isRetryable === false || isTerminalToolMissing,
    // Preserve the original error as cause so downstream catch blocks
    // (e.g. build/agent.ts converting missing-terminal into a typed
    // BuildAgentContractError) can instanceof-check rather than
    // keyword-match the message string (rule 20).
    cause: err as Error,
  })
}

function agentRunErrorFromToolFailure(input: {
  kind: SessionKind
  agentName: string
  failure: ToolFailureCause
}): AgentRunError {
  return new AgentRunError(
    input.kind,
    `Tool error during ${input.agentName}: ${renderToolFailureCause(input.failure)}`,
    {
      nonRetryable:
        input.failure.classification === "tool-input-invalid" || input.failure.classification === "processor-contract",
      cause: new Error(renderToolFailureCause(input.failure)),
    },
  )
}

export function toolErrorPartsFromFinalMessage(finalMessage: {
  info: { role: string }
  parts?: ReadonlyArray<Message.Part>
}): Message.ToolPart[] {
  if (finalMessage.info.role !== "assistant") return []
  return (finalMessage.parts ?? []).filter(
    (part): part is Message.ToolPart => part.type === "tool" && part.state.status === "error",
  )
}

async function recordToolExecuteErrorsForFinalMessage(input: {
  taskID?: string
  runID?: string | null
  goalRunID?: string | null
  finalMessage: Message.WithParts
}) {
  if (!input.taskID) return
  const now = Date.now()
  for (const part of toolErrorPartsFromFinalMessage(input.finalMessage)) {
    await recordToolExecuteError({
      taskID: input.taskID,
      runID: input.runID,
      goalRunID: input.goalRunID,
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
}

/**
 * Pure check: does the final assistant message carry an INFORMATION
 * MISSING XML diagnostic block? When the operator flips
 * `debug.fail_on_information_missing` (default OFF), the host appends
 * the diagnostic section to every agent's system prompt at runtime
 * (`appendInformationMissingDiagnostic`); the prompt then instructs the
 * agent to emit this block (and ONLY this block) when invocation
 * context drops required information, and the host treats the block
 * as a non-retryable run failure. Spec — 2026-05-07
 * INFORMATION MISSING debug toggle; `prompt/information-missing.ts`
 * owns the diagnostic text. The companion test
 * `test/agent/information-missing-diagnostic.test.ts` pins (a) the
 * helper / constant surface and (b) the contract that .txt core
 * prompts must NOT carry the section so the toggle stays binary.
 *
 * Detection is a typed-tag substring (rule 20 boundary): the tag
 * `<INFORMATION MISSING>` is a structured marker the prompt asks the
 * LLM to emit verbatim — it is NOT an LLM natural-language phrase, so
 * substring containment is the same shape as XML element matching, not
 * keyword-match rule logic.
 */
export function messageHasInformationMissing(finalMessage: {
  info: { role: string }
  parts: ReadonlyArray<{ type?: string; text?: string }>
}): boolean {
  if (finalMessage.info.role !== "assistant") return false
  for (const part of finalMessage.parts) {
    if (part.type !== "text") continue
    if (typeof part.text !== "string") continue
    if (part.text.includes("<INFORMATION MISSING>")) return true
  }
  return false
}

/**
 * Returns the verbatim INFORMATION MISSING XML block from the first
 * matching text part, or null when no part carries the marker. Used
 * by the runner to log the agent's diagnostic before failing the run.
 */
export function extractInformationMissingBlock(finalMessage: {
  info: { role: string }
  parts: ReadonlyArray<{ type?: string; text?: string }>
}): string | null {
  if (finalMessage.info.role !== "assistant") return null
  for (const part of finalMessage.parts) {
    if (part.type !== "text") continue
    if (typeof part.text !== "string") continue
    const start = part.text.indexOf("<INFORMATION MISSING>")
    if (start === -1) continue
    const end = part.text.indexOf("</INFORMATION MISSING>", start)
    if (end === -1) return part.text.slice(start)
    return part.text.slice(start, end + "</INFORMATION MISSING>".length)
  }
  return null
}

export function buildInformationMissingError(input: {
  kind: SessionKind
  agentName: string
  block: string
}): AgentRunError {
  return new AgentRunError(input.kind, `INFORMATION MISSING detected in ${input.agentName}: ${input.block}`, {
    nonRetryable: true,
    cause: new Error(input.block),
  })
}

export function terminalToolMissingErrorFor(input: {
  finalMessage: { info: { role: string; error?: unknown } }
  toolName: string
}): { message: string } | null {
  if (input.finalMessage.info.role !== "assistant") return null
  const err = input.finalMessage.info.error
  if (!Message.TerminalToolMissingError.isInstance(err as Error)) return null
  const data = (err as { data?: { toolName?: string; message?: string } }).data
  if (data?.toolName !== input.toolName) return null
  return { message: data.message ?? `missing terminal tool ${input.toolName}` }
}

export function buildUnsatisfiedTerminalToolError(input: {
  kind: SessionKind
  agentName: string
  toolName: string
}): AgentRunError {
  const message =
    `Agent ${input.agentName} ended without satisfying terminal tool ${input.toolName}. ` +
    `The agent must call ${input.toolName} exactly once with the final payload before finishing.`
  const terminalError = new Message.TerminalToolMissingError({
    message,
    toolName: input.toolName,
    retries: 0,
  })
  return new AgentRunError(input.kind, `LLM error during ${input.agentName}: TerminalToolMissingError: ${message}`, {
    nonRetryable: true,
    cause: terminalError,
  })
}

async function recordAgentErrorForOrchestrator(input: {
  taskID?: string
  goalID?: string
  sessionID: string
  agentName: string
  kind: SessionKind
  error: unknown
  streamErrors: Array<{ reason: string; name?: string }>
}) {
  if (!input.taskID) return
  const message = input.error instanceof Error ? input.error.message : String(input.error)
  const cause =
    input.error instanceof Error && input.error.cause instanceof Error ? input.error.cause.message : undefined
  const streamLines = input.streamErrors.slice(-3).map((e) => `- ${e.name ? `[${e.name}] ` : ""}${e.reason}`)
  const lines = [
    `Agent session failed before producing a successful result.`,
    `agent=${input.agentName}`,
    `kind=${input.kind}`,
    `session_id=${input.sessionID}`,
    `error=${message}`,
  ]
  if (cause) lines.push(`cause=${cause}`)
  if (streamLines.length > 0) {
    lines.push("stream_errors:")
    lines.push(...streamLines)
  }
  const { createDecisionLog } = await import("@/decision-log")
  createDecisionLog(input.taskID).append({
    phase: "agent_error",
    goalID: input.goalID,
    key: `${input.agentName}_session_error`,
    value: lines.join("\n"),
    reason: `model-visible agent failure; session=${input.sessionID}; ` + `kind=${input.kind}`,
  })
}

function buildContinuationUserPrompt(input: AgentSessionContinuation): string {
  return [
    "Continue the existing worker session for a protocol-level finalizer miss.",
    "",
    `continuation_artifact_id: ${input.artifactID}`,
    `continuation_kind: ${input.kind}`,
    `required_finalizer: ${input.finalizerName}`,
    input.failedAssistantMessageID ? `failed_assistant_message_id: ${input.failedAssistantMessageID}` : undefined,
    "",
    `Reason: ${input.reason}`,
    "",
    "Use the visible transcript and the current runtime tools for this same worker contract.",
    `Complete any missing structured collector work, then call ${input.finalizerName} exactly once.`,
    "Do not restart scope, invent a new task, or summarize in prose instead of the required finalizer.",
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n")
}

// ---------------------------------------------------------------------------
// Core runner
// ---------------------------------------------------------------------------

export async function runAgentSession<C>(input: RunAgentSessionInput<C>): Promise<RunAgentSessionOutput<C>> {
  const { kind } = input
  const agentName = input.agentName ?? kind
  if (input.continuation && input.existingSessionID && input.continuation.sessionID !== input.existingSessionID) {
    throw new AgentRunError(
      kind,
      `continuation session ${input.continuation.sessionID} does not match existingSessionID ${input.existingSessionID}`,
    )
  }
  const existingSessionID = input.continuation?.sessionID ?? input.existingSessionID
  const configScope = input.taskID
    ? { taskID: input.taskID }
    : existingSessionID
      ? { sessionID: existingSessionID }
      : input.parentSessionID
        ? { sessionID: input.parentSessionID }
        : undefined

  if (input.signal?.aborted) {
    throw new AgentRunError(kind, "aborted before model resolution")
  }

  // ── 1. Resolve model ─────────────────────────────────────────────────
  let model: Awaited<ReturnType<typeof resolveAgentModel>> | undefined
  let modelResolutionError: unknown
  if (input.model) {
    const config = await EffectiveConfig.effective(configScope)
    model = await Provider.getModel(input.model.providerID, input.model.modelID, { config }).catch((err) => {
      modelResolutionError = err
      return undefined
    })
  } else {
    model = await resolveAgentModel(agentName, configScope).catch((err) => {
      modelResolutionError = err
      return undefined
    })
  }
  if (!model) {
    const detail =
      modelResolutionError instanceof Error
        ? modelResolutionError.message
        : modelResolutionError !== undefined
          ? String(modelResolutionError)
          : input.model
            ? `${input.model.providerID}/${input.model.modelID} did not resolve`
            : `agent ${agentName} did not resolve a default model`
    throw new AgentRunError(
      kind,
      `no LLM model available: ${detail}`,
      modelResolutionError instanceof Error ? { cause: modelResolutionError } : undefined,
    )
  }

  if (input.signal?.aborted) {
    throw new AgentRunError(kind, "aborted after model resolution")
  }

  // ── 2. Compose the system prompt ─────────────────────────────────────
  // Static parts (core + user override) come from
  // `composeSystemPrompt`; the live task context block is appended last so
  // every stage agent sees the same task / goals / decision-log surface
  // without having to memory.search for it (rule 23 / rule 22).
  const composed = input.rawSystemPrompt
    ? { prompt: input.core }
    : await composeSystemPrompt(agentName, input.core, configScope)
  const liveContext = input.taskID ? TaskContext.snapshot(input.taskID) : ""
  // INFORMATION MISSING debug toggle: when on, append the diagnostic block
  // to the system prompt; the matching host-side detection further down
  // exits the process when any agent emits <INFORMATION MISSING>. Toggle
  // is exposed via overlay GeneralPanel → PATCH /config →
  // opencorvus.jsonc. Default off — runs go through unchanged in
  // production. Spec — 2026-05-07 INFORMATION MISSING debug toggle.
  const debugCfg = (await EngineConfig.get()).debug
  const baseSystemPrompt = [composed.prompt, liveContext.trim().length > 0 ? liveContext : undefined]
    .filter((section): section is string => typeof section === "string" && section.trim().length > 0)
    .join("\n\n")
  const systemPrompt = debugCfg.fail_on_information_missing
    ? appendInformationMissingDiagnostic(baseSystemPrompt)
    : baseSystemPrompt

  // ── 3. Build user prompt parts ───────────────────────────────────────
  const userText = input.continuation ? buildContinuationUserPrompt(input.continuation) : await input.buildUserPrompt()
  let parts: SessionPrompt.PromptInput["parts"]
  if (!input.continuation && input.buildUserParts) {
    parts = await input.buildUserParts()
  } else {
    parts = [{ type: "text", text: userText }]
  }
  // Capability gate — drop multimodal file parts the resolved model cannot
  // accept on input. Without this, every agent that calls
  // AttachmentStore.inlineFileParts (build / acceptance / architect /
  // intent-analysis / integrity / requirements / frontend-design) would
  // forward image / pdf / audio / video bytes to a
  // text-only coding endpoint (e.g. dashscope coding) where the provider
  // wrapper either silently strips them OR replaces them with an inline
  // "ERROR: Cannot read …" text part (see provider/transform.ts
  // unsupportedParts). Both outcomes leave the agent reasoning about
  // visual context it never received. We strip upstream so the prompt
  // accurately reflects what the agent will actually see; the
  // provider-layer replacement remains as a safety net for direct
  // SessionPrompt.prompt callers that bypass the runner.
  const fileParts = parts.filter((p): p is typeof p & { type: "file" } => p.type === "file")
  if (fileParts.length > 0) {
    const before = fileParts.length
    parts = parts.filter((p) => {
      if (p.type !== "file") return true
      const mime = (p.mime || "").toLowerCase()
      let modality: "image" | "audio" | "video" | "pdf" | undefined
      if (mime.startsWith("image/")) modality = "image"
      else if (mime === "application/pdf") modality = "pdf"
      else if (mime.startsWith("audio/")) modality = "audio"
      else if (mime.startsWith("video/")) modality = "video"
      if (!modality) return true
      const accepted = model.capabilities.input[modality]
      if (!accepted) {
        log.warn("dropping multimodal part — model lacks input capability", {
          agent: agentName,
          kind,
          mime,
          filename: p.filename,
          modality,
          providerID: model.providerID,
          modelID: model.id,
        })
      }
      return accepted
    })
    const dropped = before - parts.filter((p) => p.type === "file").length
    if (dropped > 0) {
      const filteredReferences = fileParts.filter((part) => isReferenceModality(part.mime))
      if (shouldFailUnreadableBuildReference({ kind, userText, droppedFileParts: filteredReferences })) {
        throw new AgentRunError(
          kind,
          [
            "visual_reference_unreadable:",
            `${model.providerID}/${model.id} does not accept required visual reference input.`,
            `filtered=${filteredReferences.map((part) => part.filename ?? part.mime).join(", ")}`,
            "Build cannot report success without reading the reference pixels; choose a model/tool path with image/pdf input or remove the visual reference contract.",
          ].join(" "),
          { nonRetryable: true },
        )
      }
      // Append an explicit text marker so the model is aware it was sent
      // attachments it can't see. Prevents silent confabulation: the
      // prompt's textual inventory may still list filenames, and without
      // this marker the model would not know those files weren't actually
      // delivered as bytes.
      parts.push({
        type: "text",
        text:
          `\n\n[runner] ${dropped} multimodal attachment(s) were filtered out because this model ` +
          `(${model.providerID}/${model.id}) does not accept the corresponding input modality. ` +
          `You can see filenames in the textual inventory above but NOT the file contents — do not pretend you have.`,
      })
    }
  }
  parts = parts.map((p) => ({ ...p, id: Identifier.ascending("part") }))

  // ── 4. Create or reopen child session ────────────────────────────────
  await input.onStatus?.(`${kind} starting`)
  const session = existingSessionID
    ? await Session.get(existingSessionID)
    : await Session.createNext({
        kind,
        parentID: input.parentSessionID,
        goalID: input.goalID,
        title: input.sessionTitle,
        directory: input.sessionDirectory ?? Instance.directory,
      })
  if (existingSessionID) {
    if (session.kind !== kind) {
      throw new AgentRunError(kind, `existing session ${session.id} has kind=${session.kind}, expected ${kind}`)
    }
    if ((session.goalID ?? undefined) !== (input.goalID ?? undefined)) {
      throw new AgentRunError(
        kind,
        `existing session ${session.id} has goalID=${session.goalID ?? "<unset>"}, expected ${input.goalID ?? "<unset>"}`,
      )
    }
    const expectedDirectory = input.sessionDirectory ?? Instance.directory
    if (session.directory !== expectedDirectory) {
      throw new AgentRunError(
        kind,
        `existing session ${session.id} has directory=${session.directory}, expected ${expectedDirectory}`,
      )
    }
  }

  // ── 5. Stream-error capture + abort propagation ──────────────────────
  // Bus payload is the NamedError shape from Message.fromError().toObject():
  // `{ name, data: { message, ... } }`. Reading `error.message` directly came
  // back undefined and lost the actual provider/stream cause (e.g. 429 body,
  // ECONNRESET, context-overflow detail). Unwrap data.message first so sub-
  // agent (build/architect/...) failure reasons are honest, matching the
  // orchestrator/agent.ts unwrap.
  const streamErrors: Array<{ reason: string; name?: string }> = []
  const errorUnsub = Bus.subscribe(Session.Event.Error, (evt) => {
    const props = evt.properties as {
      sessionID: string
      error: { name?: string; message?: string; data?: { message?: string } }
    }
    if (props.sessionID !== session.id) return
    const reason = props.error?.data?.message ?? props.error?.message ?? "unknown error"
    streamErrors.push({ reason, name: props.error?.name })
  })

  const abortPrompt = () => {
    cancelSessionPromptInScope({ session, taskID: input.taskID, handle: `${kind}.agent.signal` })
  }
  input.signal?.addEventListener("abort", abortPrompt, { once: true })

  // ── 6. Invoke SessionPrompt with the agent's extra tools ─────────────
  const enableMap = {
    ...promptToolSwitchesForAgentRun({
      extraToolNames: Object.keys(input.toolKit.tools),
      kind,
    }),
    ...(input.toolSwitches ?? {}),
  }
  if (input.terminalTool && !(input.terminalTool.toolName in input.toolKit.tools)) {
    throw new AgentRunError(
      kind,
      `terminal tool ${input.terminalTool.toolName} is not registered in the agent tool kit`,
    )
  }
  if (input.continuation && !input.taskID) {
    throw new AgentRunError(kind, `continuation ${input.continuation.artifactID} requires taskID`)
  }
  const continuationClaim = input.continuation
    ? claimStageContinuationRequest({
        taskID: input.taskID!,
        artifactID: input.continuation.artifactID,
        sessionID: session.id,
        finalizerName: input.continuation.finalizerName,
      })
    : undefined

  log.info(`${agentName} agent starting`, {
    kind,
    sessionID: session.id,
    parentSessionID: input.parentSessionID,
    taskID: input.taskID,
    modelID: model.id,
    toolNames: Object.keys(input.toolKit.tools),
  })

  const lifecycleDisposable =
    !existingSessionID && input.onSessionCreated ? await input.onSessionCreated(session) : undefined

  let finalMessage: Message.WithParts | undefined
  let collector: C | undefined
  const terminalToolContract = input.terminalTool
    ? {
        toolName: input.terminalTool.toolName,
        isSatisfied: () => input.terminalTool!.isSatisfied(input.toolKit.getCollector()),
        shouldExposeOnlyTerminalTool: () =>
          input.terminalTool!.shouldExposeOnlyTerminalTool(input.toolKit.getCollector()),
      }
    : undefined
  const descriptor = WorkerTurnDescriptor.create({
    sessionID: session.id,
    payload: {
      agent: agentName,
      roleContractID: agentName,
      model: { providerID: model.providerID, modelID: model.api.id },
      prompt: {
        systemMode: "complete",
        rawSystemPrompt: input.rawSystemPrompt === true,
      },
      tools: {
        enabled: Object.keys(input.toolKit.tools).sort(),
        switches: enableMap,
        terminal: input.terminalTool?.toolName,
      },
      output: {
        format: input.format ? "json_schema" : "text",
        resultMode: "reply",
      },
      workflow: {
        taskID: input.taskID,
        goalID: input.goalID,
        goalRunID: input.runtimeContract?.goalRunID,
        attemptID: input.runtimeContract?.attemptID,
        sessionKind: kind,
      },
    },
  })
  SessionPrompt.setSessionRuntimeContract(session.id, {
    identity: {
      sessionID: session.id,
      agentKind: agentName,
      workerTurnDescriptorID: descriptor.id,
      workerTurnDescriptorHash: descriptor.hash,
      goalID: input.goalID,
      goalRunID: input.runtimeContract?.goalRunID,
      attemptID: input.runtimeContract?.attemptID,
      contractKind: input.runtimeContract?.contractKind ?? "stage-attempt",
      installedAt: Date.now(),
    },
    tools: input.toolKit.tools,
    system: [systemPrompt],
    systemMode: "complete",
    terminalToolContract,
    structuredOutputGuard: input.format?.validate,
    stream: input.stream,
    includeMcpTools: input.runtimeContract?.includeMcpTools,
    exactTools: input.runtimeContract?.exactTools,
  })
  try {
    try {
      const promptOnce = async (promptParts: typeof parts = parts) => {
        const promptArgs: Parameters<typeof SessionPrompt.prompt>[0] = {
          sessionID: session.id,
          model: { providerID: model!.providerID, modelID: model!.api.id },
          agent: agentName,
          system: systemPrompt,
          systemMode: "complete",
          tools: enableMap,
          extra: {
            taskID: input.taskID,
            ...(continuationClaim
              ? {
                  continuation: {
                    artifactID: continuationClaim.artifactID,
                    claimID: continuationClaim.claimID,
                    finalizerName: continuationClaim.finalizerName,
                    kind: continuationClaim.kind,
                  },
                }
              : {}),
            workerTurnDescriptor: {
              id: descriptor.id,
              hash: descriptor.hash,
            },
          },
          parts: promptParts as Parameters<typeof SessionPrompt.prompt>[0]["parts"],
        }
        if (input.format) {
          promptArgs.format = {
            type: "json_schema",
            schema: input.format.schema,
            retryCount: input.format.retryCount ?? 2,
          }
        }
        if (continuationClaim) {
          let appended = false
          try {
            const userMessage = (await SessionPrompt.prompt({
              ...promptArgs,
              messageID: continuationClaim.messageID,
              noReply: true,
            })) as Message.WithParts
            appended = true
            markStageContinuationConsumed({
              taskID: input.taskID!,
              artifactID: continuationClaim.artifactID,
              claimID: continuationClaim.claimID,
              messageID: userMessage.info.id,
            })
          } catch (err) {
            if (!appended) {
              markStageContinuationClaimFailed({
                taskID: input.taskID!,
                artifactID: continuationClaim.artifactID,
                claimID: continuationClaim.claimID,
                error: err instanceof Error ? err.message : String(err),
              })
            }
            throw err
          }
          finalMessage = (await SessionContext.provide(session, () =>
            Instance.provide({
              directory: session.directory,
              fn: () => SessionPrompt.loop({ sessionID: session.id }),
            }),
          )) as Message.WithParts
          return
        }
        finalMessage = (await SessionPrompt.prompt(promptArgs)) as Message.WithParts
      }
      await promptOnce()
    } finally {
      errorUnsub()
      input.signal?.removeEventListener("abort", abortPrompt)
      if (lifecycleDisposable && typeof lifecycleDisposable === "object" && "dispose" in lifecycleDisposable) {
        try {
          lifecycleDisposable.dispose()
        } catch {
          /* best-effort disposer */
        }
      }
    }

    if (input.signal?.aborted) {
      throw new AgentRunError(kind, "aborted during prompt")
    }
    if (!finalMessage) {
      throw new AgentRunError(kind, "SessionPrompt.prompt returned no message")
    }
    // INFORMATION MISSING signal — when the operator has flipped
    // `debug.fail_on_information_missing`, the host injected the
    // diagnostic section into the system prompt above and now runs
    // detection on the final assistant message. The agent emits
    // `<INFORMATION MISSING><item>...</item></INFORMATION MISSING>`
    // (and ONLY that block) when this invocation arrived with required
    // context dropped. The host treats the block as a fatal diagnostic
    // and fails the current run so the operator immediately sees the
    // upstream-context drop signal instead of a long log of guessed-default
    // work. When the toggle is off, this guard is a
    // no-op — production runs are unaffected. Spec — 2026-05-07
    // INFORMATION MISSING debug toggle; detection helpers pinned via
    // test/agent/information-missing-detection.test.ts.
    if (debugCfg.fail_on_information_missing && messageHasInformationMissing(finalMessage)) {
      const block = extractInformationMissingBlock(finalMessage) ?? "<INFORMATION MISSING>...</INFORMATION MISSING>"
      log.error("INFORMATION MISSING signal — failing run", {
        agentName,
        kind,
        sessionID: session.id,
        block: block.slice(0, 1200),
      })
      // eslint-disable-next-line no-console
      console.error(
        `\n[FATAL] INFORMATION MISSING detected in ${agentName} (${kind}) stream — failing run.\n` +
          `Session: ${session.id}\n` +
          `${block}\n`,
      )
      throw buildInformationMissingError({ kind, agentName, block })
    }
    // Propagate hard LLM errors (HTTP 4xx/5xx, schema-rejected payloads,
    // missing terminal-tool calls). The processor stamps them onto the
    // assistant message via `processor.message.error` and returns "stop"
    // without throwing, which historically let runAgentSession return
    // success with an empty collector + structured=undefined — every
    // worker tool wrapper then projected invented defaults forward as if
    // the agent had succeeded (rule 7 violation; root cause of the
    // intent-analysis "秒退" silent-completed incident on tsk_ddf383614,
    // 2026-04-30). Surface the error here so the orchestrator-tool catch
    // path (trackStepComplete failed=true + decision_log abort entry)
    // and `runAgentSessionWithRetry` retry logic actually run.
    //
    // Aborted errors are NOT propagated as failures: `Message.AbortedError`
    // is a soft cancellation (operator pressed stop, parent goal aborted)
    // already represented by SessionStatus terminal "aborted". The signal
    // check above already converted that into a thrown AgentRunError when
    // the abort propagated; this guard is for the edge case where the
    // assistant message was stamped before the signal observed.
    const hardError = buildHardErrorFromFinalMessage({
      kind,
      agentName,
      finalMessage,
    })
    if (hardError) {
      await recordToolExecuteErrorsForFinalMessage({
        taskID: input.taskID,
        goalRunID: input.runtimeContract?.goalRunID,
        finalMessage,
      })
      throw hardError
    }

    collector = input.toolKit.getCollector()
    if (input.terminalTool && !input.terminalTool.isSatisfied(collector)) {
      throw buildUnsatisfiedTerminalToolError({
        kind,
        agentName,
        toolName: input.terminalTool.toolName,
      })
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await recordAgentErrorForOrchestrator({
      taskID: input.taskID,
      goalID: input.goalID,
      sessionID: session.id,
      agentName,
      kind,
      error: err,
      streamErrors,
    })
    if (AgentTrace.isEnabled() && input.taskID) {
      recordAgentTraceReportForSession(session, {
        sessionID: session.id,
        parentSessionID: input.parentSessionID,
        taskID: input.taskID,
        agentName,
        kind: "agent_report_failure",
        collector: (() => {
          try {
            return input.toolKit.getCollector()
          } catch {
            return undefined
          }
        })(),
        streamErrors,
        error: errorMessage,
        report: buildTraceReport(input.toolKit, { error: errorMessage }),
      })
    }
    // Subagent dispatch boundary: surface terminal to the overlay the moment
    // the runner finishes (success or failure), independent of when the
    // session's actor eventually closes. Without this, every orchestrator-
    // dispatched subagent (requirements / architect / frontend-design /
    // integrity / build / deliver / refine / ...) stays at `idle` (no
    // checkmark) once it enters standby, even though its single dispatch
    // is unambiguously done from the caller's perspective.
    SessionStatus.set(session.id, {
      type: "terminal",
      reason: input.signal?.aborted ? "aborted" : "error",
      error: errorMessage,
    })
    throw err
  }

  // ── 7. Return collector + structured output ──────────────────────────
  const structured = input.format ? (finalMessage.info as Message.Assistant).structured : undefined
  collector ??= input.toolKit.getCollector()

  SessionStatus.set(session.id, { type: "terminal", reason: "completed" })

  const finalText = finalTextFromMessage(finalMessage)

  log.info(`${agentName} agent finished`, {
    kind,
    sessionID: session.id,
    streamErrors: streamErrors.length,
    hasStructured: structured !== undefined,
  })

  if (AgentTrace.isEnabled() && input.taskID) {
    recordAgentTraceReportForSession(session, {
      sessionID: session.id,
      parentSessionID: input.parentSessionID,
      taskID: input.taskID,
      agentName,
      kind: "agent_report",
      collector,
      structured,
      streamErrors,
      finalText,
      report: buildTraceReport(input.toolKit, { structured, finalText }),
    })
  }

  return {
    session,
    finalMessage,
    collector,
    structured,
    streamErrors,
    model: { providerID: model.providerID, modelID: model.api.id, id: model.id },
  }
}

// ---------------------------------------------------------------------------
// Retry helper — wraps `runAgentSession` for agents whose successful run is
// gated by a stateful collector and that
// need a fresh child session + fresh tool kit per attempt so collector state
// does not bleed across retries.
//
// Per rule 22 / rule 24: any agent that needs retry MUST go through this
// helper. The retry logic does not live inside individual agent modules —
// previously the retired acceptance path owned its own copy of this loop, which was the only
// blocker preventing other stage agents from gaining bounded retry without
// duplicating that loop verbatim.
//
// Single-shot agents (architect, requirements, integrity,
// frontend-design, intent-analysis, build) keep calling `runAgentSession`
// directly — no retry is needed for any of them at this time, and forcing
// them through this wrapper would just add a useless `maxRetries: 1`
// boilerplate (rule 26 — no over-engineering).
// ---------------------------------------------------------------------------

export interface RetryDecision {
  /** True when the attempt produced a usable collector. False forces another
   *  attempt (up to maxRetries). */
  ok: boolean
  /** Human-readable reason captured into lastError when ok=false. Surfaces
   *  in the AgentRunError thrown after attempts are exhausted. */
  reason?: string
  /**
   * When true, the attempt's failure is structurally non-recoverable: the
   * outer retry loop MUST NOT spawn another session. Used by callers whose
   * in-session protocol checks have already proven the just-finished attempt
   * violated a deterministic contract — restarting the session from scratch
   * only burns LLM time on a guaranteed-equivalent failure.
   *
   * The retry helper still honours `ok=true` short-circuit — `terminal`
   * is only consulted on `ok=false`.
   */
  terminal?: boolean
}

export interface RunAgentSessionWithRetryInput<C> extends Omit<RunAgentSessionInput<C>, "toolKit"> {
  /** Maximum attempts. attempt 1 is the first call; attempt 2..N are retries.
   *  Must be >= 1; pass 1 to disable retry while still using this entry
   *  point uniformly. */
  maxRetries: number
  /** Fresh tool kit per attempt. Called once before each `runAgentSession`
   *  dispatch so collector state and any tool-internal mutable state does
   *  not bleed across retries. */
  toolKitFactory: () => AgentToolKit<C>
  /** Decide whether the just-finished attempt's collector + streamErrors
   *  + terminal structured output constitute success. `ok=true` ends the
   *  loop and returns; `ok=false` triggers a retry with `reason` captured
   *  into lastError. The `structured` argument is the value of
   *  `out.structured` for this attempt — defined when the agent's
   *  `format` is set and the model emitted a schema-valid StructuredOutput
   *  call, undefined otherwise. Agents that gate on a terminal structured
   *  payload check it here so a model that satisfies collector tools but
   *  skips the agent's explicit terminal collector tool
   *  triggers a retry instead of silently passing. */
  isComplete: (
    collector: C,
    streamErrors: Array<{ reason: string; name?: string }>,
    structured: unknown,
  ) => RetryDecision
}

export interface RunAgentSessionWithRetryOutput<C> extends RunAgentSessionOutput<C> {
  /** 1-indexed count of attempts actually taken (always <= maxRetries). */
  attempts: number
}

export type AttemptClassification =
  | { action: "ok" }
  | { action: "retry"; reason: string }
  | { action: "fail-fast"; reason: string }

/**
 * NamedError-shaped errors (from `@opencorvus-ai/util/error`) store their
 * human-readable message inside `data.message` and use the error's own
 * `.message` slot for the type tag. The retry classifier is interested in
 * the operator-readable message, so unwrap it when present and fall back
 * to `Error.message` for plain `Error` instances.
 */
function namedErrorReason(err: Error): string {
  const data = (err as { data?: { message?: unknown } }).data
  if (data && typeof data.message === "string" && data.message.length > 0) {
    return data.message
  }
  return err.message
}

/**
 * Pure classification of a just-finished attempt's outcome — see
 * specs/new-arch/2026-04-28-structured-output-systemic-fix.md §F.
 *
 * Rules:
 *
 *   1. Thrown `Message.PromptBudgetOverflowError` /
 *      `Message.ToolSchemaBudgetError` are deterministic structural
 *      failures (system prompt + tool schemas exceed budget; compaction
 *      cannot recover). Re-running the same session against the same
 *      model is guaranteed to fail the same way — fail-fast.
 *
 *   2. A non-budget throw is treated as transient (network / provider
 *      hiccup / unexpected internal error) and retried until
 *      `maxRetries`. The thrown error's message is captured so the
 *      operator sees what went wrong even when retries succeed.
 *
 *   3. `streamErrors.length > 0` is a transient session-stream issue
 *      (provider-side) — retry.
 *
 *   4. `isComplete({ok:true})` → ok.
 *
 *   5. `isComplete({ok:false, terminal:true})` → fail-fast. This is
 *      the contract by which a caller signals that the completed attempt has
 *      already proven a deterministic protocol failure; an outer retry would
 *      repeat the same shape.
 *
 *   6. `isComplete({ok:false, terminal:false})` → retry.
 *
 * The classifier never inspects retry counts; the caller stops the loop
 * when `attempt >= maxRetries`.
 */
export function classifyAttemptOutcome(input: {
  thrownError?: Error
  streamErrors?: Array<{ reason: string; name?: string }>
  decision?: RetryDecision
}): AttemptClassification {
  if (input.thrownError) {
    if (
      Message.PromptBudgetOverflowError.isInstance(input.thrownError) ||
      Message.ToolSchemaBudgetError.isInstance(input.thrownError)
    ) {
      return { action: "fail-fast", reason: namedErrorReason(input.thrownError) }
    }
    // Provider-marked non-retryable errors (HTTP 400 schema rejections,
    // unsupported tool_choice, etc.) — retrying the same request hits the
    // same wall. Surface to the caller's catch path immediately instead of
    // burning maxRetries on a guaranteed failure.
    if (input.thrownError instanceof AgentRunError && input.thrownError.nonRetryable) {
      return { action: "fail-fast", reason: input.thrownError.message }
    }
    return { action: "retry", reason: input.thrownError.message }
  }
  if (input.streamErrors && input.streamErrors.length > 0) {
    const first = input.streamErrors[0]
    return {
      action: "retry",
      reason: `session stream error: ${first.name ?? "error"}: ${first.reason}`,
    }
  }
  const decision = input.decision
  if (!decision) {
    return { action: "fail-fast", reason: "no isComplete decision available" }
  }
  if (decision.ok) return { action: "ok" }
  if (decision.terminal) {
    return { action: "fail-fast", reason: decision.reason ?? "terminal isComplete=false" }
  }
  return { action: "retry", reason: decision.reason ?? "isComplete returned ok=false" }
}

export async function runAgentSessionWithRetry<C>(
  input: RunAgentSessionWithRetryInput<C>,
): Promise<RunAgentSessionWithRetryOutput<C>> {
  if (input.maxRetries < 1) {
    throw new AgentRunError(input.kind, `runAgentSessionWithRetry: maxRetries must be >= 1, got ${input.maxRetries}`)
  }
  const agentLabel = input.agentName ?? input.kind
  let lastError: Error | undefined
  let lastOutput: RunAgentSessionOutput<C> | undefined
  let lastReport: AgentReport | undefined

  for (let attempt = 1; attempt <= input.maxRetries; attempt++) {
    if (input.signal?.aborted) {
      throw new AgentRunError(input.kind, "aborted before retry attempt")
    }
    if (attempt > 1) {
      log.info(`${agentLabel} agent retrying`, {
        attempt,
        reason: lastError?.message,
      })
    }
    const kit = input.toolKitFactory()
    let out: RunAgentSessionOutput<C> | undefined
    let thrownError: Error | undefined
    try {
      out = await runAgentSession({ ...input, toolKit: kit })
    } catch (err) {
      thrownError = err instanceof Error ? err : new Error(String(err))
      lastReport = errorReport(thrownError.message)
      const aborted = input.signal?.aborted || (err instanceof Error && err.name === "AbortError")
      if (aborted) throw thrownError
    }
    if (out) {
      lastOutput = out
      lastReport = buildTraceReport(kit, {
        structured: out.structured,
        finalText: finalTextFromMessage(out.finalMessage),
      })
    }

    const decision = out ? input.isComplete(out.collector, out.streamErrors, out.structured) : undefined
    const classification = classifyAttemptOutcome({
      thrownError,
      streamErrors: out?.streamErrors,
      decision,
    })

    if (classification.action === "ok") {
      if (!out) {
        // Defensive: classifier should never return ok without an out, but
        // type-narrow safely if it ever does.
        throw new AgentRunError(input.kind, "classifier returned ok without a runAgentSession output")
      }
      if (AgentTrace.isEnabled() && input.taskID) {
        recordAgentTraceReportForSession(out.session, {
          sessionID: out.session.id,
          parentSessionID: input.parentSessionID,
          taskID: input.taskID,
          agentName: agentLabel,
          kind: "agent_report_retry_final",
          collector: out.collector,
          structured: out.structured,
          streamErrors: out.streamErrors,
          attempts: attempt,
          finalText: finalTextFromMessage(out.finalMessage),
          report: buildTraceReport(kit, {
            structured: out.structured,
            finalText: finalTextFromMessage(out.finalMessage),
          }),
        })
      }
      return { ...out, attempts: attempt }
    }

    if (classification.action === "fail-fast") {
      lastError = thrownError ?? new Error(classification.reason)
      // Either the throw was a deterministic budget overflow (re-running
      // can't fix it — caller needs to see the breakdown), or the caller's
      // isComplete signalled `terminal:true` for a deterministic contract
      // failure.
      // Either way the retry loop must stop now (rule 1: surface the real
      // cause, do not loop a useless action). For thrown deterministic
      // budget overflows we re-throw the original error type so the
      // operator sees PromptBudgetOverflowError / ToolSchemaBudgetError
      // (with full breakdown) instead of a generic AgentRunError.
      if (
        thrownError &&
        (Message.PromptBudgetOverflowError.isInstance(thrownError) ||
          Message.ToolSchemaBudgetError.isInstance(thrownError))
      ) {
        log.error(`${agentLabel}: deterministic budget overflow, fail-fast`, {
          attempt,
          error: thrownError.name,
          message: thrownError.message,
        })
        throw thrownError
      }
      // Provider-marked non-retryable failures (e.g. deepseek-reasoner
      // HTTP 400 "tool_choice not supported"). Re-throw so the caller's
      // catch path sees the actual cause instead of a "all retries
      // exhausted" wrap that hides the root.
      if (thrownError instanceof AgentRunError && thrownError.nonRetryable) {
        log.error(`${agentLabel}: provider non-retryable, fail-fast`, {
          attempt,
          message: thrownError.message,
        })
        throw thrownError
      }
      log.error(`${agentLabel}: attempt terminal, fail-fast`, {
        attempt,
        reason: classification.reason,
      })
      break
    }

    // classification.action === "retry"
    lastError = thrownError ?? new Error(classification.reason)
    log.warn(`${agentLabel}: attempt failed, will retry`, {
      attempt,
      reason: classification.reason,
    })
  }

  if (AgentTrace.isEnabled() && input.taskID && lastOutput) {
    recordAgentTraceReportForSession(lastOutput.session, {
      sessionID: lastOutput.session.id,
      parentSessionID: input.parentSessionID,
      taskID: input.taskID,
      agentName: agentLabel,
      kind: "agent_report_retry_final",
      collector: lastOutput.collector,
      structured: lastOutput.structured,
      streamErrors: lastOutput.streamErrors,
      attempts: input.maxRetries,
      error: lastError?.message ?? `agent did not complete after ${input.maxRetries} attempts`,
      report:
        lastReport ?? errorReport(lastError?.message ?? `agent did not complete after ${input.maxRetries} attempts`),
    })
  }

  if (!lastOutput) {
    throw new AgentRunError(input.kind, lastError?.message ?? "agent failed before producing output")
  }
  throw new AgentRunError(input.kind, lastError?.message ?? `agent did not complete after ${input.maxRetries} attempts`)
}

// ---------------------------------------------------------------------------
// System-prompt composition — single source of truth.
//
// Order:
//   1. core prompt (from `prompt/core/<kind>-core.txt`)
//   2. active prompt profile overlay
//   3. user-config append: `config.agent.<kind>.prompt_append`, when present
//
// Per rule 22 / rule 25 this is the only path. Agents do not roll their
// own composition.
// ---------------------------------------------------------------------------

async function composeSystemPrompt(
  agentName: string,
  core: string,
  scope: { taskID?: string; sessionID?: string } | undefined,
): Promise<{ prompt: string }> {
  const config = await EffectiveConfig.effective(scope)
  const overlay = await resolveSessionOverlay(scope)
  const baseAgent = await Agent.get(agentName, { config })
  const effectiveAgent = baseAgent ? Agent.resolveSessionAgent(baseAgent, overlay) : undefined
  const userAppend =
    effectiveAgent?.promptAppend ?? (config.agent as Record<string, any> | undefined)?.[agentName]?.prompt_append
  const prompt = appendNonExecutorSourceBoundary({
    agentID: agentName,
    prompt: PromptProfile.composeAgentPrompt({ agentID: agentName, base: core, userAppend, config }),
  })
  return { prompt }
}

// ---------------------------------------------------------------------------
// Re-export — agents may need the LanguageModel type when accepting an
// optional model override at the call site. Keeping this here so agent
// modules import a single place for runner+model types.
// ---------------------------------------------------------------------------

export type { LanguageModel }
