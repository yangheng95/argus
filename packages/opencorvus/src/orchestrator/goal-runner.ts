import fs from "fs/promises"
import path from "path"
import { Global } from "@/global"
import { git } from "@/util/git"
import { Filesystem } from "@/util/filesystem"
import { selectorList } from "@/check/policy"
import { EvaluatorService } from "@/evaluator/service"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Session } from "@/session"
import { Snapshot } from "@/snapshot"
import { type EvaluationOutput } from "@/evaluator/shared"
import { type EvaluatorAnalysisType } from "@/evaluator/agent"
import z from "zod"
import { type TaskRow, type GoalRow, type PlanRow, type GoalRunRow } from "./store"

function dict(input: unknown) {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
}

function summary(prefix: string, files: string[]) {
  if (files.length === 0) return `${prefix}. No file changes were detected.`
  const sample = files.slice(0, 3).join(", ")
  return files.length <= 3
    ? `${prefix}. Changed files: ${sample}.`
    : `${prefix}. Changed files: ${sample} and ${files.length - 3} more.`
}

function localSelectors(goal: GoalRow) {
  return selectorList(goal.metadata).filter((item) => item !== "spec_check")
}

function analysisFailure(
  result: EvaluationOutput,
  goals: Array<{ description: string; criteria: string; priority: GoalRow["priority"] }>,
  message: string,
): EvaluatorAnalysisType {
  const summary = `Evaluator agent analysis failed: ${message}`
  return {
    verdict: "rejected",
    classification: "environment",
    summary,
    goal_statuses: goals.map((goal, goal_index) => ({
      goal_index,
      status: "failed",
      evidence: result.summary,
      reasoning: summary,
    })),
    replan_guidance: {
      root_cause: summary,
      what_failed: result.summary,
      suggested_strategy: "Retry evaluation after restoring evaluator analysis, or continue with a revised execution plan.",
      avoid_approaches: [],
    },
  }
}

function goalChecks(goal: GoalRow, task: TaskRow) {
  const selectors = localSelectors(goal)
  const base = dict(task.metadata?.checks)
  const next: Record<string, unknown> = {
    ...base,
    spec_check: { enabled: false, mode: "strict" },
    build: selectors.includes("build") ? base.build : false,
    test: selectors.includes("test") ? base.test : false,
    lint: selectors.includes("lint") ? base.lint : false,
    verify_cmd: selectors.includes("verify_cmd") ? base.verify_cmd : false,
  }
  if (selectors.includes("startup")) next.startup = { enabled: true, mode: "strict" }
  if (selectors.includes("ui_review")) next.ui_review = { enabled: true, mode: "strict" }
  if (selectors.includes("code_quality")) next.code_quality = { enabled: true, mode: "strict" }
  if (selectors.includes("code_review")) next.code_review = { enabled: true, mode: "strict" }
  if (selectors.includes("dead_code_review")) next.dead_code_review = { enabled: true, mode: "strict" }
  return next
}

export async function createGoalWorkspace(input: {
  task: TaskRow
  goal: GoalRow
  snapshot: string | undefined
}) {
  if (!input.snapshot || Instance.project.vcs !== "git") return Instance.directory
  const directory = path.join(
    Global.Path.data,
    "goal-workspace",
    Instance.project.id,
    input.task.id,
    `${Date.now()}-${input.goal.id}`,
  )
  await fs.mkdir(path.dirname(directory), { recursive: true })
  const created = await git(["worktree", "add", "--force", "--detach", "--no-checkout", directory], {
    cwd: Instance.worktree,
  })
  if (created.exitCode !== 0) {
    const detail = [created.stderr.toString().trim(), created.stdout.toString().trim()].filter(Boolean).join("\n")
    throw new Error(detail || `Failed to create goal workspace for ${input.goal.id}`)
  }
  await Project.addSandbox(Instance.project.id, directory).catch(() => undefined)
  await Instance.provide({
    directory,
    fn: async () => {
      await Snapshot.restore(input.snapshot!)
    },
  })
  return directory
}

export async function createGoalSession(task: TaskRow, goal: GoalRow, directory?: string) {
  const session = await Session.create({
    parentID: task.session_id ?? undefined,
    title: `${task.title}: ${goal.description}`,
    directory,
  })
  const parent = task.session_id ? await Session.get(task.session_id) : undefined
  if (parent?.permission) {
    await Session.setPermission({
      sessionID: session.id,
      permission: parent.permission,
    })
  }
  return session
}

export function buildGoalPrompt(input: {
  brief: string
  plan: PlanRow
  goal: GoalRow
}) {
  return [
    input.brief,
    "You are executing a single goal for the coordinator. Treat the goal contract below as the only implementation target for this run.",
    `Goal:\n${input.goal.description}`,
    `Acceptance:\n${input.goal.criteria}`,
    localSelectors(input.goal).length > 0
      ? `Required checks for this goal:\n${localSelectors(input.goal).join(", ")}`
      : undefined,
    `Plan context:\n${input.plan.prompt}`,
    "Do not redefine the goal or broaden scope. Implement only what is needed for this goal, verify it, and stop.",
  ].filter(Boolean).join("\n\n")
}

export async function deliveryFromSnapshot(baseRef: string | undefined, prefix: string) {
  const mergeRef = await Snapshot.track()
  const diffs = baseRef && mergeRef ? await Snapshot.diffFull(baseRef, mergeRef) : []
  return {
    mergeRef,
    delivery: {
      summary: summary(prefix, diffs.map((item) => item.file)),
      diffs,
    },
  }
}

