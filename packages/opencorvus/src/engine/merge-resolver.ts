/**
 * P2 merge-conflict resolution path (2026-04-20).
 *
 * When cherry-picking a goal's delivery commit into the main worktree fails
 * with a textual conflict, the orchestrator does NOT throw outright. Instead
 * it hands resolution to the goal's executor agent, which understands both
 * goals' intent and can reconcile the conflict semantically — the same
 * adversarial-merge motion a human reviewer performs during a PR rebase.
 *
 * Design guarantees (must stay true for the path to be safe):
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
 *     conflict markers via existing edit_file / write_file tools, then we
 *     fast-forward main to the new goal-branch tip. No file copying, no
 *     rebase, no external fetch.
 *
 *   • On cap exhaustion we hard-fail the goal and emit a
 *     `merge_conflict_cap_reached` decision-log entry so retry_failed_goals
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

/**
 * Attempt to resolve a cherry-pick conflict by handing the goal worktree to
 * the executor agent. Caller MUST hold the Worktree merge lock.
 *
 * Behaviour per attempt (up to `delivery.merge_conflict_max_retries`):
 *   1. Reset the goal worktree to goal-branch tip, abort any prior merge.
 *   2. `git merge --no-commit --no-ff <mainTip>` → conflict markers appear.
 *   3. Write `.opencorvus/merge-conflict/<goalID>.md` with context.
 *   4. Dispatch a build-kind session with a resolver prompt.
 *   5. Executor edits files + `git add -A && git commit` itself.
 *   6. Verify the worktree is clean and HEAD descends from mainTip.
 *   7. `git merge --ff-only <new-tip>` in primary.
 *   8. Post-merge build verification (`bun run build` / discovered).
 *   9. Build fail → reset primary to mainTip and retry with build error
 *      attached to the next conflict note.
 *  10. Cap exhausted → reset primary, write decision_log, return failure.
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
  let lastBuildFailure: string | undefined

  for (let attempt = 1; attempt <= cap; attempt++) {
    log.info("merge-conflict resolver attempt", {
      goalRunID: goalRun.id,
      goalID: goal.id,
      attempt,
      cap,
      mainTip,
      goalBranchTip,
    })

    // 1. Reset the goal worktree to its pure goal-branch state.
    await $`git merge --abort`.cwd(goalWorkDir).quiet().nothrow()
    await $`git reset --hard ${goalBranchTip}`.cwd(goalWorkDir).quiet().nothrow()

    // 2. Merge main tip into goal branch WITHOUT committing — creates markers.
    //    Non-zero exit is expected (that's why we're here). We check
    //    afterwards whether the merge actually left a mergeable-with-conflicts
    //    state (MERGE_HEAD present) vs an outright failure (e.g. empty repo).
    const merge = await $`git merge --no-commit --no-ff ${mainTip}`.cwd(goalWorkDir).quiet().nothrow()
    const mergeHeadCheck = await $`git rev-parse --verify MERGE_HEAD`.cwd(goalWorkDir).quiet().nothrow()
    if (mergeHeadCheck.exitCode !== 0) {
      // No MERGE_HEAD means the merge command failed before even entering
      // conflict state — e.g. `mainTip` unreachable, detached HEAD, disk issue.
      lastError =
        `git merge ${mainTip} did not leave a MERGE_HEAD in ${goalWorkDir} ` +
        `(exit=${merge.exitCode}, stderr=${merge.stderr.toString().trim() || "(none)"})`
      log.error("merge-conflict resolver: merge setup failed", { goalRunID: goalRun.id, lastError })
      break
    }

    // 3. Write conflict context note inside the goal worktree so the executor
    //    can read it as `.opencorvus/merge-conflict/<goalID>.md`.
    const conflictingFilesResult = await $`git diff --name-only --diff-filter=U`.cwd(goalWorkDir).quiet().nothrow()
    const conflictingFiles = conflictingFilesResult.stdout.toString().trim().split("\n").filter((s) => s.length > 0)
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
      priorBuildFailure: lastBuildFailure,
    })
    await writeFile(notePath, noteBody, "utf8")

    // 4. Dispatch resolver session. Reuses the `build` agent — same tool
    //    set (edit_file / write_file / run_command / read_file) is exactly
    //    what reconciling conflict markers needs.
    const resolverSession = await createBuildSession(
      task,
      goal as any,
      goalWorkDir,
      goalRun.session_id ?? task.session_id ?? undefined,
    )
    let resolverError: string | undefined
    try {
      const { SessionPrompt } = await import("@/session/prompt")
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
    }

    // 5. Verify the resolver actually committed a clean merge.
    const statusPorcelain = await $`git status --porcelain`.cwd(goalWorkDir).quiet().nothrow()
    const worktreeDirty = statusPorcelain.stdout.toString().trim().length > 0
    const headAfter = await $`git rev-parse HEAD`.cwd(goalWorkDir).quiet().nothrow()
    const newTip = headAfter.stdout.toString().trim()
    const stillMerging = (await $`git rev-parse --verify MERGE_HEAD`.cwd(goalWorkDir).quiet().nothrow()).exitCode === 0

    if (resolverError || worktreeDirty || stillMerging || !newTip || newTip === goalBranchTip) {
      lastError =
        `resolver session ${resolverSession.id} did not finish the merge cleanly ` +
        `(resolverError=${resolverError ?? "none"}, dirty=${worktreeDirty}, ` +
        `stillMerging=${stillMerging}, head=${newTip || "(empty)"})`
      log.warn("merge-conflict resolver: dirty worktree after resolver run", {
        goalRunID: goalRun.id, attempt, lastError,
      })
      continue
    }

    // 6. Sanity-check: the new tip MUST descend from mainTip; otherwise
    //    the executor did not actually merge main in, just committed changes.
    const ancestor = await $`git merge-base --is-ancestor ${mainTip} ${newTip}`.cwd(goalWorkDir).quiet().nothrow()
    if (ancestor.exitCode !== 0) {
      lastError = `new goal-branch tip ${newTip} does not descend from mainTip ${mainTip}`
      log.warn("merge-conflict resolver: resolver commit does not include mainTip", {
        goalRunID: goalRun.id, attempt, lastError,
      })
      continue
    }

    // 7. Fast-forward primary. `--ff-only` will error (not silently create a
    //    merge commit) if primary moved — but it cannot have moved because
    //    we hold the lock. If this ever fails it's a real invariant break.
    const ff = await $`git merge --ff-only ${newTip}`.cwd(primaryWorkDir).quiet().nothrow()
    if (ff.exitCode !== 0) {
      lastError =
        `git merge --ff-only ${newTip} on primary failed: ` +
        (ff.stderr.toString().trim() || ff.stdout.toString().trim())
      log.error("merge-conflict resolver: ff-only failed (invariant break?)", {
        goalRunID: goalRun.id, attempt, lastError,
      })
      await $`git reset --hard ${mainTip}`.cwd(primaryWorkDir).quiet().nothrow()
      continue
    }

    // 8. Post-merge build verification in the primary worktree.
    const build = await runPostMergeBuild(primaryWorkDir)
    if (build.ok) {
      log.info("merge-conflict resolved + build passed", {
        goalRunID: goalRun.id, attempt, newTip,
      })
      // Success. Clean up the conflict note so a subsequent read_file from
      // executor on a later retry doesn't pick up this stale record.
      await $`git rm -rf --ignore-unmatch .opencorvus/merge-conflict`.cwd(goalWorkDir).quiet().nothrow()
      return { resolved: true, newGoalBranchTip: newTip }
    }

    // 9. Build failed — roll primary back, carry the output into the next
    //    conflict note so executor sees the build error verbatim.
    await $`git reset --hard ${mainTip}`.cwd(primaryWorkDir).quiet().nothrow()
    lastBuildFailure = build.output
    lastError = `post-merge build failed on attempt ${attempt}: ${build.summary}`
    log.warn("merge-conflict resolver: post-merge build failed; retrying", {
      goalRunID: goalRun.id, attempt, summary: build.summary,
    })
  }

  // 10. Cap exhausted. Primary is already at mainTip (either it never
  //     moved, or we reset it above). Write decision log + return.
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

interface BuildResult {
  ok: boolean
  summary: string
  output: string
}

/** Try to detect and run a project-level build. Returns ok=true when the
 *  project has no obvious build entry (we cannot block merge on absent
 *  config). `summary` is a short one-liner for logs; `output` is the full
 *  stderr+stdout for the next conflict note. */
