import fs from "fs/promises"
import path from "path"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import { dict } from "@/util/object"
import { inferFamily, selectorList } from "@/check/policy"
import { CheckRunner } from "@/evaluator/service"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Session } from "@/session"
import { Snapshot } from "@/snapshot"
import { type CheckDelivery, type CheckReport } from "@/evaluator/shared"
import { type GoalJudgmentType } from "@/evaluator/agent"
import { Worktree } from "@/worktree"
import { Identifier } from "@/id/id"
import z from "zod"
import { findRun, findTask, listGoalRunsByTask, type TaskRow, type GoalRow, type PlanRow, type GoalRunRow, type PlanNodeRow } from "@/orchestrator/store"
import { updateGoalRun } from "@/orchestrator/transition"
import { agentStream } from "@/orchestrator/agent-stream"

const log = Log.create({ service: "goal-runner" })
export const GOAL_RUN_RETENTION_MS = 72 * 60 * 60 * 1000

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

async function archiveGoalRunTranscript(goalRun: GoalRunRow) {
  const sourceSessionID = goalRunLocalSessionID(goalRun)
  if (!sourceSessionID) return
  const task = findTask(goalRun.task_id)
  const targetSessionID = task?.session_id ?? undefined
  if (!targetSessionID || targetSessionID === sourceSessionID) return

  const messages = await Session.messages({ sessionID: sourceSessionID }).catch(() => [])
  if (messages.length === 0) return

  const ids = new Map<string, string>()
  for (const item of messages) {
    const messageID = Identifier.ascending("message")
    ids.set(item.info.id, messageID)
    const info =
      item.info.role === "assistant"
        ? {
            ...item.info,
            id: messageID,
            sessionID: targetSessionID,
            parentID: ids.get(item.info.parentID) ?? item.info.parentID,
          }
        : {
            ...item.info,
            id: messageID,
            sessionID: targetSessionID,
          }
    await Session.saveMessage(info)
    for (const part of item.parts) {
      await Session.updatePart({
        ...part,
        id: Identifier.ascending("part"),
        messageID,
        sessionID: targetSessionID,
      })
    }
    await Session.updateMessage(info)
  }
  await Session.touch(targetSessionID)
}

export async function removeGoalRunSession(goalRun: GoalRunRow) {
  const id = goalRunLocalSessionID(goalRun)
  if (id) {
    await archiveGoalRunTranscript(goalRun).catch((err) => {
      log.warn("failed to archive goal run transcript", { goalRunID: goalRun.id, sessionID: id, error: String(err) })
    })
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

async function evaluationDelivery(task: TaskRow, delivery: { summary: string; diffs: z.infer<typeof Snapshot.FileDiff>[] }): Promise<CheckDelivery> {
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

const EVALUATOR_MANAGED_SELECTORS = new Set(["ui_review", "startup", "code_quality", "code_review", "dead_code_review"])

function goalSelectors(goal: GoalRow) {
  return selectorList(goal.metadata).filter((item) => item !== "spec_check")
}

function executorSelectors(goal: GoalRow) {
  return goalSelectors(goal).filter((item) => !EVALUATOR_MANAGED_SELECTORS.has(item))
}

function evaluatorManagedSelectors(goal: GoalRow) {
  return goalSelectors(goal).filter((item) => EVALUATOR_MANAGED_SELECTORS.has(item))
}

function analysisFailure(
  result: CheckReport,
  goals: Array<{ description: string; criteria: string; priority: GoalRow["priority"] }>,
  message: string,
): GoalJudgmentType {
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
  const selectors = executorSelectors(goal)
  const base = dict(task.metadata?.checks)
  const pick = (name: string, family: string) => selectors.includes(name) || selectors.includes(family)
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
            return pick(name, family) ? [[name, { ...value, enabled: true }]] : []
          }),
        )
      : undefined
  if (named && Object.keys(named).length > 0) next.named = named
  if (typeof base.timeout_ms === "number") next.timeout_ms = base.timeout_ms
  if (base.custom && typeof base.custom === "object" && !Array.isArray(base.custom)) next.custom = base.custom
  return next
}

