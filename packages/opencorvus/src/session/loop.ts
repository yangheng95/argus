import z from "zod"
import Ajv2020 from "ajv/dist/2020"
import type { AnySchema, ErrorObject } from "ajv"
import { Identifier } from "../id/id"
import { Message } from "./message"
import { Session } from "."
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { type Tool as AITool, tool, jsonSchema, type ToolExecutionOptions, asSchema, type ModelMessage } from "ai"
import type { TextHooks } from "@/llm/api"
import { SessionCompaction } from "./compaction"
import { ContextBudget } from "./context-budget"
import { Instance } from "../project/instance"
import { AttachmentStore } from "@/storage/attachment-store"
import { materializeMcpToolResult } from "@/mcp/materialize"
import { Bus } from "../bus"
import { ProviderTransform } from "../provider/transform"
import { SystemPrompt } from "./system"
import { EffectiveConfig } from "@/config/effective"
import { InstructionPrompt } from "./instruction"
import { Plugin } from "../plugin"
import MAX_STEPS from "../session/prompt/max-steps.txt"
import { defer } from "../util/defer"
import { ToolRegistry } from "../tool/registry"
import { Env } from "../env"
import { MCP } from "../mcp"
import { ulid } from "ulid"
import { NamedError } from "@opencorvus-ai/util/error"
import { fn } from "@/util/fn"
import { SessionProcessor } from "./processor"
import { TaskTool } from "@/tool/task"
import { Tool } from "@/tool/tool"
import { PermissionNext } from "@/permission/next"
import { SessionStatus } from "./status"
import { ensureTitle } from "./prompt/title"
import { Truncate } from "@/tool/truncation"
import { MemoryInjection } from "@/memory/injection"
import { Scratchpad } from "@/memory/scratchpad"
import { TaskPlan } from "@/memory/task-plan"
import { SessionSummary } from "./summary"
import { SessionPromptState } from "./prompt/state"
import { muteAISdkWarnings } from "@/runtime/shims"
import { Config } from "@/config/config"
import { decodeDataUrlBase64 } from "./text-mime"
import { normalizeToolInput } from "./tool-input-norm"
import { toolFailureCauseFromUnknown } from "./tool-failure-cause"
import { SessionRuntimeContractMissingError } from "@/orchestrator/direct-reply"
import {
  renderPreTerminalReflectionPrompt,
  renderPreTerminalReflectionReminder,
} from "@/prompt/fragments/pre-terminal-reflection"

muteAISdkWarnings()

const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

export function terminalToolSystemPrompt(toolName: string): string {
  return [
    `IMPORTANT: The current task is ready for terminal handoff. You MUST call the ${toolName} tool to provide your final response.`,
    renderPreTerminalReflectionReminder(toolName),
    `Do NOT respond with plain text - you MUST call ${toolName} with input matching its schema.`,
  ].join(" ")
}

// Terminal-call recovery runs through provider-level toolChoice where possible.
// If the provider/model still stops in prose, the current assistant message is
// stamped with a typed error and the caller sees the contract violation.

export namespace SessionLoop {
  const { log, state, cancel, finish, flushCallbacks, start, resume } = SessionPromptState

  type StrictAITool = AITool & { strict?: boolean }

  function strictTool(input: AITool): AITool {
    return { ...(input as StrictAITool), strict: true } as AITool
  }

  export type SessionRuntimeContractKind = "stage-attempt" | "orchestrator-wake"

  export interface SessionRuntimeContractIdentity {
    sessionID: string
    agentKind: string
    contractKind: SessionRuntimeContractKind
    goalID?: string
    goalRunID?: string
    attemptID?: string
    installedAt: number
  }

  export interface TerminalToolContract {
    toolName: string
    isSatisfied: () => boolean
    shouldExposeOnlyTerminalTool: () => boolean
  }

  export type StructuredOutputGuard = (output: unknown) => string | undefined | Promise<string | undefined>

  export interface SessionRuntimeContract {
    identity: SessionRuntimeContractIdentity
    tools?: Record<string, AITool>
    terminalToolContract?: TerminalToolContract
    structuredOutputGuard?: StructuredOutputGuard
    stream?: TextHooks
  }

  // ---------------------------------------------------------------------------
  // Session-scoped runtime contract
  //
  // Worker child sessions can be resumed later by appending another user
  // message to the same session. The resumed loop must see the same extra
  // tools / terminal contract / structured-output guard as the original run;
  // otherwise the session is no longer the same agent contract and "resume"
  // degenerates into a bare chat turn that has lost its stage tools.
  //
  // We therefore keep one persistent IN-MEMORY runtime contract per sessionID
  // for resumable worker sessions. The contract is the only source for
  // stage-scoped tools, terminal handoff state, structured-output guards, and
  // stream hooks. It carries identity so retries can reject stale collectors
  // before contacting the model.
  //
  // Crash recovery is still not supported here: these contracts close over
  // live collectors and tool functions, so they cannot be serialized into DB.
  // ---------------------------------------------------------------------------
  const sessionRuntimeContracts = new Map<string, SessionRuntimeContract>()
  const preTerminalReflectionSeen = new Set<string>()

  export function setSessionRuntimeContract(
    sessionID: string,
    contract: SessionRuntimeContract | undefined,
  ): void {
    if (
      !contract ||
      ((!contract.tools || Object.keys(contract.tools).length === 0) &&
        !contract.terminalToolContract &&
        !contract.structuredOutputGuard &&
        !contract.stream &&
        contract.identity.contractKind !== "orchestrator-wake")
    ) {
      sessionRuntimeContracts.delete(sessionID)
      clearPreTerminalReflectionForSession(sessionID)
      return
    }
    if (contract.identity.sessionID !== sessionID) {
      throw new Error(
        `SessionRuntimeContract identity mismatch: contract session ${contract.identity.sessionID} cannot be installed on ${sessionID}`,
      )
    }
    sessionRuntimeContracts.set(sessionID, contract)
  }

  export function getSessionRuntimeContract(sessionID: string): SessionRuntimeContract | undefined {
    return sessionRuntimeContracts.get(sessionID)
  }

  export function clearSessionRuntimeContract(sessionID: string): void {
    sessionRuntimeContracts.delete(sessionID)
    clearPreTerminalReflectionForSession(sessionID)
  }

  function clearPreTerminalReflectionForSession(sessionID: string): void {
    const prefix = `${sessionID}:`
    for (const key of preTerminalReflectionSeen) {
      if (key.startsWith(prefix)) preTerminalReflectionSeen.delete(key)
    }
  }

  export function takePreTerminalReflection(input: {
    sessionID: string
    agentName: string
    finalizerName: string
    markerID?: string | number
  }): { output: string; title: string; metadata: object } | undefined {
    const contract = sessionRuntimeContracts.get(input.sessionID)
    const marker = input.markerID ?? contract?.identity.installedAt ?? "session"
    const key = `${input.sessionID}:${marker}:${input.finalizerName}`
    if (preTerminalReflectionSeen.has(key)) return undefined
    preTerminalReflectionSeen.add(key)
    const prompt = renderPreTerminalReflectionPrompt({
      agentName: input.agentName,
      terminalToolName: input.finalizerName === "StructuredOutput" ? undefined : input.finalizerName,
      usesStructuredOutput: input.finalizerName === "StructuredOutput",
    })
    return {
      title: "Pre-terminal Reflection Required",
      output: [
        "This terminal submission is paused for the required pre-submit reflection.",
        "",
        prompt ?? renderPreTerminalReflectionReminder(input.finalizerName),
        "",
        `After checking and correcting any mismatch, call ${input.finalizerName} again with the final payload.`,
      ].join("\n"),
      metadata: {
        preTerminalReflection: true,
        agentName: input.agentName,
        finalizerName: input.finalizerName,
      },
    }
  }

  function runtimeContractTools(sessionID: string): Record<string, AITool> {
    return sessionRuntimeContracts.get(sessionID)?.tools ?? {}
  }

  const runtimeContractRequiredAgentKinds = new Set([
    "architect",
    "build",
    "delivery",
    "design-analyst",
    "integrity",
    "intent-analysis",
    "orchestrator",
    "requirements",
  ])

  export function agentKindRequiresRuntimeContract(agentKind: string | undefined): boolean {
    return !!agentKind && runtimeContractRequiredAgentKinds.has(agentKind)
  }

  export function validateSessionRuntimeContractForContinuation(input: {
    sessionID: string
    sessionKind?: string
    expectedAgentKind?: string
    expectedContractKind?: SessionRuntimeContractKind
    expectedGoalID?: string
    expectedGoalRunID?: string
    expectedAttemptID?: string
    requireRuntimeContract?: boolean
    rejectSatisfiedTerminal?: boolean
  }): SessionRuntimeContract | undefined {
    const contract = sessionRuntimeContracts.get(input.sessionID)
    if (!contract) {
      if (input.requireRuntimeContract) {
        const agentKind = input.expectedAgentKind ?? input.sessionKind
        throw new SessionRuntimeContractMissingError({
          message: `SessionRuntimeContract missing for ${input.sessionID}; ${agentKind ?? "this session"} cannot continue without a runtime tool contract`,
          sessionID: input.sessionID,
          ...(agentKind ? { agentKind } : {}),
          reason: "missing",
        })
      }
      return undefined
    }

    const identity = contract.identity
    if (identity.sessionID !== input.sessionID) {
      throw new Error(
        `SessionRuntimeContract stale for ${input.sessionID}: identity session is ${identity.sessionID}`,
      )
    }

    const expectedAgentKind = input.expectedAgentKind ?? input.sessionKind
    if (expectedAgentKind && identity.agentKind !== expectedAgentKind) {
      throw new Error(
        `SessionRuntimeContract agent mismatch for ${input.sessionID}: expected ${expectedAgentKind}, found ${identity.agentKind}`,
      )
    }
    if (input.expectedContractKind && identity.contractKind !== input.expectedContractKind) {
      throw new Error(
        `SessionRuntimeContract kind mismatch for ${input.sessionID}: expected ${input.expectedContractKind}, found ${identity.contractKind}`,
      )
    }
    if (input.expectedGoalID && identity.goalID !== input.expectedGoalID) {
      throw new Error(
        `SessionRuntimeContract goal mismatch for ${input.sessionID}: expected ${input.expectedGoalID}, found ${identity.goalID ?? "<unset>"}`,
      )
    }
    if (input.expectedGoalRunID && identity.goalRunID !== input.expectedGoalRunID) {
      throw new Error(
        `SessionRuntimeContract goal_run mismatch for ${input.sessionID}: expected ${input.expectedGoalRunID}, found ${identity.goalRunID ?? "<unset>"}`,
      )
    }
    if (input.expectedAttemptID && identity.attemptID !== input.expectedAttemptID) {
      throw new Error(
        `SessionRuntimeContract attempt mismatch for ${input.sessionID}: expected ${input.expectedAttemptID}, found ${identity.attemptID ?? "<unset>"}`,
      )
    }
    if (input.rejectSatisfiedTerminal !== false && contract.terminalToolContract?.isSatisfied()) {
      const agentKind = input.expectedAgentKind ?? input.sessionKind
      throw new SessionRuntimeContractMissingError({
        message: `SessionRuntimeContract terminal collector is already satisfied for ${input.sessionID}; install a fresh contract before continuing`,
        sessionID: input.sessionID,
        ...(agentKind ? { agentKind } : {}),
        reason: "terminal_satisfied",
      })
    }
    return contract
  }

