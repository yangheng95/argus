import z from "zod"
import { Preference } from "@/preference"
import { findSpecSnapshot, viewSpecSnapshot } from "@/orchestrator/store"
import {
  OrchestratorArtifactTable,
  OrchestratorChannelBindingTable,
  OrchestratorDeliveryTable,
  OrchestratorEvaluationTable,
  OrchestratorGoalRunTable,
  OrchestratorGoalTable,
  OrchestratorInteractionRequestTable,
  OrchestratorPlanVersionTable,
  OrchestratorProgressSnapshotTable,
  OrchestratorRunTable,
  OrchestratorTaskTable,
} from "@/orchestrator/orchestrator.sql"
import { EvaluationCheck } from "@/orchestrator/model"
import { Database, desc, eq, sql } from "@/storage/db"
import { WorkbenchTaskNoteTable } from "./workbench.sql"
import { compileBrief } from "./brief-compiler"

const BOARD_SNAPSHOT_LIMIT = 80
const BOARD_CHANGED_FILE_LIMIT = 80
const BOARD_SUMMARY_LIMIT = 4000

const boardCache = new Map<string, { tag: string; board: ReturnType<typeof buildBoard> }>()

export function compileBoard(input: { taskID: string }) {
  const task = Database.use((db) => db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, input.taskID)).get())
  if (!task) throw new Error(`Task not found: ${input.taskID}`)
  const tag = boardTagForTask(task)
  const cached = boardCache.get(task.id)
  if (cached?.tag === tag) return cached.board
  const board = buildBoard(task)
  boardCache.set(task.id, { tag, board })
  return board
}

export function boardTag(input: { taskID: string }) {
  const task = Database.use((db) => db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, input.taskID)).get())
  if (!task) throw new Error(`Task not found: ${input.taskID}`)
  return boardTagForTask(task)
}

