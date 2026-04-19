import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import { dict } from "@/util/object"
import { selectorList } from "@/check/policy"
import { renderSpecsAsText } from "@/acceptance/types"
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
  updateGoalRun,
} from "@/engine"
import type {
  TaskRow,
  GoalRow,
  PlanRow,
  GoalRunRow,
  PlanNodeRow,
} from "@/engine"

const log = Log.create({ service: "goal-runner" })
const GOAL_RUN_RETENTION_MS = 72 * 60 * 60 * 1000

function summary(prefix: string, files: string[]) {
  if (files.length === 0) return `${prefix}. No file changes were detected.`
  const sample = files.slice(0, 3).join(", ")
  return files.length <= 3
    ? `${prefix}. Changed files: ${sample}.`
    : `${prefix}. Changed files: ${sample} and ${files.length - 3} more.`
}

function includeDeliveryFile(file: string) {
  // `.opencorvus/` covers scratch + `.opencorvus/worktrees/`, so the old
  // standalone `.opencorvus-worktrees/` check is redundant (and its legacy
  // path is no longer produced by Worktree.create).
  return !file.startsWith(".opencorvus/")
    && file !== ".opencorvus-meta.json"
}

function filterDeliveryDiffs(diffs: z.infer<typeof Snapshot.FileDiff>[]) {
  return diffs.filter((item) => includeDeliveryFile(item.file))
}

function goalRunLocalSessionID(goalRun: GoalRunRow) {
  const id = dict(goalRun.metadata).local_session_id
  return typeof id === "string" && id ? id : goalRun.session_id ?? undefined
}

function goalRunExpired(goalRun: GoalRunRow, now = Date.now(), ttl = GOAL_RUN_RETENTION_MS) {
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

async function removeGoalRunSession(goalRun: GoalRunRow) {
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

export async function cleanupGoalWorkspace(directory?: string) {
  if (!directory) return
  // Accept both the Global goal-workspace path and the per-project worktree
  // path. Per-goal dispatch creates worktrees under
  // `<primary>/.opencorvus/worktrees/` (via Worktree.create). Without this
  // check cleanup is silently skipped, leaking LSP servers + worktree dirs.
  // The legacy parent-directory layout (`.opencorvus-worktrees/`) is also
  // still matched so a cleanup straddling the migration still works.
  const goalWorkspaceRoot = path.join(Global.Path.data, "goal-workspace")
  const isGoalWorkspace = Filesystem.contains(goalWorkspaceRoot, directory)
  const isWorktree =
    directory.includes(path.join(".opencorvus", "worktrees")) ||
    directory.includes(".opencorvus-worktrees")
  if (!isGoalWorkspace && !isWorktree) return

  // [observability/phase-0] Per-step timing + outcome breakdown. Until we have
  // this, a "retry reused new worktree path" incident gives no signal about
  // WHICH step of cleanup failed (Instance.dispose / Worktree.remove / fs.rm /
  // removeSandbox). The summary log at the end lets ops correlate a cleanup
  // failure with the subsequent Worktree.create candidate() fallback (random
  // suffix) that breaks prompt-cache continuity.
  const started = Date.now()
  type StepOutcome = { step: string; ok: boolean; ms: number; error?: string }
  const steps: StepOutcome[] = []
  const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
    const t0 = Date.now()
    try {
      const result = await fn()
      steps.push({ step: name, ok: true, ms: Date.now() - t0 })
      return result
    } catch (err) {
      const code =
        typeof (err as { code?: unknown })?.code === "string"
          ? ((err as { code?: string }).code as string)
          : undefined
      steps.push({
        step: name,
        ok: false,
        ms: Date.now() - t0,
        error: code ? `${code}: ${String(err)}` : String(err),
      })
      log.warn(`cleanupGoalWorkspace.${name} failed`, { directory, error: String(err), code })
      return undefined
    }
  }

  const projectID = Instance.project.id
  const exists = await Filesystem.exists(directory)
  if (!exists) {
    await timed("removeSandbox", () => Project.removeSandbox(projectID, directory))
    log.info("cleanupGoalWorkspace done (missing directory)", {
      directory,
      existed: false,
      totalMs: Date.now() - started,
      steps,
    })
    return
  }

  const drop = () =>
    timed("fs.rm", () =>
      fs.rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 50,
        retryDelay: 100,
      }),
    )

  await timed("Instance.dispose", () =>
    Instance.provide({
      directory,
      fn: () => Instance.dispose(),
    }),
  )

  if (Instance.project.vcs !== "git") {
    await drop()
  } else {
    const removed = await timed("Worktree.remove", () => Worktree.remove({ directory }))
    if (removed === undefined) {
      // Worktree.remove threw → fall through to the brute-force fs.rm. `timed`
      // already recorded the remove failure; we still want the drop attempt's
      // own ok/fail to land in the summary.
      await drop()
    }
  }
  await timed("removeSandbox", () => Project.removeSandbox(projectID, directory))

  const allOk = steps.every((s) => s.ok)
  const summary = {
    directory,
    existed: true,
    totalMs: Date.now() - started,
    steps,
  }
  if (allOk) log.info("cleanupGoalWorkspace done", summary)
  else log.warn("cleanupGoalWorkspace completed with failures", summary)
}