  function runtimeContractExpectationFromExtra(
    extra: Record<string, any> | undefined,
  ): {
    expectedContractKind?: SessionRuntimeContractKind
    expectedGoalRunID?: string
    expectedAttemptID?: string
  } {
    const runtime = extra?.runtimeContract
    if (!runtime || typeof runtime !== "object") return {}
    const contractKind = runtime.contractKind
    return {
      expectedContractKind:
        contractKind === "stage-attempt" || contractKind === "orchestrator-wake"
          ? contractKind
          : undefined,
      expectedGoalRunID: typeof runtime.goalRunID === "string" ? runtime.goalRunID : undefined,
      expectedAttemptID: typeof runtime.attemptID === "string" ? runtime.attemptID : undefined,
    }
  }

  // ---------------------------------------------------------------------------
  // Ephemeral per-session step-finish hook (phase 3-a-4 of specs/new-arch/16-unified-teardown.md)
  //
  // Agents that dispatch work via a tool and then want to stop the LLM
  // generation once the tool has acknowledged the dispatch (the orchestrator
  // pattern: `dispatch_goal` fires, the signal aborts the active turn) need
  // a hook that runs after every LLM turn inside the session loop. AI SDK's
  // `onStepFinish` gives this at the stream level; SessionLoop does not
  // expose it natively, so callers register a process-local callback the
  // loop fires after each `processTurn` returns.
  //
  // Scope rules mirror the runtime contract: in-memory only, one entry per
  // sessionID, replaced wholesale on repeat calls, cleared on sentinel/
  // callback completion, and NOT persisted across process restart.
  // ---------------------------------------------------------------------------
  export interface StepHookEvent {
    /** 1-indexed turn number within this session's current prompt cycle. */
    step: number
    /** Outcome of the turn processTurn just completed. */
    turn: "stop" | "continue"
  }
  export type StepHook = (event: StepHookEvent) => void | Promise<void>

  const ephemeralStepHooks = new Map<string, StepHook>()

  /** Register a step-finish hook for a session. Passing `undefined` clears. */
  export function setStepHook(sessionID: string, hook: StepHook | undefined): void {
    if (!hook) {
      ephemeralStepHooks.delete(sessionID)
      return
    }
    ephemeralStepHooks.set(sessionID, hook)
  }

