import fs from "fs/promises"
import path from "path"
import { Database } from "../storage/db"
import { ProjectTable } from "../project/project.sql"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { Scheduler } from "../scheduler"
import { git as runGit } from "../util/git"
import { listLiveGoalRunsForProject } from "../engine/store"
import { Worktree } from "./index"

/**
 * Orphan worktree garbage collection.
 *
 * Implements the previously-unimplemented Phase F of
 * `specs/new-arch/10-worktree-lifecycle.md` §9 — Claude-Code-aligned
 * orphaned-worktree sweep (§2.1 / §6 of that doc, and the addendum
 * `specs/new-arch/2026-05-15-orphan-worktree-gc.md`).
 *
 * A directory under `<primary>/.opencorvus/r/w/` is removed ONLY when
 * it is genuinely abandoned junk. "Older than N days" is necessary but NOT
 * sufficient: §2.3 of the lifecycle doc forbids deleting failed / aborted /
 * cancelled / restart worktrees because that in-transit state is the input
 * to the next retry. So a worktree is reclaimed only when ALL hold:
 *
 *   1. NOT referenced by any live goal_run's workspace_dir.
 *   2. directory mtime older than `retentionDays` (default 3).
 *   3. clean: `git status --porcelain` empty (no uncommitted, no untracked).
 *   4. no in-transit commits: nothing on HEAD that is not yet merged into
 *      the project's primary branch (the no-remote analogue of Claude
 *      Code's "no unpushed commits" gate).
 *
 * OR it is a zombie: lives under the worktrees root, its `.git` linkage is
 * gone, it is old and not live — the Windows partial-rm residue described in
 * lifecycle §8.1.
 *
 * Any uncertainty (a git probe fails while `.git` is present) → PRESERVE.
 * We never trade a false delete of in-transit acceptance work for tidiness.
 */
export namespace WorktreeGC {
  const log = Log.create({ service: "worktree.gc" })
  const GC_INTERVAL_MS = 6 * 60 * 60 * 1000
  export const DEFAULT_RETENTION_DAYS = 3

  // Re-entrancy guard: a sweep shells out to many slow git commands; runs
  // are 6h apart and idempotent, so simply skip if a prior run is still in
  // flight rather than overlapping git operations on the same repos.
  let running = false

  export type Candidate = { projectID: string; primaryDir: string; directory: string }
  export type Plan = { candidates: Candidate[] }
  export type ApplyResult = { removed: number; failed: number }

  export function init() {
    Scheduler.register({
      id: "worktree.gc",
      interval: GC_INTERVAL_MS,
      scope: "global",
      run: async () => {
        if (running) return
        running = true
        try {
          const plan = await inspect()
          if (plan.candidates.length === 0) return
          await apply(plan)
        } finally {
          running = false
        }
      },
    })
  }

  function canon(input: string): string {
    const abs = path.resolve(input)
    return process.platform === "win32" ? abs.toLowerCase() : abs
  }

  async function realCanon(input: string): Promise<string> {
    const abs = path.resolve(input)
    const real = await fs.realpath(abs).catch(() => abs)
    return process.platform === "win32" ? real.toLowerCase() : real
  }

  function isOlderThan(stat: { mtimeMs: number }, cutoff: number): boolean {
    return stat.mtimeMs < cutoff
  }

  async function gitClean(directory: string): Promise<boolean> {
    const status = await runGit(["status", "--porcelain"], {
      cwd: directory,
      timeoutProfile: "default",
    }).catch(() => undefined)
    // Probe failure with a present .git linkage is uncertainty → not clean.
    if (!status || status.exitCode !== 0) return false
    return decode(status.stdout).trim().length === 0
  }

  async function noInTransitCommits(directory: string, primaryBranch: string): Promise<boolean> {
    const revs = await runGit(["rev-list", "--count", `${primaryBranch}..HEAD`], {
      cwd: directory,
      timeoutProfile: "fast",
    }).catch(() => undefined)
    if (!revs || revs.exitCode !== 0) return false
    return decode(revs.stdout).trim() === "0"
  }

