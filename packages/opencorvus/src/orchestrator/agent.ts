/**
 * Orchestrator — master agent in the Agent Team architecture.
 *
 * Per spec/new-arch/16-unified-teardown.md §3, the orchestrator has no typed
 * trigger enum — it is woken by *events* (task creation, goal batch finish,
 * acceptance verdict, operator message) carried as a free-form note. On every
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
import { resolveAgentModel } from "@/agent/model"
import { EngineConfig } from "@/engine"
import { INFORMATION_MISSING_FALLBACK_TEXT } from "@/prompt/information-missing"
import {
  AgentRunError,
  buildHardErrorFromFinalMessage,
  messageHasInformationMissing,
  extractInformationMissingBlock,
  toolErrorPartsFromFinalMessage,
} from "@/agent/runner"
import { Session } from "@/session"
import { SessionContext } from "@/session/context"
import { SessionPrompt } from "@/session/prompt"
import { Message } from "@/session/message"
import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import { recordToolExecuteError } from "@/engine/persist"
import { toolGuard } from "@/util/tool-guard"
import { createOrchestratorTools } from "./tools"
import { SubAgentProtocol } from "@/agent/sub-agent-protocol"
import { AttachmentStore } from "@/storage/attachment-store"
import { renderUserRequestSection } from "@/intent/request-prompt"
import { readIterationHistory as readHistForPrompt } from "@/metrics/store"
import {
  findActiveRunForTask,
  findAcceptanceByRun,
  findEvaluationByRun,
  requireTask,
  blockActiveRunForTask,
  updateTask,
  WorkflowRegistry,
  createWorkflowState,
  renderWorkflowPrompt,
} from "@/engine"
import { EngineProtocol } from "@/engine/protocol"
import { Event as EngineEvent } from "@/engine/model"
import { describeTask, renderTaskDescription } from "@/engine/describe"
import { deriveTaskStatus, isTaskTerminal } from "@/engine/task-status"
import type { TaskRow, WorkflowState, MiniWorkflow } from "@/engine"
import { AgentTrace } from "@/trace"
import { paragraphSummary } from "@/agent/report"
import { NamedError } from "@opencorvus-ai/util/error"

const log = Log.create({ service: "orchestrator" })
// MAX_STEPS lives on agent.orchestrator.steps in src/agent/agent.ts. SessionLoop
// reads that directly via Agent.get("orchestrator") — no local constant needed.

export interface OrchestratorTaskErrorEnvelope {
  errorName: string
  message: string
  data?: unknown
}

export const ORCHESTRATOR_TASK_ERROR_ENVELOPE_MARKER = "\n[orchestrator-error-envelope]"

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
  const envelope = orchestratorErrorEnvelope(error)
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
}) {
  const { recordOrchestratorStreamError, maybeTripOrchestratorStreamErrorFuse } = await import("@/engine/persist")
  const now = Date.now()
  const reason = `${input.envelope.errorName}: ${input.envelope.message}`
  recordOrchestratorStreamError({
    taskID: input.taskID,
    reason,
    errorName: input.envelope.errorName,
    sessionID: input.sessionID,
    now,
  })
  await blockActiveRunForTask(input.taskID, {
    blockingReason: "orchestrator_stream_error",
    error: reason,
    summary: `${input.summaryPrefix}: ${reason}`,
  })
  const fuse = await maybeTripOrchestratorStreamErrorFuse({
    taskID: input.taskID,
    now,
    lastReason: reason,
  })
  if (fuse.tripped) {
    log.error("orchestrator stream-error fuse tripped — task marked failed", {
      taskID: input.taskID,
      consecutive: fuse.consecutive,
      windowMs: fuse.windowMs,
    })
  }
}

// ---------------------------------------------------------------------------
// Wake event — free-form hint about WHY the orchestrator is being woken.
// Replaces the old typed trigger enum per specs/new-arch/16-unified-teardown.md
// §3. Callers that previously sent trigger.kind="X" now synthesize the relevant
// context string into `note`. Operator text + attachment summary are the only
// structured fields because the tools layer still consumes them via
// `createOrchestratorTools({ operatorMessage })`.
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
  }
}

// ---------------------------------------------------------------------------
// Concurrency guard
// ---------------------------------------------------------------------------

const running = new Map<string, AbortController>()
// Cooldown: when the Orchestrator last finished for each task.
// Orphan recovery checks this to avoid re-triggering immediately.
const lastFinished = new Map<string, number>()

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

      // Phase-6-f-3-bis-b: workflow_state is no longer persisted. Every
      // wake re-resolves the default workflow (pipeline). Tools.ts's
      // switchToDirectWorkflowIfEligible mutates `input.workflow` /
      // `input.workflowState` in-memory when the task turns out to be a
      // direct-build case; that mutation does not escape the current
      // orchestrator loop, which is fine — the eligibility check is
      // deterministic from DB state and will reach the same verdict on
      // the next wake if the task continues in the same shape.
      //
      // "First wake" detection now reads task.time_started (stamped by
      // the serial queue when it picks the task up). Per rule 23 the
      // LLM reads describe output for actual phase identification, not
      // a cached step-FSM cell.
      const workflowID = task.kind === "build" ? "direct" : await WorkflowRegistry.defaultID()
      const workflow = (await WorkflowRegistry.resolve(workflowID)) ?? WorkflowRegistry.resolveSync("pipeline")
      const workflowState: WorkflowState | undefined = workflow ? createWorkflowState(workflow) : undefined
      const isFirstWake = !task.time_started
      if (isFirstWake && workflow) {
        EngineProtocol.emit(EngineEvent.WorkflowSelected, {
          taskID,
          workflowID: workflow.id,
          workflowName: workflow.name,
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
        await updateTask(
          task,
          { status: "failed", error: structured.taskError },
          `Orchestrator failed: ${structured.message}`,
        )
        return
      }

      // 2. Resolve the task's single orchestrator child session. LLM context
      //    is still reconstructed from DB state (goals, runs, deliveries,
      //    decision log) via buildSystemParts on each invocation; the session
      //    is the durable task-level conversation/audit surface for every wake.
      const agentSession = await orchestratorSessionForTask(task)
      agentSessionID = agentSession.id
      agentSessionInfo = agentSession

      // 3. Create tools (agentSessionID passed so tool sessions become children)
      const { tools } = createOrchestratorTools({
        taskID,
        agentSessionID: agentSession.id,
        signal: ctrl.signal,
        workflow,
        workflowState,
        operatorMessage: event?.operatorMessage,
      })
      const guard = toolGuard(tools)
      const enableMap: Record<string, boolean> = Object.fromEntries(
        Object.keys(guard.tools).map((name) => [name, true]),
      )

      // 4. Build prompt. Caller-supplied text is a real wake message
      //    (operator text / retry reason). Internal engine wakes reuse the
      //    existing visible user message and carry fresh task state through
      //    the runtime contract instead of synthesizing another user turn.
      const system = await buildSystemParts(task, event, workflow, workflowState)
      // INFORMATION MISSING fallback — single source per rule 8. The runner.ts
      // path injects this for every worker agent (build / architect / acceptance
      // / ...); the orchestrator uses its own SessionPrompt.prompt path
      // (see file header for why) and so must inject here. Without this, a
      // toggle flipped ON would silently leave the orchestrator without
      // the diagnostic — the whole point is "every agent's prompt receives
      // the fallback" so that whoever lost their context surfaces it.
      // Appended as a separate array element so it lands after the static
      // ORCHESTRATOR_INSTRUCTIONS + the per-wake describe block, matching
      // the runner's "fallback last" placement.
      const debugCfg = (await EngineConfig.get()).debug
      if (debugCfg.fail_on_information_missing) {
        system.push(INFORMATION_MISSING_FALLBACK_TEXT)
      }
      const appendUserMessage = Boolean(
        event?.note || event?.operatorMessage || !(await sessionHasUserMessage(agentSession.id)),
      )
      const userText = appendUserMessage ? orchestratorUserText(task, event) : ""
      // Build multimodal content when task has file attachments. Real user
      // wakes persist file parts on the visible user message. Internal engine
      // wakes do not create a hidden model-only user message; they refresh the
      // textual inventory through runtime system context and rely on the
      // originally persisted file parts for bytes.
      // AttachmentStore.partition routes image/audio/video/pdf to inline
      // file parts and text/* / json to a URL-only reference list; see
      // helper comments for the silent-rejection rationale. Inline parts
      // are additionally gated by the resolved model's input modality
      // capabilities so non-vision coding models don't receive bytes the
      // upstream API would silently drop.
      const wakeAttachments = Array.isArray(task.attachments)
        ? (task.attachments as Array<{ sha?: string; url?: string; mime?: string; size?: number; filename?: string }>)
        : undefined
      const inlineFileParts = appendUserMessage
        ? await AttachmentStore.inlineFileParts(wakeAttachments, {
            capabilities: model.capabilities,
            agent: "orchestrator",
          })
        : []
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
      const visionCapable =
        model.capabilities.input.image ||
        model.capabilities.input.pdf ||
        model.capabilities.input.audio ||
        model.capabilities.input.video
      const inlinedNote =
        inlineFileParts.length > 0
          ? "Multimodal items (image / pdf / audio / video) below are inlined as file parts in this wake's user message — you can see and reason about them directly."
          : !appendUserMessage
            ? "This is an internal engine wake, so no new user message is created and no hidden file parts are injected. Use this inventory to cite task attachments; do not claim pixel-level inspection unless the visible conversation already contains the file parts."
            : visionCapable
              ? "No multimodal items are inlined in this wake (the task carries no image / pdf / audio / video attachments, or none was inlinable)."
              : "Your current model does NOT accept image / pdf / audio / video input — multimodal items below are listed by filename ONLY; you cannot see their pixels. Do NOT pretend you saw them; describe them only via the textual context the user provided in prose, and rely on `frontend_design` / sub-agents whose models DO support vision for visual reasoning."
      const inventoryText = AttachmentStore.renderAttachmentInventory(allAttachments, {
        header: "## Task Attachments (forwarded to sub-agents automatically)",
        hint:
          "The user attached the files below to this task. " +
          inlinedNote +
          " " +
          "Reference-only items (text / json) are not inlined; sub-agents read them via their `read` tool. " +
          "You do NOT have a `read` tool yourself — do not attempt to fetch reference content. " +
          "When you call `requirements` / `frontend_design` / `architect` / `build` / `refine`, the engine forwards every attachment to the sub-agent automatically — but the sub-agent's prompt only cites them when YOU mention them by filename in your dispatch instructions. ALWAYS cite the relevant attachments by EXACT filename and explain their relevance. NEVER reference an attachment that is not listed below — if this section is empty, the user attached nothing in this wake and any phrase implying you saw a file is a hallucination.",
      })
      const enrichedUserText = appendUserMessage ? userText + inventoryText : ""
      const internalWakeNotice = [
        "## Wake Provenance",
        "这是一条 wake 消息，不是用户发送的新消息。",
        "This is a wake message, not a user-authored message. Do not claim the user said, asked, sent, or implied anything unless it appears in the visible user/operator messages.",
      ].join("\n")
      const runtimeSystem = appendUserMessage
        ? system
        : [...system, internalWakeNotice, ...(inventoryText.trim() ? [inventoryText] : [])]
      // Build PromptInput.parts. Text first, then any multimodal attachments
      // as FilePart (data URL) so Session.saveMessage can persist the part
      // without re-resolving a local file path.
      const parts: Array<
        { type: "text"; text: string } | { type: "file"; url: string; mime: string; filename?: string }
      > = appendUserMessage ? [{ type: "text", text: enrichedUserText }, ...inlineFileParts] : []
      const partsWithIds = parts.map((p) => ({ ...p, id: Identifier.ascending("part") }))

      log.info("orchestrator starting", {
        taskID,
        firstWake: isFirstWake,
        note: event?.note,
        sessionID: agentSession.id,
        model: `${model.providerID}/${model.id}`,
        toolCount: Object.keys(tools).length,
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
        try {
          void (async () => {
            try {
              const ids = await Session.tree(agentSession.id)
              for (const descendantID of ids.slice().reverse()) {
                try {
                  SessionPrompt.cancel(descendantID)
                } catch {
                  /* descendant session may already be stopped */
                }
              }
            } catch (err) {
              log.warn("orchestrator abort cascade failed", {
                taskID,
                sessionID: agentSession.id,
                error: err instanceof Error ? err.message : String(err),
              })
              // Still cancel the orchestrator session itself even if the
              // tree walk failed, so the LLM loop unblocks.
              try {
                SessionPrompt.cancel(agentSession.id)
              } catch {
                /* already stopped */
              }
            }
          })()
        } catch {
          /* already-aborted listener was a no-op */
        }
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
        // surfaced as the fallback "unknown session error" — hiding the
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
      try {
        SessionPrompt.setSessionRuntimeContract(agentSession.id, {
          identity: {
            sessionID: agentSession.id,
            agentKind: "orchestrator",
            contractKind: "orchestrator-wake",
            installedAt: Date.now(),
          },
          tools: guard.tools as any,
          system: appendUserMessage ? undefined : runtimeSystem,
          systemMode: appendUserMessage ? undefined : "complete",
          runOnce: !appendUserMessage,
        })
        promptInFlight = true
        finalMessage = appendUserMessage
          ? ((await SessionPrompt.prompt({
              sessionID: agentSession.id,
              model: { providerID: model.providerID, modelID: model.api.id },
              agent: "orchestrator",
              system: Array.isArray(system) ? system.join("\n\n") : system,
              systemMode: "complete",
              tools: enableMap,
              parts: partsWithIds,
            })) as Message.WithParts)
          : ((await SessionPrompt.loop({
              sessionID: agentSession.id,
            })) as Message.WithParts)
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

      // INFORMATION MISSING signal — same contract as the worker path in
      // agent/runner.ts. When the operator has flipped the toggle and the
      // orchestrator emits the XML diagnostic block (because its own wake
      // input dropped required context — e.g. event.note empty + no
      // describe snapshot can resolve the next action), exit the process
      // immediately so the operator sees the dispatcher-side context drop
      // instead of a long log of guessed-default work. Mirrors the
      // injection above (rule 8 single source).
      if (debugCfg.fail_on_information_missing && finalMessage && messageHasInformationMissing(finalMessage)) {
        const block = extractInformationMissingBlock(finalMessage) ?? "<INFORMATION MISSING>...</INFORMATION MISSING>"
        log.error("INFORMATION MISSING signal — terminating process", {
          agentName: "orchestrator",
          taskID,
          sessionID: agentSession.id,
          block: block.slice(0, 1200),
        })
        // eslint-disable-next-line no-console
        console.error(
          `\n[FATAL] INFORMATION MISSING detected in orchestrator stream — terminating process.\n` +
            `Task: ${taskID}\n` +
            `Session: ${agentSession.id}\n` +
            `${block}\n`,
        )
        process.exit(99)
      }

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

      if (AgentTrace.isEnabled()) {
        const finalText = finalMessage?.parts
          ?.filter((p) => p.type === "text")
          .map((p) => (p as { text: string }).text)
          .join("\n\n")
        recordOrchestratorTraceReportForSession(agentSession, {
          sessionID: agentSession.id,
          parentSessionID: task.session_id ?? undefined,
          taskID,
          agentName: "orchestrator",
          kind: "orchestrator_wake",
          finishReason: assistantInfo?.finish,
          finalText,
          streamErrors: streamErrors.map((e) => ({ reason: e.reason, name: e.errorName })),
          report: {
            summary: paragraphSummary(finalText ?? "orchestrator completed without final text"),
            detail: finalText ?? "orchestrator completed without final text",
          },
        })
      }

      // Stream failures (mid-stream protocol violations, provider onError,
      // session-llm idle abort) are recorded as an append-only artifact.
      // Per rule 23 we do NOT transition the task to `failed` here AND we
      // do NOT auto-rewake — both are state-machine reactions. The next
      // external wake re-enters processTask; the LLM reads the abort fact
      // via describe and decides itself (retry, restart_from_stage,
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

        // Retry circuit breaker. When stream early-death produces a malformed
        // assistant turn (or any provider-side rejection that recurs on
        // replay), `monitorRuns` would otherwise wake the task once per
        // second and burn provider 4xx in a tight loop. The structural side
        // of that bug is fixed at `session/message.ts::toModelMessages`, but
        // any future error class can recur it; this fuse is the resource
        // bound. See engine/persist.ts::maybeTripOrchestratorStreamErrorFuse
        // and specs/new-arch/2026-05-08-stream-early-death-and-retry-fuse.md.
        const fuse = await maybeTripOrchestratorStreamErrorFuse({
          taskID,
          now,
          lastReason: reason,
        })
        if (fuse.tripped) {
          log.error("orchestrator stream-error fuse tripped — task marked failed", {
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
          await recordOrchestratorSessionHardError({
            taskID,
            sessionID: agentSessionID,
            error,
          })
        } else if (wasCtrlAborted) {
          // Abort path: synthesize an envelope from the ctrl reason so the
          // artifact reads "OrchestratorAborted: task loop dispatch interrupt"
          // (or similar) — the next wake's describe needs to know WHY the
          // prior turn was interrupted, not just that it threw an opaque
          // "session cancelled" Error from SessionPromptState.cancel.
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
      // persisted as artifacts above; missing startup prerequisites fast-fail
      // at their source before the LLM wake begins. Also skip on ctrl abort:
      // aborts are control-flow signals (operator-driven restart or explicit
      // cancel), not "task broken" — task.error would mislead the UI and
      // orphan-recovery into treating the next wake as stuck on a hard failure.
      if (!wasCtrlAborted) {
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

  const primary = existing[0]
  if (primary) {
    if (existing.length > 1) {
      log.warn("task has multiple orchestrator sessions; reusing earliest", {
        taskID: task.id,
        rootSessionID: task.session_id,
        primarySessionID: primary.id,
        duplicateSessionIDs: existing.slice(1).map((session) => session.id),
      })
    }
    await Session.touch(primary.id)
    return primary
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
): Promise<string[]> {
  const ctx: string[] = []
  const autoIteration = (await EngineConfig.get()).auto_iteration === true

  // ── Auto iteration mode ──
  // This is intentionally dynamic, not hard-coded into the static prompt, so
  // flipping `assistant.auto_iteration` changes the next wake immediately.
  ctx.push("## Auto Iteration Mode")
  if (autoIteration) {
    ctx.push(
      "- assistant.auto_iteration=true: rejected acceptance reviews and failed terminal waves may queue same-task repair work automatically when evidence is concrete and not a repeated identical failure.",
    )
    ctx.push(
      "- Route the repair to the responsible owner inside this task: product/toolchain/git-worktree blockers go to Build, graph/dependency contract blockers go to modify_goal or architect, then rerun the relevant verification/integrity gate.",
    )
    ctx.push(
      "- Do not keep retrying a verification-only goal when its evidence proves a product, dependency, git, or toolchain blocker owned elsewhere; stop and ask only when the failure repeats or needs operator judgment.",
    )
  } else {
    ctx.push(
      "- assistant.auto_iteration=false: rejected acceptance reviews and failed terminal waves do not open host-side rework attempts or queue a new build loop by themselves.",
    )
    ctx.push(
      "- The current reasoning turn still owns the next decision. Do not stop with a plain-text blocker when same-task repair is available; use the evidence to build, modify_goal, architect, ask a concrete external-only question, or fail the task.",
    )
  }
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

  // ── Acceptance trajectory ──
  // Source of truth for iteration history is engine_iteration (Arbiter-owned).
  // We render the last few iterations' snapshots + the latest rework signal
  // (verdict summary + issues) so the assistant sees both the aggregated
  // signal AND the concrete acceptance-agent feedback for the most recent round.
  // The orchestrator decides next steps from this rendered snapshot directly;
  // per-metric details live on the acceptance sub-agent session, not in an
  // orchestrator tool surface.
  const iterationHistory = readHistForPrompt(task.id)
  if (iterationHistory.length > 0) {
    const RENDER_RECENT = 3
    const tail = iterationHistory.slice(-RENDER_RECENT)
    ctx.push("## Acceptance Trajectory")
    ctx.push(`${iterationHistory.length} prior iteration(s). Last ${tail.length}:`)
    for (const it of tail) {
      ctx.push(
        `  - iter ${it.iteration}: arbiter=${it.arbiter_verdict}, S_k=${it.aggregate_score.toFixed(3)} (Δ=${it.delta_vs_prev.toFixed(3)}), blocking_unmet=${it.blocking_unmet_count}, open_ce=${it.open_counterexamples}, novelty=${it.novelty_score}`,
      )
    }
    // Latest acceptance feedback comes from the most recent
    // acceptance-review-verdict artifact on the task. Shown only when the
    // most recent verdict was a rejection — per spec there is no trigger
    // enum steering this block, it is derived from persistent artifacts.
    const { findLatestAcceptanceVerdictArtifact } = await import("@/engine/store")
    const latestVerdictArt = findLatestAcceptanceVerdictArtifact(task.id)
    const latestVerdictPayload = (latestVerdictArt?.payload ?? {}) as Record<string, unknown>
    const latest = latestVerdictPayload.verdict === "rejected" ? latestVerdictPayload : undefined
    if (latest) {
      ctx.push("")
      ctx.push("### Latest acceptance-agent feedback")
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
      "You decide what to do next from the trajectory + latest acceptance feedback above: " +
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
  ctx.push(renderTaskDescription(snapshot, { autoIteration }))

  // ── Workflow guidance (injected as recommended path, not enforced) ──
  if (workflow && workflowState) {
    ctx.push("")
    ctx.push(renderWorkflowPrompt(workflow, workflowState))
  }

  // Run context — acceptance + eval results for the current active run (if
  // any). Rendered on every wake from persistent DB state so the orchestrator
  // sees latest results without depending on a trigger enum to deliver them.
  // The yielded summary is framed as a sub-agent-protocol message with the
  // same per-message ceiling as a tool return; full content stays in the
  // acceptance / evaluation rows referenced via the pointer.
  const activeRunID = findActiveRunForTask(task.id)?.id
  if (activeRunID) {
    const acceptance = findAcceptanceByRun(activeRunID)
    const evaluation = findEvaluationByRun(activeRunID)
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
      if (acceptance) pointerHints.push(`read_context scope=deliveries (acceptance row ${acceptance.id})`)
      if (evaluation) pointerHints.push(`read_context scope=evaluations (evaluation row ${evaluation.id})`)
      const pointer = pointerHints.length > 0 ? pointerHints.join("; ") : "read_context"

      ctx.push("")
      ctx.push(
        SubAgentProtocol.yieldResult({
          headline: `## Latest Run Result (run ${activeRunID})`,
          fields,
          pointer,
        }),
      )
    }
  }

  return [ORCHESTRATOR_INSTRUCTIONS, ctx.join("\n")]
}
