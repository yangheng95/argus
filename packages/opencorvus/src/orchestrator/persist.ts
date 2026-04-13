import { selectorList, selectorsSatisfied } from "@/check/policy"
import { Identifier } from "@/id/id"
import { executorLeaseAvailable, executorLeaseHeldByOther, executorLeaseOwner, executorLeaseUntil } from "./lease"
import { type GoalJudgmentType, type EvaluationOutput } from "@/evaluator/types"

/** Input shape for persisting a requirement extracted by the Requirements agent into
 *  orchestrator_requirement. Mirrors the table columns plus an optional
 *  check_selector stored inside metadata. */
export interface Requirement {
  id: string
  title: string
  description: string
  acceptance: string[]
  evidence_refs: string[]
  non_goals?: string[]
  priority?: "blocking" | "advisory"
  check_selector?: string[]
  metadata?: Record<string, unknown>
}
import { protocolInfo, type ProtocolCapabilitiesInfo, type ProtocolRefsInfo, type ProtocolSettingsInfo, ProtocolTransport } from "@/executor/protocol"
import { writeEvaluationSnapshot, writeGoalSnapshot } from "@/orchestrator/docs"
import { Database, and, desc, eq, inArray, isNull, lte, or } from "@/storage/db"
import { Log } from "@/util/log"
import { Event } from "./model"
import {
  OrchestratorArtifactTable,
  OrchestratorDeliveryTable,
  OrchestratorEvaluationTable,
  OrchestratorExecutorSessionTable,
  OrchestratorGoalTable,
  OrchestratorGoalRunTable,
  OrchestratorMilestoneTable,
  OrchestratorRequirementTable,
  OrchestratorRunTable,
  OrchestratorSpecSnapshotTable,
  OrchestratorTaskTable,
  type OrchestratorMilestoneStatus,
  type OrchestratorDeliveryStatus,
  type OrchestratorArtifactKind,
} from "./orchestrator.sql"
import { OrchestratorProtocol } from "./protocol"
import { findPlan, findRequirements, listGoalsForPlan, listMilestonesByPlan, type GoalRow, type RunRow, type TaskRow } from "./store"

const log = Log.create({ service: "orchestrator-transition" })

export interface GoalRowInput {
  goalID?: string
  title: string
  objective: string
  done_definition: string
  owned_paths?: string[]
  depends_on?: string[]
  exports?: string[]
  imports?: string[]
  kind?: string
  requirement_ids?: string[]
  priority?: "blocking" | "advisory"
  source?: "spec" | "system"
  metadata?: Record<string, unknown>
}

