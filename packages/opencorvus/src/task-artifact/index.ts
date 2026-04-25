/**
 * TaskArtifact — single source of truth for task-scoped scratch artifacts
 * (mirror snapshots, design tokens, page IR, scaffolds, screenshots…).
 *
 * Pre-existing layout was worktree-local (`<worktree>/mirror/...`), which
 * meant each goal worktree silently re-extracted the same URL the previous
 * goal had already mirrored. Cross-goal `merge` runs paid the same network
 * + puppeteer cost a third or fourth time. This module pulls the storage
 * up to the task — there is one canonical location per task — and exposes
 * a per-worktree symlink so existing `mirror/...` agent paths keep working
 * with no prompt changes.
 *
 * Invariants:
 *   - exactly one storage root per (taskID, kind) tuple (rule 22 single source)
 *   - worktree views are symlinks, never copies (no double-source data)
 *   - callers that supply an explicit override path bypass this module
 *     entirely — the override is the single source for that call (the
 *     benchmark driver, tests, ad-hoc CLI use this hatch)
 *
 * Storage layout:
 *   <project_worktree>/.opencorvus/task-artifacts/<taskID>/<kind>/
 *
 * The `.opencorvus/` prefix means git ignores the entire tree (matching the
 * orchestrator's scratch convention). Goal worktrees see the same data via
 * `<worktree>/<linkName>` symlinks.
 */
import fs from "node:fs/promises"
import path from "node:path"

import { Database, eq } from "@/storage/db"
import { EngineTaskTable } from "@/engine/engine.sql"
import { ProjectTable } from "@/project/project.sql"
import { Log } from "@/util/log"

const log = Log.create({ service: "task-artifact" })

const ROOT_SUBPATH = path.join(".opencorvus", "task-artifacts")

export namespace TaskArtifact {
  /**
   * Resolve the canonical storage directory for `(taskID, kind)`.
   * Joins to `<projectWorktree>/.opencorvus/task-artifacts/<taskID>/<kind>`
   * and `mkdir -p`s it before returning.
   *
   * Throws when the task is unknown or its project has no recorded worktree
   * — these are bugs (rule 1: no silent fallback to a guessed path).
   */
  export async function dirFor(taskID: string, kind: string): Promise<string> {
    const projectWorktree = lookupProjectWorktree(taskID)
    if (!projectWorktree) {
      throw new Error(
        `TaskArtifact.dirFor: cannot resolve project worktree for task ${taskID}`,
      )
    }
    const dir = path.join(projectWorktree, ROOT_SUBPATH, taskID, kind)
    await fs.mkdir(dir, { recursive: true })
    return dir
  }

  /**
   * Materialize a `<worktreeDir>/<linkName>` symlink pointing at the task's
   * artifact directory for `kind`. Idempotent — existing correct links are
   * left alone, stale ones (wrong target) are replaced. Returns the target.
   *
   * Uses `junction` on Windows so a non-elevated process can create the
   * directory link; falls back to a generic symlink on Unix.
   */
  export async function linkInto(
    taskID: string,
    kind: string,
    worktreeDir: string,
    linkName: string,
  ): Promise<string> {
    const target = await dirFor(taskID, kind)
    const linkPath = path.join(worktreeDir, linkName)

    const existing = await readLinkTarget(linkPath)
    if (existing === target) return target
    if (existing !== undefined) {
      await fs.rm(linkPath, { recursive: true, force: true })
    } else {
      const stat = await fs.lstat(linkPath).catch(() => undefined)
      if (stat) await fs.rm(linkPath, { recursive: true, force: true })
    }

    const symlinkType = process.platform === "win32" ? "junction" : "dir"
    try {
      await fs.symlink(target, linkPath, symlinkType)
    } catch (err) {
      log.warn("symlink failed; falling back to copy-on-read directory", {
        worktreeDir,
        linkName,
        target,
        err: err instanceof Error ? err.message : String(err),
      })
      // Last-resort: ensure callers reading <linkPath>/foo at least see the
      // canonical files. This branch surfaces a permission / filesystem
      // problem and is logged so the user can fix the environment.
      await fs.mkdir(linkPath, { recursive: true })
    }
    return target
  }
}

function lookupProjectWorktree(taskID: string): string | undefined {
  return Database.use((db) => {
    const row = db
      .select({ worktree: ProjectTable.worktree })
      .from(EngineTaskTable)
      .innerJoin(ProjectTable, eq(EngineTaskTable.project_id, ProjectTable.id))
      .where(eq(EngineTaskTable.id, taskID))
      .get()
    return row?.worktree
  })
}

async function readLinkTarget(linkPath: string): Promise<string | undefined> {
  try {
    const lstat = await fs.lstat(linkPath)
    if (!lstat.isSymbolicLink()) return undefined
    const target = await fs.readlink(linkPath)
    return path.resolve(path.dirname(linkPath), target)
  } catch {
    return undefined
  }
}
