/**
 * runAgentSession — the single entry point every OpenCorvus WORKER agent runs through.
 *
 * Position in the architecture: agents have one shape. Each agent module
 * (architect / requirements / build / delivery / integrity / prosecutor /
 * intent-analysis / design-analyst / orchestrator-children…) contributes only
 * what is genuinely agent-specific:
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
 * Everything else — model resolution, child session creation, withExtraTools
 * wiring, SessionPrompt invocation, abort propagation, stream-error capture,
 * `loadStageSkills` skill injection, `config.agent.<kind>.prompt` user-append
 * — is centralised here.
 *
 * Per CLAUDE.md rule 24, this is the deliberate abstraction of a repeating
 * pattern. Per rule 22, no worker agent owns its own copy of this loop. Per
 * rule 1 there is no fallback path: a missing model, an aborted signal, or a
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
 *   2. `withStepHook` wrapping `withExtraTools` so a deferred-stop finalizer
 *      runs after every assistant step. Worker agents have no equivalent
 *      step-level coordination need — their session terminates on the
 *      collector's contract being met (build/delivery) or stepCountIs (integrity
 *      / prosecutor). Adding step-hook plumbing to the runner would saddle
 *      every worker with the orchestrator's dispatch-model overhead.
 *
 *   3. Stream errors are persisted as `engine_artifact kind="orchestrator-
 *      stream-error"` and consumed by the next wake's LLM via describe (rule
 *      23 — orchestrator decides recovery). The runner converts stream
 *      errors into thrown AgentRunError; that's the right shape for workers
 *      whose caller decides recovery, but it's the wrong shape for an agent
 *      whose recovery loop is itself driven by another LLM turn.
 *
 * The orchestrator additionally owns concurrency state (`running.set(taskID,
 * ctrl)`), `stopSignal` deferred-stop plumbing, and SerialQueue-driven wake
 * scheduling — none of which the runner models, by design.
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
import { resolveAgentModel } from "@/agent/model"
import { Provider } from "@/provider/provider"
import { Config } from "@/config/config"
import { EngineConfig } from "@/engine"
import { resolveStageSkills, type TaskSignals } from "@/engine/skill-inject"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Bus } from "@/bus"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import type { Message } from "@/session/message"
import type { SessionKind } from "@/session/session.sql"
import type { ToolSet } from "ai"
import { AgentTrace } from "@/trace"
import { TaskContext } from "@/task-context"

const log = Log.create({ service: "agent-runner" })

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Stage-specific tool kit. `tools` is the tool surface registered via
 * `SessionPrompt.withExtraTools`. `getCollector()` returns whatever the
 * agent collected during the run; the runner does not interpret it.
 */
export interface AgentToolKit<C> {
  tools: ToolSet
  getCollector: () => C
}

/**
 * EngineConfig stage keys whose `.skills` field drives skill injection.
 * Agents not in this set (orchestrator, integrity, prosecutor) get no
 * automatic skill injection — they are special-cased by intent. Skill
 * injection is opt-in: pass `skillsStage` to enable it. The runner
 * appends matched skills to the SYSTEM prompt — auto-load semantics, never
 * stuffed into the user message.
 */
export type SkillStage =
  | "requirements"
  | "architect"
  | "planner"
  | "delivery"
  | "design_analyst"
  | "intent_analysis"
  | "build"

/**
 * Optional structured-output (JSON schema) for agents whose final tool
 * call terminates the loop with a typed payload that needs to be returned
 * outside the collector (e.g. requirements / intent-analysis summaries).
 */
export interface StructuredFormat {
  schema: Record<string, unknown>
  retryCount?: number
}

