import { Bus } from "@/bus"
import { Database, eq } from "@/storage/db"
import { type EvaluatorAnalysisType } from "@/evaluator/agent"
import {
  OrchestratorGoalTable,
  OrchestratorMilestoneTable,
  type OrchestratorMilestoneStatus,
} from "./orchestrator.sql"
import { Event } from "./model"
import {
  listGoalsByPlan,
  listMilestonesByPlan,
  type GoalRow,
} from "./store"

export function deriveMilestoneStatuses(db: Parameters<Parameters<typeof Database.transaction>[0]>[0], taskID: string, planVersionID: string, now: number) {
  const milestones = listMilestonesByPlan(planVersionID)
  if (milestones.length === 0) return
  const goals = listGoalsByPlan(planVersionID)
  for (const ms of milestones) {
    const msGoals = goals.filter((g) => g.milestone_id === ms.id)
    const next = deriveMilestoneStatus(msGoals)
    if (next === ms.status) continue
    db.update(OrchestratorMilestoneTable)
      .set({ status: next, time_updated: now })
      .where(eq(OrchestratorMilestoneTable.id, ms.id))
      .run()
    if (next === "passed") {
      Database.effect(() => Bus.publish(Event.MilestonePassed, { taskID, milestoneID: ms.id, summary: ms.title }))
    } else if (next === "failed") {
      Database.effect(() => Bus.publish(Event.MilestoneFailed, { taskID, milestoneID: ms.id, summary: ms.title }))
    } else if (next === "active") {
      Database.effect(() => Bus.publish(Event.MilestoneActivated, { taskID, milestoneID: ms.id, summary: ms.title }))
    }
  }
}

export function deriveMilestoneStatus(goals: GoalRow[]): OrchestratorMilestoneStatus {
  if (goals.length === 0) return "passed"
  const blocking = goals.filter((g) => g.priority === "blocking")
  if (blocking.some((g) => g.status === "failed")) return "failed"
  if (blocking.every((g) => g.status === "passed")) return "passed"
  if (goals.some((g) => g.status === "passed")) return "active"
  return "pending"
}

