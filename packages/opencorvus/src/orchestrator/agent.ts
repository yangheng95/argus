/**
 * Orchestrator — master agent in the Agent Team architecture.
 *
 * Per spec/new-arch/16-unified-teardown.md §3, the orchestrator has no typed
 * trigger enum — it is woken by *events* (task creation, goal batch finish,
 * delivery verdict, operator message) carried as a free-form note. On every
 * wake it reads its full state from the describe layer + the artifact stream
 * and decides what to do next. Callers may pass an optional `event.note`
 * string to hint WHY they just woke the orchestrator; every decision derives
 * from the describe snapshot, not from the note's content.
 *
 * The orchestrator controls the entire pipeline via tools:
 * requirements → goals → plan → execute → eval → delivery verify → publish
 * All other agents (requirements, architect, plan, eval, delivery) are subordinate workers.
 *
 * ── Why this file does NOT use `runAgentSession` ───────────────────────────
 *
 * The orchestrator is the HOST of the worker-session pattern that
 * `src/agent/runner.ts` abstracts — not a user of that pattern. Worker
 * agents (build, delivery, integrity, prosecutor, requirements, architect,
 * design-analyst, intent-analysis) collapse into the runner's shape because
 * they all share: single composed system prompt, terminal collector contract,
 * thrown AgentRunError on stream / abort failure, no step-level coordination.
 *
 * The orchestrator deliberately diverges on every one of those axes:
 *   - Two-part system prompt (static + per-wake describe / iteration / verdict)
 *   - `withStepHook` wrapping `withExtraTools` so deferred-stop finalises after
 *     every assistant step (dispatch tools opt to abort the orchestrator's
 *     turn once their child sessions are launched).
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
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import type { Message } from "@/session/message"
import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import { toolGuard } from "@/util/tool-guard"
import { createOrchestratorTools } from "./tools"
import { SubAgentProtocol } from "@/agent/sub-agent-protocol"
import { AttachmentStore } from "@/storage/attachment-store"
import { readIterationHistory as readHistForPrompt } from "@/metrics/store"
import {
  findActiveRunForTask,
  findDeliveryByRun,
  findEvaluationByRun,
  requireTask,
  updateTask,
  WorkflowRegistry,
  createWorkflowState,
  renderWorkflowPrompt,
} from "@/engine"
import { EngineProtocol } from "@/engine/protocol"
import { Event as EngineEvent } from "@/engine/model"
import { describeTask, renderTaskDescription } from "@/engine/describe"
import type { TaskRow, WorkflowState, MiniWorkflow } from "@/engine"
import { AgentTrace } from "@/trace"

const log = Log.create({ service: "orchestrator" })
// MAX_STEPS lives on agent.orchestrator.steps in src/agent/agent.ts. SessionLoop
// reads that directly via Agent.get("orchestrator") — no local constant needed.

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
   *  If absent, the task's original request is
   *  used when the orchestrator has no prior invocation for this task;
   *  otherwise a generic "re-read context and decide" prompt is used. */
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
    abort(taskID)
    const ctrl = new AbortController()
    running.set(taskID, ctrl)

    let stopSignal: AbortSignal | undefined
    let agentSessionID: string | undefined
    try {
      const task = requireTask(taskID)
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
      const workflowID = await WorkflowRegistry.defaultID()
      const workflow = await WorkflowRegistry.resolve(workflowID) ?? WorkflowRegistry.resolveSync("pipeline")
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

      // 1. Resolve model — respects agent.task.model in user config; otherwise
      //    inherits the user's most recent in-session model pick from the
      //    originating task session; otherwise Provider.defaultModel().
      const model = await resolveAgentModel("orchestrator", { sessionID: task.session_id }).catch((e) => {
        log.error("orchestrator: no LLM model available", { taskID, error: e instanceof Error ? e.message : String(e) })
        return undefined
      })
      if (!model) return

      // 2. Create child session. Each processTask invocation uses a fresh
      //    child session. LLM context is reconstructed from DB state (goals,
      //    runs, deliveries, decision log) via buildSystemParts on each
      //    invocation — the session is only for UI / audit persistence, not
      //    for LLM context accumulation.
      const agentSession = await Session.createNext({
        kind: "orchestrator",
        parentID: task.session_id,
        title: `Agent: ${task.title}`,
        directory: Instance.directory,
      })
      agentSessionID = agentSession.id


      // 3. Create tools (agentSessionID passed so tool sessions become children)
      const { tools, stopSignal: dispatchSignal, finalizeDeferredStop } = createOrchestratorTools({
        taskID,
        agentSessionID: agentSession.id,
        signal: ctrl.signal,
        workflow,
        workflowState,
        operatorMessage: event?.operatorMessage,
      })
      stopSignal = dispatchSignal
      const guard = toolGuard(tools)
      const enableMap: Record<string, boolean> = Object.fromEntries(
        Object.keys(guard.tools).map((name) => [name, true]),
      )

      // 4. Build prompt. First wake uses the task's original request as the
      //    user message (the user's actual intent). Subsequent wakes use the
      //    event.note if provided, otherwise a generic re-read instruction.
      //    No trigger-kind switch — every decision branch downstream reads
      //    the describe snapshot, not this string.
      const system = await buildSystemParts(task, event, workflow, workflowState)
      const userText = isFirstWake
        ? task.request
        : (event?.note ?? "Task state has advanced. Re-read the context snapshot and decide the next action.")
      // Build multimodal content when task has file attachments (only for the
      // first wake, because that is when the user's original attachments are
      // introduced). AttachmentStore.partition routes image/audio/video/pdf
      // to inline file parts and text/* / json to a URL-only reference list;
      // see helper comments for the silent-rejection rationale.
      const attachments = isFirstWake && Array.isArray(task.attachments)
        ? (task.attachments as Array<{ sha?: string; url?: string; mime?: string; size?: number; filename?: string }>)
        : undefined
      const { referenceOnly } = AttachmentStore.partition(attachments)
      const inlineFileParts = await AttachmentStore.inlineFileParts(attachments)
      // Orchestrator is the orchestrator; it does NOT own a `read` tool.
      // Attachments are forwarded automatically to the sub-agents it dispatches
      // (requirements / design_analysis / architect via the `requirements` /
      // `design_analysis` / `architect` tools), which DO have read access. The
      // inventory below tells the Orchestrator what's available when deciding
      // which sub-agent to invoke; the trailing instruction is a HARD design
      // constraint (no read tool here), not a fallback hint.
      const referenceText = referenceOnly.length
        ? AttachmentStore.renderReferenceList(referenceOnly).replace(
            "## Task Attachments (read via the `read` tool when you need their content)",
            "## Task Attachments (forwarded to sub-agents automatically)",
          ) +
          "\n\nDo NOT attempt to read these yourself — invoke the appropriate sub-agent (requirements / design_analysis / architect) which receives the attachments and can read them via its `read` tool."
        : ""
      const enrichedUserText = userText + referenceText
      // Build PromptInput.parts. Text first, then any multimodal attachments
      // as FilePart (data URL) so Session.saveMessage can persist the part
      // without re-resolving a local file path.
      const parts: Array<
        | { type: "text"; text: string }
        | { type: "file"; url: string; mime: string; filename?: string }
      > = [{ type: "text", text: enrichedUserText }, ...inlineFileParts]
      const partsWithIds = parts.map((p) => ({ ...p, id: Identifier.ascending("part") }))

      log.info("orchestrator starting", {
        taskID,
        firstWake: isFirstWake,
        note: event?.note,
        sessionID: agentSession.id,
        model: `${model.providerID}/${model.id}`,
        toolCount: Object.keys(tools).length,
      })

      // Abort hooks: both ctrl.signal (external interrupt) and stopSignal
      // (deferred-stop from dispatch tools) translate to SessionPrompt.cancel
      // on the child session so the loop releases its processor cleanly.
      const abortPrompt = () => {
        try {
          SessionPrompt.cancel(agentSession.id)
        } catch {
          /* session may already be stopped */
        }
      }
      ctrl.signal.addEventListener("abort", abortPrompt, { once: true })
      const stopSignalListener = stopSignal
        ? () => abortPrompt()
        : undefined
      if (stopSignal && stopSignalListener) {
        stopSignal.addEventListener("abort", stopSignalListener, { once: true })
      }

      // Subscribe to session-level errors so critical stream failures still
      // flip the task to failed. SessionLoop publishes Session.Event.Error on
      // provider / processor faults; collecting them here reproduces the
      // the pre-migration runtime.failures snapshot at a coarser granularity.
      const streamErrors: Array<{ reason: string; errorName?: string }> = []
      const errorUnsub = Bus.subscribe(Session.Event.Error, (evt) => {
        const props = evt.properties as { sessionID: string; error: { message?: string; name?: string } }
        if (props.sessionID !== agentSession.id) return
        const msg = props.error?.message ?? "unknown session error"
        streamErrors.push({ reason: msg, errorName: props.error?.name })
      })

      // 5. Run the orchestrator session — tools via withExtraTools, deferred
      //    stop via withStepHook. Step limit lives on agent.orchestrator.steps.
      let finalMessage: Message.WithParts | undefined
      try {
        await SessionPrompt.withExtraTools(agentSession.id, guard.tools as any, async () => {
          await SessionPrompt.withStepHook(agentSession.id, () => {
            const stopReason = finalizeDeferredStop()
            if (stopReason) {
              log.info("orchestrator deferred stop finalized", { taskID, reason: stopReason })
            }
          }, async () => {
            finalMessage = (await SessionPrompt.prompt({
              sessionID: agentSession.id,
              model: { providerID: model.providerID, modelID: model.api.id },
              agent: "orchestrator",
              system: Array.isArray(system) ? system.join("\n\n") : system,
              tools: enableMap,
              parts: partsWithIds,
            })) as Message.WithParts
          })
        })
      } finally {
        errorUnsub()
        ctrl.signal.removeEventListener("abort", abortPrompt)
        if (stopSignal && stopSignalListener) stopSignal.removeEventListener("abort", stopSignalListener)
      }

      const assistantInfo = finalMessage?.info as Message.Assistant | undefined
      log.info("orchestrator finished", {
        taskID,
        note: event?.note,
        sessionID: agentSession.id,
        finishReason: assistantInfo?.finish,
        streamErrors: streamErrors.length,
      })

      if (AgentTrace.isEnabled()) {
        const finalText = finalMessage?.parts
          ?.filter((p) => p.type === "text")
          .map((p) => (p as { text: string }).text)
          .join("\n\n")
        AgentTrace.recordAgentReport({
          sessionID: agentSession.id,
          parentSessionID: task.session_id ?? undefined,
          taskID,
          agentName: "orchestrator",
          kind: "orchestrator_wake",
          finishReason: assistantInfo?.finish,
          finalText,
          streamErrors: streamErrors.map((e) => ({ reason: e.reason, name: e.errorName })),
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
        const { recordOrchestratorStreamError } = await import("@/engine/persist")
        recordOrchestratorStreamError({
          taskID,
          reason,
          errorName: first?.errorName,
          sessionID: agentSession.id,
          now: Date.now(),
        })
      }

    } catch (error) {
      // SessionLoop persists its own assistant parts; no explicit flush
      // equivalent for the post-phase-3 the pre-migration runtime hooks path.
      if (ctrl.signal.aborted) {
        log.info("orchestrator was aborted", { taskID })
        return
      }
      // stopSignal abort is a normal termination (submit_execution/dispatch/dispatch_goal
      // dispatched work). NOT an error — the agent will be re-triggered on completion.
      if (stopSignal?.aborted) {
        log.info("orchestrator stopped after dispatch", { taskID, note: event?.note })
        return
      }
      const msg = error instanceof Error ? error.message : String(error)
      log.error("orchestrator failed", { taskID, note: event?.note, error: msg })
      if (AgentTrace.isEnabled() && agentSessionID) {
        AgentTrace.recordAgentReport({
          sessionID: agentSessionID,
          taskID,
          agentName: "orchestrator",
          kind: "orchestrator_wake_failure",
          error: msg,
        })
      }
      // Surface the error on the task so UI/orphan-recovery can see it.
      // Don't change task status — let orphan recovery decide the next step.
      try {
        const current = requireTask(taskID)
        const { isTaskTerminal } = await import("@/engine/task-status")
        if (!isTaskTerminal(current)) {
          await updateTask(current, { error: `Orchestrator error: ${msg}` }, `Orchestrator failed: ${msg}`)
        }
      } catch { /* task may have been deleted */ }
    } finally {
      running.delete(taskID)
    }
  }
}

