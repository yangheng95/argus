import fs from "node:fs/promises"
import z from "zod"
import { streamObject } from "ai"
import { Agent } from "@/agent/agent"
import { resolveAgentModel } from "@/agent/model"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { discoverChecks, resolveConfig, resolvedChecks } from "@/delivery/checks/discovery"
import { ExecutorNotConfiguredError } from "@/executor/contract"
import { ExecutorBootstrap } from "@/executor/bootstrap"
import { ExecutorRegistry } from "@/executor/registry"
import { PermissionNext } from "@/permission/next"
import { Provider } from "@/provider/provider"
import { ProtocolStore } from "@/protocol/store"
import { EngineProtocol } from "@/engine/protocol"
import { ensureGitignore } from "@/engine/git"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Worktree } from "@/worktree"
import { Question } from "@/question"
import { Scheduler } from "@/scheduler"
import { Session } from "@/session"
import { Message } from "@/session/message"
import { Database, NotFoundError, and, eq, inArray } from "@/storage/db"
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
  RejectInteractionInput,
  ReplyInteractionInput,
  TaskMessageInput,
  CheckConfig,
  UpdateGoalInput,
  UpdateTaskChecksInput,
} from "@/engine/model"
import {
  ORCHESTRATOR_POLL_INTERVAL_MS,
  budgetRow,
  deriveTitle,
  progressStatus,
} from "@/engine/helpers"
import { orchestratorState } from "@/engine/orchestrator-state"
import { mergeTaskChecks, writeTaskChecks } from "@/engine/checks"
import { dispatchTaskLoop, reorderQueuedTasksForCwd } from "@/engine/queue"
import { OrchestratorEventNote } from "@/orchestrator/agent"
import { updateGoal as updateGoalRow, deleteGoal as deleteGoalRow } from "@/engine/persist"
import { EngineInteraction } from "@/engine/interaction"
import { EngineRuntime } from "@/engine/runtime"
import { hooks, updateRun, updateTask, upsertTaskCriteria as upsertTaskCriteriaImpl } from "@/engine/state"
import {
  deriveTaskStatus,
  isTaskActive,
  isTaskCancelled,
  isTaskCompleted,
  isTaskFailed,
  isTaskQueued,
  isTaskTerminal,
} from "@/engine/task-status"
import { persistQueuedTask, abortTaskPipeline, awaitPipelineSettled } from "@/engine/pipeline"
import { Orchestrator } from "@/orchestrator/agent"
import {
  activeRunBySession,
  findArtifacts,
  findDeliveryByGoalRun,
  findDeliveryByRun,
  findGoalRun,
  findLatestDeliveryForRun,
  findExecutorSessionByRun,
  findActivePlanForTask,
  findActiveRunForTask,
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
  viewDelivery,
  viewExecutorSession,
  viewEvaluation,
  viewGoal,
  viewInteraction,
  viewMilestone,
  viewPlan,
  viewRun,
  viewSnapshot,
  viewTask,
  type GoalRow,
  type TaskListRow,
  type TaskRow,
  type PlanRow,
  type RunRow,
  type InteractionRow,
} from "@/engine/store"
import { goalStatusByID } from "@/engine/describe"
import { Identifier } from "@/id/id"
import { AttachmentStore } from "@/storage/attachment-store"

const log = Log.create({ service: "assistant" })

async function continueTaskMessage(
  taskID: string,
  text: string,
  attachments: AttachmentStore.Reference[] = [],
) {
  const task = requireTask(taskID)

  // Append the user message to session history — the describe layer and
  // orchestrator prompt both read session messages, so appending here is
  // how the new message becomes visible to whatever runs next. Surface the
  // persisted message back to the caller so the HTTP response can carry the
  // real user-message id straight into the overlay (no client-side
  // synthetic placeholder; rule 22 single source).
  const persisted = await appendTaskSessionMessage(task, text, attachments)

  const attachmentSummary = attachments.length > 0
    ? [
        "Attachments:",
        ...attachments.map((ref) => `- ${ref.filename ?? ref.sha} — ${ref.mime} — url: ${ref.url}`),
      ].join("\n")
    : undefined

  // User messages must re-enter the task lifecycle shell. Calling the
  // Orchestrator directly bypasses loop/pool coordination and can strand the
  // message behind a sleeping wait path.
  void dispatchTaskLoop({
    taskID,
    event: {
      note: OrchestratorEventNote.operatorMessage({ text, attachmentSummary }),
      operatorMessage: { text, attachmentSummary },
    },
    interrupt: true,
  })

  return {
    mode: "scheduler" as const,
    resumed: true,
    status: deriveTaskStatus(task) as string,
    user_message: persisted,
  }
}