export function insertGoalRows(
  db: Database.TxOrDb,
  input: {
    taskID: string
    specSnapshotID: string
    planVersionID?: string
    goals: GoalRowInput[]
    now: number
  },
) {
  return input.goals.map((goal, index) => {
    const goalID = goal.goalID ?? Identifier.ascending("goal")
    const deps = goal.depends_on ?? []
    const metadata =
      goal.metadata && typeof goal.metadata === "object" && !Array.isArray(goal.metadata)
        ? goal.metadata
        : undefined
    db.insert(OrchestratorGoalTable)
      .values({
        id: goalID,
        task_id: input.taskID,
        plan_version_id: input.planVersionID ?? null,
        spec_snapshot_id: input.specSnapshotID,
        title: goal.title,
        objective: goal.objective,
        done_definition: goal.done_definition,
        owned_paths: goal.owned_paths ?? [],
        depends_on: deps,
        exports: goal.exports ?? [],
        imports: goal.imports ?? [],
        kind: goal.kind ?? "feature",
        requirement_ids: goal.requirement_ids ?? [],
        metadata: {
          ...metadata,
          depends_on_goal_ids: deps.length > 0 ? deps : undefined,
        },
        priority: goal.priority ?? "blocking",
        source: goal.source ?? "spec",
        status: "pending",
        order_index: index,
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    return {
      id: goalID,
      title: goal.title,
      objective: goal.objective,
      done_definition: goal.done_definition,
      priority: goal.priority,
      metadata,
    }
  })
}

export function insertRequirements(
  db: Database.TxOrDb,
  input: {
    taskID: string
    specSnapshotID: string
    requirements: Requirement[]
    now: number
  },
) {
  return input.requirements.map((requirement, index) => {
    const requestedID = typeof requirement.id === "string" ? requirement.id.trim() : ""
    const requirementID = Identifier.ascending("requirement")
    db.insert(OrchestratorRequirementTable)
      .values({
        id: requirementID,
        task_id: input.taskID,
        spec_snapshot_id: input.specSnapshotID,
        title: requirement.title,
        description: requirement.description,
        status: "pending",
        priority: requirement.priority === "advisory" ? "advisory" : "blocking",
        acceptance: Array.isArray(requirement.acceptance) ? JSON.stringify(requirement.acceptance) : requirement.acceptance,
        evidence_refs: requirement.evidence_refs.length > 0 ? requirement.evidence_refs : null,
        non_goals: requirement.non_goals && requirement.non_goals.length > 0 ? requirement.non_goals : null,
        metadata: {
          ...(requirement.metadata ?? {}),
          ...(requestedID ? { source_requirement_id: requestedID } : {}),
        },
        order_index: index,
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    return {
      id: requirementID,
      sourceRequirementID: requestedID || requirementID,
      title: requirement.title,
      priority: requirement.priority === "advisory" ? "advisory" as const : "blocking" as const,
    }
  })
}

export function createGoalRun(input: {
  taskID: string
  goalID: string
  planNodeID?: string
  coordinatorRunID: string
  sessionID?: string
  executor: RunRow["executor"]
  retryCount?: number
  blockingReason?: string | null
  error?: string | null
  workspaceDir?: string
  baseRef?: string
  mergeRef?: string
  metadata?: Record<string, unknown>
  now?: number
}) {
  const existing = Database.use((db) =>
    db
      .select()
      .from(OrchestratorGoalRunTable)
      .where(and(
        eq(OrchestratorGoalRunTable.coordinator_run_id, input.coordinatorRunID),
        eq(OrchestratorGoalRunTable.goal_id, input.goalID),
        input.planNodeID
          ? eq(OrchestratorGoalRunTable.plan_node_id, input.planNodeID)
          : isNull(OrchestratorGoalRunTable.plan_node_id),
        inArray(OrchestratorGoalRunTable.status, ["queued", "accepted", "running", "blocked"]),
      ))
      .orderBy(desc(OrchestratorGoalRunTable.time_created))
      .get(),
  )
  if (existing) return existing
  const id = Identifier.ascending("goal_run")
  const now = input.now ?? Date.now()
  Database.use((db) =>
    db
      .insert(OrchestratorGoalRunTable)
      .values({
        id,
        task_id: input.taskID,
        goal_id: input.goalID,
        plan_node_id: input.planNodeID,
        coordinator_run_id: input.coordinatorRunID,
        session_id: input.sessionID,
        executor: input.executor,
        status: "queued",
        retry_count: input.retryCount ?? 0,
        blocking_reason: input.blockingReason ?? null,
        error: input.error ?? null,
        workspace_dir: input.workspaceDir,
        base_ref: input.baseRef,
        merge_ref: input.mergeRef,
        metadata:
          input.metadata || input.sessionID
            ? {
                ...(input.metadata ?? {}),
                ...(input.sessionID ? { local_session_id: input.sessionID } : {}),
              }
            : undefined,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  const row = Database.use((db) =>
    db
      .select()
      .from(OrchestratorGoalRunTable)
      .where(eq(OrchestratorGoalRunTable.id, id))
      .get(),
  )
  if (!row) throw new Error(`createGoalRun: inserted goal run ${id} not found after insert`)
  return row
}

export function updateGoalRun(
  goalRunID: string,
  values: Partial<typeof OrchestratorGoalRunTable.$inferInsert>,
) {
  Database.use((db) =>
    db
      .update(OrchestratorGoalRunTable)
      .set({
        ...values,
        time_updated: Date.now(),
      })
      .where(eq(OrchestratorGoalRunTable.id, goalRunID))
      .run(),
  )
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorGoalRunTable)
      .where(eq(OrchestratorGoalRunTable.id, goalRunID))
      .get(),
  )
}

type EvaluationStatus = "passed" | "failed" | "pending"
type EvaluationVerdict = "accepted" | "rejected"

export function beginEvaluation(input: {
  task: TaskRow
  run: RunRow
  goalRunID?: string
  deliveryID: string
  evaluationID: string
  now: number
  summary: string
}) {
  const existing = Database.use((db) =>
    db
      .select()
      .from(OrchestratorEvaluationTable)
      .where(eq(OrchestratorEvaluationTable.id, input.evaluationID))
      .get(),
  )
  if (existing) return existing
  Database.use((db) =>
    db
      .insert(OrchestratorEvaluationTable)
      .values({
        id: input.evaluationID,
        task_id: input.task.id,
        run_id: input.run.id,
        goal_run_id: input.goalRunID,
        delivery_id: input.deliveryID,
        status: "pending",
        verdict: "rejected",
        summary: input.summary,
        checks: [],
        time_created: input.now,
        time_updated: input.now,
      })
      .run(),
  )
  const row = Database.use((db) =>
    db
      .select()
      .from(OrchestratorEvaluationTable)
      .where(eq(OrchestratorEvaluationTable.id, input.evaluationID))
      .get(),
  )
  if (!row) throw new Error(`beginEvaluation: evaluation ${input.evaluationID} not found after insert`)
  return row
}

export function persistEvaluation(input: {
  task: TaskRow
  run: RunRow
  goalRunID?: string
  deliveryID: string
  evaluationID: string
  delivery: {
    summary: string
    diffs: Array<{ file: string; [key: string]: unknown }>
  }
  result: EvaluationOutput
  analysis?: GoalJudgmentType
  analysisError?: string
  finalVerdict: string
  finalStatus: string
  finalSummary: string
  goals: GoalRow[]
  finalizeSpec?: boolean
}) {
  const now = Date.now()
  const evaluation = {
    id: input.evaluationID,
    status: input.finalStatus as EvaluationStatus,
    verdict: input.finalVerdict as EvaluationVerdict,
    summary: input.finalSummary,
    checks: input.result.checks.map((item) => ({
      name: item.name,
      status: item.status,
      evidence: item.evidence,
      label: item.label,
      family: item.family,
    })),
  }
  Database.transaction((db) => {
    const existing = db
      .select()
      .from(OrchestratorEvaluationTable)
      .where(eq(OrchestratorEvaluationTable.id, input.evaluationID))
      .get()
    if (existing) {
      db.update(OrchestratorEvaluationTable)
        .set({
          task_id: input.task.id,
          run_id: input.run.id,
          goal_run_id: input.goalRunID,
          delivery_id: input.deliveryID,
          status: input.finalStatus as EvaluationStatus,
          verdict: input.finalVerdict as EvaluationVerdict,
          summary: input.finalSummary,
          checks: input.result.checks,
          time_completed: now,
          time_updated: now,
        })
        .where(eq(OrchestratorEvaluationTable.id, input.evaluationID))
        .run()
    } else {
      db.insert(OrchestratorEvaluationTable)
        .values({
          id: input.evaluationID,
          task_id: input.task.id,
          run_id: input.run.id,
          goal_run_id: input.goalRunID,
          delivery_id: input.deliveryID,
          status: input.finalStatus as EvaluationStatus,
          verdict: input.finalVerdict as EvaluationVerdict,
          summary: input.finalSummary,
          checks: input.result.checks,
          time_completed: now,
          time_created: now,
          time_updated: now,
        })
        .run()
    }
    for (const artifact of input.result.artifacts) {
      db.insert(OrchestratorArtifactTable)
        .values({
          id: Identifier.ascending("artifact"),
          task_id: input.task.id,
          run_id: input.run.id,
          goal_run_id: input.goalRunID,
          delivery_id: input.deliveryID,
          kind: artifact.kind as typeof OrchestratorArtifactTable.$inferInsert.kind,
          label: artifact.label,
          payload: artifact.payload,
          time_created: now,
          time_updated: now,
        })
        .run()
    }
    if (input.analysisError) {
      db.insert(OrchestratorArtifactTable)
        .values({
          id: Identifier.ascending("artifact"),
          task_id: input.task.id,
          run_id: input.run.id,
          goal_run_id: input.goalRunID,
          delivery_id: input.deliveryID,
          kind: "report",
          label: "evaluator-agent-error",
          payload: { error: input.analysisError, analysis_failed: true },
          time_created: now,
          time_updated: now,
        })
        .run()
    }
    if (input.analysis) {
      db.insert(OrchestratorArtifactTable)
        .values({
          id: Identifier.ascending("artifact"),
          task_id: input.task.id,
          run_id: input.run.id,
          goal_run_id: input.goalRunID,
          delivery_id: input.deliveryID,
          kind: "report",
          label: "evaluator-agent-analysis",
          payload: input.analysis as unknown as Record<string, unknown>,
          time_created: now,
          time_updated: now,
        })
        .run()
    }
    if (input.goals.length > 0) {
      const now2 = Date.now()
      const rawAnalysisGoals = Array.isArray(input.analysis?.goal_statuses) ? input.analysis.goal_statuses : []
      // Fix 1-based index: if all indices are 1..N instead of 0..N-1, shift them
      const allOneBased = rawAnalysisGoals.length > 0
        && rawAnalysisGoals.every((gs) => gs.goal_index >= 1 && gs.goal_index <= input.goals.length)
        && rawAnalysisGoals.some((gs) => gs.goal_index === input.goals.length)
        && !rawAnalysisGoals.some((gs) => gs.goal_index === 0)
      const analysisGoals = allOneBased
        ? rawAnalysisGoals.map((gs) => ({ ...gs, goal_index: gs.goal_index - 1 }))
        : rawAnalysisGoals
      const goalStatuses =
        input.goalRunID && input.goals.length === 1 && analysisGoals.length === 0
          ? [{
              goal_index: 0,
              status: input.finalStatus === "passed" ? "passed" as const : "failed" as const,
              evidence: input.finalSummary,
            }]
          : analysisGoals
      const updatedGoalIndices = new Set<number>()
      for (const gs of goalStatuses) {
        const goal =
          input.goalRunID && input.goals.length === 1
            ? input.goals[0]
            : input.goals[gs.goal_index]
        if (!goal) {
          log.warn("goal index out of bounds in analysis", {
            goalIndex: gs.goal_index,
            goalCount: input.goals.length,
            taskID: input.task.id,
          })
          continue
        }
        updatedGoalIndices.add(input.goalRunID && input.goals.length === 1 ? 0 : gs.goal_index)
        let goalStatus =
          input.goalRunID && input.goals.length === 1
            ? input.finalStatus === "passed"
              ? "passed" as const
              : input.finalStatus === "failed"
                ? "failed" as const
                : undefined
            : gs.status === "passed"
              ? "passed" as const
              : gs.status === "failed"
                ? "failed" as const
                : undefined
        if (!goalStatus && input.goalRunID && input.goals.length === 1 && input.finalStatus === "failed") {
          goalStatus = "failed"
        }
        if (goalStatus === "passed" && !(input.goalRunID && input.goals.length === 1)) {
          const selectors = selectorList(goal.metadata)
          if (selectors.length > 0) {
            const allSelectorsPassed = selectorsSatisfied(selectors, input.result.checks)
            if (!allSelectorsPassed) {
              goalStatus = undefined
            }
          }
        }
        if (!goalStatus || goal.status === goalStatus) continue
        db.update(OrchestratorGoalTable)
          .set({ status: goalStatus, time_updated: now2 })
          .where(eq(OrchestratorGoalTable.id, goal.id))
          .run()
        if (goalStatus === "passed") {
          Database.effect(() =>
            OrchestratorProtocol.emit(Event.GoalPassed, { taskID: input.task.id, goalID: goal.id, summary: goal.title }, { source: "persist.evaluation" }),
          )
        } else if (goalStatus === "failed") {
          Database.effect(() =>
            OrchestratorProtocol.emit(Event.GoalFailed, { taskID: input.task.id, goalID: goal.id, summary: `${goal.title}: ${Array.isArray(gs.evidence) ? gs.evidence.join("; ") : gs.evidence}` }, { source: "persist.evaluation" }),
          )
        }
      }
      // When verdict is rejected and LLM missed some goals, mark uncovered pending goals as failed
      if (input.finalVerdict === "rejected" && updatedGoalIndices.size < input.goals.length) {
        for (let i = 0; i < input.goals.length; i++) {
          if (updatedGoalIndices.has(i)) continue
          const uncoveredGoal = input.goals[i]
          if (!uncoveredGoal || uncoveredGoal.status !== "pending") continue
          db.update(OrchestratorGoalTable)
            .set({ status: "failed", time_updated: now2 })
            .where(eq(OrchestratorGoalTable.id, uncoveredGoal.id))
            .run()
        }
      }
      if (input.run.plan_version_id) {
        deriveMilestoneStatuses(db, input.task.id, input.run.plan_version_id, now2)
      }
    }
    if (input.finalizeSpec !== false && input.task.active_spec_version_id) {
      const requirements = findRequirements(input.task.active_spec_version_id)
      const now3 = Date.now()
      const blockingRequirements = requirements.filter((item) => item.priority === "blocking")
      const scopedRequirements = blockingRequirements.length > 0 ? blockingRequirements : requirements
      if (scopedRequirements.length > 0) {
        // Per-requirement status: derive from covering goals' assessment
        const analysisGoals = Array.isArray(input.analysis?.goal_statuses) ? input.analysis.goal_statuses : []
        // Map: requirement DB ID → goal indices that cover it
        const goalIndicesByRequirement = new Map<string, number[]>()
        for (let gi = 0; gi < input.goals.length; gi++) {
          const meta = input.goals[gi]?.metadata
          const reqIDs = meta && typeof meta === "object" && !Array.isArray(meta)
            ? (Array.isArray((meta as Record<string, unknown>).requirement_ids)
              ? ((meta as Record<string, unknown>).requirement_ids as unknown[]).filter((id): id is string => typeof id === "string")
              : [])
            : []
          for (const reqID of reqIDs) {
            const list = goalIndicesByRequirement.get(reqID) ?? []
            list.push(gi)
            goalIndicesByRequirement.set(reqID, list)
          }
        }
        for (const requirement of scopedRequirements) {
          const coveringIndices = goalIndicesByRequirement.get(requirement.id) ?? []
          let requirementStatus: "pending" | "passed" | "failed" | undefined
          if (coveringIndices.length > 0 && analysisGoals.length > 0) {
            // Derive from covering goals' statuses
            const goalStatuses = coveringIndices.map((gi) => {
              const gs = analysisGoals.find((a) => a.goal_index === gi)
              return gs?.status ?? "inconclusive"
            })
            if (goalStatuses.every((s) => s === "passed")) {
              requirementStatus = "passed"
            } else if (goalStatuses.some((s) => s === "failed")) {
              requirementStatus = "failed"
            }
          } else {
            // No goal→requirement mapping: fall back to verdict-level status
            requirementStatus = input.finalVerdict === "accepted" ? "passed" : "failed"
          }
          if (requirementStatus && requirement.status !== requirementStatus) {
            db.update(OrchestratorRequirementTable)
              .set({ status: requirementStatus, time_updated: now3 })
              .where(eq(OrchestratorRequirementTable.id, requirement.id))
              .run()
          }
        }
        if (input.finalVerdict === "accepted") {
          db.update(OrchestratorSpecSnapshotTable)
            .set({ status: "completed", time_updated: now3 })
            .where(eq(OrchestratorSpecSnapshotTable.id, input.task.active_spec_version_id))
            .run()
        }
      }
    }
    Database.effect(() =>
      OrchestratorProtocol.emit(Event.EvaluationCompleted, {
        taskID: input.task.id,
        runID: input.run.id,
        evaluationID: input.evaluationID,
        status: input.finalStatus as EvaluationStatus,
        verdict: input.finalVerdict as EvaluationVerdict,
        summary: input.finalSummary,
      }, { source: "persist.evaluation" }),
    )
  })
  const plan = input.run.plan_version_id ? findPlan(input.run.plan_version_id) : undefined
  writeEvaluationSnapshot({
    task: input.task,
    run: input.run,
    goalRunID: input.goalRunID,
    evaluation,
    goals: input.goals,
    analysis: input.analysis,
    delivery: input.delivery,
    createdAt: now,
  })
  if (plan) {
    writeGoalSnapshot({
      task: input.task,
      plan,
      goals: listGoalsForPlan(plan),
      milestones: listMilestonesByPlan(plan.id),
      createdAt: now,
    })
  }
}

export function persistDelivery(input: {
  task: TaskRow
  run: RunRow
  goalRunID?: string
  deliveryID: string
  delivery: {
    summary: string
    diffs: Array<{ file: string; [key: string]: unknown }>
  }
  now: number
}) {
  const stats = input.delivery.diffs.reduce(
    (acc, d) => {
      const a = typeof (d as any).additions === "number" ? (d as any).additions : 0
      const r = typeof (d as any).deletions === "number" ? (d as any).deletions : 0
      acc.additions += a
      acc.deletions += r
      return acc
    },
    { additions: 0, deletions: 0 },
  )
  Database.transaction((db) => {
    db.insert(OrchestratorDeliveryTable)
      .values({
        id: input.deliveryID,
        task_id: input.task.id,
        run_id: input.run.id,
        goal_run_id: input.goalRunID,
        status: "candidate",
        summary: input.delivery.summary,
        result: {
          summary: input.delivery.summary,
          changed_files: input.delivery.diffs.map((item) => item.file),
          diffs: input.delivery.diffs,
          stats,
        },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    db.insert(OrchestratorArtifactTable)
      .values({
        id: Identifier.ascending("artifact"),
        task_id: input.task.id,
        run_id: input.run.id,
        goal_run_id: input.goalRunID,
        delivery_id: input.deliveryID,
        kind: "report",
        label: "assistant-summary",
        payload: { summary: input.delivery.summary },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    if (input.delivery.diffs.length > 0) {
      db.insert(OrchestratorArtifactTable)
        .values({
          id: Identifier.ascending("artifact"),
          task_id: input.task.id,
          run_id: input.run.id,
          goal_run_id: input.goalRunID,
          delivery_id: input.deliveryID,
          kind: "diff",
          label: "workspace-diff",
          payload: { diffs: input.delivery.diffs },
          time_created: input.now,
          time_updated: input.now,
        })
        .run()
    }
    for (const item of input.delivery.diffs) {
      db.insert(OrchestratorArtifactTable)
        .values({
          id: Identifier.ascending("artifact"),
          task_id: input.task.id,
          run_id: input.run.id,
          goal_run_id: input.goalRunID,
          delivery_id: input.deliveryID,
          kind: "changed_file",
          label: item.file,
          payload: item,
          time_created: input.now,
          time_updated: input.now,
        })
        .run()
    }
    Database.effect(() =>
      OrchestratorProtocol.emit(Event.DeliveryReady, { taskID: input.task.id, runID: input.run.id, deliveryID: input.deliveryID, summary: input.delivery.summary }, { source: "persist.delivery" }),
    )
  })
}

export function persistFailedRunEvaluation(input: {
  task: TaskRow
  run: RunRow
  goalRunID?: string
  error: string
  now: number
}) {
  const evaluationID = Identifier.ascending("evaluation")
  Database.use((db) =>
    db
      .insert(OrchestratorEvaluationTable)
      .values({
        id: evaluationID,
        task_id: input.task.id,
        run_id: input.run.id,
        goal_run_id: input.goalRunID,
        status: "failed",
        verdict: "rejected",
        summary: input.error,
        checks: [
          {
            name: "executor_completion",
            status: "failed",
            evidence: input.error,
          },
        ],
        time_completed: input.now,
        time_created: input.now,
        time_updated: input.now,
      })
      .run(),
  )
  writeEvaluationSnapshot({
    task: input.task,
    run: input.run,
    goalRunID: input.goalRunID,
    evaluation: {
      id: evaluationID,
      status: "failed",
      verdict: "rejected",
      summary: input.error,
      checks: [
        {
          name: "executor_completion",
          status: "failed",
          evidence: input.error,
        },
      ],
    },
    goals: (() => {
      const plan = input.run.plan_version_id ? findPlan(input.run.plan_version_id) : undefined
      return plan ? listGoalsForPlan(plan) : []
    })(),
    createdAt: input.now,
  })
}

function claimExecutorSessionLeaseWhere(id: string, now: number) {
  const owner = executorLeaseOwner()
  return and(
    eq(OrchestratorExecutorSessionTable.id, id),
    eq(OrchestratorExecutorSessionTable.status, "active"),
    or(
      eq(OrchestratorExecutorSessionTable.lease_owner, owner),
      isNull(OrchestratorExecutorSessionTable.lease_owner),
      lte(OrchestratorExecutorSessionTable.lease_until, now),
    ),
  )
}

function leaseWindow(now: number) {
  return {
    lease_owner: executorLeaseOwner(),
    lease_until: executorLeaseUntil(now),
    time_updated: now,
  }
}

function executorLeaseConflict(row: typeof OrchestratorExecutorSessionTable.$inferSelect | undefined, now: number) {
  if (!row) return ""
  if (executorLeaseHeldByOther(row, now)) {
    return `executor session ${row.id} is leased by ${row.lease_owner} until ${row.lease_until}`
  }
  if (row.status !== "active") {
    return `executor session ${row.id} is not active (${row.status})`
  }
  if (!executorLeaseAvailable(row, now) && row.lease_owner !== executorLeaseOwner()) {
    return `executor session ${row.id} lease is unavailable`
  }
  return `executor session ${row.id} could not be claimed`
}

export function claimExecutorSessionLease(input: { executorSessionID: string; now?: number }) {
  const now = input.now ?? Date.now()
  return Database.use((db) =>
    db
      .update(OrchestratorExecutorSessionTable)
      .set(leaseWindow(now))
      .where(claimExecutorSessionLeaseWhere(input.executorSessionID, now))
      .returning()
      .get(),
  )
}

export function ensureExecutorSession(input: {
  taskID: string
  runID: string
  goalRunID?: string
  provider: RunRow["executor"]
  refs?: ProtocolRefsInfo
  capabilities?: ProtocolCapabilitiesInfo
  settings?: ProtocolSettingsInfo
  started?: number
}) {
  const existing = Database.use((db) =>
    db
      .select()
      .from(OrchestratorExecutorSessionTable)
      .where(
        input.goalRunID
          ? eq(OrchestratorExecutorSessionTable.goal_run_id, input.goalRunID)
          : and(eq(OrchestratorExecutorSessionTable.run_id, input.runID), isNull(OrchestratorExecutorSessionTable.goal_run_id)),
      )
      .orderBy(desc(OrchestratorExecutorSessionTable.time_created))
      .get(),
  )
  const info = protocolInfo(input.provider)
  const now = Date.now()
  const refs = mergeRefs(existing?.refs ?? undefined, input.refs)
  const capabilities = input.capabilities ?? info.capabilities
  const settings = {
    ...(existing?.settings ?? {}),
    ...(input.settings ?? {}),
  }
  if (existing) {
    const updated = Database.use((db) =>
      db
        .update(OrchestratorExecutorSessionTable)
        .set({
          provider: input.provider,
          protocol: info.protocol,
          protocol_version: info.version,
          transport: ProtocolTransport.parse(info.transport).kind,
          status: "active",
          refs,
          capabilities,
          settings,
          lease_owner: executorLeaseOwner(),
          lease_until: executorLeaseUntil(now),
          time_started: existing.time_started ?? input.started ?? now,
          time_updated: now,
        })
        .where(claimExecutorSessionLeaseWhere(existing.id, now))
        .returning()
        .get(),
    )
    if (updated) return updated
    const blocked = Database.use((db) =>
      db
        .select()
        .from(OrchestratorExecutorSessionTable)
        .where(eq(OrchestratorExecutorSessionTable.id, existing.id))
        .get(),
    )
    throw new Error(`ensureExecutorSession: ${executorLeaseConflict(blocked, now)}`)
  }
  const id = Identifier.ascending("executor_session")
  Database.use((db) =>
    db
      .insert(OrchestratorExecutorSessionTable)
      .values({
        id,
        task_id: input.taskID,
        run_id: input.runID,
        goal_run_id: input.goalRunID,
        provider: input.provider,
        protocol: info.protocol,
        protocol_version: info.version,
        transport: ProtocolTransport.parse(info.transport).kind,
        status: "active",
        refs,
        capabilities,
        settings,
        lease_owner: executorLeaseOwner(),
        lease_until: executorLeaseUntil(now),
        time_started: input.started ?? now,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  const inserted = Database.use((db) =>
    db
      .select()
      .from(OrchestratorExecutorSessionTable)
      .where(eq(OrchestratorExecutorSessionTable.id, id))
      .get(),
  )
  if (!inserted) throw new Error(`ensureExecutorSession: executor session ${id} not found after insert`)
  return inserted
}

export function updateExecutorSessionStatus(runID: string, status: typeof OrchestratorExecutorSessionTable.$inferInsert.status) {
  const row = Database.use((db) =>
    db
      .select()
      .from(OrchestratorExecutorSessionTable)
      .where(eq(OrchestratorExecutorSessionTable.run_id, runID))
      .orderBy(desc(OrchestratorExecutorSessionTable.time_created))
      .get(),
  )
  if (!row) return
  Database.use((db) =>
    db
      .update(OrchestratorExecutorSessionTable)
      .set({
        status,
        lease_owner: null,
        lease_until: 0,
        time_completed: Date.now(),
        time_updated: Date.now(),
      })
      .where(eq(OrchestratorExecutorSessionTable.id, row.id))
      .run(),
  )
}

export function updateGoalRunExecutorSessionStatus(
  goalRunID: string,
  status: typeof OrchestratorExecutorSessionTable.$inferInsert.status,
) {
  const row = Database.use((db) =>
    db
      .select()
      .from(OrchestratorExecutorSessionTable)
      .where(eq(OrchestratorExecutorSessionTable.goal_run_id, goalRunID))
      .orderBy(desc(OrchestratorExecutorSessionTable.time_created))
      .get(),
  )
  if (!row) return
  Database.use((db) =>
    db
      .update(OrchestratorExecutorSessionTable)
      .set({
        status,
        lease_owner: null,
        lease_until: 0,
        time_completed: Date.now(),
        time_updated: Date.now(),
      })
      .where(eq(OrchestratorExecutorSessionTable.id, row.id))
      .run(),
  )
}

export function renewExecutorSessionLease(input: { executorSessionID: string; now?: number }) {
  const now = input.now ?? Date.now()
  return Database.use((db) =>
    db
      .update(OrchestratorExecutorSessionTable)
      .set(leaseWindow(now))
      .where(
        and(
          eq(OrchestratorExecutorSessionTable.id, input.executorSessionID),
          eq(OrchestratorExecutorSessionTable.status, "active"),
          eq(OrchestratorExecutorSessionTable.lease_owner, executorLeaseOwner()),
        ),
      )
      .returning()
      .get(),
  )
}


export function markDeliveryPublishing(deliveryId: string, now: number) {
  Database.use((db) =>
    db
      .update(OrchestratorDeliveryTable)
      .set({
        status: "publishing",
        time_updated: now,
      })
      .where(eq(OrchestratorDeliveryTable.id, deliveryId))
      .run(),
  )
}

export function finalizeDeliveryResult(input: {
  deliveryId: string
  taskId: string
  runId: string
  delivery: { result?: Record<string, unknown> | null }
  result: {
    status: OrchestratorDeliveryStatus
    summary: string
    artifacts: Array<{ kind: OrchestratorArtifactKind; label: string; payload: Record<string, unknown> }>
    publish: unknown
  }
  now: number
}) {
  Database.transaction((db) => {
    db.update(OrchestratorDeliveryTable)
      .set({
        status: input.result.status,
        summary: input.result.summary,
        result: {
          ...(input.delivery.result ?? {}),
          summary: input.result.summary,
          artifacts: input.result.artifacts.map((item) => ({
            kind: item.kind,
            label: item.label,
          })),
          publish: input.result.publish,
        },
        time_updated: input.now,
      })
      .where(eq(OrchestratorDeliveryTable.id, input.deliveryId))
      .run()
    for (const artifact of input.result.artifacts) {
      db.insert(OrchestratorArtifactTable)
        .values({
          id: Identifier.ascending("artifact"),
          task_id: input.taskId,
          run_id: input.runId,
          delivery_id: input.deliveryId,
          kind: artifact.kind,
          label: artifact.label,
          payload: artifact.payload,
          time_created: input.now,
          time_updated: input.now,
        })
        .run()
    }
  })
}

function deriveMilestoneStatuses(db: Parameters<Parameters<typeof Database.transaction>[0]>[0], taskID: string, planVersionID: string, now: number) {
  const milestones = listMilestonesByPlan(planVersionID)
  if (milestones.length === 0) return
  const plan = findPlan(planVersionID)
  if (!plan) return
  const goals = listGoalsForPlan(plan)
  for (const ms of milestones) {
    const indices = Array.isArray(ms.metadata?.goal_indices)
      ? ms.metadata.goal_indices.filter((item): item is number => typeof item === "number")
      : []
    const msGoals = indices.length > 0
      ? indices.map((index) => goals[index]).filter((goal): goal is GoalRow => !!goal)
      : []
    const next = deriveMilestoneStatus(msGoals)
    if (next === ms.status) continue
    db.update(OrchestratorMilestoneTable)
      .set({ status: next, time_updated: now })
      .where(eq(OrchestratorMilestoneTable.id, ms.id))
      .run()
    if (next === "passed") {
      Database.effect(() => OrchestratorProtocol.emit(Event.MilestonePassed, { taskID, milestoneID: ms.id, summary: ms.title }, { source: "persist.milestone" }))
    } else if (next === "failed") {
      Database.effect(() => OrchestratorProtocol.emit(Event.MilestoneFailed, { taskID, milestoneID: ms.id, summary: ms.title }, { source: "persist.milestone" }))
    } else if (next === "active") {
      Database.effect(() => OrchestratorProtocol.emit(Event.MilestoneActivated, { taskID, milestoneID: ms.id, summary: ms.title }, { source: "persist.milestone" }))
    }
  }
}

function deriveMilestoneStatus(goals: GoalRow[]): OrchestratorMilestoneStatus {
  if (goals.length === 0) return "passed"
  const blocking = goals.filter((g) => g.priority === "blocking")
  if (blocking.some((g) => g.status === "failed")) return "failed"
  if (blocking.every((g) => g.status === "passed")) return "passed"
  if (goals.some((g) => g.status === "passed")) return "active"
  return "pending"
}

function mergeRefs(current?: ProtocolRefsInfo, next?: ProtocolRefsInfo) {
  if (!current && !next) return undefined
  const result = {
    ...(current ?? {}),
    ...(next ?? {}),
  }
  return Object.keys(result).length > 0 ? result : undefined
}
