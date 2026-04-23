/**
 * Merge-conflict resolution path.
 *
 * When cherry-picking a goal's delivery commit into the main worktree fails
 * with a textual conflict, the orchestrator does NOT throw outright. Instead
 * it hands resolution to the goal's executor agent, which understands both
 * goals' intent and can reconcile the conflict semantically — the same
 * adversarial-merge motion a human reviewer performs during a PR rebase.
 *
 * Scope: THIS MODULE ONLY handles textual merge reconciliation. It does not
 * validate the merged result by running any build / test / lint command. That
 * responsibility belongs to the delivery agent and task-declared verify
 * contracts — see `orchestrator/tools.ts` DELIVERY_AGENT_SYSTEM. Embedding a
 * language-specific build gate here (e.g. `bun run build`) was removed because
 * it coupled merge semantics to one toolchain and only fired on the conflict
 * path, creating an asymmetric check that clean cherry-picks never saw.
 *
 * Design guarantees:
 *
 *   • Main is NEVER left half-merged. Every early-exit path resets the
 *     primary worktree to `mainTip` (the HEAD captured before cherry-pick).
 *
 *   • Everything runs under the caller's serialisation lock (Worktree.lock
 *     in runtime.ts). `mainTip` cannot drift during resolution because no
 *     other merge runs in parallel, so a later `git merge --ff-only` is
 *     guaranteed to fast-forward.
 *
 *   • The goal worktree shares its `.git` with the primary — we merge
 *     `mainTip` INTO the goal branch there (in-place), executor edits the
 *     conflict markers, then we fast-forward main to the new goal-branch
 *     tip. No file copying, no rebase, no external fetch.
 *
 *   • On cap exhaustion we hard-fail the goal and emit a
 *     `merge_conflict_cap_reached` decision-log entry so retry_goal
 *     and future operators see the reason.
 */
import path from "path"
import { mkdir, writeFile } from "fs/promises"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { createDecisionLog } from "@/decision-log"
import { createBuildSession } from "@/goal/runner"
import { Instance } from "@/project/instance"
import { EngineConfig } from "./config"

const log = Log.create({ service: "merge-resolver" })

export interface ResolveMergeConflictInput {
  /** The task this goal belongs to — used for decision-log writes + session creation. */
  task: import("./store").TaskRow
  /** The goal_run whose delivery cherry-pick conflicted. */
  goalRun: import("./store").GoalRunRow
  /** The goal row — needed for title / owned_paths / parent session lookup. */
  goal: { id: string; title: string; objective?: string | null; workspace_dir?: string | null }
  /** The (failed) cherry-pick commit ref. Only used in prompts / conflict notes. */
  commitRef: string
  /** Path to the goal's own worktree (on the goal branch). */
  goalWorkDir: string
  /** Path to the primary worktree (main). */
  primaryWorkDir: string
  /** `git rev-parse HEAD` of the primary worktree captured BEFORE cherry-pick
   *  aborted. Used as the merge source inside the goal worktree. */
  mainTip: string
  /** Initial cherry-pick stderr, surfaced into the first conflict note so
   *  executor sees the exact git message it needs to reconcile. */
  initialStderr: string
}

export interface ResolveMergeConflictResult {
  resolved: boolean
  /** On success: the new goal-branch tip that main should fast-forward to. */
  newGoalBranchTip?: string
  /** On failure: a short operator-facing reason (also written to decision log). */
  error?: string
}

export interface MergeResolverState {
  head: string
  stillMerging: boolean
  conflictingFiles: string[]
  ancestryOK: boolean
  dirtyEntries: string[]
}

/**
 * Attempt to resolve a cherry-pick conflict by handing the goal worktree to
 * the executor agent. Caller MUST hold the Worktree merge lock.
 *
 * Behaviour per attempt (up to `delivery.merge_conflict_max_retries`):
 *   1. Inspect the goal worktree state.
 *   2. If it already has a clean merged tip that descends from `mainTip`,
 *      fast-forward primary directly — no executor session needed.
 *   3. Otherwise rewind to `goalBranchTip` and replay
 *      `git merge --no-commit --no-ff <mainTip>` to reproduce the conflict.
 *   4. Write `.opencorvus/merge-conflict/<goalID>.md` with context.
 *   5. Dispatch a build-kind session with a resolver prompt.
 *   6. Verify the resolver actually produced a committed merged tip.
 *   7. `git merge --ff-only <new-tip>` in primary.
 *   8. Cap exhausted → reset primary, write decision_log, return failure.
 */
