import z from "zod"
import { goalStatusByID } from "@/engine/describe"
import { deriveTaskStatus, isTaskActive, isTaskQueued, taskTerminalReason } from "@/engine/task-status"
import {
  findActivePlanForTask,
  findActiveRunForTask,
  findActiveSpecForTask,
  findLatestRunForTask,
  findGoalLatestWorkspace,
  findLatestTipGoalRun,
  findLatestDeliveredGoalRun,
  findBuildOutcomeByGoalRun,
  findDeliveriesForTask,
  findEvaluationsByTask,
  findAcceptanceByGoalRun,
  findLatestAcceptanceVerdictArtifactForAcceptance,
  findLatestEvaluationForGoalRun,
  findLatestArchitectContractGraph,
  getGoalRetryCount,
  listTaskRows,
  listGoalRunsByGoal,
  viewTask,
  viewInteraction,
  type AcceptanceRow,
  type EvaluationRow,
  type RunRow,
} from "@/engine/store"
import {
  findSpecSnapshot,
  viewSpecSnapshot,
  EngineArtifactTable,
  EngineChannelBindingTable,
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
import { ProtocolEventTable } from "@/protocol/protocol.sql"
import { Database, and, desc, eq, inArray, sql } from "@/storage/db"
import { timelineOrderKey } from "@/timeline/order"
import { WorkbenchTaskNoteTable } from "./workbench.sql"
import { compileBrief } from "./brief"
import { findLatestAcceptanceEvidenceManifest } from "@/acceptance/manifest"
import { Project } from "@/project/project"
import { agentInvocationDAGForTask } from "@/orchestrator/task-event"

const BOARD_SNAPSHOT_LIMIT = 80
const BOARD_CHANGED_FILE_LIMIT = 80
const BOARD_SUMMARY_LIMIT = 4000
const BOARD_ARTIFACT_STRING_LIMIT = 1200
const BOARD_ARTIFACT_ARRAY_LIMIT = 8
const BOARD_ARTIFACT_OBJECT_DEPTH_LIMIT = 3
const BOARD_VISIBLE_PROTOCOL_EVENT_TYPES = ["workflow.step.updated"] as const

export function compileBoard(input: { taskID: string }) {
  const task = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, input.taskID)).get())
  if (!task) throw new Error(`Task not found: ${input.taskID}`)
  const tag = boardTagForTask(task)
  const lastSequence = latestTaskProtocolSequence(task.id)
  return buildBoard(task, tag, taskDirectory(task), lastSequence)
}

export function boardTag(input: { taskID: string }) {
  const task = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, input.taskID)).get())
  if (!task) throw new Error(`Task not found: ${input.taskID}`)
  return boardTagForTask(task)
}