async function injectRunningTaskMessage(task: TaskRow, run: RunRow, message: string) {
  if (!["accepted", "running"].includes(run.status)) return false
  if (!run.session_id) return false
  const executor = ExecutorRegistry.require(run.executor)
  if (!executor.capabilities().resume) return false

  const submission = await executor.resume({
    sessionID: run.session_id,
    message,
  })
  if (run.executor !== "opencode") {
    await appendTaskSessionMessage(task, message)
  }
  if (submission.queueTaskID !== run.executor_ref?.queue_task_id) {
    await updateRun(
      run,
      {
        executor_ref: {
          session_id: submission.sessionID,
          queue_task_id: submission.queueTaskID,
        },
      },
      "Message injected into running session",
    )
  }
  await EngineProtocol.emit(Event.MessageInjected, {
    taskID: task.id,
    runID: run.id,
    text: message,
    summary: "Operator message injected into running session",
  }, { taskID: task.id, runID: run.id, source: "service.inject" })
  return true
}

async function appendTaskSessionMessage(
  task: TaskRow,
  text: string,
  attachments: AttachmentStore.Reference[] = [],
): Promise<{ info: Message.User; parts: Message.Part[] } | undefined> {
  if (!task.session_id) return
  const ctx = await messageContext(task.session_id)
  if (!ctx) return
  const info = (await Session.updateMessage({
    id: Identifier.ascending("message"),
    role: "user",
    sessionID: task.session_id,
    time: {
      created: Date.now(),
    },
    agent: ctx.agent,
    model: ctx.model,
  } satisfies Message.User)) as Message.User
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
    await Session.updatePart(textPart)
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
    await Session.updatePart(filePart)
    parts.push(filePart)
  }
  await Session.touch(task.session_id)
  return { info, parts }
}

async function messageContext(_sessionID: string) {
  const name = await Agent.defaultAgent().catch(() => undefined)
  const agent = name ? await Agent.get(name).catch(() => undefined) : undefined
  // Provider.defaultModel() is strict now (reads only cfg.model, throws if
  // unset). No .catch — a missing model config is a hard project-setup error
  // and must surface to the caller, not be papered over with `undefined`.
  const model = agent?.model ?? (await Provider.defaultModel())
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

function taskSummary(rows: Array<{
  time_started: number | null
  time_completed: number | null
  error?: string | null
  metadata?: Record<string, unknown> | null
}>) {
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
    median_completion_ms:
      completed.length === 0 ? undefined : completed[Math.floor((completed.length - 1) / 2)],
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
    const run = findActiveRunForTask(task.id)
    const evaluation = run ? findEvaluationByRun(run.id) : undefined
    const pendingInteractions = listInteractions(task.id).filter((entry) => entry.status === "pending").length
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
      pending_interactions: pendingInteractions,
      updated_at: task.time_updated,
    }
  })
}

async function taskChecks(checks?: z.input<typeof CheckConfig>) {
  const found = await discoverChecks()
  const next = structuredClone(
    resolvedChecks(await resolveConfig(checks ? { checks } : undefined), found),
  )

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

/** Thrown when the planner agent cannot produce a valid plan. Server routes
 *  map this to a 4xx so the user sees the planner failure rather than a
 *  generic 500. */
export class PlannerFailureError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "PlannerFailureError"
  }
}

export namespace EngineService {
  export function init() {
    const current = orchestratorState()
    if (!current.booted) {
      EngineInteraction.subscribe(hooks())
      current.booted = true
    }
    // Monitor active runs (executor status) — no pipeline advancement.
    // Pipeline advancement is now driven by the Orchestrator.
    Scheduler.register({
      id: "engine.poll",
      interval: ORCHESTRATOR_POLL_INTERVAL_MS,
      scope: "instance",
      run: () => EngineRuntime.monitorRuns(hooks()),
    })
    // Phase-7: no aggressive startup recovery. The post-phase-5 build model
    // is synchronous within a single orchestrator wake — nothing survives
    // across process restart that needs a dedicated cleanup phase. Orphan
    // runs surface via describe.ts `run_orphan` on the next wake and the
    // orchestrator LLM decides whether to retry / restart_from_stage /
    // drop. OS-level cleanup (worktrees, processes) is owned by the
    // ownership registry, not by a recovery function.
  }