export interface RunAgentSessionInput<C> {
  /** session.kind — determines how the overlay renders the child session
   *  and how session_id downstream readers route. Constrained to the
   *  SessionKind union; the runner does not accept free-form strings
   *  (rule 25). */
  kind: SessionKind
  /** Agent name for model resolution / system-prompt composition /
   *  SessionPrompt.agent dispatch. Defaults to `kind`. Supply a separate
   *  value when session.kind and agent name diverge — currently only
   *  prosecutor (session.kind="evaluator", agentName="prosecutor") to
   *  keep overlay renderers keyed on the historical kind while the
   *  runner looks up `config.agent.prosecutor.*` and
   *  `resolveAgentModel("prosecutor", ...)`. */
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
  /** Parent session id (orchestrator wake child / pipeline parent). */
  parentSessionID?: string
  /** Goal this session belongs to (per-goal build / planner / evaluator).
   *  Stamped onto the SessionTable row so `sessionGoalID()` returns it
   *  without inferring from parent chains. The protocol bridge
   *  (server/routes/task-message-protocol-bridge.ts:enrichProperties) reads
   *  this column to stamp goalID on every emitted message / part event,
   *  which is what the overlay tree-writer needs to route the session
   *  card under its goal phase instead of leaking it as a top-level card.
   *  Per-task agents (orchestrator, requirements, architect, integrity,
   *  delivery, …) leave this undefined. */
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
  onSessionCreated?: (session: Awaited<ReturnType<typeof Session.createNext>>) => Promise<{ dispose: () => void }> | { dispose: () => void } | void
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
  buildUserParts?: () => Promise<
    Array<
      | { type: "text"; text: string }
      | { type: "file"; url: string; mime: string; filename?: string }
    >
  >
  /** When set, registers a JSON-schema StructuredOutput format. The
   *  resulting `Message.Assistant.structured` value is returned to the
   *  caller alongside the collector. */
  format?: StructuredFormat
  /** Pass-through skill stage. When omitted, no skill injection runs.
   *  See `SkillStage` JSDoc. */
  skillsStage?: SkillStage
  /** Optional task signals forwarded to `resolveStageSkills`. Drives the
   *  auto-detect side of skill matching (attachments mime, request URL
   *  presence, request text). Ignored when `skillsStage` is omitted. */
  skillTaskSignals?: TaskSignals
  /** When true, treat `core` as the already-composed system prompt and
   *  skip the runner's config-append + skill-injection pass. The caller
   *  owns `resolveStageSkills` (and, when it cares, the returned
   *  `requiredTools` list). Used by delivery because its output tool
   *  kit needs `requiredTools` at registration time — the caller calls
   *  `resolveStageSkills` once to bind the output tools, then hands the
   *  resulting composed prompt through here so the runner does not
   *  re-resolve the same skill set. */
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
  /** Union of `required_tools` declared by every matched skill, when
   *  `skillsStage` was set. Empty array otherwise. Consumed by agents
   *  (currently delivery) that wire skill-declared tool requirements
   *  into their output-tool validation. */
  requiredTools: string[]
}

// ---------------------------------------------------------------------------
// Error types — every failure surfaces as AgentRunError so callers do not
// need to know about kind-specific exception classes.
// ---------------------------------------------------------------------------

export class AgentRunError extends Error {
  constructor(public readonly kind: SessionKind, message: string, options?: ErrorOptions) {
    super(`[${kind}] ${message}`, options)
    this.name = "AgentRunError"
  }
}

// ---------------------------------------------------------------------------
// Core runner
// ---------------------------------------------------------------------------

