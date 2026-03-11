import { mkdirSync, writeFileSync } from "fs"
import path from "path"
import type { EvaluatorAnalysisType } from "@/evaluator/agent"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import type { EvaluationRow, GoalRow, MilestoneRow, PlanRow, RunRow, TaskRow } from "./store"

const log = Log.create({ service: "orchestrator.docs" })

type Check = {
  name: string
  status: string
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

function assumptions(input: unknown) {
  if (!Array.isArray(input)) return []
  return input.flatMap((item) => {
    const value = obj(item)
    const question = text(value?.question)
    const assumption = text(value?.assumption)
    return question && assumption ? [{ question, assumption }] : []
  })
}

function questions(input: unknown) {
  if (!Array.isArray(input)) return []
  return input.flatMap((item) => {
    const value = obj(item)
    const question = text(value?.question)
    const context = text(value?.context)
    const defaultAssumption = text(value?.default_assumption)
    return question
      ? [{
          question,
          context,
          defaultAssumption,
        }]
      : []
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

function prdText(input: {
  task: Pick<TaskRow, "id" | "title" | "request">
  plan: Pick<PlanRow, "id" | "version" | "summary" | "metadata">
  createdAt: number
}) {
  const meta = obj(input.plan.metadata)
  const spec = obj(meta?.spec)
  const specFile = text(spec?.file)
  const specSummary = text(spec?.summary) || input.plan.summary.trim()
  const specAnalysis = obj(meta?.spec_analysis)
  const expanded = text(specAnalysis?.expanded_spec)
  const riskItems = list(specAnalysis?.risk_areas)
  const assumptionItems = assumptions(specAnalysis?.assumptions)
  const questionItems = questions(specAnalysis?.questions)
  const goalItems = Array.isArray(specAnalysis?.goals) ? specAnalysis.goals : []
  const lines = [
    "# PRD",
    "",
    `- Task: ${input.task.title}`,
    `- Task ID: ${input.task.id}`,
    `- Plan ID: ${input.plan.id}`,
    `- Plan Version: v${input.plan.version}`,
    `- Generated At: ${iso(input.createdAt)}`,
    "",
    "## Request",
    "",
    input.task.request.trim(),
    "",
    "## Summary",
    "",
    specSummary || "_No PRD summary recorded._",
  ]

  if (specFile) {
    lines.push("", "## Source Spec File", "", specFile)
  }

  lines.push("", "## Content", "", expanded || "_No PRD content recorded._")

  if (goalItems.length > 0) {
    lines.push("", "## Goal Draft", "")
    for (const [index, item] of goalItems.entries()) {
      const value = obj(item)
      const description = text(value?.description)
      const criteria = text(value?.criteria)
      const priority = text(value?.priority) || "blocking"
      if (!description) continue
      lines.push(`${index + 1}. [${priority}] ${description}`)
      if (criteria) lines.push(`   - Criteria: ${criteria}`)
    }
  }

  if (assumptionItems.length > 0) {
    lines.push("", "## Assumptions", "", ...assumptionItems.map((item, index) => `${index + 1}. ${item.question}\n   - ${item.assumption}`))
  }

  if (questionItems.length > 0) {
    lines.push("", "## Open Questions", "")
    for (const [index, item] of questionItems.entries()) {
      lines.push(`${index + 1}. ${item.question}`)
      if (item.context) lines.push(`   - Context: ${item.context}`)
      if (item.defaultAssumption) lines.push(`   - Default: ${item.defaultAssumption}`)
    }
  }

  if (riskItems.length > 0) {
    lines.push("", "## Risk Areas", "", ...riskItems.map((item) => `- ${item}`))
  }

  return lines.join("\n")
}

function planText(input: {
  task: Pick<TaskRow, "id" | "title" | "request">
  plan: Pick<PlanRow, "id" | "version" | "summary" | "prompt" | "metadata">
  createdAt: number
}) {
  const meta = obj(input.plan.metadata)
  const spec = obj(meta?.spec)
  const specFile = text(spec?.file)
  const specSummary = text(spec?.summary)
  const strategy = text(meta?.strategy)
  const steps = list(meta?.steps)
  const risks = [...new Set(list(meta?.risks))]
  const milestoneItems = Array.isArray(meta?.milestones) ? meta?.milestones : []
  const clarification = obj(meta?.clarification)
  const clarificationQuestions = Array.isArray(clarification?.questions) ? clarification.questions : []
  const specAnalysis = obj(meta?.spec_analysis)
  const assumptionItems = assumptions(specAnalysis?.assumptions)
  const lines = [
    "# Plan Graph Snapshot",
    "",
    `- Task: ${input.task.title}`,
    `- Task ID: ${input.task.id}`,
    `- Plan ID: ${input.plan.id}`,
    `- Version: v${input.plan.version}`,
    `- Generated At: ${iso(input.createdAt)}`,
  ]

  if (strategy) lines.push(`- Strategy: ${strategy}`)

  lines.push("", "## Request", "", input.task.request.trim(), "", "## Summary", "", input.plan.summary.trim())

  if (specSummary || specFile) {
    lines.push("", "## PRD", "")
    if (specSummary) lines.push(`- Summary: ${specSummary}`)
    if (specFile) lines.push(`- File: ${specFile}`)
  }

  if (steps.length > 0) {
    lines.push("", "## Steps", "", ...steps.map((item, index) => `${index + 1}. ${item}`))
  }

  if (milestoneItems.length > 0) {
    lines.push("", "## Milestones", "")
    for (const item of milestoneItems) {
      const value = obj(item)
      const title = text(value?.title)
      const description = text(value?.description)
      if (!title) continue
      lines.push(`- ${title}`)
      if (description) lines.push(`  ${description}`)
    }
  }

  if (risks.length > 0) {
    lines.push("", "## Risks", "", ...risks.map((item) => `- ${item}`))
  }

  if (assumptionItems.length > 0) {
    lines.push("", "## Assumptions", "", ...assumptionItems.map((item, index) => `${index + 1}. ${item.question}\n   - ${item.assumption}`))
  }

  if (clarificationQuestions.length > 0) {
    lines.push("", "## Clarification", "")
    const reason = text(clarification?.reason)
    if (reason) lines.push(`- Reason: ${reason}`)
    for (const [index, item] of clarificationQuestions.entries()) {
      const value = obj(item)
      const question = text(value?.question)
      const context = text(value?.context)
      const defaultAssumption = text(value?.default_assumption)
      if (!question) continue
      lines.push(`${index + 1}. ${question}`)
      if (context) lines.push(`   - Context: ${context}`)
      if (defaultAssumption) lines.push(`   - Default: ${defaultAssumption}`)
    }
  }

  lines.push("", "## Execution Prompt", "", "````text", input.plan.prompt.trim(), "````")
  return lines.join("\n")
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
    "# Spec Goals Snapshot",
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
    lines.push(`${index + 1}. [${goal.status}] [${goal.priority}] ${goal.description}`)
    lines.push(`   - Criteria: ${goal.criteria}`)
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
  analysis?: EvaluatorAnalysisType
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

  lines.push("", "## Checks", "")
  if (input.evaluation.checks.length === 0) {
    lines.push("- No checks recorded.")
  } else {
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
      lines.push(`- [${item.status}] ${goal?.description || `Goal ${item.goal_index + 1}`}`)
      if (goal?.criteria) lines.push(`  - Criteria: ${goal.criteria}`)
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

export function docStamp(input: number) {
  return stamp(input)
}

export function writePrdSnapshot(input: {
  task: Pick<TaskRow, "id" | "title" | "request">
  plan: Pick<PlanRow, "id" | "version" | "summary" | "metadata">
  createdAt: number
}) {
  return save({
    kind: "prds",
    taskID: input.task.id,
    ref: `prd-v${input.plan.version}`,
    title: input.task.title,
    createdAt: input.createdAt,
    content: prdText(input),
  })
}

export function writePlanSnapshot(input: {
  task: Pick<TaskRow, "id" | "title" | "request">
  plan: Pick<PlanRow, "id" | "version" | "summary" | "prompt" | "metadata">
  createdAt: number
}) {
  return save({
    kind: "plans",
    taskID: input.task.id,
    ref: `plan-graph-v${input.plan.version}`,
    title: input.task.title,
    createdAt: input.createdAt,
    content: planText(input),
  })
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
    ref: `spec-goals-v${input.plan.version}`,
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
  analysis?: EvaluatorAnalysisType
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
