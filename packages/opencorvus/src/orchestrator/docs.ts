import { mkdirSync, writeFileSync } from "fs"
import path from "path"
import type { GoalJudgmentType } from "@/evaluator/types"
import { evaluationGroups } from "@/orchestrator/evaluation-group"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import type { EvaluationRow, GoalRow, MilestoneRow, PlanRow, RunRow, TaskRow } from "./store"

const log = Log.create({ service: "orchestrator.docs" })

type Check = {
  name: string
  status: "passed" | "failed" | "skipped"
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
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "task"
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
    const dir = path.join(Instance.worktree, ".opencorvus", input.kind)
    const file = path.join(dir, `${stamp(input.createdAt)}-${input.taskID}-${input.ref}-${slug(input.title)}.md`)
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

function counts(goals: GoalRow[]) {
  return {
    total: goals.length,
    passed: goals.filter((item) => item.status === "passed").length,
    failed: goals.filter((item) => item.status === "failed").length,
    pending: goals.filter((item) => item.status === "pending").length,
  }
}

function goalText(input: {
  task: Pick<TaskRow, "id" | "title" | "request">
  plan: Pick<PlanRow, "id" | "version" | "summary">
  goals: GoalRow[]
  milestones: MilestoneRow[]
  createdAt: number
}) {
  const summary = counts(input.goals)
  const lines = [
    "# Goal Snapshot",
    "",
    `- Task: ${input.task.title}`,
    `- Task ID: ${input.task.id}`,
    `- Plan ID: ${input.plan.id}`,
    `- Plan Version: v${input.plan.version}`,
    `- Snapshot At: ${iso(input.createdAt)}`,
    `- Total Goals: ${summary.total}`,
    `- Passed: ${summary.passed}`,
    `- Failed: ${summary.failed}`,
    `- Pending: ${summary.pending}`,
    "",
    "## Plan Summary",
    "",
    input.plan.summary.trim(),
    "",
    "## Goals",
    "",
  ]

  if (input.goals.length === 0) {
    lines.push("- No goals recorded.")
    return lines.join("\n")
  }

  for (const [index, goal] of input.goals.entries()) {
    const meta = obj(goal.metadata)
    const checks = selectors(meta)
    const origin = text(meta?.origin)
    lines.push(`${index + 1}. [${goal.status}] [${goal.priority}] ${goal.title}`)
    lines.push(`   - Done Definition: ${goal.done_definition}`)
    if (checks.length > 0) lines.push(`   - Checks: ${checks.join(", ")}`)
    if (origin) lines.push(`   - Origin: ${origin}`)
  }

  return lines.join("\n")
}

function evaluationText(input: {
  task: Pick<TaskRow, "id" | "title" | "request">
  run: Pick<RunRow, "id" | "plan_version_id">
  goalRunID?: string
  evaluation: Pick<EvaluationRow, "id" | "status" | "verdict" | "summary"> & { checks: Check[] }
  goals: GoalRow[]
  analysis?: GoalJudgmentType
  delivery?: {
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

  if (input.delivery) {
    lines.push("", "## Delivery", "", `- Summary: ${input.delivery.summary}`)
    if (input.delivery.diffs.length > 0) {
      lines.push("- Changed Files:")
      lines.push(...input.delivery.diffs.map((item) => `  - ${item.file}`))
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
      if (goal?.done_definition) lines.push(`  - Done Definition: ${goal.done_definition}`)
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

export function writeGoalSnapshot(input: {
  task: Pick<TaskRow, "id" | "title" | "request">
  plan: Pick<PlanRow, "id" | "version" | "summary">
  goals: GoalRow[]
  milestones: MilestoneRow[]
  createdAt: number
}) {
  return save({
    kind: "goals",
    taskID: input.task.id,
    ref: `goal-snapshot-v${input.plan.version}`,
    title: input.task.title,
    createdAt: input.createdAt,
    content: goalText(input),
  })
}

export function writeEvaluationSnapshot(input: {
  task: Pick<TaskRow, "id" | "title" | "request">
  run: Pick<RunRow, "id" | "plan_version_id">
  goalRunID?: string
  evaluation: Pick<EvaluationRow, "id" | "status" | "verdict" | "summary"> & { checks: Check[] }
  goals: GoalRow[]
  analysis?: GoalJudgmentType
  delivery?: {
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
