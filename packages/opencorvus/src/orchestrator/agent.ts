/**
 * Orchestrator — master agent in the Agent Team architecture.
 *
 * Calls LLM through ProviderLLM.stream() — the unified provider adaptation layer.
 *
 * Triggered by:
 * - Task creation (kind: "created") — new task, agent plans and submits execution
 * - Batch complete (kind: "batch_complete") — goal batch finished (any mix of pass/fail),
 *   agent reads fresh context and decides next action
 * - Operator message (kind: "operator_message") — user sent a new message and the
 *   scheduler must decide whether to inject guidance, cancel, retry, or change strategy
 * - User retry request (kind: "retry")
 *
 * The Orchestrator controls the entire pipeline via tools:
 * requirements → goals → plan → execute → eval → delivery verify → publish
 * All other agents (requirements, architect, plan, eval, delivery) are subordinate workers.
 */
import { stepCountIs } from "ai"
import { Provider } from "@/provider/provider"
import { renderSpecsAsText, type AcceptanceSpec } from "@/acceptance/types"
import { AgentRuntime } from "@/agent/runtime"
import { resolveAgentModel } from "@/agent/model"
import { Session } from "@/session"
import { Instance } from "@/project/instance"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import { toolGuard } from "@/util/tool-guard"
import { sessionStreamHooks } from "@/agent/runtime"
import { createOrchestratorTools } from "./tools"
import { SubAgentProtocol } from "@/agent/sub-agent-protocol"
import { AttachmentStore } from "@/storage/attachment-store"
import { readIterationHistory as readHistForPrompt } from "@/metrics/store"
import {
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
const MAX_STEPS = 20

// ---------------------------------------------------------------------------
// Trigger types
// ---------------------------------------------------------------------------

export type OrchestratorTrigger =
  | { kind: "created" }
  | { kind: "batch_complete"; runID: string; summary: { passed: number; failed: number; total: number }; depBlocked?: Array<{ goalTitle: string; blockedBy: Array<{ title: string; status: string }> }> }
  | { kind: "delivery_rejected"; runID: string; feedback: Record<string, unknown> }
  | { kind: "operator_message"; message: string; attachmentSummary?: string }
  | { kind: "retry" }

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

  export async function processTask(taskID: string, trigger: OrchestratorTrigger): Promise<void> {
    abort(taskID)
    const ctrl = new AbortController()
    running.set(taskID, ctrl)

    let contentHooks: ReturnType<typeof sessionStreamHooks> | undefined
    let stopSignal: AbortSignal | undefined
    try {
      const task = requireTask(taskID)
      if (!task.session_id) {
        log.error("orchestrator: no session_id on task", { taskID })
        return
      }

      // 0. Initialize workflow state on new task creation
      let workflow: MiniWorkflow | undefined
      let workflowState: WorkflowState | undefined
      if (trigger.kind === "created") {
        const requestedID = task.workflow_state?.workflowID
        const workflowID = requestedID ?? await WorkflowRegistry.defaultID()
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
        // Load existing workflow state for re-triggers
        const existingState = task.workflow_state ?? undefined
        if (existingState) {
          workflow = await WorkflowRegistry.resolve(existingState.workflowID) ?? WorkflowRegistry.resolveSync(existingState.workflowID)
          workflowState = existingState
        }
      }

      // 1. Resolve model — respects agent.task.model in user config; otherwise
      //    inherits the user's most recent in-session model pick from the
      //    originating task session; otherwise Provider.defaultModel().
      const model = await resolveAgentModel("orchestrator", { sessionID: task.session_id }).catch((e) => {
        log.error("orchestrator: no LLM model available", { taskID, error: e instanceof Error ? e.message : String(e) })
        return undefined
      })
      if (!model) return

      // 2. Create child session + streaming hooks.
      //    Each processTask invocation uses a fresh child session.
      //    LLM context is reconstructed from DB state (goals, runs, deliveries,
      //    decision log) via buildSystemParts on each invocation — the session
      //    is only for UI/audit persistence, not for LLM context accumulation.
      const agentSession = await Session.createNext({
        kind: "orchestrator",
        parentID: task.session_id,
        title: `Agent: ${task.title}`,
        directory: Instance.directory,
      })
      contentHooks = sessionStreamHooks({
        sessionID: agentSession.id,
        taskID,
        stage: "orchestrator",
      })


      // 3. Create tools (agentSessionID passed so tool sessions become children)
      const { tools, stopSignal: dispatchSignal, finalizeDeferredStop } = createOrchestratorTools({
        taskID,
        agentSessionID: agentSession.id,
        signal: ctrl.signal,
        workflow,
        workflowState,
        operatorMessage:
          trigger.kind === "operator_message"
            ? {
                text: trigger.message,
                attachmentSummary: trigger.attachmentSummary,
              }
            : undefined,
      })
      stopSignal = dispatchSignal
      const guard = toolGuard(tools)
      const onStepFinish = async (_step: unknown) => {
        try {
        } finally {
          const stopReason = finalizeDeferredStop()
          if (stopReason) {
            log.info("orchestrator deferred stop finalized", {
              taskID,
              trigger: trigger.kind,
              reason: stopReason,
            })
          }
        }
      }

      // 4. Build prompt — use the user's original request as the user message
      // for "created" triggers (it IS the user's intent). For re-triggers
      // (batch_complete, retry) use a short event description.
      const system = await buildSystemParts(task, trigger, workflow, workflowState)
      const userText = trigger.kind === "created"
        ? task.request
        : describeTrigger(task, trigger)
      // Build multimodal content when task has file attachments (only for initial trigger).
      // AttachmentStore.partition routes image/audio/video/pdf to inline file
      // parts and text/* / json to a URL-only reference list; see helper
      // comments for the silent-rejection rationale.
      const attachments = trigger.kind === "created" && Array.isArray(task.attachments)
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
      const userContent = attachmentParts.length
        ? [{ type: "text" as const, text: enrichedUserText }, ...attachmentParts]
        : enrichedUserText

      log.info("orchestrator starting", {
        taskID,
        trigger: trigger.kind,
        sessionID: agentSession.id,
        model: `${model.providerID}/${model.id}`,
        toolCount: Object.keys(tools).length,
      })

      // 5. Run through AgentRuntime — unified failure / persistence wiring.
      const runResult = await AgentRuntime.run({
        agent: "orchestrator",
        model,
        system,
        messages: [{ role: "user" as const, content: userContent }],
        tools: guard.tools as any,
        stopWhen: stepCountIs(MAX_STEPS),
        cacheKey: `task-${taskID}`,
        sessionID: agentSession.id,
        taskID,
        stage: "orchestrator",
        signal: AbortSignal.any([ctrl.signal, stopSignal]),
        onStepFinish,
        hooks: contentHooks,
        policies: {
          // Root agent: surface child failures as collected state; the task
          // loop handles escalation, not the runtime.
          failurePolicy: "collect",
        },
      })
      const resultText = runResult.text
      const resultSteps = runResult.steps
      const resultFinishReason = runResult.finishReason
      const toolCallCount = runResult.toolCallCount
      log.info("orchestrator finished", {
        taskID,
        trigger: trigger.kind,
        steps: resultSteps.length,
        toolCalls: toolCallCount,
        finishReason: resultFinishReason,
        textLength: resultText?.length ?? 0,
        streamFailures: runResult.failures.count,
      })

      // Critical stream failures (mid-stream protocol violations, persist
      // failures, provider onError) mean the
      // agent's view of the run is incoherent and we must fail the task.
      // Excluded from critical:
      //   - `flush`: cleanup-path persistence hiccup after the LLM already
      //     returned; doesn't retroactively invalidate a successful run.
      //   - `tool-input-validation`: AI-SDK rejected a tool call's input
      //     against its Zod inputSchema; the SDK has already fed the error
      //     back to the model as the tool result, so the model self-corrects
      //     on the next step. Bounded by stopWhen=stepCountIs — unrecoverable
      //     models still loud-fail via step-cap, not silently. Failing hard
      //     here would short-circuit the "Orchestrator is the sole decision-
      //     maker, independent reasoning" design (01-agents.md).
      const critical = runResult.failures.items.filter(
        (item) => item.kind !== "flush" && item.kind !== "tool-input-validation",
      )
      const flushOnly = runResult.failures.items.filter((item) => item.kind === "flush")
      if (flushOnly.length > 0) {
        log.warn("orchestrator: post-stream flush hiccup (non-fatal)", {
          taskID,
          flushFailures: flushOnly.length,
          firstFlushKind: flushOnly[0]?.chunkType,
          firstFlushReason: flushOnly[0]?.reason,
        })
      }
      if (critical.length > 0) {
        const first = critical[0]
        const reason = first ? `${first.kind}: ${first.reason}` : "unknown stream failure"
        log.warn("orchestrator surfaced stream failures", {
          taskID,
          criticalCount: critical.length,
          firstFailureKind: first?.kind,
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
      // Finalize any tool parts stuck in running/pending before returning
      await contentHooks?.flush().catch(() => undefined)
      if (ctrl.signal.aborted) {
        log.info("orchestrator was aborted", { taskID })
        return
      }
      // stopSignal abort is a normal termination (submit_execution/dispatch/dispatch_goal
      // dispatched work). NOT an error — the agent will be re-triggered on completion.
      if (stopSignal?.aborted) {
        log.info("orchestrator stopped after dispatch", { taskID, trigger: trigger.kind })
        return
      }
      const msg = error instanceof Error ? error.message : String(error)
      log.error("orchestrator failed", { taskID, trigger: trigger.kind, error: msg })
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
// Trigger description
// ---------------------------------------------------------------------------

function describeTrigger(task: TaskRow, trigger: OrchestratorTrigger): string {
  switch (trigger.kind) {
    case "created":
      return "New task created. Process it."

    case "batch_complete": {
      const lines = [
        `Goal batch complete on run ${trigger.runID}.`,
        `Summary: ${trigger.summary.passed} passed, ${trigger.summary.failed} failed, ${trigger.summary.total} total.`,
      ]

      if (trigger.depBlocked && trigger.depBlocked.length > 0) {
        lines.push(
          "",
          "⚠ BLOCKED GOALS — the following pending goals CANNOT execute because their dependencies failed:",
        )
        for (const b of trigger.depBlocked) {
          const deps = b.blockedBy.map(d => `${d.title} [${d.status}]`).join(", ")
          lines.push(`  • "${b.goalTitle}" blocked by: ${deps}`)
        }
        lines.push(
          "",
          "ACTION REQUIRED: You MUST resolve the blocking goals before these can proceed.",
          "Call query_failed_goals, then either retry_goal (with root cause analysis) or fail_task.",
          "Dispatching or waiting will NOT help — these goals will never become ready until the blockers are resolved.",
        )
      } else {
        lines.push(
          "",
          "Read context (read_context) to see goal statuses and eval evidence.",
          "Decide next action based on current state — no predetermined action.",
        )
      }

      return lines.join("\n")
    }

    case "delivery_rejected": {
      const fb = trigger.feedback
      const issues = Array.isArray(fb.issues_found) ? fb.issues_found as string[] : []
      const details = Array.isArray(fb.rejection_details) ? fb.rejection_details as Array<{ category?: string; file?: string; error?: string; suggestion?: string }> : []

      const lines = [
        `## DELIVERY REJECTED — passed goals auto-reset to pending`,
        "",
        "The delivery agent (adversarial evaluator) rejected the integrated deliverable.",
        "Every passed goal in this task has been opened under a fresh attempt",
        "(superseded_reason=delivery_rework). The dispatch loop will re-execute",
        "them under the SAME contract unless you intervene.",
        "",
        `**Summary**: ${fb.verdict_summary ?? "No summary"}`,
        "",
        `**Issues found** (${issues.length}):`,
        ...issues.map((issue: string) => `  - ${issue}`),
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
        "Goals will redispatch automatically. Your job is to decide whether the",
        "EXISTING contracts are sufficient, or if structural changes are needed:",
        "",
        "- **Contract is fine, just a transient/integration issue** → do nothing; the loop redispatches under the same contract.",
        "- **Contract gap / missing criteria** → modify_goal (acceptance_specs, owned_paths) on affected goals before they redispatch.",
        "- **Missing functionality or structural gap** → re-run **architect** so it refines the goal set (add/modify/split/remove) based on the rejection feedback.",
        "- **Goal decomposition suspect (same goal-set rejected twice)** → re-run **architect** to regenerate goals from the existing requirements.",
        "- **Requirements themselves wrong** → restart_from_stage('requirements') redoes the full chain.",
        "",
        "Focus on the SPECIFIC issues. Do NOT rework everything blindly.",
      )

      return lines.join("\n")
    }

    case "operator_message": {
      const lines = [
        "Operator message received.",
        "",
        "Latest user message:",
        trigger.message,
      ]
      if (trigger.attachmentSummary) {
        lines.push("", trigger.attachmentSummary)
      }
      lines.push(
        "",
        "Decide whether to inject this guidance into the running executor, retry the task, cancel the task, restart from a stage, or ask a clarification question.",
      )
      return lines.join("\n")
    }

    case "retry":
      return `User requested retry.${task.error ? ` Previous error: ${task.error}` : ""}\nDecide how to proceed.`
  }
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
  "  use `modify_goal` (point fix), `retry_goal` (single-goal rework), or re-run `architect` (structural rewrite) and dispatch again.",
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
  "- **build** — direct-path implementer. Single in-process call with read/write/edit/bash. Returns; does NOT auto-complete the task — you must call deliver next.",
  "- **design_analysis** — extract layout / style / component spec from image attachments or URLs. Pipeline only, before requirements, only when visual references exist.",
  "- **requirements** — parse user input into REQ-N list + foundational decisions (runtime / framework / test).",
  "- **architect** — authoritative goal decomposer: produces goals, metric specs, challenge seeds, traceability, cross-goal contracts, and fidelity verdict. Always call after requirements; re-run on delivery rejection to refine (add / modify / split / remove) the goal set.",
  "- **create_run + submit_execution** — start per-goal dispatch. GoalPool runs each goal's build in its worktree.",
  "- **exec_goal / dispatch_goal / retry_goal / modify_goal** — per-goal manipulation after the initial dispatch. `exec_goal` is the single-goal execution entry; `dispatch_goal` batches multiple goal IDs. Goal creation / removal happens only through a re-run of `architect`.",
  "- **cancel_task / retry_task / inject_operator_message** — operator-message controls. Use when the user asks to stop, continue with new guidance, or resume a stopped task.",
  "- **query_failed_goals / read_context** — observation; call before any retry decision.",
  "- **deliver** — adversarial verification + fix + publish. The single verdict gate; always required.",
  "- **publish_delivery / fail_task / restart_from_stage / refine / question** — terminal / control / clarification.",
  "",
  "(Per-goal planning runs automatically inside GoalPool — no `plan_goal` tool exists.)",
  "",
  "## New task — execution",
  "",
  "1. Pick workflow per the rule above.",
  "2. **Direct**: call `build` once → call `deliver` → (if rejected, restart from build with the rejection feedback) → loop.",
  "3. **Pipeline**:",
  "   - design_analysis BEFORE requirements ONLY when ALL apply: (a) frontend/UI task, (b) image attachments or URL exist. Otherwise skip.",
  "   - requirements (always)",
  "   - architect (always)",
  "   - create_run → submit_execution",
  "   - STOP and wait for batch_complete re-trigger",
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
  "## After batch completes (re-triggered with batch_complete)",
  "",
  "- If ANY dispatchable goal is still `running` or `pending` → do NOTHING. Wait for the next batch_complete.",
  "- `verification` goals do not dispatch to an executor worktree; they stay pending until **deliver** runs merged-worktree verification.",
  "- Once ALL dispatchable goals are terminal (passed/failed):",
  "  - All blocking goals passed → call **deliver** (delivery agent verifies and accepts or rejects).",
  "  - Some failed → call **query_failed_goals** first, then **retry_goal** with per-goal analysis (root_cause + failure_class + expected_fix). Reflexive retry without analysis is rejected by the tool.",
  "  - Missing dependency discovered → re-run **architect** (it will register the prerequisite goal), then redispatch.",
  "  - Wrong contract for a goal → **modify_goal** then **dispatch_goal**.",
  "  - **fail_task** ONLY when the executor produced empty / garbled / fundamentally unusable output. Logic bugs, test failures, missing imports = fix and retry, never fail_task.",
  "- **NEVER dispatch_goal on a passed goal** — passed is terminal. Use modify_goal to change contract.",
  "",
  "## After delivery rejection (re-triggered with delivery_rejected)",
  "",
  "On rejection, every passed goal in the task has ALREADY been opened under",
  "a fresh attempt cycle (superseded_reason=delivery_rework) by the deliver",
  "tool itself. The dispatch loop will re-execute them under the SAME contract",
  "automatically. Your job is strategy, not state-flipping.",
  "",
  "Direct workflow:",
  "  - Call `build` again with the rejection feedback as part of the request. Then call `deliver` again.",
  "  - The rejection details are pre-loaded in your trigger context (do not re-fetch).",
  "",
  "Pipeline workflow — escalation ladder (try the cheapest first; climb only when the previous rung did not converge).",
  "  Rationale: by deliver-time the per-goal worktrees have already been merged into main — the deliverable is AGGREGATED CODE. Default rework operates on that aggregated state, not on per-goal shards. Fall back to per-goal retry only when a failure is clearly confined to one goal's internals.",
  "",
  "  1. Transient or integration-only failure → no action; the next `deliver` call will re-verify on its own.",
  "  2. Specific goal contract gap → **modify_goal** on affected goals (contract-level change; does not execute).",
  "  3. Missing functionality → re-run **architect** with the rejection feedback so it refines the goal set (add / modify / split / remove).",
  "  4. **DEFAULT rework path → call `build` with the rejection feedback as the request.** `build` works on the aggregated main tree directly — it can touch any file, cross goal boundaries, fix integration glue, rename symbols project-wide. This is the right tool for virtually every rejection whose fix spans more than one file owned by one goal.",
  "  5. Only when the rejection is clearly a single-goal internal bug (e.g. its own tests fail, its own contract unmet, and no other goal's files need touching) → **retry_goal** with per-goal analysis (root_cause + failure_class + expected_fix). Going to retry_goal when `build` was the right tool just forces the fix into a shard that cannot see the rest of the tree.",
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
  "- After submit_execution / exec_goal / dispatch_goal → STOP. You'll be re-triggered.",
  "- Both workflows END with deliver acceptance — never declare a task done without deliver accepting.",
  "- `build` (direct) does NOT auto-complete the task — you MUST call deliver after.",
  "- Terminal state with no fresh operator_message → do nothing.",
  "- User messages in Operator Notes → acknowledge in your reasoning.",
  "- When executor returns errors, default action is fix-and-retry, not give up.",
].join("\n")

/**
 * Build the orchestrator system prompt as a two-part array:
 *   [0] = static instructions (stable, benefits from 1h cache TTL)
 *   [1] = dynamic context (changes per trigger — task state, goals, budget, etc.)
 */
async function buildSystemParts(task: TaskRow, trigger: OrchestratorTrigger, workflow?: MiniWorkflow, workflowState?: WorkflowState): Promise<string[]> {
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
    // Latest delivery feedback comes from trigger.feedback (loop reads it
    // from the verdict artifact when it sees a recent delivery_rework
    // supersede). Empty unless this very turn was triggered by a rejection.
    const latest = trigger.kind === "delivery_rejected"
      ? (trigger.feedback as Record<string, unknown> | undefined)
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

  // Run context (delivery + eval results for reasoning).
  //
  // This block was the largest single source of system-prompt growth in
  // the orchestrator prior to the SubAgentProtocol introduction: a batch
  // complete trigger could embed kilobytes of LLM-generated delivery
  // prose, hundreds of changed-file paths, and ten checks each carrying
  // multi-paragraph evidence. The yielded summary is now framed as a
  // sub-agent-protocol message — same shape, same per-message ceiling
  // as a tool return — with explicit pointers back to the persistent
  // delivery / evaluation rows for full content.
  if (trigger.kind === "batch_complete") {
    const runID = trigger.runID
    const delivery = findDeliveryByRun(runID)
    const evaluation = findEvaluationByRun(runID)

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
    fields.push([
      "batch_totals",
      `${trigger.summary.passed} passed / ${trigger.summary.failed} failed / ${trigger.summary.total} total`,
    ])

    const pointerHints: string[] = []
    if (delivery) pointerHints.push(`read_context scope=deliveries (delivery row ${delivery.id})`)
    if (evaluation) pointerHints.push(`read_context scope=evaluations (evaluation row ${evaluation.id})`)
    const pointer = pointerHints.length > 0 ? pointerHints.join("; ") : "read_context"

    ctx.push("")
    ctx.push(SubAgentProtocol.yieldResult({
      headline: `## Latest Run Result (run ${runID})`,
      fields,
      pointer,
    }))
  }

  return [ORCHESTRATOR_INSTRUCTIONS, ctx.join("\n")]
}