function buildBoard(task: typeof OrchestratorTaskTable.$inferSelect) {
  const run = task.active_run_id
    ? Database.use((db) => db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.id, task.active_run_id!)).get())
    : undefined
  const plan = task.active_plan_version_id
    ? Database.use((db) => db.select().from(OrchestratorPlanVersionTable).where(eq(OrchestratorPlanVersionTable.id, task.active_plan_version_id!)).get())
    : undefined
  const goals = plan
    ? Database.use((db) =>
        db
          .select()
          .from(OrchestratorGoalTable)
          .where(eq(OrchestratorGoalTable.plan_version_id, plan.id))
          .orderBy(OrchestratorGoalTable.order_index)
          .all(),
      )
    : []
  const goalRunSessionMap = run
    ? new Map(
        Database.use((db) =>
          db
            .select({ goalID: OrchestratorGoalRunTable.goal_id, sessionID: OrchestratorGoalRunTable.session_id })
            .from(OrchestratorGoalRunTable)
            .where(eq(OrchestratorGoalRunTable.coordinator_run_id, run.id))
            .all(),
        ).map((r) => [r.goalID, r.sessionID]),
      )
    : new Map<string, string | null>()
  const interactions = Database.use((db) =>
    db
      .select()
      .from(OrchestratorInteractionRequestTable)
      .where(eq(OrchestratorInteractionRequestTable.task_id, task.id))
      .orderBy(OrchestratorInteractionRequestTable.time_created)
      .all(),
  )
  const prefs = Preference.list({
    projectID: task.project_id,
    sessionID: task.session_id ?? undefined,
    scope: "all",
  })
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
    ["plan_hint", "goal_update", "operator_note", "constraint", "decision"].includes(note.kind),
  )
  const history = notes.filter((note) => ["user_request", "summary"].includes(note.kind))
  const allDeliveries = Database.use((db) =>
    db
      .select()
      .from(OrchestratorDeliveryTable)
      .where(eq(OrchestratorDeliveryTable.task_id, task.id))
      .orderBy(OrchestratorDeliveryTable.time_created)
      .all(),
  )
  const delivery = run ? allDeliveries.filter((item) => item.run_id === run.id).at(-1) : undefined
  const latestDelivery = delivery ?? allDeliveries.at(-1)
  const allEvaluations = Database.use((db) =>
    db
      .select()
      .from(OrchestratorEvaluationTable)
      .where(eq(OrchestratorEvaluationTable.task_id, task.id))
      .orderBy(OrchestratorEvaluationTable.time_created)
      .all(),
  )
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
      .from(OrchestratorChannelBindingTable)
      .where(eq(OrchestratorChannelBindingTable.task_id, task.id))
      .orderBy(OrchestratorChannelBindingTable.time_created)
      .all(),
  )
  const artifacts = run
    ? Database.use((db) =>
        db
          .select()
          .from(OrchestratorArtifactTable)
          .where(eq(OrchestratorArtifactTable.run_id, run.id))
          .orderBy(OrchestratorArtifactTable.time_created)
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
              .from(OrchestratorArtifactTable)
              .where(eq(OrchestratorArtifactTable.delivery_id, latestDelivery.id))
              .orderBy(OrchestratorArtifactTable.time_created)
              .all(),
          )
        : []
  const snapshots = Database.use((db) =>
    db
      .select()
      .from(OrchestratorProgressSnapshotTable)
      .where(eq(OrchestratorProgressSnapshotTable.task_id, task.id))
      .orderBy(desc(OrchestratorProgressSnapshotTable.time_created))
      .limit(BOARD_SNAPSHOT_LIMIT * 4)
      .all()
      .reverse(),
  )
  const compactSnapshots = compactBoardSnapshots(snapshots).slice(-BOARD_SNAPSHOT_LIMIT)
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

  const specRow = task.active_spec_version_id ? findSpecSnapshot(task.active_spec_version_id) : undefined
  const specSnapshot = specRow ? viewSpecSnapshot(specRow) : undefined

  return {
      spec: specSnapshot,
      task: {
        id: task.id,
        projectID: task.project_id,
        sessionID: task.session_id ?? undefined,
        activePlanVersionID: task.active_plan_version_id ?? undefined,
        activeRunID: task.active_run_id ?? undefined,
        requestID: task.request_id ?? undefined,
        source: task.source,
        title: task.title,
        request: task.request,
        status: task.status,
        priority: task.priority,
        blockingReason: task.blocking_reason ?? undefined,
        error: task.error ?? undefined,
        budget: task.budget
          ? {
              maxRuns: task.budget.max_runs,
              maxReplans: task.budget.max_replans,
              maxEvaluations: task.budget.max_evaluations,
              maxWallTimeMs: task.budget.max_wall_time_ms,
            }
          : undefined,
        metadata: task.metadata ?? undefined,
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
      snapshots: compactSnapshots.map((item) => ({
        id: item.id,
        taskID: item.task_id,
        status: item.status,
        summary: item.summary,
        payload: compactSnapshotPayload(item.payload),
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
      lanes: [
        {
          id: "run",
          title: "Run",
          cards: run
            ? [
                {
                  id: run.id,
                  kind: "run" as const,
                  title: `${run.executor} / ${run.phase}`,
                  detail: run.error ?? task.blocking_reason ?? undefined,
                  status: run.status,
                  time: run.time_updated,
                  metadata: run.executor_ref ?? undefined,
                },
              ]
            : [],
        },
        {
          id: "delivery",
          title: "Delivery",
          cards: latestDelivery
            ? [
                {
                  id: latestDelivery.id,
                  kind: "note" as const,
                  title: latestDelivery.status,
                  detail: latestDelivery.summary,
                  status: latestDelivery.status,
                  time: latestDelivery.time_updated,
                  metadata: latestDelivery.result ?? undefined,
                },
              ]
            : [],
        },
        {
          id: "goals",
          title: "Dynamic Goals",
          cards: goals
            .toSorted((a, b) => {
              const score = (value: string) => (value === "pending" ? 0 : value === "failed" ? 1 : 2)
              return score(a.status) - score(b.status)
            })
            .map((goal) => ({
              id: goal.id,
              kind: "goal" as const,
              title: goal.description,
              detail: goal.criteria,
              status: goal.status,
              time: goal.time_updated,
              metadata: {
                ...(goal.metadata as Record<string, unknown> | null ?? {}),
                sessionID: goalRunSessionMap.get(goal.id) ?? undefined,
              },
            })),
        },
        {
          id: "staging",
          title: "Staging",
          cards: staging.slice(-8).map((note) => ({
            id: note.id,
            kind: note.kind === "plan_hint" ? ("plan_hint" as const) : ("note" as const),
            title: note.kind,
            detail: note.content,
            status: note.source,
            time: note.time_created,
            metadata: note.metadata ?? undefined,
          })),
        },
        {
          id: "blockers",
          title: "Blockers",
          cards: interactions
            .filter((item) => item.status === "pending")
            .map((item) => ({
              id: item.id,
              kind: "interaction" as const,
              title: item.title,
              detail: item.body,
              status: item.status,
              time: item.time_updated,
              metadata: {
                type: item.request_type,
              },
            })),
        },
        {
          id: "preferences",
          title: "Preferences",
          cards: prefs.map((pref) => ({
            id: pref.id,
            kind: "preference" as const,
            title: pref.key,
            detail: pref.value,
            status: pref.scope,
            time: pref.timeUpdated,
          })),
        },
        {
          id: "notes",
          title: "History",
          cards: history.slice(-8).map((note) => ({
            id: note.id,
            kind: note.kind === "plan_hint" ? ("plan_hint" as const) : ("note" as const),
            title: note.kind,
            detail: note.content,
            status: note.source,
            time: note.time_created,
          })),
        },
      ],
  }
}

function boardTagForTask(task: typeof OrchestratorTaskTable.$inferSelect) {
  const run = task.active_run_id
    ? Database.use((db) => db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.id, task.active_run_id!)).get())
    : undefined
  const plan = task.active_plan_version_id
    ? Database.use((db) => db.select().from(OrchestratorPlanVersionTable).where(eq(OrchestratorPlanVersionTable.id, task.active_plan_version_id!)).get())
    : undefined
  const goals = plan
    ? Database.use((db) =>
        db
          .select({
            count: sql<number>`count(*)`,
            updated: sql<number>`coalesce(max(${OrchestratorGoalTable.time_updated}), 0)`,
          })
          .from(OrchestratorGoalTable)
          .where(eq(OrchestratorGoalTable.plan_version_id, plan.id))
          .get(),
      )
    : undefined
  const interactions = Database.use((db) =>
    db
      .select({
        count: sql<number>`count(*)`,
        updated: sql<number>`coalesce(max(${OrchestratorInteractionRequestTable.time_updated}), 0)`,
      })
      .from(OrchestratorInteractionRequestTable)
      .where(eq(OrchestratorInteractionRequestTable.task_id, task.id))
      .get(),
  )
  const deliveries = Database.use((db) =>
    db
      .select({
        count: sql<number>`count(*)`,
        updated: sql<number>`coalesce(max(${OrchestratorDeliveryTable.time_updated}), 0)`,
      })
      .from(OrchestratorDeliveryTable)
      .where(eq(OrchestratorDeliveryTable.task_id, task.id))
      .get(),
  )
  const evaluations = Database.use((db) =>
    db
      .select({
        count: sql<number>`count(*)`,
        updated: sql<number>`coalesce(max(${OrchestratorEvaluationTable.time_updated}), 0)`,
      })
      .from(OrchestratorEvaluationTable)
      .where(eq(OrchestratorEvaluationTable.task_id, task.id))
      .get(),
  )
  const artifacts = Database.use((db) =>
    db
      .select({
        count: sql<number>`count(*)`,
        updated: sql<number>`coalesce(max(${OrchestratorArtifactTable.time_updated}), 0)`,
      })
      .from(OrchestratorArtifactTable)
      .where(eq(OrchestratorArtifactTable.task_id, task.id))
      .get(),
  )
  const bindings = Database.use((db) =>
    db
      .select({
        count: sql<number>`count(*)`,
        updated: sql<number>`coalesce(max(${OrchestratorChannelBindingTable.time_updated}), 0)`,
      })
      .from(OrchestratorChannelBindingTable)
      .where(eq(OrchestratorChannelBindingTable.task_id, task.id))
      .get(),
  )
  const snapshots = Database.use((db) =>
    db
      .select({
        count: sql<number>`count(*)`,
        updated: sql<number>`coalesce(max(${OrchestratorProgressSnapshotTable.time_updated}), 0)`,
      })
      .from(OrchestratorProgressSnapshotTable)
      .where(eq(OrchestratorProgressSnapshotTable.task_id, task.id))
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
  const prefs = Preference.list({
    projectID: task.project_id,
    sessionID: task.session_id ?? undefined,
    scope: "all",
  })
  const prefUpdated = prefs.reduce((max, item) => Math.max(max, item.timeUpdated), 0)
  return [
    task.id,
    task.time_created,
    task.time_updated,
    run?.id ?? "",
    run?.time_updated ?? 0,
    plan?.id ?? "",
    plan?.time_updated ?? 0,
    goals?.count ?? 0,
    goals?.updated ?? 0,
    prefs.length,
    prefUpdated,
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

function compactBoardSnapshots(
  input: Array<{
    id: string
    task_id: string
    status: string
    summary: string
    payload: unknown
    time_created: number
    time_updated: number
  }>,
) {
  return input.reduce<typeof input>((acc, item) => {
    const prev = acc.at(-1)
    if (prev && prev.status === item.status && prev.summary === item.summary) {
      acc[acc.length - 1] = item
      return acc
    }
    acc.push(item)
    return acc
  }, [])
}

function compactSnapshotPayload(input: unknown) {
  if (!input || typeof input !== "object") return undefined
  const item = input as Record<string, unknown>
  return {
    kind: typeof item.kind === "string" ? item.kind : undefined,
    stage: typeof item.stage === "string" ? item.stage : undefined,
    mode: typeof item.mode === "string" ? item.mode : undefined,
    branch: typeof item.branch === "string" ? item.branch : undefined,
    commit: typeof item.commit === "string" ? item.commit : undefined,
    message: typeof item.message === "string" ? clipBoard(item.message) : undefined,
    snapshot: typeof item.snapshot === "string" ? item.snapshot : undefined,
    note: typeof item.note === "string" ? clipBoard(item.note) : undefined,
    description: typeof item.description === "string" ? clipBoard(item.description) : undefined,
    status: typeof item.status === "string" ? item.status : undefined,
    blockingReason: typeof item.blockingReason === "string" ? clipBoard(item.blockingReason) : undefined,
    error: typeof item.error === "string" ? clipBoard(item.error) : undefined,
    activeRunID: typeof item.activeRunID === "string" ? item.activeRunID : undefined,
    conflicts: typeof item.conflicts === "number" ? item.conflicts : undefined,
    dirty: typeof item.dirty === "boolean" ? item.dirty : undefined,
    deliveryID: typeof item.deliveryID === "string" ? item.deliveryID : undefined,
  }
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
  row:
    | (typeof OrchestratorDeliveryTable.$inferSelect)
    | undefined,
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
      diffs: [],
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
  row:
    | (typeof OrchestratorEvaluationTable.$inferSelect)
    | undefined,
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
  task: typeof OrchestratorTaskTable.$inferSelect
  run: (typeof OrchestratorRunTable.$inferSelect) | undefined
  interactions: Array<typeof OrchestratorInteractionRequestTable.$inferSelect>
  evaluation: (typeof OrchestratorEvaluationTable.$inferSelect) | undefined
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
  const blocking = input.task.blocking_reason ?? input.run?.blocking_reason
  if (!blocking) return undefined
  return {
    source: input.run?.blocking_reason ? ("run" as const) : ("task" as const),
    title: "Task is blocked",
    summary: clipBoard(blocking),
    checks: undefined,
  }
}

function boardOverview(input: {
  task: typeof OrchestratorTaskTable.$inferSelect
  run: (typeof OrchestratorRunTable.$inferSelect) | undefined
  pendingInteractions: Array<typeof OrchestratorInteractionRequestTable.$inferSelect>
  candidateDelivery: (typeof OrchestratorDeliveryTable.$inferSelect) | undefined
  acceptedDelivery: (typeof OrchestratorDeliveryTable.$inferSelect) | undefined
  evaluation: (typeof OrchestratorEvaluationTable.$inferSelect) | undefined
  currentFailure:
    | {
        source: "task" | "run" | "interaction" | "evaluation"
        title: string
        summary: string
        checks?: Array<z.infer<typeof EvaluationCheck>>
      }
    | undefined
}) {
  const active = ["queued", "planning", "running", "evaluating", "delivering"].includes(input.task.status)
  const canResume = Boolean(input.run) && !active && input.pendingInteractions.length === 0
  const headline =
    input.pendingInteractions.length > 0
      ? "Waiting on human input"
      : input.task.status === "completed"
        ? "Accepted delivery is ready"
        : input.task.status === "delivering"
          ? "Publishing the accepted delivery"
        : input.task.status === "failed"
          ? "Current attempt failed acceptance"
          : input.task.status === "cancelled"
            ? "Task was cancelled"
            : input.task.status === "blocked"
              ? "Task is blocked"
              : input.task.status === "evaluating"
                ? "Evaluating the latest candidate delivery"
                : input.task.status === "running"
                  ? "Task is actively progressing"
                  : "Task is queued"
  const summary =
    input.pendingInteractions.length > 0
      ? `${input.pendingInteractions.length} interaction${input.pendingInteractions.length > 1 ? "s" : ""} need attention before the task can continue.`
      : input.task.status === "completed" && input.acceptedDelivery
        ? clipBoard(input.acceptedDelivery.summary)
        : input.task.status === "delivering" && input.candidateDelivery
          ? clipBoard(input.candidateDelivery.summary)
        : input.currentFailure?.summary ??
          (input.task.status === "evaluating"
            ? "Execution finished. Acceptance checks are running against the latest delivery."
            : input.candidateDelivery
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
              : input.task.status === "delivering"
                ? {
                    kind: "observe" as const,
                    title: "Wait for delivery exports",
                    detail: "Delivery artifacts are being published and summarized.",
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
      canReplan: canResume && Boolean(input.task.active_plan_version_id ?? input.run?.plan_version_id),
      canCancel: Boolean(input.run) && ["queued", "planning", "running", "evaluating", "blocked"].includes(input.task.status),
    },
  }
}