/**
 * Create the per-goal **build** worker session — the LLM that actually
 * writes code inside the goal's worktree. Named by its role: this session
 * does the build phase of the goal. Its parent is the executor container
 * session (see createExecutorSession below), which groups plan + build +
 * evaluate sessions under one overlay step card.
 *
 * (Renamed from createGoalSession + kind:"executor" — that naming had the
 *  worker-vs-container wires crossed. See specs/new-arch/07-panel-reactivity
 *  §session 终态 for the agreed vocabulary.)
 */
export async function createBuildSession(task: TaskRow, goal: GoalRow, directory?: string, parentSessionID?: string) {
  const session = await Session.createNext({
    kind: "build",
    goalID: goal.id,
    parentID: parentSessionID ?? task.session_id ?? undefined,
    title: `${task.title}: ${goal.title}`,
    directory: directory ?? (await import("@/project/instance")).Instance.directory,
  })
  // Permissions for goal sessions are now governed by the project config
  // (`experimental.auto_permission` = global auto-approve switch, plus the
  // user's explicit `permission` rules). The old blanket "allow *,*" on
  // every goal session silently disabled every permission prompt — that
  // was the reason the overlay's question/permission UX never surfaced
  // anything to the operator. Leaving it off lets PermissionNext do its
  // normal resolution: config rules → ask → (optionally) auto-approved by
  // the AutoPermission subscriber when auto_permission is set.
  return session
}

/**
 * Create the per-goal **executor** container session and seed it with one
 * assistant-role header message describing the dispatch. The container has
 * no LLM of its own — its purpose is to carry the goal-scope step in the
 * overlay, grouping planner + build + evaluator child sessions under one
 * parent for permission inheritance and transcript organisation.
 *
 * The header message is authentic content: it records what the build step
 * dispatched, the worktree branch, and the acceptance specs summary.
 *
 * (Renamed from createBuildSession + kind:"build" — that naming confused
 *  the container with the worker; "executor" = the thing that executes the
 *  goal, "build" = the worker that writes code.)
 */
