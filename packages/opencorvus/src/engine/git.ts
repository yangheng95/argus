import { Snapshot } from "@/snapshot"
import { Instance } from "@/project/instance"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { Vcs } from "@/project/vcs"
import { Database, eq } from "@/storage/db"
import { git } from "@/util/git"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { EngineProgressSnapshotTable, EngineTaskTable } from "./engine.sql"
import { ACTIVE_GOAL_RUN_STATUSES } from "./catalog"
import { listGoalRunsForTask, requireTask, type DeliveryRow, type PlanRow, type TaskRow } from "./store"
import fs from "node:fs/promises"
import path from "node:path"

const log = Log.create({ service: "engine-git" })

const AUTHOR = {
  name: "OpenCorvus",
  email: "opencorvus@local",
}

function dict(input: unknown) {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
}

function clean(input: string) {
  return input.replace(/\s+/g, " ").trim()
}

function clip(input: string, limit = 72) {
  const value = clean(input)
  if (value.length <= limit) return value
  return `${value.slice(0, limit - 1).trimEnd()}…`
}

function steps(plan?: PlanRow) {
  const list = dict(plan?.metadata).steps
  if (!Array.isArray(list)) return []
  return list.flatMap((item) => {
    if (typeof item !== "string") return []
    const value = clean(item)
    return value ? [value] : []
  })
}

function body(task: TaskRow, plan?: PlanRow, delivery?: DeliveryRow) {
  const out = [`Task request: ${clean(task.request)}`]
  if (plan?.summary) out.push("", `Plan summary: ${clean(plan.summary)}`)
  const list = steps(plan).slice(0, 5)
  if (list.length > 0) out.push("", "Plan steps:", ...list.map((item) => `- ${item}`))
  if (delivery?.summary) out.push("", `Delivery: ${clean(delivery.summary)}`)
  return out.join("\n")
}

function message(task: TaskRow, mode: "baseline" | "result", plan?: PlanRow, delivery?: DeliveryRow) {
  const base = clip(task.title || task.request, mode === "baseline" ? 54 : 72)
  return {
    subject: mode === "baseline" ? clip(`Checkpoint before ${base}`) : base,
    body: body(task, plan, delivery),
  }
}

function env() {
  return {
    GIT_AUTHOR_NAME: AUTHOR.name,
    GIT_AUTHOR_EMAIL: AUTHOR.email,
    GIT_COMMITTER_NAME: AUTHOR.name,
    GIT_COMMITTER_EMAIL: AUTHOR.email,
  }
}

async function head() {
  const result = await git(["rev-parse", "--verify", "HEAD"], { cwd: Instance.directory })
  if (result.exitCode !== 0) return
  const value = result.text().trim()
  return value || undefined
}

async function branch() {
  const result = await git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: Instance.directory })
  if (result.exitCode !== 0) return
  const value = result.text().trim()
  if (!value || value === "HEAD") return
  return value
}

async function subject(ref = "HEAD") {
  const result = await git(["log", "-1", "--pretty=%s", ref], { cwd: Instance.directory })
  if (result.exitCode !== 0) return
  const value = result.text().trim()
  return value || undefined
}

async function state() {
  const info = await Vcs.info()
  return {
    ...info,
    branch: (await branch()) ?? info.branch,
  }
}

function note(taskID: string, status: "created" | "completed" | "failed", summary: string, payload: Record<string, unknown>, time = Date.now()) {
  Database.use((db) =>
    db
      .insert(EngineProgressSnapshotTable)
      .values({
        id: Identifier.ascending("progress"),
        task_id: taskID,
        status,
        summary,
        payload,
        time_created: time,
        time_updated: time,
      })
      .run(),
  )
}

function save(task: TaskRow, patch: Record<string, unknown>, time = Date.now()) {
  const meta = structuredClone(dict(task.metadata))
  meta.git = {
    ...dict(meta.git),
    ...patch,
  }
  Database.use((db) =>
    db
      .update(EngineTaskTable)
      .set({
        metadata: meta,
        time_updated: time,
      })
      .where(eq(EngineTaskTable.id, task.id))
      .run(),
  )
  return requireTask(task.id)
}

