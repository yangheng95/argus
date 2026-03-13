import fs from "fs/promises"
import path from "path"
import { Global } from "@/global"
import { Env } from "@/env"
import { git } from "@/util/git"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import { inferFamily, selectorList } from "@/check/policy"
import { EvaluatorService } from "@/evaluator/service"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Session } from "@/session"
import { Snapshot } from "@/snapshot"
import { type EvaluationDelivery, type EvaluationOutput } from "@/evaluator/shared"
import { type EvaluatorAnalysisType } from "@/evaluator/agent"
import { Worktree } from "@/worktree"
import z from "zod"
import { findRun, listGoalRunsByTask, type TaskRow, type GoalRow, type PlanRow, type GoalRunRow } from "./store"
import { updateGoalRun } from "./transition"

const log = Log.create({ service: "goal-runner" })
export const GOAL_RUN_RETENTION_MS = 72 * 60 * 60 * 1000

function dict(input: unknown) {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
}

function item(input: Record<string, unknown>, key: string) {
  const value = input[key]
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : undefined
}

function summary(prefix: string, files: string[]) {
  if (files.length === 0) return `${prefix}. No file changes were detected.`
  const sample = files.slice(0, 3).join(", ")
  return files.length <= 3
    ? `${prefix}. Changed files: ${sample}.`
    : `${prefix}. Changed files: ${sample} and ${files.length - 3} more.`
}

function includeDeliveryFile(file: string) {
  return !file.startsWith(".opencorvus/")
}

function filterDeliveryDiffs(diffs: z.infer<typeof Snapshot.FileDiff>[]) {
  return diffs.filter((item) => includeDeliveryFile(item.file))
}

function strings(input: unknown) {
  return [...new Set(Array.isArray(input) ? input.filter((item): item is string => typeof item === "string" && item.length > 0) : [])]
}

function retryFiles(task: TaskRow) {
  const seen = new Set<string>()
  let runID = task.active_run_id ?? undefined
  while (runID && !seen.has(runID)) {
    seen.add(runID)
    const run = findRun(runID)
    if (!run) return []
    const context = dict(run.metadata?.retry_context)
    const files = strings(context.changedFiles)
    if (files.length > 0) return files
    runID = typeof run.metadata?.previous_run_id === "string" ? run.metadata.previous_run_id : undefined
  }
  return []
}

function retrySummary(prefix: string, files: string[]) {
  const sample = files.slice(0, 3).join(", ")
  if (files.length <= 3) {
    return `${prefix} No new file changes were detected in this retry; re-evaluating previously changed files: ${sample}.`
  }
  return `${prefix} No new file changes were detected in this retry; re-evaluating previously changed files: ${sample} and ${files.length - 3} more.`
}

export function goalRunLocalSessionID(goalRun: GoalRunRow) {
  const id = dict(goalRun.metadata).local_session_id
  return typeof id === "string" && id ? id : goalRun.session_id ?? undefined
}

export function goalRunExpired(goalRun: GoalRunRow, now = Date.now(), ttl = GOAL_RUN_RETENTION_MS) {
  const time = goalRun.time_completed ?? goalRun.time_updated ?? goalRun.time_created ?? now
  return now - time >= ttl
}

export async function removeGoalRunSession(goalRun: GoalRunRow) {
  const id = goalRunLocalSessionID(goalRun)
  if (id) {
    await Session.remove(id).catch((err) => {
      log.warn("failed to remove goal run session", { sessionID: id, error: String(err) })
    })
  }
  if (!id && !goalRun.session_id) return
  updateGoalRun(goalRun.id, {
    session_id: null,
    metadata: {
      ...dict(goalRun.metadata),
      local_session_id: null,
    },
  })
}

async function evaluationDelivery(task: TaskRow, delivery: { summary: string; diffs: z.infer<typeof Snapshot.FileDiff>[] }): Promise<EvaluationDelivery> {
  const filtered = filterDeliveryDiffs(delivery.diffs)
  if (filtered.length > 0) {
    return {
      summary: delivery.summary,
      diffs: filtered,
      changedFiles: filtered.map((item) => item.file),
    }
  }
  const files = retryFiles(task)
  if (files.length === 0) {
    return {
      summary: delivery.summary,
      diffs: delivery.diffs,
      changedFiles: [],
    }
  }
  const replayed = (await Promise.all(files.map(materializeDiff))).flatMap((item) => item ? [item] : [])
  if (replayed.length === 0) {
    return {
      summary: delivery.summary,
      diffs: delivery.diffs,
      changedFiles: [],
    }
  }
  return {
    summary: retrySummary(delivery.summary, replayed.map((item) => item.file)),
    diffs: replayed,
    changedFiles: replayed.map((item) => item.file),
  }
}