export async function createExecutorSession(
  task: TaskRow,
  goal: GoalRow,
  worktreeDir: string,
  worktreeBranch: string,
  parentSessionID: string,
) {
  const session = await Session.createNext({
    kind: "executor",
    goalID: goal.id,
    parentID: parentSessionID,
    title: `Build: ${goal.title}`,
    directory: worktreeDir,
  })
  // Build container session inherits the same permission contract as
  // createBuildSession: fall through to PermissionNext + AutoPermission,
  // don't hardcode allow-all. See createBuildSession for rationale.

  const specsText = renderSpecsAsText(goal.acceptance_specs ?? [])
  const ownedPaths = Array.isArray(goal.owned_paths) ? goal.owned_paths : []
  const headerLines = [
    `# Build goal: ${goal.title}`,
    "",
    goal.objective?.trim() || "(no objective)",
    "",
    "## Dispatch",
    `- worktree: ${worktreeDir}`,
    `- branch: ${worktreeBranch}`,
    ownedPaths.length > 0 ? `- owned paths: ${ownedPaths.join(", ")}` : "",
    "",
    "## Acceptance",
    specsText.trim() || "(no acceptance specs)",
  ].filter((line) => line !== "").join("\n")

  const messageID = Identifier.ascending("message")
  const now = Date.now()
  const info = {
    id: messageID,
    sessionID: session.id,
    role: "assistant" as const,
    parentID: `${task.id}:${goal.id}:build-dispatch`,
    modelID: "build-dispatch",
    providerID: "build-dispatch",
    agent: "build",
    path: {
      cwd: worktreeDir,
      root: worktreeDir,
    },
    time: {
      created: now,
      completed: now,
    },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  }
  await Session.saveMessage(info as any)
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID,
    sessionID: session.id,
    type: "text",
    text: headerLines,
  } as any)
  await Session.updateMessage(info as any)
  return session
}

/**
 * Create the per-goal **evaluator** session — no LLM of its own; the
 * sessionStreamHooks attached to it by the caller let the pure-function
 * `evaluateGoal` (shell runner + rubric judge) broadcast per-command
 * output so the overlay's evaluate phase card shows live progress.
 *
 * Like createBuildSession, parentID points at the executor container so
 * the session nests into the goal's step in the overlay's hierarchy.
 * `directory` is the per-goal worktree — evaluator shells out there.
 */
