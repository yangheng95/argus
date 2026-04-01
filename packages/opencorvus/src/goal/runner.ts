import fs from "fs/promises"
import path from "path"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import { dict } from "@/util/object"
import { selectorList } from "@/check/policy"
import { CheckRunner } from "@/evaluator/service"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Shell } from "@/shell/shell"
import { Session } from "@/session"
import { Snapshot } from "@/snapshot"
import { type CheckDelivery, type CheckReport } from "@/evaluator/shared"
import { type GoalJudgmentType } from "@/evaluator/agent"
import { Worktree } from "@/worktree"
import { Identifier } from "@/id/id"
import z from "zod"
import {
  findDeliveryByGoalRun,
  findDeliveryByRun,
  findRun,
  findTask,
  listGoalRunsByTask,
  type TaskRow,
  type GoalRow,
  type PlanRow,
  type GoalRunRow,
  type PlanNodeRow,
} from "@/orchestrator/store"
import { updateGoalRun } from "@/orchestrator/persist"
import { agentStream } from "@/orchestrator/agent-stream"
import { registerGoalRunSession, unregisterGoalRunSession } from "@/server/routes/task-event"

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

function mergeFiles(...groups: Array<string[] | undefined>) {
  return [...new Set(groups.flatMap((group) => group ?? []))]
}

function filesFromDeliveryResult(input: unknown) {
  const result = dict(input)
  const changed = strings(result.changed_files).filter(includeDeliveryFile)
  if (changed.length > 0) return changed
  const diffs = Array.isArray(result.diffs)
    ? result.diffs.flatMap((item) => {
        const parsed = Snapshot.FileDiff.safeParse(item)
        return parsed.success && includeDeliveryFile(parsed.data.file) ? [parsed.data.file] : []
      })
    : []
  return [...new Set(diffs)]
}