  /** Internal: fire the registered step hook, swallowing errors. */
  async function fireStepHook(sessionID: string, event: StepHookEvent): Promise<void> {
    const hook = ephemeralStepHooks.get(sessionID)
    if (!hook) return
    try {
      await hook(event)
    } catch (err) {
      log.warn("step-hook threw; loop continues", {
        sessionID,
        step: event.step,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /** Convenience wrapper: set the hook, run `fn`, always clear afterwards
   *  regardless of whether `fn` resolved or threw. */
  export async function withStepHook<T>(
    sessionID: string,
    hook: StepHook,
    fn: () => Promise<T>,
  ): Promise<T> {
    setStepHook(sessionID, hook)
    try {
      return await fn()
    } finally {
      setStepHook(sessionID, undefined)
    }
  }

  // ---------------------------------------------------------------------------
  // StructuredOutput guard
  //
  // Some agents need semantic invariants that JSON Schema cannot express. The
  // build agent is the concrete case: `status="passed"` is valid only after
  // the in-session `merge_back` tool has completed successfully. The guard is
  // part of SessionRuntimeContract because it closes over live stage state and
  // must be replaced together with the attempt's tool collector.
  // ---------------------------------------------------------------------------

  const structuredOutputAjv = new Ajv2020({ allErrors: true, strict: false })

  type StructuredOutputPayloadValidator = (
    value: Record<string, unknown>,
  ) => { success: true } | { success: false; error: string }

  function isStructuredOutputPayload(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
  }

  function structuredOutputPayloadType(value: unknown): string {
    if (value === undefined) return "undefined"
    if (value === null) return "null"
    if (Array.isArray(value)) return "array"
    return typeof value
  }

  function formatJsonSchemaErrors(errors: ErrorObject[] | null | undefined): string {
    if (!errors?.length) return "schema validator rejected the payload"
    return errors
      .map((error) => `${error.instancePath || "<root>"} ${error.message ?? "is invalid"}`)
      .join("; ")
  }

  function compileStructuredOutputPayloadValidator(schema: unknown): StructuredOutputPayloadValidator {
    const validate = structuredOutputAjv.compile(schema as AnySchema)
    return (value) => {
      if (validate(value)) return { success: true }
      return { success: false, error: formatJsonSchemaErrors(validate.errors) }
    }
  }

  export function validateStructuredOutputPayload(
    payload: unknown,
    validator: StructuredOutputPayloadValidator,
  ): { ok: true; value: Record<string, unknown> } | { ok: false; reason: string } {
    if (!isStructuredOutputPayload(payload)) {
      return {
        ok: false,
        reason: `StructuredOutput payload must be a JSON object; received ${structuredOutputPayloadType(payload)}`,
      }
    }

    const validation = validator(payload)
    if (!validation.success) {
      return {
        ok: false,
        reason: `StructuredOutput payload did not match the registered JSON schema: ${validation.error}`,
      }
    }

    return { ok: true, value: payload }
  }

  function getTerminalToolContract(sessionID: string): TerminalToolContract | undefined {
    return sessionRuntimeContracts.get(sessionID)?.terminalToolContract
  }

  function getStructuredOutputGuard(sessionID: string): StructuredOutputGuard | undefined {
    return sessionRuntimeContracts.get(sessionID)?.structuredOutputGuard
  }

  /**
   * Decide whether the just-finished assistant turn should enter the
   * StructuredOutput recovery channel (stamp `StructuredOutputError` on the
   * current assistant message and stop).
   *
   * Rules — see specs/new-arch/2026-04-28-structured-output-systemic-fix.md §D:
   *
   *   1. Only the json_schema output contract requires a terminal
   *      StructuredOutput call; for `text` output we never stamp.
   *   2. If the model already finalised by calling StructuredOutput
   *      (validated args reached `onSuccess`), the contract is satisfied.
   *   3. If a provider/runtime error is already recorded on this turn, do
   *      NOT overwrite it with a structured-miss error — the retry layer
   *      must see the original cause.
   *   4. A turn that ends with `finish=tool-calls` is the model still
   *      executing its tool flow (e.g. the integrity reviewer between two
   *      `submit_<dim>_verdict` calls). It is NOT a structured miss; we
   *      let the loop continue so the model can keep working toward
   *      StructuredOutput.
   *   5. A turn that ends with `finish=unknown` means the stream returned
   *      without a recognised finish reason (typically a mid-stream cut /
   *      provider-side hiccup). The loop already continues naturally on
   *      that path; we do NOT escalate it to a structured miss. The
   *      previous gate excluded this reason for the same reason; Phase D
   *      preserves that behaviour.
   *   6. Any other non-tool-call finish (`stop / length / content-filter /
   *      error / etc.`) without a StructuredOutput call IS a miss →
   *      enter recovery.
   */
  export type TurnFinishReason = string | undefined
  export function shouldEnterStructuredOutputRecovery(input: {
    finish: TurnFinishReason
    structuredCalled: boolean
    formatType: "text" | "json_schema" | undefined
    hasExistingError: boolean
  }): boolean {
    if (input.formatType !== "json_schema") return false
    if (input.structuredCalled) return false
    if (input.hasExistingError) return false
    if (!input.finish) return false
    if (input.finish === "tool-calls") return false
    if (input.finish === "unknown") return false
    return true
  }

  export function shouldEnterTerminalToolRecovery(input: {
    finish: TurnFinishReason
    satisfied: boolean
    hasExistingError: boolean
  }): boolean {
    if (input.satisfied) return false
    if (input.hasExistingError) return false
    if (!input.finish) return false
    if (input.finish === "tool-calls") return false
    if (input.finish === "unknown") return false
    return true
  }

  export function shouldStopAfterTerminalTool(input: {
    terminalToolPresent: boolean
    satisfied: boolean
  }): boolean {
    return input.terminalToolPresent && input.satisfied
  }

  /**
   * Compose a one-line context snippet describing what an assistant turn
   * actually emitted. Appended onto recovery error messages so callers see
   * concrete evidence of what the model did instead of the generic
   * "model did not call X" placeholder.
   *
   * Snippet shape: `tools=[a,b,c]; text="first 200 chars…"; finish=stop`.
   * Fields are omitted when they are empty so the snippet stays terse.
   */
  async function summarizeAssistantTurn(
    messageID: string,
    finish: TurnFinishReason,
  ): Promise<string> {
    const parts = await Message.parts(messageID).catch((err) => {
      log.warn("recovery snippet: failed to load assistant parts", { messageID, error: err })
      return [] as Message.Part[]
    })
    const toolNames: string[] = []
    let textBody = ""
    for (const part of parts) {
      if (part.type === "tool") {
        const name = (part as Message.ToolPart).tool
        if (name) toolNames.push(name)
        continue
      }
      if (part.type === "text") {
        const text = (part as Message.TextPart).text ?? ""
        if (text.trim() && !textBody) textBody = text.trim()
      }
    }
    const segments: string[] = []
    if (toolNames.length > 0) segments.push(`tools=[${toolNames.join(",")}]`)
    if (textBody) {
      const snippet = textBody.length > 200 ? `${textBody.slice(0, 200)}…` : textBody
      segments.push(`text=${JSON.stringify(snippet)}`)
    }
    if (toolNames.length === 0 && !textBody) segments.push("turn produced no tool calls or text")
    if (finish) segments.push(`finish=${finish}`)
    return segments.join("; ")
  }

  /**
   * Predictive-compaction decision constants (Phase C).
   *
   * `TOOL_SCHEMA_BUDGET_RATIO_DEFAULT` — fraction of usable budget that
   * tool schemas alone must NOT exceed. Compaction never touches tool
   * definitions, so this is a structural guard: when an agent's tool
   * surface alone overruns the model, we fail fast rather than retry an
   * impossible turn. Override via env `OPENCORVUS_TOOL_SCHEMA_BUDGET_RATIO`.
   *
   * `COMPACTION_MIN_RESIDUE_CHARS` — even after a perfect compaction the
   * request still carries the active user message + a minimum-viable
   * summary in the message body. We use ~6 KB as a conservative residue
   * estimate (≈ 1.5 K tokens) for the post-compaction sizing check.
   */
  const TOOL_SCHEMA_BUDGET_RATIO_DEFAULT = 0.5
  const COMPACTION_MIN_RESIDUE_CHARS = 6_000

  function toolSchemaBudgetRatio(): number {
    const raw = Number(Env.get("OPENCORVUS_TOOL_SCHEMA_BUDGET_RATIO") ?? "")
    return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : TOOL_SCHEMA_BUDGET_RATIO_DEFAULT
  }

  export type PredictiveCompactionDecision =
    | { kind: "skip" }
    | { kind: "compact" }
    | { kind: "fail-tool-schema" }
    | { kind: "fail-prompt-budget"; reason: "post-compaction-still-over" | "nothing-to-compress" }

  /**
   * Pure decision: given the budget metrics for the next turn, should we
   * predictively compact, fail fast, or just send the request?
   *
   * Per specs/new-arch/2026-04-28-structured-output-systemic-fix.md §C the
   * old behaviour ("totalTokens > limit → always compact") spun forever on
   * context-cold sessions whose overflow came entirely from the
   * non-compressible prompt face (system + tool schemas). The new logic:
   *
   *   1. tool schemas alone over `toolSchemaBudgetRatio` of budget →
   *      `fail-tool-schema` (rule 22 — there is no recovery, raise).
   *   2. estimate the residue after a perfect compaction: system + tool
   *      schemas + a minimum-viable summary + last user message. If that
   *      already exceeds the budget, compaction cannot rescue this call;
   *      fail with `post-compaction-still-over`.
   *   3. compute overflow vs the compressible message body. If the
   *      compressible content is smaller than the overflow we need to
   *      eject, compaction has nothing meaningful to fold up; fail with
   *      `nothing-to-compress`.
   *   4. otherwise → `compact`.
   *
   * `assistantMsgCount === 0` is NOT a hard fail-fast trigger on its own;
   * a jumbo first user message can still be compactable. The decision is
   * driven purely by whether compaction can reach the budget.
   */
  export function predictiveCompactionDecision(input: {
    totalTokensEst: number
    limit: number
    usableBudget: number
    systemChars: number
    toolSchemaChars: number
    messagePayloadChars: number
    mediaTokensEst: number
    toolSchemaBudgetRatio: number
    minResidueChars?: number
    lastFinishedSummary: boolean
  }): PredictiveCompactionDecision {
    if (input.usableBudget === 0) return { kind: "skip" }
    if (input.lastFinishedSummary) return { kind: "skip" }
    if (input.totalTokensEst <= input.limit) return { kind: "skip" }

    if (input.toolSchemaChars > input.usableBudget * input.toolSchemaBudgetRatio) {
      return { kind: "fail-tool-schema" }
    }

    const minResidueChars = input.minResidueChars ?? COMPACTION_MIN_RESIDUE_CHARS
    const nonCompressibleChars = input.systemChars + input.toolSchemaChars
    const postCompactionMinTokens =
      Math.round((nonCompressibleChars + minResidueChars) / 4) + input.mediaTokensEst
    if (postCompactionMinTokens > input.limit) {
      return { kind: "fail-prompt-budget", reason: "post-compaction-still-over" }
    }

    const overflowTokens = input.totalTokensEst - input.limit
    const compressibleTokens = Math.round(input.messagePayloadChars / 4)
    const minResidueTokens = Math.round(minResidueChars / 4)
    if (compressibleTokens < overflowTokens + minResidueTokens) {
      return { kind: "fail-prompt-budget", reason: "nothing-to-compress" }
    }

    return { kind: "compact" }
  }

  async function stopTurnWithPredictiveBudgetError(input: {
    processor: SessionProcessor.Info
    sessionID: string
    error: Message.Assistant["error"]
  }) {
    const message = typeof input.error?.data?.message === "string" ? input.error.data.message : input.error?.name
    input.processor.message.error = input.error
    input.processor.message.finish = "error"
    input.processor.message.time.completed = Date.now()
    await Session.updatePart({
      id: Identifier.ascending("part"),
      sessionID: input.sessionID,
      messageID: input.processor.message.id,
      type: "text",
      text: `Predictive compaction budget error: ${input.error?.name}${message ? `: ${message}` : ""}`,
      time: {
        start: Date.now(),
        end: Date.now(),
      },
    } satisfies Message.TextPart)
    await Session.updateMessage(input.processor.message)
    Bus.publish(Session.Event.Error, {
      sessionID: input.sessionID,
      error: input.error,
    })
    return "stop" as const
  }

  /**
   * Single source of truth for "transform a raw JSON Schema into the
   * provider-bound JSON Schema we ship to streamText". Used by both the
   * registry tool wrapper and the MCP tool wrapper below — there must NOT
   * be two parallel `ProviderTransform.schema(...)` call sites that can
   * drift, otherwise the estimator (which reads the wrapper after the
   * fact) silently sees a different shape than what was wired into the
   * tool. See specs/new-arch/2026-04-28-structured-output-systemic-fix.md
   * §A — the helper is the only schema-normalisation entry point on the
   * tool-payload side; the estimator never re-runs the transform.
   */
  export function normalizeToolSchemaForProvider<T>(
    model: Provider.Model,
    rawJsonSchema: T,
  ): ReturnType<typeof ProviderTransform.schema> {
    return ProviderTransform.schema(model, rawJsonSchema as never)
  }

  /**
   * Provider-normalized estimate of the bytes a tool definition contributes
   * to the streamText request payload. AI SDK serialises each tool as
   * `{name, description, parameters: <jsonSchema>}` where the JSON Schema is
   * obtained via `asSchema(tool.inputSchema).jsonSchema`. Earlier versions
   * `JSON.stringify`'d the raw `tool.inputSchema` wrapper which, for Zod-
   * backed tools, walks the Zod object's internal `_def` graph and produces
   * char counts that bear no relation to the actual outgoing payload — that
   * inflated count was triggering predictive compaction on context-cold
   * sessions (see specs/new-arch/2026-04-28-structured-output-systemic-fix.md
   * §A). Counting `name + description + jsonSchema` keeps the estimate tied
   * to what the provider really receives. The estimator is read-only:
   * `normalizeToolSchemaForProvider` is the only path that runs the
   * provider transform; here we just unwrap the already-normalised schema
   * via `asSchema(...)`.
   */
  export function estimateToolPayloadChars(tools: Record<string, AITool>): number {
    let total = 0
    for (const [name, item] of Object.entries(tools)) {
      const description = typeof (item as { description?: unknown }).description === "string"
        ? ((item as { description: string }).description).length
        : 0
      let schemaChars = 0
      const inputSchema = (item as { inputSchema?: unknown }).inputSchema
      if (inputSchema !== undefined && inputSchema !== null) {
        try {
          const jsonSchemaPayload = asSchema(inputSchema as never).jsonSchema
          schemaChars = JSON.stringify(jsonSchemaPayload ?? {}).length
        } catch {
          schemaChars = 0
        }
      }
      total += name.length + description + schemaChars
    }
    return total
  }

  export type ProviderToolSource = "registry" | "mcp" | "extra" | "structured"

  export class ToolInputSchemaError extends Error {
    constructor(message: string, options?: ErrorOptions) {
      super(message, options)
      this.name = "ToolInputSchemaError"
    }
  }

  export function providerBoundInputSchema(input: {
    name: string
    source: ProviderToolSource
    model: Provider.Model
    inputSchema: unknown
  }) {
    if (input.inputSchema === undefined || input.inputSchema === null) {
      throw new ToolInputSchemaError(
        `tool ${input.name} from ${input.source} is missing inputSchema`,
      )
    }
    try {
      const rawJsonSchema = asSchema(input.inputSchema as never).jsonSchema
      const normalized = normalizeToolSchemaForProvider(input.model, rawJsonSchema)
      return jsonSchema(normalized as any)
    } catch (err) {
      throw new ToolInputSchemaError(
        `tool ${input.name} from ${input.source} has invalid inputSchema: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { cause: err instanceof Error ? err : undefined },
      )
    }
  }

  export function prepareProviderTool(input: {
    name: string
    source: ProviderToolSource
    model: Provider.Model
    tool: AITool
  }): AITool {
    const raw = input.tool as AITool & { inputSchema?: unknown; toModelOutput?: unknown }
    const prepared = {
      ...(input.tool as any),
      inputSchema: providerBoundInputSchema({
        name: input.name,
        source: input.source,
        model: input.model,
        inputSchema: raw.inputSchema,
      }),
      ...(typeof raw.toModelOutput === "function" ? {} : { toModelOutput: providerToolResultToModelOutput }),
    } as AITool
    const schemaPayload = asSchema((prepared as { inputSchema?: unknown }).inputSchema as never).jsonSchema
    const rootType = schemaPayload && typeof schemaPayload === "object" && "type" in schemaPayload
      ? (schemaPayload as { type?: unknown }).type
      : undefined
    log.info("prepared provider tool schema", {
      source: input.source,
      tool: input.name,
      rootType,
      schemaChars: JSON.stringify(schemaPayload ?? {}).length,
    })
    return prepared
  }

  export function providerToolResultToModelOutput(args: unknown) {
    const output = unwrapAIToolModelOutputArgs(args)
    if (typeof output === "string") return { type: "text", value: output }
    if (isProjectToolResult(output)) return { type: "text", value: output.output }
    return { type: "json", value: output as never }
  }

  function unwrapAIToolModelOutputArgs(args: unknown): unknown {
    if (!args || typeof args !== "object") return args
    const record = args as Record<string, unknown>
    if ("toolCallId" in record && "output" in record) return record.output
    return args
  }

  function isProjectToolResult(output: unknown): output is { output: string } {
    return !!output && typeof output === "object" && typeof (output as Record<string, unknown>).output === "string"
  }

  export function summarizeModelMessagePayloads(messages: ModelMessage[], limit = 8) {
    const rows: Array<{
      messageIndex: number
      partIndex: number
      role: string
      type: string
      chars: number
      toolName?: string
      toolCallId?: string
      mediaType?: string
    }> = []
    messages.forEach((message, messageIndex) => {
      const content = Array.isArray(message.content)
        ? message.content
        : [{ type: "text", text: message.content }]
      content.forEach((part, partIndex) => {
        const p = part as Record<string, unknown>
        rows.push({
          messageIndex,
          partIndex,
          role: message.role,
          type: typeof p.type === "string" ? p.type : "unknown",
          chars: JSON.stringify(part).length,
          toolName: typeof p.toolName === "string" ? p.toolName : undefined,
          toolCallId: typeof p.toolCallId === "string" ? p.toolCallId : undefined,
          mediaType: typeof p.mediaType === "string" ? p.mediaType : undefined,
        })
      })
    })
    return rows.sort((a, b) => b.chars - a.chars).slice(0, limit)
  }

  type MediaKind = "image" | "pdf" | "audio" | "video"

  export type ModelMessagePayloadEstimate = {
    messagePayloadChars: number
    mediaCounts: Record<MediaKind, number>
    mediaTokensEst: number
  }

  const MEDIA_TOKENS_PER_PART: Record<MediaKind, number> = {
    image: 1_600,
    pdf: 3_200,
    audio: 1_600,
    video: 1_600,
  }

  function mediaKindFromMime(mime: unknown): MediaKind | undefined {
    if (typeof mime !== "string") return undefined
    const normalized = mime.toLowerCase()
    if (normalized.startsWith("image/")) return "image"
    if (normalized === "application/pdf") return "pdf"
    if (normalized.startsWith("audio/")) return "audio"
    if (normalized.startsWith("video/")) return "video"
    return undefined
  }

  function mediaKindFromDataUrl(value: unknown): MediaKind | undefined {
    if (typeof value !== "string" || !value.startsWith("data:")) return undefined
    const match = /^data:([^;,]+)/i.exec(value)
    return mediaKindFromMime(match?.[1])
  }

  function mediaKindFromPart(part: Record<string, unknown>): MediaKind | undefined {
    const byMime = mediaKindFromMime(part.mediaType ?? part.mime)
    if (byMime) return byMime

    const type = typeof part.type === "string" ? part.type.toLowerCase() : ""
    if (type === "image" || type === "image-data") return "image"
    if (type === "pdf") return "pdf"

    return mediaKindFromDataUrl(part.url) ??
      mediaKindFromDataUrl(part.data) ??
      mediaKindFromDataUrl(part.image) ??
      mediaKindFromDataUrl(part.media)
  }

  function isMediaPayloadField(key: string): boolean {
    return key === "url" || key === "data" || key === "image" || key === "media"
  }

  /**
   * Estimate text-token pressure without treating inline media bytes as text.
   * AI SDK model messages carry image/PDF/audio/video parts as data URLs, but
   * provider tokenization charges those as media inputs, not as base64 prose.
   * Predictive compaction must therefore sanitize media payload fields before
   * `JSON.stringify(...).length / 4`, then add a bounded per-media budget.
   */
  export function estimateModelMessagePayload(messages: ModelMessage[]): ModelMessagePayloadEstimate {
    const mediaCounts: Record<MediaKind, number> = {
      image: 0,
      pdf: 0,
      audio: 0,
      video: 0,
    }

    const sanitize = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(sanitize)

      if (value && typeof value === "object") {
        const record = value as Record<string, unknown>
        const mediaKind = mediaKindFromPart(record)
        if (mediaKind) mediaCounts[mediaKind]++

        const out: Record<string, unknown> = {}
        for (const [key, child] of Object.entries(record)) {
          if (mediaKind && isMediaPayloadField(key) && typeof child === "string") {
            out[key] = `[${mediaKind} bytes omitted from text-token estimate]`
            continue
          }
          out[key] = sanitize(child)
        }
        return out
      }

      const dataUrlKind = mediaKindFromDataUrl(value)
      if (dataUrlKind) {
        mediaCounts[dataUrlKind]++
        return `[${dataUrlKind} data URL omitted from text-token estimate]`
      }

      return value
    }

    let messagePayloadChars = 0
    try {
      messagePayloadChars = JSON.stringify(sanitize(messages)).length
    } catch {
      messagePayloadChars = 0
    }

    const mediaTokensEst = Object.entries(mediaCounts).reduce(
      (sum, [kind, count]) => sum + MEDIA_TOKENS_PER_PART[kind as MediaKind] * count,
      0,
    )

    return { messagePayloadChars, mediaCounts, mediaTokensEst }
  }

  export function normalizeExtraToolResult(input: unknown): {
    output: string
    title: string
    metadata: object
    attachments?: unknown
  } {
    if (typeof input === "string") return { output: input, title: "", metadata: {} }

    if (input && typeof input === "object") {
      const r = input as Record<string, unknown>
      const output = (() => {
        if (typeof r.output === "string") return r.output
        if (typeof r.text === "string") return r.text
        if (r.output !== undefined) return JSON.stringify(r.output)
        if (r.attachments !== undefined) {
          throw new Error("Extra tool returned attachments without string output/text")
        }
        return JSON.stringify(r)
      })()
      return {
        ...r,
        output,
        title: typeof r.title === "string" ? r.title : "",
        metadata: r.metadata && typeof r.metadata === "object" ? r.metadata : {},
        ...(r.attachments !== undefined ? { attachments: r.attachments } : {}),
      }
    }

    return { output: String(input ?? ""), title: "", metadata: {} }
  }

  export async function materializeToolResultAttachments(attachments: unknown): Promise<unknown> {
    if (!Array.isArray(attachments)) return attachments
    return Promise.all(
      attachments.map(async (attachment: unknown) => {
        if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) return attachment
        const file = attachment as Record<string, unknown>
        if (typeof file.url !== "string" || typeof file.mime !== "string") return attachment
        if (!file.url.startsWith("data:")) return attachment
        const bytes = Buffer.from(
          decodeDataUrlBase64(
            file.url,
            `SessionLoop.materializeToolResultAttachments ${typeof file.filename === "string" ? file.filename : file.mime}`,
          ),
          "base64",
        )
        const ref = await AttachmentStore.write(
          Instance.project.id,
          bytes,
          file.mime,
          typeof file.filename === "string" ? file.filename : undefined,
        )
        return {
          ...file,
          url: ref.url,
          mime: ref.mime,
        }
      }),
    )
  }

  function collectLoopState(msgs: Message.WithParts[]) {
    let lastUser: Message.User | undefined
    let lastAssistant: Message.Assistant | undefined
    let lastFinished: Message.Assistant | undefined
    const tasks: (Message.CompactionPart | Message.SubtaskPart)[] = []
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i]
      if (!lastUser && msg.info.role === "user") lastUser = msg.info as Message.User
      if (!lastAssistant && msg.info.role === "assistant") lastAssistant = msg.info as Message.Assistant
      if (!lastFinished && msg.info.role === "assistant" && msg.info.finish)
        lastFinished = msg.info as Message.Assistant
      if (lastUser && lastFinished) break
      if (!lastFinished) {
        tasks.push(...msg.parts.filter((part) => part.type === "compaction" || part.type === "subtask"))
      }
    }
    if (!lastUser) throw new Error("No user message found in stream. This should never happen.")
    return { lastUser, lastAssistant, lastFinished, tasks }
  }

  function shouldEnterStandby(input: { lastUser: Message.User; lastAssistant: Message.Assistant | undefined }) {
    return !!(
      input.lastAssistant?.finish &&
      input.lastAssistant.summary !== true &&
      input.lastAssistant.finish !== "tool-calls" &&
      input.lastUser.id < input.lastAssistant.id
    )
  }

  async function enterStandby(input: { sessionID: string; abort: AbortSignal; afterID: string }) {
    SessionCompaction.prune({ sessionID: input.sessionID })
    log.info("entering standby", { sessionID: input.sessionID })
    SessionStatus.set(input.sessionID, { type: "idle" })
    await waitForUserMessage(input.sessionID, input.abort, input.afterID)
  }

  async function runSubtask(input: {
    task: Message.SubtaskPart
    model: Provider.Model
    lastUser: Message.User
    msgs: Message.WithParts[]
    session: Session.Info
    sessionID: string
    abort: AbortSignal
  }) {
    const config = await EffectiveConfig.effective({ sessionID: input.sessionID })
    const taskTool = await TaskTool.init({ config })
    const taskModel = input.task.model
      ? await Provider.getModel(input.task.model.providerID, input.task.model.modelID, { config })
      : input.model
    const assistantMessage = (await Session.updateMessage({
      id: Identifier.ascending("message"),
      role: "assistant",
      parentID: input.lastUser.id,
      sessionID: input.sessionID,
      agent: input.task.agent,
      variant: input.lastUser.variant,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: taskModel.id,
      providerID: taskModel.providerID,
      time: {
        created: Date.now(),
      },
    })) as Message.Assistant
    const part = (await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: assistantMessage.id,
      sessionID: assistantMessage.sessionID,
      type: "tool",
      callID: ulid(),
      tool: TaskTool.id,
      state: {
        status: "running",
        input: {
          prompt: input.task.prompt,
          description: input.task.description,
          subagent_type: input.task.agent,
          command: input.task.command,
        },
        time: {
          start: Date.now(),
        },
      },
    })) as Message.ToolPart
    const args = {
      prompt: input.task.prompt,
      description: input.task.description,
      subagent_type: input.task.agent,
      command: input.task.command,
    }
    await Plugin.trigger(
      "tool.execute.before",
      {
        tool: "task",
        sessionID: input.sessionID,
        callID: part.id,
      },
      { args },
    )
    let fail: Error | undefined
    const taskAgent = await Agent.get(input.task.agent, { config })
    const ctx: Tool.Context = {
      agent: input.task.agent,
      messageID: assistantMessage.id,
      sessionID: input.sessionID,
      abort: input.abort,
      callID: part.callID,
      extra: { bypassAgentCheck: true },
      messages: input.msgs,
      async metadata(next) {
        await Session.updatePart({
          ...part,
          type: "tool",
          state: {
            ...part.state,
            ...next,
          },
        } satisfies Message.ToolPart)
      },
      async ask(req) {
        await PermissionNext.ask({
          ...req,
          sessionID: input.sessionID,
          ruleset: PermissionNext.merge(taskAgent.permission, input.session.permission ?? []),
        })
      },
    }
    const result = await taskTool.execute(args, ctx).catch((error) => {
      fail = error
      log.error("subtask execution failed", {
        error,
        agent: input.task.agent,
        description: input.task.description,
      })
      return undefined
    })
    const attachments = result?.attachments?.map((attachment) => ({
      ...attachment,
      id: Identifier.ascending("part"),
      sessionID: input.sessionID,
      messageID: assistantMessage.id,
    }))
    await Plugin.trigger(
      "tool.execute.after",
      {
        tool: "task",
        sessionID: input.sessionID,
        callID: part.id,
        args,
      },
      result,
    )
    assistantMessage.finish = "tool-calls"
    assistantMessage.time.completed = Date.now()
    await Session.updateMessage(assistantMessage)
    if (result && part.state.status === "running") {
      await Session.updatePart({
        ...part,
        state: {
          status: "completed",
          input: part.state.input,
          title: result.title,
          metadata: result.metadata,
          output: result.output,
          attachments,
          time: {
            ...part.state.time,
            end: Date.now(),
          },
        },
      } satisfies Message.ToolPart)
    }
    if (!result) {
      if (!fail) {
        throw new Error("Task tool returned no result without throwing")
      }
      await Session.updatePart({
        ...part,
        state: {
          status: "error",
          failure: toolFailureCauseFromUnknown({
            error: fail,
            originSite: "session.loop.task-tool",
            classification: "tool-execution",
            kind: "tool-execute-error",
            data: {
              toolName: "task",
              callID: part.callID,
            },
          }),
          time: {
            start: part.state.status === "running" ? part.state.time.start : Date.now(),
            end: Date.now(),
          },
          metadata: part.metadata,
          input: part.state.input,
        },
      } satisfies Message.ToolPart)
    }

    if (input.task.command) {
      const summaryUserMsg: Message.User = {
        id: Identifier.ascending("message"),
        sessionID: input.sessionID,
        role: "user",
        time: {
          created: Date.now(),
        },
        agent: input.lastUser.agent,
        model: input.lastUser.model,
      }
      await Session.updateMessage(summaryUserMsg)
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: summaryUserMsg.id,
        sessionID: input.sessionID,
        type: "text",
        text: "Summarize the task tool output above and continue with your task.",
      } satisfies Message.TextPart)
    }
  }

  async function processTurn(input: {
    step: number
    sessionID: string
    session: Session.Info
    msgs: Message.WithParts[]
    lastUser: Message.User
    lastFinished: Message.Assistant | undefined
    model: Provider.Model
    abort: AbortSignal
  }) {
    let structured: unknown | undefined
    const config = await EffectiveConfig.effective({ sessionID: input.sessionID })
    const agent = await Agent.get(input.lastUser.agent, { config })
    const maxSteps = agent.steps ?? Infinity
    const isLastStep = input.step >= maxSteps
    const runtimeExpectation = runtimeContractExpectationFromExtra(input.lastUser.extra)
    const runtimeContract = validateSessionRuntimeContractForContinuation({
      sessionID: input.sessionID,
      sessionKind: input.session.kind,
      expectedAgentKind: input.lastUser.agent,
      expectedGoalID: input.session.goalID,
      ...runtimeExpectation,
      requireRuntimeContract:
        agentKindRequiresRuntimeContract(input.lastUser.agent) ||
        agentKindRequiresRuntimeContract(input.session.kind),
    })
    const processor = SessionProcessor.create({
      assistantMessage: (await Session.updateMessage({
        id: Identifier.ascending("message"),
        parentID: input.lastUser.id,
        role: "assistant",
        agent: agent.name,
        variant: input.lastUser.variant,
        path: {
          cwd: Instance.directory,
          root: Instance.worktree,
        },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        modelID: input.model.id,
        providerID: input.model.providerID,
        time: {
          created: Date.now(),
        },
        sessionID: input.sessionID,
      })) as Message.Assistant,
      sessionID: input.sessionID,
      model: input.model,
      abort: input.abort,
    })
    using _ = defer(() => InstructionPrompt.clear(processor.message.id))

    const lastUserMsg = input.msgs.findLast((m) => m.info.role === "user")
    const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false
    const format = input.lastUser.format ?? { type: "text" }
    const terminalToolContract = getTerminalToolContract(input.sessionID)
    let tools = await resolveTools({
      agent,
      session: input.session,
      model: input.model,
      tools: input.lastUser.tools,
      processor,
      bypassAgentCheck,
      extra: input.lastUser.extra,
      messages: input.msgs,
      config,
    })
    if (input.lastUser.format?.type === "json_schema") {
      tools["StructuredOutput"] = prepareProviderTool({
        name: "StructuredOutput",
        source: "structured",
        model: input.model,
        tool: createStructuredOutputTool({
          schema: input.lastUser.format.schema,
          validate: getStructuredOutputGuard(input.sessionID),
          preTerminalReflection: () =>
            takePreTerminalReflection({
              sessionID: input.sessionID,
              agentName: input.lastUser.agent,
              finalizerName: "StructuredOutput",
              markerID: input.lastUser.id,
            }),
          onSuccess(output) {
            structured = output
          },
        }),
      })
    }
    if (input.step === 1) {
      SessionSummary.summarize({
        sessionID: input.sessionID,
        messageID: input.lastUser.id,
      })
    }

    if (input.step > 1 && input.lastFinished) {
      for (const msg of input.msgs) {
        if (msg.info.role !== "user" || msg.info.id <= input.lastFinished.id) continue
        for (const part of msg.parts) {
          if (part.type !== "text") continue
          if (!part.text.trim()) continue
          part.text = [
            "<system-reminder>",
            "The user sent the following message:",
            part.text,
            "",
            "Please address this message and continue with your tasks.",
            "</system-reminder>",
          ].join("\n")
        }
      }
    }

    await Plugin.trigger("experimental.chat.messages.transform", {}, { messages: input.msgs })

    const skillsSection = await SystemPrompt.skills(agent, { availableToolNames: Object.keys(tools) })
    const system = [
      ...(await SystemPrompt.environment(input.model)),
      ...(skillsSection ? [skillsSection] : []),
      ...(await InstructionPrompt.system()),
    ]
    if (format.type === "json_schema") {
      system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
    }
    if (
      format.type !== "json_schema" &&
      terminalToolContract &&
      !terminalToolContract.isSatisfied() &&
      terminalToolContract.shouldExposeOnlyTerminalTool()
    ) {
      system.push(terminalToolSystemPrompt(terminalToolContract.toolName))
    }

    const memoryQuery = (lastUserMsg?.parts ?? [])
      .filter((part): part is Message.TextPart => part.type === "text")
      .map((part) => part.text)
      .join(" ")
      .trim()
    // Live session-state blocks. These change between turns (memory hits depend
    // on query, scratchpad mutates, taskplan tracks progress). Until 2026-04
    // they were pushed onto `system` after the cached entries (env, TUI), but
    // applyCaching only puts cache_control on the first 2 system messages —
    // anything after lives inside the second cache breakpoint, which spans
    // the rest of system + all messages. These blocks stay as runtime context
    // for the current model turn; they are not persisted as conversation
    // messages.
    const memoryInstruction = await MemoryInjection.systemPromptSection({
      projectID: Instance.project.id,
      sessionID: input.sessionID,
      query: memoryQuery || input.session.title || input.lastUser.id,
      memoryToolAvailable: Object.prototype.hasOwnProperty.call(tools, "memory"),
    })
    const scratchpadSection = Scratchpad.systemPromptSection(input.sessionID)
    const taskPlanSection = TaskPlan.toMarkdown(input.sessionID)
    const dynamicContextBlocks = [memoryInstruction, scratchpadSection, taskPlanSection]
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    const dynamicContextText = dynamicContextBlocks.length > 0
      ? [
          "<session-state>",
          "These blocks are runtime-injected views of long-lived session state",
          "(retrieved memory, scratchpad notes, current task plan). They are",
          "not new user instructions — treat them as background context.",
          "",
          dynamicContextBlocks.join("\n\n"),
          "</session-state>",
        ].join("\n")
      : ""

    const baseModelMessages = await Message.toModelMessages(input.msgs, input.model)
    if (dynamicContextText) {
      // Prepend to the LAST user message's text content so the live state sits
      // adjacent to the request the model is responding to. This keeps the
      // earlier conversation history (and its system prefix) byte-stable for
      // the prefix cache; only the last user message — which is part of the
      // 5m tail breakpoint anyway — absorbs the per-turn delta.
      for (let i = baseModelMessages.length - 1; i >= 0; i--) {
        const msg = baseModelMessages[i]
        if (msg.role !== "user") continue
        if (typeof msg.content === "string") {
          msg.content = `${dynamicContextText}\n\n${msg.content}`
        } else if (Array.isArray(msg.content)) {
          const firstTextIdx = msg.content.findIndex(
            (p): p is { type: "text"; text: string } => typeof p === "object" && p !== null && (p as any).type === "text",
          )
          if (firstTextIdx >= 0) {
            const part = msg.content[firstTextIdx] as { type: "text"; text: string }
            msg.content[firstTextIdx] = { ...part, text: `${dynamicContextText}\n\n${part.text}` }
          } else {
            msg.content = [{ type: "text", text: dynamicContextText }, ...msg.content]
          }
        }
        break
      }
    }

    const modelMessages = [
      ...baseModelMessages,
      ...(isLastStep
        ? [
            {
              role: "assistant" as const,
              content: MAX_STEPS,
            },
          ]
        : []),
    ]

    const systemChars = system.reduce((sum, s) => sum + s.length, 0)
    const systemTokensEst = Math.round(systemChars / 4)
    const toolCount = Object.keys(tools).length
    let userMsgCount = 0
    let assistantMsgCount = 0
    let toolCallCount = 0

    for (const msg of modelMessages) {
      if (msg.role === "user") userMsgCount++
      if (msg.role === "assistant") assistantMsgCount++
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if ("type" in part && (part.type === "tool-call" || part.type === "tool-result")) toolCallCount++
        }
      }
    }

    // Estimate the size of the actual outgoing request. Tool-heavy agents
    // can spend most of their input budget on tool descriptions and JSON
    // schemas, so counting only messages makes autocompaction blind until
    // the provider rejects the request. Keep this estimate aligned with the
    // streamText payload shape: model messages and tool definitions are
    // prompt input; system is estimated separately above.
    const payloadEstimate = estimateModelMessagePayload(modelMessages)
    const messagePayloadChars = payloadEstimate.messagePayloadChars
    const toolSchemaChars = estimateToolPayloadChars(tools)
    const totalContentChars = messagePayloadChars + toolSchemaChars
    const contentTokensEst = Math.round(totalContentChars / 4)
    const mediaTokensEst = payloadEstimate.mediaTokensEst
    const mediaCount = Object.values(payloadEstimate.mediaCounts).reduce((sum, count) => sum + count, 0)
    const totalTokensEst = systemTokensEst + contentTokensEst + mediaTokensEst
    log.info("context-diagnostics", {
      step: input.step,
      systemPromptParts: system.length,
      systemChars,
      systemTokensEst,
      toolCount,
      toolNames: Object.keys(tools).join(","),
      messageCount: modelMessages.length,
      userMsgCount,
      assistantMsgCount,
      messagePayloadChars,
      toolSchemaChars,
      totalContentChars,
      contentTokensEst,
      mediaCount,
      mediaCounts: payloadEstimate.mediaCounts,
      mediaTokensEst,
      toolCallCount,
      totalTokensEst,
    })

    // ── Predictive compaction ────────────────────────────────────────────────
    // Decide whether the *next* LLM call would exceed the model's input budget
    // BEFORE we issue it. The historical compaction trigger only inspected
    // `lastFinished.tokens` *after* a turn returned, which means the offending
    // call had already burned the context window. We instead skip this turn
    // and queue a compaction message; the outer loop will pick it up on the
    // next iteration and the post-compaction continuation re-enters with a
    // shrunk history.
    //
    // Predictive and reactive compaction share ContextBudget so config flags
    // (`auto`, `reserved`, `threshold`) cannot diverge between the preflight
    // and post-turn gates. Reuse the `config` resolved at the top of
    // processTurn — a turn is the unit of config snapshotting, so a second
    // EffectiveConfig.effective() call here would be redundant work + a
    // TS2451 redeclaration in the same function scope.
    const predictiveBudget = ContextBudget.predictiveLimit({ config, model: input.model })
    if (!predictiveBudget) {
      log.warn("predictive-compaction-skipped-no-budget", {
        step: input.step,
        providerID: input.model.providerID,
        modelID: input.model.id,
      })
    } else {
      const ratio = toolSchemaBudgetRatio()
      const decision = predictiveCompactionDecision({
        totalTokensEst,
        limit: predictiveBudget.limit,
        usableBudget: predictiveBudget.usableBudget,
        systemChars,
        toolSchemaChars,
        messagePayloadChars,
        mediaTokensEst,
        toolSchemaBudgetRatio: ratio,
        lastFinishedSummary: input.lastFinished?.summary === true,
      })
      const toolNames = Object.keys(tools).join(",")
      if (decision.kind === "fail-tool-schema") {
        log.error("predictive-compaction-fail-tool-schema", {
          step: input.step,
          toolSchemaChars,
          usableBudget: predictiveBudget.usableBudget,
          ratio,
          toolNames,
        })
        return stopTurnWithPredictiveBudgetError({
          processor,
          sessionID: input.sessionID,
          error: new Message.ToolSchemaBudgetError({
            message:
              `Tool schema payload (${toolSchemaChars} chars) exceeds ` +
              `${Math.round(ratio * 100)}% of model input ` +
              `budget (${predictiveBudget.usableBudget}). Compaction does not shrink tool ` +
              `definitions; reduce the agent's tool surface or pick a model ` +
              `with a larger context window.`,
            toolSchemaChars,
            usableBudget: predictiveBudget.usableBudget,
            ratio,
            toolNames,
          }).toObject(),
        })
      }
      if (decision.kind === "fail-prompt-budget") {
        const nonCompressiblePromptChars = systemChars + toolSchemaChars
        const topPayloadParts = summarizeModelMessagePayloads(modelMessages)
        log.error("predictive-compaction-fail-prompt-budget", {
          step: input.step,
          reason: decision.reason,
          totalTokensEst,
          limit: predictiveBudget.limit,
          usableBudget: predictiveBudget.usableBudget,
          systemTokensEst,
          toolSchemaChars,
          messagePayloadChars,
          topPayloadParts,
          nonCompressiblePromptChars,
          toolNames,
        })
        return stopTurnWithPredictiveBudgetError({
          processor,
          sessionID: input.sessionID,
          error: new Message.PromptBudgetOverflowError({
            message:
              `Predictive compaction cannot recover this turn ` +
              `(reason=${decision.reason}). totalTokensEst=${totalTokensEst} ` +
              `> limit=${predictiveBudget.limit}; system+tool schemas alone ` +
              `=${nonCompressiblePromptChars} chars. Either drop tools or ` +
              `pick a larger-context model.`,
            systemTokensEst,
            messagePayloadChars,
            toolSchemaChars,
            compressibleMessageChars: messagePayloadChars,
            nonCompressiblePromptChars,
            usableBudget: predictiveBudget.usableBudget,
            limit: predictiveBudget.limit,
            toolNames,
          }).toObject(),
        })
      }
      if (decision.kind === "compact") {
        const topPayloadParts = summarizeModelMessagePayloads(modelMessages)
        log.warn("predictive-compaction-triggered", {
          step: input.step,
          totalTokensEst,
          limit: predictiveBudget.limit,
          threshold: predictiveBudget.threshold,
          usableBudget: predictiveBudget.usableBudget,
          messagePayloadChars,
          topPayloadParts,
        })
        await Session.removeMessage({
          sessionID: input.sessionID,
          messageID: processor.message.id,
        })
        await SessionCompaction.create({
          sessionID: input.sessionID,
          source: input.lastUser,
          auto: true,
          overflow: false,
        })
        return "continue" as const
      }
    }

    const turnToolChoice =
      structuredOutputToolChoice(format, input.model) ??
      terminalToolChoice(terminalToolContract, tools, input.model)

    const result = await processor.process({
      user: input.lastUser,
      agent,
      abort: input.abort,
      sessionID: input.sessionID,
      system,
      messages: modelMessages,
      tools,
      model: input.model,
      toolChoice: turnToolChoice,
      stream: runtimeContract?.stream,
      preTerminalToolInputStart: ({ toolName }) => {
        if (format.type === "json_schema" && toolName === "StructuredOutput") {
          return takePreTerminalReflection({
            sessionID: input.sessionID,
            agentName: input.lastUser.agent,
            finalizerName: "StructuredOutput",
            markerID: input.lastUser.id,
          })
        }
        if (terminalToolContract && terminalToolContract.toolName === toolName) {
          return takePreTerminalReflection({
            sessionID: input.sessionID,
            agentName: input.lastUser.agent,
            finalizerName: toolName,
            markerID: runtimeContract?.identity.installedAt,
          })
        }
        return undefined
      },
    })

    if (structured !== undefined) {
      processor.message.structured = structured
      processor.message.finish = processor.message.finish ?? "stop"
      await Session.updateMessage(processor.message)
      return "stop" as const
    }

    if (
      shouldStopAfterTerminalTool({
        terminalToolPresent: !!terminalToolContract,
        satisfied: terminalToolContract?.isSatisfied() ?? false,
      })
    ) {
      return "stop" as const
    }

    if (
      shouldEnterStructuredOutputRecovery({
        finish: processor.message.finish,
        structuredCalled: structured !== undefined,
        formatType: format.type,
        hasExistingError: !!processor.message.error,
      })
    ) {
      const context = await summarizeAssistantTurn(processor.message.id, processor.message.finish)
      processor.message.error = new Message.StructuredOutputError({
        message:
          `Model did not produce structured output before the turn ended ` +
          `(finish=${processor.message.finish ?? "unset"}); ${context}`,
        retries: 0,
      }).toObject()
      await Session.updateMessage(processor.message)
      return "stop" as const
    }

    if (
      terminalToolContract &&
      shouldEnterTerminalToolRecovery({
        finish: processor.message.finish,
        satisfied: terminalToolContract.isSatisfied(),
        hasExistingError: !!processor.message.error,
      })
    ) {
      const context = await summarizeAssistantTurn(processor.message.id, processor.message.finish)
      processor.message.error = new Message.TerminalToolMissingError({
        message:
          `Model did not call terminal tool ${terminalToolContract.toolName} before the turn ended ` +
          `(finish=${processor.message.finish ?? "unset"}); ${context}`,
        toolName: terminalToolContract.toolName,
        retries: 0,
      }).toObject()
      await Session.updateMessage(processor.message)
      return "stop" as const
    }

    if (result === "stop") return "stop" as const
    if (result === "compact") {
      await SessionCompaction.create({
        sessionID: input.sessionID,
        source: input.lastUser,
        auto: true,
        overflow: true,
      })
    }
    return "continue" as const
  }

