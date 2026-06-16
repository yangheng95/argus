import fs from "fs/promises"
import path from "path"
import { Database, inArray } from "../storage/db"
import { ProjectTable } from "./project.sql"
import { Log } from "../util/log"
import { Scheduler } from "../scheduler"
import { ProjectRuntimePaths } from "./runtime-paths"

/**
 * Project-scoped garbage collection.
 *
 * Snapshot / session_diff are agent-only caches (not user version history),
 * so stale entries are safe to drop. Default policy:
 *
 *   - Projects whose `time_updated` is older than `expireAfterDays` (7 by
 *     default) → DELETE the row (CASCADE clears session/task/memory/etc.)
 *     and remove the on-disk runtime cache directories for snapshot/session_diff.
 *   - Orphan directories under each project's runtime cache (no
 *     matching project row) → removed directly. They cannot correspond to
 *     anything the user can open, so keeping them is waste.
 *   - After any removal, `wal_checkpoint(TRUNCATE)` + `VACUUM` so the DB
 *     file actually shrinks.
 *
 * This matches the explicit user decision (2026-04-14) that snapshots are a
 * disposable agent cache. If a stricter policy is ever required, tighten by
 * raising `expireAfterDays` — do not reintroduce "temp-only" gating, since
 * that was based on a misunderstanding of what snapshots are.
 */
export namespace ProjectGC {
  const log = Log.create({ service: "project.gc" })
  const GC_INTERVAL_MS = 6 * 60 * 60 * 1000
  export const DEFAULT_EXPIRE_DAYS = 7

  export type Plan = {
    expiredProjects: Array<{ id: string; worktree: string; lastUsed: number }>
    orphanSnapshots: string[]
    orphanSessionDiffs: string[]
  }

  export type ApplyResult = {
    removedProjectRows: number
    removedSnapshotDirs: number
    removedSessionDiffDirs: number
    vacuumed: boolean
  }

  export function init() {
    Scheduler.register({
      id: "project.gc",
      interval: GC_INTERVAL_MS,
      scope: "global",
      run: async () => {
        const plan = await inspect()
        const total = plan.expiredProjects.length + plan.orphanSnapshots.length + plan.orphanSessionDiffs.length
        if (total === 0) return
        await apply(plan)
      },
    })
  }

  export async function inspect(opts?: { expireAfterDays?: number }): Promise<Plan> {
    const days = opts?.expireAfterDays ?? DEFAULT_EXPIRE_DAYS
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000

    const rows = Database.use((db) =>
      db
        .select({
          id: ProjectTable.id,
          worktree: ProjectTable.worktree,
          timeUpdated: ProjectTable.time_updated,
        })
        .from(ProjectTable)
        .all(),
    )
    const activeIds = new Set(rows.map((r) => r.id))

    const expiredProjects = rows
      .filter((r) => r.timeUpdated < cutoff)
      .map((r) => ({ id: r.id, worktree: r.worktree, lastUsed: r.timeUpdated }))

    const [orphanSnapshots, orphanSessionDiffs] = await Promise.all([
      listOrphansForRows(rows, "snapshot", activeIds),
      listOrphansForRows(rows, "session_diff", activeIds),
    ])

    return { expiredProjects, orphanSnapshots, orphanSessionDiffs }
  }

  export async function apply(plan: Plan): Promise<ApplyResult> {
    const expiredIds = plan.expiredProjects.map((p) => p.id)
    let removedProjectRows = 0
    if (expiredIds.length > 0) {
      Database.use((db) => db.delete(ProjectTable).where(inArray(ProjectTable.id, expiredIds)).run())
      removedProjectRows = expiredIds.length
      for (const p of plan.expiredProjects) {
        log.info("expired project removed", { id: p.id, worktree: p.worktree, lastUsed: p.lastUsed })
      }
    }

    // Filesystem targets = expired project ids (just deleted from DB) ∪ orphan
    // directories. Dedup because an expired id will not appear as an orphan at
    // this moment (activeIds was computed before DELETE), but concurrent runs
    // could overlap in theory.
    const snapshotTargets = dedup([
      ...plan.expiredProjects.map((p) => ProjectRuntimePaths.snapshotCacheRoot(p.worktree, p.id)),
      ...plan.orphanSnapshots,
    ])
    const sessionDiffTargets = dedup([
      ...plan.expiredProjects.map((p) => ProjectRuntimePaths.sessionDiffRoot(p.worktree, p.id)),
      ...plan.orphanSessionDiffs,
    ])

    const removedSnapshotDirs = await removeDirs(snapshotTargets)
    const removedSessionDiffDirs = await removeDirs(sessionDiffTargets)

    const totalWork = removedProjectRows + removedSnapshotDirs + removedSessionDiffDirs
    let vacuumed = false
    if (totalWork > 0) {
      try {
        Database.checkpointTruncate()
        Database.vacuum()
        vacuumed = true
      } catch (err) {
        log.warn("vacuum failed", { error: err instanceof Error ? err.message : String(err) })
      }
      log.info("applied", {
        removedProjectRows,
        removedSnapshotDirs,
        removedSessionDiffDirs,
        vacuumed,
      })
    }

    return { removedProjectRows, removedSnapshotDirs, removedSessionDiffDirs, vacuumed }
  }

  function cacheRoot(worktree: string, kind: "snapshot" | "session_diff") {
    return kind === "snapshot"
      ? path.dirname(ProjectRuntimePaths.snapshotCacheRoot(worktree, "placeholder"))
      : path.dirname(ProjectRuntimePaths.sessionDiffRoot(worktree, "placeholder"))
  }

  async function listOrphansForRows(
    rows: Array<{ worktree: string }>,
    kind: "snapshot" | "session_diff",
    active: Set<string>,
  ): Promise<string[]> {
    const roots = dedup(rows.map((row) => cacheRoot(row.worktree, kind)))
    const nested = await Promise.all(roots.map((root) => listOrphans(root, active)))
    return dedup(nested.flat())
  }

  async function listOrphans(root: string, active: Set<string>): Promise<string[]> {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return [] as import("fs").Dirent[]
      throw err
    })
    const out: string[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (active.has(entry.name)) continue
      out.push(path.join(root, entry.name))
    }
    return out
  }

  async function removeDirs(targets: string[]): Promise<number> {
    let removed = 0
    for (const target of targets) {
      try {
        await fs.rm(target, { recursive: true, force: true })
        removed++
      } catch (err) {
        log.warn("remove failed", {
          path: target,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    return removed
  }

  function dedup(items: string[]): string[] {
    return [...new Set(items)]
  }
}