async function commit(input: { task: TaskRow; plan?: PlanRow; delivery?: DeliveryRow; mode: "baseline" | "result"; allowEmpty: boolean }) {
  const added = await git(evidenceExcludedAddAllArgs(), { cwd: Instance.directory })
  if (added.exitCode !== 0) {
    return {
      error: added.stderr.toString().trim() || added.stdout.toString().trim() || "git add failed",
    }
  }
  const msg = message(input.task, input.mode, input.plan, input.delivery)
  const args = ["commit", "--no-gpg-sign", ...(input.allowEmpty ? ["--allow-empty"] : []), "-m", msg.subject, "-m", msg.body]
  const result = await git(args, {
    cwd: Instance.directory,
    env: env(),
  })
  if (result.exitCode !== 0) {
    const output = result.stderr.toString().trim() || result.stdout.toString().trim() || ""
    // If working tree is clean (executor already committed), fall back to recording HEAD
    if (output.includes("nothing to commit")) {
      const currentHead = await head()
      return {
        mode: "recorded_head" as const,
        commit: currentHead,
        message: await subject(currentHead),
      }
    }
    return {
      error: output || "git commit failed",
    }
  }
  return {
    mode: "created_commit" as const,
    commit: await head(),
    message: msg.subject,
  }
}

const GITIGNORE_ESSENTIALS = `node_modules/
dist/
build/
.output/
.next/
.nuxt/
.svelte-kit/
.env
.env.*
!.env.example
*.tsbuildinfo
coverage/
.cache/
.turbo/
.DS_Store
Thumbs.db
.opencorvus/runtime/
.opencorvus/intent/
.opencorvus/frontend-design/
.opencorvus/decision-log.md
.opencorvus/worktrees/
.opencorvus/ownership/
.opencorvus/trace/
.opencorvus/attachments/
.opencorvus/logs/
.opencorvus/specs/
.opencorvus-worktrees/
.opencorvus-meta.json
/artifacts/
# Windows reserved device names — cross-platform LLMs sometimes write
# 'taskkill ... 2>nul' or '... > nul' from inside a bash shell, which
# (unlike cmd.exe) happily creates a real file literally named 'nul'.
# Git then refuses to index it ('short read while indexing nul') and
# the whole baseline / delivery commit aborts. Same trap for the other
# DOS devices (CON, PRN, AUX, COM1-9, LPT1-9). Case variants covered
# because the file might land as 'nul', 'NUL', or mixed.
nul
NUL
Nul
con
CON
prn
PRN
aux
AUX
com1
com2
com3
com4
com5
com6
com7
com8
com9
lpt1
lpt2
lpt3
lpt4
lpt5
lpt6
lpt7
lpt8
lpt9
`

// Paths OpenCorvus must keep out of ordinary source-control checkpoints.
// Runtime scratch is host-owned bookkeeping. Root /artifacts/ is visual
// evidence captured before a task starts; if hundreds of PNG/WEBM files enter
// HEAD, every goal worktree checks out that payload and history becomes
// dominated by non-source evidence. The ignore entry prevents new files from
// being staged; the cleanup list removes matching paths already in the index.
const OPENCORVUS_GIT_EXCLUDED_PATHS = [
  ProjectRuntimePaths.relativeRuntimeRoot(),
  ...ProjectRuntimePaths.legacyRuntimeRelativePaths,
  ".opencorvus/attachments",
  ".opencorvus/logs",
  ".opencorvus/specs",
  ".opencorvus-worktrees",
  ".opencorvus-meta.json",
  "artifacts",
]