  export const LoopInput = z.object({
    sessionID: Identifier.schema("session"),
    resume_existing: z.boolean().optional(),
  })

  /**
   * Resolve the toolChoice to send the provider for a json-schema turn.
   *
   * StructuredOutput may be preceded by work tools, so this asks the
   * provider for a tool call without naming a specific tool.
   *
   * Reasoning ("thinking") models reject `tool_choice: "required"` (e.g.
   * deepseek-reasoner / deepseek-v4-flash returns HTTP 400 "deepseek-reasoner
   * does not support this tool_choice"; alibaba-coding-plan-cn/glm-5 returns
   * "tool_choice parameter does not support being set to required or object
   * in thinking mode"). For these models we soft-pin the StructuredOutput
   * tool via prompt (STRUCTURED_OUTPUT_SYSTEM_PROMPT) + the structured-output
   * recovery channel (shouldEnterStructuredOutputRecovery), and let the
   * provider pick "auto". Same strategy as `terminalToolChoice`.
   */
  export function structuredOutputToolChoice(
    format: z.infer<typeof Message.Format>,
    model?: { capabilities?: { reasoning?: boolean } },
  ): "required" | "auto" | { type: "tool"; toolName: string } | undefined {
    if (format.type !== "json_schema") return undefined
    if (model?.capabilities?.reasoning) return "auto"
    return "required"
  }

