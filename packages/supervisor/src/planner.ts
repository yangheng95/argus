import { ulid } from "ulid"
import { type Goal, type Phase, type Preference, now } from "./schema"

function prefs(input: Preference[]) {
  if (input.length === 0) return "- none recorded"
  return input.map((item) => `- ${item.label}: ${item.value}`).join("\n")
}

export function seed(goalId: string) {
  return [
    phase(goalId, {
      kind: "plan",
      title: "Scope the goal",
      agent: "plan",
      position: 0,
    }),
    phase(goalId, {
      kind: "execute",
      title: "Implement the goal",
      agent: "build",
      position: 1,
    }),
    phase(goalId, {
      kind: "verify",
      title: "Verify the goal",
      agent: "plan",
      position: 2,
    }),
  ]
}

export function repair(goalId: string, position: number, note: string) {
  return [
    phase(goalId, {
      kind: "execute",
      title: "Close the remaining gap",
      agent: "build",
      position,
      note,
    }),
    phase(goalId, {
      kind: "verify",
      title: "Re-verify the goal",
      agent: "plan",
      position: position + 1,
      note,
    }),
  ]
}

function phase(
  goalId: string,
  input: Pick<Phase, "kind" | "title" | "agent" | "position"> & { note?: string },
): Phase {
  const time = now()
  return {
    id: ulid(),
    goalId,
    kind: input.kind,
    title: input.title,
    agent: input.agent,
    status: "pending",
    position: input.position,
    note: input.note,
    createdAt: time,
    updatedAt: time,
  }
}

export function prompt(goal: Goal, phase: Phase, input: Preference[]) {
  const common = [
    `Goal title: ${goal.title}`,
    "",
    "User request:",
    goal.request,
    "",
    "Acceptance criteria:",
    goal.acceptance,
    "",
    "Recorded preferences:",
    prefs(input),
  ]
  const gap = phase.note ? ["", "Remaining gap from the previous verification:", phase.note] : []

  if (phase.kind === "plan") {
    return [
      "You are the planning agent for a goal-driven engineering loop.",
      ...common,
      ...gap,
      "",
      "Create a concise execution plan for the implementation agent.",
      "Return plain text with these sections:",
      "<phase_summary>...</phase_summary>",
      "<next_actions>...</next_actions>",
      "<risks>...</risks>",
    ].join("\n")
  }

  if (phase.kind === "execute") {
    return [
      "You are the implementation agent for a goal-driven engineering loop.",
      ...common,
      ...gap,
      "",
      "Make the necessary changes in the current workspace.",
      "Use the recorded preferences when making naming, structure, or tooling decisions.",
      "Return plain text with these sections:",
      "<phase_summary>...</phase_summary>",
      "<changes>...</changes>",
      "<open_questions>...</open_questions>",
    ].join("\n")
  }

  return [
    "You are the verification agent for a goal-driven engineering loop.",
    ...common,
    ...gap,
    "",
    "Review the current workspace and the session history.",
    "Decide whether the goal is complete right now.",
    "Return plain text with these exact sections:",
    "<goal_status>done|continue</goal_status>",
    "<summary>...</summary>",
    "<next_step>...</next_step>",
    "<evidence>...</evidence>",
  ].join("\n")
}

export function parseVerify(text: string) {
  const status = pick(text, "goal_status")
  const summary = pick(text, "summary")
  const nextStep = pick(text, "next_step")
  const done = status === "done"
  return {
    done,
    summary: summary || nextStep || "Verification requested another round.",
    nextStep: nextStep || summary || "Close the remaining gap and verify again.",
  }
}

function pick(text: string, tag: string) {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"))
  return match?.[1]?.trim()
}