function retryFiles(task: TaskRow) {
  const seen = new Set<string>()
  const goalRuns = listGoalRunsByTask(task.id)
  const files = new Set<string>()
  let runID = task.active_run_id ?? undefined
  while (runID && !seen.has(runID)) {
    seen.add(runID)
    const run = findRun(runID)
    if (!run) break
    const context = dict(run.metadata?.retry_context)
    for (const file of strings(context.changedFiles).filter(includeDeliveryFile)) files.add(file)
    const runFiles = filesFromDeliveryResult(findDeliveryByRun(run.id)?.result)
    for (const file of runFiles) files.add(file)
    const runGoalRuns = goalRuns
      .filter((goalRun) => goalRun.coordinator_run_id === run.id)
      .sort((a, b) => (b.time_created ?? 0) - (a.time_created ?? 0) || b.id.localeCompare(a.id))
    for (const goalRun of runGoalRuns) {
      const goalFiles = filesFromDeliveryResult(findDeliveryByGoalRun(goalRun.id)?.result)
      for (const file of goalFiles) files.add(file)
    }
    runID = typeof run.metadata?.previous_run_id === "string" ? run.metadata.previous_run_id : undefined
  }
  return [...files]
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
  const currentFiles = filtered.map((item) => item.file)
  const historicalFiles = retryFiles(task)
  const missingHistory = historicalFiles.filter((file) => !currentFiles.includes(file))
  if (filtered.length > 0 && missingHistory.length === 0) {
    return {
      summary: delivery.summary,
      diffs: filtered,
      changedFiles: currentFiles,
    }
  }
  if (filtered.length === 0 && missingHistory.length === 0) {
    return {
      summary: delivery.summary,
      diffs: delivery.diffs,
      changedFiles: [],
    }
  }
  const replayed = (await Promise.all(missingHistory.map(materializeDiff))).flatMap((item) => item ? [item] : [])
  const mergedDiffs = [...filtered, ...replayed]
  const changedFiles = mergeFiles(currentFiles, replayed.map((item) => item.file))
  if (changedFiles.length === 0) {
    return {
      summary: delivery.summary,
      diffs: filtered.length > 0 ? filtered : delivery.diffs,
      changedFiles: [],
    }
  }
  if (filtered.length > 0) {
    return {
      summary: `${delivery.summary} Re-evaluating cumulative changed files from the current delivery and prior run history.`,
      diffs: mergedDiffs,
      changedFiles,
    }
  }
  return {
    summary: retrySummary(delivery.summary, replayed.map((item) => item.file)),
    diffs: replayed,
    changedFiles,
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

function goalChecks(goal: GoalRow, task: TaskRow) {
  const selectors = executorSelectors(goal)
  const base = dict(task.metadata?.checks)
  const pick = (name: string, family?: string) => selectors.includes(name) || (family ? selectors.includes(family) : false)
  const next: Record<string, unknown> = {
    spec_check: { enabled: false, mode: "strict" },
    // Matching selectors → undefined (auto-discovery fallback enabled)
    // Non-matching selectors → false (explicitly disabled, no fallback)
    build: selectors.includes("build") ? (base.build ?? undefined) : false,
    test: selectors.includes("test") ? (base.test ?? undefined) : false,
    lint: selectors.includes("lint") ? (base.lint ?? undefined) : false,
    verify_cmd: selectors.includes("verify_cmd") ? (base.verify_cmd ?? undefined) : false,
    // Enable named check auto-discovery only when the goal's selectors include
    // lint or test families. This allows the verification goal (selectors: ["test", "lint"])
    // to auto-discover typecheck/pytest/py_compile, while feature goals (selectors: ["build"])
    // don't get irrelevant named checks.
    _autoDiscoverNamed: selectors.includes("lint") || selectors.includes("test"),
  }
  const named =
    base.named && typeof base.named === "object" && !Array.isArray(base.named)
      ? Object.fromEntries(
          Object.entries(base.named as Record<string, unknown>).flatMap(([name, raw]) => {
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) return []
            const value = raw as Record<string, unknown>
            if (value.enabled === false) return []
            const family = typeof value.family === "string" ? value.family : undefined
            return pick(name, family) ? [[name, { ...value, enabled: true }]] : []
          }),
        )
      : undefined
  if (named && Object.keys(named).length > 0) next.named = named
  if (typeof base.timeout_ms === "number") next.timeout_ms = base.timeout_ms
  if (base.custom && typeof base.custom === "object" && !Array.isArray(base.custom)) next.custom = base.custom
  return next
}

export async function createGoalWorkspace(_input: {
  task: TaskRow
  goal: GoalRow
  snapshot: string | undefined
}) {
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
  const session = await Session.createNext({
    parentID: task.session_id ?? undefined,
    title: `${task.title}: ${goal.description}`,
    directory: directory ?? (await import("@/project/instance")).Instance.directory,
  })
  const parent = task.session_id ? await Session.get(task.session_id) : undefined
  if (parent?.permission) {
    await Session.setPermission({
      sessionID: session.id,
      permission: parent.permission,
    })
  }
  // Register so SSE can match this session's events to the task
  registerGoalRunSession(session.id, task.id)
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

function allowedRequestPaths(request: string) {
  if (!request.trim()) return []
  const lines = request.split(/\r?\n/)
  const allowed: string[] = []
  let capture = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (!capture && /^only\s+(create|modify|create or modify|modify or create).*(files|paths?)\s*:?\s*$/i.test(trimmed)) {
      capture = true
      continue
    }
    if (!capture) continue
    if (!trimmed) break
    const bullet = trimmed.match(/^[-*]\s+`?([^`]+?)`?\s*$/)
    const numbered = trimmed.match(/^\d+\.\s+`?([^`]+?)`?\s*$/)
    const value = bullet?.[1] || numbered?.[1]
    if (!value) break
    allowed.push(value.replace(/\\/g, "/"))
  }
  return [...new Set(allowed)]
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
  allGoals?: GoalRow[]
  cwd?: string
}) {
  const meta = dict(input.node.metadata)
  const goalMeta = dict(input.goal.metadata)
  const waveTitle = typeof meta.wave_title === "string" ? meta.wave_title.trim() : ""
  const waveObjective = typeof meta.wave_objective === "string" ? meta.wave_objective.trim() : ""
  const runnableChecks = executorSelectors(input.goal)
  const managedChecks = evaluatorManagedSelectors(input.goal)
  const requestScope = extractScopedRequest(input.taskRequest ?? "")
  const allowedPaths = allowedRequestPaths(input.taskRequest ?? "")
  // Extract owned_paths and dependency context from goal metadata
  const ownedPaths = Array.isArray(goalMeta.owned_paths) ? goalMeta.owned_paths as string[] : []
  const dependsOnIds = Array.isArray(goalMeta.depends_on_goal_ids) ? goalMeta.depends_on_goal_ids as string[] : []
  const dependencyContext = dependsOnIds.length > 0 && input.allGoals
    ? dependsOnIds
        .map((id) => input.allGoals!.find((g) => g.id === id))
        .filter(Boolean)
        .map((g) => `- "${g!.description}" (completed, output in your workspace)`)
        .join("\n")
    : ""
  return [
    "You are executing one goal in an isolated workspace (git worktree) for the coordinator.",
    input.cwd
      ? `Your working directory is: ${input.cwd}\nAll file paths MUST be relative to this directory or use this absolute prefix. Never write files outside this directory.`
      : undefined,
    "Other goals may be executing in parallel in separate worktrees.",
    "Treat the goal contract below as the only implementation target for this stage.",
    // Explicit file scope from goal decomposition
    ownedPaths.length > 0
      ? `## File Scope (EXCLUSIVE)\n\nYou have exclusive write access to these files ONLY:\n${ownedPaths.map((p) => "- " + p).join("\n")}\n\nDo NOT create, modify, or delete any file outside this list.\nIf you need changes outside your scope, report it as a SCOPE BLOCKER.`
      : undefined,
    // Dependency context
    dependencyContext
      ? `## Dependencies (completed before this goal)\n\nThese goals completed before yours. Their output is already in your workspace:\n${dependencyContext}`
      : undefined,
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
    allowedPaths.length > 0
      ? [
          "Allowed file edits:",
          ...allowedPaths.map((item) => `- ${item}`),
          "- Do not create, modify, or delete any file outside this allowlist.",
          "- If a tool, type error, or test seems to require edits to an unlisted file such as tsconfig.json, package.json, lockfiles, README, or docs, stop and report the blocker instead of widening scope.",
        ].join("\n")
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
      ...(allowedPaths.length > 0
        ? [
            // Scoped task: explicit file allowlist → package management is unconditionally forbidden
            "- UNCONDITIONAL: Do not run bun install, bun add, npm install, npm ci, pnpm add, pnpm install, yarn add, yarn install, or any other package or dependency management command. No exception exists for type errors, build failures, or missing modules. This constraint cannot be overridden.",
            "- Do not modify package.json, package-lock.json, bun.lock, pnpm-lock.yaml, yarn.lock, or any manifest/lockfile. If the task explicitly lists these in its allowed file set, that is the only exception.",
            "- This workspace already uses Bun for runtime and tests. Do not invoke npm, npx, pnpm, or yarn for anything.",
            "- If build tools (tsc, type checkers, linters) fail due to missing packages or environment issues, that is an ENVIRONMENT BLOCKER. Stop, report the blocker with details, and do not attempt to fix the environment. The executor role is to write code, not to manage the runtime environment.",
          ]
        : [
            // Open task: no explicit file scope → package management is allowed with minimal footprint
            "- This workspace uses Bun. Prefer built-in Bun APIs (bun:sqlite, bun:test, bun:crypto, etc.) over external packages when they satisfy the requirement.",
            "- Install third-party packages only when the task explicitly requires a framework or library not built into Bun. Use `bun add <pkg>` or `bun add -d <pkg>` (not npm/yarn/pnpm). Do not install packages just because a type checker or linter reports missing types.",
            "- Do not use npm, npx, pnpm, or yarn for anything. Bun is the only package manager in this workspace.",
          ]
      ),
      "- If the required verify command (bun test, cargo test, pytest, etc.) passes, the goal is met regardless of what other build tools report.",
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
      "- Do not create README.md files, module-level documentation, or scaffold documentation (e.g. src/<module>/README.md, tests/README.md) unless the request explicitly requires documentation. Focus on source code and tests only.",
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

/**
 * Extract delivery diffs using the worktree's native git.
 * This is the reliable path for worktree-based goal execution.
 *
 * The Snapshot system shares a single git object store across worktrees,
 * causing index race conditions. The worktree's own git correctly tracks
 * all changes the executor made.
 */
export async function deliveryFromWorktreeGit(
  worktreeDir: string,
  prefix: string,
): Promise<{ summary: string; diffs: z.infer<typeof Snapshot.FileDiff>[] }> {
  const { $ } = await import("bun")

  // Stage all changes (including new files) so we can diff
  await $`git add -A`.quiet().cwd(worktreeDir).nothrow()

  // Determine the base to diff against.
  // If HEAD exists (repo has commits), diff against HEAD.
  // Otherwise (empty repo), diff against the git empty tree hash.
  const hasHead = (await $`git rev-parse --verify HEAD`.quiet().cwd(worktreeDir).nothrow()).exitCode === 0
  const base = hasHead ? "HEAD" : "4b825dc642cb6eb9a060e54bf899d69f82cf022c"

  // Get list of changed files with status
  const statusOutput = await $`git diff --cached --name-status --no-renames ${base} -- .`
    .quiet().cwd(worktreeDir).nothrow().text()

  const files: Array<{ file: string; status: "added" | "modified" | "deleted" }> = []
  for (const line of statusOutput.trim().split("\n")) {
    if (!line.trim()) continue
    const [code, file] = line.split("\t")
    if (!code || !file) continue
    const status = code.startsWith("A") ? "added" as const
      : code.startsWith("D") ? "deleted" as const
      : "modified" as const
    if (includeDeliveryFile(file)) {
      files.push({ file, status })
    }
  }

  if (files.length === 0) {
    log.warn("worktree delivery: no changed files detected", { worktreeDir })
    return { summary: `${prefix}: no changes`, diffs: [] }
  }

  // Read file contents for diffs
  const diffs: z.infer<typeof Snapshot.FileDiff>[] = []
  for (const { file, status } of files) {
    const fullPath = path.join(worktreeDir, file)
    const after = status === "deleted" ? "" : await fs.readFile(fullPath, "utf-8").catch(() => "")
    const before = status === "added" || !hasHead ? "" : await $`git show HEAD:${file}`.quiet().cwd(worktreeDir).nothrow().text().catch(() => "")

    const afterLines = after.split("\n")
    const beforeLines = before.split("\n")
    diffs.push({
      file,
      before,
      after,
      additions: Math.max(0, afterLines.length - beforeLines.length),
      deletions: Math.max(0, beforeLines.length - afterLines.length),
      status,
    })
  }

  log.info("worktree delivery extracted", { worktreeDir, files: diffs.length, fileNames: diffs.map((d) => d.file) })
  return {
    summary: summary(prefix, diffs.map((d) => d.file)),
    diffs,
  }
}

export async function applyGoalDelivery(input: {
  directory: string
  delivery: {
    diffs: z.infer<typeof Snapshot.FileDiff>[]
  }
  ownedPaths?: string[]
}) {
  const baseDir = path.resolve(input.directory)
  const ownedPaths = input.ownedPaths ?? []

  // Validate owned_paths if specified
  if (ownedPaths.length > 0) {
    const { validateOwnedPaths } = await import("./merge")
    const validation = validateOwnedPaths(
      input.delivery.diffs.map((d) => d.file),
      ownedPaths,
    )
    if (!validation.valid) {
      log.warn("goal delivery: files outside owned_paths", {
        violations: validation.violations,
        ownedPaths,
      })
      // Allow but warn — emergent changes may be necessary
    }
  }

  const { getMerger } = await import("./merge")

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

    // Use merge strategy for shared files (package.json, tsconfig.json, etc.)
    const merger = getMerger(diff.file)
    if (merger === "skip") {
      log.info("goal delivery: skipping lockfile (will be regenerated)", { file: diff.file })
      continue
    }
    if (merger) {
      const existing = await Filesystem.readText(file).catch(() => "")
      const result = merger(existing, diff.after ?? "")
      if (result.conflict) {
        log.warn("goal delivery: merge conflict", { file: diff.file, reason: result.reason })
      }
      await Filesystem.write(file, result.content)
      log.info("goal delivery: merged shared file", { file: diff.file })
      continue
    }

    // Normal file: direct write (owned_paths guarantees no conflict)
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
  // Tier 1 (goal-level): core checks only, no LLM judge — fast path (< 30s)
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
    "core",
  )
  // "No checks ran" is not a pass — let it propagate as-is so task-level
  // evaluation sees the real status instead of a fabricated "passed".
  const analysis: GoalJudgmentType = {
    verdict: result.verdict === "accepted" ? "accepted" : "rejected",
    classification: result.verdict === "accepted" ? "transient" : "evaluation",
    summary: result.summary,
    goal_statuses: [{
      goal_index: 0,
      status: result.verdict === "accepted" ? "passed" : "failed",
      evidence: result.checks.map((c) => `${c.name}: ${c.status}`).join("; "),
      reasoning: result.summary,
    }],
    replan_guidance: result.verdict === "accepted" ? null : {
      root_cause: result.checks.filter((c) => c.status === "failed").map((c) => `${c.name}: ${c.evidence}`).join("; "),
      what_failed: result.checks.filter((c) => c.status === "failed").map((c) => c.name).join(", "),
      suggested_strategy: "Fix failing core checks before proceeding.",
      avoid_approaches: [],
    },
  }
  return { result, analysis }
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
  // Core checks only — no LLM judge. Delivery agent handles full verification.
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
    "core",
  )

  // Construct minimal analysis from check results — no LLM call
  const analysis: GoalJudgmentType = {
    verdict: result.status === "failed" ? "rejected" : "accepted",
    classification: result.status === "failed" ? "evaluation" : "transient",
    summary: `Core checks: ${result.checks.map((c) => `${c.name}:${c.status}`).join(", ")}`,
    goal_statuses: input.goals.map((g, i) => ({
      goal_index: i,
      status: result.status === "failed" ? ("failed" as const) : ("passed" as const),
      evidence: result.checks.map((c) => `${c.name}: ${c.status}`).join("; "),
      reasoning: result.summary,
    })),
    replan_guidance: result.status === "failed" ? {
      root_cause: result.checks.filter((c) => c.status === "failed").map((c) => `${c.name}: ${c.evidence}`).join("; "),
      what_failed: result.checks.filter((c) => c.status === "failed").map((c) => c.name).join(", "),
      suggested_strategy: "Fix failing core checks.",
      avoid_approaches: [],
    } : null,
  }

  // delivery_verify_cmd — run if present and checks passed
  const deliveryVerifyCmd = typeof input.task.metadata?.delivery_verify_cmd === "string"
    ? input.task.metadata.delivery_verify_cmd : null
  let finalResult = result
  if (deliveryVerifyCmd && result.status !== "failed") {
    try {
      const verifyResult = await Shell.run(deliveryVerifyCmd, {
        cwd: Filesystem.resolve(Instance.directory),
        env: process.env,
        timeoutMs: 120_000,
      })
      if (verifyResult.exitCode !== 0) {
        const output = (verifyResult.stderr || verifyResult.stdout).slice(0, 800)
        finalResult = {
          ...result,
          status: "failed" as const,
          verdict: "rejected" as const,
          summary: `Delivery verify command failed (exit ${verifyResult.exitCode}): ${output}`,
        }
        analysis.verdict = "rejected"
        analysis.classification = "evaluation"
        analysis.replan_guidance = {
          root_cause: `'${deliveryVerifyCmd}' exited ${verifyResult.exitCode}`,
          what_failed: output,
          suggested_strategy: "Fix the errors reported by the verify command.",
          avoid_approaches: [],
        }
      }
    } catch (err) {
      log.warn("delivery_verify_cmd failed", { cmd: deliveryVerifyCmd, err })
    }
  }

  return { result: finalResult, analysis }
}

/**
 * Detect infra failure using only the structured `infra_failure` field.
 * If the field does not exist on the check result, returns false.
 */
function reviewInfraFailure(check: { name: string; status: string; infra_failure?: boolean }) {
  if (check.status !== "failed") return false
  return check.infra_failure === true
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