export async function applyGoalDelivery(input: {
  directory: string
  delivery: {
    diffs: z.infer<typeof Snapshot.FileDiff>[]
  }
}) {
  for (const diff of input.delivery.diffs) {
    const file = path.join(input.directory, diff.file)
    if (diff.status === "deleted") {
      await fs.rm(file, { force: true }).catch(() => undefined)
      continue
    }
    await Filesystem.write(file, diff.after ?? "")
  }
}

export async function evaluateGoal(input: {
  task: TaskRow
  goal: GoalRow
  delivery: {
    summary: string
    diffs: z.infer<typeof Snapshot.FileDiff>[]
  }
}): Promise<{
  result: EvaluationOutput
  analysis: EvaluatorAnalysisType
  analysisError?: string
}> {
  const result = await EvaluatorService.evaluate(
    {
      taskID: input.task.id,
      request: `${input.task.request}\n\nFocused goal:\n${input.goal.description}\n${input.goal.criteria}`,
      metadata: {
        ...(input.task.metadata ?? {}),
        checks: goalChecks(input.goal, input.task),
        delivery_changed_files: input.delivery.diffs.map((item) => item.file),
      },
    },
    {
      summary: input.delivery.summary,
      diffs: input.delivery.diffs,
      changedFiles: input.delivery.diffs.map((item) => item.file),
    },
  )
  const selectors = localSelectors(input.goal)
  const matched = selectors.flatMap((selector) =>
    result.checks.filter((item) => item.name === selector || item.name.startsWith(`${selector}#`)),
  )
  if (result.status === "passed" && matched.length === 0) {
    return {
      result,
      analysis: {
        verdict: "accepted" as const,
        classification: "unknown" as const,
        summary: result.summary,
        goal_statuses: [{
          goal_index: 0,
          status: "passed" as const,
          evidence: result.summary,
          reasoning: "Goal-local evaluator checks passed and no goal-specific selector matched, so the delivery is accepted for this goal.",
        }],
        replan_guidance: null,
      },
    }
  }
  const analysisInput = {
    task: {
      title: input.task.title,
      request: input.task.request,
      sessionID: input.task.session_id ?? undefined,
    },
    goals: [{
      description: input.goal.description,
      criteria: input.goal.criteria,
      priority: input.goal.priority as "blocking" | "advisory",
      check_selector: selectors,
    }],
    delivery: {
      summary: input.delivery.summary,
      changedFiles: input.delivery.diffs.map((item) => item.file),
      diffs: input.delivery.diffs,
    },
    checkResults: result.checks.map((item) => ({
      name: item.name,
      status: item.status,
      evidence: item.evidence,
    })),
  }
  const analyzed = await EvaluatorService.analyzeDelivery(analysisInput)
    .then((analysis) => ({ analysis }))
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      return {
        analysis: analysisFailure(result, [input.goal], message),
        analysisError: message,
      }
    })
  return { result, ...analyzed }
}

export async function evaluateTask(input: {
  task: TaskRow
  goals: GoalRow[]
  delivery: {
    summary: string
    diffs: z.infer<typeof Snapshot.FileDiff>[]
  }
}): Promise<{
  result: EvaluationOutput
  analysis: EvaluatorAnalysisType
  analysisError?: string
}> {
  const result = await EvaluatorService.evaluate(
    {
      taskID: input.task.id,
      activeSpecVersionID: input.task.active_spec_version_id ?? undefined,
      request: input.task.request,
      metadata: {
        ...(input.task.metadata ?? {}),
        delivery_changed_files: input.delivery.diffs.map((item) => item.file),
      },
    },
    {
      summary: input.delivery.summary,
      diffs: input.delivery.diffs,
      changedFiles: input.delivery.diffs.map((item) => item.file),
    },
  )
  const analysisInput = {
    task: {
      title: input.task.title,
      request: input.task.request,
      sessionID: input.task.session_id ?? undefined,
    },
    goals: input.goals.map((goal) => ({
      description: goal.description,
      criteria: goal.criteria,
      priority: goal.priority as "blocking" | "advisory",
      check_selector: selectorList(goal.metadata),
    })),
    delivery: {
      summary: input.delivery.summary,
      changedFiles: input.delivery.diffs.map((item) => item.file),
      diffs: input.delivery.diffs,
    },
    checkResults: result.checks.map((item) => ({
      name: item.name,
      status: item.status,
      evidence: item.evidence,
    })),
  }
  const analyzed = await EvaluatorService.analyzeDelivery(analysisInput)
    .then((analysis) => ({ analysis }))
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      return {
        analysis: analysisFailure(result, input.goals, message),
        analysisError: message,
      }
    })
  return { result, ...analyzed }
}

export function goalEvaluationOutcome(
  result: EvaluationOutput,
  analysis: EvaluatorAnalysisType,
) {
  const phase1Failed = result.status === "failed"
  const verdict = phase1Failed ? "rejected" : analysis.verdict
  const status = verdict === "accepted" ? "passed" : "failed"
  const summary = phase1Failed && analysis.verdict === "accepted"
    ? `Rejected: automated checks failed. ${result.summary}`
    : analysis.summary
  return {
    verdict,
    status,
    summary,
  }
}

export function currentGoal(goalRun: GoalRunRow, goals: GoalRow[]) {
  return goals.find((goal) => goal.id === goalRun.goal_id)
}