async function runPostMergeBuild(workDir: string): Promise<BuildResult> {
  const { $ } = await import("bun")
  const { existsSync } = await import("fs")
  const pkgPath = path.join(workDir, "package.json")
  if (!existsSync(pkgPath)) {
    // Non-JS project — skip. Python / shell / docs tasks reach here and we
    // defer verification to delivery agent's Phase 1.
    return { ok: true, summary: "no package.json — skipped", output: "" }
  }
  let pkg: { scripts?: Record<string, string> } = {}
  try {
    pkg = (await (await import("fs/promises")).readFile(pkgPath, "utf8")).length > 0
      ? JSON.parse(await (await import("fs/promises")).readFile(pkgPath, "utf8"))
      : {}
  } catch {
    return { ok: true, summary: "package.json unreadable — skipped", output: "" }
  }
  const scripts = pkg.scripts ?? {}
  if (!scripts.build) {
    return { ok: true, summary: "no build script — skipped", output: "" }
  }
  const res = await $`bun run build`.cwd(workDir).quiet().nothrow()
  const stderr = res.stderr.toString()
  const stdout = res.stdout.toString()
  const output = [stdout, stderr].filter((s) => s.trim().length > 0).join("\n").slice(-8000)
  if (res.exitCode === 0) {
    return { ok: true, summary: "build passed", output }
  }
  const firstLine = stderr.split("\n").find((l) => l.trim().length > 0) ?? "(no stderr)"
  return { ok: false, summary: `build exit=${res.exitCode}: ${firstLine.slice(0, 200)}`, output }
}

