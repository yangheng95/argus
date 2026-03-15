import z from "zod"
import { Preference } from "@/preference"
import { normalizeTaskChecks } from "@/orchestrator/checks"
import {
  findSpecItems,
  findSpecSnapshot,
  listGoalsBySpec,
  listGoalRunsByTask,
  listMilestonesByPlan,
  listPlanNodesByPlan,
  viewGoal,
  viewGoalRun,
  viewMilestone,
  viewPlanNode,
  viewSpecItem,
  viewSpecSnapshot,
} from "@/orchestrator/store"
import {
  OrchestratorArtifactTable,
  OrchestratorChannelBindingTable,
  OrchestratorDeliveryTable,
  OrchestratorEvaluationTable,
  OrchestratorGoalTable,
  OrchestratorGoalRunTable,
  OrchestratorInteractionRequestTable,
  OrchestratorMilestoneTable,
  OrchestratorPlanNodeTable,
  OrchestratorPlanVersionTable,
  OrchestratorProgressSnapshotTable,
  OrchestratorRunTable,
  OrchestratorSpecItemTable,
  OrchestratorSpecSnapshotTable,
  OrchestratorTaskTable,
} from "@/orchestrator/orchestrator.sql"
import { EvaluationCheck } from "@/orchestrator/model"
import { Database, desc, eq, sql } from "@/storage/db"
import { WorkbenchTaskNoteTable } from "./workbench.sql"
import { compileBrief } from "./brief"

const BOARD_SNAPSHOT_LIMIT = 80
const BOARD_CHANGED_FILE_LIMIT = 80
const BOARD_SUMMARY_LIMIT = 4000

const BOARD_CACHE_MAX_SIZE = 50
const boardCache = new Map<string, { tag: string; board: ReturnType<typeof buildBoard> }>()

function requireTask(taskID: string) {
  const task = Database.use((db) => db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get())
  if (!task) throw new Error(`Task not found: ${taskID}`)
  return task
}

export function compileBoard(input: { taskID: string }) {
  const task = requireTask(input.taskID)
  const tag = boardTagForTask(task)
  const cached = boardCache.get(task.id)
  if (cached?.tag === tag) return cached.board
  const board = buildBoard(task)
  // Evict oldest entries when cache exceeds limit
  if (boardCache.size >= BOARD_CACHE_MAX_SIZE) {
    const firstKey = boardCache.keys().next().value
    if (firstKey) boardCache.delete(firstKey)
  }
  boardCache.set(task.id, { tag, board })
  return board
}

export function boardTag(input: { taskID: string }) {
  const task = requireTask(input.taskID)
  return boardTagForTask(task)
}

