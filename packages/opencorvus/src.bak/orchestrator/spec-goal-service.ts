import type { GoalJudgmentType } from "@/evaluator/agent"
import { taskNotes } from "@/workbench/note-store"
import { listGoalsForPlan, type PlanRow, type TaskRow } from "./store"

function noteText(input: string) {
  return input.trim().replace(/\s+/g, " ")
}

function passedGoalIndices(analysis?: GoalJudgmentType) {
  return new Set(
    (Array.isArray(analysis?.goal_statuses) ? analysis.goal_statuses : [])
      .flatMap((item) => item.status === "passed" ? [item.goal_index] : []),
  )
}

export function buildSpecReplanInput(task: TaskRow, plan: Pick<PlanRow, "id" | "spec_snapshot_id" | "metadata">, analysis?: GoalJudgmentType) {
  const notes = taskNotes(task.id, 24)
  const constraints = [...new Set(
    notes
      .filter((note) => note.kind === "constraint")
      .map((note) => noteText(note.content))
      .filter(Boolean),
  )]
  const goalUpdates = [...new Set(
    notes
      .filter((note) => note.kind === "goal_update")
      .map((note) => noteText(note.content))
      .filter(Boolean),
  )]
  const planHints = [...new Set(
    notes
      .filter((note) => note.kind === "plan_hint")
      .map((note) => noteText(note.content))
      .filter(Boolean),
  )]
  const current = listGoalsForPlan(plan)
  const passed = passedGoalIndices(analysis)
  const remaining = current.filter((_, index) => !passed.has(index))
  const active = remaining.length > 0 ? remaining : current
  const goals = active.map((goal) => ({
    description: goal.description,
    criteria: goal.criteria,
    priority: goal.priority,
    metadata: goal.metadata ?? undefined,
  }))
  const request = goalUpdates.length === 0 && planHints.length === 0 && constraints.length === 0
    ? [
        task.request,
        passed.size > 0
          ? [
              "Goals already satisfied in previous runs. Preserve their implementation and do not expand them again in this replan:",
              ...current
                .flatMap((goal, index) => passed.has(index) ? [`- ${goal.description}`] : []),
            ].join("\n")
          : "",
        remaining.length > 0 && remaining.length < current.length
          ? [
              "Focus this replan on the remaining unresolved goals:",
              ...remaining.map((goal) => `- ${goal.description}`),
            ].join("\n")
          : "",
      ].filter(Boolean).join("\n\n")
    : [
        task.request,
        constraints.length > 0
          ? [
              "Operator requirements and constraints for the next replan:",
              ...constraints.map((item) => `- ${item}`),
            ].join("\n")
          : "",
        goalUpdates.length > 0
          ? [
              "Operator goal notes for the next replan:",
              ...goalUpdates.map((goal) => `- ${goal}`),
            ].join("\n")
          : "",
        planHints.length > 0
          ? [
              "Operator planning hints for the next plan version:",
              ...planHints.map((hint) => `- ${hint}`),
            ].join("\n")
          : "",
        passed.size > 0
          ? [
              "Goals already satisfied in previous runs. Preserve their implementation and do not expand them again in this replan:",
              ...current
                .flatMap((goal, index) => passed.has(index) ? [`- ${goal.description}`] : []),
            ].join("\n")
          : "",
        remaining.length > 0 && remaining.length < current.length
          ? [
              "Focus this replan on the remaining unresolved goals:",
              ...remaining.map((goal) => `- ${goal.description}`),
            ].join("\n")
          : "",
      ].filter(Boolean).join("\n\n")
  return {
    request,
    constraints,
    goals,
    goalUpdates,
    planHints,
    rewriteSpec: constraints.length > 0 || goalUpdates.length > 0,
  }
}