// ---------------------------------------------------------------------------
// Standard event notes — free-form hints passed through OrchestratorEvent.note.
// Exported so every caller synthesizes the same wording; changing a note's text
// is a one-point edit. None of these strings gate control flow — the describe
// snapshot is the source of truth the orchestrator reads for every decision.
// ---------------------------------------------------------------------------

export const OrchestratorEventNote = {
  batchComplete(input: {
    runID: string
    passed: number
    failed: number
    total: number
    depBlocked?: Array<{ goalTitle: string; blockedBy: Array<{ title: string; status: string }> }>
  }): string {
    const lines: string[] = [
      `Goal batch complete on run ${input.runID}.`,
      `Summary: ${input.passed} passed, ${input.failed} failed, ${input.total} total.`,
    ]
    if (input.depBlocked && input.depBlocked.length > 0) {
      lines.push("", "⚠ BLOCKED GOALS — the following pending goals CANNOT execute because their dependencies failed:")
      for (const b of input.depBlocked) {
        const deps = b.blockedBy.map((d) => `${d.title} [${d.status}]`).join(", ")
        lines.push(`  • "${b.goalTitle}" blocked by: ${deps}`)
      }
      lines.push(
        "",
        "ACTION REQUIRED: resolve the blocking goals before these can proceed. Call query_failed_goals, then build({ goalID, request }) with root cause or fail_task.",
      )
    } else {
      lines.push(
        "",
        "Read context (read_context) to see goal statuses and eval evidence.",
        "Decide next action based on current state — no predetermined action.",
      )
    }
    return lines.join("\n")
  },

  operatorMessage(input: { text: string; attachmentSummary?: string }): string {
    const lines: string[] = [input.text]
    if (input.attachmentSummary) {
      lines.push("", input.attachmentSummary)
    }
    return lines.join("\n")
  },

  retry(task: TaskRow): string {
    return `User requested retry.${task.error ? ` Previous error: ${task.error}` : ""}\nDecide how to proceed.`
  },
}