export async function resolveMergeConflict(
  input: ResolveMergeConflictInput,
): Promise<ResolveMergeConflictResult> {
  const cfg = await EngineConfig.get()
  const cap = Math.max(1, cfg.delivery.merge_conflict_max_retries ?? 2)
  const { $ } = await import("bun")
  const { task, goalRun, goal, commitRef, goalWorkDir, primaryWorkDir, mainTip } = input

  // Capture goal-branch tip once — it should not change between attempts since
  // only executor edits the worktree and each attempt rewinds before editing.
  const goalBranchTipResult = await $`git rev-parse HEAD`.cwd(goalWorkDir).quiet().nothrow()
  if (goalBranchTipResult.exitCode !== 0) {
    return {
      resolved: false,
      error: `resolveMergeConflict: cannot read goal-branch HEAD (exit=${goalBranchTipResult.exitCode})`,
    }
  }
  const goalBranchTip = goalBranchTipResult.stdout.toString().trim()
  if (!goalBranchTip) {
    return { resolved: false, error: "resolveMergeConflict: empty goal-branch HEAD" }
  }

  let lastError: string | undefined

  for (let attempt = 1; attempt <= cap; attempt++) {
    log.info("merge-conflict resolver attempt", {
      goalRunID: goalRun.id,
      goalID: goal.id,
      attempt,
      cap,
      mainTip,
      goalBranchTip,
    })

    let conflictingFiles: string[] = []
    let state = await inspectMergeResolverState(goalWorkDir, mainTip)

    if (canReuseMergedGoalState(state, mainTip)) {
      log.info("merge-conflict resolver: reusing already-merged goal state", {
        goalRunID: goalRun.id,
        attempt,
        head: state.head,
        dirtyEntries: state.dirtyEntries,
      })
      const ff = await fastForwardPrimary({
        goalRunID: goalRun.id,
        attempt,
        newTip: state.head,
        goalWorkDir,
        primaryWorkDir,
        mainTip,
      })
      if (ff.ok) {
        return { resolved: true, newGoalBranchTip: state.head }
      }
      lastError = ff.error
      continue
    }

    // Rebuild a fresh merge only when the worktree is not already at a
    // valid merged tip. This preserves successful resolver commits across
    // retries instead of erasing them on every loop.
    await $`git merge --abort`.cwd(goalWorkDir).quiet().nothrow()
    await $`git reset --hard ${goalBranchTip}`.cwd(goalWorkDir).quiet().nothrow()

    const merge = await $`git merge --no-commit --no-ff ${mainTip}`.cwd(goalWorkDir).quiet().nothrow()
    const mergeHeadCheck = await $`git rev-parse --verify MERGE_HEAD`.cwd(goalWorkDir).quiet().nothrow()
    if (mergeHeadCheck.exitCode !== 0) {
      lastError =
        `git merge ${mainTip} did not leave a MERGE_HEAD in ${goalWorkDir} ` +
        `(exit=${merge.exitCode}, stderr=${merge.stderr.toString().trim() || "(none)"})`
      log.error("merge-conflict resolver: merge setup failed", { goalRunID: goalRun.id, lastError })
      break
    }

    state = await inspectMergeResolverState(goalWorkDir, mainTip)
    conflictingFiles = state.conflictingFiles

    // Write conflict context note inside the goal worktree so the executor
    // can read it as `.opencorvus/merge-conflict/<goalID>.md`.
    const notePath = path.join(goalWorkDir, ".opencorvus", "merge-conflict", `${goal.id}.md`)
    await mkdir(path.dirname(notePath), { recursive: true })
    const noteBody = buildConflictNote({
      goal,
      commitRef,
      mainTip,
      conflictingFiles,
      initialStderr: input.initialStderr,
      attempt,
      cap,
    })
    await writeFile(notePath, noteBody, "utf8")

    // Dispatch resolver session. Reuses the `build` agent — same tool set
    // (edit_file / write_file / run_command / read_file) is exactly what
    // reconciling conflict markers needs.
    const resolverSession = await createBuildSession(
      task,
      goal as any,
      goalWorkDir,
      goalRun.session_id ?? task.session_id ?? undefined,
    )
    let resolverError: string | undefined
    try {
      const { SessionPrompt } = await import("@/session/prompt")
      const { Agent } = await import("@/agent/agent")
      const { Provider } = await import("@/provider/provider")
      const buildAgent = await Agent.get("build")
      const resolverModel = buildAgent?.model ?? (await Provider.defaultModel())
      const promptText = buildMergeResolverPrompt({
        goal,
        notePath: path.relative(goalWorkDir, notePath).replace(/\\/g, "/"),
        conflictingFiles,
      })
      await Instance.provide({
        directory: goalWorkDir,
        fn: async () => {
          await SessionPrompt.prompt({
            sessionID: resolverSession.id,
            messageID: Identifier.ascending("message"),
            agent: "build",
            // Explicit model. Without this the SessionPrompt fallback chain
            // ends up calling Provider.defaultModel() implicitly, and the
            // failure path there lost context — resolving upfront gives a
            // meaningful MissingModelConfigError with the "build" scope.
            model: { providerID: resolverModel.providerID, modelID: resolverModel.modelID },
            // goal_report is the goal-completion signal; the resolver is
            // NOT completing a goal (it's reconciling a merge), so deny
            // it to avoid the build-agent system prompt coaxing the
            // resolver into emitting a spurious terminal report.
            tools: { goal_report: false },
            parts: [{ type: "text", text: promptText }],
          })
        },
      })
    } catch (err) {
      resolverError = err instanceof Error ? err.message : String(err)
      // Surface structured error payloads (provider/model ids, suggestions)
      // into the resolver's error string so DB diagnostics beat out the
      // opaque "ProviderModelNotFoundError" message form.
      const data = (err as { data?: Record<string, unknown> })?.data
      if (data) {
        const parts = Object.entries(data)
          .filter(([, v]) => v !== undefined && v !== null && v !== "")
          .map(([k, v]) => `${k}=${Array.isArray(v) ? JSON.stringify(v) : String(v)}`)
        if (parts.length > 0) resolverError += ` [${parts.join(" ")}]`
      }
    }

    // Verify the resolver actually produced a committed merged tip.
    state = await inspectMergeResolverState(goalWorkDir, mainTip)
    if (resolverError || !canReuseMergedGoalState(state, mainTip)) {
      lastError =
        `resolver session ${resolverSession.id} did not produce a reusable merged tip ` +
        `(resolverError=${resolverError ?? "none"}, stillMerging=${state.stillMerging}, ` +
        `conflicts=${state.conflictingFiles.length}, head=${state.head || "(empty)"}, ` +
        `ancestryOK=${state.ancestryOK}, beyondMainTip=${state.head !== "" && state.head !== mainTip})`
      log.warn("merge-conflict resolver: attempt did not produce a reusable merged tip", {
        goalRunID: goalRun.id,
        attempt,
        lastError,
        dirtyEntries: state.dirtyEntries,
        conflictingFiles: state.conflictingFiles,
      })
      continue
    }

    // Fast-forward primary.
    const merged = await fastForwardPrimary({
      goalRunID: goalRun.id,
      attempt,
      newTip: state.head,
      goalWorkDir,
      primaryWorkDir,
      mainTip,
    })
    if (merged.ok) {
      return { resolved: true, newGoalBranchTip: state.head }
    }
    lastError = merged.error
  }

  // Cap exhausted. Primary is already at mainTip (either it never moved, or
  // we reset it above). Write decision log + return.
  try {
    const decisionLog = createDecisionLog(task.id)
    decisionLog.append({
      goalID: goal.id,
      phase: "retry",
      key: `merge_conflict_cap_reached_${goal.id}`,
      value: `[merge_conflict] exhausted ${cap} resolver attempts — goal cannot cleanly integrate with the current main`,
      reason: lastError ?? "unknown",
    })
  } catch (err) {
    log.warn("merge-conflict resolver: decision-log write failed (non-fatal)", {
      goalRunID: goalRun.id, error: err instanceof Error ? err.message : String(err),
    })
  }

  return {
    resolved: false,
    error: lastError ?? `merge_conflict: cap (${cap}) exhausted`,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FastForwardResult {
  ok: boolean
  error?: string
}

/**
 * A goal-worktree state is "reusable" when we can fast-forward the primary
 * worktree to `state.head` directly, without running any more merge machinery.
 *
 * The four invariants:
 *   1. `!stillMerging`     — no MERGE_HEAD lingering; there is a real commit at HEAD.
 *   2. `conflictingFiles=0`— no `UU` entries; nothing half-resolved.
 *   3. `ancestryOK`        — HEAD descends from `mainTip`, so `git merge --ff-only`
 *                            on primary is guaranteed to fast-forward.
 *   4. `head !== mainTip`  — HEAD carries delta beyond main; otherwise the
 *                            "merge" would deliver nothing and a fast-forward
 *                            would be a no-op.
 */
export function canReuseMergedGoalState(state: MergeResolverState, mainTip: string): boolean {
  return !state.stillMerging
    && state.conflictingFiles.length === 0
    && state.ancestryOK
    && state.head !== mainTip
}

export async function inspectMergeResolverState(
  workDir: string,
  mainTip: string,
): Promise<MergeResolverState> {
  const { $ } = await import("bun")
  const headResult = await $`git rev-parse HEAD`.cwd(workDir).quiet().nothrow()
  const head = headResult.exitCode === 0 ? headResult.stdout.toString().trim() : ""

  const conflictResult = await $`git diff --name-only --diff-filter=U`.cwd(workDir).quiet().nothrow()
  const conflictingFiles = conflictResult.stdout.toString().trim().split("\n").filter((s) => s.length > 0)

  const statusResult = await $`git status --porcelain`.cwd(workDir).quiet().nothrow()
  const dirtyEntries = statusResult.stdout.toString().split("\n").map((line) => line.trim()).filter((line) => line.length > 0)

  const stillMerging = (await $`git rev-parse --verify MERGE_HEAD`.cwd(workDir).quiet().nothrow()).exitCode === 0
  const ancestryOK = head.length > 0
    && (await $`git merge-base --is-ancestor ${mainTip} ${head}`.cwd(workDir).quiet().nothrow()).exitCode === 0

  return {
    head,
    stillMerging,
    conflictingFiles,
    ancestryOK,
    dirtyEntries,
  }
}

async function fastForwardPrimary(input: {
  goalRunID: string
  attempt: number
  newTip: string
  goalWorkDir: string
  primaryWorkDir: string
  mainTip: string
}): Promise<FastForwardResult> {
  const { $ } = await import("bun")
  const ff = await $`git merge --ff-only ${input.newTip}`.cwd(input.primaryWorkDir).quiet().nothrow()
  if (ff.exitCode !== 0) {
    const error =
      `git merge --ff-only ${input.newTip} on primary failed: ` +
      (ff.stderr.toString().trim() || ff.stdout.toString().trim())
    log.error("merge-conflict resolver: ff-only failed (invariant break?)", {
      goalRunID: input.goalRunID,
      attempt: input.attempt,
      error,
    })
    await $`git reset --hard ${input.mainTip}`.cwd(input.primaryWorkDir).quiet().nothrow()
    return { ok: false, error }
  }

  log.info("merge-conflict resolved; primary fast-forwarded", {
    goalRunID: input.goalRunID,
    attempt: input.attempt,
    newTip: input.newTip,
  })
  await cleanupConflictNote(input.goalWorkDir)
  return { ok: true }
}

async function cleanupConflictNote(goalWorkDir: string): Promise<void> {
  const { $ } = await import("bun")
  await $`git rm -rf --ignore-unmatch .opencorvus/merge-conflict`.cwd(goalWorkDir).quiet().nothrow()
}

function buildConflictNote(input: {
  goal: { id: string; title: string; objective?: string | null }
  commitRef: string
  mainTip: string
  conflictingFiles: string[]
  initialStderr: string
  attempt: number
  cap: number
}): string {
  const lines: string[] = []
  lines.push(`# Merge Conflict — goal \`${input.goal.id}\``)
  lines.push("")
  lines.push(`**Goal title:** ${input.goal.title}`)
  if (input.goal.objective) {
    lines.push(`**Objective:** ${input.goal.objective.trim()}`)
  }
  lines.push(`**Attempt:** ${input.attempt} / ${input.cap}`)
  lines.push(`**Main tip at conflict:** \`${input.mainTip}\``)
  lines.push(`**Your commit:** \`${input.commitRef}\``)
  lines.push("")
  lines.push("## What happened")
  lines.push("")
  lines.push(
    "The orchestrator tried to cherry-pick your goal's commit into main, but it " +
      "conflicted with other goals that landed on main while you were running. To " +
      "give you a clean semantic view of the conflict, main has now been merged INTO " +
      "your goal branch inside your worktree (`git merge --no-commit --no-ff`). The " +
      "files below have `<<<<<<<` / `=======` / `>>>>>>>` markers.",
  )
  lines.push("")
  lines.push("## Conflicting files")
  lines.push("")
  if (input.conflictingFiles.length === 0) {
    lines.push("_(git did not report any `UU` files — verify with `git status` yourself.)_")
  } else {
    for (const f of input.conflictingFiles) lines.push(`- \`${f}\``)
  }
  lines.push("")
  lines.push("## Initial cherry-pick stderr (for context)")
  lines.push("")
  lines.push("```")
  lines.push(input.initialStderr.trim() || "(empty)")
  lines.push("```")
  lines.push("")
  lines.push(
    "When you finish, `git add -A && git commit -m \"merge main: resolve conflict for goal " +
      input.goal.id +
      "\"`.",
  )
  return lines.join("\n")
}

function buildMergeResolverPrompt(input: {
  goal: { id: string; title: string; objective?: string | null }
  notePath: string
  conflictingFiles: string[]
}): string {
  const lines: string[] = []
  lines.push(
    `You are resolving a git merge conflict inside the worktree for goal \`${input.goal.id}\` (${input.goal.title}).`,
  )
  lines.push("")
  lines.push("## Why you're here")
  lines.push("")
  lines.push(
    `Main has been updated by other goals since you first ran. The orchestrator has ` +
      `already merged main into your goal branch with \`git merge --no-commit --no-ff\`, ` +
      `so your worktree currently has conflict markers (\`<<<<<<<\` / \`=======\` / \`>>>>>>>\`) ` +
      `in several files. Your job is to reconcile them.`,
  )
  lines.push("")
  lines.push(
    `A detailed context note is at \`${input.notePath}\` — READ IT FIRST. It lists ` +
      `the main tip, your own commit ref, and the current conflict state.`,
  )
  lines.push("")
  lines.push("## How to resolve")
  lines.push("")
  lines.push("1. For every conflicting file, open it and read both sides of each `<<<<<<<` / `>>>>>>>` block.")
  lines.push("   - The \"HEAD\" side is YOUR goal's code.")
  lines.push("   - The incoming side (after `=======`) is main's code — the other goals' work.")
  lines.push("   - Reconcile so BOTH goals' intents are preserved. If they conflict on the same line, prefer the resolution that keeps both features working.")
  lines.push("2. Remove every conflict marker. Do not leave any `<<<<<<<` / `=======` / `>>>>>>>` in the tree.")
  lines.push("3. When all markers are resolved, commit: `git add -A && git commit -m \"merge main: resolve conflict for goal " + input.goal.id + "\"`.")
  lines.push("")
  lines.push("## Rules")
  lines.push("")
  lines.push("- Do NOT invent new features. Do NOT extend either goal's scope.")
  lines.push("- Do NOT rewrite code that was not in conflict — touch only the lines you must.")
  lines.push("- Do NOT skip the commit step. The orchestrator verifies that HEAD advances to a reusable merged tip; uncommitted fixes do not count.")
  lines.push("- If the two goals truly want opposite behaviour on the same API, pick the union that preserves both (e.g. add a config switch) and document it briefly in the commit message.")
  if (input.conflictingFiles.length > 0) {
    lines.push("")
    lines.push("## Files in conflict")
    lines.push("")
    for (const f of input.conflictingFiles) lines.push(`- \`${f}\``)
  }
  return lines.join("\n")
}
