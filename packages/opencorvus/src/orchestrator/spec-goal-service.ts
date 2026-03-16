import type { GoalJudgmentType } from "@/evaluator/agent"
import { taskNotes } from "@/workbench/preference"
import { listGoalsBySpec, type TaskRow } from "./store"

function noteText(input: string) {
  return input.trim().replace(/\s+/g, " ")
}

function goalCriteria(description: string) {
  return `The rewritten specification explicitly captures this operator goal and the delivered implementation satisfies it: ${description}`
}

function passedGoalIndices(analysis?: GoalJudgmentType) {
  return new Set(
    (Array.isArray(analysis?.goal_statuses) ? analysis.goal_statuses : [])
      .flatMap((item) => item.status === "passed" ? [item.goal_index] : []),
  )
}

export function buildSpecReplanInput(task: TaskRow, specSnapshotID: string, analysis?: GoalJudgmentType) {
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
  const current = listGoalsBySpec(specSnapshotID)
  const passed = passedGoalIndices(analysis)
  const remaining = current.filter((_, index) => !passed.has(index))
  const active = remaining.length > 0 ? remaining : current
  const existing = new Set(current.map((goal) => noteText(goal.description).toLowerCase()))
  const goals = [
    ...active.map((goal) => ({
      description: goal.description,
      criteria: goal.criteria,
      priority: goal.priority,
      metadata: goal.metadata ?? undefined,
    })),
    ...goalUpdates.flatMap((goal) =>
      existing.has(goal.toLowerCase())
        ? []
        : [{
            description: goal,
            criteria: goalCriteria(goal),
            priority: "blocking" as const,
            metadata: {
              check_selector: ["spec_check"],
            },
          }],
    ),
  ]
  const request = goalUpdates.length === 0 && planHints.length === 0 && constraints.length === 0
    ? [
        task.request,
        passed.size > 0
          ? [
              "Goals already satisfied in previous runs. Preserve their implementation and do not expand them again in this rewrite:",
              ...current
                .flatMap((goal, index) => passed.has(index) ? [`- ${goal.description}`] : []),
            ].join("\n")
          : "",
        remaining.length > 0 && remaining.length < current.length
          ? [
              "Focus this rewrite on the remaining unresolved goals:",
              ...remaining.map((goal) => `- ${goal.description}`),
            ].join("\n")
          : "",
      ].filter(Boolean).join("\n\n")
    : [
        task.request,
        constraints.length > 0
          ? [
              "Operator requirement and spec updates for the next spec rewrite:",
              ...constraints.map((item) => `- ${item}`),
            ].join("\n")
          : "",
        goalUpdates.length > 0
          ? [
              "Operator goal updates for the next spec rewrite:",
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
              "Goals already satisfied in previous runs. Preserve their implementation and do not expand them again in this rewrite:",
              ...current
                .flatMap((goal, index) => passed.has(index) ? [`- ${goal.description}`] : []),
            ].join("\n")
          : "",
        remaining.length > 0 && remaining.length < current.length
          ? [
              "Focus this rewrite on the remaining unresolved goals:",
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
  }
}