  export function terminalToolChoice(
    contract: TerminalToolContract | undefined,
    tools: Record<string, AITool>,
    model?: { capabilities?: { reasoning?: boolean } },
  ): "required" | { type: "tool"; toolName: string } | undefined {
    if (!contract) return undefined
    if (!(contract.toolName in tools)) return undefined
    if (contract.isSatisfied()) return undefined
    // Reasoning ("thinking") models reject both "required" and the
    // {type:"tool",toolName} object form (e.g. alibaba-coding-plan-cn/glm-5
    // returns HTTP 400 "tool_choice parameter does not support being set to
    // required or object in thinking mode" — captured in r8 bench evidence
    // 2026-04-30T16:00:13). For these models the terminal tool is soft-pinned
    // by the terminal system prompt plus the recovery channel.
    if (model?.capabilities?.reasoning) return undefined
    if (contract.shouldExposeOnlyTerminalTool()) return { type: "tool", toolName: contract.toolName }
    return "required"
  }
  export const loop = fn(LoopInput, async (input) => {
    const { sessionID, resume_existing } = input

    const abort = resume_existing ? resume(sessionID) : start(sessionID)
    if (!abort) {
      return new Promise<Message.WithParts>((resolve, reject) => {
        state()[sessionID].callbacks.push({ resolve, reject })
      })
    }

    const firstResult = new Promise<Message.WithParts>((resolve, reject) => {
      state()[sessionID].callbacks.push({ resolve, reject })
    })

    void (async () => {
      try {
        let step = 0
        const session = await Session.get(sessionID)
        while (true) {
          SessionStatus.set(sessionID, { type: "streaming" })
          log.info("loop", { step, sessionID })
          if (abort.aborted) break
          const msgs = await Message.filterCompacted(Message.stream(sessionID))
          const { lastUser, lastAssistant, lastFinished, tasks } = collectLoopState(msgs)
          if (shouldEnterStandby({ lastUser, lastAssistant })) {
            if (!lastAssistant) break
            const lastResult = msgs.find((m) => m.info.id === lastAssistant.id)
            if (lastResult) flushCallbacks(sessionID, lastResult)

            await enterStandby({
              sessionID,
              abort,
              afterID: lastAssistant.id,
            })
            if (abort.aborted) break

            step = 0
            continue
          }

          step++
          if (step === 1)
            void ensureTitle({
              session,
              history: msgs,
            }).catch((err) => log.error("failed to ensure session title", { error: String(err) }))

          const config = await EffectiveConfig.effective({ sessionID })
          const model = await Provider.getModel(lastUser.model.providerID, lastUser.model.modelID, { config }).catch((e) => {
            if (Provider.ModelNotFoundError.isInstance(e)) {
              const hint = e.data.suggestions?.length ? ` Did you mean: ${e.data.suggestions.join(", ")}?` : ""
              Bus.publish(Session.Event.Error, {
                sessionID,
                error: new NamedError.Unknown({
                  message: `Model not found: ${e.data.providerID}/${e.data.modelID}.${hint}`,
                }).toObject(),
              })
            }
            throw e
          })
          const task = tasks.pop()

          if (task?.type === "subtask") {
            await runSubtask({ task, model, lastUser, msgs, session, sessionID, abort })
            continue
          }

          if (task?.type === "compaction") {
            const result = await SessionCompaction.process({
              messages: msgs,
              parentID: lastUser.id,
              abort,
              sessionID,
              auto: task.auto,
            })
            if (result === "stop") break
            continue
          }

          if (
            lastFinished &&
            lastFinished.summary !== true &&
            (await SessionCompaction.isOverflow({ tokens: lastFinished.tokens, model, sessionID }))
          ) {
            await SessionCompaction.create({
              sessionID,
              source: lastUser,
              auto: true,
              overflow: false,
            })
            continue
          }

          const turn = await processTurn({
            step,
            sessionID,
            session,
            msgs,
            lastUser,
            lastFinished,
            model,
            abort,
          })
          // Fire the registered step hook (phase 3-a-4) — agents that
          // dispatch via a tool and want to abort the active generation
          // once the tool landed use this hook to fire their deferred-stop
          // signal.
          await fireStepHook(sessionID, { step, turn })
          if (turn === "stop") break
          continue
        }
        SessionCompaction.prune({ sessionID })
        for await (const item of Message.stream(sessionID)) {
          if (item.info.role === "user") continue
          flushCallbacks(sessionID, item)
          break
        }
      } catch (e) {
        const s = state()[sessionID]
        if (s) {
          for (const q of s.callbacks) q.reject(e)
          s.callbacks = []
        }
      } finally {
        const s = state()[sessionID]
        if (s?.abort.signal === abort) finish(sessionID, abort)
      }
    })()

    return firstResult
  })