export function fallbackAnalysis(
  result: {
    verdict: "accepted" | "rejected" | "inconclusive"
    summary: string
  },
  goals: GoalRow[],
  checks: Array<{ name: string; status: string; evidence?: string }>,
  message: string,
): EvaluatorAnalysisType {
  const goal_statuses = goals.map((goal, goal_index) => {
    const selectors = selectorList(goal.metadata)
    const relevant = selectors.flatMap((selector) =>
      checks.filter((item) => item.name === selector || item.name.startsWith(`${selector}#`)),
    )

    if (result.verdict === "rejected") {
      if (relevant.some((item) => item.status === "failed")) {
        return {
          goal_index,
          status: "failed" as const,
          evidence: relevant
            .filter((item) => item.status === "failed")
            .map((item) => `${item.name}: ${item.evidence ?? result.summary}`)
            .join("; "),
          reasoning: `Fell back to automated evaluator result because evaluator agent analysis failed: ${message}`,
        }
      }
      return {
        goal_index,
        status: selectors.length > 0 ? "inconclusive" as const : "failed" as const,
        evidence: result.summary,
        reasoning: `Automated checks rejected the delivery, but evaluator agent analysis was unavailable: ${message}`,
      }
    }

    if (selectors.length === 0) {
      return {
        goal_index,
        status: "inconclusive" as const,
        evidence: "No check_selector defined for fallback verification.",
        reasoning: `Automated checks passed, but evaluator agent analysis was unavailable so this goal could not be verified: ${message}`,
      }
    }

    if (relevant.length === 0) {
      return {
        goal_index,
        status: "inconclusive" as const,
        evidence: `Goal selectors [${selectors.join(", ")}] did not match any executed checks.`,
        reasoning: `Automated checks passed, but fallback verification could not match this goal to a concrete check: ${message}`,
      }
    }

    if (relevant.every((item) => item.status === "passed")) {
      return {
        goal_index,
        status: "passed" as const,
        evidence: `All matching checks passed: ${relevant.map((item) => item.name).join(", ")}`,
        reasoning: `Automated checks provided sufficient mechanical evidence for this goal while evaluator agent analysis was unavailable: ${message}`,
      }
    }

    return {
      goal_index,
      status: "inconclusive" as const,
      evidence: `Fallback verification found non-passing checks: ${relevant.map((item) => `${item.name}=${item.status}`).join(", ")}`,
      reasoning: `Evaluator agent analysis was unavailable and fallback verification could not confirm this goal: ${message}`,
    }
  })

  const blockingFailed = goal_statuses.some((item) => item.status === "failed" && goals[item.goal_index]?.priority === "blocking")
  const blockingPending = goal_statuses.some((item) => item.status === "inconclusive" && goals[item.goal_index]?.priority === "blocking")
  const verdict =
    result.verdict === "rejected" || blockingFailed
      ? "rejected"
      : blockingPending
        ? "inconclusive"
        : "accepted"
  const summary =
    verdict === "accepted"
      ? "Automated checks passed and fallback verification covered all blocking goals while evaluator agent analysis was unavailable."
      : verdict === "inconclusive"
        ? `Automated checks passed, but evaluator agent analysis was unavailable and some blocking goals could not be verified: ${message}`
        : `${result.summary} Evaluator agent unavailable: ${message}`
  const reasoning =
    verdict === "accepted"
      ? "Automated evaluator checks passed and every blocking goal had matching passing checks."
      : verdict === "inconclusive"
        ? `Automated checks passed, but at least one blocking goal lacked fallback verification because evaluator agent analysis failed: ${message}`
        : `Fell back to automated evaluator result because evaluator agent analysis failed: ${message}`
  return {
    verdict,
    classification: "evaluation",
    summary,
    goal_statuses: goal_statuses.map((item) => ({
      ...item,
      evidence: item.evidence || summary,
      reasoning: item.reasoning || reasoning,
    })),
    replan_guidance: verdict !== "accepted"
      ? {
          root_cause: `Evaluator agent unavailable: ${message}`,
          what_failed:
            verdict === "inconclusive"
              ? "Blocking goals could not be verified from automated checks alone."
              : result.summary,
          suggested_strategy:
            verdict === "inconclusive"
              ? "Retry evaluation with a working evaluator model or add explicit check selectors for the unresolved blocking goals."
              : "Fix the failing automated checks and retry the current plan.",
          avoid_approaches: [],
        }
      : null,
  }
}

export function selectorList(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return []
  const value = (metadata as Record<string, unknown>).check_selector
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.length > 0)
}

export function selectorsSatisfied(selectors: string[], checks: Array<{ name: string; status: string }>) {
  const relevant = selectors.filter((selector) =>
    checks.some((check) => check.name === selector || check.name.startsWith(`${selector}#`)),
  )
  if (relevant.length === 0) return true
  return relevant.every((selector) =>
    checks.some(
      (check) =>
        (check.name === selector || check.name.startsWith(`${selector}#`)) && check.status === "passed",
    ),
  )
}

export async function failGoals(run: { plan_version_id?: string | null; task_id: string }, summary: string) {
  const planVersionID = run.plan_version_id
  if (!planVersionID) return
  const goals = listGoalsByPlan(planVersionID)
  if (goals.length === 0) return
  const now = Date.now()
  Database.use((db) =>
    db
      .update(OrchestratorGoalTable)
      .set({
        status: "failed",
        time_updated: now,
      })
      .where(eq(OrchestratorGoalTable.plan_version_id, planVersionID))
      .run(),
  )
  for (const goal of goals) {
    await Bus.publish(Event.GoalFailed, {
      taskID: run.task_id,
      goalID: goal.id,
      summary: `${goal.description}: ${summary}`,
    })
  }
}
