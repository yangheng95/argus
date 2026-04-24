import z from "zod"
import { createDecisionLog } from "@/decision-log"
import { goalStatusByID } from "@/engine/describe"
import {
  findActivePlanForTask,
  findActiveRunForTask,
  findActiveSpecForTask,
  findLatestTipGoalRun,
  findDeliveriesForTask,
  findEvaluationsByTask,
  findDeliveryByGoalRun,
  findLatestEvaluationForGoalRun,
  listGoalRunsByGoal,
  type DeliveryRow,
  type EvaluationRow,
  type RunRow,
} from "@/engine/store"
import {
  findSpecSnapshot,
  viewSpecSnapshot,
  EngineArtifactTable,
  EngineChannelBindingTable,
  EngineExecutorSessionTable,
  EngineGoalTable,
  EngineInteractionRequestTable,
  EnginePlanNodeTable,
  EnginePlanVersionTable,
  EngineProgressSnapshotTable,
  EngineRequirementTable,
  EngineTaskTable,
  EvaluationCheck,
  TaskBoardGoalStepPayload,
  WorkflowRegistry,
} from "@/engine"
import { projectGoalSteps, projectTaskSteps, type MiniWorkflowStep } from "@/engine/workflow"
import { Instance } from "@/project/instance"
import { ProtocolEventTable } from "@/protocol/protocol.sql"
import { Database, and, desc, eq, sql } from "@/storage/db"
import { WorkbenchTaskNoteTable } from "./workbench.sql"
import { compileBrief } from "./brief"
import { plannerReportFromMetadata } from "@/planner/output-tools"

const BOARD_SNAPSHOT_LIMIT = 80
const BOARD_CHANGED_FILE_LIMIT = 80
const BOARD_SUMMARY_LIMIT = 4000

const boardCache = new Map<string, { tag: string; board: ReturnType<typeof buildBoard> }>()

export function compileBoard(input: { taskID: string }) {
  const task = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, input.taskID)).get())
  if (!task) throw new Error(`Task not found: ${input.taskID}`)
  const tag = boardTagForTask(task)
  const cached = boardCache.get(task.id)
  if (cached?.tag === tag) return cached.board
  const board = buildBoard(task)
  boardCache.set(task.id, { tag, board })
  return board
}

export function boardTag(input: { taskID: string }) {
  const task = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, input.taskID)).get())
  if (!task) throw new Error(`Task not found: ${input.taskID}`)
  return boardTagForTask(task)
}

