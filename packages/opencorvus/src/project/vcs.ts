import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import path from "path"
import { Log } from "@/util/log"
import { git } from "@/util/git"
import { Instance, lazyInstanceState } from "./instance"
import { Project } from "./project"
import { Filesystem } from "@/util/filesystem"
import { FileWatcher } from "@/file/watcher"

const log = Log.create({ service: "vcs" })

export namespace Vcs {
  export const Event = {
    BranchUpdated: BusEvent.define(
      "vcs.branch.updated",
      z.object({
        branch: z.string().optional(),
      }),
    ),
  }

  export const Info = z
    .object({
      /** True when a git repository exists at the working directory. False means no .git is present. */
      initialized: z.boolean(),
      /** Current branch name. Undefined when no commits exist (unborn HEAD). */
      branch: z.string().optional(),
      /** Current HEAD commit short hash. Undefined when no commits exist (unborn HEAD). */
      commit: z.string().optional(),
      clean: z.boolean(),
      dirty: z.boolean(),
      staged: z.number().int().nonnegative(),
      modified: z.number().int().nonnegative(),
      untracked: z.number().int().nonnegative(),
      conflicts: z.number().int().nonnegative(),
      ahead: z.number().int().nonnegative(),
      behind: z.number().int().nonnegative(),
    })
    .meta({
      ref: "VcsInfo",
    })
  export type Info = z.infer<typeof Info>

  function parse(text: string, input: { initialized: boolean; branch?: string; commit?: string }): Info {
    let ahead = 0
    let behind = 0
    let staged = 0
    let modified = 0
    let untracked = 0
    let conflicts = 0

    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      if (line.startsWith("## ")) {
        const status = line.match(/\[(.*?)\]/)?.[1]
        if (!status) continue
        for (const item of status.split(",").map((x) => x.trim()).filter(Boolean)) {
          const nextAhead = item.match(/^ahead (\d+)$/)
          if (nextAhead) {
            ahead = Number(nextAhead[1])
            continue
          }
          const nextBehind = item.match(/^behind (\d+)$/)
          if (nextBehind) behind = Number(nextBehind[1])
        }
        continue
      }

      const x = line[0] ?? " "
      const y = line[1] ?? " "
      if (x === "?" && y === "?") {
        untracked += 1
        continue
      }
      if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
        conflicts += 1
      }
      if (x !== " " && x !== "?") staged += 1
      if (y !== " " && y !== "?") modified += 1
    }

    const dirty = staged > 0 || modified > 0 || untracked > 0 || conflicts > 0
    return {
      initialized: input.initialized,
      branch: input.branch,
      commit: input.commit,
      clean: !dirty,
      dirty,
      staged,
      modified,
      untracked,
      conflicts,
      ahead,
      behind,
    }
  }

  async function currentCommit(cwd: string): Promise<string | undefined> {
    const result = await git(["rev-parse", "--short", "HEAD"], { cwd, timeoutProfile: "fast" })
    if (result.exitCode !== 0) return undefined
    const out = result.text().trim()
    return out || undefined
  }

  async function currentBranch() {
    const result = await git(["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: Instance.worktree,
      timeoutProfile: "fast",
    })
    if (result.exitCode !== 0) return undefined
    const out = result.text().trim()
    return out || undefined
  }

  const state = lazyInstanceState(
    async () => {
      if (!Project.isGitRepo(Instance.directory)) {
        return { branch: async () => undefined, unsubscribe: undefined }
      }
      let current = await currentBranch()
      log.info("initialized", { branch: current })

      const unsubscribe = Bus.subscribe(FileWatcher.Event.Updated, async (evt) => {
        if (!evt.properties.file.endsWith("HEAD")) return
        const next = await currentBranch()
        if (next !== current) {
          log.info("branch changed", { from: current, to: next })
          current = next
          Bus.publish(Event.BranchUpdated, { branch: next })
        }
      })

      return {
        branch: async () => current,
        unsubscribe,
      }
    },
    async (state) => {
      state.unsubscribe?.()
    },
  )

  export async function init() {
    return state()
  }

  /**
   * Discard the cached VCS state for the current instance directory.
   * The next call to `info()` or `branch()` will re-initialize from scratch,
   * re-probing `.git` on disk and re-attaching the `.git/HEAD` file watcher.
   * Call this after `git init` completes while active sessions prevent a full
   * `Instance.dispose()`.
   */
  export function resetState() {
    state.reset()
  }

  export async function branch() {
    return await state().then((s) => s.branch())
  }

  export async function info() {
    // Single source of truth for "is this a git repo": disk probe via
    // Project.isGitRepo. Never consult a cached column/field — rule 22.
    const initialized = Project.isGitRepo(Instance.directory)
    if (!initialized) {
      return parse("", { initialized: false })
    }
    // Suppress branch when no commits exist (unborn HEAD). git rev-parse
    // --abbrev-ref HEAD returns the configured default (e.g. "main") even
    // before any commit; we only report it once a commit exists.
    const commit = await currentCommit(Instance.directory)
    const rawBranch = await state().then((s) => s.branch())
    const branch = commit ? rawBranch : undefined
    const result = await git(["status", "--porcelain=v1", "--branch"], {
      cwd: Instance.directory,
      timeoutProfile: "default",
    })
    const text = result.exitCode === 0 ? result.text() : ""
    return parse(text, { initialized: true, branch, commit })
  }
}
