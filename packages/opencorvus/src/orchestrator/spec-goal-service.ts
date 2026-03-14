import { taskNotes } from "@/workbench/preference"
import { listGoalsBySpec, type TaskRow } from "./store"

function noteText(input: string) {
  return input.trim().replace(/\s+/g, " ")
}

function goalCriteria(description: string) {
  return `The rewritten specification explicitly captures this operator goal and the delivered implementation satisfies it: ${description}`
}

export function buildSpecReplanInput(task: TaskRow, specSnapshotID: string) {
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
  const existing = new Set(current.map((goal) => noteText(goal.description).toLowerCase()))
  const goals = [
    ...current.map((goal) => ({
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
    ? task.request
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
      ].filter(Boolean).join("\n\n")
  return {
    request,
    constraints,
    goals,
    goalUpdates,
    planHints,
  }
}