  function waitForUserMessage(sessionID: string, abort: AbortSignal, afterID: string): Promise<void> {
    return new Promise<void>((resolve) => {
      if (abort.aborted) {
        resolve()
        return
      }

      let settled = false
      const settle = () => {
        if (settled) return
        settled = true
        unsub()
        resolve()
      }

      const unsub = Bus.subscribe(Message.Event.Updated, (event) => {
        if (
          event.properties.info.role === "user" &&
          event.properties.info.sessionID === sessionID &&
          event.properties.info.id > afterID
        ) {
          settle()
        }
      })
      abort.addEventListener("abort", settle, { once: true })

      void (async () => {
        for await (const item of Message.stream(sessionID)) {
          if (item.info.id <= afterID) break
          if (item.info.role === "user") {
            settle()
            return
          }
        }
      })()
    })
  }

  export async function resolveTools(input: {
    agent: Agent.Info
    model: Provider.Model
    session: Session.Info
    tools?: Record<string, boolean>
    processor: SessionProcessor.Info
    bypassAgentCheck: boolean
    extra?: Record<string, unknown>
    messages: Message.WithParts[]
    config: Config.Info
  }) {
    using _ = log.time("resolveTools")
    const tools: Record<string, AITool> = {}

    const context = (args: any, options: ToolExecutionOptions): Tool.Context => ({
      sessionID: input.session.id,
      abort: options.abortSignal!,
      messageID: input.processor.message.id,
      callID: options.toolCallId,
      extra: { ...(input.extra ?? {}), model: input.model, bypassAgentCheck: input.bypassAgentCheck },
      agent: input.agent.name,
      messages: input.messages,
      metadata: async (val: { title?: string; metadata?: any }) => {
        const match = input.processor.partFromToolCall(options.toolCallId)
        if (match && match.state.status === "running") {
          await Session.updatePart({
            ...match,
            state: {
              title: val.title,
              metadata: val.metadata,
              status: "running",
              input: args,
              time: {
                start: Date.now(),
              },
            },
          })
        }
      },
      async ask(req) {
        await PermissionNext.ask({
          ...req,
          sessionID: input.session.id,
          tool: { messageID: input.processor.message.id, callID: options.toolCallId },
          ruleset: PermissionNext.merge(input.agent.permission, input.session.permission ?? []),
        })
      },
    })

    const runtimeContract = getSessionRuntimeContract(input.session.id)
    const extras = runtimeContract?.tools ?? {}
    const exactRuntimeContractTools = usesExactRuntimeContractTools(input.agent.name, runtimeContract)

    if (!exactRuntimeContractTools) {
      for (const item of await ToolRegistry.tools(
        { modelID: input.model.api.id, providerID: input.model.providerID },
        input.agent,
        input.config,
      )) {
        // Session-level deny rules take precedence (e.g. build fast-path denying "task")
        if (input.session.permission?.length) {
          const rule = PermissionNext.evaluate(item.id, "*", input.session.permission)
          if (rule.action === "deny") continue
        }
        const registryTool = tool({
          id: item.id as any,
          description: item.description,
          inputSchema: item.parameters as any,
          async execute(args, options) {
            const ctx = context(args, options)
            await Plugin.trigger(
              "tool.execute.before",
              {
                tool: item.id,
                sessionID: ctx.sessionID,
                callID: ctx.callID,
              },
              {
                args,
              },
            )
            const result = await item.execute(args, ctx)
            const materializedAttachments = await materializeToolResultAttachments(result.attachments)
            const output = {
              ...result,
              attachments: Array.isArray(materializedAttachments) ? materializedAttachments.map((attachment) => ({
                ...attachment,
                id: Identifier.ascending("part"),
                sessionID: ctx.sessionID,
                messageID: input.processor.message.id,
              })) : undefined,
            }
            await Plugin.trigger(
              "tool.execute.after",
              {
                tool: item.id,
                sessionID: ctx.sessionID,
                callID: ctx.callID,
                args,
              },
              output,
            )
            return output
          },
        })
        tools[item.id] = prepareProviderTool({
          name: item.id,
          source: "registry",
          model: input.model,
          tool: registryTool,
        })
      }
    }

    for (const [key, item] of Object.entries(exactRuntimeContractTools ? {} : await MCP.tools())) {
      const execute = item.execute
      if (!execute) continue

      const mcpTool = {
        ...(item as any),
        async execute(args: any, opts: ToolExecutionOptions) {
          const ctx = context(args, opts)

          await Plugin.trigger(
            "tool.execute.before",
            {
              tool: key,
              sessionID: ctx.sessionID,
              callID: opts.toolCallId,
            },
            {
              args,
            },
          )

          await ctx.ask({
            permission: key,
            metadata: {},
            patterns: ["*"],
            always: ["*"],
          })

          const result = await execute(args, opts)

          await Plugin.trigger(
            "tool.execute.after",
            {
              tool: key,
              sessionID: ctx.sessionID,
              callID: opts.toolCallId,
              args,
            },
            result,
          )

          // MCP tool image / resource content used to inline as
          // `data:<mime>;base64,...` directly into `attachment.url`,
          // which (a) blew up `part.data` (see DB forensics in specs/
          // delivery-attachment-store-single-source-2026-05-11.md) and
          // (b) now trips Session.updatePart's inline-base64 guard.
          // Funnel both branches through AttachmentStore so the
          // persisted url is the canonical `/attachment/<id>/<sha>.<ext>`
          // ref; bytes only re-inline transiently in toModelOutput when
          // the AI SDK actually feeds the tool result back to the model.
          const materialized = await materializeMcpToolResult({
            projectID: Instance.project.id,
            result,
          })

          const truncated = await Truncate.output(materialized.text, { sessionID: ctx.sessionID }, input.agent)
          const metadata = {
            ...materialized.metadata,
            truncated: truncated.truncated,
            ...(truncated.truncated && { outputPath: truncated.outputPath }),
          }

          return {
            title: "",
            metadata,
            output: truncated.content,
            attachments: materialized.attachments.map((attachment) => ({
              type: "file" as const,
              mime: attachment.mime,
              url: attachment.url,
              ...(attachment.filename ? { filename: attachment.filename } : {}),
              id: Identifier.ascending("part"),
              sessionID: ctx.sessionID,
              messageID: input.processor.message.id,
            })),
            content: result.content,
          }
        },
      } as AITool
      tools[key] = prepareProviderTool({
        name: key,
        source: "mcp",
        model: input.model,
        tool: mcpTool,
      })
    }

    // Merge per-session runtime-contract tools last so stage agents can
    // deliberately shadow a built-in name with the attempt-scoped executable
    // closure (for example a sandboxed read or a report/submit tool).
    //
    // Extras must return `{ output: string, title?: string, metadata?: object }`
    // — SessionLoop's Message.ToolPart persistence layer validates that shape
    // when the tool call finalises. Plain-string returns are auto-wrapped here
    // so stage-agent callers can keep the simple `return "OK: ..."` idiom
    // without silently landing a ZodError at tool-completion time.
    const sessionIDForExtras = input.session.id
    const messageIDForExtras = input.processor.message.id
    for (const [name, extraTool] of Object.entries(extras)) {
      const wrapped = wrapExtraTool(name, extraTool, {
        sessionID: sessionIDForExtras,
        messageID: messageIDForExtras,
        partFromToolCall: (toolCallID) => input.processor.partFromToolCall(toolCallID),
        ensureToolPart: (toolCallID, toolName, toolInput) =>
          input.processor.ensureToolPart(toolCallID, toolName, toolInput),
        preTerminalReflection:
          runtimeContract?.terminalToolContract?.toolName === name
            ? () =>
                takePreTerminalReflection({
                  sessionID: input.session.id,
                  agentName: runtimeContract.identity.agentKind,
                  finalizerName: name,
                  markerID: runtimeContract.identity.installedAt,
                })
            : undefined,
      })
      tools[name] = prepareProviderTool({
        name,
        source: "extra",
        model: input.model,
        tool: wrapped,
      })
    }

    applyToolSwitches(tools, input.tools)

    return tools
  }

