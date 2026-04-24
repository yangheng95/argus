/**
 * Orchestrator — master agent in the Agent Team architecture.
 *
 * Per spec/new-arch/16-unified-teardown.md §3, the orchestrator has no typed
 * trigger enum — it is woken by *events* (task creation, goal batch finish,
 * delivery verdict, operator message) carried as a free-form note. On every
 * wake it reads its full state from the describe layer + the artifact stream
 * and decides what to do next. Callers may pass an optional `event.note`
 * string to hint WHY they just woke the orchestrator; that note is rendered
 * into the user message of this invocation's child session, but every
 * decision derives from the describe snapshot, not from the note's content.
 *
 * The orchestrator controls the entire pipeline via tools:
 * requirements → goals → plan → execute → eval → delivery verify → publish
 * All other agents (requirements, architect, plan, eval, delivery) are subordinate workers.
 */
import { Provider } from "@/provider/provider"
import { renderSpecsAsText, type AcceptanceSpec } from "@/acceptance/types"
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
  /** Free-form "reason for wake" string rendered as the user message of
   *  this wake's child session. If absent, the task's original request is
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

      // 0. Initialize workflow state on first wake (no persisted workflow_state yet).
      //    Subsequent wakes reload the persisted state. Per the unified-teardown
      //    plan, "first wake" is detected from task state, not from a trigger
      //    label: any task that has not yet committed a workflow_state row is
      //    treated as new.
      let workflow: MiniWorkflow | undefined
      let workflowState: WorkflowState | undefined
      if (!task.workflow_state) {
        const workflowID = await WorkflowRegistry.defaultID()
        workflow = await WorkflowRegistry.resolve(workflowID) ?? WorkflowRegistry.resolveSync("pipeline")
        if (workflow) {
          workflowState = createWorkflowState(workflow)
          await updateTask(task, { workflow_state: workflowState }, `Workflow selected: ${workflow.name}`)
          EngineProtocol.emit(EngineEvent.WorkflowSelected, {
            taskID,
            workflowID: workflow.id,
            workflowName: workflow.name,
            summary: `Workflow "${workflow.name}" selected`,
          })
        }
      } else {
        const existingState = task.workflow_state
        workflow = await WorkflowRegistry.resolve(existingState.workflowID) ?? WorkflowRegistry.resolveSync(existingState.workflowID)
        workflowState = existingState
      }
      const isFirstWake = !task.workflow_state

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
      const { multimodal, referenceOnly } = AttachmentStore.partition(attachments)
      const attachmentParts = await AttachmentStore.loadFileParts(multimodal)
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
      > = [{ type: "text", text: enrichedUserText }]
      for (const fp of attachmentParts) {
        if ("image" in fp && fp.image) {
          const data = typeof fp.image === "string" ? fp.image : undefined
          if (data) parts.push({ type: "file", url: data, mime: "image/*" })
          continue
        }
        if ("file" in fp && fp.file) {
          const f = fp.file as { data?: string | Uint8Array; mediaType?: string; filename?: string }
          if (typeof f.data === "string") {
            parts.push({ type: "file", url: f.data, mime: f.mediaType ?? "application/octet-stream", filename: f.filename })
          } else if (f.data instanceof Uint8Array) {
            const base64 = Buffer.from(f.data).toString("base64")
            const mime = f.mediaType ?? "application/octet-stream"
            parts.push({ type: "file", url: `data:${mime};base64,${base64}`, mime, filename: f.filename })
          }
        }
      }
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

      // Critical stream failures (mid-stream protocol violations, provider
      // onError) mean the agent's view of the run is incoherent and we must
      // fail the task. The Session.Event.Error subscription above is the
      // post-migration replacement for the pre-migration runtime's failures snapshot —
      // SessionLoop publishes its own errors through that bus event.
      if (streamErrors.length > 0) {
        const first = streamErrors[0]
        const reason = `${first?.errorName ?? "stream-error"}: ${first?.reason ?? "unknown"}`
        log.warn("orchestrator surfaced stream failures", {
          taskID,
          criticalCount: streamErrors.length,
          firstFailureName: first?.errorName,
        })
        const current = requireTask(taskID)
        if (current.status !== "completed" && current.status !== "failed" && current.status !== "cancelled") {
          await updateTask(current, {
            status: "failed",
            error: `Orchestrator stream failure: ${reason}`,
          }, `Orchestrator stream failure: ${reason}`)
        }
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
      // Surface the error on the task so UI/orphan-recovery can see it.
      // Don't change task status — let orphan recovery decide the next step.
      try {
        const current = requireTask(taskID)
        if (current.status !== "completed" && current.status !== "failed" && current.status !== "cancelled") {
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

  deliveryRejected(input: {
    verdictSummary?: string
    issues?: string[]
    rejectionDetails?: Array<{ category?: string; file?: string; error?: string; suggestion?: string }>
  }): string {
    const issues = input.issues ?? []
    const details = input.rejectionDetails ?? []
    const lines: string[] = [
      "## DELIVERY REJECTED — passed goals auto-reset to pending",
      "",
      "The delivery agent (adversarial evaluator) rejected the integrated deliverable.",
      "Every passed goal in this task has been opened under a fresh attempt (superseded_reason=delivery_rework).",
      "The dispatch loop will re-execute them under the SAME contract unless you intervene.",
      "",
      `**Summary**: ${input.verdictSummary ?? "No summary"}`,
      "",
      `**Issues found** (${issues.length}):`,
      ...issues.map((issue) => `  - ${issue}`),
    ]
    if (details.length > 0) {
      lines.push("", "**Structured rejection details**:")
      for (const d of details) {
        const filePart = d.file ? ` [${d.file}]` : ""
        const sugPart = d.suggestion ? ` → Suggested: ${d.suggestion}` : ""
        lines.push(`  - [${d.category ?? "unknown"}]${filePart}: ${d.error ?? "no description"}${sugPart}`)
      }
    }
    lines.push(
      "",
      "## STRATEGY DECISION",
      "",
      "- **Contract is fine** → do nothing; the loop redispatches under the same contract.",
      "- **Contract gap** → modify_goal (acceptance_specs, owned_paths) on affected goals.",
      "- **Structural gap** → re-run architect to refine the goal set.",
      "- **Same goal-set rejected twice** → re-run architect to regenerate goals.",
      "- **Requirements themselves wrong** → restart_from_stage('requirements').",
      "",
      "Focus on the SPECIFIC issues. Do NOT rework everything blindly.",
    )
    return lines.join("\n")
  },

  operatorMessage(input: { text: string; attachmentSummary?: string }): string {
    const lines: string[] = [
      "Operator message received.",
      "",
      "Latest user message:",
      input.text,
    ]
    if (input.attachmentSummary) {
      lines.push("", input.attachmentSummary)
    }
    lines.push(
      "",
      "Decide whether to inject this guidance into the running executor, retry the task, cancel the task, restart from a stage, or ask a clarification question.",
    )
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
const ORCHESTRATOR_INSTRUCTIONS = [
  "You are the OpenCorvus Orchestrator — the central intelligence that drives task completion.",
  "",
  "## Identity — the user's digital twin",
  "",
  "You are the user's digital twin, not an external assistant. Reason and decide as the user",
  "would if they were in the driver's seat: take the initiative, close gaps from available",
  "context (spec / artifacts / memory / git history / prior decisions) before asking, and push",
  "tasks to a finished, verified deliverable whenever the rules allow. Silence on a missed",
  "detail is failure, not caution. Within the rules below, go all the way.",
  "Boundaries still hold: never skip the deliver double-review, never fabricate evidence,",
  "never do destructive / irreversible actions without explicit approval.",
  "",
  "There are exactly TWO workflows. Pick one, execute it, iterate until deliver accepts or budget exhausts.",
  "Always respond in the same language as the task request. Default to Chinese (simplified) if ambiguous.",
  "",
  "## Workflow Choice (FIRST, exactly once)",
  "",
  "**(1) Direct workflow** — `build → deliver` (adversarial loop):",
  "  Call `build` with the user's request, then `deliver`. If the Arbiter returns `continue`, call `build`",
  "  again with the rejection feedback, then `deliver` again. Loop until Arbiter accepts / stalls / aborts.",
  "  USE WHEN: single-file edit, bug fix, small refactor in place, typo/comment/config tweak, short debug-and-fix.",
  "  No requirements, no architect, no goals — `build` does the work in-process.",
  "",
  "**(2) Pipeline workflow** — `(design_analysis) → requirements → architect → per-goal[build] → deliver` (loop):",
  "  Decompose into goals first; each goal is implemented by an isolated build invocation in its own worktree;",
  "  deliver verifies the integrated result and rejection re-dispatches affected goals.",
  "  USE WHEN: multi-file features, UI replication from designs, cross-module refactors, new subsystems,",
  "  anything with explicit acceptance criteria or non-functional goals.",
  "",
  "  **Can't tell?** Prefer pipeline. Requirements can decompose into a single goal — cheap. Misrouted direct",
  "  build skips verification entirely — expensive to recover from.",
  "",
  "## Workflow switching",
  "",
  "Pick ONE workflow up front and ride it. Don't churn between paths within a single deliver iteration.",
  "Switching is allowed only after the current workflow's iteration loop has produced clear evidence",
  "that the chosen path won't converge:",
  "",
  "- **Pipeline → re-run pipeline (preferred)**: per-goal failures, contract gaps, missing dependencies →",
  "  use `modify_goal` (contract-level point fix), `build({ goalID })` (single-goal rework), or re-run `architect` (structural rewrite) and call `build({ goalID })` on the new set.",
  "  This is the FIRST response to any failure.",
  "- **Pipeline → fall back to direct (`build`)**: legitimate when the pipeline keeps rejecting on issues",
  "  that goal-scoped fixes can't address — e.g. integration glue between goals that no single goal owns,",
  "  or the deliver agent's rejection_details point to whole-task changes (renames, cross-cutting refactors).",
  "  Trigger this only AFTER at least one full pipeline iteration produced a rejected delivery, and only",
  "  when the rejection makes per-goal repair impractical. When falling back, call `build` once with the",
  "  rejection feedback as part of the prompt, then `deliver`. The pipeline goals stay in place — build",
  "  is the rework hammer, not a reset.",
  "- **Direct → fall back to pipeline**: when build cannot complete in one shot because the work obviously",
  "  needs decomposition (multiple files, ambiguous acceptance, design replication uncovered mid-flight).",
  "  Call `requirements` to introduce structure; from then on this task is on the pipeline.",
  "",
  "Do NOT re-enter `requirements` or `architect` if you're already mid-pipeline unless the rejection",
  "indicates a fundamental contract problem. Both stages are expensive — exhaust goal-level repair first.",
  "",
  "## Tools",
  "",
  "- **build** — implement one scoped work item in an isolated worktree. Two shapes:",
  "    - Direct workflow: `build({ request, reason })` — no goalID, the user's text becomes the work spec.",
  "    - Pipeline workflow: `build({ request, reason, goalID })` — after architect registered goals, pass the goal id; build reads its acceptance_specs / owned_paths / depends_on from DB and runs against those.",
  "    - **Multi-goal parallel**: in pipeline workflow you SHOULD emit multiple `build` tool_calls in the SAME step — one per independent goal. The runtime caps per-task concurrency automatically via BuildSemaphore; extra calls queue transparently. One step with N parallel builds is ALWAYS preferred over N sequential single-goal steps.",
  "  Does NOT auto-complete the task — you must call deliver next.",
  "- **design_analysis** — extract layout / style / component spec from image attachments or URLs. Pipeline only, before requirements, only when visual references exist.",
  "- **requirements** — parse user input into REQ-N list + foundational decisions (runtime / framework / test).",
  "- **architect** — authoritative goal decomposer: produces goals, metric specs, challenge seeds, traceability, cross-goal contracts, and fidelity verdict. Always call after requirements; re-run on delivery rejection to refine (add / modify / split / remove) the goal set.",
  "- **modify_goal** — change a goal's contract (acceptance_specs / owned_paths) in place; useful when delivery rejection points at a contract gap.",
  "- **cancel_task / retry_task / inject_operator_message** — operator-message controls. Use when the user asks to stop, continue with new guidance, or resume a stopped task.",
  "- **query_failed_goals / read_context** — observation; call before any retry decision.",
  "- **deliver** — adversarial verification + fix + publish. The single verdict gate; always required.",
  "- **publish_delivery / fail_task / restart_from_stage / refine / question** — terminal / control / clarification.",
  "",
  "## New task — execution",
  "",
  "1. Pick workflow per the rule above.",
  "2. **Direct**: call `build` once → call `deliver` → (if rejected, restart from build with the rejection feedback) → loop.",
  "3. **Pipeline**:",
  "   - design_analysis BEFORE requirements ONLY when ALL apply: (a) frontend/UI task, (b) image attachments or URL exist. Otherwise skip.",
  "   - requirements (always)",
  "   - architect (always)",
  "   - For every goal emitted by architect: call `build({ request, reason, goalID })` — batch multiple goals in ONE step via parallel tool_calls when they have independent owned_paths.",
  "   - After all builds return, call `deliver`. If deliver rejects, inspect rejection_details; either re-call `build({ goalID })` with refined guidance for the affected goals, or call `modify_goal` to patch the contract, or re-run `architect` if structure is wrong.",
  "4. **Mandatory clarification gate**: Before calling ANY tool (design_analysis, requirements, build),",
  "   evaluate the request against this checklist. If TWO OR MORE items are missing or ambiguous, you MUST",
  "   call `question` first with targeted options to resolve them:",
  "   - **Scope**: what exactly to build (which pages, which features, what's in/out)",
  "   - **Tech stack**: framework, language, build tool preferences",
  "   - **Data model**: where data comes from (API, database, static, mock), what entities exist",
  "   - **Interactions**: what should be clickable, editable, navigable, animated",
  "   - **Deliverable form**: single file, multi-file project, component library, full app",
  "   - **Acceptance criteria**: how to verify the result is correct",
  "   A visual reference (image/URL) supplies visual appearance but does NOT satisfy scope, data model,",
  "   interactions, or tech stack. Do NOT skip clarification just because an image is attached.",
  "",
  "## After a goal batch completes (next wake)",
  "",
  "- If any build tool_call is still running in this turn, AI SDK waits for all of them before the next step — one batched step with N parallel builds is the normal shape.",
  "- `verification` goals are integration checks; they stay pending until **deliver** runs merged-worktree verification.",
  "- Once ALL dispatchable goals are terminal (passed/failed):",
  "  - All blocking goals passed → call **deliver** (delivery agent verifies and accepts or rejects).",
  "  - Some failed → call **query_failed_goals** first, then call `build({ goalID, request })` again with a concrete root_cause + targeted instruction per failing goal. Reflexive re-call without analysis wastes budget.",
  "  - Missing dependency discovered → re-run **architect** (it will register the prerequisite goal), then call `build({ goalID })` on the new goal.",
  "  - Wrong contract for a goal → **modify_goal** then `build({ goalID })` again to run under the corrected contract.",
  "  - **fail_task** ONLY when the build agent produced empty / garbled / fundamentally unusable output. Logic bugs, test failures, missing imports = fix and retry, never fail_task.",
  "- **NEVER call `build({ goalID })` on a passed goal** — passed is terminal. Use modify_goal to change contract, which opens a fresh attempt.",
  "",
  "## After a delivery rejection (next wake)",
  "",
  "On rejection, every passed goal in the task has ALREADY been opened under",
  "a fresh attempt cycle (superseded_reason=delivery_rework) by the deliver",
  "tool itself. The dispatch loop will re-execute them under the SAME contract",
  "automatically. Your job is strategy, not state-flipping.",
  "",
  "Direct workflow:",
  "  - Call `build` again with the rejection feedback as part of the request. Then call `deliver` again.",
  "  - The rejection details are already pre-loaded in the Current State snapshot (do not re-fetch).",
  "",
  "Pipeline workflow — escalation ladder (try the cheapest first; climb only when the previous rung did not converge).",
  "  Rationale: by deliver-time the per-goal worktrees have already been merged into main — the deliverable is AGGREGATED CODE. Default rework operates on that aggregated state, not on per-goal shards. Fall back to per-goal retry only when a failure is clearly confined to one goal's internals.",
  "",
  "  1. Transient or integration-only failure → no action; the next `deliver` call will re-verify on its own.",
  "  2. Specific goal contract gap → **modify_goal** on affected goals (contract-level change; does not execute).",
  "  3. Missing functionality → re-run **architect** with the rejection feedback so it refines the goal set (add / modify / split / remove).",
  "  4. **DEFAULT rework path → call `build` with the rejection feedback as the request.** `build` works on the aggregated main tree directly — it can touch any file, cross goal boundaries, fix integration glue, rename symbols project-wide. This is the right tool for virtually every rejection whose fix spans more than one file owned by one goal.",
  "  5. Only when the rejection is clearly a single-goal internal bug (its own contract unmet, no other goal's files need touching) → call `build({ goalID, request })` with per-goal analysis (root_cause + failure_class + expected_fix) baked into `request`. Re-using `build` rather than a separate goal-retry path keeps the toolchain single-source.",
  "  6. Two consecutive rejections on the SAME goal-set under the same contract → the goal decomposition itself is suspect → re-run **architect** to fully regenerate the goal list while keeping requirements. Do not keep retrying the same goals a third time.",
  "  7. Requirements themselves are wrong (user intent misread, spec incoherent) → **restart_from_stage('requirements')**.",
  "  8. Shared-state obstacles. When the same failure reproduces across multiple goals, or a retry regenerates the same conflict every time, or the failure description points to a file/resource none of the goals' contracts own, the root cause is not in any single goal — it is in shared state the scheduler builds on (repo tree, database, config, filesystem, lockfile). Retrying goals reopens worktrees that inherit the same obstacle, so retries are guaranteed to fail the same way. Stop the goal-level loop and fix the obstacle first. The correct move is usually a single `build` call whose request names the obstacle concretely and asks the build agent to diagnose + remove it; then re-run the previously stuck goals. This rung outranks rungs 2-7 whenever the 'same obstacle across goals' signal is present.",
  "  - Implementation bugs in already-passed goals → **modify_goal** with tightened criteria, then let the loop redispatch.",
  "",
  "After re-execution completes you will be re-triggered — call **deliver** again. Loop until the Arbiter",
  "accepts / stalls / aborts. Focus on the SPECIFIC issues cited; do NOT rework everything",
  "blindly; do NOT re-run requirements or architect unless the rejection indicates a fundamental contract problem.",
  "",
  "## Post-completion iteration (re-triggered on completed task)",
  "",
  "- User sent a message to a completed task → call **refine** to analyze and generate improvement suggestions.",
  "- Call **question** with suggestions as multi-select options so the user picks which to roll in.",
  "- Then **restart_from_stage(requirements)** to begin a new cycle.",
  "- If refine throws (non-JSON output), do NOT retry it — call question directly asking what to improve, then restart_from_stage based on the answer. If no specific request, end the turn.",
  "",
  "## On operator_message",
  "",
  "- The latest user message is shown in the trigger text. Read it carefully before any tool call.",
  "- If the user is asking the current work to stop, use **cancel_task**.",
  "- If the user is refining the current approach and the task should continue under the same run, use **inject_operator_message**.",
  "- If the task is failed or cancelled and the user wants it to continue, use **retry_task**.",
  "- If the user is changing strategy rather than just adding guidance, prefer **restart_from_stage** over blind continuation.",
  "- Do not ignore operator_message just because goals are active; this trigger exists so you can intervene mid-execution.",
  "",
  "## Clarification (`question`)",
  "",
  "Call at these points:",
  "  (a) BEFORE requirements/design_analysis — when the mandatory clarification gate (step 4) identifies",
  "      missing scope, tech stack, data model, interactions, or acceptance criteria. This is the DEFAULT",
  "      action for underspecified requests. An image alone does not make a request well-specified.",
  "  (b) DURING execute when a critical input cannot be inferred from the codebase,",
  "  (c) BEFORE deliver when multiple viable approaches exist,",
  "  (d) AFTER refine to pick which improvements to apply.",
  "",
  "**How to ask well**: Focus on the user's TRUE INTENT, not implementation details. Provide concrete",
  "solution options that demonstrate you understood the problem space. Structure like this:",
  "  - Question 1: What is the core purpose? (options: static mockup, interactive prototype, production app, ...)",
  "  - Question 2: What elements matter most? (options based on what you see in the reference — e.g.",
  "    \"data-driven components with real API\", \"pixel-perfect static replica\", \"interactive with state management\")",
  "  - Question 3: Tech/scope constraint? (options: single HTML file, React/Vue app, component library, ...)",
  "Each question MUST have 2-4 concrete options with descriptions. Let the user PICK a direction,",
  "don't ask open-ended \"what do you want?\" questions.",
  "",
  "Do NOT ask for info you could derive from read_context / task.request / existing goals.",
  "Do NOT skip clarification to \"move fast\" — underspecified execution wastes more time than a 30-second question.",
  "",
  "## Rules",
  "",
  "- Explain your reasoning before each tool call.",
  "- After every `build` batch returns → run `deliver`. You do not need to poll; parallel `build` tool_calls resolve inside the same AI SDK step.",
  "- Both workflows END with deliver acceptance — never declare a task done without deliver accepting.",
  "- `build` (direct) does NOT auto-complete the task — you MUST call deliver after.",
  "- Terminal state with no fresh operator_message → do nothing.",
  "- User messages in Operator Notes → acknowledge in your reasoning.",
  "- When executor returns errors, default action is fix-and-retry, not give up.",
].join("\n")

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
      const summary = typeof latest.verdict_summary === "string" ? latest.verdict_summary : ""
      if (summary) ctx.push(`Summary: ${summary}`)
      const issues = Array.isArray(latest.issues_found) ? (latest.issues_found as string[]) : []
      if (issues.length > 0) {
        ctx.push("Issues found:")
        for (const issue of issues) ctx.push(`  - ${issue}`)
      }
      const details = Array.isArray(latest.rejection_details)
        ? (latest.rejection_details as Array<Record<string, string>>)
        : []
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