function buildBoard(
  task: typeof EngineTaskTable.$inferSelect,
  snapshotVersion: string,
  directory: string,
  lastSequence = latestTaskProtocolSequence(task.id),
) {
  const run = projectedRunForBoard(task)
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
  const staging = notes.filter((note) => ["goal_update", "operator_note", "constraint", "decision"].includes(note.kind))
  const history = notes.filter((note) => ["user_request", "summary"].includes(note.kind))
  // Phase 5-e: board reads through the engine/store projection helpers
  // instead of issuing its own SQL against EngineAcceptance / EngineEvaluation.
  // The store helpers return newest-first; board callers below still want
  // oldest-first order (semantic matches the previous `orderBy(time_created)`
  // ascending + `.at(-1)` pattern), so reverse once here.
  const allDeliveries = [...findDeliveriesForTask(task.id)].reverse()
  const acceptance = run ? allDeliveries.filter((item) => item.run_id === run.id).at(-1) : undefined
  const latestAcceptance = acceptance ?? allDeliveries.at(-1)
  const allEvaluations = [...findEvaluationsByTask(task.id)].reverse()
  const evaluation = run ? allEvaluations.filter((item) => item.run_id === run.id).at(-1) : undefined
  const latestEvaluation = evaluation ?? allEvaluations.at(-1)
  const acceptedEvaluation = [...allEvaluations]
    .reverse()
    .find((item) => item.verdict === "accepted" || item.status === "passed")
  const acceptedAcceptance = acceptedEvaluation?.acceptance_id
    ? allDeliveries.find((item) => item.id === acceptedEvaluation.acceptance_id)
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
      : latestAcceptance
        ? Database.use((db) =>
            db
              .select()
              .from(EngineArtifactTable)
              .where(eq(EngineArtifactTable.acceptance_id, latestAcceptance.id))
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
    candidateAcceptance: latestAcceptance,
    acceptedAcceptance,
    evaluation: latestEvaluation,
    currentFailure,
  })

  const specRow = findActiveSpecForTask(task.id)
  const specSnapshot = specRow ? viewSpecSnapshot(specRow) : undefined

  // lastSequence: must use the same sequence space as protocol_event.seq
  // (auto-incrementing integer), NOT timestamps. The panel's monotonic guard
  // compares this against SSE event.sequence — mismatched number spaces
  // would cause ALL SSE events to be silently discarded.
  // Workflow-structured fields (workflow, goalWorkflows, requirements, architect).
  // Step status is projected fresh from DB rows each render (no FSM cache).
  const workflowFields = buildWorkflowFields(task, goals)
  const project = Project.get(task.project_id)

  return {
    snapshotVersion,
    lastSequence,
    ...workflowFields,
    project: project
      ? {
          id: project.id,
          name: project.name,
          worktree: project.worktree,
        }
      : undefined,
    spec: specSnapshot,
    task: viewTask(task, { directory }),
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
    acceptance: viewBoardAcceptance(latestAcceptance),
    candidateAcceptance: viewBoardAcceptance(latestAcceptance),
    acceptedAcceptance: viewBoardAcceptance(acceptedAcceptance),
    evaluation: viewBoardEvaluation(latestEvaluation),
    interactions: interactions.map(viewInteraction),
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
    agentInvocationDAG: agentInvocationDAGForTask(task.id),
    artifacts: latestArtifacts
      .filter((item) => item.kind !== "diff" && item.kind !== "changed_file")
      .map((item) => ({
        id: item.id,
        taskID: item.task_id,
        runID: item.run_id,
        acceptanceID: item.acceptance_id ?? undefined,
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
    //   - integrity acceptance verdict (deferred_checks + rejection_details + overall),
    //     sunk via orchestrator/tools.ts → sinkAcceptanceVerdictToCriteria()
    //   - in-process visual-diff check (orchestrator/tools.ts, when task carries
    //     image attachments and a rendered index.html exists)
    // Hidden in the overlay for kind=build tasks (build self-verifies; this
    // panel only applies to workflow tasks running through acceptance).
    criteriaResults: boardChecks(task.criteria_results),
  }
}

function taskDirectory(task: typeof EngineTaskTable.$inferSelect) {
  return listTaskRows([task])[0]?.directory ?? ""
}

function projectedRunForBoard(task: typeof EngineTaskTable.$inferSelect) {
  return findActiveRunForTask(task.id) ?? (taskTerminalReason(task) ? findLatestRunForTask(task.id) : undefined)
}

function latestTaskProtocolSequence(taskID: string) {
  return Database.use(
    (db) =>
      db
        .select({ seq: sql<number>`coalesce(max(seq), 0)` })
        .from(ProtocolEventTable)
        .where(eq(ProtocolEventTable.task_id, taskID))
        .get()?.seq ?? 0,
  )
}

function taskSessionTreeVersion(taskID: string) {
  return (
    Database.use((db) =>
      db.get<{
        count: number
        updated: number
        statusSeq: number
        statusUpdated: number
      }>(sql`
        WITH RECURSIVE session_tree(id) AS (
          SELECT session_id FROM engine_task WHERE id = ${taskID} AND session_id IS NOT NULL
          UNION ALL
          SELECT s.id FROM session s JOIN session_tree st ON s.parent_id = st.id
        )
        SELECT
          count(distinct s.id) AS count,
          coalesce(max(s.time_updated), 0) AS updated,
          coalesce(max(pe.seq), 0) AS statusSeq,
          coalesce(max(pe.emitted_at), 0) AS statusUpdated
        FROM session_tree st
        JOIN session s ON s.id = st.id
        LEFT JOIN protocol_event pe ON pe.session_id = s.id AND pe.type = 'session.status'
      `),
    ) ?? { count: 0, updated: 0, statusSeq: 0, statusUpdated: 0 }
  )
}

function boardTagForTask(task: typeof EngineTaskTable.$inferSelect) {
  const run = projectedRunForBoard(task)
  const plan = findActivePlanForTask(task.id)
  const sessionTree = taskSessionTreeVersion(task.id)
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
  const requirements = Database.use((db) =>
    db
      .select({
        count: sql<number>`count(*)`,
        updated: sql<number>`coalesce(max(${EngineRequirementTable.time_updated}), 0)`,
      })
      .from(EngineRequirementTable)
      .where(eq(EngineRequirementTable.task_id, task.id))
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
      .where(and(eq(EngineArtifactTable.task_id, task.id), eq(EngineArtifactTable.kind, "goal_run_attempt")))
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
  // coupling to EngineAcceptance / EngineEvaluation tables here.
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
  const protocolEvents = Database.use((db) =>
    db
      .select({
        count: sql<number>`count(*)`,
        seq: sql<number>`coalesce(max(${ProtocolEventTable.seq}), 0)`,
        updated: sql<number>`coalesce(max(${ProtocolEventTable.emitted_at}), 0)`,
      })
      .from(ProtocolEventTable)
      .where(
        and(
          eq(ProtocolEventTable.task_id, task.id),
          inArray(ProtocolEventTable.type, BOARD_VISIBLE_PROTOCOL_EVENT_TYPES),
        ),
      )
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
    task.budget?.max_executor_groups ?? "",
    sessionTree.count,
    sessionTree.updated,
    sessionTree.statusSeq,
    sessionTree.statusUpdated,
    run?.id ?? "",
    run?.time_updated ?? 0,
    plan?.id ?? "",
    plan?.time_updated ?? 0,
    goals?.count ?? 0,
    goals?.updated ?? 0,
    goalRuns?.count ?? 0,
    goalRuns?.updated ?? 0,
    noteStats?.count ?? 0,
    noteStats?.updated ?? 0,
    interactions?.count ?? 0,
    interactions?.updated ?? 0,
    requirements?.count ?? 0,
    requirements?.updated ?? 0,
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
    protocolEvents?.count ?? 0,
    protocolEvents?.seq ?? 0,
    protocolEvents?.updated ?? 0,
  ].join("|")
}

function clipBoard(input: string) {
  if (input.length <= BOARD_SUMMARY_LIMIT) return input
  return `${input.slice(0, BOARD_SUMMARY_LIMIT)}\n...[truncated]`
}

function clipArtifactString(input: string) {
  if (input.length <= BOARD_ARTIFACT_STRING_LIMIT) return input
  return `${input.slice(0, BOARD_ARTIFACT_STRING_LIMIT)}\n...[truncated ${input.length - BOARD_ARTIFACT_STRING_LIMIT} chars]`
}

function compactArtifactValue(input: unknown, depth = 0): unknown {
  if (typeof input === "string") return clipArtifactString(input)
  if (input == null || typeof input !== "object") return input
  if (Array.isArray(input)) {
    const items = input.slice(0, BOARD_ARTIFACT_ARRAY_LIMIT).map((item) => compactArtifactValue(item, depth + 1))
    if (input.length <= BOARD_ARTIFACT_ARRAY_LIMIT) return items
    return {
      items,
      truncated: true,
      total: input.length,
    }
  }
  if (depth >= BOARD_ARTIFACT_OBJECT_DEPTH_LIMIT) {
    return {
      truncated: true,
      keys: Object.keys(input as Record<string, unknown>).slice(0, BOARD_ARTIFACT_ARRAY_LIMIT),
    }
  }
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).map(([key, value]) => [
      key,
      compactArtifactValue(value, depth + 1),
    ]),
  )
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
      Object.entries(item).map(([key, value]) => [key, typeof value === "string" ? clipBoard(value) : value]),
    )
  }
  if (kind === "build_session_contract") {
    return {
      session_id: item.session_id,
      task_id: item.task_id,
      goal_id: item.goal_id,
      goal_run_id: item.goal_run_id,
      spec_snapshot_id: item.spec_snapshot_id,
      plan_version_id: item.plan_version_id,
      digest: item.digest,
      goal_contract_snapshot: compactArtifactValue(item.goal_contract_snapshot),
      collaboration_goals_count: Array.isArray(item.collaboration_goals_snapshot)
        ? item.collaboration_goals_snapshot.length
        : undefined,
      requirements_count: Array.isArray(item.requirements_snapshot) ? item.requirements_snapshot.length : undefined,
      source_artifact_ids: Array.isArray(item.source_artifact_ids)
        ? item.source_artifact_ids.slice(0, BOARD_ARTIFACT_ARRAY_LIMIT)
        : undefined,
    }
  }
  return compactArtifactValue(item)
}