async function materializeDiff(file: string) {
  if (!file || path.isAbsolute(file)) return
  const base = path.resolve(Instance.directory)
  const resolved = path.resolve(base, file)
  const relative = path.relative(base, resolved)
  if (relative.startsWith("..") || path.isAbsolute(relative)) return
  const next = relative.replace(/\\/g, "/")
  const stat = await fs.stat(resolved).catch(() => undefined)
  if (!stat?.isFile()) {
    return {
      file: next,
      before: "",
      after: "",
      additions: 0,
      deletions: 0,
      status: "deleted" as const,
    }
  }
  const after = await Bun.file(resolved).text()
  return {
    file: next,
    before: "",
    after,
    additions: after ? after.split("\n").length : 0,
    deletions: 0,
    status: "modified" as const,
  }
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
    spec_check: { enabled: false, mode: "strict" },
    build: selectors.includes("build") ? base.build : false,
    test: selectors.includes("test") ? base.test : false,
    lint: selectors.includes("lint") ? base.lint : false,
    verify_cmd: selectors.includes("verify_cmd") ? base.verify_cmd : false,
  }
  const named =
    base.named && typeof base.named === "object" && !Array.isArray(base.named)
      ? Object.fromEntries(
          Object.entries(base.named as Record<string, unknown>).flatMap(([name, raw]) => {
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) return []
            const value = raw as Record<string, unknown>
            if (value.enabled === false) return []
            const family = typeof value.family === "string" ? value.family : inferFamily(name)
            return selectors.includes(family) ? [[name, { ...value, enabled: true }]] : []
          }),
        )
      : undefined
  if (named && Object.keys(named).length > 0) next.named = named
  if (typeof base.timeout_ms === "number") next.timeout_ms = base.timeout_ms
  if (base.custom && typeof base.custom === "object" && !Array.isArray(base.custom)) next.custom = base.custom
  const startup = item(base, "startup")
  if (selectors.includes("startup") && typeof startup?.command === "string" && startup.command) {
    next.startup = {
      ...startup,
      mode: typeof startup.mode === "string" ? startup.mode : "strict",
    }
  }
  if (selectors.includes("ui_review")) {
    const value = item(base, "ui_review")
    next.ui_review = {
      ...value,
      target: "web",
      mode: typeof value?.mode === "string" ? value.mode : "strict",
    }
  }
  if (selectors.includes("code_quality")) {
    const value = item(base, "code_quality")
    next.code_quality = {
      ...value,
      enabled: true,
      mode: typeof value?.mode === "string" ? value.mode : "strict",
    }
  }
  if (selectors.includes("code_review")) {
    const value = item(base, "code_review")
    next.code_review = {
      ...value,
      enabled: true,
      mode: typeof value?.mode === "string" ? value.mode : "strict",
    }
  }
  if (selectors.includes("dead_code_review")) {
    const value = item(base, "dead_code_review")
    next.dead_code_review = {
      ...value,
      enabled: true,
      mode: typeof value?.mode === "string" ? value.mode : "strict",
    }
  }
  return next
}

export async function createGoalWorkspace(input: {
  task: TaskRow
  goal: GoalRow
  snapshot: string | undefined
}) {
  if (!input.snapshot || Instance.project.vcs !== "git") return Instance.directory
  const env = { ...Env.all() }
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
  await Project.addSandbox(Instance.project.id, directory).catch((err) => {
    log.warn("addSandbox failed for goal workspace", { directory, error: String(err) })
  })
  await Instance.provide({
    directory,
    fn: async () => {
      for (const [key, value] of Object.entries(env)) {
        if (value === undefined) continue
        Env.set(key, value)
      }
      await Snapshot.restore(input.snapshot!)
    },
  })
  return directory
}