  function decode(input: Uint8Array | undefined): string {
    if (!input?.length) return ""
    return new TextDecoder().decode(input)
  }

  function isDirectoryKeyPart(input: string, length: number): boolean {
    return input.length === length && /^[0-9A-Za-z]+$/.test(input)
  }

  async function worktreeDirectories(root: string): Promise<string[]> {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return [] as import("fs").Dirent[]
      throw err
    })
    const directories: string[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const firstDir = path.join(root, entry.name)
      const children = await fs.readdir(firstDir, { withFileTypes: true }).catch(() => [] as import("fs").Dirent[])
      const fanoutChildren = children.filter((child) => child.isDirectory() && isDirectoryKeyPart(child.name, 6))
      if (isDirectoryKeyPart(entry.name, 2) && fanoutChildren.length > 0) {
        for (const child of fanoutChildren) {
          const leaf = path.join(firstDir, child.name, "worktree")
          const stat = await fs.stat(leaf).catch(() => undefined)
          if (stat?.isDirectory()) directories.push(leaf)
        }
        continue
      }
      directories.push(firstDir)
    }
    return directories
  }

  async function primaryBranchOf(primaryDir: string): Promise<string | undefined> {
    const head = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: primaryDir,
      timeoutProfile: "fast",
    }).catch(() => undefined)
    if (!head || head.exitCode !== 0) return undefined
    const branch = decode(head.stdout).trim()
    if (!branch || branch === "HEAD") return undefined
    return branch
  }

  export async function inspect(opts?: { retentionDays?: number; now?: number }): Promise<Plan> {
    const days = opts?.retentionDays ?? DEFAULT_RETENTION_DAYS
    const cutoff = (opts?.now ?? Date.now()) - days * 24 * 60 * 60 * 1000

    const projects = Database.use((db) =>
      db.select({ id: ProjectTable.id, worktree: ProjectTable.worktree }).from(ProjectTable).all(),
    )

    const candidates: Candidate[] = []

    for (const project of projects) {
      const primaryDir = project.worktree
      if (!primaryDir) continue
      const root = Worktree.worktreesRoot(primaryDir)
      const directories = await worktreeDirectories(root)
      if (directories.length === 0) continue

      const liveDirs = new Set<string>()
      for (const goalRun of listLiveGoalRunsForProject(project.id)) {
        if (goalRun.workspace_dir) liveDirs.add(await realCanon(goalRun.workspace_dir))
      }

      // Resolved once per project; if we cannot determine primary branch we
      // cannot evaluate the in-transit-commits gate → preserve everything.
      const primaryBranch = await primaryBranchOf(primaryDir)

      for (const directory of directories) {
        if (liveDirs.has(await realCanon(directory))) continue

        const stat = await fs.stat(directory).catch(() => undefined)
        if (!stat || !isOlderThan(stat, cutoff)) continue

        const gitLink = path.join(directory, ".git")
        const hasGitLink = await fs
          .stat(gitLink)
          .then(() => true)
          .catch(() => false)

        if (!hasGitLink) {
          // Zombie residue (lifecycle §8.1): old, under the worktrees root,
          // no git linkage, not live → reclaim.
          candidates.push({ projectID: project.id, primaryDir, directory })
          continue
        }

        if (!primaryBranch) continue
        if (!(await gitClean(directory))) continue
        if (!(await noInTransitCommits(directory, primaryBranch))) continue

        candidates.push({ projectID: project.id, primaryDir, directory })
      }
    }

    return { candidates }
  }

  export async function apply(plan: Plan): Promise<ApplyResult> {
    let removed = 0
    let failed = 0
    for (const c of plan.candidates) {
      try {
        await Instance.provide({
          directory: c.primaryDir,
          fn: () => Worktree.remove({ directory: c.directory }),
        })
        removed++
        log.info("orphan worktree removed", {
          projectID: c.projectID,
          directory: c.directory,
        })
      } catch (err) {
        failed++
        log.warn("orphan worktree removal failed", {
          projectID: c.projectID,
          directory: c.directory,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    if (removed > 0 || failed > 0) log.info("applied", { removed, failed })
    return { removed, failed }
  }
}