  export function usesExactRuntimeContractTools(agentName: string, contract: SessionRuntimeContract | undefined): boolean {
    return agentName === "orchestrator" && contract?.identity.agentKind === "orchestrator" && contract.identity.contractKind === "orchestrator-wake"
  }

  export function applyToolSwitches(tools: Record<string, AITool>, switches: Record<string, boolean> | undefined): void {
    if (!switches) return
    if (switches["*"] === false) {
      for (const name of Object.keys(tools)) delete tools[name]
      return
    }
    for (const [name, enabled] of Object.entries(switches)) {
      if (enabled === false) delete tools[name]
    }
  }

  /**
   * Normalise an extra tool's `execute` return so it conforms to the
   * `{ output: string, title: string, metadata: object }` shape
   * SessionLoop's tool-part persistence requires.
   *
   *   - Plain string  →  `{ output: string, title: "", metadata: {} }`
   *   - Object result →  coerce missing fields to their minimal valid form
   *
   * Idempotent: already-conforming results round-trip unchanged.
   */
  function wrapExtraTool(
    name: string,
    raw: AITool,
    ctx: {
      sessionID: string
      messageID: string
      partFromToolCall: (toolCallID: string) => Message.ToolPart | undefined
      ensureToolPart: (toolCallID: string, toolName: string, toolInput: Record<string, unknown>) => Promise<Message.ToolPart>
      preTerminalReflection?: () => { output: string; title: string; metadata: object } | undefined
    },
  ): AITool {
    const original = raw as AITool & { execute?: (...args: any[]) => any }
    if (!original.execute) return raw
    const execute = original.execute
    // Mirror the attachment stamping the registry-tools wrapper applies
    // (loop.ts:967-987). Extras (e.g. screenshot,
    // verify_page_integrity) build attachments via buildMultimodalToolResult
    // which returns `{ type, mime, url, filename }` — missing the
    // PartBase fields (id/sessionID/messageID) that ToolStateCompleted's
    // FilePart schema requires. Without stamping here those attachments
    // land in part.state.attachments unstamped and the next session
    // processor tick rejects the message state with ZodError on
    // `state.attachments[0].{id,sessionID,messageID}`.
    const stampAttachments = (input: unknown): unknown => {
      if (!input || !Array.isArray(input)) return input
      return input.map((attachment: any) => ({
        ...attachment,
        id: typeof attachment?.id === "string" && attachment.id.length > 0
          ? attachment.id
          : Identifier.ascending("part"),
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
      }))
    }
    return {
      ...(raw as any),
      async execute(args: unknown, options: unknown) {
        const toolCallID = typeof (options as any)?.toolCallId === "string" ? (options as any).toolCallId : undefined
        const normalizedInput = normalizeToolInput(args)
        const toolInput = normalizedInput.ok ? normalizedInput.value : {}
        const toolPart = toolCallID
          ? (ctx.partFromToolCall(toolCallID) ?? await ctx.ensureToolPart(toolCallID, name, toolInput))
          : undefined
        const enrichedOptions = {
          ...((options && typeof options === "object") ? (options as Record<string, unknown>) : {}),
          opencorvus: {
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            toolCallID,
            toolPartID: toolPart?.id,
          },
        }
        const reflection = ctx.preTerminalReflection?.()
        if (reflection) return reflection
        const result = await execute(args, enrichedOptions)
        const normalized = normalizeExtraToolResult(result)
        const materializedAttachments = await materializeToolResultAttachments(normalized.attachments)
        return {
          ...normalized,
          ...(materializedAttachments !== undefined
            ? { attachments: stampAttachments(materializedAttachments) }
            : {}),
        }
      },
    } as AITool
  }