function buildBoard(task: typeof EngineTaskTable.$inferSelect) {
  const run = findActiveRunForTask(task.id)
  const plan = findActivePlanForTask(task.id)
  // Query goals by plan if available, otherwise fall back to task_id so that
  // goals created during decomposition are visible before create_run sets
  // the plan status to active.
  const goals = plan
    ? Database.use((db) =>
        db
          .select()
          .from(EngineGoalTable)
          .where(eq(EngineGoalTable.plan_version_id, plan.id))
          .orderBy(EngineGoalTable.order_index)
          .all(),
      )
    : Database.use((db) =>
        db
          .select()
          .from(EngineGoalTable)
          .where(eq(EngineGoalTable.task_id, task.id))
          .orderBy(EngineGoalTable.order_index)
          .all(),
      )
  const interactions = Database.use((db) =>
    db
      .select()
      .from(EngineInteractionRequestTable)
      .where(eq(EngineInteractionRequestTable.task_id, task.id))
      .orderBy(EngineInteractionRequestTable.time_created)
      .all(),
  )
  const notes = Database.use((db) =>
    db
      .select()
      .from(WorkbenchTaskNoteTable)
      .where(eq(WorkbenchTaskNoteTable.task_id, task.id))
      .orderBy(desc(WorkbenchTaskNoteTable.time_created))
      .limit(12)
      .all()
      .reverse(),
  )
  const brief = compileBrief({
    taskID: task.id,
    runID: run?.id ?? undefined,
    planVersionID: plan?.id ?? undefined,
    sessionID: task.session_id ?? undefined,
  })
  const staging = notes.filter((note) =>
    ["goal_update", "operator_note", "constraint", "decision"].includes(note.kind),
  )
  const history = notes.filter((note) => ["user_request", "summary"].includes(note.kind))
  // Phase 5-e: board reads through the engine/store projection helpers
  // instead of issuing its own SQL against EngineDelivery / EngineEvaluation.
  // The store helpers return newest-first; board callers below still want
  // oldest-first order (semantic matches the previous `orderBy(time_created)`
  // ascending + `.at(-1)` pattern), so reverse once here.
  const allDeliveries = [...findDeliveriesForTask(task.id)].reverse()
  const delivery = run ? allDeliveries.filter((item) => item.run_id === run.id).at(-1) : undefined
  const latestDelivery = delivery ?? allDeliveries.at(-1)
  const allEvaluations = [...findEvaluationsByTask(task.id)].reverse()
  const evaluation = run ? allEvaluations.filter((item) => item.run_id === run.id).at(-1) : undefined
  const latestEvaluation = evaluation ?? allEvaluations.at(-1)
  const acceptedEvaluation = [...allEvaluations]
    .reverse()
    .find((item) => item.verdict === "accepted" || item.status === "passed")
  const acceptedDelivery = acceptedEvaluation?.delivery_id
    ? allDeliveries.find((item) => item.id === acceptedEvaluation.delivery_id)
    : undefined
  const bindings = Database.use((db) =>
    db
      .select()
      .from(EngineChannelBindingTable)
      .where(eq(EngineChannelBindingTable.task_id, task.id))
      .orderBy(EngineChannelBindingTable.time_created)
      .all(),
  )
  const artifacts = run
    ? Database.use((db) =>
        db
          .select()
          .from(EngineArtifactTable)
          .where(eq(EngineArtifactTable.run_id, run.id))
          .orderBy(EngineArtifactTable.time_created)
          .all(),
      )
    : []
  const latestArtifacts =
    artifacts.length > 0
      ? artifacts
      : latestDelivery
        ? Database.use((db) =>
            db
              .select()
              .from(EngineArtifactTable)
              .where(eq(EngineArtifactTable.delivery_id, latestDelivery.id))
              .orderBy(EngineArtifactTable.time_created)
              .all(),
          )
        : []
  const pendingInteractions = interactions.filter((item) => item.status === "pending")
  const currentFailure = boardFailure({
    task,
    run,
    interactions: pendingInteractions,
    evaluation: latestEvaluation,
  })
  const overview = boardOverview({
    task,
    run,
    pendingInteractions,
    candidateDelivery: latestDelivery,
    acceptedDelivery,
    evaluation: latestEvaluation,
    currentFailure,
  })

  const specRow = findActiveSpecForTask(task.id)
  const specSnapshot = specRow ? viewSpecSnapshot(specRow) : undefined

  // lastSequence: must use the same sequence space as protocol_event.seq
  // (auto-incrementing integer), NOT timestamps. The panel's monotonic guard
  // compares this against SSE event.sequence — mismatched number spaces
  // would cause ALL SSE events to be silently discarded.
  const lastSequence = Database.use((db) =>
    db.select({ seq: sql<number>`coalesce(max(seq), 0)` })
      .from(ProtocolEventTable)
      .where(eq(ProtocolEventTable.task_id, task.id))
      .get()?.seq ?? 0
  )

  // Workflow-structured fields (workflow, goalWorkflows, requirements, architect).
  // Step status is projected fresh from DB rows each render (no FSM cache).
  const workflowFields = buildWorkflowFields(task, goals)

  return {
      lastSequence,
      ...workflowFields,
      spec: specSnapshot,
      task: {
        id: task.id,
        projectID: task.project_id,
        directory: Instance.directory,
        sessionID: task.session_id ?? undefined,
        activePlanVersionID: plan?.id ?? undefined,
        activeRunID: run?.id ?? undefined,
        requestID: task.request_id ?? undefined,
        source: task.source,
        kind: task.kind,
        title: task.title,
        request: task.request,
        status: task.status,
        priority: task.priority,
        // Phase-6-f-4: blocking lives on run (or none when no active run).
        blockingReason: run?.blocking_reason ?? undefined,
        error: task.error ?? undefined,
        budget: task.budget
          ? {
              maxRuns: task.budget.max_runs,
              maxFixRuns: task.budget.max_fix_runs,
            }
          : undefined,
        metadata: task.metadata ?? undefined,
        // Attachment references (url/mime/filename/sha/size/intent/source) —
        // the overlay's `buildUserContextMessages` appends each as a file part
        // under the synthetic user-request bubble so images render inline.
        attachments: Array.isArray(task.attachments) ? task.attachments : undefined,
        time: {
          created: task.time_created,
          updated: task.time_updated,
          started: task.time_started ?? undefined,
          completed: task.time_completed ?? undefined,
        },
      },
      plan: plan
        ? {
            id: plan.id,
            taskID: plan.task_id,
            version: plan.version,
            status: plan.status,
            summary: plan.summary,
            prompt: plan.prompt,
            metadata: plan.metadata ?? undefined,
            time: {
              created: plan.time_created,
              updated: plan.time_updated,
            },
          }
        : undefined,
      run: run
        ? {
            id: run.id,
            taskID: run.task_id,
            planVersionID: run.plan_version_id ?? undefined,
            sessionID: run.session_id ?? undefined,
            executor: run.executor,
            status: run.status,
            phase: run.phase,
            blockingReason: run.blocking_reason ?? undefined,
            error: run.error ?? undefined,
            retryCount: run.retry_count,
            executorRef: run.executor_ref
              ? {
                  sessionID: run.executor_ref.session_id,
                  queueTaskID: run.executor_ref.queue_task_id,
                }
              : undefined,
            metadata: run.metadata ?? undefined,
            time: {
              created: run.time_created,
              updated: run.time_updated,
              started: run.time_started ?? undefined,
              completed: run.time_completed ?? undefined,
            },
          }
        : undefined,
      delivery: viewBoardDelivery(latestDelivery),
      candidateDelivery: viewBoardDelivery(latestDelivery),
      acceptedDelivery: viewBoardDelivery(acceptedDelivery),
      evaluation: viewBoardEvaluation(latestEvaluation),
      interactions: interactions.map((item) => ({
        id: item.id,
        taskID: item.task_id,
        runID: item.run_id,
        sessionID: item.session_id ?? undefined,
        externalID: item.external_id,
        type: item.request_type,
        status: item.status,
        title: item.title,
        body: item.body,
        payload: item.payload ?? undefined,
        response: item.response ?? undefined,
        time: {
          created: item.time_created,
          updated: item.time_updated,
          resolved: item.time_resolved ?? undefined,
        },
      })),
      channels: bindings.map((item) => ({
        id: item.id,
        platform: item.platform,
        channel: item.channel,
        thread: item.thread,
        payload: item.payload ?? undefined,
        time: {
          created: item.time_created,
          updated: item.time_updated,
        },
      })),
      artifacts: latestArtifacts
        .filter((item) => item.kind !== "diff" && item.kind !== "changed_file")
        .map((item) => ({
        id: item.id,
        taskID: item.task_id,
        runID: item.run_id,
        deliveryID: item.delivery_id ?? undefined,
        kind: item.kind,
        label: item.label,
        payload: compactArtifactPayload(item.kind, item.payload),
        time: {
          created: item.time_created,
          updated: item.time_updated,
        },
      })),
      overview,
      brief: {
        content: brief.content,
        updated_at: brief.updatedAt ?? Date.now(),
      },
      // Task-level criteria rollup. Sourced from engine_task.criteria_results,
      // populated by:
      //   - delivery agent verdict (deferred_checks + rejection_details + overall),
      //     sunk via orchestrator/tools.ts → sinkDeliveryVerdictToCriteria()
      //   - in-process visual-diff gate (orchestrator/tools.ts, when task carries
      //     image attachments and a rendered index.html exists)
      // Hidden in the overlay for kind=build tasks (build self-verifies; this
      // panel only applies to workflow tasks running through delivery).
      criteriaResults: boardChecks(task.criteria_results),
  }
}