export async function createEvaluatorSession(
  task: TaskRow,
  goal: GoalRow,
  worktreeDir: string,
  parentSessionID: string,
) {
  const session = await Session.createNext({
    kind: "evaluator",
    goalID: goal.id,
    parentID: parentSessionID,
    title: `Evaluate: ${goal.title}`,
    directory: worktreeDir,
  })
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

/**
 * Compose the "Prior Attempt Failed" section that retries see in their prompt.
 *
 * spec-09 change (Phase C): reads the structured `VerificationEvidence` row
 * written by goal-pool.ts right after `evaluateGoal`. Strict failures surface
 * `spec_id`, `scorer_kind`, `exit_code`, and truncated `evidence` body so the
 * executor has specific mechanical signals — not just a natural-language
 * "retry analysis" fragment.
 *
 * The coordinator's decision-log retry entries stay as auxiliary context.
 *
 * Returns "" on first attempts (no prior failure) — callers should `.filter(Boolean)`.
 */
/**
 * Retry feedback for a goal that was rejected on a prior attempt.
 *
 * Pulls from the decision log's "retry" entries (written by
 * `retry_failed_goals` after the delivery agent rejects) — that is the
 * single authoritative source now that the per-goal evaluator is gone
 * (2026-04-20). The orchestrator's retry tool writes a structured
 * `retry_analysis_<goalID>` entry containing the delivery agent's
 * rejection_details + coordinator's root-cause analysis; the executor
 * reads that on its next attempt.
 *
 * Returns "" on first attempts (no retry entry yet). Callers should
 * `.filter(Boolean)` the composition chain.
 */
export function buildRetryFeedbackSection(taskID: string, goalID: string): string {
  const decisionLog = createDecisionLog(taskID)
  const retryEntries = decisionLog
    .readByPhase("retry")
    .filter((e) => e.goalID === goalID)
  if (retryEntries.length === 0) return ""

  const lines: string[] = []
  lines.push("## Prior Attempt Failed — Read This Before Implementing")
  lines.push("")
  lines.push(
    "The previous attempt at this goal was rejected by the delivery agent. " +
      "This worktree still contains your prior attempt files — read them, " +
      "compare them to the rejections below, and edit in place. Do NOT start " +
      "over from a clean slate unless the failure requires a structural rewrite.",
  )
  lines.push("")

  lines.push("### Coordinator Root-Cause Analysis + Delivery Agent Rejections")
  for (const entry of retryEntries) {
    const reasonSuffix = entry.reason ? ` — _why: ${entry.reason}_` : ""
    lines.push(`- ${entry.value}${reasonSuffix}`)
  }
  lines.push("")

  lines.push("### Required For This Retry")
  lines.push("- Read every rejection above before writing any code.")
  lines.push("- Address each concrete issue the delivery agent cited.")
  lines.push("- Do NOT repeat an approach that was already tried and rejected above.")
  lines.push("- If the root cause sits outside your owned_paths, report it as a SCOPE BLOCKER instead of widening scope.")

  return lines.join("\n")
}

/**
 * Build the executor's prompt for a single goal.
 *
 * CONTRACT: The caller MUST have written the intent bundle at
 * `<cwd>/.opencorvus/intent/` before invoking this. The prompt
 * unconditionally references the bundle (clarifications.md,
 * operator-notes.md, request.md) as the executor's authoritative
 * channel for the user's original material. If the caller forgets
 * to mount the bundle, the executor will fail to read the files and
 * surface a loud error — that is the correct failure mode. Do NOT
 * add a conditional to suppress the bundle reference: there is no
 * supported mode where executor runs without a mounted bundle.
 */
export function buildGoalPrompt(input: {
  plan: PlanRow
  node: PlanNodeRow
  goal: GoalRow
  taskRequest?: string
  taskID?: string
  /** Direct dependencies only — caller already filtered by goal.depends_on. */
  dependencies?: GoalRow[]
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
  const dependencyContext = input.dependencies && input.dependencies.length > 0
    ? input.dependencies
        .map((g) => `- "${g.title}" (completed, output in your workspace)`)
        .join("\n")
    : ""
  // Include architect consensus from Decision Log (interface contracts, directory blueprint, naming conventions).
  // Only populated when Orchestrator called architect(); empty string if skipped (single goal / simple task).
  // Goal-scoped read: peer goals' private architect notes do not bleed into this executor's prompt.
  const architectConsensus = input.taskID
    ? createDecisionLog(input.taskID).phasePromptSectionForGoal("architect", input.goal.id, "Architect Consensus")
    : ""

  // Retry feedback: surfaces the latest rejected evaluation + Orchestrator's
  // root-cause analysis so the executor sees what failed last round and what
  // it must change. Empty string on first attempts. Wired into the prompt
  // BEFORE the Goal section so the executor reads failure context first.
  const retryFeedback = input.taskID
    ? buildRetryFeedbackSection(input.taskID, input.goal.id)
    : ""

  return [
    "You are executing one goal in an isolated workspace (git worktree) for the coordinator.",
    input.cwd
      ? `Your working directory is: ${input.cwd}\nAll file paths MUST be relative to this directory or use this absolute prefix. Never write files outside this directory.`
      : undefined,
    // Intent bundle — the authoritative user-provided task material.
    // The caller contract (see function docstring) guarantees that
    // .opencorvus/intent/ is populated before this prompt runs, so the
    // advertisement is unconditional. Goal objectives and plan steps
    // deliberately omit restatement of the user's request — the bundle
    // is the single authoritative channel for original wording,
    // clarifications, and operator notes.
    "## User Intent Bundle\n\nThe user's original request and any clarifications / operator notes for this task are mounted at `.opencorvus/intent/`:\n- `intent/request.md` — the original request, verbatim\n- `intent/clarifications.md` — operator answers (if any)\n- `intent/operator-notes.md` — operator notes added during execution (if any)\n- `intent/README.md` — index of the bundle\n\nRead these files when the goal objective or plan steps reference a section or detail (e.g. \"see intent/request.md §13\"). Do not treat them as read-only hints — they are the authoritative source of truth for user intent.",
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
    retryFeedback || undefined,
    `Goal:
${input.goal.title}: ${input.goal.objective}`,
    `Acceptance:
${renderSpecsAsText(input.goal.acceptance_specs ?? [])}`,
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
    [
      "Mandatory output — every goal MUST produce both:",
      "1. **Deliverables**: the source files, configs, tests, or other artifacts required by this goal. A goal that produces zero file changes is automatically marked FAILED — no exceptions.",
      "2. **Structured report via `goal_report` tool call**: after implementation is complete (or if blocked), you MUST call the `goal_report` tool exactly once as the final action of this goal. The fields are:",
      "   - `files_changed[]`: every touched file with a concrete one- or two-sentence summary of what changed",
      "   - `checks_run[]`: each verification command executed, its exit code, and a relevant output excerpt (omit only for rubric-only goals)",
      "   - `implementation_approach`: the actual implementation — what scheme you used, core structure, key APIs, data flow. The evaluator will cross-check this against the diff; a claim the diff does not support is a rejection.",
      "   - `design_decisions[]`: each non-trivial decision as `{choice, alternatives, reason}`. The evaluator will challenge the reason — a restated choice or a reason the code contradicts is a rejection.",
      "   - `blockers[]`: hard blockers hit during execution (empty when none)",
      "Do NOT end your turn with a free-text summary in place of the tool call. Do NOT call `goal_report` more than once. Do NOT call it as a mid-goal progress update — it is the terminal action. If the tool call is missing, the goal is automatically marked FAILED.",
    ].join("\n"),
  ].filter(Boolean).join("\n\n")
}

/**
 * Extract delivery diffs via the Snapshot subsystem.
 *
 * Snapshot uses a project-scoped git-dir at `data/snapshot/<project.id>/`,
 * completely decoupled from the user project's own `.git` and from the
 * per-goal worktree's HEAD. Each `Snapshot.track()` call uses a private
 * `GIT_INDEX_FILE=index-<ts>-<rand>` so concurrent goals cannot corrupt
 * each other's staging state.
 *
 * Caller contract: must wrap with `Instance.provide({ directory: worktreeDir, ... })`
 * so that `Snapshot.track()` reads files from the per-goal worktree. The
 * `baseRef` must have been captured (also inside `Instance.provide(worktreeDir)`)
 * immediately before the executor started — otherwise there is no stable
 * "before" tree to diff against, and the result is meaningless.
 *
 * Why not `git add -A; git diff --cached HEAD` on the worktree's own git?
 * Because it depends on the worktree's HEAD being the exact "pre-execution"
 * tree. If the executor (or any hook) advances HEAD, the diff collapses to
 * empty — silently producing a false-negative delivery. Snapshot tree-hash
 * diffs are immune: `baseRef` is a committed tree hash, immutable.
 */
/**
 * Remove nested `.git` entries anywhere under `worktreeDir` except the
 * worktree's own `.git` at the root.
 *
 * Why: scaffolding tools (`create-next-app`, `vite create`, `npm init`, etc.)
 * run `git init` inside the generated directory. If those nested repos
 * survive to delivery time, both the snapshot subsystem's `git add .` and
 * the per-goal worktree's own `git add` auto-convert them into gitlink
 * entries (index mode 160000) — the commit captures a submodule SHA pointer
 * instead of the scaffolded files. When that commit is cherry-picked back
 * into the main project, the target directory is an empty submodule pointer
 * and the user sees no generated code.
 *
 * Let it crash: fs.rm / fs.readdir errors propagate. This runs after the
 * executor has terminated, so there is no concurrent writer to race with.
 *
 * Skips `node_modules` because (a) it's noise the snapshot subsystem already
 * ignores via BASELINE_EXCLUDE and (b) it contains many `.git`-less package
 * trees whose traversal is expensive and unnecessary.
 */
export async function stripNestedGitDirs(worktreeDir: string): Promise<string[]> {
  const stripped: string[] = []
  async function walk(dir: string, atRoot: boolean): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch((err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return []
      throw err
    })
    for (const entry of entries) {
      if (entry.name === ".git") {
        if (atRoot) continue
        const full = path.join(dir, entry.name)
        await fs.rm(full, { recursive: true, force: true })
        stripped.push(path.relative(worktreeDir, full).replaceAll("\\", "/"))
        continue
      }
      if (entry.name === "node_modules") continue
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), false)
      }
    }
  }
  await walk(worktreeDir, true)
  return stripped
}

