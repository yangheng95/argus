import { selectorList, selectorsSatisfied } from "@/check/policy"
import { GoalFailureError, type GoalDraft } from "@/types/goal"
import { Identifier } from "@/id/id"
import { executorLeaseAvailable, executorLeaseHeldByOther, executorLeaseOwner, executorLeaseUntil } from "./lease"
import { type GoalJudgmentType, type CheckReport } from "@/types/evaluator"
import { protocolInfo, type ProtocolCapabilitiesInfo, type ProtocolRefsInfo, type ProtocolSettingsInfo, ProtocolTransport } from "@/executor/protocol"
import { type ReplanContext, type WaveStatus, PlannerFailureError } from "@/types/planner"
import { writeEvaluationSnapshot, writeGoalSnapshot } from "@/orchestrator/docs"
import { type Requirement, type SpecDraft as SharedSpecDraft } from "@/types/spec"
import { Database, and, desc, eq, inArray, isNull, lte, or } from "@/storage/db"
import { Log } from "@/util/log"
import { buildFixPrompt, type FixContext } from "./helpers"
import { Event } from "./model"
import {
  OrchestratorArtifactTable,
  OrchestratorDeliveryTable,
  OrchestratorEvaluationTable,
  OrchestratorExecutorSessionTable,
  OrchestratorGoalTable,
  OrchestratorGoalSnapshotTable,
  OrchestratorGoalRunTable,
  OrchestratorPlanNodeTable,
  OrchestratorMilestoneTable,
  OrchestratorPlanVersionTable,
  OrchestratorProgressSnapshotTable,
  OrchestratorRequirementTable,
  OrchestratorRunTable,
  OrchestratorSpecItemTable,
  OrchestratorSpecSnapshotTable,
  OrchestratorTaskTable,
  type OrchestratorMilestoneStatus,
  type OrchestratorDeliveryStatus,
  type OrchestratorArtifactKind,
} from "./orchestrator.sql"
import { OrchestratorProtocol } from "./protocol"
import { findPlan, findRequirements, listGoalsForPlan, listMilestonesByPlan, listPlanNodesByPlan, type GoalRow, type PlanRow, type RequirementRow, type RunRow, type TaskRow } from "./store"
import { normalizePlanWaves } from "./wave"

const log = Log.create({ service: "orchestrator-transition" })

