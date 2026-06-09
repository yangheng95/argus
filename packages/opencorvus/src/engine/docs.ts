import { mkdirSync, writeFileSync } from "fs"
import path from "path"
import type { GoalJudgmentType } from "@/acceptance/checks"
import { Instance } from "@/project/instance"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { renderSpecsAsText } from "@/acceptance/types"
import type { EvaluationRow, GoalRow, MilestoneRow, PlanRow, RunRow, TaskRow } from "./store"
import type { EvaluationCheck } from "./model"
import type z from "zod"

const log = Log.create({ service: "engine.docs" })

// Evaluation grouping — inlined (sole consumer of the former evaluation-group.ts).
type GroupCheck = z.infer<typeof EvaluationCheck>

function checkBase(name: string) {
  return name.replace(/#\d+$/, "")
}

function groupStatus(checks: GroupCheck[]) {
  if (checks.some((check) => check.status === "failed")) return "failed" as const
  if (checks.some((check) => check.status === "passed")) return "passed" as const
  return "skipped" as const
}

const EVALUATION_GROUP_DEFS = [
  {
    id: "rules",
    label: "Rule Checks",
    include: (check: GroupCheck) => {
      const base = checkBase(check.name)
      return base !== "goal_check" && base !== "spec_check"
    },
  },
  {
    id: "goal_acceptance",
    label: "Goal Acceptance",
    include: (check: GroupCheck) => checkBase(check.name) === "goal_check",
  },
  {
    id: "spec_acceptance",
    label: "Spec Acceptance",
    include: (check: GroupCheck) => checkBase(check.name) === "spec_check",
  },
] as const

function evaluationGroups(checks: GroupCheck[]) {
  return EVALUATION_GROUP_DEFS.flatMap((group) => {
    const matches = checks.filter(group.include)
    if (matches.length === 0) return []
    return [
      {
        id: group.id,
        label: group.label,
        status: groupStatus(matches),
        checks: matches.map((check) => check.name),
      },
    ]
  })
}

type Check = {
  name: string
  status: "passed" | "failed" | "skipped" | "inconclusive"
  evidence?: string
  label?: string
  family?: string
}

function text(input: unknown) {
  return typeof input === "string" ? input.trim() : ""
}

function list(input: unknown) {
  if (!Array.isArray(input)) return []
  return input.flatMap((item) => {
    const value = text(item)
    return value ? [value] : []
  })
}

function indent(block: string, spaces: number): string {
  const prefix = " ".repeat(spaces)
  return block
    .split("\n")
    .map((line) => (line ? prefix + line : line))
    .join("\n")
}

function obj(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return
  return input as Record<string, unknown>
}

function stamp(input: number) {
  return new Date(input).toISOString().replace(/[:.]/g, "-")
}

function iso(input: number) {
  return new Date(input).toISOString()
}

function slug(input: string) {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "task"
  )
}

function save(input: {
  kind: "prds" | "plans" | "goals" | "evaluations"
  taskID: string
  ref: string
  title: string
  createdAt: number
  content: string
}) {
  try {
    const dir = ProjectRuntimePaths.docsPaths(Instance.worktree, input.taskID)[input.kind]
    const file = path.join(
      dir,
      `${stamp(input.createdAt)}-${Identifier.shortPath(input.taskID)}-${input.ref}-${slug(input.title)}.md`,
    )
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, input.content.trimEnd() + "\n", "utf-8")
    return {
      file,
      created_at: input.createdAt,
    }
  } catch (error) {
    log.warn("failed to write doc snapshot", { kind: input.kind, taskID: input.taskID, error })
    return undefined
  }
}

function selectors(input?: Record<string, unknown> | null) {
  if (!Array.isArray(input?.check_selector)) return []
  return input.check_selector.flatMap((item) => {
    const value = text(item)
    return value ? [value] : []
  })
}