function boardTagForTask(task: typeof EngineTaskTable.$inferSelect) {
  const run = findActiveRunForTask(task.id)
  const plan = findActivePlanForTask(task.id)
  const goals = Database.use((db) =>
    db
      .select({
        count: sql<number>`count(*)`,
        updated: sql<number>`coalesce(max(${EngineGoalTable.time_updated}), 0)`,
      })
      .from(EngineGoalTable)
      .where(eq(EngineGoalTable.task_id, task.id))
      .get(),
  )
  // goalRuns: include goal_run status transitions in the tag. Goal-scoped state
  // changes (queued → running → completed/failed) happen on goal_run rows BEFORE
  // the parent goalStatusByID(goal.id) is updated, so we need both tables in the tag or the
  // frontend will see stale "running" state during execution.
  const goalRuns = Database.use((db) =>
    db
      .select({
        count: sql<number>`count(distinct ${EngineArtifactTable.goal_run_id})`,
        updated: sql<number>`coalesce(max(${EngineArtifactTable.time_updated}), 0)`,
      })
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, task.id),
          eq(EngineArtifactTable.kind, "goal_run_attempt"),
        ),
      )
      .get(),
  )
  const executorSessions = Database.use((db) =>
    db
      .select({
        count: sql<number>`count(*)`,
        updated: sql<number>`coalesce(max(${EngineExecutorSessionTable.time_updated}), 0)`,
      })
      .from(EngineExecutorSessionTable)
      .where(eq(EngineExecutorSessionTable.task_id, task.id))
      .get(),
  )
  const interactions = Database.use((db) =>
    db
      .select({
        count: sql<number>`count(*)`,
        updated: sql<number>`coalesce(max(${EngineInteractionRequestTable.time_updated}), 0)`,
      })
      .from(EngineInteractionRequestTable)
      .where(eq(EngineInteractionRequestTable.task_id, task.id))
      .get(),
  )
  // Phase 5-e: derive {count, updated} from the same projection helpers the
  // board already reads for full rows. Two small arrays instead of two
  // aggregate SQL queries — acceptable overhead, eliminates the direct-SQL
  // coupling to EngineDelivery / EngineEvaluation tables here.
  const allDeliveriesForTag = findDeliveriesForTask(task.id)
  const deliveries = {
    count: allDeliveriesForTag.length,
    updated: allDeliveriesForTag.reduce((max, row) => Math.max(max, row.time_updated ?? 0), 0),
  }
  const allEvaluationsForTag = findEvaluationsByTask(task.id)
  const evaluations = {
    count: allEvaluationsForTag.length,
    updated: allEvaluationsForTag.reduce((max, row) => Math.max(max, row.time_updated ?? 0), 0),
  }
  const artifacts = Database.use((db) =>
    db
      .select({
        count: sql<number>`count(*)`,
        updated: sql<number>`coalesce(max(${EngineArtifactTable.time_updated}), 0)`,
      })
      .from(EngineArtifactTable)
      .where(eq(EngineArtifactTable.task_id, task.id))
      .get(),
  )
  const bindings = Database.use((db) =>
    db
      .select({
        count: sql<number>`count(*)`,
        updated: sql<number>`coalesce(max(${EngineChannelBindingTable.time_updated}), 0)`,
      })
      .from(EngineChannelBindingTable)
      .where(eq(EngineChannelBindingTable.task_id, task.id))
      .get(),
  )
  const snapshots = Database.use((db) =>
    db
      .select({
        count: sql<number>`count(*)`,
        updated: sql<number>`coalesce(max(${EngineProgressSnapshotTable.time_updated}), 0)`,
      })
      .from(EngineProgressSnapshotTable)
      .where(eq(EngineProgressSnapshotTable.task_id, task.id))
      .get(),
  )
  const noteStats = Database.use((db) =>
    db
      .select({
        count: sql<number>`count(*)`,
        updated: sql<number>`coalesce(max(${WorkbenchTaskNoteTable.time_updated}), 0)`,
      })
      .from(WorkbenchTaskNoteTable)
      .where(eq(WorkbenchTaskNoteTable.task_id, task.id))
      .get(),
  )
  return [
    task.id,
    task.time_created,
    task.time_updated,
    task.budget?.max_runs ?? "",
    run?.id ?? "",
    run?.time_updated ?? 0,
    plan?.id ?? "",
    plan?.time_updated ?? 0,
    goals?.count ?? 0,
    goals?.updated ?? 0,
    goalRuns?.count ?? 0,
    goalRuns?.updated ?? 0,
    executorSessions?.count ?? 0,
    executorSessions?.updated ?? 0,
    noteStats?.count ?? 0,
    noteStats?.updated ?? 0,
    interactions?.count ?? 0,
    interactions?.updated ?? 0,
    deliveries?.count ?? 0,
    deliveries?.updated ?? 0,
    evaluations?.count ?? 0,
    evaluations?.updated ?? 0,
    artifacts?.count ?? 0,
    artifacts?.updated ?? 0,
    bindings?.count ?? 0,
    bindings?.updated ?? 0,
    snapshots?.count ?? 0,
    snapshots?.updated ?? 0,
  ].join("|")
}

