import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import os from "node:os"
import z from "zod"
import { NamedError } from "@opencorvus-ai/util/error"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Project } from "../project/project"
import { Database, eq } from "../storage/db"
import { ProjectTable } from "../project/project.sql"
import { fn } from "../util/fn"
import { git as runGit } from "../util/git"
import { Log } from "../util/log"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Shell } from "@/shell/shell"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { TaskRuntimeMaterializer } from "@/project/task-runtime-materializer"
import { isLiveGoalRunStatus } from "@/engine/catalog"
import { InternalGitCommitSubject } from "@/engine/internal-git-commit-subject"
import { listGoalWorkspacesForProject } from "@/engine/store"

export namespace Worktree {
  const log = Log.create({ service: "worktree" })
  const caseInsensitiveCache = new Map<string, boolean>()

  // Per-project git mutex: serializes worktree add/remove/reset operations
  // across both this process and sibling OpenCorvus processes.
  const gitLocks = new Map<string, Promise<void>>()
  export async function withGitLock<T>(fn: () => Promise<T>): Promise<T> {
    const key = Instance.project.id
    const prev = gitLocks.get(key) ?? Promise.resolve()
    let resolve!: () => void
    const next = new Promise<void>((r) => (resolve = r))
    gitLocks.set(key, next)
    await prev
    try {
      const lockDir = ProjectRuntimePaths.projectGitLock(Instance.worktree)
      const stopHeartbeat = await acquireDiskLock(lockDir)
      try {
        return await fn()
      } finally {
        stopHeartbeat()
        await fs.rm(lockDir, { recursive: true, force: true })
      }
    } finally {
      resolve()
    }
  }

  async function acquireDiskLock(lockDir: string): Promise<() => void> {
    const deadline = Date.now() + 120_000
    const hostname = os.hostname()
    await fs.mkdir(path.dirname(lockDir), { recursive: true })
    while (true) {
      try {
        await fs.mkdir(lockDir, { recursive: false })
        const ownerPath = path.join(lockDir, "owner.json")
        const createdAt = Date.now()
        const writeOwner = () =>
          fs.writeFile(
            ownerPath,
            JSON.stringify({
              pid: process.pid,
              hostname,
              createdAt,
              lastHeartbeat: Date.now(),
              projectID: Instance.project.id,
            }, null, 2),
            "utf8",
          )
        await writeOwner()
        const timer = setInterval(() => {
          writeOwner().catch((error) => {
            log.warn("project git lock heartbeat failed", { lockDir, error: String(error) })
          })
        }, 1_000)
        return () => clearInterval(timer)
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code !== "EEXIST") throw err
        const ownerPath = path.join(lockDir, "owner.json")
        const owner = await fs.readFile(ownerPath, "utf8")
          .then((raw) => JSON.parse(raw) as { pid?: unknown; hostname?: unknown; createdAt?: unknown; lastHeartbeat?: unknown })
          .catch(() => undefined)
        const pid = typeof owner?.pid === "number" ? owner.pid : undefined
        const ownerHostname = typeof owner?.hostname === "string" ? owner.hostname : undefined
        const lastHeartbeat = typeof owner?.lastHeartbeat === "number"
          ? owner.lastHeartbeat
          : typeof owner?.createdAt === "number"
            ? owner.createdAt
            : 0
        const heartbeatStale = Date.now() - lastHeartbeat > 30_000
        const sameHostPidDead = ownerHostname === hostname && (!pid || !isPidAlive(pid))
        if (sameHostPidDead || heartbeatStale) {
          await fs.rm(lockDir, { recursive: true, force: true })
          continue
        }
        if (Date.now() >= deadline) {
          throw new CreateFailedError({
            message: `Timed out waiting for project git lock ${lockDir} held by pid ${pid}`,
          })
        }
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
    }
  }

  function isPidAlive(pid: number): boolean {
    if (!Number.isFinite(pid) || pid <= 0) return false
    try {
      process.kill(pid, 0)
      return true
    } catch (err: any) {
      return err?.code === "EPERM"
    }
  }

  /**
   * Single source for the per-project worktree root. Goal worktrees live
   * UNDER `<primary>/.opencorvus/runtime/worktrees/` (co-located with other
   * runtime scratch, covered by the `/.opencorvus/` .gitignore entry). `create()`
   * and `WorktreeGC` MUST both derive the root from here — two inline
   * `path.join(...,".opencorvus","worktrees")` would be a double source
   * (rule 8) and the GC sweep could scan the wrong directory.
   */
  export function worktreesRoot(primaryDir: string) {
    return ProjectRuntimePaths.worktreesRoot(primaryDir)
  }

  function taskIDFromRuntimeWorktree(primaryDir: string, worktreeDir: string): string | undefined {
    const tasksRoot = path.join(ProjectRuntimePaths.projectRuntimeRoot(primaryDir), "tasks")
    const relative = path.relative(tasksRoot, worktreeDir)
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return undefined
    const parts = relative.split(path.sep).filter(Boolean)
    if (parts.length === 6 && parts[1] === "goals" && parts[3] === "runs" && parts[5] === "worktree") {
      return parts[0]
    }
    if (parts.length === 4 && parts[1] === "sessions" && parts[3] === "worktree") {
      return parts[0]
    }
    return undefined
  }

  export const Event = {
    Ready: BusEvent.define(
      "worktree.ready",
      z.object({
        name: z.string(),
        branch: z.string(),
      }),
    ),
    Failed: BusEvent.define(
      "worktree.failed",
      z.object({
        message: z.string(),
      }),
    ),
  }

  export const MergeFailedError = NamedError.create(
    "WorktreeMergeFailedError",
    z.object({
      message: z.string(),
      branch: z.string(),
      stderr: z.string().optional(),
    }),
  )

  export function mergeFailureDetail(err: unknown): { reason: string; branch: string; stderr?: string } | undefined {
    if (!MergeFailedError.isInstance(err)) return undefined
    const { message, branch, stderr } = err.data
    return {
      reason: message,
      branch,
      ...(stderr ? { stderr } : {}),
    }
  }

  export type MergeOutcome =
    | {
        status: "merged"
        primaryBranch: string
        primaryHead: string
        primaryRecoveryCommit?: string
      }
    | {
        status: "conflict"
        branch: string
        primaryBranch: string
        primaryTip: string
        conflictPaths: string[]
        worktreeDir: string
      }
    | {
        status: "blocked"
        branch: string
        reason: string
        worktreeDir: string
        dirtyPaths?: string[]
        mergeHead?: boolean
      }
    | {
        status: "infra_error"
        branch: string
        reason: string
        stderr?: string
        worktreeDir?: string
      }

  /**
   * Surfaced when `git merge` against the primary branch hit textual conflicts
   * inside files. Unlike rebase-style flows, the merge is left IN PROGRESS:
   * the worktree is in MERGING state with conflict markers (`<<<<<<<`) in the
   * unmerged paths. The agent reads each path in place, edits the markers
   * away, `git add`s, and `git commit`s — that final commit completes the
   * merge and produces a merge commit at the topology join point. The next
   * `mergeWithMerge` call then sees a clean tree whose tip strictly descends
   * from primary's tip, so step 2 (ff-only) can always advance.
   *
   * Distinct from MergeFailedError (which signals infrastructure problems).
   */
  export const MergeConflictError = NamedError.create(
    "WorktreeMergeConflictError",
    z.object({
      message: z.string(),
      branch: z.string(),
      primaryBranch: z.string(),
      primaryTip: z.string(),
      conflictPaths: z.array(z.string()),
    }),
  )