export async function runAgentSession<C>(
  input: RunAgentSessionInput<C>,
): Promise<RunAgentSessionOutput<C>> {
  const { kind } = input
  const agentName = input.agentName ?? kind

  if (input.signal?.aborted) {
    throw new AgentRunError(kind, "aborted before model resolution")
  }

  // ── 1. Resolve model ─────────────────────────────────────────────────
  let model: Awaited<ReturnType<typeof resolveAgentModel>> | undefined
  if (input.model) {
    model = await Provider.getModel(input.model.providerID, input.model.modelID).catch(() => undefined)
  } else {
    model = await resolveAgentModel(agentName, { taskID: input.taskID }).catch(() => undefined)
  }
  if (!model) throw new AgentRunError(kind, "no LLM model available")

  if (input.signal?.aborted) {
    throw new AgentRunError(kind, "aborted after model resolution")
  }

  // ── 2. Compose the system prompt ─────────────────────────────────────
  // Static parts (core + user override + skill block) come from
  // `composeSystemPrompt`; the live task context block is appended last so
  // every stage agent sees the same task / goals / decision-log surface
  // without having to memory.search for it (rule 23 / rule 22).
  const composed = input.rawSystemPrompt
    ? { prompt: input.core, requiredTools: [] as string[] }
    : await composeSystemPrompt(
        agentName,
        input.core,
        input.skillsStage,
        input.skillTaskSignals,
      )
  const liveContext = input.taskID ? TaskContext.snapshot(input.taskID) : ""
  const systemPrompt = liveContext.trim().length > 0
    ? `${composed.prompt}\n\n${liveContext}`
    : composed.prompt
  const requiredTools = composed.requiredTools

  // ── 3. Build user prompt parts ───────────────────────────────────────
  const userText = await input.buildUserPrompt()
  let parts: Array<
    | { type: "text"; text: string; id?: string }
    | { type: "file"; url: string; mime: string; filename?: string; id?: string }
  >
  if (input.buildUserParts) {
    parts = await input.buildUserParts()
  } else {
    parts = [{ type: "text", text: userText }]
  }
  parts = parts.map((p) => ({ ...p, id: Identifier.ascending("part") }))

  // ── 4. Create child session ──────────────────────────────────────────
  await input.onStatus?.(`${kind} starting`)
  const session = await Session.createNext({
    kind,
    parentID: input.parentSessionID,
    goalID: input.goalID,
    title: input.sessionTitle,
    directory: input.sessionDirectory ?? Instance.directory,
  })

  // ── 5. Stream-error capture + abort propagation ──────────────────────
  const streamErrors: Array<{ reason: string; name?: string }> = []
  const errorUnsub = Bus.subscribe(Session.Event.Error, (evt) => {
    const props = evt.properties as { sessionID: string; error: { message?: string; name?: string } }
    if (props.sessionID !== session.id) return
    streamErrors.push({ reason: props.error?.message ?? "unknown error", name: props.error?.name })
  })

  const abortPrompt = () => {
    try {
      SessionPrompt.cancel(session.id)
    } catch {
      /* session may already be stopped — best-effort cancel */
    }
  }
  input.signal?.addEventListener("abort", abortPrompt, { once: true })

  // ── 6. Invoke SessionPrompt with the agent's extra tools ─────────────
  const enableMap: Record<string, boolean> = Object.fromEntries(
    Object.keys(input.toolKit.tools).map((name) => [name, true]),
  )

  log.info(`${agentName} agent starting`, {
    kind,
    sessionID: session.id,
    parentSessionID: input.parentSessionID,
    taskID: input.taskID,
    modelID: model.id,
    toolNames: Object.keys(input.toolKit.tools),
  })

  const lifecycleDisposable = input.onSessionCreated
    ? await input.onSessionCreated(session)
    : undefined

  let finalMessage: Message.WithParts | undefined
  try {
    try {
      await SessionPrompt.withExtraTools(session.id, input.toolKit.tools, async () => {
        const promptArgs: Parameters<typeof SessionPrompt.prompt>[0] = {
          sessionID: session.id,
          model: { providerID: model!.providerID, modelID: model!.api.id },
          agent: agentName,
          system: systemPrompt,
          tools: enableMap,
          parts: parts as Parameters<typeof SessionPrompt.prompt>[0]["parts"],
        }
        if (input.format) {
          promptArgs.format = {
            type: "json_schema",
            schema: input.format.schema,
            retryCount: input.format.retryCount ?? 2,
          }
        }
        finalMessage = (await SessionPrompt.prompt(promptArgs)) as Message.WithParts
      })
    } finally {
      errorUnsub()
      input.signal?.removeEventListener("abort", abortPrompt)
      if (lifecycleDisposable && typeof lifecycleDisposable === "object" && "dispose" in lifecycleDisposable) {
        try { lifecycleDisposable.dispose() } catch { /* best-effort disposer */ }
      }
    }

    if (input.signal?.aborted) {
      throw new AgentRunError(kind, "aborted during prompt")
    }
    if (!finalMessage) {
      throw new AgentRunError(kind, "SessionPrompt.prompt returned no message")
    }
  } catch (err) {
    if (AgentTrace.isEnabled()) {
      AgentTrace.recordAgentReport({
        sessionID: session.id,
        parentSessionID: input.parentSessionID,
        taskID: input.taskID,
        agentName,
        kind: "agent_report_failure",
        collector: (() => {
          try { return input.toolKit.getCollector() } catch { return undefined }
        })(),
        streamErrors,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    throw err
  }

  // ── 7. Return collector + structured output ──────────────────────────
  const structured = input.format
    ? (finalMessage.info as Message.Assistant).structured
    : undefined
  const collector = input.toolKit.getCollector()

  log.info(`${agentName} agent finished`, {
    kind,
    sessionID: session.id,
    streamErrors: streamErrors.length,
    hasStructured: structured !== undefined,
  })

  if (AgentTrace.isEnabled()) {
    AgentTrace.recordAgentReport({
      sessionID: session.id,
      parentSessionID: input.parentSessionID,
      taskID: input.taskID,
      agentName,
      kind: "agent_report",
      collector,
      structured,
      streamErrors,
    })
  }

  return {
    session,
    finalMessage,
    collector,
    structured,
    streamErrors,
    model: { providerID: model.providerID, modelID: model.api.id, id: model.id },
    requiredTools,
  }
}

// ---------------------------------------------------------------------------
// Retry helper — wraps `runAgentSession` for agents whose successful run is
// gated by a stateful collector (e.g. delivery's `submit_verdict`) and that
// need a fresh child session + fresh tool kit per attempt so collector state
// does not bleed across retries.
//
// Per rule 22 / rule 24: any agent that needs retry MUST go through this
// helper. The retry logic does not live inside individual agent modules —
// previously delivery owned its own copy of this loop, which was the only
// blocker preventing other stage agents from gaining bounded retry without
// duplicating delivery's loop verbatim.
//
// Single-shot agents (architect, requirements, integrity, prosecutor,
// design-analyst, intent-analysis, build) keep calling `runAgentSession`
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
}

export interface RunAgentSessionWithRetryInput<C>
  extends Omit<RunAgentSessionInput<C>, "toolKit"> {
  /** Maximum attempts. attempt 1 is the first call; attempt 2..N are retries.
   *  Must be >= 1; pass 1 to disable retry while still using this entry
   *  point uniformly. */
  maxRetries: number
  /** Fresh tool kit per attempt. Called once before each `runAgentSession`
   *  dispatch so collector state and any tool-internal mutable state does
   *  not bleed across retries. */
  toolKitFactory: () => AgentToolKit<C>
  /** Decide whether the just-finished attempt's collector + streamErrors
   *  constitute success. `ok=true` ends the loop and returns; `ok=false`
   *  triggers a retry with `reason` captured into lastError. */
  isComplete: (
    collector: C,
    streamErrors: Array<{ reason: string; name?: string }>,
  ) => RetryDecision
}

export interface RunAgentSessionWithRetryOutput<C> extends RunAgentSessionOutput<C> {
  /** 1-indexed count of attempts actually taken (always <= maxRetries). */
  attempts: number
}

export async function runAgentSessionWithRetry<C>(
  input: RunAgentSessionWithRetryInput<C>,
): Promise<RunAgentSessionWithRetryOutput<C>> {
  if (input.maxRetries < 1) {
    throw new AgentRunError(
      input.kind,
      `runAgentSessionWithRetry: maxRetries must be >= 1, got ${input.maxRetries}`,
    )
  }
  const agentLabel = input.agentName ?? input.kind
  let lastError: Error | undefined
  let lastOutput: RunAgentSessionOutput<C> | undefined

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
    try {
      out = await runAgentSession({ ...input, toolKit: kit })
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      const aborted =
        input.signal?.aborted || (err instanceof Error && err.name === "AbortError")
      if (aborted) throw lastError
      log.warn(`${agentLabel} agent run failed`, { attempt, error: lastError.message })
      continue
    }
    lastOutput = out

    if (out.streamErrors.length > 0) {
      lastError = new Error(
        `${agentLabel}: session stream error: ${out.streamErrors[0].name ?? "error"}: ${out.streamErrors[0].reason}`,
      )
      log.warn(`${agentLabel}: stream error, will retry`, {
        attempt,
        error: lastError.message,
      })
      continue
    }

    const decision = input.isComplete(out.collector, out.streamErrors)
    if (decision.ok) {
      if (AgentTrace.isEnabled()) {
        AgentTrace.recordAgentReport({
          sessionID: out.session.id,
          parentSessionID: input.parentSessionID,
          taskID: input.taskID,
          agentName: agentLabel,
          kind: "agent_report_retry_final",
          collector: out.collector,
          structured: out.structured,
          streamErrors: out.streamErrors,
          attempts: attempt,
        })
      }
      return { ...out, attempts: attempt }
    }
    lastError = new Error(decision.reason ?? "isComplete returned ok=false")
    log.warn(`${agentLabel}: attempt incomplete, will retry`, {
      attempt,
      reason: lastError.message,
    })
  }

  if (AgentTrace.isEnabled()) {
    AgentTrace.recordAgentReport({
      sessionID: lastOutput?.session.id ?? "no-session",
      parentSessionID: input.parentSessionID,
      taskID: input.taskID,
      agentName: agentLabel,
      kind: "agent_report_retry_final",
      collector: lastOutput?.collector,
      structured: lastOutput?.structured,
      streamErrors: lastOutput?.streamErrors,
      attempts: input.maxRetries,
      error: lastError?.message ?? `agent did not complete after ${input.maxRetries} attempts`,
    })
  }

  if (!lastOutput) {
    throw new AgentRunError(
      input.kind,
      lastError?.message ?? "agent failed before producing output",
    )
  }
  throw new AgentRunError(
    input.kind,
    lastError?.message ?? `agent did not complete after ${input.maxRetries} attempts`,
  )
}

// ---------------------------------------------------------------------------
// System-prompt composition — single source of truth.
//
// Order:
//   1. core prompt (from `prompt/core/<kind>-core.txt`)
//   2. user-config append: `config.agent.<kind>.prompt`, when present
//   3. skill injection: `loadStageSkills(EngineConfig.<stage>.skills, stage)`
//      when `skillsStage` is set on the input.
//
// Per rule 22 / rule 25 this is the only path. Agents do not roll their
// own composition.
// ---------------------------------------------------------------------------

async function composeSystemPrompt(
  agentName: string,
  core: string,
  skillsStage: SkillStage | undefined,
  taskSignals: TaskSignals | undefined,
): Promise<{ prompt: string; requiredTools: string[] }> {
  const config = await Config.get()
  const userAppend = (config.agent as Record<string, any> | undefined)?.[agentName]?.prompt
  const withAppend =
    typeof userAppend === "string" && userAppend.trim().length > 0
      ? `${core}\n\n${userAppend}`
      : core

  if (!skillsStage) return { prompt: withAppend, requiredTools: [] }

  // Auto-detect always runs when skillsStage is set. Explicit names from
  // EngineConfig.<stage>.skills layer on top when present; missing config
  // is fine — auto-detect is the primary path and shouldn't be gated on it.
  const orchCfg = await EngineConfig.get()
  const stageCfg = (orchCfg as unknown as Record<SkillStage, { skills?: string[] } | undefined>)[skillsStage]
  const explicitNames = stageCfg?.skills ?? []
  const resolved = await resolveStageSkills(explicitNames, skillsStage, taskSignals)
  return { prompt: withAppend + resolved.prompt, requiredTools: resolved.requiredTools }
}

// ---------------------------------------------------------------------------
// Re-export — agents may need the LanguageModel type when accepting an
// optional model override at the call site. Keeping this here so agent
// modules import a single place for runner+model types.
// ---------------------------------------------------------------------------

export type { LanguageModel }