/** Ensure .gitignore exists so heavy directories (node_modules, dist) are
 *  never git-tracked, AND that it is committed to HEAD before any other
 *  commit lands. CONTRACT: when this returns on a fresh git repo, the
 *  FIRST commit on the branch is the baseline .gitignore — nothing else.
 *
 *  Why: every subsequent worktree branches off HEAD via `git worktree add`,
 *  which checks out the branch tip. If HEAD has no .gitignore (or the
 *  ignore file lives only on disk uncommitted), the worktree starts ignore-
 *  blind and `git add -A` after `bun install` swallows `node_modules/`
 *  into the build commit (observed symptom: `node_modules/semver/*` in
 *  merge_back conflict_paths). The "first commit must be .gitignore"
 *  invariant collapses that whole class of bugs.
 *
 *  This function is idempotent: subsequent calls only commit when the
 *  file content actually changed (essentials added) or HEAD was empty. */
export async function ensureGitignore() {
  const dir = Instance.directory
  const file = Bun.file(`${dir}/.gitignore`)
  if (await file.exists()) {
    // Append missing essentials without overwriting user content
    const existing = await file.text()
    const lines = new Set(existing.split(/\r?\n/).map(l => l.trim()))
    const missing = GITIGNORE_ESSENTIALS.split("\n").filter(l => l.trim() && !l.startsWith("!") && !lines.has(l.trim()))
    if (missing.length > 0) {
      await Bun.write(`${dir}/.gitignore`, existing.trimEnd() + "\n\n# Auto-added by OpenCorvus\n" + missing.join("\n") + "\n")
    }
  } else {
    await Bun.write(`${dir}/.gitignore`, GITIGNORE_ESSENTIALS)
  }

  await untrackOpencorvusGitExcludedPaths(dir)

  // Commit the .gitignore unconditionally — git's own staging diff is the
  // only source of truth for "is there actually something to commit". This
  // fires:
  //   • on a fresh repo with no HEAD (first commit ever — guarantees it's
  //     the baseline .gitignore)
  //   • after we appended a missing essential to a pre-existing .gitignore
  //     (essentials need to land in HEAD so worktrees see them)
  //   • on second call after the user edited .gitignore manually before us
  // and skips when the staged file is byte-identical to what's already in
  // HEAD. No --allow-empty: a no-op commit would lie about state.
  const isRepo = await git(["rev-parse", "--git-dir"], { cwd: dir })
  if (isRepo.exitCode !== 0) return
  // `--force` is mandatory for goal worktrees: their cwd lives at
  // `<project>/.opencorvus/runtime/.../worktree` and the project root
  // `.gitignore` (which the worktree shares via the parent repo) lists
  // `.opencorvus/runtime/`. Without `-f`, `git add .gitignore` from inside the
  // worktree fails with "The following paths are ignored by one of your
  // .gitignore files: .opencorvus/runtime" and publish_delivery aborts at goal
  // workspace terminal cleanup (r11 bench evidence
  // `_session-r11-glm5cn.out` line 91025, 2026-04-30T19:34:37). The
  // semantic match: we explicitly want to seed/refresh `.gitignore`
  // regardless of any parent-scope ignore rule that captures the worktree
  // dir — that's exactly what `--force` is for.
  const staged = await git(["add", "--force", "--", ".gitignore"], { cwd: dir })
  if (staged.exitCode !== 0) {
    const detail = staged.stderr.toString().trim() || staged.stdout.toString().trim() || "git add failed"
    throw new Error(`ensureGitignore: stage .gitignore failed: ${detail}`)
  }
  // `git diff --cached --quiet` against an empty HEAD reports "differs"
  // (exit 1) because the staged content has no equivalent in HEAD — that
  // path is exactly when we want the commit to land. Against a populated
  // HEAD with the same bytes it exits 0 → we skip.
  const diff = await git(["diff", "--cached", "--quiet", "--", ".gitignore"], { cwd: dir })
  if (diff.exitCode === 0) return
  const hasHead = (await git(["rev-parse", "--verify", "HEAD"], { cwd: dir })).exitCode === 0
  // `-m` and the message MUST come before `--` — anything after `--` is
  // pathspec, so the prior arg order made git parse `-m` and the subject
  // as filenames and the seed commit silently failed on every fresh repo.
  // That left HEAD absent, and `Worktree.create` then died with the opaque
  // `WorktreeCreateFailedError` on every greenfield project.
  const committed = await git([
    "-c", "user.email=opencorvus@local",
    "-c", "user.name=OpenCorvus",
    "commit",
    ...(hasHead ? ["--only"] : []),
    "-m", "chore(opencorvus): seed baseline .gitignore",
    ...(hasHead ? ["--", ".gitignore"] : []),
  ], { cwd: dir })
  if (committed.exitCode !== 0) {
    const detail = committed.stderr.toString().trim() || committed.stdout.toString().trim() || "git commit failed"
    throw new Error(`ensureGitignore: seed commit failed: ${detail}`)
  }
}