export async function createGoalWorkspace(input: {
  task: TaskRow
  goal: GoalRow
  snapshot: string | undefined
}) {
  void input
  return Instance.directory
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

function compactPlanContext(plan: PlanRow) {
  const meta = dict(plan.metadata)
  const risks = strings(meta.risks).slice(0, 4)
  const failure = typeof meta.failure_summary === "string" ? meta.failure_summary.trim() : ""
  const runContext = extractPlanSection(plan.prompt, "## Run Context")
  return [
    `- Plan summary: ${plan.summary}`,
    risks.length > 0 ? `- Key risks: ${risks.join("; ")}` : undefined,
    failure ? `- Failure focus: ${failure}` : undefined,
    runContext ? `## Run Context\n${runContext}` : undefined,
  ].filter(Boolean).join("\n")
}

function extractScopedRequest(request: string) {
  if (!request.trim()) return ""
  const lines = request.split(/\r?\n/)
  const collected: string[] = []
  let capture = false
  let blankAfterScope = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (!capture && /^only\s+(create|modify|create or modify|modify or create).*(files|paths?)\s*:?\s*$/i.test(trimmed)) {
      capture = true
      collected.push(trimmed)
      continue
    }
    if (!capture && /^do not\s+/i.test(trimmed)) {
      collected.push(trimmed)
      continue
    }
    if (capture) {
      if (!trimmed) {
        blankAfterScope = true
        continue
      }
      if (blankAfterScope && /^do not\s+/i.test(trimmed)) {
        collected.push(trimmed)
        continue
      }
      if (blankAfterScope) break
      if (!/^[-*]\s+/.test(trimmed) && !/^\d+\.\s+/.test(trimmed) && !/^do not\s+/i.test(trimmed)) break
      collected.push(trimmed)
    }
  }
  return collected.join("\n")
}