export async function cleanupGoalWorkspace(directory?: string) {
  if (!directory) return
  const root = path.join(Global.Path.data, "goal-workspace")
  if (!Filesystem.contains(root, directory)) return
  const projectID = Instance.project.id
  if (!(await Filesystem.exists(directory))) {
    await Project.removeSandbox(projectID, directory).catch((err) => {
      log.warn("removeSandbox failed for missing directory", { directory, error: String(err) })
    })
    return
  }
  const drop = () =>
    fs.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 50,
      retryDelay: 100,
    }).catch((err) => {
      log.warn("force rm failed during goal workspace cleanup", { directory, error: String(err) })
    })
  await Instance.provide({
    directory,
    fn: () => Instance.dispose(),
  }).catch((err) => {
    log.warn("Instance.dispose failed during goal workspace cleanup", { directory, error: String(err) })
  })
  if (Instance.project.vcs !== "git") {
    await drop()
  } else {
    await Worktree.remove({ directory }).catch(drop)
  }
  await Project.removeSandbox(projectID, directory).catch((err) => {
    log.warn("removeSandbox failed during goal workspace cleanup", { directory, error: String(err) })
  })
}

export async function cleanupStaleGoalWorkspaces(taskID: string) {
  const root = path.join(Global.Path.data, "goal-workspace", Instance.project.id, taskID)
  const exists = await fs.stat(root).then(() => true, () => false)
  if (!exists) return
  const activeGoalRuns = listGoalRunsByTask(taskID)
  const activeDirs = new Set(
    activeGoalRuns
      .filter((gr) => gr.status === "running" || gr.status === "accepted" || gr.status === "queued")
      .map((gr) => gr.workspace_dir)
      .filter(Boolean),
  )
  const entries = await fs.readdir(root).catch((err) => {
    log.warn("failed to read goal workspace directory for cleanup", { root, error: String(err) })
    return [] as string[]
  })
  for (const entry of entries) {
    const dir = path.join(root, entry)
    if (activeDirs.has(dir)) continue
    log.info("cleaning up stale goal workspace", { directory: dir, taskID })
    await cleanupGoalWorkspace(dir)
  }
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
  const diffs = filterDeliveryDiffs(baseRef && mergeRef ? await Snapshot.diffFull(baseRef, mergeRef) : [])
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
      await fs.rm(file, { force: true }).catch((err) => {
        log.warn("failed to delete file during goal delivery apply", { file, error: String(err) })
      })
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
  const delivery = await evaluationDelivery(input.task, input.delivery)
  const result = await EvaluatorService.evaluate(
    {
      taskID: input.task.id,
      activeSpecVersionID: input.task.active_spec_version_id ?? undefined,
      request: `${input.task.request}\n\nFocused goal:\n${input.goal.description}\n${input.goal.criteria}`,
      metadata: {
        ...(input.task.metadata ?? {}),
        checks: goalChecks(input.goal, input.task),
        delivery_changed_files: delivery.changedFiles,
      },
    },
    delivery,
  )
  const selectors = localSelectors(input.goal)
  const matched = selectors.flatMap((selector) =>
    result.checks.filter((item) => item.name === selector || item.name.startsWith(`${selector}#`)),
  )
  const analysisOnly =
    result.status === "failed" &&
    matched.length === 0 &&
    result.summary === "No blocking evaluator checks ran."
  const checked = analysisOnly
    ? {
        ...result,
        status: "passed" as const,
        verdict: "accepted" as const,
        summary: "No goal-local automated checks ran; deferring to goal analysis.",
      }
    : result
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
      summary: delivery.summary,
      changedFiles: delivery.changedFiles ?? [],
      diffs: delivery.diffs ?? [],
    },
    checkResults: checked.checks.map((item) => ({
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
        analysis: analysisFailure(checked, [input.goal], message),
        analysisError: message,
      }
    })
  return { result: checked, ...analyzed }
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
  const delivery = await evaluationDelivery(input.task, input.delivery)
  const result = await EvaluatorService.evaluate(
    {
      taskID: input.task.id,
      activeSpecVersionID: input.task.active_spec_version_id ?? undefined,
      request: input.task.request,
      metadata: {
        ...(input.task.metadata ?? {}),
        delivery_changed_files: delivery.changedFiles,
      },
    },
    delivery,
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
      summary: delivery.summary,
      changedFiles: delivery.changedFiles ?? [],
      diffs: delivery.diffs ?? [],
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