type GoalInput = {
  title: string
  objective?: string
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

type MilestoneInput = {
  title: string
  description?: string
  goals: GoalInput[]
}

type SpecDraft = SharedSpecDraft

function requirementsFromSpecDraft(specDraft: Pick<SpecDraft, "requirements">): Requirement[] {
  return Array.isArray(specDraft.requirements) ? specDraft.requirements : []
}

export function resetPlanGoals(db: Database.TxOrDb, goals: GoalRow[], now: number) {
  for (const goal of goals) {
    if (goal.status === "pending") continue
    db.update(OrchestratorGoalTable)
      .set({
        status: "pending",
        time_updated: now,
      })
      .where(eq(OrchestratorGoalTable.id, goal.id))
      .run()
  }
}

export type ReplanQueueResult =
  | {
      queued: true
      runID: string
      error?: undefined
    }
  | {
      queued: false
      runID?: undefined
      error: string
    }

function buildPreviousWaves(planID: string, goals: GoalRow[]): WaveStatus[] {
  const nodes = listPlanNodesByPlan(planID)
  const goalNodes = nodes.filter((n) => n.kind === "goal" && n.goal_id)
  if (goalNodes.length === 0) return []

  // Group goal nodes by wave_index
  const waveMap = new Map<number, Array<{ title: string; goalID: string }>>()
  const waveTitles = new Map<number, string>()
  for (const node of goalNodes) {
    const meta = node.metadata && typeof node.metadata === "object" && !Array.isArray(node.metadata)
      ? node.metadata as Record<string, unknown>
      : {}
    const waveIndex = typeof meta.wave_index === "number" ? meta.wave_index : 0
    const waveTitle = typeof meta.wave_title === "string" ? meta.wave_title : `Wave ${waveIndex + 1}`
    if (!waveTitles.has(waveIndex)) waveTitles.set(waveIndex, waveTitle)
    const entries = waveMap.get(waveIndex) ?? []
    entries.push({ title: node.title, goalID: node.goal_id! })
    waveMap.set(waveIndex, entries)
  }

  const goalByID = new Map(goals.map((g) => [g.id, g]))
  const sorted = [...waveMap.entries()].sort((a, b) => a[0] - b[0])

  return sorted.map(([waveIndex, entries]) => {
    const waveGoals = entries.map((entry) => {
      const goal = goalByID.get(entry.goalID)
      return {
        description: goal?.title ?? entry.title,
        status: goal?.status ?? "pending",
      }
    })
    const passedCount = waveGoals.filter((g) => g.status === "passed").length
    const failedCount = waveGoals.filter((g) => g.status === "failed").length
    const status: WaveStatus["status"] =
      passedCount === waveGoals.length ? "passed"
        : failedCount > 0 ? (passedCount > 0 ? "partial" : "failed")
          : "pending"
    return {
      title: waveTitles.get(waveIndex) ?? `Wave ${waveIndex + 1}`,
      waveIndex,
      status,
      goals: waveGoals,
    }
  })
}

export function buildReplanContext(input: {
  analysis?: GoalJudgmentType
  goals: GoalRow[]
  planID: string
  summary: string
  previousSummary: string
  taskID?: string
  specSnapshotID?: string
}) {
  if (!input.analysis) return
  const previousWaves = buildPreviousWaves(input.planID, input.goals)
  const goalStatuses = Array.isArray(input.analysis.goal_statuses) ? input.analysis.goal_statuses : []
  const previousGoalStatuses = goalStatuses.map((item) => {
    const goal = input.goals[item.goal_index]
    const meta = goal?.metadata && typeof goal.metadata === "object" && !Array.isArray(goal.metadata)
      ? goal.metadata as Record<string, unknown>
      : undefined
    return {
      description: goal?.title ?? `Goal ${item.goal_index}`,
      status: item.status,
      evidence: Array.isArray(item.evidence) ? item.evidence.join("; ") : item.evidence,
      requirement_ids: Array.isArray(meta?.requirement_ids)
        ? (meta.requirement_ids as unknown[]).filter((id): id is string => typeof id === "string")
        : undefined,
    }
  })

  // Derive failed requirements from goal→requirement mapping
  const failedRequirements: Array<{ id: string; title: string; reason: string }> = []
  if (input.specSnapshotID) {
    const requirements = findRequirements(input.specSnapshotID)
    // Build map: requirement DB ID → covering goal indices
    const goalIndicesByReq = new Map<string, number[]>()
    for (let gi = 0; gi < input.goals.length; gi++) {
      const meta = input.goals[gi]?.metadata
      const reqIDs = meta && typeof meta === "object" && !Array.isArray(meta)
        ? (Array.isArray((meta as Record<string, unknown>).requirement_ids)
          ? ((meta as Record<string, unknown>).requirement_ids as unknown[]).filter((id): id is string => typeof id === "string")
          : [])
        : []
      for (const reqID of reqIDs) {
        const list = goalIndicesByReq.get(reqID) ?? []
        list.push(gi)
        goalIndicesByReq.set(reqID, list)
      }
    }
    for (const requirement of requirements) {
      if (requirement.priority !== "blocking") continue
      const coveringIndices = goalIndicesByReq.get(requirement.id) ?? []
      const failedGoals = coveringIndices
        .map((gi) => goalStatuses.find((gs) => gs.goal_index === gi))
        .filter((gs) => gs?.status === "failed")
      if (failedGoals.length > 0) {
        const evidence = failedGoals.map((gs) => Array.isArray(gs!.evidence) ? gs!.evidence.join("; ") : gs!.evidence).filter(Boolean).join("; ")
        failedRequirements.push({
          id: sourceRequirementIDOfRow(requirement),
          title: requirement.title,
          reason: evidence || "Covering goal(s) failed",
        })
      }
    }
  }

  return {
    previousSummary: input.previousSummary,
    failureAnalysis: {
      classification: input.analysis.classification,
      summary: input.analysis.summary,
      rootCause: input.analysis.replan_guidance?.root_cause ?? input.summary,
      suggestedStrategy: input.analysis.replan_guidance?.suggested_strategy ?? "",
      avoidApproaches: input.analysis.replan_guidance?.avoid_approaches ?? [],
    },
    previousGoalStatuses,
    ...(failedRequirements.length > 0 ? { failedRequirements } : {}),
    ...(previousWaves.length > 0 ? { previousWaves } : {}),
  } satisfies ReplanContext
}

export function insertPlanItems(
  db: Database.TxOrDb,
  input: {
    taskID: string
    planID: string
    goals: Array<{ id: string; title: string; done_definition: string; priority?: "blocking" | "advisory"; metadata?: Record<string, unknown> }>
    planDraft: {
      metadata?: Record<string, unknown>
    }
    now: number
    milestones: MilestoneInput[]
  },
) {
  const byTitle = new Map<string, number[]>()
  input.goals.forEach((goal, index) => {
    const key = goal.title.trim()
    if (!key) return
    const indices = byTitle.get(key) ?? []
    indices.push(index)
    byTitle.set(key, indices)
  })
  const manualWaves = input.milestones.map((milestone) => ({
    title: milestone.title,
    objective: milestone.description,
    goal_indices: milestone.goals.flatMap((goal) => {
      const key = (goal as any).title?.trim() ?? (goal as any).description?.trim()
      const indices = key ? byTitle.get(key) : undefined
      const next = indices?.shift()
      return next === undefined ? [] : [next]
    }),
  }))
  const metadataWaves = Array.isArray(input.planDraft.metadata?.waves) ? input.planDraft.metadata.waves : undefined
  const waves = normalizePlanWaves({
    waves: metadataWaves?.length ? metadataWaves : manualWaves,
    goals: input.goals,
  })

  // Pre-generate plan node IDs
  const goalNodeIDs = input.goals.map(() => Identifier.ascending("plan_node"))
  const milestoneNodeIDs = waves.map(() => Identifier.ascending("plan_node"))
  const goalWaveIndex = new Map<number, number>()
  for (const [waveIndex, wave] of waves.entries()) {
    for (const goalIndex of wave.goal_indices) {
      goalWaveIndex.set(goalIndex, waveIndex)
    }
  }

  // ── Compute goal dependencies from goal agent's declared depends_on_goal_ids ──
  // The goal agent declares minimal, precise dependencies between goals.
  // Honor those instead of the coarse wave-based linear chain.
  const goalIDToIndex = new Map<string, number>()
  for (const [index, goal] of input.goals.entries()) {
    if (goal.id) goalIDToIndex.set(goal.id, index)
  }

  const goalDeps = input.goals.map((goal, _index) => {
    const meta = goal.metadata as Record<string, unknown> | undefined
    const declaredDeps = Array.isArray(meta?.depends_on_goal_ids) ? meta.depends_on_goal_ids : []
    const indices: number[] = []
    for (const depID of declaredDeps) {
      if (typeof depID !== "string") continue
      const depIndex = goalIDToIndex.get(depID)
      if (depIndex !== undefined) indices.push(depIndex)
    }
    return indices
  })

  // Validate acyclicity via Kahn's algorithm
  const inDegree = new Map<number, number>()
  for (let i = 0; i < input.goals.length; i++) inDegree.set(i, 0)
  for (const [i, deps] of goalDeps.entries()) {
    for (const dep of deps) {
      inDegree.set(i, (inDegree.get(i) ?? 0) + 1)
    }
  }
  const queue = [...inDegree.entries()].filter(([, deg]) => deg === 0).map(([i]) => i)
  let visited = 0
  while (queue.length > 0) {
    const node = queue.shift()!
    visited++
    for (let i = 0; i < input.goals.length; i++) {
      if (goalDeps[i].includes(node)) {
        const next = (inDegree.get(i) ?? 1) - 1
        inDegree.set(i, next)
        if (next === 0) queue.push(i)
      }
    }
  }
  if (visited < input.goals.length) {
    log.warn("cycle detected in goal dependency graph, falling back to linear ordering", {
      taskID: input.taskID,
      goalCount: input.goals.length,
      visited,
    })
    // Reset to strict linear chain: each goal depends on all prior goals
    for (let i = 0; i < goalDeps.length; i++) {
      goalDeps[i] = Array.from({ length: i }, (_, j) => j)
    }
  }

  // Log the dependency graph for diagnosis
  const depGraph = input.goals.map((goal, i) => ({
    index: i,
    id: goal.id,
    title: goal.title?.slice(0, 50),
    deps: goalDeps[i].map((d) => input.goals[d]?.id),
  }))
  log.info("goal dependency graph", { taskID: input.taskID, goalCount: input.goals.length, graph: depGraph })

  for (const [index, goal] of input.goals.entries()) {
    const waveIndex = goalWaveIndex.get(index) ?? 0
    const wave = waves[waveIndex]
    const dependsOnIds = goalDeps[index].length > 0
      ? goalDeps[index].map((depIndex) => goalNodeIDs[depIndex])
      : undefined
    db.insert(OrchestratorPlanNodeTable)
      .values({
        id: goalNodeIDs[index],
        task_id: input.taskID,
        plan_version_id: input.planID,
        kind: "goal",
        goal_id: goal.id,
        title: goal.title,
        brief: goal.done_definition,
        depends_on_ids: dependsOnIds?.length ? dependsOnIds : undefined,
        order_index: index,
        metadata: {
          ...(goal.metadata ?? {}),
          wave_index: waveIndex,
          wave_title: wave?.title,
          wave_objective: wave?.objective,
          wave_goal_indices: wave?.goal_indices ?? [index],
        },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
  }
  for (const [waveIndex, wave] of waves.entries()) {
    const milestoneID = Identifier.ascending("milestone")
    db.insert(OrchestratorMilestoneTable)
      .values({
        id: milestoneID,
        task_id: input.taskID,
        plan_version_id: input.planID,
        title: wave.title,
        description: wave.objective ?? "",
        status: "pending",
        order_index: waveIndex,
        metadata: {
          kind: "wave",
          goal_indices: wave.goal_indices,
        },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    db.insert(OrchestratorPlanNodeTable)
      .values({
        id: milestoneNodeIDs[waveIndex],
        task_id: input.taskID,
        plan_version_id: input.planID,
        kind: "milestone",
        title: wave.title,
        brief: wave.objective ?? "",
        depends_on_ids: waveIndex > 0 ? [milestoneNodeIDs[waveIndex - 1]] : undefined,
        order_index: input.goals.length + waveIndex,
        metadata: {
          kind: "wave",
          milestone_id: milestoneID,
          goal_indices: wave.goal_indices,
        },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
  }
  const steps = Array.isArray(input.planDraft.metadata?.steps)
    ? input.planDraft.metadata.steps.filter((step): step is string => typeof step === "string" && step.trim().length > 0)
    : []
  const baseOrder = input.goals.length + waves.length
  for (const [index, step] of steps.entries()) {
    db.insert(OrchestratorPlanNodeTable)
      .values({
        id: Identifier.ascending("plan_node"),
        task_id: input.taskID,
        plan_version_id: input.planID,
        kind: "step",
        title: step,
        brief: step,
        order_index: baseOrder + index,
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
  }

  // Link goals to this plan version so listGoalsByPlan() works.
  // Goals are created in the goal stage (before plan exists), so we back-fill here.
  const goalIDs = input.goals.map((g) => g.id).filter(Boolean)
  if (goalIDs.length > 0) {
    db.update(OrchestratorGoalTable)
      .set({ plan_version_id: input.planID, time_updated: input.now })
      .where(and(
        eq(OrchestratorGoalTable.task_id, input.taskID),
        inArray(OrchestratorGoalTable.id, goalIDs),
      ))
      .run()
  }
}

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

type PersistedRequirement = {
  id: string
  sourceRequirementID: string
  title: string
  priority: "blocking" | "advisory"
}

function sourceRequirementIDOfRow(row: Pick<RequirementRow, "id" | "metadata">) {
  return row.metadata && typeof row.metadata.source_requirement_id === "string" && row.metadata.source_requirement_id.trim()
    ? row.metadata.source_requirement_id
    : row.id
}

function requirementLinks(rows: RequirementRow[]): PersistedRequirement[] {
  return rows.map((row) => ({
    id: row.id,
    sourceRequirementID: sourceRequirementIDOfRow(row),
    title: row.title,
    priority: row.priority,
  }))
}

export function persistSpecSnapshot(
  db: Database.TxOrDb,
  input: {
    taskID: string
    specSnapshotID: string
    version: number
    specDraft: SpecDraft
    now: number
  },
) {
  const scope = typeof (input.specDraft as { scope?: unknown }).scope === "string"
    ? (input.specDraft as { scope?: string }).scope
    : ""
  const outOfScope = typeof (input.specDraft as { out_of_scope?: unknown }).out_of_scope === "string"
    ? (input.specDraft as { out_of_scope?: string }).out_of_scope
    : undefined
  db.insert(OrchestratorSpecSnapshotTable)
    .values({
      id: input.specSnapshotID,
      task_id: input.taskID,
      version: input.version,
      status: "ready",
      summary: input.specDraft.summary,
      content: input.specDraft.content,
      scope,
      out_of_scope: outOfScope,
      evidence: input.specDraft.evidence_sources.length > 0 ? input.specDraft.evidence_sources : undefined,
      metadata: {
        assumptions: input.specDraft.assumptions,
        risks: input.specDraft.risks,
        unresolved_questions: input.specDraft.unresolved_questions,
      },
      time_created: input.now,
      time_updated: input.now,
    })
    .run()
  const requirements = insertRequirements(db, {
    taskID: input.taskID,
    specSnapshotID: input.specSnapshotID,
    requirements: requirementsFromSpecDraft(input.specDraft),
    now: input.now,
  })
  return { requirements }
}

export function persistGoalSnapshot(
  db: Database.TxOrDb,
  input: {
    taskID: string
    specSnapshotID: string
    goalSnapshotID: string
    version: number
    goalDraft: GoalDraft
    requirements: PersistedRequirement[]
    now: number
  },
) {
  db.insert(OrchestratorGoalSnapshotTable)
    .values({
      id: input.goalSnapshotID,
      task_id: input.taskID,
      spec_snapshot_id: input.specSnapshotID,
      version: input.version,
      status: "ready",
      summary: input.goalDraft.summary,
      metadata: {
        goal_count: input.goalDraft.goals.length,
      },
      time_created: input.now,
      time_updated: input.now,
    })
    .run()

  const requirementIDBySource = new Map(input.requirements.map((item) => [item.sourceRequirementID, item.id]))
  const goalIDBySource = new Map(input.goalDraft.goals.map((goal) => [goal.id, Identifier.ascending("goal")]))

  const goals: GoalRowInput[] = input.goalDraft.goals.map((goal) => {
    const persistedRequirementIDs = goal.requirement_ids
      .map((requirementID) => {
        const next = requirementIDBySource.get(requirementID)
        if (!next) {
          throw new PlannerFailureError(`Goal ${goal.id} references unmapped requirement id: ${requirementID}`)
        }
        return next
      })
    const persistedDependencyIDs = (goal.depends_on_goal_ids ?? []).map((dependencyID) => {
      const next = goalIDBySource.get(dependencyID)
      if (!next) {
        throw new GoalFailureError(`Goal ${goal.id} references unmapped dependency id: ${dependencyID}`)
      }
      return next
    })
    return {
      goalID: goalIDBySource.get(goal.id)!,
      title: goal.title,
      objective: goal.objective,
      done_definition: goal.done_definition,
      owned_paths: goal.owned_paths ?? [],
      depends_on: persistedDependencyIDs,
      exports: goal.exports ?? [],
      imports: goal.imports ?? [],
      kind: goal.kind,
      requirement_ids: persistedRequirementIDs,
      priority: goal.priority as "blocking" | "advisory" | undefined,
      source: goal.source as "spec" | "system" | undefined,
      metadata: {
        goal_snapshot_id: input.goalSnapshotID,
        source_requirement_ids: goal.requirement_ids,
        source_depends_on_goal_ids: goal.depends_on_goal_ids,
        source_goal_id: goal.id,
        qa_profile: goal.qa_profile ? {
          rule_selectors: goal.qa_profile.rule_selectors,
          ...(goal.qa_profile.goal_check_prompt ? { goal_check_prompt: goal.qa_profile.goal_check_prompt } : {}),
          spec_scope: "mapped_requirements",
        } : undefined,
        check_selector: goal.qa_profile?.rule_selectors,
      },
    }
  })

  return insertGoalRows(db, {
    taskID: input.taskID,
    specSnapshotID: input.specSnapshotID,
    goals,
    now: input.now,
  })
}

export function createFixRun(task: TaskRow, run: RunRow, summary: string, fixContext?: FixContext) {
  const strategy = fixContext?.source === "delivery_rejection" ? "fix_from_delivery" : "fix_from_eval"
  const existing = Database.use((db) =>
    db
      .select()
      .from(OrchestratorRunTable)
      .where(and(
        eq(OrchestratorRunTable.task_id, task.id),
        run.plan_version_id
          ? eq(OrchestratorRunTable.plan_version_id, run.plan_version_id)
          : isNull(OrchestratorRunTable.plan_version_id),
        inArray(OrchestratorRunTable.status, ["queued", "accepted", "running", "blocked"]),
      ))
      .orderBy(desc(OrchestratorRunTable.time_created), desc(OrchestratorRunTable.id))
      .all()
      .find((item) => item.metadata?.previous_run_id === run.id && (item.metadata?.strategy === strategy || item.metadata?.strategy === "retry_same_plan")),
  )
  if (existing) return existing.id
  const nextRunID = Identifier.ascending("run")
  const now = Date.now()
  const progressMsg = fixContext?.source === "delivery_rejection"
    ? "Fix run created after delivery rejection"
    : "Fix run created after evaluation failure"
  Database.transaction((db) => {
    const plan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
    if (plan) {
      const failedGoalIDs = listGoalsForPlan(plan)
        .filter((goal) => goal.status === "failed")
        .map((goal) => goal.id)
      if (failedGoalIDs.length > 0) {
        db.update(OrchestratorGoalTable)
          .set({
            status: "pending",
            time_updated: now,
          })
          .where(inArray(OrchestratorGoalTable.id, failedGoalIDs))
          .run()
      }
    }
    db.insert(OrchestratorRunTable)
      .values({
        id: nextRunID,
        task_id: task.id,
        plan_version_id: run.plan_version_id,
        session_id: task.session_id,
        executor: run.executor,
        status: "queued",
        phase: "dispatch",
        retry_count: run.retry_count + 1,
        metadata: {
          previous_run_id: run.id,
          strategy,
          prompt_override: buildFixPrompt(summary, fixContext),
          fix_context: fixContext,
        },
        time_created: now,
        time_updated: now,
      })
      .run()
    db.update(OrchestratorTaskTable)
      .set({
        active_run_id: nextRunID,
        status: "active",
        error: null,
        blocking_reason: null,
        time_completed: null,
        time_updated: now,
      })
      .where(eq(OrchestratorTaskTable.id, task.id))
      .run()
    db.insert(OrchestratorProgressSnapshotTable)
      .values({
        id: Identifier.ascending("progress"),
        task_id: task.id,
        status: "active",
        summary: progressMsg,
        payload: {
          previousRunID: run.id,
          nextRunID,
          reason: summary,
          source: fixContext?.source,
        },
        time_created: now,
        time_updated: now,
      })
      .run()
    Database.effect(() =>
      OrchestratorProtocol.emit(Event.RunCreated, {
        taskID: task.id,
        runID: nextRunID,
        status: "queued",
        summary: progressMsg,
      }, { source: "persist.fix" }),
    )
    Database.effect(() =>
      OrchestratorProtocol.emit(Event.TaskUpdated, {
        taskID: task.id,
        status: "active",
        summary: progressMsg,
      }, { source: "persist.fix" }),
    )
  })
  return nextRunID
}

/** @deprecated Use createFixRun instead */
export const createRetryRun = createFixRun

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
  result: CheckReport
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

// ---------------------------------------------------------------------------
// Legacy compat: insertSpecItems (used by executor-planner flow in service.ts)
// ---------------------------------------------------------------------------

export function insertSpecItems(
  db: Database.TxOrDb,
  input: {
    taskID: string
    specSnapshotID: string
    specItems: unknown[]
    now: number
  },
) {
  for (const raw of input.specItems) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue
    const item = raw as Record<string, unknown>
    if (typeof item.title !== "string" || typeof item.description !== "string") continue
    const checks = Array.isArray(item.check_selector)
      ? item.check_selector.filter((value): value is string => typeof value === "string")
      : undefined
    db.insert(OrchestratorSpecItemTable)
      .values({
        id: Identifier.ascending("specitem"),
        task_id: input.taskID,
        spec_snapshot_id: input.specSnapshotID,
        title: item.title,
        description: item.description,
        status: "pending",
        priority: item.priority === "advisory" ? "advisory" : "blocking",
        check_selector: checks && checks.length > 0 ? checks : null,
        metadata: {},
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
  }
}