function clipBoard(input: string) {
  if (input.length <= BOARD_SUMMARY_LIMIT) return input
  return `${input.slice(0, BOARD_SUMMARY_LIMIT)}\n...[truncated]`
}

function compactArtifactPayload(kind: string, input: unknown) {
  if (!input || typeof input !== "object") return undefined
  const item = input as Record<string, unknown>
  if (kind === "log") {
    return {
      command: typeof item.command === "string" ? item.command : undefined,
      code: typeof item.code === "number" ? item.code : undefined,
      output: typeof item.output === "string" ? clipBoard(item.output) : undefined,
    }
  }
  if (kind === "report") {
    return Object.fromEntries(
      Object.entries(item).map(([key, value]) => [
        key,
        typeof value === "string" ? clipBoard(value) : value,
      ]),
    )
  }
  return item
}

function boardChecks(input: unknown) {
  if (!Array.isArray(input)) return []
  return input.flatMap((item) => {
    const parsed = EvaluationCheck.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}

function viewBoardDelivery(
  row: DeliveryRow | undefined,
) {
  if (!row) return undefined
  const result = (row.result ?? {}) as Record<string, unknown>
  return {
    id: row.id,
    taskID: row.task_id,
    runID: row.run_id,
    status: row.status,
    summary: clipBoard(row.summary),
    result: {
      summary: clipBoard(String(result.summary ?? row.summary)),
      changedFiles: Array.isArray(result.changed_files)
        ? result.changed_files.filter((item): item is string => typeof item === "string").slice(0, BOARD_CHANGED_FILE_LIMIT)
        : [],
      diffs: Array.isArray(result.diffs)
        ? result.diffs
            .filter((d: any): d is Record<string, unknown> => d && typeof d === "object" && typeof d.file === "string")
            .slice(0, BOARD_CHANGED_FILE_LIMIT)
            .map((d: any) => ({
              file: d.file as string,
              additions: typeof d.additions === "number" ? d.additions : 0,
              deletions: typeof d.deletions === "number" ? d.deletions : 0,
              status: d.status ?? (!d.before && d.after ? "added" : d.before && !d.after ? "deleted" : "modified"),
            }))
        : [],
      artifacts: Array.isArray(result.artifacts) ? result.artifacts.slice(0, 12) : [],
      publish: result.publish && typeof result.publish === "object" ? result.publish : undefined,
    },
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  }
}

function viewBoardEvaluation(
  row: EvaluationRow | undefined,
) {
  if (!row) return undefined
  return {
    id: row.id,
    taskID: row.task_id,
    runID: row.run_id,
    deliveryID: row.delivery_id ?? undefined,
    status: row.status,
    verdict: row.verdict,
    summary: clipBoard(row.summary),
    checks: boardChecks(row.checks),
    time: {
      created: row.time_created,
      updated: row.time_updated,
      completed: row.time_completed ?? undefined,
    },
  }
}

function boardFailure(input: {
  task: typeof EngineTaskTable.$inferSelect
  run: RunRow | undefined
  interactions: Array<typeof EngineInteractionRequestTable.$inferSelect>
  evaluation: EvaluationRow | undefined
}) {
  const interaction = input.interactions[0]
  if (interaction) {
    return {
      source: "interaction" as const,
      title: interaction.title,
      summary:
        input.interactions.length > 1
          ? `${clipBoard(interaction.body)}\n\n${input.interactions.length} pending interactions need attention.`
          : clipBoard(interaction.body),
      checks: undefined,
    }
  }
  if (input.evaluation && input.evaluation.status !== "passed") {
    return {
      source: "evaluation" as const,
      title: "Latest acceptance failed",
      summary: clipBoard(input.evaluation.summary),
      checks: boardChecks(input.evaluation.checks),
    }
  }
  if (input.run?.error) {
    return {
      source: "run" as const,
      title: "Current run failed",
      summary: clipBoard(input.run.error),
      checks: undefined,
    }
  }
  if (input.task.error) {
    return {
      source: "task" as const,
      title: "Task failed",
      summary: clipBoard(input.task.error),
      checks: undefined,
    }
  }
  // Phase-6-f-4: blocking is a run-scoped signal; task-level blocking_reason
  // cache column removed. Fall back to nothing when no run is live.
  const blocking = input.run?.blocking_reason
  if (!blocking) return undefined
  return {
    source: "run" as const,
    title: "Task is blocked",
    summary: clipBoard(blocking),
    checks: undefined,
  }
}

function boardOverview(input: {
  task: typeof EngineTaskTable.$inferSelect
  run: RunRow | undefined
  pendingInteractions: Array<typeof EngineInteractionRequestTable.$inferSelect>
  candidateDelivery: DeliveryRow | undefined
  acceptedDelivery: DeliveryRow | undefined
  evaluation: EvaluationRow | undefined
  currentFailure:
    | {
        source: "task" | "run" | "interaction" | "evaluation"
        title: string
        summary: string
        checks?: Array<z.infer<typeof EvaluationCheck>>
      }
    | undefined
}) {
  const active = ["queued", "active"].includes(input.task.status)
  const canResume = Boolean(input.run) && !active && input.pendingInteractions.length === 0
  const headline =
    input.pendingInteractions.length > 0
      ? "Waiting on human input"
      : input.task.status === "completed"
        ? "Accepted delivery is ready"
        : input.task.status === "failed"
          ? "Current attempt failed acceptance"
          : input.task.status === "cancelled"
            ? "Task was cancelled"
            : input.task.status === "active"
              ? input.run?.blocking_reason
                ? "Task is blocked"
                : "Task is actively progressing"
              : "Task is queued"
  const summary =
    input.pendingInteractions.length > 0
      ? `${input.pendingInteractions.length} interaction${input.pendingInteractions.length > 1 ? "s" : ""} need attention before the task can continue.`
      : input.task.status === "completed" && input.acceptedDelivery
        ? clipBoard(input.acceptedDelivery.summary)
        : input.currentFailure?.summary ??
          (input.candidateDelivery
            ? clipBoard(input.candidateDelivery.summary)
            : input.run
              ? `Current run is in ${input.run.phase}.`
              : "Task is ready for the first run.")
  const nextStep =
    input.pendingInteractions.length > 0
      ? {
          kind: "resolve_blocker" as const,
          title: "Resolve the pending interaction",
          detail: "Reply to the permission or question request to unblock the task.",
        }
      : input.task.status === "failed"
        ? {
            kind: "replan" as const,
            title: "Replan from the latest failure",
            detail: "Review the failed acceptance result, tighten the scope if needed, then replan or retry.",
          }
        : input.task.status === "cancelled"
          ? {
              kind: "retry" as const,
              title: "Retry if the task should continue",
              detail: "The task is cancelled. Retry will queue a new run from the latest context.",
            }
            : input.task.status === "completed"
              ? {
                  kind: "review_delivery" as const,
                  title: "Review the accepted delivery",
                  detail: "Inspect the accepted result, changed files, and evaluation evidence before closing the loop.",
                }
              : active
              ? {
                  kind: "observe" as const,
                  title: "Monitor the active run",
                  detail: "Watch progress, handle blockers quickly, and keep follow-up instructions concise.",
                }
              : {
                  kind: "message" as const,
                  title: "Add the next instruction",
                  detail: "Use natural language to refine goals, preferences, or plan hints before resuming the task.",
                }

  return {
    headline,
    summary,
    currentFailure: input.currentFailure,
    nextStep,
    controls: {
      canRetry: canResume,
      canReplan: canResume && Boolean(findActivePlanForTask(input.task.id) ?? input.run?.plan_version_id),
      canCancel: Boolean(input.run) && ["queued", "active"].includes(input.task.status),
    },
  }
}

// ═══════════════════════════════════════════════════════════════════
// MiniWorkflow board fields — workflow shape, per-goal workflows,
// requirements list, and architect summary. Workflow template always
// defaults to pipeline; task-scope step status is projected from
// side-effects (spec / goals / runs / delivery presence), goal-scope
// step status from the goal_run chain.
// ═══════════════════════════════════════════════════════════════════

function buildWorkflowFields(
  task: typeof EngineTaskTable.$inferSelect,
  goals: Array<typeof EngineGoalTable.$inferSelect>,
) {
  // Phase-6-f-3-bis-b: workflow_state no longer persisted. Default to the
  // pipeline workflow; if the task is direct-eligible (no goals, no spec,
  // build already ran) the orchestrator's `switchToDirectWorkflowIfEligible`
  // swaps in-memory — the board's role here is to provide a stable render
  // shape, not to authoritatively select which workflow owns the task.
  const workflow = WorkflowRegistry.resolveSync("pipeline")

  if (!workflow) {
    return {
      workflow: { id: "pipeline", name: "Pipeline", steps: [], goalLoopStepIDs: [] },
      goalWorkflows: [] as Array<unknown>,
      requirements: [] as Array<unknown>,
      architect: undefined,
    }
  }

  // Both task-scope and goal-scope step status are projected from DB rows
  // — task-scope from known side-effects (spec / goals / runs / delivery /
  // design_specs presence), goal-scope from the goal_run chain.
  const projectedGoalSteps = projectGoalSteps(task.id, workflow)
  const projectedTaskSteps = projectTaskSteps(task.id, workflow)

  const workflowBoard = {
    id: workflow.id,
    name: workflow.name,
    steps: workflow.steps.map(step => ({
      id: step.id,
      label: step.label,
      tool: step.tool,
      scope: step.scope as "task" | "goal",
      skippable: step.skippable,
      status: (step.scope === "task"
        ? (projectedTaskSteps[step.id]?.status ?? "pending")
        : deriveGoalScopeStatusFromProjection(projectedGoalSteps, step.id)) as "pending" | "running" | "completed" | "skipped" | "failed",
      ...(step.phases && step.phases.length > 0
        ? { phases: step.phases.map(p => ({ id: p.id, label: p.label, sessionKind: p.sessionKind })) }
        : {}),
    })),
    goalLoopStepIDs: workflow.goalLoopStepIDs,
  }

  const goalWorkflows = goals.map(goal => {
    const gws = projectedGoalSteps[goal.id]
    // Identify the current attempt by the tip goal_run id. Overlay uses
    // this to scope per-attempt step cards — each new attempt gets its
    // own cards instead of the prior attempt's cards being mutated
    // in-place and time-sorted to the bottom. `undefined` when the goal
    // has never dispatched (no goal_run yet) — overlay treats that as
    // the "pre-attempt" bucket under a stable pseudo-id.
    const tipRun = findLatestTipGoalRun(goal.id)
    return {
      goalID: goal.id,
      goalRunID: tipRun?.id,
      goalTitle: goal.title,
      // Architect writes the goal's `objective` as a 1–2 sentence execution
      // directive for the per-goal executor. Surface it on the overlay goal
      // card so operators see a proper summary instead of having to parse
      // acceptance_specs. Empty string stays `undefined` — the overlay's
      // GoalWorkflowGroup only renders this when present.
      goalObjective: goal.objective?.trim() ? goal.objective.trim() : undefined,
      goalStatus: goalStatusByID(goal.id),
      orderIndex: goal.order_index,
      workspaceDir: goal.workspace_dir ?? undefined,
      workspaceBranch: goal.workspace_branch ?? undefined,
      retryCount: goal.retry_count,
      acceptanceSpecs: goal.acceptance_specs,
      priority: (goal.priority ?? "blocking") as "blocking" | "advisory",
      steps: workflow.steps
        .filter(s => s.scope === "goal")
        .map(s => {
          const stepStatus = (gws?.steps[s.id]?.status ?? "pending") as "pending" | "running" | "completed" | "skipped" | "failed"
          const phaseProjection = gws?.stepPhases?.[s.id]
          return {
            stepID: s.id,
            label: s.label,
            status: stepStatus,
            startedAt: gws?.steps[s.id]?.startedAt,
            completedAt: gws?.steps[s.id]?.completedAt,
            summary: buildStepSummary(s, goal.id, stepStatus),
            payload: buildStepPayload(s, goal.id, stepStatus),
            ...(phaseProjection && Object.keys(phaseProjection).length > 0
              ? { phases: phaseProjection }
              : {}),
          }
        }),
    }
  })

  const requirements = findActiveSpecForTask(task.id)
    ? buildRequirements(task.id)
    : []

  const architect = buildArchitectSummary(task.id)

  return {
    workflow: workflowBoard,
    goalWorkflows,
    requirements,
    architect,
  }
}

/** Derive aggregate status for a goal-scope step from the projected goal steps */
function deriveGoalScopeStatusFromProjection(
  projection: Record<string, { steps: Record<string, { status: string }> }>,
  stepID: string,
): string {
  const entries = Object.values(projection)
  if (entries.length === 0) return "pending"
  const statuses = entries.map((g) => g.steps[stepID]?.status ?? "pending")
  if (statuses.some((s) => s === "running")) return "running"
  if (statuses.every((s) => s === "completed" || s === "skipped")) return "completed"
  if (statuses.some((s) => s === "failed")) return "failed"
  if (statuses.some((s) => s === "completed")) return "running"
  return "pending"
}

/** Build structured requirements array from DB */
function buildRequirements(taskID: string) {
  const rows = Database.use((db) =>
    db.select().from(EngineRequirementTable)
      .where(eq(EngineRequirementTable.task_id, taskID))
      .all(),
  )
  if (rows.length === 0) return undefined
  return rows.map((r) => ({
    id: r.id,
    description: r.description,
    type: r.priority === "blocking" ? "explicit" as const : "inferred" as const,
    priority: r.priority as "blocking" | "advisory",
    status: r.status,
  }))
}

/** Authoritative goal_run for a goal: the current supersede-chain tip. */
export function currentGoalRunFromRows<T extends { id: string; supersede_of?: string | null }>(
  rows: T[],
): T | undefined {
  if (rows.length === 0) return undefined
  const supersededIDs = new Set<string>()
  for (const row of rows) {
    if (row.supersede_of) supersededIDs.add(row.supersede_of)
  }
  return rows.find((row) => !supersededIDs.has(row.id)) ?? rows[0]
}

function currentGoalRun(goalID: string) {
  const rows = listGoalRunsByGoal(goalID)
  return currentGoalRunFromRows(rows)
}

// Phase 5-e: latest-evaluation-for-goal_run lives in engine/store as
// `findLatestEvaluationForGoalRun`. Local alias kept for readability.
const latestEvaluationForGoalRun = findLatestEvaluationForGoalRun

/** Build per-step summary text (e.g., "5 steps", "12 files", "3/4 checks").
 *  Only applies to goal-scope steps that own the plan + build + evaluate
 *  phase block — detected via the `phases` declaration rather than
 *  hardcoded step id, so renaming the step doesn't break the surface. */
function buildStepSummary(step: MiniWorkflowStep, goalID: string, status?: string): string | undefined {
  if (!status || status === "pending") return undefined
  if (step.scope !== "goal") return undefined
  if (!step.phases || step.phases.length === 0) return undefined

  const goalRun = currentGoalRun(goalID)
  if (goalRun) {
    const delivery = findDeliveryByGoalRun(goalRun.id)
    if (delivery) {
      const result = delivery.result as { changed_files?: string[]; diffs?: unknown[] } | null
      const fileCount = result?.changed_files?.length ?? result?.diffs?.length ?? 0
      if (fileCount > 0) return `${fileCount} files`
    }
  }
  if (status === "running") return "running…"
  // Pre-execution: surface plan-step count if planning has produced nodes.
  const nodes = Database.use((db) =>
    db.select().from(EnginePlanNodeTable)
      .where(eq(EnginePlanNodeTable.goal_id, goalID))
      .all(),
  )
  if (nodes.length) return `${nodes.length} planned steps`
  return undefined
}

/**
 * Per-goal step payload — full structured content for the GoalWorkflowGroup
 * StepRow to render. This replaces the old PlanPanel / ExecutorSummaryPanel /
 * CriteriaPanel / EvaluationPanel which read separate top-level fields.
 *
 * Per the panel正本清源 plan: every per-goal step carries its own payload so
 * the frontend never has to cross-reference task-level state. M2b/M2c/M2d
 * gradually fill out the three step types.
 */
export type GoalStepPayload = z.infer<typeof TaskBoardGoalStepPayload>

function buildStepPayload(step: MiniWorkflowStep, goalID: string, status?: string): GoalStepPayload | undefined {
  if (!status || status === "pending") return undefined
  // Payload applies only to goal-scope phase-owning steps — the plan +
  // build + evaluate block folds into one payload that ships plan nodes,
  // diff stats, and evaluator checks. Detected by phases presence, not
  // hardcoded step id.
  if (step.scope !== "goal") return undefined
  if (!step.phases || step.phases.length === 0) return undefined

  const goalRun = currentGoalRun(goalID)
  const nodes = Database.use((db) =>
    db.select().from(EnginePlanNodeTable)
      .where(eq(EnginePlanNodeTable.goal_id, goalID))
      .all(),
  )
  const planNodes = nodes.length > 0
    ? nodes
        .map((n) => {
          const report = plannerReportFromMetadata(n.metadata)
          return {
            id: n.id,
            title: n.title,
            brief: n.brief,
            orderIndex: n.order_index,
            fileActions: report?.file_actions,
            verificationCommands: report?.verification_commands,
          }
        })
        .sort((a, b) => a.orderIndex - b.orderIndex)
    : undefined

  let buildSessionID: string | undefined
  let workspaceDir: string | undefined
  let changedFiles: string[] | undefined
  let diffStats: { files?: number; additions?: number; deletions?: number } | undefined
  if (goalRun) {
    buildSessionID = goalRun.session_id ?? undefined
    workspaceDir = goalRun.workspace_dir ?? undefined
    const delivery = findDeliveryByGoalRun(goalRun.id)
    const result = delivery?.result as { changed_files?: string[]; diffs?: { file?: string }[]; stats?: { additions?: number; deletions?: number } } | null
    changedFiles = result?.changed_files
      ?? (Array.isArray(result?.diffs)
        ? result.diffs.map((d) => d.file).filter((f): f is string => typeof f === "string")
        : undefined)
    diffStats = {
      files: changedFiles?.length,
      additions: result?.stats?.additions,
      deletions: result?.stats?.deletions,
    }
  }

  let checks: GoalStepPayload["checks"] | undefined
  let evalSummary: string | undefined
  let verdict: string | undefined
  if (goalRun) {
    const evaluation = latestEvaluationForGoalRun(goalRun.id)
    if (evaluation) {
      const list = Array.isArray(evaluation.checks) ? evaluation.checks : []
      checks = list.map((c) => ({ name: c.name, status: c.status, evidence: c.evidence, family: c.family }))
      evalSummary = evaluation.summary
      verdict = evaluation.verdict
    }
  }

  if (
    planNodes === undefined &&
    buildSessionID === undefined &&
    workspaceDir === undefined &&
    changedFiles === undefined &&
    checks === undefined
  ) {
    return undefined
  }
  return { planNodes, buildSessionID, workspaceDir, changedFiles, diffStats, checks, evalSummary, verdict }
}

/** Build architect summary from Decision Log */
function buildArchitectSummary(taskID: string) {
  const log = createDecisionLog(taskID)
  const entries = log.readByPhase("architect")
  if (entries.length === 0) return undefined
  const categories = [...new Set(entries.map((e) => e.key))]
  return {
    summary: `${entries.length} architect decisions across ${categories.length} categories`,
    contractCount: entries.length,
    categories,
  }
}