// ---------------------------------------------------------------------------
// System prompt — split into stable instructions (cacheable) and dynamic context
// ---------------------------------------------------------------------------

/** Static instructions that never change between invocations. */
const ORCHESTRATOR_INSTRUCTIONS = ORCHESTRATOR_CORE

/**
 * Build the orchestrator system prompt as a two-part array:
 *   [0] = static instructions (stable, benefits from 1h cache TTL)
 *   [1] = dynamic context — task state, goals, budget, latest delivery
 *         feedback, latest run result. All derived from DB state; no trigger
 *         enum branching. The optional `event.note` is the USER MESSAGE,
 *         not a prompt segment — do not thread it through here.
 */
async function buildSystemParts(task: TaskRow, _event: OrchestratorEvent | undefined, workflow?: MiniWorkflow, workflowState?: WorkflowState): Promise<string[]> {
  const ctx: string[] = []

  // ── Follow-up task context ──
  // When the delivery agent's `submit_next_task` spawned this task (for any
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

  // ── Delivery trajectory ──
  // Source of truth for iteration history is engine_iteration (Arbiter-owned).
  // We render the last few iterations' snapshots + the latest rework signal
  // (verdict summary + issues) so the assistant sees both the aggregated
  // signal AND the concrete delivery-agent feedback for the most recent round.
  // Call `query_metric_trajectory` for the full detail including per-metric
  // results and open counterexamples.
  const iterationHistory = readHistForPrompt(task.id)
  if (iterationHistory.length > 0) {
    const RENDER_RECENT = 3
    const tail = iterationHistory.slice(-RENDER_RECENT)
    ctx.push("## Delivery Trajectory")
    ctx.push(`${iterationHistory.length} prior iteration(s). Last ${tail.length}:`)
    for (const it of tail) {
      ctx.push(
        `  - iter ${it.iteration}: arbiter=${it.arbiter_verdict}, S_k=${it.aggregate_score.toFixed(3)} (Δ=${it.delta_vs_prev.toFixed(3)}), blocking_unmet=${it.blocking_unmet_count}, open_ce=${it.open_counterexamples}, novelty=${it.novelty_score}`,
      )
    }
    // Latest delivery feedback comes from the most recent
    // delivery-agent-verdict artifact on the task. Shown only when the
    // most recent verdict was a rejection — per spec there is no trigger
    // enum steering this block, it is derived from persistent artifacts.
    const { findLatestDeliveryVerdictArtifact } = await import("@/engine/store")
    const latestVerdictArt = findLatestDeliveryVerdictArtifact(task.id)
    const latestVerdictPayload = (latestVerdictArt?.payload ?? {}) as Record<string, unknown>
    const latest = latestVerdictPayload.verdict === "rejected"
      ? latestVerdictPayload
      : undefined
    if (latest) {
      ctx.push("")
      ctx.push("### Latest delivery-agent feedback")
      const summary = typeof latest.summary === "string" ? latest.summary : ""
      if (summary) ctx.push(`Summary: ${summary}`)
      const details = Array.isArray(latest.rejection_details)
        ? (latest.rejection_details as Array<Record<string, string>>)
        : []
      // Single source of truth (rule 22): the human-readable issues list is
      // derived from rejection_details[].error here, not stored as a
      // separate `issues_found` field on the verdict payload.
      const issues = details
        .map((d) => (typeof d.error === "string" ? d.error : ""))
        .filter((s) => s.length > 0)
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
      "Call `query_metric_trajectory` for full per-metric results + counterexamples. " +
      "You decide what to do: patch code, modify/add goals, adjust scope — based on where the trajectory is stuck.",
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
    ctx.push(renderWorkflowPrompt(workflow, workflowState))
  }

  // Run context — delivery + eval results for the current active run (if
  // any). Rendered on every wake from persistent DB state so the orchestrator
  // sees latest results without depending on a trigger enum to deliver them.
  // The yielded summary is framed as a sub-agent-protocol message with the
  // same per-message ceiling as a tool return; full content stays in the
  // delivery / evaluation rows referenced via the pointer.
  const activeRunID = findActiveRunForTask(task.id)?.id
  if (activeRunID) {
    const delivery = findDeliveryByRun(activeRunID)
    const evaluation = findEvaluationByRun(activeRunID)
    if (delivery || evaluation) {
      const fields: Array<[string, string | string[]]> = []
      if (delivery) {
        fields.push(["delivery_summary", delivery.summary])
        const changedFiles = delivery.result?.changed_files
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
      if (delivery) pointerHints.push(`read_context scope=deliveries (delivery row ${delivery.id})`)
      if (evaluation) pointerHints.push(`read_context scope=evaluations (evaluation row ${evaluation.id})`)
      const pointer = pointerHints.length > 0 ? pointerHints.join("; ") : "read_context"

      ctx.push("")
      ctx.push(SubAgentProtocol.yieldResult({
        headline: `## Latest Run Result (run ${activeRunID})`,
        fields,
        pointer,
      }))
    }
  }

  return [ORCHESTRATOR_INSTRUCTIONS, ctx.join("\n")]
}