export async function deliveryFromSnapshot(
  baseRef: string | undefined,
  prefix: string,
): Promise<{ mergeRef: string | undefined; delivery: { summary: string; commitRef?: string; diffs: z.infer<typeof Snapshot.FileDiff>[] } }> {
  if (!baseRef) {
    throw new Error("deliveryFromSnapshot: baseRef is required — it must be captured via Snapshot.track() BEFORE executor starts, inside Instance.provide({ directory: worktreeDir }). Missing baseRef means the upstream dispatch code forgot to snapshot the pre-execution tree.")
  }
  const stripped = await stripNestedGitDirs(Instance.worktree)
  if (stripped.length > 0) {
    log.info("stripped nested .git before delivery snapshot", { count: stripped.length, paths: stripped })
  }
  const mergeRef = await Snapshot.track()
  if (!mergeRef) {
    throw new Error("deliveryFromSnapshot: Snapshot.track() returned empty — the project is not a git repo or snapshot is disabled in config, which is incompatible with per-goal worktree delivery extraction.")
  }
  const rawDiffs = await Snapshot.diffFull(baseRef, mergeRef)
  const diffs = filterDeliveryDiffs(rawDiffs)
  const commitRef = diffs.length > 0 ? await createGoalDeliveryCommit(diffs, prefix) : undefined
  log.info("snapshot delivery extracted", { baseRef, mergeRef, files: diffs.length, fileNames: diffs.map((d) => d.file) })
  return {
    mergeRef,
    delivery: {
      summary: summary(prefix, diffs.map((d) => d.file)),
      commitRef,
      diffs,
    },
  }
}