/**
 * Remove orchestrator scratch paths from the git index AND commit the
 * deletion, so HEAD no longer tracks them. The previous version stopped at
 * `git rm --cached` — that left HEAD still tracking the paths (with the
 * deletion only staged, never committed). Subsequent `git merge --ff-only`
 * attempts then saw "local changes would be overwritten" on those paths even
 * though .gitignore rules were in effect, because git's safety check
 * compares HEAD state, not ignore state. Concrete incident:
 * `glr_dba0f6877001...` aborted with stderr listing `.opencorvus-meta.json`
 * and legacy `.opencorvus/intent/README.md` as the blockers.
 *
 * Curative helper, not a gatekeeper — individual path failures are swallowed
 * (path not tracked, repo without history, etc.). A commit is only created
 * when at least one path was actually staged for removal.
 */
async function untrackOpencorvusGitExcludedPaths(dir: string) {
  // Each subprocess routes through the shared `git()` helper so the
  // 90s AbortController deadline applies. The earlier Bun `$` template
  // path had no timeout: a hanging `git commit` on Windows (NTFS file
  // lock, AV scan, index.lock contention) would block the bun event
  // loop indefinitely — observed in the 2026-04-27 V2 benchmark as a
  // 15+ minute freeze of every scheduler.poll, since `ensureGitignore`
  // is awaited inline before `commitDeliveryRound`'s main commit.
  let anyStaged = false
  for (const target of OPENCORVUS_GIT_EXCLUDED_PATHS) {
    // `git ls-files --error-unmatch` only exits 0 when at least one tracked
    // entry matches, so we can skip the (noisier) `git rm` for paths that
    // were never committed in the first place.
    const tracked = await git(["ls-files", "--error-unmatch", "--", target], { cwd: dir })
    if (tracked.exitCode !== 0) continue
    const removed = await git(["rm", "-r", "--cached", "--ignore-unmatch", "--", target], { cwd: dir })
    if (removed.exitCode === 0) anyStaged = true
  }
  if (!anyStaged) return
  await git(
    [
      "-c", "user.name=opencorvus",
      "-c", "user.email=noreply@opencorvus.ai",
      "commit", "--no-gpg-sign", "--no-verify",
      "-m", "chore: untrack opencorvus ignored paths",
    ],
    { cwd: dir },
  )
}