  export async function createTask(raw: z.input<typeof CreateTaskInput>) {
    const input = CreateTaskInput.parse(raw)
    await prepareProject(input.project)
    const requestID = input.requestID?.trim() || undefined
    if (requestID) {
      const existing = findTaskByRequest(Instance.project.id, requestID)
      if (existing) return existing.id
    }
    const title = input.title?.trim() || deriveTitle(input.request)
    const executor = input.executor ?? "opencode"
    if (executor !== "opencode" && !ExecutorRegistry.has(executor)) {
      await ExecutorBootstrap.autoRegister(true).catch((err) => {
        log.warn("executor autoRegister failed", { executor, error: String(err) })
      })
    }
    ExecutorRegistry.require(executor)
    // The task's root session: it holds the user's original request and the
    // pointer engine_task.session_id. Its children are the orchestrator's
    // own session and each sub-agent session (planner/executor/...).
    const session = await Session.create({ kind: "root", title })
    const resolvedChecks = await taskChecks(input.checks)
    const now = Date.now()
    const taskID = Identifier.ascending("task")
    const metadata = {
      ...(input.metadata ?? {}),
      ...(input.routing ? { routing: input.routing } : {}),
      ...(Object.keys(resolvedChecks).length > 0 ? { checks: resolvedChecks } : {}),
    } as Record<string, unknown>

    // Phase-6-f-3-bis-b: workflow_state is no longer persisted. The
    // orchestrator resolves the default workflow fresh on each wake and
    // projects step status from side-effects (spec / goals / runs /
    // delivery presence). board.ts::buildWorkflowFields likewise no
    // longer reads task.workflow_state — it always defaults to pipeline
    // and projects step status from DB rows.

    // Hierarchical permission model (rule 23): built-in tools default to
    // `allow` (see PermissionNext.evaluate). Agent-scoped overlays
    // (orchestrator, delivery, ...) layer on top via setPermission. Operators
    // restrict via explicit `deny` / `ask` rules under `tool_permissions`
    // in their config — only those keys appear here. We intentionally do
    // NOT inject a `*: "ask"` catch-all; that turned the LLM autonomy gate
    // into an indefinite block whenever the agent reached for a tool the
    // catch-all lookup happened to land on (todoread, planner, panel, …).
    const cfg = await Config.get()
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
    if (input.attachments?.length) {
      const projectID = Instance.project.id
      for (const att of input.attachments) {
        const bytes = Buffer.from(att.data, "base64")
        const ref = await AttachmentStore.write(projectID, bytes, att.mime, att.filename)
        // Default intent: image MIMEs are visual references (SSIM gate
        // consumes them). Anything else is generic spec material until a
        // specific evaluator gate claims it.
        const intent = att.mime.startsWith("image/") ? "visual_reference" : "spec_artifact"
        attachmentRefs.push({ ...ref, intent, source: "user-upload" })
      }
    }
    // Materialize the intent bundle on disk BEFORE the queue picks the task
    // up, so when the orchestrator / planner / architect wake their stage
    // prompts (which reference `.opencorvus/intent/request.md`) resolve to
    // a real file. Without this, architect-generated goal objectives like
    // "see .opencorvus/intent/request.md §3" point at nothing — the
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
        taskID, sessionID: session.id, now, executor, title,
        request: input.request,
        attachments: attachmentRefs.length ? attachmentRefs : undefined,
        requestID, source: input.source,
        priority: input.priority, kind: input.kind, budget: input.budget, metadata,
        channelBinding: input.channelBinding,
        projectID: Instance.project.id,
      })
    } catch (error) {
      const existing = requestID ? recoverTaskByRequest(requestID, error) : undefined
      if (existing) return existing
      const bound = recoverTaskByChannelBinding(input.channelBinding, error)
      if (bound) return bound
      throw error
    }
    recordNote({
      taskID,
      kind: "user_request",
      content: input.request,
      source: input.source ?? "api",
      userID: slackUser(metadata),
    })
    void dispatchTaskLoop({ taskID })
    return taskID
  }

  export async function getTask(taskID: string) {
    // Read-only — poll loop handles state advancement asynchronously.
    const task = requireTask(taskID)
    const item = listTaskRows([task])[0]
    return viewTask(task, { directory: item?.directory })
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
    merge: (prev: FileRef[]) => { next: FileRef[]; reason: string } | null,
  ): Promise<FileRef[]> {
    const task = requireTask(taskID)
    const located = AttachmentStore.nameFromUrl(file.url)
    if (!located) {
      throw new Error(
        `${column}: file.url is not a valid /attachment/<projectID>/<name> reference: ${file.url}`,
      )
    }
    const abs = AttachmentStore.resolveAbsolute(located.projectID, located.name)
    if (!abs) {
      throw new Error(
        `${column}: cannot resolve attachment path for project ${located.projectID}/${located.name}`,
      )
    }
    const stat = await fs.stat(abs).catch(() => null)
    if (!stat || stat.size === 0) {
      throw new Error(
        `${column}: file missing or empty on disk — refusing to register dangling reference: ${abs}`,
      )
    }
    const prev = Array.isArray((task as any)[column]) ? ((task as any)[column] as FileRef[]) : []
    const result = merge(prev)
    if (!result) return prev
    await updateTask(task, { [column]: result.next } as any, result.reason)
    return result.next
  }

  /**
   * Register a USER-CONTRACT attachment on a task. Use for files the user
   * explicitly attached (user-upload) or for assets the user pointed the
   * orchestrator at via a contract-level URL (figma frames). Read by
   * requirements / design-analyst as user intent and by delivery for visual
   * comparison.
   *
   * For orchestrator-generated evidence (URL screenshots, rendered.png,
   * local material reads) use `appendTaskSystemArtifact` instead — those
   * must not contaminate the user-intent stream.
   *
   * Idempotent on sha collision: same content → no-op.
   */
  export async function appendTaskAttachment(taskID: string, attachment: FileRef) {
    return mergeTaskFileRef(taskID, "attachments", attachment, (prev) => {
      if (prev.some((a) => a?.sha === attachment.sha)) return null
      return {
        next: [...prev, attachment],
        reason: `attachments appended: ${attachment.filename ?? attachment.sha}`,
      }
    })
  }

  /**
   * Register a SYSTEM-GENERATED artifact on a task. Use for evidence the
   * orchestrator/agents produced on the user's behalf — URL screenshots,
   * local material reads. Read only by delivery for visual diff against the
   * user contract; never fed to requirements or design-analyst as user
   * intent. Idempotent on sha collision.
   */
  export async function appendTaskSystemArtifact(taskID: string, artifact: FileRef) {
    return mergeTaskFileRef(taskID, "system_artifacts", artifact, (prev) => {
      if (prev.some((a) => a?.sha === artifact.sha)) return null
      return {
        next: [...prev, artifact],
        reason: `system_artifacts appended: ${artifact.filename ?? artifact.sha}`,
      }
    })
  }

  /**
   * Replace all system artifacts carrying a given `intent` with a single new
   * artifact. Use when each rerun should supersede the previous output for
   * that semantic slot (e.g. delivery rendered_output: keeping every prior
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
    return mergeTaskFileRef(taskID, "system_artifacts", artifact, (prev) => {
      const purged = prev.filter((a) => a?.intent !== intent)
      return {
        next: [...purged, artifact],
        reason: `system_artifacts replaced [intent=${intent}]: ${artifact.filename ?? artifact.sha}`,
      }
    })
  }

  /**
   * Merge a batch of evaluation checks into `engine_task.criteria_results`.
   * Upsert by `name` — the latest write for a given check name wins. Called
   * by the in-process visual-diff gate (orchestrator/tools.ts) and by the
   * delivery-verdict sink that flattens DeliveryVerdict.deferred_checks +
   * rejection_details into the unified criteria stream. Does not change
   * task.status.
   */
  // upsertTaskCriteria lives in engine/state.ts (the business logic layer);
  // the facade just re-exports it so HTTP route consumers keep working.
  export const upsertTaskCriteria = upsertTaskCriteriaImpl

  export async function getProgress(taskID: string) {
    // Do NOT call syncTask here — it triggers synchronous evaluation inside the GET request,
    // which blocks for minutes and causes request timeouts. The poll loop drives state advancement.
    const task = requireTask(taskID)
    const item = listTaskRows([task])[0]
    const plan = findActivePlanForTask(task.id)
    const run = findActiveRunForTask(task.id)
    const delivery = run ? findDeliveryByRun(run.id) : undefined
    const evaluation = run ? findEvaluationByRun(run.id) : undefined
    const milestones = plan ? listMilestonesByPlan(plan.id) : listMilestones(taskID)
    return {
      task: viewTask(task, { directory: item?.directory }),
      plan: plan ? viewPlan(plan) : undefined,
      goals: (plan ? listGoalsByPlan(plan.id) : listGoals(taskID)).map((g) => ({ ...viewGoal(g), status: goalStatusByID(g.id) })),
      milestones: milestones.length > 0 ? milestones.map(viewMilestone) : undefined,
      run: run ? viewRun(run) : undefined,
      pendingInteractions: listInteractions(taskID).filter((item) => item.status === "pending").map(viewInteraction),
      delivery: delivery ? viewDelivery(delivery) : undefined,
      evaluation: evaluation ? viewEvaluation(evaluation) : undefined,
      snapshots: listSnapshots(taskID).map(viewSnapshot),
      // activeSessions surfaces pre-plan agent work (requirements / architect /
      // integrity / design-analyst) that goals/run miss. Without this, overlay
      // has nothing to render during the 30s–10min architect phase and the
      // benchmark progress signature stalls until goals materialise.
      activeSessions: listActiveSessionsForTask(taskID),
    }
  }

  export async function listRuns(taskID: string) {
    // Read-only — poll loop handles state advancement asynchronously.
    requireTask(taskID)
    return findRuns(taskID).map(viewRun)
  }

  export async function getRun(runID: string) {
    // Read-only — poll loop handles state advancement asynchronously.
    return viewRun(requireRun(runID))
  }

  export async function getBrief(input: { taskID: string; runID?: string }) {
    // Read-only — poll loop handles state advancement asynchronously.
    const task = requireTask(input.taskID)
    return compileBrief({
      taskID: task.id,
      runID: input.runID ?? findActiveRunForTask(task.id)?.id,
      planVersionID: findActivePlanForTask(task.id)?.id,
      sessionID: task.session_id ?? undefined,
    })
  }

  export async function getBoard(taskID: string, _input?: { sync?: boolean }) {
    // Read-only — poll loop handles state advancement asynchronously.
    return compileBoard({ taskID })
  }

  export async function getBoardTag(taskID: string, _input?: { sync?: boolean }) {
    // Read-only — poll loop handles state advancement asynchronously.
    return boardTag({ taskID })
  }

  export async function getProjectBoard(opts?: { limit?: number; query?: string; status?: string }) {
    const project = Project.get(Instance.project.id) ?? Instance.project
    const limit = opts?.limit ?? 50
    const rows = (opts?.query || opts?.status)
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
  }) {
    const rows = listGlobalTasks({
      directory: opts?.directory,
      cursor: opts?.cursor,
      query: opts?.query,
      status: opts?.status,
      limit: opts?.limit ?? 100,
    })
    return {
      summary: taskSummary(rows.map((item) => item.task)),
      tasks: taskItems(rows),
    }
  }

  export async function reorderTaskQueue(input: {
    directory: string
    orderedTaskIDs: string[]
    revision?: string
  }) {
    const result = reorderQueuedTasksForCwd({
      cwd: input.directory,
      orderedTaskIDs: input.orderedTaskIDs,
      revision: input.revision,
    })
    await Promise.all(result.queuedTaskIDs.map((taskID) =>
      EngineProtocol.emit(Event.TaskUpdated, {
        taskID,
        status: "queued",
        summary: "Task queue reordered",
      }, { source: "task.queue.reorder" }),
    ))
    return result
  }

  export async function getDelivery(runID: string) {
    // Read-only — poll loop handles state advancement asynchronously.
    // Prefer task-level delivery (goal_run_id IS NULL); fall back to any delivery for this run
    // so that goal-run deliveries (shown in the board) are also previewable.
    const delivery = findDeliveryByRun(runID) ?? findLatestDeliveryForRun(runID)
    if (!delivery) throw new NotFoundError({ message: `Delivery not found for run ${runID}` })
    return viewDelivery(delivery)
  }

  export async function getGoalRunDelivery(goalRunID: string) {
    // Read-only — goal-level diff previews must resolve against the
    // specific goal_run delivery instead of the task-level aggregate.
    // Distinguish "goal_run does not exist" (true 404) from "goal_run
    // exists but delivery has not landed yet" (legitimate in-flight state).
    // Mirrors the convention documented on getSessionTrace below: in-flight
    // resources return 200 with an empty payload, not 404.
    if (!findGoalRun(goalRunID)) {
      throw new NotFoundError({ message: `goal_run ${goalRunID} not found` })
    }
    const delivery = findDeliveryByGoalRun(goalRunID)
    if (!delivery) return null
    return viewDelivery(delivery)
  }

  /** Surface the per-session AgentTrace event stream so the overlay's debug
   *  panel can render llm_request / agent_report bodies inline next to the
   *  session card. Read-only; reads JSONL straight from disk and parses each
   *  line. Returns `events: []` (200, not 404) when the trace file is absent,
   *  because "agent ran but trace was disabled / pre-trace session" is a
   *  legitimate state the UI distinguishes from "session not found". */
  export async function getSessionTrace(sessionID: string): Promise<{
    events: import("@/trace").AgentTrace.TraceEvent[]
    traceDir: string
    enabled: boolean
  }> {
    const { AgentTrace } = await import("@/trace")
    return {
      events: AgentTrace.readSessionEvents(sessionID),
      traceDir: AgentTrace.getTraceDir(),
      enabled: AgentTrace.isEnabled(),
    }
  }

  /** Aggregate all sessions belonging to a task into one chronological event
   *  stream. Used for the overlay's panel-level "Show all session trace"
   *  affordance. Includes llm_request events that the per-task rollup file
   *  (`_task-<id>.jsonl`) skips by design.
   *
   *  Also surfaces the resolved trace directory + the enabled flag so the
   *  overlay's empty state can call out path-mismatch and disabled-tracing
   *  failure modes by name (the two failure modes that look identical from
   *  the client's perspective: events:[]). Without this, an operator running
   *  overlay against project root while the agents wrote traces under a
   *  benchmark temp dir gets a "no trace yet" message that hides the real
   *  problem (different Instance.directory). */
  export async function getTaskTrace(taskID: string): Promise<{
    events: import("@/trace").AgentTrace.TraceEvent[]
    traceDir: string
    enabled: boolean
  }> {
    requireTask(taskID)
    const { AgentTrace } = await import("@/trace")
    return {
      events: AgentTrace.readTaskEvents(taskID),
      traceDir: AgentTrace.getTraceDir(),
      enabled: AgentTrace.isEnabled(),
    }
  }

  export async function listArtifacts(runID: string) {
    // Read-only — poll loop handles state advancement asynchronously.
    requireRun(runID)
    return findArtifacts(runID).map(viewArtifact)
  }

  export async function listEvaluations(runID: string) {
    // Read-only — poll loop handles state advancement asynchronously.
    requireRun(runID)
    return findEvaluations(runID).map(viewEvaluation)
  }

  export async function getExecutorSession(runID: string) {
    // Read-only — poll loop handles state advancement asynchronously.
    requireRun(runID)
    const row = findExecutorSessionByRun(runID)
    if (!row) throw new NotFoundError({ message: `Executor session not found for run ${runID}` })
    return viewExecutorSession(row)
  }

  export async function listProtocolEvents(taskID: string) {
    // Read-only — protocol_event is the persisted task event source.
    requireTask(taskID)
    return ProtocolStore.listTaskEvents(taskID)
  }

  export async function listTaskInteractions(taskID: string) {
    // Read-only — poll loop handles state advancement asynchronously.
    requireTask(taskID)
    return listInteractions(taskID).map(viewInteraction)
  }

  export async function selectTaskChecks(
    taskID: string,
    selection: Record<string, boolean>,
  ) {
    const task = requireTask(taskID)
    const next = mergeTaskChecks(task.metadata?.checks, selection)
    return writeTaskChecks(task, next)
  }

  export async function updateTaskChecks(taskID: string, raw: z.input<typeof UpdateTaskChecksInput>) {
    const { checks, selection } = UpdateTaskChecksInput.parse(raw)
    if (selection && Object.keys(selection).length > 0) {
      return selectTaskChecks(taskID, selection)
    }
    return writeTaskChecks(requireTask(taskID), checks)
  }

  export async function updateGoal(goalID: string, input: z.input<typeof UpdateGoalInput>) {
    const body = UpdateGoalInput.parse(input)
    const row = Database.use((db) =>
      db.select().from(EngineGoalTable).where(eq(EngineGoalTable.id, goalID)).get(),
    )
    if (!row) throw new NotFoundError({ message: `Goal not found: ${goalID}` })
    updateGoalRow({
      goalID,
      title: body.description,
      acceptance_specs: body.acceptance_specs,
    })
    return true
  }

  export async function deleteGoal(goalID: string) {
    const row = Database.use((db) =>
      db.select().from(EngineGoalTable).where(eq(EngineGoalTable.id, goalID)).get(),
    )
    if (!row) throw new NotFoundError({ message: `Goal not found: ${goalID}` })
    deleteGoalRow(goalID)
    return true
  }

  export async function deleteTask(taskID: string) {
    const task = requireTask(taskID)
    // Cancel if still active
    if (!isTaskTerminal(task)) {
      await cancelTask(taskID)
    }
    // Wait for any in-progress pipeline stage to settle after abort
    await awaitPipelineSettled(taskID)
    // Delete session tree (CASCADE handles plans, goals, runs, etc.)
    if (task.session_id) {
      await Session.remove(task.session_id)
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
    const task = requireTask(taskID)
    const parsed = budget ? budgetRow(budget) : null
    Database.use((db) =>
      db
        .update(EngineTaskTable)
        .set({ budget: parsed })
        .where(eq(EngineTaskTable.id, taskID))
        .run(),
    )
    await Bus.publish(Event.TaskUpdated, {
      taskID,
      status: deriveTaskStatus(task),
      summary: "Task budget updated",
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

function recoverTaskByChannelBinding(
  binding: {
    platform: string
    channel: string
    thread: string
  } | undefined,
  error: unknown,
) {
  if (!binding) return
  const message = error instanceof Error ? error.message : String(error)
  if (!message.includes("UNIQUE constraint failed")) return
  if (!message.includes("engine_channel_binding")) return
  return Database.use((db) =>
    db
      .select({ task_id: EngineChannelBindingTable.task_id })
      .from(EngineChannelBindingTable)
      .where(
        and(
          eq(EngineChannelBindingTable.platform, binding.platform),
          eq(EngineChannelBindingTable.channel, binding.channel),
          eq(EngineChannelBindingTable.thread, binding.thread),
        ),
      )
      .get()?.task_id,
  )
}

export namespace EngineService {
  export async function replyInteraction(interactionID: string, raw: z.input<typeof ReplyInteractionInput>) {
    const input = ReplyInteractionInput.parse(raw)
    const row = requireInteraction(interactionID)
    if (row.payload?.protocol_request === true) {
      await resolveProtocolInteraction(row, input)
      await EngineRuntime.syncTask(row.task_id, hooks())
      return viewInteraction(requireInteraction(interactionID))
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
    return viewInteraction(requireInteraction(interactionID))
  }

  export async function rejectInteraction(interactionID: string, raw: z.input<typeof RejectInteractionInput>) {
    const input = RejectInteractionInput.parse(raw)
    const row = requireInteraction(interactionID)
    if (row.payload?.protocol_request === true) {
      await rejectProtocolInteraction(row, input.message)
      await EngineRuntime.syncTask(row.task_id, hooks())
      return viewInteraction(requireInteraction(interactionID))
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
    return viewInteraction(requireInteraction(interactionID))
  }

  export async function cancelTask(taskID: string) {
    const task = requireTask(taskID)
    // Abort Orchestrator and any in-progress pipeline stage
    Orchestrator.abort(taskID)
    abortTaskPipeline(taskID)
    const liveGoalRuns = listGoalRunsForTask(taskID).filter((row) =>
      !["completed", "failed", "aborted"].includes(row.status),
    )
    await Promise.all(liveGoalRuns.map(async (row) => {
      const refs = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? row.metadata as Record<string, unknown>
        : undefined
      // goal_run executor follows its coordinator run — the separate column
      // was dead (written only, never read). Resolve via the parent run.
      const coordinatorRun = findRun(row.coordinator_run_id)
      if (!coordinatorRun) return
      await ExecutorRegistry.require(coordinatorRun.executor).abort({
        sessionID:
          typeof refs?.provider_session_id === "string"
            ? refs.provider_session_id
            : row.session_id ?? undefined,
        queueTaskID: typeof refs?.queue_task_id === "string" ? refs.queue_task_id : undefined,
      }).catch(() => false)
    }))
    const { abortLiveExecutionForTask } = await import("@/engine/writer")
    await abortLiveExecutionForTask({
      taskID,
      reason: "task cancelled",
      cleanupGoalWorkspaces: true,
      includeRuns: false,
    })
    const run = findActiveRunForTask(task.id)
    if (run) {
      await ExecutorRegistry.require(run.executor).abort({
        sessionID: run.session_id ?? undefined,
        queueTaskID: run.executor_ref?.queue_task_id,
      })
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
    await updateTask(
      task,
      {
        status: "cancelled",
        error: "task cancelled",
        time_completed: Date.now(),
      },
      "Task cancelled",
    )
    // Clean up channel bindings so the thread is not reused
    Database.use((db) =>
      db
        .delete(EngineChannelBindingTable)
        .where(eq(EngineChannelBindingTable.task_id, taskID))
        .run(),
    )
    return true
  }

  export async function deleteSession(sessionID: string, input?: { deleteTasks?: boolean }) {
    const ids = await sessionTree(sessionID)
    if (input?.deleteTasks) {
      const tasks = Database.use((db) =>
        db
          .select()
          .from(EngineTaskTable)
          .where(
            and(
              eq(EngineTaskTable.project_id, Instance.project.id),
              inArray(EngineTaskTable.session_id, ids),
            ),
          )
          .all(),
      )
      for (const item of tasks) {
        if (isTaskTerminal(item)) continue
        await cancelTask(item.id)
      }
      Database.use((db) => {
        db
          .delete(EngineTaskTable)
          .where(
            and(
              eq(EngineTaskTable.project_id, Instance.project.id),
              inArray(EngineTaskTable.session_id, ids),
            ),
          )
          .run()
        Database.effect(() => Database.incrementalVacuum())
      })
    }
    await Session.remove(sessionID)
    return true
  }

  export async function retryTask(taskID: string) {
    const task = requireTask(taskID)
    if (!isTaskTerminal(task)) {
      throw new Error(`task ${taskID} is already active`)
    }
    // Reset to queued and hand scheduling back to the single queue/coordinator entry.
    await updateTask(task, { status: "queued", error: null }, "Retry requested by operator")
    void dispatchTaskLoop({ taskID, event: { note: OrchestratorEventNote.retry(task) } })
    return viewTask(requireTask(taskID))
  }

  export async function recordOperatorNote(taskID: string, note: string) {
    const task = requireTask(taskID)
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
    if (!run) {
      return { resumed: false, status: deriveTaskStatus(task) }
    }
    if (isTaskCompleted(task) || isTaskCancelled(task)) {
      return { resumed: false, status: deriveTaskStatus(task) }
    }
    if (["accepted", "running"].includes(run.status)) {
      return { resumed: false, status: run.status }
    }
    const nextRunID = await EngineRuntime.createOperatorRun(task, run, note)
    void dispatchTaskLoop({ taskID: task.id, event: { note: OrchestratorEventNote.retry(task) } })
    return { resumed: true, status: "active" as const }
  }

  export async function handleTaskMessage(taskID: string, raw: z.input<typeof TaskMessageInput>) {
    const input = TaskMessageInput.parse(raw)
    const task = requireTask(taskID)

    if (isTaskFailed(task) || isTaskCancelled(task)) {
      // Symmetric guard for both terminal-error states. Without the cancelled
      // branch the message would persist via continueTaskMessage and trigger
      // dispatchTaskLoop, but the loop has already torn down — the message
      // strands in DB with no listener (the audit's Q1 finding).
      const reason = isTaskCancelled(task) ? "cancelled" : "failed"
      return {
        kind: "note" as const,
        message: `Task is ${reason}. Retry the task before sending more guidance. This message was not recorded.`,
        should_resume: false,
      }
    }

    // Decode base64 attachments once, write bytes to AttachmentStore, and carry
    // references downstream. Mirrors createTask so that follow-up messages and
    // new-task messages share the same persistence shape.
    const attachmentRefs: AttachmentStore.Reference[] = []
    if (input.attachments?.length) {
      const projectID = Instance.project.id
      for (const att of input.attachments) {
        const bytes = Buffer.from(att.data, "base64")
        const ref = await AttachmentStore.write(projectID, bytes, att.mime, att.filename)
        const intent = att.mime.startsWith("image/") ? "visual_reference" : "spec_artifact"
        attachmentRefs.push({ ...ref, intent, source: "user-upload" })
      }
    }

    // Natural-language user messages are recorded verbatim as operator notes and
    // forwarded to the Orchestrator. The agent reads notes in-context and decides
    // whether the message implies a goal change, a plan hint, or is mere
    // context — no separate LLM-based intent classifier, no keyword dispatch.
    // This removes the "Intent analysis failed" failure mode and the /goal
    // /plan prefix handlers (keyword-matching is forbidden by project rule 12).
    recordNote({
      taskID,
      kind: "operator_note",
      content: input.text,
      source: input.source ?? "user_message",
      userID: input.user_id,
    })
    await EngineProtocol.emit(Event.TaskMessageRecorded, {
      taskID,
      kind: "note",
      source: input.source ?? "user_message",
      text: input.text,
      summary: "Operator note recorded",
    }, { taskID, source: "service.message" })
    const note = await continueTaskMessage(taskID, input.text, attachmentRefs)
    const message = note.resumed
      ? "Operator note recorded. Scheduler notified."
      : "Operator note recorded."
    return {
      kind: "note" as const,
      message,
      should_resume: note.resumed,
      user_message: note.user_message,
    }
  }

  /**
   * 向正在运行的 task 注入消息。
   * 如果当前 run 正在执行且 executor 支持 resume，直接注入到 session；
   * 否则退化为 operator note（创建新 run）。
   *
   * orchestrator-loop wake 与 executor resume 是两个独立动作:
   *   - executor.resume = 把消息送进正在跑的 build agent sub-session
   *     (best effort: 该 session 可能已结束或没有此特定 build agent active)
   *   - dispatchTaskLoop = 触发 orchestrator-loop 重新运行一轮决策
   *     (orchestrator agent 通过 describe + new note 看到注入的 message)
   *
   * 历史 wedge: orchestrator deferred stop 后 (e.g. delivery_render_rejected),
   * run.status 仍 "running" 但 orchestrator-loop 已退出. 之前路径只 resume
   * executor session (build agent 早已 finished, resume 无效) 然后短路返回.
   * recordOperatorNote 又因 status === "running" 跳过 dispatchTaskLoop. 没人
   * 唤醒 orchestrator → 被注入的 operator message 永远没被读到.
   *
   * 修复: 与 continueTaskMessage (chat 路径) 行为对齐, 必须始终
   * dispatchTaskLoop, 把消息变成 OrchestratorEventNote.operatorMessage 唤醒
   * 决策循环. 见 _session-20260429-014338.out 实证 (codex 0.125 benchmark).
   */
  export async function injectMessage(taskID: string, message: string) {
    const task = requireTask(taskID)
    const run = findActiveRunForTask(task.id)
    if (!run) throw new Error(`No active run for task ${taskID}`)
    const resumed = await injectRunningTaskMessage(task, run, message)
    if (!resumed) {
      await appendTaskSessionMessage(task, message)
    }
    void dispatchTaskLoop({
      taskID,
      event: {
        note: OrchestratorEventNote.operatorMessage({ text: message }),
        operatorMessage: { text: message },
      },
      interrupt: true,
    })
    return { resumed: true, status: "active" as const }
  }

  /**
   * 基于任务结束时的状态推断用户最可能想让 AI 继续做的下一步，返回单条
   * 可直接填入输入框的简短中文建议。仅面向 overlay 输入框体验，不修改
   * 任何任务状态。LLM 失败会抛出错误，调用方自行处理（禁止 fallback）。
   */
  export async function generateFollowup(taskID: string): Promise<{ suggestion: string }> {
    const task = requireTask(taskID)
    const model = await resolveAgentModel("summary", { sessionID: task.session_id ?? undefined })
    const language = await Provider.getLanguage(model)

    const sessionID = task.session_id ?? undefined
    const messages = sessionID
      ? await Session.messages({ sessionID, limit: 6 })
      : []
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

    const run = findActiveRunForTask(task.id)
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
    const stream = streamObject({
      model: language,
      temperature: model.providerID.startsWith("moonshotai") ? 1 : 0,
      messages: followupMessages,
      schema: z.object({ suggestion: z.string() }),
    })

    try {
      for await (const part of stream.fullStream) {
        if (part.type === "error") throw part.error
      }
      const final = await stream.object
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

  export async function abortRun(runID: string) {
    const run = requireRun(runID)
    await ExecutorRegistry.require(run.executor).abort({
      sessionID: run.session_id ?? undefined,
      queueTaskID: run.executor_ref?.queue_task_id,
    })
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
    const { abortExecutorSessionForRun } = await import("@/engine/writer")
    abortExecutorSessionForRun(runID)
    const task = requireTask(run.task_id)
    if (findActiveRunForTask(task.id)?.id === run.id) {
      await updateTask(task, { status: "failed", error: "run aborted", time_completed: Date.now() }, "Run aborted")
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
    markProtocolInteraction(row, "answered", {
      reply: input.reply ?? "once",
      message: input.message,
    }, now)
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
  markProtocolInteraction(row, "answered", {
    answers: response,
    message: input.message,
  }, now)
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
        EngineProtocol.emit(Event.InteractionResolved, {
          taskID: row.task_id,
          runID,
          interactionID: row.id,
          status,
          summary: status === "answered" ? "Interaction answered" : "Interaction rejected",
        }, { taskID: row.task_id, runID, interactionID: row.id, source: "service.interaction" }),
      )
    }
  })
}

async function sessionTree(sessionID: string): Promise<string[]> {
  const children = await Session.children(sessionID)
  const nested = await Promise.all(children.map((item) => sessionTree(item.id)))
  return [sessionID, ...nested.flat()]
}