function buildBoard(task: typeof OrchestratorTaskTable.$inferSelect) {
  const run = task.active_run_id
    ? Database.use((db) => db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.id, task.active_run_id!)).get())
    : undefined
  const plan = task.active_plan_version_id
    ? Database.use((db) => db.select().from(OrchestratorPlanVersionTable).where(eq(OrchestratorPlanVersionTable.id, task.active_plan_version_id!)).get())
    : undefined
  const specID = task.active_spec_version_id ?? plan?.spec_snapshot_id ?? undefined
  const specRow = specID ? findSpecSnapshot(specID) : undefined
  const specSnapshot = specRow ? viewSpecSnapshot(specRow) : undefined
  const goals = specID ? listGoalsBySpec(specID).map(viewGoal) : []
  const specItems = specID ? findSpecItems(specID).map(viewSpecItem).toSorted(specItemOrder) : []
  const planNodes = plan ? listPlanNodesByPlan(plan.id).map(viewPlanNode) : []
  const milestones = plan ? listMilestonesByPlan(plan.id).map(viewMilestone) : []
  const goalRuns = listGoalRunsByTask(task.id).map(viewGoalRun)
  const goalRunMap = latestGoalRuns(goalRuns)
  const interactions = Database.use((db) =>
    db
      .select()
      .from(OrchestratorInteractionRequestTable)
      .where(eq(OrchestratorInteractionRequestTable.task_id, task.id))
      .orderBy(OrchestratorInteractionRequestTable.time_created)
      .all(),
  )
  const brief = compileBrief({
    taskID: task.id,
    runID: run?.id ?? undefined,
    planVersionID: plan?.id ?? undefined,
    sessionID: task.session_id ?? undefined,
  })
  const checks = normalizeTaskChecks(task.metadata?.checks)
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
  const runArtifacts = run
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
    runArtifacts.length > 0
      ? runArtifacts
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
  const artifacts = latestArtifacts
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
    }))
  const candidateDelivery = viewBoardDelivery(latestDelivery)
  const acceptedBoardDelivery = viewBoardDelivery(acceptedDelivery)
  const boardEvaluation = viewBoardEvaluation(latestEvaluation)

  return {
    task: {
      id: task.id,
      projectID: task.project_id,
      sessionID: task.session_id ?? undefined,
      activeSpecVersionID: task.active_spec_version_id ?? undefined,
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
    spec: specSnapshot,
    checks,
    goals,
    specItems,
    plan: plan
      ? {
          id: plan.id,
          taskID: plan.task_id,
          specSnapshotID: plan.spec_snapshot_id,
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
    planNodes,
    goalRuns,
    milestones,
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
    delivery: candidateDelivery,
    candidateDelivery,
    acceptedDelivery: acceptedBoardDelivery,
    evaluation: boardEvaluation,
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
    artifacts,
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
        id: "spec",
        title: "Spec",
        cards: specCards(specSnapshot, goals, specItems),
      },
      {
        id: "plan",
        title: "Plan",
        cards: planCards(plan, planNodes, milestones, goals, goalRunMap, specID),
      },
      {
        id: "goals",
        title: "Goals",
        cards: goalCards(goals, goalRunMap),
      },
      {
        id: "acceptance",
        title: "Acceptance",
        cards: acceptanceCards(checks, specItems, pendingInteractions),
      },
      {
        id: "evaluation",
        title: "Evaluation",
        cards: evaluationCards(boardEvaluation),
      },
      {
        id: "delivery",
        title: "Delivery",
        cards: deliveryCards(candidateDelivery, acceptedBoardDelivery, artifacts),
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
  const specID = task.active_spec_version_id ?? plan?.spec_snapshot_id ?? undefined
  const spec = specID
    ? Database.use((db) =>
        db
          .select({
            updated: sql<number>`coalesce(max(${OrchestratorSpecSnapshotTable.time_updated}), 0)`,
          })
          .from(OrchestratorSpecSnapshotTable)
          .where(eq(OrchestratorSpecSnapshotTable.id, specID))
          .get(),
      )
    : undefined
  const goals = specID
    ? Database.use((db) =>
        db
          .select({
            count: sql<number>`count(*)`,
            updated: sql<number>`coalesce(max(${OrchestratorGoalTable.time_updated}), 0)`,
          })
          .from(OrchestratorGoalTable)
          .where(eq(OrchestratorGoalTable.spec_snapshot_id, specID))
          .get(),
      )
    : undefined
  const specItems = specID
    ? Database.use((db) =>
        db
          .select({
            count: sql<number>`count(*)`,
            updated: sql<number>`coalesce(max(${OrchestratorSpecItemTable.time_updated}), 0)`,
          })
          .from(OrchestratorSpecItemTable)
          .where(eq(OrchestratorSpecItemTable.spec_snapshot_id, specID))
          .get(),
      )
    : undefined
  const planNodes = plan
    ? Database.use((db) =>
        db
          .select({
            count: sql<number>`count(*)`,
            updated: sql<number>`coalesce(max(${OrchestratorPlanNodeTable.time_updated}), 0)`,
          })
          .from(OrchestratorPlanNodeTable)
          .where(eq(OrchestratorPlanNodeTable.plan_version_id, plan.id))
          .get(),
      )
    : undefined
  const milestones = plan
    ? Database.use((db) =>
        db
          .select({
            count: sql<number>`count(*)`,
            updated: sql<number>`coalesce(max(${OrchestratorMilestoneTable.time_updated}), 0)`,
          })
          .from(OrchestratorMilestoneTable)
          .where(eq(OrchestratorMilestoneTable.plan_version_id, plan.id))
          .get(),
      )
    : undefined
  const goalRuns = Database.use((db) =>
    db
      .select({
        count: sql<number>`count(*)`,
        updated: sql<number>`coalesce(max(${OrchestratorGoalRunTable.time_updated}), 0)`,
      })
      .from(OrchestratorGoalRunTable)
      .where(eq(OrchestratorGoalRunTable.task_id, task.id))
      .get(),
  )
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
    specID ?? "",
    spec?.updated ?? 0,
    plan?.id ?? "",
    plan?.time_updated ?? 0,
    goals?.count ?? 0,
    goals?.updated ?? 0,
    specItems?.count ?? 0,
    specItems?.updated ?? 0,
    planNodes?.count ?? 0,
    planNodes?.updated ?? 0,
    milestones?.count ?? 0,
    milestones?.updated ?? 0,
    goalRuns?.count ?? 0,
    goalRuns?.updated ?? 0,
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

function specItemOrder(a: ReturnType<typeof viewSpecItem>, b: ReturnType<typeof viewSpecItem>) {
  const priority = (value: string) => (value === "blocking" ? 0 : 1)
  const status = (value: string) => (value === "failed" ? 0 : value === "pending" ? 1 : 2)
  return priority(a.priority) - priority(b.priority) || status(a.status) - status(b.status) || a.title.localeCompare(b.title)
}

function latestGoalRuns(input: Array<ReturnType<typeof viewGoalRun>>) {
  return input.reduce((acc, item) => {
    if (!acc.has(item.goalID)) acc.set(item.goalID, item)
    return acc
  }, new Map<string, ReturnType<typeof viewGoalRun>>())
}

function specCards(
  spec: ReturnType<typeof viewSpecSnapshot> | undefined,
  goals: Array<ReturnType<typeof viewGoal>>,
  specItems: Array<ReturnType<typeof viewSpecItem>>,
) {
  if (!spec) return []
  return [{
    id: spec.id,
    kind: "spec" as const,
    title: spec.summary,
    detail: [
      spec.scope ? `Scope: ${clipBoard(spec.scope)}` : undefined,
      spec.outOfScope ? `Out of scope: ${clipBoard(spec.outOfScope)}` : undefined,
      `${goals.length} goals, ${specItems.length} spec items`,
    ].filter(Boolean).join("\n"),
    status: spec.status,
    time: spec.time.updated,
    metadata: {
      version: spec.version,
      evidence: spec.evidence,
    },
  }]
}

function planCards(
  plan: typeof OrchestratorPlanVersionTable.$inferSelect | undefined,
  nodes: Array<ReturnType<typeof viewPlanNode>>,
  milestones: Array<ReturnType<typeof viewMilestone>>,
  goals: Array<ReturnType<typeof viewGoal>>,
  goalRuns: Map<string, ReturnType<typeof viewGoalRun>>,
  activeSpecID: string | undefined,
) {
  if (!plan) return []
  const stale = activeSpecID && plan.spec_snapshot_id !== activeSpecID
  return [
    {
      id: plan.id,
      kind: "plan" as const,
      title: `Plan v${plan.version}`,
      detail: plan.summary,
      status: plan.status,
      time: plan.time_updated,
      metadata: {
        spec_snapshot_id: plan.spec_snapshot_id,
        stale: activeSpecID ? plan.spec_snapshot_id !== activeSpecID : false,
      },
    },
    ...(stale
      ? [{
          id: `${plan.id}:spec`,
          kind: "note" as const,
          title: "Plan is behind the active spec",
          detail: `Plan uses ${plan.spec_snapshot_id}, active spec is ${activeSpecID}. Replan is required before acceptance.`,
          status: "stale",
          time: plan.time_updated,
        }]
      : []),
    ...milestones.map((item) => ({
      id: item.id,
      kind: "milestone" as const,
      title: item.title,
      detail: item.description,
      status: item.status,
      time: item.time.updated,
      metadata: item.metadata,
    })),
    nodes.map((item) => ({
      id: item.id,
      kind: item.kind === "milestone" ? ("milestone" as const) : ("plan" as const),
      title: item.title,
      detail: item.brief,
      status: planNodeStatus(item, goals, goalRuns),
      time: item.time.updated,
      metadata: {
        kind: item.kind,
        goal_id: item.goalID,
        depends_on_ids: item.dependsOnIDs,
        ...item.metadata,
      },
    })),
  ]
}

function planNodeStatus(
  node: ReturnType<typeof viewPlanNode>,
  goals: Array<ReturnType<typeof viewGoal>>,
  goalRuns: Map<string, ReturnType<typeof viewGoalRun>>,
) {
  if (!node.goalID) return undefined
  const goalRun = goalRuns.get(node.goalID)
  if (goalRun && ["queued", "accepted", "running", "blocked"].includes(goalRun.status)) return goalRun.status
  return goals.find((item) => item.id === node.goalID)?.status
}

function goalCards(goals: Array<ReturnType<typeof viewGoal>>, goalRuns: Map<string, ReturnType<typeof viewGoalRun>>) {
  const score = (value: string) => (value === "failed" ? 0 : value === "pending" ? 1 : value === "running" ? 2 : 3)
  return goals
    .map((item) => {
      const goalRun = goalRuns.get(item.id)
      return {
        id: item.id,
        kind: "goal" as const,
        title: item.description,
        detail: [
          item.criteria,
          goalRun ? `Latest run: ${goalRun.status} via ${goalRun.executor}` : undefined,
        ].filter(Boolean).join("\n"),
        status: goalRun && ["queued", "accepted", "running", "blocked"].includes(goalRun.status) ? goalRun.status : item.status,
        time: Math.max(item.time.updated, goalRun?.time.updated ?? 0) || undefined,
        metadata: {
          priority: item.priority,
          source: item.source,
          goal_status: item.status,
          goal_run: goalRun,
          ...item.metadata,
        },
      }
    })
    .toSorted((a, b) => score(a.status ?? "") - score(b.status ?? ""))
}

function acceptanceCards(
  checks: Record<string, unknown>,
  specItems: Array<ReturnType<typeof viewSpecItem>>,
  interactions: Array<typeof OrchestratorInteractionRequestTable.$inferSelect>,
) {
  return [
    ...blockerCards(interactions),
    ...checkCards(checks),
    ...specItems.map((item) => ({
      id: item.id,
      kind: "spec_item" as const,
      title: item.title,
      detail: [
        item.description,
        item.checkSelector && item.checkSelector.length > 0 ? `Checks: ${item.checkSelector.join(", ")}` : undefined,
      ].filter(Boolean).join("\n"),
      status: item.status,
      time: item.time.updated,
      metadata: {
        priority: item.priority,
        evidence: item.evidence,
        ...item.metadata,
      },
    })),
  ]
}

function blockerCards(input: Array<typeof OrchestratorInteractionRequestTable.$inferSelect>) {
  return input.map((item) => ({
    id: item.id,
    kind: "interaction" as const,
    title: item.title,
    detail: item.body,
    status: item.status,
    time: item.time_updated,
    metadata: {
      type: item.request_type,
    },
  }))
}

function checkCards(input: Record<string, unknown>) {
  const out = ["spec_check", "build", "test", "lint", "verify_cmd", "startup", "artifact", "visual", "puppeteer", "ui_review", "code_quality", "code_review", "dead_code_review"]
    .flatMap((key) => {
      const value = input[key]
      if (!checkEnabled(value)) return []
      return [{
        id: `check:${key}`,
        kind: "check" as const,
        title: checkLabel(key),
        detail: checkDetail(key, value),
        status: key === "spec_check" ? "required" : "enabled",
        metadata: checkMetadata(value),
      }]
    })
  const named = input.named && typeof input.named === "object" && !Array.isArray(input.named)
    ? Object.entries(input.named).flatMap(([key, value]) => {
        if (!checkEnabled(value)) return []
        const item = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
        return [{
          id: `check:named:${key}`,
          kind: "check" as const,
          title: typeof item.label === "string" && item.label ? item.label : key,
          detail: checkDetail(key, value),
          status: "enabled",
          metadata: checkMetadata(value),
        }]
      })
    : []
  return out.concat(named)
}

function checkEnabled(input: unknown) {
  if (input === false || input == null) return false
  if (typeof input !== "object" || Array.isArray(input)) return true
  const item = input as Record<string, unknown>
  if (item.enabled === false) return false
  return true
}

function checkLabel(input: string) {
  return input
    .split("_")
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join(" ")
}

function checkDetail(name: string, input: unknown) {
  if (Array.isArray(input)) return clipBoard(input.join("\n"))
  if (!input || typeof input !== "object") {
    if (name === "spec_check") return "Required and strict for final acceptance."
    return undefined
  }
  const item = input as Record<string, unknown>
  const out = [
    typeof item.mode === "string" ? `Mode: ${item.mode}` : undefined,
    typeof item.target === "string" ? `Target: ${item.target}` : undefined,
    typeof item.url === "string" ? `URL: ${item.url}` : undefined,
    typeof item.command === "string" ? `Command: ${item.command}` : undefined,
    Array.isArray(item.commands) ? clipBoard(item.commands.join("\n")) : undefined,
    Array.isArray(item.focus) && item.focus.length > 0 ? `Focus: ${item.focus.join(", ")}` : undefined,
  ].filter(Boolean)
  if (out.length > 0) return out.join("\n")
  if (name === "spec_check") return "Required and strict for final acceptance."
  return undefined
}

function checkMetadata(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined
  return input as Record<string, unknown>
}

function evaluationCards(evaluation: ReturnType<typeof viewBoardEvaluation>) {
  if (!evaluation) return []
  return [
    {
      id: evaluation.id,
      kind: "evaluation" as const,
      title: `${evaluation.verdict} / ${evaluation.status}`,
      detail: evaluation.summary,
      status: evaluation.verdict,
      time: evaluation.time.updated,
      metadata: {
        delivery_id: evaluation.deliveryID,
      },
    },
    ...evaluation.checks.map((item) => ({
      id: `${evaluation.id}:${item.name}`,
      kind: "check" as const,
      title: item.label ?? checkLabel(item.name),
      detail: item.evidence,
      status: item.status,
      time: evaluation.time.completed ?? evaluation.time.updated,
      metadata: {
        family: item.family,
        name: item.name,
      },
    })),
  ]
}

function deliveryCards(
  candidate: ReturnType<typeof viewBoardDelivery>,
  accepted: ReturnType<typeof viewBoardDelivery>,
  artifacts: Array<{
    id: string
    kind: string
    label: string
    payload: Record<string, unknown> | undefined
    time: {
      created: number
      updated: number
    }
  }>,
) {
  return [
    ...(accepted
      ? [{
          id: accepted.id,
          kind: "delivery" as const,
          title: "Accepted delivery",
          detail: accepted.summary,
          status: accepted.status,
          time: accepted.time.updated,
          metadata: accepted.result,
        }]
      : []),
    ...(candidate && (!accepted || candidate.id !== accepted.id)
      ? [{
          id: candidate.id,
          kind: "delivery" as const,
          title: "Latest candidate",
          detail: candidate.summary,
          status: candidate.status,
          time: candidate.time.updated,
          metadata: candidate.result,
        }]
      : []),
    ...artifacts.slice(0, 8).map((item) => ({
      id: item.id,
      kind: "note" as const,
      title: item.label,
      detail: artifactDetail(item.payload),
      status: item.kind,
      time: item.time.updated,
      metadata: item.payload,
    })),
  ]
}

function artifactDetail(input: Record<string, unknown> | undefined) {
  if (!input) return undefined
  const out = [
    typeof input.summary === "string" ? input.summary : undefined,
    typeof input.file === "string" ? input.file : undefined,
    typeof input.output === "string" ? input.output : undefined,
  ].filter(Boolean)
  if (out.length === 0) return undefined
  return clipBoard(out.join("\n"))
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
        : input.task.status === "planning"
          ? "Compiling the specification and plan"
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
        : input.task.status === "planning"
          ? "The task is materialized. OpenCorvus is refining the spec, goals, and execution plan before dispatch."
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
              : input.task.status === "planning"
                ? {
                    kind: "observe" as const,
                    title: "Watch spec and plan compilation",
                    detail: "The task is visible now. Execution will begin after the spec and plan are finalized.",
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