function baseline(task: TaskRow) {
  const value = dict(dict(task.metadata).git).baseline
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function result(task: TaskRow) {
  const value = dict(dict(task.metadata).git).result
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * P0-C.1 — anchor each delivery picky-loop iteration in git.
 *
 * Delivery can make bounded final repairs, and each picky-loop iteration needs
 * a git anchor. Rejected rounds identify the exact merged state that delivery
 * reviewed or repaired; accepted rounds anchor the final state before publishing. Without
 * this helper the loop has no per-round LKG (Last Known Good) anchor and no
 * historical record of which round produced which verdict.
 *
 * Always commits — `--allow-empty` plus `--no-gpg-sign` keep this a
 * pure time anchor when delivery made no code edits. Best-effort: any
 * git failure is logged and reported back, never thrown, so a broken
 * commit never blocks the surrounding deliver tool.
 */
async function commitDeliveryRound(input: {
  task: TaskRow
  iteration: number
  /** Caller passes the rejection_details length (or 0 for accepted) so this
   *  helper does not need to import the full DeliveryVerdict type. */
  verdict: { verdict: string; summary?: string; rejection_count?: number }
  declaredChangedFiles?: string[]
}): Promise<{ commit?: string; mode: "created_commit" | "skipped"; error?: string }> {
  const cwd = Instance.directory
  log.info("commitDeliveryRound: ensureGitignore start", { cwd, iteration: input.iteration })
  await ensureGitignore()
  log.info("commitDeliveryRound: ensureGitignore done; git add -A start", { cwd })
  const added = await git(evidenceExcludedAddAllArgs(), { cwd })
  log.info("commitDeliveryRound: git add -A done", { exitCode: added.exitCode })
  if (added.exitCode !== 0) {
    const err = added.stderr.toString().trim() || added.stdout.toString().trim() || "git add -A failed"
    return { mode: "skipped", error: err }
  }
  const forceAdd = await forceAddDeclaredDeliveryFiles(input.declaredChangedFiles ?? [], cwd)
  if (forceAdd.error) return { mode: "skipped", error: forceAdd.error }
  const issues = input.verdict.rejection_count ?? 0
  const subject = clip(`delivery round ${input.iteration} | verdict=${input.verdict.verdict} | issues=${issues}`)
  const body = (input.verdict.summary ?? "").trim()
  const args = ["commit", "--no-gpg-sign", "--allow-empty", "-m", subject]
  if (body) args.push("-m", body)
  log.info("commitDeliveryRound: git commit start")
  const result = await git(args, { cwd, env: env() })
  log.info("commitDeliveryRound: git commit done", { exitCode: result.exitCode })
  if (result.exitCode !== 0) {
    const err = result.stderr.toString().trim() || result.stdout.toString().trim() || "git commit failed"
    return { mode: "skipped", error: err }
  }
  log.info("commitDeliveryRound: head() start")
  const sha = await head()
  log.info("commitDeliveryRound: head() done", { sha })
  return { mode: "created_commit", commit: sha }
}

async function forceAddDeclaredDeliveryFiles(files: string[], cwd: string): Promise<{ error?: string }> {
  const paths = await declaredFilesPresentInWorktree(files, cwd)
  if (paths.length === 0) return {}
  const result = await git(["add", "--force", "--", ...paths], { cwd })
  if (result.exitCode === 0) return {}
  const detail = result.stderr.toString().trim() || result.stdout.toString().trim() || "git add --force failed"
  return { error: `commitDeliveryRound: force-add declared delivery files failed: ${detail}` }
}

async function declaredFilesPresentInWorktree(files: string[], cwd: string) {
  const unique = new Set<string>()
  for (const file of files) {
    const normalized = normalizeDeliveryPath(file)
    if (!normalized) continue
    const absolute = path.join(cwd, normalized)
    try {
      const stat = await fs.stat(absolute)
      if (stat.isFile()) unique.add(normalized)
    } catch {
      // Missing declared files remain visible to the publish gate instead of
      // being synthesized into the commit.
    }
  }
  return [...unique]
}

function normalizeDeliveryPath(file: string) {
  const trimmed = file.trim()
  if (!trimmed || path.isAbsolute(trimmed)) return undefined
  const normalized = path.normalize(trimmed).replaceAll("\\", "/")
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized === "..") return undefined
  if (ProjectRuntimePaths.isEvidenceInputRelativePath(normalized)) return undefined
  const parts = normalized.split("/")
  if (parts.includes(".git") || parts.includes(".opencorvus")) return undefined
  return normalized
}

function evidenceExcludedAddAllArgs(): string[] {
  return [
    "add",
    "-A",
    "--",
    ".",
    ":(exclude)web-clone-source",
    ":(exclude)web-clone-source/**",
    ":(exclude)mirror",
    ":(exclude)mirror/**",
  ]
}

/**
 * P0-C.4 LKG state lives in `task.metadata.git.delivery_lkg`.
 * One slot per task — the task-level delivery picky loop is the only
 * writer; per-goal worktrees do not own LKG (only the merged worktree
 * has a meaningful visual score).
 */
interface DeliveryLKG {
  best_score: number
  best_commit_sha: string
  best_round: number
  /** Wall-clock for forensic audit (regress-from-when in replay). */
  recorded_at: number
}

function readDeliveryLKG(task: TaskRow): DeliveryLKG | undefined {
  const value = dict(dict(task.metadata).git).delivery_lkg
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const v = value as Record<string, unknown>
  if (
    typeof v.best_score !== "number" ||
    typeof v.best_commit_sha !== "string" ||
    typeof v.best_round !== "number" ||
    typeof v.recorded_at !== "number"
  ) return
  return {
    best_score: v.best_score,
    best_commit_sha: v.best_commit_sha,
    best_round: v.best_round,
    recorded_at: v.recorded_at,
  }
}

function writeDeliveryLKG(task: TaskRow, lkg: DeliveryLKG): TaskRow {
  return save(task, { delivery_lkg: lkg })
}

/**
 * P0-C.4 — Last-Known-Good roll-back.
 *
 * Compare the round's score against the LKG; if it regresses past the
 * tolerance band, `git reset --hard <best_commit_sha>` so the next
 * iteration starts from the last good state. Improvements (or first
 * round) update the LKG. Equality within `epsilon` keeps the existing
 * LKG (avoid LKG churn from numerical jitter in pHash / SSIM).
 *
 * Returns a structured result so the caller can attach it to the
 * decision log and the engine_iteration snapshot for replay (Stream G).
 *
 * Failure modes are surfaced loudly (no fallback, rule 1):
 *  - missing best_commit_sha after regression ⇒ skip reset, log ERROR
 *  - git reset fails ⇒ propagate so the orchestrator can fail the task
 */
export type LKGOutcome =
  | { kind: "first_round"; score: number; updated: DeliveryLKG }
  | { kind: "improved"; score: number; previous: DeliveryLKG; updated: DeliveryLKG }
  | { kind: "held"; score: number; previous: DeliveryLKG }
  | { kind: "blocked_by_siblings"; score: number; previous: DeliveryLKG; activeSiblings: string[] }
  | { kind: "regressed"; score: number; previous: DeliveryLKG; rolledBackTo: string }

async function detectActiveSiblingGoals(taskID: string): Promise<string[]> {
  const active = new Set(ACTIVE_GOAL_RUN_STATUSES as readonly string[])
  return listGoalRunsForTask(taskID)
    .filter((row) => active.has(row.status))
    .map((row) => row.id)
    .sort()
}

async function evaluateAndApplyLKG(input: {
  task: TaskRow
  iteration: number
  score: number
  roundCommitSha: string | undefined
  /** Override the git worktree affected by rollback. Delivery isolation
   *  passes a detached eval worktree here so reset never touches primary. */
  worktreeDirectory?: string
  /** Symmetric tolerance — score difference within ±epsilon is treated as
   *  "held" (no LKG update, no rollback). 0.01 ≈ 1% of the [0,1] score. */
  epsilon?: number
}): Promise<{ outcome: LKGOutcome; task: TaskRow }> {
  const epsilon = input.epsilon ?? 0.01
  const previous = readDeliveryLKG(input.task)

  if (!previous) {
    if (!input.roundCommitSha) {
      // No prior LKG and no commit to anchor this round — nothing to record.
      // Caller already logs the missing commit; treat as "held" of an empty
      // LKG so callers do not have to special-case `first_round && noSha`.
      return {
        task: input.task,
        outcome: {
          kind: "held",
          score: input.score,
          previous: { best_score: input.score, best_commit_sha: "", best_round: input.iteration, recorded_at: Date.now() },
        },
      }
    }
    const updated: DeliveryLKG = {
      best_score: input.score,
      best_commit_sha: input.roundCommitSha,
      best_round: input.iteration,
      recorded_at: Date.now(),
    }
    return { task: writeDeliveryLKG(input.task, updated), outcome: { kind: "first_round", score: input.score, updated } }
  }

  const delta = input.score - previous.best_score
  if (delta > epsilon) {
    if (!input.roundCommitSha) {
      // Improvement detected but no commit anchor — keep the previous LKG so
      // we never advance to a sha-less best (rollback target would be empty).
      return { task: input.task, outcome: { kind: "held", score: input.score, previous } }
    }
    const updated: DeliveryLKG = {
      best_score: input.score,
      best_commit_sha: input.roundCommitSha,
      best_round: input.iteration,
      recorded_at: Date.now(),
    }
    return { task: writeDeliveryLKG(input.task, updated), outcome: { kind: "improved", score: input.score, previous, updated } }
  }
  if (delta >= -epsilon) {
    return { task: input.task, outcome: { kind: "held", score: input.score, previous } }
  }

  // Regression past tolerance — reset to the LKG commit so the next
  // iteration does not compound the bad direction. We never reset onto an
  // empty sha; if the LKG was recorded without one (defensive), surface
  // loudly instead of silently passing.
  if (!previous.best_commit_sha) {
    log.warn("evaluateAndApplyLKG: regression detected but LKG has no commit sha — cannot roll back", {
      taskID: input.task.id, iteration: input.iteration, delta,
    })
    return { task: input.task, outcome: { kind: "held", score: input.score, previous } }
  }
  const activeSiblings = await detectActiveSiblingGoals(input.task.id)
  if (activeSiblings.length > 0) {
    log.warn("evaluateAndApplyLKG: regression detected but active sibling goals exist — skipping reset to avoid wiping concurrent progress", {
      taskID: input.task.id,
      iteration: input.iteration,
      delta,
      activeSiblings,
    })
    return {
      task: input.task,
      outcome: {
        kind: "blocked_by_siblings",
        score: input.score,
        previous,
        activeSiblings,
      },
    }
  }
  const cwd = input.worktreeDirectory ?? Instance.directory
  const reset = await git(["reset", "--hard", previous.best_commit_sha], { cwd, env: env() })
  if (reset.exitCode !== 0) {
    const err = reset.stderr.toString().trim() || reset.stdout.toString().trim() || "git reset failed"
    throw new Error(`evaluateAndApplyLKG: git reset --hard ${previous.best_commit_sha} failed: ${err}`)
  }
  log.info("evaluateAndApplyLKG: rolled back to LKG", {
    taskID: input.task.id, iteration: input.iteration,
    score: input.score, best_score: previous.best_score, sha: previous.best_commit_sha,
  })
  return {
    task: input.task,
    outcome: { kind: "regressed", score: input.score, previous, rolledBackTo: previous.best_commit_sha },
  }
}

// Stash the outer-scope function references so the namespace re-exports
// below don't shadow themselves into an infinite recursion. `export const
// commitDeliveryRound = (...) => commitDeliveryRound(...)` inside `namespace
// EngineGit` makes the arrow body's `commitDeliveryRound` resolve to the
// namespace member itself (TypeScript namespace shadowing), so each call
// dispatched through `EngineGit.commitDeliveryRound` recursed into itself
// until the stack overflowed — observed as the post-delivery CPU-spin hang
// in tools.ts:2851 (verdict recorded → no `ensureGitignore start` log).
const _commitDeliveryRound = commitDeliveryRound
const _evaluateAndApplyLKG = evaluateAndApplyLKG

export namespace EngineGit {
  export const commitDeliveryRound = (input: Parameters<typeof _commitDeliveryRound>[0]) =>
    _commitDeliveryRound(input)
  export const evaluateAndApplyLKG = (input: Parameters<typeof _evaluateAndApplyLKG>[0]) =>
    _evaluateAndApplyLKG(input)
  export const readLKG = (task: TaskRow) => readDeliveryLKG(task)

  export async function prepare(task: TaskRow, plan?: PlanRow) {
    if (baseline(task)) return { task }

    const info = await state()
    if (info.conflicts > 0) {
      const summary = "Cannot start the task because the repository has unresolved merge conflicts."
      note(task.id, "failed", summary, {
        kind: "git",
        stage: "baseline",
        branch: info.branch,
        conflicts: info.conflicts,
      })
      return { task, error: summary }
    }

    // Ensure .gitignore exists so node_modules/dist etc. are never tracked
    await ensureGitignore()

    const before = await head()
    const next =
      !before || info.dirty
        ? await commit({
            task,
            plan,
            mode: "baseline",
            allowEmpty: !before,
          })
        : {
            mode: "recorded_head" as const,
            commit: before,
            message: await subject(before),
          }
    if ("error" in next) {
      const summary = `Failed to capture the startup git checkpoint: ${next.error}`
      note(task.id, "failed", summary, {
        kind: "git",
        stage: "baseline",
        branch: info.branch,
        error: next.error,
      })
      return { task, error: summary }
    }

    const after = await branch()
    const snapshot = await Snapshot.track()
    const time = Date.now()
    const row = save(task, {
      branch: after ?? info.branch,
      baseline: {
        mode: next.mode,
        branch: after ?? info.branch,
        commit: next.commit,
        message: next.message,
        head_before: before,
        snapshot,
        dirty: info.dirty,
        staged: info.staged,
        modified: info.modified,
        untracked: info.untracked,
        conflicts: info.conflicts,
        ahead: info.ahead,
        behind: info.behind,
        time,
      },
    }, time)
    note(task.id, "created", next.mode === "created_commit" ? "Created a startup git checkpoint." : "Recorded the current HEAD as the startup checkpoint.", {
      kind: "git",
      stage: "baseline",
      mode: next.mode,
      branch: after ?? info.branch,
      commit: next.commit,
      message: next.message,
      snapshot,
    }, time)
    return { task: row }
  }

  export async function complete(task: TaskRow, plan: PlanRow | undefined, delivery: DeliveryRow) {
    if (result(task)) return { task }

    const info = await state()
    if (info.conflicts > 0) {
      const summary = "Cannot finalize the task git checkpoint because the repository has unresolved merge conflicts."
      note(task.id, "failed", summary, {
        kind: "git",
        stage: "result",
        branch: info.branch,
        conflicts: info.conflicts,
      })
      return { task, error: summary }
    }

    // Ensure .gitignore is in place before git add -A so node_modules/dist etc. are never tracked.
    // This is the primary safeguard because prepare() is not always called before execution.
    await ensureGitignore()

    const before = await head()
    const next =
      info.dirty || !before
        ? await commit({
            task,
            plan,
            delivery,
            mode: "result",
            allowEmpty: !before,
          })
        : {
            mode: "recorded_head" as const,
            commit: before,
            message: await subject(before),
          }
    if ("error" in next) {
      const summary = `Failed to capture the final git checkpoint: ${next.error}`
      note(task.id, "failed", summary, {
        kind: "git",
        stage: "result",
        branch: info.branch,
        error: next.error,
      })
      return { task, error: summary }
    }

    const after = await branch()
    const time = Date.now()
    const row = save(task, {
      branch: after ?? info.branch,
      result: {
        mode: next.mode,
        branch: after ?? info.branch,
        commit: next.commit,
        message: next.message,
        head_before: before,
        delivery_id: delivery.id,
        delivery_summary: delivery.summary,
        dirty: info.dirty,
        staged: info.staged,
        modified: info.modified,
        untracked: info.untracked,
        conflicts: info.conflicts,
        ahead: info.ahead,
        behind: info.behind,
        time,
      },
    }, time)
    note(task.id, "completed", next.mode === "created_commit" ? "Committed the accepted workspace state." : "Recorded the current HEAD as the accepted workspace state.", {
      kind: "git",
      stage: "result",
      mode: next.mode,
      branch: after ?? info.branch,
      commit: next.commit,
      message: next.message,
      deliveryID: delivery.id,
    }, time)
    return { task: row }
  }
}
