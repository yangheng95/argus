import { Snapshot } from "@/snapshot"
import { Instance } from "@/project/instance"
import { Vcs } from "@/project/vcs"
import { Database, eq } from "@/storage/db"
import { git } from "@/util/git"
import { Identifier } from "@/id/id"
import { EngineProgressSnapshotTable, EngineTaskTable } from "./engine.sql"
import { requireTask, type DeliveryRow, type PlanRow, type TaskRow } from "./store"

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
  const added = await git(["add", "-A"], { cwd: Instance.directory })
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
*.db-shm
*.db-wal
*.tsbuildinfo
coverage/
.cache/
.turbo/
.DS_Store
Thumbs.db
.opencorvus/
.opencorvus-worktrees/
.opencorvus-meta.json
`

// Paths the orchestrator writes into each worktree for its own bookkeeping
// (goal meta, intent bundle, merge-conflict notes, task trace dir). Once these
// sneak into git via `git add -A` they propagate via ff-only merges into main
// and poison every future goal worktree that checks out from it — so the
// exclusion must be both declarative (.gitignore) and curative (untrack any
// instance already in the index).
const OPENCORVUS_SCRATCH_PATHS = [
  ".opencorvus",
  ".opencorvus-worktrees",
  ".opencorvus-meta.json",
]

/** Ensure .gitignore exists so heavy directories (node_modules, dist) are never git-tracked. */
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

  await untrackOpencorvusScratch(dir)
}

/**
 * Remove orchestrator scratch paths from the git index if earlier runs
 * committed them before the ignore rules existed. `git rm --cached` untracks
 * without touching the working tree, so the on-disk files stay and only the
 * tracked instance is purged; the next `git add -A` will then honor the
 * ignore entries and leave them alone.
 *
 * Each path is attempted independently and failures (path not tracked,
 * repo without history, etc.) are swallowed — this is a curative helper,
 * not a gatekeeper.
 */
async function untrackOpencorvusScratch(dir: string) {
  const { $ } = await import("bun")
  for (const target of OPENCORVUS_SCRATCH_PATHS) {
    // `git ls-files --error-unmatch` only exits 0 when at least one tracked
    // entry matches, so we can skip the (noisier) `git rm` for paths that
    // were never committed in the first place.
    const tracked = await $`git ls-files --error-unmatch -- ${target}`.cwd(dir).quiet().nothrow()
    if (tracked.exitCode !== 0) continue
    await $`git rm -r --cached --ignore-unmatch -- ${target}`.cwd(dir).quiet().nothrow()
  }
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

export namespace EngineGit {
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