  /**
   * Bring a goal branch's commits onto the primary branch via merge.
   *
   * Sequence (single canonical path, all under `withGitLock` for atomicity):
   *   1. Resolve the currently checked-out branch of the primary worktree.
   *   2. From the goal worktree, run `git merge --no-edit <primary-branch>`.
   *      - Already-up-to-date / fast-forward: tree advances; tip strictly
   *        descends primary tip.
   *      - 3-way merge succeeds: a merge commit is created; tip strictly
   *        descends both sides.
   *      - Conflict: the worktree is left IN MERGING state (MERGE_HEAD set,
   *        conflict markers in files). We capture the path list and throw
   *        MergeConflictError WITHOUT aborting. The caller (in-session agent)
   *        edits the markers away in place, `git add`s, `git commit`s — that
   *        completes the merge. Host callers must preserve the same MERGING
   *        worktree so the next agent attempt can continue from the conflict
   *        state.
   *   3. From the primary worktree, `git merge --ff-only <branch>`. ff is
   *      guaranteed because the goal tip strictly descends primary tip.
   *
   * Why merge, not rebase: rebase replays goal's commits one-by-one onto
   * primary; on conflict, an agent's reconcile commit appended *after* the
   * conflicting commit never participates in the next replay — the same
   * conflict re-appears every retry, making the protocol non-convergent.
   * Merge produces a single three-way reconcile that the agent commits once,
   * positioning the resolution at the topology join point so subsequent
   * retries advance instead of re-conflicting.
   *
   * The earlier ff-only-only design assumed serial dispatch and broke under
   * per-goal parallel dispatch (late goals branched from stale primary HEAD
   * and could never ff). Merge preserves goal commits exactly, surfaces real
   * textual conflicts via MergeConflictError, and converges in one round of
   * reconcile per actual divergence.
   */
  export const mergeWithMerge = fn(
    z.object({
      branch: z
        .string()
        .describe("Local branch ref to merge (e.g. `opencorvus/build-foo`). Must already contain the goal's build commits."),
      worktreeDir: z
        .string()
        .describe("Filesystem path of the goal's worktree (where the merge runs)."),
    }),
    async (input) => {
      if (!Project.isGitRepo(Instance.directory)) {
        throw new NotGitError({ message: "mergeWithMerge: not a git project" })
      }
      const primary = await primaryWorktreeInfo().catch((err) => {
        throw new MergeFailedError({
          message: `mergeWithMerge(${input.branch}): ${err instanceof Error ? err.message : String(err)}`,
          branch: input.branch,
        })
      })
      return withGitLock(async () => {
        const primaryDir = primary.directory
        const primaryBranch = primary.branch
        let primaryRecoveryCommit: string | undefined
        if (primaryDir !== input.worktreeDir) {
          const validity = await isValid(input.worktreeDir)
          if (!validity.valid) {
            throw new MergeFailedError({
              message:
                `mergeWithMerge(${input.branch}): worktree git linkage is invalid at ${input.worktreeDir}: ` +
                `${validity.reason ?? "unknown reason"}. Reattach or recreate the goal worktree before merge_back.`,
              branch: input.branch,
            })
          }
        }

        // Pre-flight: refuse to start a new merge if the worktree still has
        // an unfinished one (MERGE_HEAD present) or uncommitted changes.
        // Either is a contract violation — the caller must complete the
        // previous merge (`git commit`) and commit ordinary edits before
        // retrying, otherwise we silently subsume their state into a new
        // merge commit and lose the signal.
        const mergeHead = await runGit(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], {
          cwd: input.worktreeDir, timeoutProfile: "fast",
        })
        if (mergeHead.exitCode === 0) {
          throw new MergeFailedError({
            message:
              `mergeWithMerge(${input.branch}): worktree is in an unfinished MERGING state ` +
              `(MERGE_HEAD exists). Resolve conflicts and \`git commit\` to finalize, or ` +
              `report the blocker before retrying.`,
            branch: input.branch,
          })
        }
        const status = await runGit(["-c", "core.quotepath=false", "status", "--porcelain"], {
          cwd: input.worktreeDir, timeoutProfile: "default",
        })
        const dirty = statusLinesBlockingMerge(outputText(status.stdout))
        if (dirty.length > 0) {
          throw new MergeFailedError({
            message:
              `mergeWithMerge(${input.branch}): worktree is dirty. Commit or revert ` +
              `before retrying merge_back.\n${dirty.join("\n")}`,
            branch: input.branch,
          })
        }
        const evidenceDiffs = await committedEvidenceInputDiffs(input.worktreeDir, primaryBranch, input.branch)
        if (evidenceDiffs.length > 0) {
          throw new MergeFailedError({
            message:
              `mergeWithMerge(${input.branch}): refusing to merge committed frontend evidence input files. ` +
              `The task source package is an input contract, not implementation output. Remove these paths ` +
              `from the branch commit before retrying merge_back:\n${evidenceDiffs.join("\n")}`,
            branch: input.branch,
          })
        }
        if (primaryDir !== input.worktreeDir) {
          const primaryState = await inspectBlockedMergeWorktree(primaryDir)
          if (primaryState.mergeHead) {
            throw new MergeFailedError({
              message:
                `mergeWithMerge(${input.branch}): primary worktree ${primaryDir} is in an unfinished ` +
                `MERGING state. Resolve that merge and commit it before retrying merge_back.`,
              branch: input.branch,
            })
          }
          if (primaryState.dirtyPaths.length > 0) {
            primaryRecoveryCommit = await commitPrimaryDirtyWorktree({
              branch: input.branch,
              primaryDir,
              dirtyPaths: primaryState.dirtyPaths,
            })
          }
        }

        // Step 1 — merge primary into the goal worktree. ff is allowed (when
        // goal lags primary with no own commits); otherwise a 3-way merge
        // produces a merge commit. Conflicts leave MERGE_HEAD + markers in
        // files; we capture and re-throw without aborting so the in-session
        // agent can reconcile in place. Host-path callers preserve the same
        // worktree for the next attempt.
        const merged = await runGit(["merge", "--no-edit", primaryBranch], {
          cwd: input.worktreeDir, timeoutProfile: "default",
        })
        if (merged.exitCode !== 0) {
          const conflictList = await runGit(["diff", "--name-only", "--diff-filter=U"], {
            cwd: input.worktreeDir, timeoutProfile: "default",
          })
          const conflictPaths = outputText(conflictList.stdout)
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)

          const primaryTipProbe = await runGit(["rev-parse", `refs/heads/${primaryBranch}`], {
            cwd: primaryDir, timeoutProfile: "fast",
          })
          const primaryTip = outputText(primaryTipProbe.stdout)

          throw new MergeConflictError({
            message:
              `mergeWithMerge(${input.branch}): merge of ${primaryBranch} hit conflicts in ` +
              `${conflictPaths.length} file(s); worktree left in MERGING state. ` +
              `Reconcile each path in place, \`git add\`, then \`git commit\` to finalize ` +
              `the merge and retry.`,
            branch: input.branch,
            primaryBranch,
            primaryTip,
            conflictPaths,
          })
        }

        // Step 2 — ff-merge into primary. Must succeed: goal branch's tip
        // now strictly descends primary's tip (either via ff or via merge
        // commit produced in step 1).
        const ff = await runGit(["merge", "--ff-only", "--no-edit", input.branch], {
          cwd: primaryDir, timeoutProfile: "default",
        })
        if (ff.exitCode !== 0) {
          const stderr = errorText(ff) || "git merge --ff-only failed after successful merge"
          throw new MergeFailedError({
            message: `mergeWithMerge(${input.branch}): post-merge ff-merge failed: ${stderr}`,
            branch: input.branch,
            stderr,
          })
        }

        const headProbe = await runGit(["rev-parse", "HEAD"], {
          cwd: primaryDir, timeoutProfile: "fast",
        })
        const primaryHead = outputText(headProbe.stdout)
        return { primaryBranch, primaryHead, primaryRecoveryCommit }
      })
    },
  )

  /**
   * Public merge publication boundary. This is the only merge API callers
   * should use from agent/session paths: every repository condition resolves
   * to a typed outcome, so merge publication cannot crash the session loop.
   * `mergeWithMerge` remains the lower-level implementation that preserves
   * the exact git topology and named errors for focused unit tests.
   */
  export async function mergeSafely(input: { branch: string; worktreeDir: string }): Promise<MergeOutcome> {
    try {
      const result = await mergeWithMerge(input)
      return {
        status: "merged",
        primaryBranch: result.primaryBranch,
        primaryHead: result.primaryHead,
        ...(result.primaryRecoveryCommit ? { primaryRecoveryCommit: result.primaryRecoveryCommit } : {}),
      }
    } catch (err) {
      if (MergeConflictError.isInstance(err)) {
        const { branch, primaryBranch, primaryTip, conflictPaths } = err.data
        return {
          status: "conflict",
          branch,
          primaryBranch,
          primaryTip,
          conflictPaths,
          worktreeDir: input.worktreeDir,
        }
      }

      if (MergeFailedError.isInstance(err)) {
        const { message, branch } = err.data
        const details = await inspectBlockedMergeWorktree(input.worktreeDir)
        return {
          status: "blocked",
          branch,
          reason: message,
          worktreeDir: input.worktreeDir,
          ...(details.dirtyPaths.length > 0 ? { dirtyPaths: details.dirtyPaths } : {}),
          ...(details.mergeHead ? { mergeHead: true } : {}),
        }
      }

      if (NotGitError.isInstance(err)) {
        return {
          status: "infra_error",
          branch: input.branch,
          reason: err.data.message,
          worktreeDir: input.worktreeDir,
        }
      }

      return {
        status: "infra_error",
        branch: input.branch,
        reason: err instanceof Error ? err.message : String(err),
        worktreeDir: input.worktreeDir,
      }
    }
  }

  export const Info = z
    .object({
      name: z.string(),
      branch: z.string(),
      directory: z.string(),
    })
    .meta({
      ref: "Worktree",
    })

  export type Info = z.infer<typeof Info>

  export const ProjectWorktreeInfo = z
    .object({
      name: z.string(),
      branch: z.string().optional(),
      directory: z.string(),
      goalID: z.string().optional(),
      status: z.enum(["primary", "active", "expired"]),
      removable: z.boolean(),
    })
    .meta({
      ref: "ProjectWorktree",
    })

  export type ProjectWorktreeInfo = z.infer<typeof ProjectWorktreeInfo>

  export const CreateInput = z
    .object({
      name: z.string().optional(),
      startCommand: z
        .string()
        .optional()
        .describe("Additional startup script to run after the project's start command"),
      checkout: z
        .enum(["sync", "async"])
        .optional()
        .describe("Deprecated. Worktree.create always waits until checkout, bootstrap, and startup scripts complete before returning."),
      reuseIfValid: z
        .boolean()
        .optional()
        .describe(
          "When true and `name` is supplied, skip the reclaim wipe and return the existing worktree if its `.git` linkage and `git worktree list` registration both still pass `isValid()`. " +
          "Used by build-agent retries that want to pick up the previous attempt's files (passed-verdict-without-merge_back case) instead of regenerating ~20 minutes of code from scratch. " +
          "Invalid existing trees (zombie linkage, missing branch, etc.) are rejected by the validity gate before the standard reclaim path runs, so corrupt state never silently survives a retry.",
        ),
      taskID: z.string().optional(),
      goalID: z.string().optional(),
      runID: z.string().optional(),
      sessionID: z.string().optional(),
    })
    .meta({
      ref: "WorktreeCreateInput",
    })

  export type CreateInput = z.infer<typeof CreateInput>

  export const RemoveInput = z
    .object({
      directory: z.string(),
    })
    .meta({
      ref: "WorktreeRemoveInput",
    })

  export type RemoveInput = z.infer<typeof RemoveInput>

  export const ResetInput = z
    .object({
      directory: z.string(),
    })
    .meta({
      ref: "WorktreeResetInput",
    })

  export type ResetInput = z.infer<typeof ResetInput>

  export const NotGitError = NamedError.create(
    "WorktreeNotGitError",
    z.object({
      message: z.string(),
    }),
  )

  export const NameGenerationFailedError = NamedError.create(
    "WorktreeNameGenerationFailedError",
    z.object({
      message: z.string(),
    }),
  )

  export const CreateFailedError = NamedError.create(
    "WorktreeCreateFailedError",
    z.object({
      message: z.string(),
    }),
  )

  export const StartCommandFailedError = NamedError.create(
    "WorktreeStartCommandFailedError",
    z.object({
      message: z.string(),
    }),
  )

  export const RemoveFailedError = NamedError.create(
    "WorktreeRemoveFailedError",
    z.object({
      message: z.string(),
    }),
  )

  export const ResetFailedError = NamedError.create(
    "WorktreeResetFailedError",
    z.object({
      message: z.string(),
    }),
  )

  const ADJECTIVES = [
    "brave",
    "calm",
    "clever",
    "cosmic",
    "crisp",
    "curious",
    "eager",
    "gentle",
    "glowing",
    "happy",
    "hidden",
    "jolly",
    "kind",
    "lucky",
    "mighty",
    "misty",
    "neon",
    "nimble",
    "playful",
    "proud",
    "quick",
    "quiet",
    "shiny",
    "silent",
    "stellar",
    "sunny",
    "swift",
    "tidy",
    "witty",
  ] as const

  const NOUNS = [
    "cabin",
    "cactus",
    "canyon",
    "circuit",
    "comet",
    "eagle",
    "engine",
    "falcon",
    "forest",
    "garden",
    "harbor",
    "island",
    "knight",
    "lagoon",
    "meadow",
    "moon",
    "mountain",
    "nebula",
    "orchid",
    "otter",
    "panda",
    "pixel",
    "planet",
    "river",
    "rocket",
    "sailor",
    "squid",
    "star",
    "tiger",
    "wizard",
    "wolf",
  ] as const

  function pick<const T extends readonly string[]>(list: T) {
    return list[Math.floor(Math.random() * list.length)]
  }

  function slug(input: string) {
    return input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "")
  }

  function shortName(input: string) {
    return slug(input).slice(-8) || "worktree"
  }

  function randomName() {
    return `${pick(ADJECTIVES)}-${pick(NOUNS)}`
  }

  async function exists(target: string) {
    return fs
      .stat(target)
      .then(() => true)
      .catch(() => false)
  }

  function outputText(input: Uint8Array | undefined) {
    if (!input?.length) return ""
    return new TextDecoder().decode(input).trim()
  }

  function errorText(result: { stdout?: Uint8Array; stderr?: Uint8Array }) {
    return [outputText(result.stderr), outputText(result.stdout)].filter(Boolean).join("\n")
  }

  function statusLinesBlockingMerge(statusText: string): string[] {
    return statusText
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .filter((line) => !isUntrackedEvidenceInputStatusLine(line))
  }

  function isUntrackedEvidenceInputStatusLine(line: string): boolean {
    if (!line.startsWith("?? ")) return false
    const file = line.slice(3).trim()
    return ProjectRuntimePaths.isEvidenceInputRelativePath(file)
  }

  async function committedEvidenceInputDiffs(worktreeDir: string, primaryBranch: string, branch: string): Promise<string[]> {
    const result = await runGit([
      "-c",
      "core.quotepath=false",
      "diff",
      "--name-only",
      "--no-renames",
      primaryBranch,
      branch,
      "--",
      "web-clone-source",
      "webpage-evidence",
    ], { cwd: worktreeDir, timeoutProfile: "default" }).catch(() => undefined)
    if (!result || result.exitCode !== 0) return []
    return outputText(result.stdout)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((file) => ProjectRuntimePaths.isEvidenceInputRelativePath(file))
  }

  async function inspectBlockedMergeWorktree(directory: string) {
    const mergeHeadResult = await runGit(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], {
      cwd: directory, timeoutProfile: "fast",
    }).catch(() => undefined)
    const mergeHead = mergeHeadResult?.exitCode === 0
    const dirtyResult = await runGit(["-c", "core.quotepath=false", "status", "--porcelain"], {
      cwd: directory, timeoutProfile: "default",
    }).catch(() => undefined)
    const dirtyPaths = dirtyResult ? statusLinesBlockingMerge(outputText(dirtyResult.stdout)) : []
    return { mergeHead, dirtyPaths }
  }

  async function commitPrimaryDirtyWorktree(input: { branch: string; primaryDir: string; dirtyPaths: string[] }) {
    await runGit(["reset", "--", "web-clone-source", "webpage-evidence"], { cwd: input.primaryDir, timeoutProfile: "fast" })
    const trackedAdd = await runGit(["add", "-u", "--", "."], { cwd: input.primaryDir, timeoutProfile: "default" })
    if (trackedAdd.exitCode !== 0) {
      throw new MergeFailedError({
        message:
          `mergeWithMerge(${input.branch}): primary worktree is dirty but could not be staged ` +
          `for merge_back recovery: ${errorText(trackedAdd)}`,
        branch: input.branch,
        stderr: errorText(trackedAdd),
      })
    }
    const untracked = untrackedStatusPaths(input.dirtyPaths)
    for (const chunk of chunks(untracked, 50)) {
      const add = await runGit(["add", "--", ...chunk], { cwd: input.primaryDir, timeoutProfile: "default" })
      if (add.exitCode !== 0) {
        throw new MergeFailedError({
          message:
            `mergeWithMerge(${input.branch}): primary worktree is dirty but could not be staged ` +
            `for merge_back recovery: ${errorText(add)}`,
          branch: input.branch,
          stderr: errorText(add),
        })
      }
    }
    const commit = await runGit(
      [
        "-c", "user.name=opencorvus",
        "-c", "user.email=opencorvus@local",
        "commit", "-m", InternalGitCommitSubject.preservePrimaryWorktree,
      ],
      { cwd: input.primaryDir, timeoutProfile: "default" },
    )
    if (commit.exitCode !== 0) {
      throw new MergeFailedError({
        message:
          `mergeWithMerge(${input.branch}): primary worktree is dirty but recovery commit failed ` +
          `for ${input.dirtyPaths.length} path(s): ${errorText(commit)}`,
        branch: input.branch,
        stderr: errorText(commit),
      })
    }
    const head = await runGit(["rev-parse", "HEAD"], {
      cwd: input.primaryDir, timeoutProfile: "fast",
    })
    if (head.exitCode !== 0) {
      throw new MergeFailedError({
        message:
          `mergeWithMerge(${input.branch}): primary recovery commit succeeded but HEAD could not ` +
          `be resolved: ${errorText(head)}`,
        branch: input.branch,
        stderr: errorText(head),
      })
    }
    return outputText(head.stdout)
  }

  function untrackedStatusPaths(lines: string[]): string[] {
    return uniqueStrings(lines
      .filter((line) => line.startsWith("?? "))
      .flatMap((line) => statusLinePaths(line))
      .filter((file) => !ProjectRuntimePaths.isEvidenceInputRelativePath(file)))
  }

  function statusLinePaths(line: string): string[] {
    const file = line.slice(3).trim()
    if (!file) return []
    const renameArrow = " -> "
    if (!file.includes(renameArrow)) return [file]
    return file.split(renameArrow).map((part) => part.trim()).filter(Boolean)
  }

  function uniqueStrings(input: string[]): string[] {
    return [...new Set(input)]
  }

  function chunks<T>(input: T[], size: number): T[][] {
    const out: T[][] = []
    for (let index = 0; index < input.length; index += size) {
      out.push(input.slice(index, index + size))
    }
    return out
  }

  function failed(result: { stdout?: Uint8Array; stderr?: Uint8Array }) {
    return [outputText(result.stderr), outputText(result.stdout)].filter(Boolean).flatMap((chunk) =>
      chunk
        .split("\n")
        .map((line) => line.trim())
        .flatMap((line) => {
          const match = line.match(/^warning:\s+failed to remove\s+(.+):\s+/i)
          if (!match) return []
          const value = match[1]?.trim().replace(/^['"]|['"]$/g, "")
          if (!value) return []
          return [value]
        }),
    )
  }

  async function prune(root: string, entries: string[]) {
    const base = await canonical(root)
    await Promise.all(
      entries.map(async (entry) => {
        const target = await canonical(path.resolve(root, entry))
        if (target === base) return
        if (!target.startsWith(`${base}${path.sep}`)) return
        await fs.rm(target, { recursive: true, force: true }).catch(() => undefined)
      }),
    )
  }

  async function sweep(root: string) {
    const first = await runGit(["clean", "-ffdx"], { cwd: root, timeoutProfile: "default" })
    if (first.exitCode === 0) return first

    const entries = failed(first)
    if (!entries.length) return first

    await prune(root, entries)
    return runGit(["clean", "-ffdx"], { cwd: root, timeoutProfile: "default" })
  }

  async function canonical(input: string) {
    const abs = path.resolve(input)
    const real = await fs.realpath(abs).catch(() => abs)
    const normalized = path.normalize(real)
    const insensitive = await isCaseInsensitiveFilesystem(normalized)
    return insensitive ? normalized.toLowerCase() : normalized
  }

  type PrimaryWorktreeInfo = { directory: string; branch: string }
  type WorktreeEntry = { path: string; branch?: string }

  function parseWorktreeList(stdout: Uint8Array | Buffer | undefined): WorktreeEntry[] {
    const entries: WorktreeEntry[] = []
    for (const line of outputText(stdout).split("\n").map((item) => item.trim())) {
      if (!line) continue
      if (line.startsWith("worktree ")) {
        const value = line.slice("worktree ".length).trim()
        if (value) entries.push({ path: value })
        continue
      }
      const current = entries[entries.length - 1]
      if (!current) continue
      if (line.startsWith("branch ")) {
        current.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "")
      }
    }
    return entries
  }

  async function findWorktreeEntry(stdout: Uint8Array | Buffer | undefined, directory: string) {
    for (const entry of parseWorktreeList(stdout)) {
      const key = await canonical(entry.path)
      if (key === directory) return entry
    }
  }

  /**
   * Resolve the primary worktree and its currently checked-out branch.
   * `git worktree list --porcelain` reports the original worktree first;
   * child worktrees follow. Goal branches are created from this branch and
   * merge_back publishes back to this same branch, whether it is dev, trunk,
   * main, master, or another local branch name.
   */
  async function primaryWorktreeInfo(): Promise<PrimaryWorktreeInfo> {
    const list = await runGit(["worktree", "list", "--porcelain"], {
      cwd: Instance.worktree, timeoutProfile: "default",
    })
    if (list.exitCode !== 0) {
      throw new Error(errorText(list) || "Failed to read git worktrees")
    }

    const firstEntry = parseWorktreeList(list.stdout)[0]
    const first: { directory?: string; branch?: string } = {
      directory: firstEntry?.path,
      branch: firstEntry?.branch,
    }

    if (!first.directory) {
      throw new Error("Primary worktree not found")
    }
    if (!first.branch) {
      throw new Error(`Primary worktree is detached: ${first.directory}`)
    }
    return { directory: first.directory, branch: first.branch }
  }

  export async function listProjectWorktrees(projectID = Instance.project.id): Promise<ProjectWorktreeInfo[]> {
    if (!Project.isGitRepo(Instance.directory)) {
      throw new NotGitError({ message: "Worktrees are only supported for git projects" })
    }

    const list = await runGit(["worktree", "list", "--porcelain"], {
      cwd: Instance.worktree, timeoutProfile: "default",
    })
    if (list.exitCode !== 0) {
      throw new RemoveFailedError({ message: errorText(list) || "Failed to read git worktrees" })
    }

    const goalByDirectory = new Map<string, { goalID: string; active: boolean }>()
    for (const entry of listGoalWorkspacesForProject(projectID)) {
      const key = await canonical(entry.workspaceDir)
      goalByDirectory.set(key, {
        goalID: entry.goal.id,
        active: isLiveGoalRunStatus(entry.status),
      })
    }

    const parsed = parseWorktreeList(list.stdout)
    const primaryEntry = parsed[0]
    if (!primaryEntry?.path) {
      throw new RemoveFailedError({ message: "Primary worktree not found" })
    }
    const primaryKey = await canonical(primaryEntry.path)
    const out: ProjectWorktreeInfo[] = []
    for (const entry of parsed) {
      const key = await canonical(entry.path)
      const binding = goalByDirectory.get(key)
      const isPrimary = key === primaryKey
      out.push(ProjectWorktreeInfo.parse({
        name: path.basename(entry.path),
        branch: entry.branch,
        directory: entry.path,
        goalID: binding?.active ? binding.goalID : undefined,
        status: isPrimary ? "primary" : binding?.active ? "active" : "expired",
        removable: !isPrimary,
      }))
    }
    return out
  }

  async function isCaseInsensitiveFilesystem(target: string) {
    if (process.platform === "win32") return true
    if (process.platform !== "darwin") return false

    const absolute = path.resolve(target)
    const root = path.parse(absolute).root || "/"
    const cached = caseInsensitiveCache.get(root)
    if (cached !== undefined) return cached

    const dir = await fs.realpath(path.dirname(absolute)).catch(() => path.dirname(absolute))
    const parent = path.dirname(dir)
    const base = path.basename(dir)
    const index = base.search(/[a-zA-Z]/)
    if (index < 0 || parent === dir) {
      caseInsensitiveCache.set(root, false)
      return false
    }

    const toggled =
      base.slice(0, index) +
      (base[index] === base[index].toLowerCase() ? base[index].toUpperCase() : base[index].toLowerCase()) +
      base.slice(index + 1)
    const probe = path.join(parent, toggled)

    const insensitive = await Promise.all([
      fs.stat(dir).catch(() => undefined),
      fs.stat(probe).catch(() => undefined),
    ]).then(([original, variant]) =>
      Boolean(original && variant && original.dev === variant.dev && original.ino === variant.ino),
    )

    caseInsensitiveCache.set(root, insensitive)
    return insensitive
  }

  /** Remove a leftover worktree directory and its branch ref so the same
   *  `name` can be reused. Called only when the caller explicitly passed a
   *  `base` name — i.e. asked for a deterministic path (goal retries). Any
   *  failure throws; we do NOT silently fall back to a randomized suffix
   *  because that rotation is exactly what silently breaks prompt-cache
   *  continuity across retries (new path → new system-prompt bytes → new
   *  1h system cache). Surfacing a hard error here is the contract: the
   *  operator sees that reclaim failed and can intervene. */
  async function reclaimInfo(info: Info): Promise<Info> {
    const { name, branch, directory } = info
    const ref = `refs/heads/${branch}`

    const dirExists = await exists(directory)
    const branchCheck = await runGit(["show-ref", "--verify", "--quiet", ref], {
      cwd: Instance.worktree, timeoutProfile: "fast",
    })
    const branchExists = branchCheck.exitCode === 0

    if (dirExists || branchExists) {
      log.info("worktree reclaim: stale artifacts present, cleaning before reuse", {
        name,
        directory,
        dirExists,
        branchExists,
      })
      // Delegate directory teardown to remove() — it unregisters the git
      // worktree, stops fsmonitor, rm -rf's the directory, AND deletes the
      // associated branch if the worktree is still registered. If it throws,
      // let it propagate: the caller must see the reclaim failure, not get
      // a silently renamed workspace.
      if (dirExists) {
        await remove({ directory })
      }
      // Branch may still be there if: (a) dir didn't exist but a dangling
      // branch ref was left over from a prior crash, or (b) the worktree was
      // never registered against this branch (so remove() didn't touch it).
      // Re-probe and clean up independently.
      const stillExists = await runGit(["show-ref", "--verify", "--quiet", ref], {
        cwd: Instance.worktree, timeoutProfile: "fast",
      })
      if (stillExists.exitCode === 0) {
        const del = await runGit(["branch", "-D", branch], {
          cwd: Instance.worktree, timeoutProfile: "fast",
        })
        if (del.exitCode !== 0) {
          throw new CreateFailedError({
            message:
              `worktree reclaim: failed to delete stale branch ${branch}: ` +
              (errorText(del) || "unknown error"),
          })
        }
      }
      // Sanity check — if anything is still there after reclaim, fail loud.
      if (await exists(directory)) {
        throw new CreateFailedError({
          message: `worktree reclaim: directory still present after remove: ${directory}`,
        })
      }
    }

    return Info.parse({ name, branch, directory })
  }

  async function reclaimBase(root: string, base: string): Promise<Info> {
    const name = base
    return reclaimInfo(Info.parse({
      name,
      branch: `opencorvus/${name}`,
      directory: path.join(root, name),
    }))
  }

  async function candidate(root: string, base?: string) {
    // Deterministic path: caller asked for a specific base name (goal retries
    // do this — worktree name is derived from goalID). Reclaim any stale
    // artifacts under that name and reuse the path. No randomized fallback.
    if (base) return reclaimBase(root, base)

    // Non-deterministic path: caller didn't name the workspace. Try a random
    // name; retry on conflict (collisions here are rare and non-deterministic,
    // so iterating is a genuine retry, not a fallback that masks a lifecycle
    // bug the way the old base-name-plus-suffix branch did).
    for (let attempt = 0; attempt < 26; attempt++) {
      const name = randomName()
      const branch = `opencorvus/${name}`
      const directory = path.join(root, name)

      if (await exists(directory)) continue

      const ref = `refs/heads/${branch}`
      const branchCheck = await runGit(["show-ref", "--verify", "--quiet", ref], {
        cwd: Instance.worktree, timeoutProfile: "fast",
      })
      if (branchCheck.exitCode === 0) continue

      return Info.parse({ name, branch, directory })
    }

    throw new NameGenerationFailedError({ message: "Failed to generate a unique worktree name" })
  }

  async function runStartCommand(directory: string, cmd: string) {
    if (process.platform === "win32") {
      return $`cmd /c ${cmd}`.nothrow().cwd(directory)
    }
    const shell = Shell.acceptable()
    return $`${shell} -c ${cmd}`.nothrow().cwd(directory)
  }

  type StartKind = "project" | "worktree"

  async function runStartScript(directory: string, cmd: string, kind: StartKind) {
    const text = cmd.trim()
    if (!text) return true

    const ran = await runStartCommand(directory, text)
    if (ran.exitCode === 0) return true

    log.error("worktree start command failed", {
      kind,
      directory,
      message: errorText(ran),
    })
    return false
  }

  async function runStartScripts(directory: string, input: { projectID: string; extra?: string }) {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, input.projectID)).get())
    const project = row ? Project.fromRow(row) : undefined
    const startup = project?.commands?.start?.trim() ?? ""
    const ok = await runStartScript(directory, startup, "project")
    if (!ok) return false

    const extra = input.extra ?? ""
    await runStartScript(directory, extra, "worktree")
    return true
  }

  type Gitlink = { object: string; path: string }

  async function readGitlinks(directory: string): Promise<Gitlink[]> {
    const listed = await runGit(["ls-files", "--stage", "-z"], {
      cwd: directory, timeoutProfile: "default",
    })
    if (listed.exitCode !== 0) {
      throw new Error(errorText(listed) || "Failed to read gitlinks")
    }

    return new TextDecoder()
      .decode(listed.stdout)
      .split("\0")
      .flatMap((record): Gitlink[] => {
        if (!record) return []
        const match = record.match(/^160000\s+([0-9a-f]+)\s+\d+\t(.+)$/)
        if (!match?.[1] || !match[2]) return []
        return [{ object: match[1], path: match[2] }]
      })
  }

  async function readUrlBackedSubmodulePaths(directory: string): Promise<Set<string>> {
    if (!(await exists(path.join(directory, ".gitmodules")))) return new Set()

    const paths = await runGit(["config", "-f", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$"], {
      cwd: directory, timeoutProfile: "fast",
    })
    if (paths.exitCode === 1) return new Set()
    if (paths.exitCode !== 0) {
      throw new Error(errorText(paths) || "Failed to read .gitmodules paths")
    }

    const result = new Set<string>()
    for (const line of outputText(paths.stdout).split("\n")) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const separator = trimmed.search(/\s/)
      if (separator < 0) continue
      const key = trimmed.slice(0, separator)
      const submodulePath = trimmed.slice(separator).trim()
      const urlKey = key.replace(/\.path$/, ".url")
      const url = await runGit(["config", "-f", ".gitmodules", "--get", urlKey], {
        cwd: directory, timeoutProfile: "fast",
      })
      if (url.exitCode === 0 && outputText(url.stdout)) result.add(submodulePath)
    }
    return result
  }

  async function isGitWorkTree(directory: string) {
    const checked = await runGit(["rev-parse", "--is-inside-work-tree"], {
      cwd: directory, timeoutProfile: "fast",
    }).catch(() => undefined)
    return checked?.exitCode === 0 && outputText(checked.stdout) === "true"
  }

  function pathInside(root: string, relativePath: string) {
    const base = path.resolve(root)
    const target = path.resolve(base, relativePath)
    const relative = path.relative(base, target)
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Gitlink path escapes worktree root: ${relativePath}`)
    }
    return target
  }

  async function updateUrlBackedGitlinks(directory: string, paths: string[], input?: { force?: boolean }) {
    if (!paths.length) return

    const args = ["-c", "protocol.file.allow=always", "submodule", "update", "--init"]
    if (input?.force) args.push("--force")
    args.push("--", ...paths)

    const updated = await runGit(args, {
      cwd: directory, timeoutProfile: "network",
    })
    if (updated.exitCode !== 0) {
      throw new Error(errorText(updated) || "Failed to update URL-backed gitlinks")
    }
  }

  async function materializeLocalGitlink(input: {
    sourceRoot: string
    targetRoot: string
    gitlink: Gitlink
  }) {
    const source = pathInside(input.sourceRoot, input.gitlink.path)
    const target = pathInside(input.targetRoot, input.gitlink.path)
    if (!(await isGitWorkTree(source))) {
      throw new Error(
        `Gitlink ${input.gitlink.path} has no .gitmodules URL and no local nested Git checkout at ${source}`,
      )
    }

    const commit = await runGit(["cat-file", "-e", `${input.gitlink.object}^{commit}`], {
      cwd: source, timeoutProfile: "fast",
    })
    if (commit.exitCode !== 0) {
      throw new Error(
        `Local nested Git checkout ${source} does not contain gitlink commit ${input.gitlink.object}: ${errorText(commit)}`,
      )
    }

    await fs.rm(target, { recursive: true, force: true })
    await fs.mkdir(path.dirname(target), { recursive: true })

    const cloned = await runGit(["-c", "protocol.file.allow=always", "clone", "--local", "--no-checkout", source, target], {
      cwd: input.targetRoot, timeoutProfile: "network",
    })
    if (cloned.exitCode !== 0) {
      throw new Error(errorText(cloned) || `Failed to clone local gitlink ${input.gitlink.path}`)
    }

    const reset = await runGit(["reset", "--hard", input.gitlink.object], {
      cwd: target, timeoutProfile: "default",
    })
    if (reset.exitCode !== 0) {
      throw new Error(errorText(reset) || `Failed to checkout local gitlink ${input.gitlink.path}`)
    }
  }

  async function materializeGitlinks(input: { sourceRoot: string; targetRoot: string; force?: boolean }) {
    const gitlinks = await readGitlinks(input.targetRoot)
    if (!gitlinks.length) return

    const urlBackedPaths = await readUrlBackedSubmodulePaths(input.targetRoot)
    const urlBacked = gitlinks.filter((gitlink) => urlBackedPaths.has(gitlink.path))
    await updateUrlBackedGitlinks(input.targetRoot, urlBacked.map((gitlink) => gitlink.path), {
      force: input.force,
    })

    for (const gitlink of gitlinks) {
      if (urlBackedPaths.has(gitlink.path)) continue
      await materializeLocalGitlink({
        sourceRoot: input.sourceRoot,
        targetRoot: input.targetRoot,
        gitlink,
      })
    }

    for (const gitlink of gitlinks) {
      const target = pathInside(input.targetRoot, gitlink.path)
      if (!(await isGitWorkTree(target))) {
        throw new Error(`Gitlink ${gitlink.path} was not materialized at ${target}`)
      }
      const source = pathInside(input.sourceRoot, gitlink.path)
      await materializeGitlinks({
        sourceRoot: (await isGitWorkTree(source)) ? source : target,
        targetRoot: target,
        force: input.force,
      })
    }
  }

  async function resetMaterializedGitlinks(directory: string) {
    const gitlinks = await readGitlinks(directory)
    for (const gitlink of gitlinks) {
      const target = pathInside(directory, gitlink.path)
      if (!(await isGitWorkTree(target))) {
        throw new Error(`Gitlink ${gitlink.path} was not materialized at ${target}`)
      }

      const reset = await runGit(["reset", "--hard"], {
        cwd: target, timeoutProfile: "default",
      })
      if (reset.exitCode !== 0) {
        throw new Error(errorText(reset) || `Failed to reset gitlink ${gitlink.path}`)
      }

      const clean = await runGit(["clean", "-ffdx"], {
        cwd: target, timeoutProfile: "default",
      })
      if (clean.exitCode !== 0) {
        throw new Error(errorText(clean) || `Failed to clean gitlink ${gitlink.path}`)
      }

      await resetMaterializedGitlinks(target)
    }
  }

  async function initializeSubmodules(input: { sourceRoot: string; targetRoot: string }) {
    await materializeGitlinks(input).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      log.error("worktree gitlink materialization failed", { directory: input.targetRoot, message })
      throw new CreateFailedError({ message })
    })
  }

  export const create = fn(CreateInput.optional(), async (input) => {
    if (!Project.isGitRepo(Instance.directory)) {
      throw new NotGitError({ message: "Worktrees are only supported for git projects" })
    }

    // Resolve the PRIMARY worktree (main repo root) first so a dispatched
    // goal session (whose Instance.directory IS itself a child worktree)
    // doesn't cause nested `.opencorvus/runtime/.opencorvus/runtime/...`
    // recursion. `primaryWorktreeInfo()` always returns the primary repo root.
    //
    // Worktrees live UNDER `<primary>/.opencorvus/runtime/` — co-located
    // with other runtime scratch (attachments, visual-diff output). Previous
    // design placed them in the PARENT of the project root, which leaked
    // scratch dirs into the user's workspace for real projects and piled
    // hundreds of zombie dirs into %TEMP% for benchmarks. One `.gitignore`
    // entry (`/.opencorvus/`) covers the entire tree now.
    const primary = await primaryWorktreeInfo().catch((err) => {
      throw new CreateFailedError({ message: err instanceof Error ? err.message : String(err) })
    })
    const primaryDir = primary.directory
    const root = worktreesRoot(primaryDir)
    await fs.mkdir(root, { recursive: true })

    const base = input?.name ? slug(input.name) : ""
    const scopedInfo = (() => {
      if (input?.taskID && input.goalID && input.runID) {
        const name = base || `goal-${shortName(input.goalID)}`
        return Info.parse({
          name,
          branch: ProjectRuntimePaths.worktreeBranch({
            taskID: input.taskID,
            goalID: input.goalID,
            runID: input.runID,
          }),
          directory: ProjectRuntimePaths.worktreeDir(primaryDir, input.taskID, input.goalID, input.runID),
        })
      }
      if (input?.taskID && input.sessionID) {
        const name = base || `session-${shortName(input.sessionID)}`
        return Info.parse({
          name,
          branch: ProjectRuntimePaths.worktreeBranch({
            taskID: input.taskID,
            sessionID: input.sessionID,
          }),
          directory: ProjectRuntimePaths.directBuildWorktreeDir(primaryDir, input.taskID, input.sessionID),
        })
      }
      return undefined
    })()

    const materializeScopedRuntime = async (directory: string) => {
      if (!input?.taskID) return
      try {
        await TaskRuntimeMaterializer.materializeFrontendDesign({
          projectDir: primaryDir,
          taskID: input.taskID,
          worktreeDir: directory,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.error("worktree task runtime materialization failed", {
          directory,
          taskID: input.taskID,
          message,
        })
        throw new CreateFailedError({ message })
      }
    }

    // Optional fast path: caller asked to reuse a previously-created worktree
    // with the same deterministic name (build-agent retry of an attempt that
    // produced files but skipped merge_back). Only honoured when the existing
    // dir + git linkage is still healthy via isValid(); otherwise fall through
    // to the regular candidate/reclaim path so the unhealthy state cannot be
    // silently propagated.
    if (base && input?.reuseIfValid) {
      const directory = scopedInfo?.directory ?? path.join(root, base)
      const branch = scopedInfo?.branch ?? `opencorvus/${base}`
      const validity = await isValid(directory)
      if (validity.valid) {
        log.info("worktree reuse: existing valid worktree, skipping create", {
          name: base,
          directory,
          branch,
        })
        await materializeScopedRuntime(directory)
        await Project.addSandbox(Instance.project.id, directory).catch(() => undefined)
        return Info.parse({ name: base, branch, directory })
      }
      log.info("worktree reuse: existing tree invalid, falling through to reclaim", {
        name: base,
        directory,
        reason: validity.reason,
      })
    }

    const info = scopedInfo ? await reclaimInfo(scopedInfo) : await candidate(root, base || undefined)

    // All git operations serialized to prevent concurrent corruption
    await withGitLock(async () => {
      // CONTRACT: project opening always commits the baseline .gitignore
      // first (see engine/git.ts ensureGitignore), so HEAD is non-empty by
      // the time any worktree is requested. If we still see no HEAD here,
      // bootstrap broke earlier — fail loud rather than paper over with a
      // `git add -A` "initial scaffold" empty commit that historically
      // swallowed `node_modules/` into HEAD before .gitignore landed.
      const hasCommits = (await runGit(["rev-parse", "--verify", "HEAD"], {
        cwd: primaryDir, timeoutProfile: "fast",
      })).exitCode === 0
      if (!hasCommits) {
        throw new CreateFailedError({
          message:
            `Worktree create requires HEAD to exist on the primary repo (${primaryDir}). ` +
            `The project bootstrap path (Instance.provide → Project.initGit → ensureGitignore) ` +
            `must seed the baseline .gitignore commit before any worktree dispatch — investigate ` +
            `why ensureGitignore did not land a first commit instead of patching here.`,
        })
      }

      const created = await runGit(
        ["worktree", "add", "--no-checkout", "-b", info.branch, info.directory, primary.branch],
        { cwd: primaryDir, timeoutProfile: "default" },
      )
      if (created.exitCode !== 0) {
        throw new CreateFailedError({ message: errorText(created) || "Failed to create git worktree" })
      }
    })

    await Project.addSandbox(Instance.project.id, info.directory).catch(() => undefined)

    const projectID = Instance.project.id
    const extra = input?.startCommand?.trim()
    const populate = async () => {
      const populated = await runGit(["reset", "--hard"], {
        cwd: info.directory, timeoutProfile: "default",
      })
      if (populated.exitCode !== 0) {
        const message = errorText(populated) || "Failed to populate worktree"
        log.error("worktree checkout failed", { directory: info.directory, message })
        GlobalBus.emit("event", {
          directory: info.directory,
          payload: {
            type: Event.Failed.type,
            properties: {
              message,
            },
          },
        })
        throw new CreateFailedError({ message })
      }

      await initializeSubmodules({ sourceRoot: primaryDir, targetRoot: info.directory }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        GlobalBus.emit("event", {
          directory: info.directory,
          payload: {
            type: Event.Failed.type,
            properties: {
              message,
            },
          },
        })
        throw error
      })

      await materializeScopedRuntime(info.directory).catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        GlobalBus.emit("event", {
          directory: info.directory,
          payload: {
            type: Event.Failed.type,
            properties: {
              message,
            },
          },
        })
        throw error
      })

      const started = await runStartScripts(info.directory, { projectID, extra })
      if (!started) {
        GlobalBus.emit("event", {
          directory: info.directory,
          payload: {
            type: Event.Failed.type,
            properties: {
              message: "Worktree startup scripts failed",
            },
          },
        })
        throw new StartCommandFailedError({ message: `Worktree startup scripts failed: ${info.directory}` })
      }

      GlobalBus.emit("event", {
        directory: info.directory,
        payload: {
          type: Event.Ready.type,
          properties: {
            name: info.name,
            branch: info.branch,
          },
        },
      })
    }

    try {
      await populate()
    } catch (error) {
      await remove({ directory: info.directory }).catch((cleanupError) => {
        log.error("worktree create cleanup failed", {
          directory: info.directory,
          error: String(cleanupError),
        })
      })
      await Project.removeSandbox(Instance.project.id, info.directory).catch(() => undefined)
      throw error
    }

    return info
  })

  /**
   * Verify that `directory` is a *live* git worktree: both the per-worktree
   * `.git` linkage (file or dir) is present on disk AND the primary repo's
   * `git worktree list` still has it registered.
   *
   * Exists because Windows cleanup has a partial-failure mode that silently
   * creates "zombie" worktrees: `git worktree remove --force` deletes the
   * per-worktree `.git` link + the primary repo's `.git/worktrees/<name>/`
   * metadata in one step, then tries to `rm -rf` the directory. If a child
   * process (bun test runner, fsmonitor, vite dev server, MSVC-file-locked
   * `node_modules/*.dll`) still holds a handle, the rm fails — but the two
   * git-level deletes already succeeded. Residue on disk: everything except
   * `.git`. If cleanup clears the goal's persistent workspace pointer
   * (engine_artifact[goal_run_attempt].payload.workspace_dir; pre-Phase B
   * this lived as engine_goal.workspace_dir) despite that physical failure,
   * the next dispatch loses the only pointer to the leaked worktree. If it
   * reuses a directory with broken `.git` linkage, git operations can walk
   * up and land on the PRIMARY repo's `.git` — commits go to master, the
   * goal branch never advances, every retry silently overwrites itself.
   * Callers that intend to reuse a recorded workspace_dir must gate on this.
   */
  export async function isValid(directory: string): Promise<{ valid: boolean; reason?: string }> {
    const gitLink = path.join(directory, ".git")
    if (!(await exists(gitLink))) {
      return { valid: false, reason: `missing .git linkage at ${gitLink}` }
    }
    const list = await runGit(["worktree", "list", "--porcelain"], {
      cwd: Instance.worktree, timeoutProfile: "default",
    })
    if (list.exitCode !== 0) {
      return { valid: false, reason: errorText(list) || "git worktree list failed" }
    }
    const target = await canonical(directory)
    const lines = outputText(list.stdout).split("\n")
    for (const line of lines) {
      if (!line.startsWith("worktree ")) continue
      const entryPath = line.slice("worktree ".length).trim()
      if (!entryPath) continue
      const entryKey = await canonical(entryPath)
      if (entryKey === target) return { valid: true }
    }
    return { valid: false, reason: `directory not registered in 'git worktree list'` }
  }

  async function materializeRecordedTaskRuntime(directory: string): Promise<string | undefined> {
    let primary: Awaited<ReturnType<typeof primaryWorktreeInfo>>
    try {
      primary = await primaryWorktreeInfo()
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }

    const taskID = taskIDFromRuntimeWorktree(primary.directory, directory)
    if (!taskID) return undefined

    try {
      await TaskRuntimeMaterializer.materializeFrontendDesign({
        projectDir: primary.directory,
        taskID,
        worktreeDir: directory,
      })
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
    return undefined
  }

  export async function recoverRecorded(input: {
    directory: string
    branch: string
  }): Promise<{ status: "recovered"; directory: string; branch: string } | { status: "unrecoverable"; reason: string }> {
    const validity = await isValid(input.directory)
    if (validity.valid) {
      const runtimeError = await materializeRecordedTaskRuntime(input.directory)
      if (runtimeError) return { status: "unrecoverable", reason: runtimeError }
      return { status: "recovered", directory: input.directory, branch: input.branch }
    }

    const branchCheck = await runGit(["show-ref", "--verify", "--quiet", `refs/heads/${input.branch}`], {
      cwd: Instance.worktree, timeoutProfile: "fast",
    })
    if (branchCheck.exitCode !== 0) {
      return { status: "unrecoverable", reason: `branch ${input.branch} does not exist` }
    }

    const gitLink = path.join(input.directory, ".git")
    const gitLinkExists = await exists(gitLink)
    if (gitLinkExists) {
      return { status: "unrecoverable", reason: validity.reason ?? "worktree registration is invalid" }
    }

    const dirExists = await exists(input.directory)
    if (dirExists) {
      const entries = await fs.readdir(input.directory).catch(() => [])
      if (entries.length > 0) {
        return {
          status: "unrecoverable",
          reason:
            `missing .git linkage at ${gitLink}, but directory contains ${entries.length} item(s); ` +
            `preserving it instead of reclaiming automatically`,
        }
      }
    }

    await fs.mkdir(path.dirname(input.directory), { recursive: true })
    const added = await runGit(["worktree", "add", "--force", input.directory, input.branch], {
      cwd: Instance.worktree, timeoutProfile: "default",
    })
    if (added.exitCode !== 0) {
      return { status: "unrecoverable", reason: errorText(added) || "git worktree add failed" }
    }

    const nextValidity = await isValid(input.directory)
    if (!nextValidity.valid) {
      return { status: "unrecoverable", reason: nextValidity.reason ?? "reattached worktree is still invalid" }
    }
    const runtimeError = await materializeRecordedTaskRuntime(input.directory)
    if (runtimeError) return { status: "unrecoverable", reason: runtimeError }
    return { status: "recovered", directory: input.directory, branch: input.branch }
  }

  export const remove = fn(RemoveInput, async (input) => {
    if (!Project.isGitRepo(Instance.directory)) {
      throw new NotGitError({ message: "Worktrees are only supported for git projects" })
    }

    const directory = await canonical(input.directory)

    const clean = (target: string) =>
      fs
        .rm(target, {
          recursive: true,
          force: true,
          maxRetries: 50,
          retryDelay: 100,
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          throw new RemoveFailedError({ message: message || "Failed to remove git worktree directory" })
        })

    const stop = async (target: string) => {
      if (!(await exists(target))) return
      await runGit(["fsmonitor--daemon", "stop"], { cwd: target, timeoutProfile: "fast" })
    }

    // All git operations serialized to prevent concurrent corruption with create/merge
    return withGitLock(async () => {
      const list = await runGit(["worktree", "list", "--porcelain"], {
        cwd: Instance.worktree, timeoutProfile: "default",
      })
      if (list.exitCode !== 0) {
        throw new RemoveFailedError({ message: errorText(list) || "Failed to read git worktrees" })
      }

      const primaryEntry = parseWorktreeList(list.stdout)[0]
      const primary = primaryEntry ? await canonical(primaryEntry.path) : undefined
      if (primary && directory === primary) {
        throw new RemoveFailedError({ message: "Cannot remove the primary workspace" })
      }

      const entry = await findWorktreeEntry(list.stdout, directory)

      if (!entry?.path) {
        const directoryExists = await exists(directory)
        if (directoryExists) {
          await stop(directory)
          await clean(directory)
        }
        return true
      }

      await stop(entry.path)
      const removed = await runGit(["worktree", "remove", "--force", entry.path], {
        cwd: Instance.worktree, timeoutProfile: "default",
      })
      if (removed.exitCode !== 0) {
        const next = await runGit(["worktree", "list", "--porcelain"], {
          cwd: Instance.worktree, timeoutProfile: "default",
        })
        if (next.exitCode !== 0) {
          throw new RemoveFailedError({
            message: errorText(removed) || errorText(next) || "Failed to remove git worktree",
          })
        }

        const stale = await findWorktreeEntry(next.stdout, directory)
        if (stale?.path) {
          throw new RemoveFailedError({ message: errorText(removed) || "Failed to remove git worktree" })
        }
      }

      await clean(entry.path)

      const branch = entry.branch?.replace(/^refs\/heads\//, "")
      if (branch) {
        const deleted = await runGit(["branch", "-D", branch], {
          cwd: Instance.worktree, timeoutProfile: "fast",
        })
        if (deleted.exitCode !== 0) {
          throw new RemoveFailedError({ message: errorText(deleted) || "Failed to delete worktree branch" })
        }
      }

      return true
    })
  })

  export const reset = fn(ResetInput, async (input) => {
    if (!Project.isGitRepo(Instance.directory)) {
      throw new NotGitError({ message: "Worktrees are only supported for git projects" })
    }

    const primaryInfo = await primaryWorktreeInfo().catch((err) => {
      throw new ResetFailedError({ message: err instanceof Error ? err.message : String(err) })
    })
    const directory = await canonical(input.directory)
    const primary = await canonical(primaryInfo.directory)
    if (directory === primary) {
      throw new ResetFailedError({ message: "Cannot reset the primary workspace" })
    }

    const worktreePath = await withGitLock(async () => {
      const list = await runGit(["worktree", "list", "--porcelain"], {
        cwd: Instance.worktree, timeoutProfile: "default",
      })
      if (list.exitCode !== 0) {
        throw new ResetFailedError({ message: errorText(list) || "Failed to read git worktrees" })
      }

      const lines = outputText(list.stdout)
        .split("\n")
        .map((line) => line.trim())
      const entries = lines.reduce<{ path?: string; branch?: string }[]>((acc, line) => {
        if (!line) return acc
        if (line.startsWith("worktree ")) {
          acc.push({ path: line.slice("worktree ".length).trim() })
          return acc
        }
        const current = acc[acc.length - 1]
        if (!current) return acc
        if (line.startsWith("branch ")) {
          current.branch = line.slice("branch ".length).trim()
        }
        return acc
      }, [])

      const entry = await (async () => {
        for (const item of entries) {
          if (!item.path) continue
          const key = await canonical(item.path)
          if (key === directory) return item
        }
      })()
      if (!entry?.path) {
        throw new ResetFailedError({ message: "Worktree not found" })
      }

      const target = primaryInfo.branch

      const worktreePath = entry.path
      const resetToTarget = await runGit(["reset", "--hard", target], {
        cwd: worktreePath, timeoutProfile: "default",
      })
      if (resetToTarget.exitCode !== 0) {
        throw new ResetFailedError({ message: errorText(resetToTarget) || "Failed to reset worktree to target" })
      }

      const clean = await sweep(worktreePath)
      if (clean.exitCode !== 0) {
        throw new ResetFailedError({ message: errorText(clean) || "Failed to clean worktree" })
      }

      await materializeGitlinks({ sourceRoot: primaryInfo.directory, targetRoot: worktreePath, force: true }).catch(
        (error) => {
          throw new ResetFailedError({ message: error instanceof Error ? error.message : String(error) })
        },
      )

      await resetMaterializedGitlinks(worktreePath).catch((error) => {
        throw new ResetFailedError({ message: error instanceof Error ? error.message : String(error) })
      })

      const taskID = taskIDFromRuntimeWorktree(primaryInfo.directory, worktreePath)
      if (taskID) {
        await TaskRuntimeMaterializer.materializeFrontendDesign({
          projectDir: primaryInfo.directory,
          taskID,
          worktreeDir: worktreePath,
        }).catch((error) => {
          throw new ResetFailedError({ message: error instanceof Error ? error.message : String(error) })
        })
      }

      const status = await runGit(["status", "--porcelain=v1"], {
        cwd: worktreePath, timeoutProfile: "default",
      })
      if (status.exitCode !== 0) {
        throw new ResetFailedError({ message: errorText(status) || "Failed to read git status" })
      }

      const dirty = statusLinesBlockingMerge(outputText(status.stdout))
      if (dirty.length > 0) {
        throw new ResetFailedError({ message: `Worktree reset left local changes:\n${dirty.join("\n")}` })
      }

      return worktreePath
    })

    const projectID = Instance.project.id
    const started = await runStartScripts(worktreePath, { projectID })
    if (!started) {
      throw new StartCommandFailedError({ message: `Worktree startup scripts failed: ${worktreePath}` })
    }

    return true
  })
}