function evaluationText(input: {
  task: Pick<TaskRow, "id" | "title" | "request">
  run: Pick<RunRow, "id" | "plan_version_id">
  goalRunID?: string
  evaluation: Pick<EvaluationRow, "id" | "status" | "verdict" | "summary"> & { checks: Check[] }
  goals: GoalRow[]
  analysis?: GoalJudgmentType
  acceptance?: {
    summary: string
    diffs: Array<{ file: string }>
  }
  createdAt: number
}) {
  const lines = [
    input.goalRunID ? "# Goal Run Evaluation Snapshot" : "# Coordinator Evaluation Snapshot",
    "",
    `- Task: ${input.task.title}`,
    `- Task ID: ${input.task.id}`,
    `- Run ID: ${input.run.id}`,
    ...(input.goalRunID ? [`- Goal Run ID: ${input.goalRunID}`] : []),
    `- Evaluation ID: ${input.evaluation.id}`,
    `- Status: ${input.evaluation.status}`,
    `- Verdict: ${input.evaluation.verdict}`,
    `- Generated At: ${iso(input.createdAt)}`,
    "",
    "## Request",
    "",
    input.task.request.trim(),
    "",
    "## Summary",
    "",
    input.evaluation.summary.trim(),
  ]

  if (input.analysis) {
    lines.push("", "## Analysis", "", `- Classification: ${input.analysis.classification}`)
    const agentSummary = text(input.analysis.summary)
    if (agentSummary && agentSummary !== input.evaluation.summary.trim()) {
      lines.push(`- Agent Summary: ${agentSummary}`)
    }
  }

  if (input.acceptance) {
    lines.push("", "## Acceptance", "", `- Summary: ${input.acceptance.summary}`)
    if (input.acceptance.diffs.length > 0) {
      lines.push("- Changed Files:")
      lines.push(...input.acceptance.diffs.map((item) => `  - ${item.file}`))
    }
  }

  if (input.evaluation.checks.length === 0) {
    lines.push("", "## Checks", "")
    lines.push("- No checks recorded.")
  } else {
    const groups = evaluationGroups(input.evaluation.checks)
    if (groups.length > 0) {
      lines.push("", "## QA Groups", "")
      for (const group of groups) {
        lines.push(`- [${group.status}] ${group.label}: ${group.checks.join(", ")}`)
      }
    }
    lines.push("", "## Checks", "")
    for (const check of input.evaluation.checks) {
      const label = check.label || check.name
      const family = text(check.family)
      const suffix = family ? ` (${family})` : ""
      lines.push(`- [${check.status}] ${label}${suffix}`)
      if (text(check.evidence)) lines.push(`  - Evidence: ${text(check.evidence)}`)
    }
  }

  const statuses = input.analysis?.goal_statuses ?? []
  if (statuses.length > 0) {
    lines.push("", "## Goal Assessment", "")
    for (const item of statuses) {
      const goal = input.goals[item.goal_index]
      lines.push(`- [${item.status}] ${goal?.title || `Goal ${item.goal_index + 1}`}`)
      if (goal?.acceptance_specs && goal.acceptance_specs.length > 0) {
        lines.push(`  - Acceptance:\n${indent(renderSpecsAsText(goal.acceptance_specs), 4)}`)
      }
      if (text(item.evidence)) lines.push(`  - Evidence: ${item.evidence}`)
      if (text(item.reasoning)) lines.push(`  - Reasoning: ${item.reasoning}`)
    }
  }

  if (input.analysis?.replan_guidance) {
    lines.push(
      "",
      "## Replan Guidance",
      "",
      `- Root Cause: ${input.analysis.replan_guidance.root_cause}`,
      `- What Failed: ${input.analysis.replan_guidance.what_failed}`,
      `- Suggested Strategy: ${input.analysis.replan_guidance.suggested_strategy}`,
    )
    if (input.analysis.replan_guidance.avoid_approaches.length > 0) {
      lines.push("- Avoid Approaches:")
      lines.push(...input.analysis.replan_guidance.avoid_approaches.map((item) => `  - ${item}`))
    }
  }

  return lines.join("\n")
}

export function writeEvaluationSnapshot(input: {
  task: Pick<TaskRow, "id" | "title" | "request">
  run: Pick<RunRow, "id" | "plan_version_id">
  goalRunID?: string
  evaluation: Pick<EvaluationRow, "id" | "status" | "verdict" | "summary"> & { checks: Check[] }
  goals: GoalRow[]
  analysis?: GoalJudgmentType
  acceptance?: {
    summary: string
    diffs: Array<{ file: string }>
  }
  createdAt: number
}) {
  return save({
    kind: "evaluations",
    taskID: input.task.id,
    ref: input.goalRunID ? `goal-run-eval-${input.goalRunID}` : `coordinator-eval-${input.evaluation.id}`,
    title: input.task.title,
    createdAt: input.createdAt,
    content: evaluationText(input),
  })
}