function buildConflictNote(input: {
  goal: { id: string; title: string; objective?: string | null }
  commitRef: string
  mainTip: string
  conflictingFiles: string[]
  initialStderr: string
  attempt: number
  cap: number
  priorBuildFailure?: string
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
  if (input.priorBuildFailure && input.priorBuildFailure.trim().length > 0) {
    lines.push("")
    lines.push("## Prior attempt FAILED the post-merge build — address this too")
    lines.push("")
    lines.push("```")
    lines.push(input.priorBuildFailure.slice(-4000))
    lines.push("```")
  }
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
      `the main tip, your own commit ref, every conflicting file, and (if this is a ` +
      `retry attempt) the build error from the previous attempt.`,
  )
  lines.push("")
  lines.push("## How to resolve")
  lines.push("")
  lines.push("1. For every conflicting file, open it and read both sides of each `<<<<<<<` / `>>>>>>>` block.")
  lines.push("   - The \"HEAD\" side is YOUR goal's code.")
  lines.push("   - The incoming side (after `=======`) is main's code — the other goals' work.")
  lines.push("   - Reconcile so BOTH goals' intents are preserved. If they conflict on the same line, prefer the resolution that keeps the project compiling and does not drop either feature.")
  lines.push("2. Remove every conflict marker. Do not leave any `<<<<<<<` / `=======` / `>>>>>>>` in the tree.")
  lines.push("3. Run `bun run build` (or the project's build command from package.json) to verify. If it fails, fix the failure using edit_file / write_file, then re-run.")
  lines.push("4. When the build is green, commit: `git add -A && git commit -m \"merge main: resolve conflict for goal " + input.goal.id + "\"`.")
  lines.push("")
  lines.push("## Rules")
  lines.push("")
  lines.push("- Do NOT invent new features. Do NOT extend either goal's scope.")
  lines.push("- Do NOT rewrite code that was not in conflict — touch only the lines you must.")
  lines.push("- Do NOT skip the commit step. The orchestrator verifies the merge is committed; an un-committed worktree counts as failure.")
  lines.push("- If the two goals truly want opposite behaviour on the same API, pick the union that preserves both (e.g. add a config switch) and document it briefly in the commit message.")
  if (input.conflictingFiles.length > 0) {
    lines.push("")
    lines.push("## Files in conflict")
    lines.push("")
    for (const f of input.conflictingFiles) lines.push(`- \`${f}\``)
  }
  return lines.join("\n")
}