function extractPlanSection(prompt: string, heading: string) {
  const marker = prompt.indexOf(heading)
  if (marker < 0) return ""
  const body = prompt.slice(marker + heading.length).trim()
  const next = body.search(/\n##\s+/)
  return (next >= 0 ? body.slice(0, next) : body).trim()
}

export function buildGoalPrompt(input: {
  plan: PlanRow
  node: PlanNodeRow
  goal: GoalRow
  taskRequest?: string
}) {
  const meta = dict(input.node.metadata)
  const waveTitle = typeof meta.wave_title === "string" ? meta.wave_title.trim() : ""
  const waveObjective = typeof meta.wave_objective === "string" ? meta.wave_objective.trim() : ""
  const runnableChecks = executorSelectors(input.goal)
  const managedChecks = evaluatorManagedSelectors(input.goal)
  const requestScope = extractScopedRequest(input.taskRequest ?? "")
  return [
    "You are executing the next iterative coding stage for the coordinator.",
    "Stay in the current project workspace and continue from the code that already exists.",
    "Treat the goal contract below as the only implementation target for this stage.",
    `Goal:
${input.goal.description}`,
    `Acceptance:
${input.goal.criteria}`,
    runnableChecks.length > 0
      ? `Required self-run checks for this goal:
${runnableChecks.join(", ")}`
      : undefined,
    managedChecks.length > 0
      ? `Evaluator-managed checks for this goal:
${managedChecks.join(", ")}

Prepare real implementation artifacts so these checks can pass, but do not fabricate placeholder UI/demo assets or long-lived runtime scaffolding just to satisfy them.`
      : undefined,
    requestScope
      ? `Scoped request constraints:
${requestScope}`
      : undefined,
    waveTitle
      ? [
          "Stage context:",
          `- Wave: ${waveTitle}`,
          waveObjective ? `- Objective: ${waveObjective}` : undefined,
          "- This stage executes in the same evolving workspace as the previous stages.",
          "- Do not fork a second implementation track or reset earlier progress.",
        ].filter(Boolean).join("\n")
      : undefined,
    `Coordinator context:
${compactPlanContext(input.plan)}`,
    [
      "Scope guard:",
      "- Ignore other goals, later stages, and broader product work unless this goal explicitly requires them.",
      "- Do not make speculative improvements outside the current goal contract.",
      "- Do not run git add, git commit, or git push unless the current goal explicitly requires a commit.",
      "- Do not run bun install, bun add, npm install, pnpm add, yarn add, or any dependency-management command unless the scoped request explicitly allows package manifest or lockfile edits.",
      "- This workspace already uses Bun for runtime and tests. Do not invoke npm, npx, pnpm, or yarn in this stage unless the scoped request explicitly requires a different package manager.",
      "- Do not create package-lock.json, pnpm-lock.yaml, yarn.lock, or any extra lockfile unless the scoped request explicitly allows lockfile changes.",
      "- If verification appears to require extra dependencies but package.json/bun.lock are out of scope, treat that as a blocker and report it instead of mutating the workspace contract.",
    ].join("\n"),
    [
      "Workspace root rule:",
      "- Treat the current workspace root as the project root for this run.",
      "- Create or modify files directly in this root instead of branching into a separate workspace.",
      "- Do not scaffold a nested app or package directory unless the request explicitly asks for one.",
    ].join("\n"),
    [
      "Execution discipline:",
      "- Do not restate or re-plan the whole product.",
      "- Do not spend this stage enumerating future stages or TODO lists.",
      "- Start implementing the current goal immediately, verify it, and stop once this goal's checks are ready.",
      "- Once the current goal's declared checks are green or evaluator-managed checks are prepared, stop. Do not keep searching for missing folders, future modules, or 'complete project structure' work.",
      "- Do not run generic directory-completeness sweeps such as find/ls tree audits after the current goal is implemented. Filesystem inspection is allowed only when it directly informs the current goal's owned files or declared checks.",
      "- Do not create demo pages, dist/index.html, screenshot harnesses, or ad-hoc UI just to satisfy evaluator-managed checks unless the scoped request explicitly asks for them.",
      "- Do not start long-lived or background servers just to satisfy evaluator-managed checks unless this stage explicitly requires runtime wiring.",
      "- If this stage is a bootstrap/foundation step, create only the minimal scaffold required for this goal's owned files and checks. Do not pre-build later feature modules.",
    ].join("\n"),
    "Do not redefine the goal or broaden scope. Implement only what is needed for this stage, verify it, and stop.",
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
  const baseDir = path.resolve(input.directory)
  for (const diff of input.delivery.diffs) {
    const file = path.resolve(path.join(input.directory, diff.file))
    if (!file.startsWith(baseDir + path.sep) && file !== baseDir) {
      log.warn("goal delivery: skipping path traversal attempt", { file, baseDir })
      continue
    }
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
  result: CheckReport
  analysis: GoalJudgmentType
  analysisError?: string
}> {
  const delivery = await evaluationDelivery(input.task, input.delivery)
  const result = await CheckRunner.evaluate(
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
  const selectors = goalSelectors(input.goal)
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
      metadata: input.task.metadata ?? undefined,
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
  const live = agentStream({
    taskID: input.task.id,
    runID: typeof input.task.active_run_id === "string" ? input.task.active_run_id : undefined,
    stage: "judge",
  })
  await live.start("Goal judge started")
  const analyzed = await CheckRunner.analyzeDelivery({
    ...analysisInput,
    stream: live.hooks,
  })
    .then(async (analysis) => {
      await live.finish("Goal judge finished")
      return { analysis }
    })
    .catch(async (error) => {
      await live.error(error)
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
  result: CheckReport
  analysis: GoalJudgmentType
  analysisError?: string
}> {
  const delivery = await evaluationDelivery(input.task, input.delivery)
  const result = await CheckRunner.evaluate(
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
      metadata: input.task.metadata ?? undefined,
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
  const live = agentStream({
    taskID: input.task.id,
    runID: typeof input.task.active_run_id === "string" ? input.task.active_run_id : undefined,
    stage: "judge",
  })
  await live.start("Goal judge started")
  const analyzed = await CheckRunner.analyzeDelivery({
    ...analysisInput,
    stream: live.hooks,
  })
    .then(async (analysis) => {
      await live.finish("Goal judge finished")
      return { analysis }
    })
    .catch(async (error) => {
      await live.error(error)
      const message = error instanceof Error ? error.message : String(error)
      return {
        analysis: analysisFailure(result, input.goals, message),
        analysisError: message,
      }
    })
  return { result, ...analyzed }
}

const REVIEW_CHECKS = new Set(["ui_review", "code_quality", "code_review", "dead_code_review"])

function checkBase(name: string) {
  return name.replace(/#\d+$/, "")
}

function reviewInfraFailure(check: { name: string; status: string; evidence?: string }) {
  if (check.status !== "failed") return false
  if (!REVIEW_CHECKS.has(checkBase(check.name))) return false
  const text = (check.evidence ?? "").toLowerCase()
  return (
    text.includes("review model call failed after retries") ||
    text.includes("review model could not be loaded") ||
    text.includes("no review model available") ||
    text.includes("no review model is configured") ||
    text.includes("failed to execute after retries")
  )
}

export function blockingEvaluationFailure(result: CheckReport) {
  if (result.status !== "failed") return false
  const failed = result.checks.filter((check) => check.status === "failed")
  if (failed.length === 0) return true
  return failed.some((check) => !reviewInfraFailure(check))
}

export function goalEvaluationOutcome(
  result: CheckReport,
  analysis: GoalJudgmentType,
) {
  const phase1Failed = blockingEvaluationFailure(result)
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