  export function createStructuredOutputTool(input: {
    schema: Record<string, any>
    validate?: StructuredOutputGuard
    preTerminalReflection?: () => { output: string; title: string; metadata: object } | undefined
    onSuccess: (output: unknown) => void
  }): AITool {
    const { $schema, ...toolSchema } = input.schema
    const inputSchema = jsonSchema(toolSchema as any)
    const payloadValidator = compileStructuredOutputPayloadValidator(toolSchema)

    return strictTool(tool({
      id: "StructuredOutput" as any,
      description: STRUCTURED_OUTPUT_DESCRIPTION,
      inputSchema,
      async execute(args) {
        const payload = validateStructuredOutputPayload(args, payloadValidator)
        if (!payload.ok) {
          throw new Message.StructuredOutputPayloadError({
            message: payload.reason,
            reason: payload.reason,
          })
        }
        const reflection = input.preTerminalReflection?.()
        if (reflection) return reflection
        const rejection = await input.validate?.(payload.value)
        if (rejection) throw new Error(rejection)
        input.onSuccess(payload.value)
        return {
          output: "Structured output captured successfully.",
          title: "Structured Output",
          metadata: { valid: true },
        }
      },
      toModelOutput(result) {
        return {
          type: "text",
          value: providerToolResultToModelOutput(result).value,
        }
      },
    }))
  }

}