function boardChecks(input: unknown) {
  if (!Array.isArray(input)) return []
  return input.flatMap((item) => {
    const parsed = EvaluationCheck.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}

function viewBoardAcceptance(row: AcceptanceRow | undefined) {
  if (!row) return undefined
  const result = (row.result ?? {}) as Record<string, unknown>
  // Project status from the acceptance-agent verdict (single source — rule 22).
  // The candidate-acceptance row's `status` column tracks publish lifecycle
  // (candidate → publishing → delivered), NOT verdict outcome — without this
  // override a rejected acceptance still surfaces as "candidate" in the overlay.
  // Verdict-absent: keep the underlying row.status so unrun / in-flight
  // deliveries still render their lifecycle stage.
  const verdictArt = findLatestAcceptanceVerdictArtifactForAcceptance(row.id)
  const verdictPayload = (verdictArt?.payload ?? null) as { verdict?: string; summary?: string } | null
  const verdict = verdictPayload?.verdict
  const manifest = findLatestAcceptanceEvidenceManifest({ acceptanceID: row.id })
  const projectedStatus = verdict === "rejected" ? "failed" : verdict === "accepted" ? "delivered" : row.status
  return {
    id: row.id,
    taskID: row.task_id,
    runID: row.run_id,
    status: projectedStatus,
    verdict: verdict ?? undefined,
    verdictSummary: verdictPayload?.summary ? clipBoard(verdictPayload.summary) : undefined,
    evidenceManifest: manifest
      ? {
          id: manifest.id,
          status: manifest.evidenceDecision.status,
          summary: clipBoard(manifest.evidenceDecision.summary),
          requiredChecks: manifest.requiredChecks.map((item) => ({
            id: item.id,
            name: item.name,
            label: item.label,
            family: item.family,
            command: item.command,
            cwd: item.cwd,
          })),
          goalCoverage: manifest.goalCoverage,
          requirementCoverage: manifest.requirementCoverage,
          reviewEvidence: manifest.reviewEvidence,
          checkResults: manifest.checkResults.map((item) => ({
            id: item.id,
            name: item.name,
            status: item.status,
            exitCode: item.exitCode,
            failureReason: item.failureReason,
            failureSignature: item.failureSignature,
            outputExcerpt: clipBoard(item.outputExcerpt),
          })),
        }
      : undefined,
    summary: clipBoard(row.summary),
    result: {
      summary: clipBoard(String(result.summary ?? row.summary)),
      changedFiles: Array.isArray(result.changed_files)
        ? result.changed_files
            .filter((item): item is string => typeof item === "string")
            .slice(0, BOARD_CHANGED_FILE_LIMIT)
        : [],
      diffs: Array.isArray(result.diffs)
        ? result.diffs
            .filter((d: any): d is Record<string, unknown> => d && typeof d === "object" && typeof d.file === "string")
            .slice(0, BOARD_CHANGED_FILE_LIMIT)
            .map((d: any) => ({
              file: d.file as string,
              additions: typeof d.additions === "number" ? d.additions : 0,
              deletions: typeof d.deletions === "number" ? d.deletions : 0,
              status:
                d.status === "added" || d.status === "deleted" || d.status === "modified"
                  ? (d.status as "added" | "deleted" | "modified")
                  : ("modified" as const),
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

function viewBoardEvaluation(row: EvaluationRow | undefined) {
  if (!row) return undefined
  return {
    id: row.id,
    taskID: row.task_id,
    runID: row.run_id,
    acceptanceID: row.acceptance_id ?? undefined,
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
  const terminalReason = taskTerminalReason(input.task)
  if (terminalReason === "interrupted") {
    return {
      source: "task" as const,
      title: "Task interrupted",
      summary: clipBoard(input.task.error ?? input.run?.error ?? "Task execution was interrupted."),
      checks: undefined,
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
  candidateAcceptance: AcceptanceRow | undefined
  acceptedAcceptance: AcceptanceRow | undefined
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
  const derivedStatus = deriveTaskStatus(input.task)
  const terminalReason = taskTerminalReason(input.task)
  const active = derivedStatus === "queued" || derivedStatus === "active"
  const terminal = derivedStatus === "completed" || derivedStatus === "failed" || derivedStatus === "cancelled"
  const canRetry = terminal && input.pendingInteractions.length === 0
  const headline =
    input.pendingInteractions.length > 0
      ? "Waiting on human input"
      : derivedStatus === "completed"
        ? "Accepted acceptance is ready"
        : terminalReason === "interrupted"
          ? "Task was interrupted"
          : derivedStatus === "failed"
            ? "Current attempt failed acceptance"
            : derivedStatus === "cancelled"
              ? "Task was cancelled"
              : derivedStatus === "active"
                ? input.run?.blocking_reason
                  ? "Task is blocked"
                  : "Task is actively progressing"
                : "Task is queued"
  const summary =
    input.pendingInteractions.length > 0
      ? `${input.pendingInteractions.length} interaction${input.pendingInteractions.length > 1 ? "s" : ""} need attention before the task can continue.`
      : derivedStatus === "completed" && input.acceptedAcceptance
        ? clipBoard(input.acceptedAcceptance.summary)
        : (input.currentFailure?.summary ??
          (input.candidateAcceptance
            ? clipBoard(input.candidateAcceptance.summary)
            : input.run
              ? `Current run is in ${input.run.phase}.`
              : "Task is ready for the first run."))
  const nextStep =
    input.pendingInteractions.length > 0
      ? {
          kind: "resolve_blocker" as const,
          title: "Resolve the pending interaction",
          detail: "Reply to the permission or question request to unblock the task.",
        }
      : derivedStatus === "failed"
        ? terminalReason === "interrupted"
          ? {
              kind: "retry" as const,
              title: "Retry after interruption",
              detail: "The server interrupted this attempt. Retry will continue from the latest durable task context.",
            }
          : {
              kind: "replan" as const,
              title: "Replan from the latest failure",
              detail: "Review the failed acceptance result, tighten the scope if needed, then replan or retry.",
            }
        : derivedStatus === "cancelled"
          ? {
              kind: "retry" as const,
              title: "Retry if the task should continue",
              detail: "The task is cancelled. Retry will queue a new run from the latest context.",
            }
          : derivedStatus === "completed"
            ? {
                kind: "review_acceptance" as const,
                title: "Review the accepted acceptance",
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
      canRetry,
      canReplan: canRetry && Boolean(findActivePlanForTask(input.task.id) ?? input.run?.plan_version_id),
      canCancel: isTaskQueued(input.task) || isTaskActive(input.task),
    },
  }
}

// ═══════════════════════════════════════════════════════════════════
// MiniWorkflow board fields — workflow shape, per-goal workflows,
// requirements list, and architect summary. Workflow template always
// defaults to pipeline; task-scope step status is projected from
// side-effects (spec / goals / runs / acceptance presence), goal-scope
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
  // — task-scope from known side-effects (spec / goals / runs / acceptance /
  // design_specs presence), goal-scope from the goal_run chain.
  const projectedGoalSteps = projectGoalSteps(task.id, workflow)
  const projectedTaskSteps = mergeTaskStepProjections(
    projectTaskSteps(task.id, workflow),
    projectTaskStepsFromWorkflowEvents(task.id),
  )
  const taskStatus = deriveTaskStatus(task)
  const terminalReason = taskTerminalReason(task)

  const workflowBoard = {
    id: workflow.id,
    name: workflow.name,
    steps: workflow.steps.map((step) => ({
      id: step.id,
      orderKey: timelineOrderKey({
        domain: "board_step",
        time: projectedTaskSteps[step.id]?.startedAt ?? projectedTaskSteps[step.id]?.completedAt ?? task.time_created,
        id: `${task.id}-${step.id}`,
      }),
      label: step.label,
      tool: step.tool,
      scope: step.scope as "task" | "goal",
      skippable: step.skippable,
      status: (step.scope === "task"
        ? (projectedTaskSteps[step.id]?.status ?? "pending")
        : deriveGoalScopeStatusFromProjection(projectedGoalSteps, step.id, taskStatus, terminalReason)) as
        | "pending"
        | "running"
        | "completed"
        | "skipped"
        | "failed",
      ...(step.phases && step.phases.length > 0
        ? { phases: step.phases.map((p) => ({ id: p.id, label: p.label, sessionKind: p.sessionKind })) }
        : {}),
    })),
    goalLoopStepIDs: workflow.goalLoopStepIDs,
  }

  const goalWorkflows = goals.map((goal) => {
    const gws = projectedGoalSteps[goal.id]
    // Identify the tip goal_run id. Overlay card identity is attempt-invariant
    // (`step:<goalID>:<stepID>`); this value is route context for scoped diff
    // and acceptance lookups, not a card-id segment.
    const tipRun = findLatestTipGoalRun(goal.id)
    // goalRunID surfaces the run the overlay's per-row diff click fetches
    // via /goal-run/<id>/acceptance. After a targeted retry the tip can be a
    // fresh pending row with no acceptance, so click would resolve to an
    // empty diff. The Files panel displays whatever is currently merged on
    // master — which corresponds to the latest delivered run, not the
    // pending tip — so anchor to that run when one exists. Falls back to
    // the tip when the goal has never produced a acceptance (initial run
    // still in flight).
    const deliveredRun = findLatestDeliveredGoalRun(goal.id)
    // Single projection per goal — same query was previously called twice
    // (workspaceDir + workspaceBranch). Caching it here avoids duplicate
    // work and makes the rule 13 audit obvious: this is one artifact-tip
    // read, not two priority sorts (codex review 2026-05-11 §6.5).
    const latestWorkspace = findGoalLatestWorkspace(goal.id)
    return {
      goalID: goal.id,
      orderKey: timelineOrderKey({
        domain: "board_goal",
        time: goal.time_created,
        id: goal.id,
      }),
      goalRunID: deliveredRun?.id ?? tipRun?.id,
      goalTitle: goal.title,
      // Architect writes the goal's `objective` as a 1–2 sentence execution
      // directive for the per-goal executor. Surface it on the overlay goal
      // card so operators see a proper summary instead of having to parse
      // acceptance_specs. Empty string stays `undefined` — the overlay's
      // GoalWorkflowGroup only renders this when present.
      goalObjective: goal.objective?.trim() ? goal.objective.trim() : undefined,
      goalStatus: goalStatusByID(goal.id),
      orderIndex: goal.order_index,
      // Persistent worktree pointer comes from the latest goal_run_attempt
      // artifact (append-only tip + supersede chain), not from engine_goal
      // columns and not from a step-status priority sort. Surface here is the
      // single source the overlay's GoalWorkflowGroup binds to; step payload
      // no longer mirrors it.
      workspaceDir: latestWorkspace.directory ?? undefined,
      workspaceBranch: latestWorkspace.branch ?? undefined,
      // retryCount is derived from artifacts, not from a goal column. Same
      // source as orchestrator/architect V labels.
      retryCount: getGoalRetryCount(goal.id),
      acceptanceSpecs: goal.acceptance_specs,
      priority: (goal.priority ?? "blocking") as "blocking" | "advisory",
      steps: workflow.steps
        .filter((s) => s.scope === "goal")
        .map((s) => {
          const stepStatus = (gws?.steps[s.id]?.status ?? "pending") as
            | "pending"
            | "running"
            | "completed"
            | "skipped"
            | "failed"
          const phaseProjection = gws?.stepPhases?.[s.id]
          return {
            stepID: s.id,
            orderKey: timelineOrderKey({
              domain: "board_step",
              time: gws?.steps[s.id]?.startedAt ?? gws?.steps[s.id]?.completedAt ?? goal.time_created,
              id: `${goal.id}-${s.id}`,
            }),
            label: s.label,
            status: stepStatus,
            startedAt: gws?.steps[s.id]?.startedAt,
            completedAt: gws?.steps[s.id]?.completedAt,
            summary: buildStepSummary(s, goal.id, stepStatus),
            payload: buildStepPayload(s, goal.id, stepStatus),
            ...(phaseProjection && Object.keys(phaseProjection).length > 0
              ? { phases: orderPhaseProjection(goal.id, s.id, goal.time_created, phaseProjection) }
              : {}),
          }
        }),
    }
  })

  const activeSpec = findActiveSpecForTask(task.id)
  const requirements = activeSpec ? buildRequirements(task.id, activeSpec.id, goals) : []

  const architect = buildArchitectSummary(task.id)

  return {
    workflow: workflowBoard,
    goalWorkflows,
    requirements,
    architect,
  }
}

type TaskStepProjection = Record<string, { status: string; startedAt?: number; completedAt?: number }>

type GoalPhaseProjection = Record<string, { status: string; startedAt?: number; completedAt?: number }>

function orderPhaseProjection(
  goalID: string,
  stepID: string,
  goalCreatedAt: number,
  phases: GoalPhaseProjection,
): Record<string, { orderKey: string; status: string; startedAt?: number; completedAt?: number }> {
  const out: Record<string, { orderKey: string; status: string; startedAt?: number; completedAt?: number }> = {}
  for (const [phaseID, phase] of Object.entries(phases)) {
    out[phaseID] = {
      orderKey: timelineOrderKey({
        domain: "board_phase",
        time: phase.startedAt ?? phase.completedAt ?? goalCreatedAt,
        id: `${goalID}-${stepID}-${phaseID}`,
      }),
      ...phase,
    }
  }
  return out
}

function isWorkflowStepStatus(value: unknown): value is "pending" | "running" | "completed" | "skipped" | "failed" | "aborted" {
  return (
    value === "pending" ||
    value === "running" ||
    value === "completed" ||
    value === "skipped" ||
    value === "failed" ||
    value === "aborted"
  )
}

function projectTaskStepsFromWorkflowEvents(taskID: string): TaskStepProjection {
  const rows = Database.use((db) =>
    db
      .select({
        payload: ProtocolEventTable.payload,
        emittedAt: ProtocolEventTable.emitted_at,
      })
      .from(ProtocolEventTable)
      .where(and(eq(ProtocolEventTable.task_id, taskID), eq(ProtocolEventTable.type, "workflow.step.updated")))
      .orderBy(ProtocolEventTable.seq)
      .all(),
  )
  const out: TaskStepProjection = {}
  for (const row of rows) {
    const payload = row.payload as { stepID?: unknown; status?: unknown } | null
    const stepID = payload?.stepID
    const status = payload?.status
    if (typeof stepID !== "string" || stepID.length === 0 || !isWorkflowStepStatus(status)) {
      throw new Error(`workflow.step.updated payload invalid: ${JSON.stringify(payload)}`)
    }
    out[stepID] = {
      status,
      ...(status === "running" ? { startedAt: row.emittedAt } : {}),
      ...(status === "completed" || status === "skipped" || status === "failed" ? { completedAt: row.emittedAt } : {}),
    }
  }
  return out
}

function mergeTaskStepProjections(sideEffects: TaskStepProjection, events: TaskStepProjection): TaskStepProjection {
  const out: TaskStepProjection = { ...sideEffects }
  for (const [stepID, eventStep] of Object.entries(events)) {
    const sideEffectStep = sideEffects[stepID]
    if (sideEffectStep && sideEffectStep.status !== "pending") {
      out[stepID] = sideEffectStep
      continue
    }
    out[stepID] = eventStep
  }
  return out
}

/** Derive aggregate status for a goal-scope step from the projected goal steps */
function deriveGoalScopeStatusFromProjection(
  projection: Record<string, { steps: Record<string, { status: string }> }>,
  stepID: string,
  taskStatus: ReturnType<typeof deriveTaskStatus>,
  terminalReason?: ReturnType<typeof taskTerminalReason>,
): string {
  const entries = Object.values(projection)
  const terminalCancelled = taskStatus === "cancelled"
  const terminalFailed = taskStatus === "failed" && terminalReason !== "interrupted"
  const terminalInterrupted = terminalReason === "interrupted"
  const terminalCompleted = taskStatus === "completed"
  if (entries.length === 0) return terminalCancelled ? "skipped" : "pending"
  const statuses = entries.map((g) => g.steps[stepID]?.status ?? "pending")
  if (statuses.some((s) => s === "running")) {
    if (terminalCancelled) return "skipped"
    if (terminalFailed) return "failed"
    if (terminalCompleted) return "completed"
    if (terminalInterrupted) return "pending"
    return "running"
  }
  if (statuses.every((s) => s === "completed" || s === "skipped")) return "completed"
  if (statuses.some((s) => s === "failed")) return "failed"
  if (statuses.some((s) => s === "completed")) {
    if (terminalCancelled) return "skipped"
    if (terminalFailed) return "failed"
    if (terminalCompleted) return "completed"
    if (terminalInterrupted) return "pending"
    return "running"
  }
  if (terminalCancelled) return "skipped"
  return "pending"
}

/** Build structured requirements array from DB */
function buildRequirements(taskID: string, specSnapshotID: string, goals: Array<typeof EngineGoalTable.$inferSelect>) {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineRequirementTable)
      .where(
        and(eq(EngineRequirementTable.task_id, taskID), eq(EngineRequirementTable.spec_snapshot_id, specSnapshotID)),
      )
      .orderBy(EngineRequirementTable.order_index, EngineRequirementTable.id)
      .all(),
  )
  if (rows.length === 0) return undefined
  const goalsByRequirement = new Map<string, Array<typeof EngineGoalTable.$inferSelect>>()
  for (const goal of goals) {
    if (goal.spec_snapshot_id !== specSnapshotID) continue
    for (const requirementID of goal.requirement_ids ?? []) {
      const list = goalsByRequirement.get(requirementID) ?? []
      list.push(goal)
      goalsByRequirement.set(requirementID, list)
    }
  }
  return rows.map((r) => ({
    id: r.id,
    description: r.description,
    type: r.priority === "blocking" ? ("explicit" as const) : ("inferred" as const),
    priority: r.priority as "blocking" | "advisory",
    status: requirementStatus(r, goalsByRequirement),
  }))
}

function requirementStatus(
  requirement: typeof EngineRequirementTable.$inferSelect,
  goalsByRequirement: Map<string, Array<typeof EngineGoalTable.$inferSelect>>,
): "pending" | "passed" | "failed" {
  const metadata = requirement.metadata as { source_requirement_id?: unknown } | null
  const sourceRequirementID =
    typeof metadata?.source_requirement_id === "string" && metadata.source_requirement_id.trim()
      ? metadata.source_requirement_id.trim()
      : requirement.id
  const linkedGoals = goalsByRequirement.get(sourceRequirementID) ?? []
  if (linkedGoals.length === 0) return requirement.status
  const statuses = linkedGoals.map((goal) => goalStatusByID(goal.id))
  if (statuses.some((status) => status === "failed")) return "failed"
  if (statuses.every((status) => status === "passed")) return "passed"
  return "pending"
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
 *  Only applies to goal-scope steps that own declared phases. Detection uses
 *  the workflow phase declaration rather than hardcoded step ids. */
function buildStepSummary(step: MiniWorkflowStep, goalID: string, status?: string): string | undefined {
  if (!status || status === "pending") return undefined
  if (step.scope !== "goal") return undefined
  if (!step.phases || step.phases.length === 0) return undefined

  // Use the latest *delivered* goal_run, not the tip. After a targeted
  // acceptance retry, the tip can be a fresh pending row with no acceptance yet,
  // but the prior acceptance row's
  // files are still merged into master and remain the canonical "built"
  // surface. Falling through to currentGoalRun() here would silently zero
  // out the file count for every previously-passed goal until the next
  // dispatch cycle re-merges, which made post-rejection overlay summaries
  // misleadingly show "0 files" for goals whose code is still on disk.
  const deliveredRun = findLatestDeliveredGoalRun(goalID)
  if (deliveredRun) {
    const acceptance = findAcceptanceByGoalRun(deliveredRun.id)
    if (acceptance) {
      const result = acceptance.result as { changed_files?: string[]; diffs?: unknown[] } | null
      const fileCount = result?.changed_files?.length ?? result?.diffs?.length ?? 0
      if (fileCount > 0) return `${fileCount} files`
    }
  }
  if (status === "running") return "running…"
  // Pre-execution: surface plan-step count if planning has produced nodes.
  const nodes = Database.use((db) =>
    db.select().from(EnginePlanNodeTable).where(eq(EnginePlanNodeTable.goal_id, goalID)).all(),
  )
  if (nodes.length) return `${nodes.length} planned steps`
  return undefined
}

/**
 * Per-goal step payload — full structured content for the GoalWorkflowGroup
 * StepRow to render. This replaces the old PlanPanel / ExecutorSummaryPanel /
 * CriteriaPanel / EvaluationPanel which read separate top-level fields.
 *
 * Every per-goal step carries its own payload so the frontend never has to
 * cross-reference task-level state. The pipeline currently exposes the
 * goal-scope `build` step labelled "Executor".
 */
export type GoalStepPayload = z.infer<typeof TaskBoardGoalStepPayload>

function buildStepPayload(step: MiniWorkflowStep, goalID: string, status?: string): GoalStepPayload | undefined {
  if (!status || status === "pending") return undefined
  // Payload applies only to goal-scope phase-owning steps. The current build
  // phase payload ships plan nodes, diff stats, and verification checks.
  // Detected by phases presence, not hardcoded step id.
  if (step.scope !== "goal") return undefined
  if (!step.phases || step.phases.length === 0) return undefined

  const goalRun = currentGoalRun(goalID)
  const nodes = Database.use((db) =>
    db.select().from(EnginePlanNodeTable).where(eq(EnginePlanNodeTable.goal_id, goalID)).all(),
  )
  const planNodes =
    nodes.length > 0
      ? nodes
          .map((n) => {
            return {
              id: n.id,
              title: n.title,
              brief: n.brief,
              orderIndex: n.order_index,
            }
          })
          .sort((a, b) => a.orderIndex - b.orderIndex)
      : undefined

  let buildSessionID: string | undefined
  let commitRef: string | undefined
  let publishedCommitRef: string | undefined
  let diffBaseRef: string | undefined
  let diffHeadRef: string | undefined
  let changedFiles: string[] | undefined
  let changedFileDiffs: GoalStepPayload["changedFileDiffs"]
  let diffStats: { files?: number; additions?: number; deletions?: number } | undefined
  let buildOutcome: GoalStepPayload["buildOutcome"]
  // buildSessionID describes the live attempt — read from the tip.
  // changedFiles / changedFileDiffs / diffStats describe what's been merged
  // into master — read from the most-recently-delivered run, which can
  // differ from the tip after a acceptance-rejection reset (see
  // findLatestDeliveredGoalRun for the full rationale).
  //
  // workspaceDir used to be projected here too, but it duplicated the
  // goal-level workspace pointer (TaskBoardGoalWorkflow.workspaceDir,
  // populated by findGoalLatestWorkspace upstream). The overlay now reads
  // worktree at the goal level on GoalWorkflowGroup; step payload no
  // longer carries it (rule 8 — single source).
  if (goalRun) {
    buildSessionID = goalRun.session_id ?? undefined
    const outcome = findBuildOutcomeByGoalRun(goalRun.id)
    if (outcome) {
      buildOutcome = {
        id: outcome.id,
        goalRunID: outcome.goal_run_id,
        terminalStatus: outcome.terminal_status,
        outcomeKind: outcome.outcome_kind,
        acceptancePresent: findAcceptanceByGoalRun(outcome.goal_run_id) !== undefined,
        summary: outcome.summary || undefined,
        error: outcome.error ?? undefined,
        noDiffReason: outcome.no_diff_reason ?? undefined,
        changedFiles: outcome.changed_files,
        commitRef: outcome.commit_ref ?? undefined,
        publishedCommitRef: outcome.published_commit_ref ?? undefined,
        diffBaseRef: outcome.diff_base_ref ?? undefined,
        diffHeadRef: outcome.diff_head_ref ?? undefined,
      }
    }
  }
  const deliveredRun = findLatestDeliveredGoalRun(goalID)
  if (deliveredRun) {
    const acceptance = findAcceptanceByGoalRun(deliveredRun.id)
    const result = acceptance?.result as {
      commit_ref?: unknown
      published_commit_ref?: unknown
      diff_base_ref?: unknown
      diff_head_ref?: unknown
      changed_files?: string[]
      diffs?: {
        file?: string
        additions?: unknown
        deletions?: unknown
        status?: string
      }[]
      stats?: { additions?: number; deletions?: number }
    } | null
    commitRef =
      typeof result?.commit_ref === "string" && result.commit_ref.trim() ? result.commit_ref.trim() : undefined
    publishedCommitRef =
      typeof result?.published_commit_ref === "string" && result.published_commit_ref.trim()
        ? result.published_commit_ref.trim()
        : undefined
    diffBaseRef =
      typeof result?.diff_base_ref === "string" && result.diff_base_ref.trim() ? result.diff_base_ref.trim() : undefined
    diffHeadRef =
      typeof result?.diff_head_ref === "string" && result.diff_head_ref.trim() ? result.diff_head_ref.trim() : undefined
    const diffRows = Array.isArray(result?.diffs)
      ? result.diffs
          .filter(
            (
              d,
            ): d is {
              file: string
              additions?: unknown
              deletions?: unknown
              status?: string
            } => !!d && typeof d.file === "string",
          )
          .map((d) => ({
            file: d.file,
            additions: typeof d.additions === "number" ? d.additions : 0,
            deletions: typeof d.deletions === "number" ? d.deletions : 0,
            status:
              d.status === "added" || d.status === "deleted" || d.status === "modified"
                ? (d.status as "added" | "deleted" | "modified")
                : ("modified" as const),
          }))
      : []
    changedFiles = result?.changed_files ?? (diffRows.length > 0 ? diffRows.map((d) => d.file) : undefined)
    changedFileDiffs = diffRows.length > 0 ? diffRows : undefined
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
    changedFiles === undefined &&
    buildOutcome === undefined &&
    checks === undefined
  ) {
    return undefined
  }
  return {
    planNodes,
    buildSessionID,
    commitRef,
    publishedCommitRef,
    diffBaseRef,
    diffHeadRef,
    changedFiles,
    changedFileDiffs,
    diffStats,
    buildOutcome,
    checks,
    evalSummary,
    verdict,
  }
}

/** Build architect summary from the Architect Contract Graph artifact. */
function buildArchitectSummary(taskID: string) {
  const graph = findLatestArchitectContractGraph(taskID)
  if (!graph) return undefined
  const categories = [...new Set(graph.contracts.map((contract) => contract.kind))]
  const edgeDecisions = graph.dependency_contracts.map((edge) => ({
    key: `dependency:${edge.reason}`,
    value: `${edge.from_goal_id} -> ${edge.to_goal_id}`,
    reason: edge.summary ?? `contracts=${edge.contract_ids.join(", ") || "(none)"}`,
    goalID: edge.to_goal_id,
  }))
  return {
    summary: `${graph.contracts.length} architect graph contracts and ${graph.dependency_contracts.length} dependency reasons`,
    contractCount: graph.contracts.length,
    categories,
    decisions: [
      ...graph.contracts.map((contract) => ({
        key: contract.kind,
        value: `${contract.name}: ${contract.summary}`,
        reason: `producer=${contract.producer_goal_id}; consumers=${contract.consumer_goal_ids.join(", ") || "(none)"}`,
        goalID: contract.producer_goal_id,
      })),
      ...edgeDecisions,
    ],
  }
}