export async function createGoalDeliveryCommit(
  diffs: Array<{ file: string; status?: string }>,
  prefix: string,
): Promise<string> {
  const files = [...new Set(diffs.map((item) => item.file).filter(Boolean))]
  if (files.length === 0) {
    throw new Error("createGoalDeliveryCommit: delivery has no files to commit")
  }

  const addResult = await $`git add -A -- ${files}`.quiet().cwd(Instance.directory).nothrow()
  if (addResult.exitCode !== 0) {
    const stderr = addResult.stderr.toString().trim() || addResult.stdout.toString().trim() || "git add failed"
    throw new Error(`createGoalDeliveryCommit: git add failed: ${stderr}`)
  }

  // Invariant: staged entries must be regular files, not gitlinks. Mode 160000
  // is a submodule pointer — it captures only a SHA, never the underlying
  // files. Reaching this branch means stripNestedGitDirs() missed a nested
  // `.git` (e.g. a .git *file* pointer or a race); fail loud so the scaffold
  // path is fixed rather than silently shipping an empty submodule pointer.
  const lsResult = await $`git ls-files --stage -- ${files}`.quiet().cwd(Instance.directory).nothrow()
  if (lsResult.exitCode !== 0) {
    const stderr = lsResult.stderr.toString().trim() || lsResult.stdout.toString().trim() || "git ls-files failed"
    throw new Error(`createGoalDeliveryCommit: git ls-files failed: ${stderr}`)
  }
  const gitlinks = lsResult.stdout
    .toString()
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("160000 "))
    .map((l) => l.split("\t")[1] ?? "")
    .filter(Boolean)
  if (gitlinks.length > 0) {
    throw new Error(
      `createGoalDeliveryCommit: delivery contains submodule pointer(s) instead of real files: ${gitlinks.join(", ")}. This happens when a nested .git (from create-next-app, vite create, npm init, etc.) survived stripNestedGitDirs(). Fix the stripping logic; do not commit gitlinks.`,
    )
  }

  const commitMessage = `${prefix} delivery`
  const commitResult = await $`git -c user.email=opencorvus@local -c user.name=OpenCorvus commit -m ${commitMessage}`
    .quiet()
    .cwd(Instance.directory)
    .nothrow()
  if (commitResult.exitCode !== 0) {
    const stderr = commitResult.stderr.toString().trim() || commitResult.stdout.toString().trim() || "git commit failed"
    throw new Error(`createGoalDeliveryCommit: git commit failed: ${stderr}`)
  }

  const revParse = await $`git rev-parse HEAD`.quiet().cwd(Instance.directory).nothrow().text()
  const commitRef = revParse.trim()
  if (!commitRef) {
    throw new Error("createGoalDeliveryCommit: git rev-parse HEAD returned empty")
  }
  return commitRef
}
