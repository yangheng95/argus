import fs from "fs/promises"
import path from "path"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import { dict } from "@/util/object"
import { selectorList } from "@/check/policy"
import { operatorNotesSection } from "@/orchestrator/helpers"
import { createDecisionLog } from "@/decision-log"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Session } from "@/session"
import { Snapshot } from "@/snapshot"
import { Worktree } from "@/worktree"
import { Identifier } from "@/id/id"
import z from "zod"
import {
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

export async function createGoalWorkspace(_input: {
  task: TaskRow
  goal: GoalRow
  snapshot: string | undefined
}) {
  return Instance.directory
}

export async function cleanupGoalWorkspace(directory?: string) {
  if (!directory) return
  // Accept both goal-workspace paths AND .opencorvus-worktrees paths.
  // Per-goal dispatch creates worktrees under .opencorvus-worktrees/ (via Worktree.create),
  // not under goal-workspace/. Without this check, cleanup is silently skipped,
  // leaking LSP servers and worktree directories.
  const goalWorkspaceRoot = path.join(Global.Path.data, "goal-workspace")
  const isGoalWorkspace = Filesystem.contains(goalWorkspaceRoot, directory)
  const isWorktree = directory.includes(".opencorvus-worktrees")
  if (!isGoalWorkspace && !isWorktree) return
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
    title: `${task.title}: ${goal.title}`,
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
  registerGoalRunSession(session.id, task.id, "executor", goal.id)
  return session
}

function strings(input: unknown) {
  return [...new Set(Array.isArray(input) ? input.filter((item): item is string => typeof item === "string" && item.length > 0) : [])]
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
  taskID?: string
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
        .map((g) => `- "${g!.title}" (completed, output in your workspace)`)
        .join("\n")
    : ""
  // Include architect consensus from Decision Log (interface contracts, directory blueprint, naming conventions).
  // Only populated when Task Agent called architect(); empty string if skipped (single goal / simple task).
  const architectConsensus = input.taskID
    ? createDecisionLog(input.taskID).phasePromptSection("architect")
    : ""

  return [
    "You are executing one goal in an isolated workspace (git worktree) for the coordinator.",
    input.taskID ? operatorNotesSection(input.taskID) || undefined : undefined,
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
    architectConsensus || undefined,
    `Goal:
${input.goal.title}: ${input.goal.objective}`,
    `Acceptance:
${input.goal.done_definition}`,
    // Plan node brief — the planner's specific implementation steps for this goal.
    // Without this, the executor only sees the goal's description/criteria from the
    // goal decomposition stage and misses the planner's detailed guidance.
    input.node.brief
      ? `## Implementation Plan (from Planner)\n\n${input.node.title ? `**${input.node.title}**\n\n` : ""}${input.node.brief}`
      : undefined,
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

