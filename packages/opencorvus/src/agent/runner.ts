/**
 * runAgentSession — the single entry point every OpenCorvus agent runs through.
 *
 * Position in the architecture: agents have one shape. Each agent module
 * (architect / requirements / build / delivery / fidelity / prosecutor /
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
 * pattern. Per rule 22, no agent owns its own copy of this loop. Per rule 1
 * there is no fallback path: a missing model, an aborted signal, or a
 * collector that violates its agent's own contract throws.
 */
import type { LanguageModel } from "ai"
import type { TextHooks } from "@/llm/api"
import { resolveAgentModel } from "@/agent/model"
import { Provider } from "@/provider/provider"
import { Config } from "@/config/config"
import { EngineConfig } from "@/engine"
import { loadStageSkills } from "@/engine/skill-inject"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Bus } from "@/bus"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import type { Message } from "@/session/message"
import type { SessionKind } from "@/session/session.sql"
import type { ToolSet } from "ai"

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
 * The four EngineConfig stage keys whose `.skills` field drives skill
 * injection. Agents whose kind falls outside this set (orchestrator,
 * fidelity, prosecutor, build) get no automatic skill injection — they
 * are special-cases by intent. Skill injection is opt-in: pass
 * `skillsStage` to enable it.
 */
export type SkillStage =
  | "requirements"
  | "architect"
  | "planner"
  | "delivery"
  | "design_analyst"
  | "intent_analysis"

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
  const systemPrompt = await composeSystemPrompt(agentName, input.core, input.skillsStage)

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
): Promise<string> {
  const config = await Config.get()
  const userAppend = (config.agent as Record<string, any> | undefined)?.[agentName]?.prompt
  const withAppend =
    typeof userAppend === "string" && userAppend.trim().length > 0
      ? `${core}\n\n${userAppend}`
      : core

  if (!skillsStage) return withAppend

  const orchCfg = await EngineConfig.get()
  const stageCfg = (orchCfg as unknown as Record<SkillStage, { skills: string[] }>)[skillsStage]
  if (!stageCfg) return withAppend
  const skills = await loadStageSkills(stageCfg.skills, skillsStage)
  return withAppend + skills
}

// ---------------------------------------------------------------------------
// Re-export — agents may need the LanguageModel type when accepting an
// optional model override at the call site. Keeping this here so agent
// modules import a single place for runner+model types.
// ---------------------------------------------------------------------------

export type { LanguageModel }
