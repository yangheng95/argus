import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import z from "zod"
import { NamedError } from "@opencorvus-ai/util/error"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Project } from "../project/project"
import { Database, eq } from "../storage/db"
import { ProjectTable } from "../project/project.sql"
import { fn } from "../util/fn"
import { Log } from "../util/log"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Shell } from "@/shell/shell"

export namespace Worktree {
  const log = Log.create({ service: "worktree" })
  const caseInsensitiveCache = new Map<string, boolean>()

  // Per-project git mutex: serializes worktree add/remove/reset operations
  // to prevent concurrent git commands from corrupting the repository.
  const gitLocks = new Map<string, Promise<void>>()
  async function withGitLock<T>(fn: () => Promise<T>): Promise<T> {
    const key = Instance.project.id
    const prev = gitLocks.get(key) ?? Promise.resolve()
    let resolve!: () => void
    const next = new Promise<void>((r) => (resolve = r))
    gitLocks.set(key, next)
    await prev
    try {
      return await fn()
    } finally {
      resolve()
    }
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
   *        completes the merge. The host path catches the same error and runs
   *        `git merge --abort` to clean up before failing the build.
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
  /**
   * Stage and commit any uncommitted changes in `worktreeDir` so the next
   * `git merge <primary>` runs against a clean tree. External executors
   * (claude-code, codex) cannot call OpenCorvus's `merge_back` tool — the
   * host owns finalization for them — so the host is the only place that
   * knows the branch is about to be merged. If the executor wrote files but
   * never ran `git commit` (claude-code does this when the system prompt
   * does not explicitly require a commit), `git merge` would either refuse
   * to start (dirty tree) or silently swallow the changes into the merge
   * commit, masking a real protocol violation.
   *
   * Returns `{ committed: false }` if the worktree is already clean,
   * else `{ committed: true, head }` after the new commit. Uses local
   * git config so the commit identity does not require a global
   * `user.email`. Idempotent: a second call on a clean tree is a no-op.
   */
  export const commitDirty = fn(
    z.object({
      worktreeDir: z.string().describe("Filesystem path of the worktree to scan + commit."),
      label: z
        .string()
        .describe("Short context tag used in the commit message body (e.g. branch name or session ID).")
        .default("opencorvus host autocommit"),
    }),
    async (input) => {
      if (!Project.isGitRepo(input.worktreeDir)) {
        throw new NotGitError({ message: `commitDirty: ${input.worktreeDir} is not a git worktree` })
      }
      const status = await $`git status --porcelain`.quiet().nothrow().cwd(input.worktreeDir)
      const dirty = outputText(status.stdout).trim().length > 0
      if (!dirty) return { committed: false as const }

      // `-A` covers added / modified / deleted; `--allow-empty` is omitted on
      // purpose — if status was non-empty but `add` produced no index change
      // (e.g. all entries are .gitignored), we want the commit to fail loudly
      // rather than create an empty commit that hides the misconfig.
      const add = await $`git add -A`.quiet().nothrow().cwd(input.worktreeDir)
      if (add.exitCode !== 0) {
        throw new MergeFailedError({
          message: `commitDirty: git add -A failed in ${input.worktreeDir}: ${errorText(add)}`,
          branch: input.label,
          stderr: errorText(add),
        })
      }
      const commit = await $`git -c user.name=opencorvus -c user.email=build@opencorvus.local commit -m ${`build(host): ${input.label}`}`
        .quiet().nothrow().cwd(input.worktreeDir)
      if (commit.exitCode !== 0) {
        throw new MergeFailedError({
          message: `commitDirty: git commit failed in ${input.worktreeDir}: ${errorText(commit)}`,
          branch: input.label,
          stderr: errorText(commit),
        })
      }
      const head = await $`git rev-parse HEAD`.quiet().nothrow().cwd(input.worktreeDir)
      return { committed: true as const, head: outputText(head.stdout) }
    },
  )

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

        // Pre-flight: refuse to start a new merge if the worktree still has
        // an unfinished one (MERGE_HEAD present) or uncommitted changes.
        // Either is a contract violation — the caller must complete the
        // previous merge (`git commit`) or abandon it (`git merge --abort`)
        // before retrying, otherwise we silently subsume their state into
        // a new merge commit and lose the signal.
        const mergeHead = await $`git rev-parse --verify --quiet MERGE_HEAD`
          .quiet().nothrow().cwd(input.worktreeDir)
        if (mergeHead.exitCode === 0) {
          throw new MergeFailedError({
            message:
              `mergeWithMerge(${input.branch}): worktree is in an unfinished MERGING state ` +
              `(MERGE_HEAD exists). Resolve conflicts and \`git commit\` to finalize, or ` +
              `\`git merge --abort\` to discard, then retry.`,
            branch: input.branch,
          })
        }
        const status = await $`git status --porcelain`.quiet().nothrow().cwd(input.worktreeDir)
        if (outputText(status.stdout).trim().length > 0) {
          throw new MergeFailedError({
            message:
              `mergeWithMerge(${input.branch}): worktree is dirty. Commit or revert ` +
              `before retrying merge_back.`,
            branch: input.branch,
          })
        }

        // Step 1 — merge primary into the goal worktree. ff is allowed (when
        // goal lags primary with no own commits); otherwise a 3-way merge
        // produces a merge commit. Conflicts leave MERGE_HEAD + markers in
        // files; we capture and re-throw without aborting so the in-session
        // agent can reconcile in place. Host-path callers catch this error
        // and abort externally.
        const merged = await $`git merge --no-edit ${primaryBranch}`
          .quiet().nothrow().cwd(input.worktreeDir)
        if (merged.exitCode !== 0) {
          const conflictList = await $`git diff --name-only --diff-filter=U`
            .quiet().nothrow().cwd(input.worktreeDir)
          const conflictPaths = outputText(conflictList.stdout)
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)

          const primaryTipProbe = await $`git rev-parse refs/heads/${primaryBranch}`
            .quiet().nothrow().cwd(primaryDir)
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
        const ff = await $`git merge --ff-only --no-edit ${input.branch}`
          .quiet().nothrow().cwd(primaryDir)
        if (ff.exitCode !== 0) {
          const stderr = errorText(ff) || "git merge --ff-only failed after successful merge"
          throw new MergeFailedError({
            message: `mergeWithMerge(${input.branch}): post-merge ff-merge failed: ${stderr}`,
            branch: input.branch,
            stderr,
          })
        }

        const headProbe = await $`git rev-parse HEAD`.quiet().nothrow().cwd(primaryDir)
        const primaryHead = outputText(headProbe.stdout)
        return { primaryBranch, primaryHead }
      })
    },
  )

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
          "Falls back to the standard reclaim path when the existing tree is invalid (zombie linkage, missing branch, etc.) so corrupt state never silently survives a retry.",
        ),
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
    const first = await $`git clean -ffdx`.quiet().nothrow().cwd(root)
    if (first.exitCode === 0) return first

    const entries = failed(first)
    if (!entries.length) return first

    await prune(root, entries)
    return $`git clean -ffdx`.quiet().nothrow().cwd(root)
  }

  async function canonical(input: string) {
    const abs = path.resolve(input)
    const real = await fs.realpath(abs).catch(() => abs)
    const normalized = path.normalize(real)
    const insensitive = await isCaseInsensitiveFilesystem(normalized)
    return insensitive ? normalized.toLowerCase() : normalized
  }

  type PrimaryWorktreeInfo = { directory: string; branch: string }

  /**
   * Resolve the primary worktree and its currently checked-out branch.
   * `git worktree list --porcelain` reports the original worktree first;
   * child worktrees follow. Goal branches are created from this branch and
   * merge_back publishes back to this same branch, whether it is dev, trunk,
   * main, master, or another local branch name.
   */
  async function primaryWorktreeInfo(): Promise<PrimaryWorktreeInfo> {
    const list = await $`git worktree list --porcelain`.quiet().nothrow().cwd(Instance.worktree)
    if (list.exitCode !== 0) {
      throw new Error(errorText(list) || "Failed to read git worktrees")
    }

    const lines = outputText(list.stdout)
      .split("\n")
      .map((line) => line.trim())
    const first: { directory?: string; branch?: string } = {}
    for (const line of lines) {
      if (!line) break
      if (line.startsWith("worktree ")) {
        first.directory = line.slice("worktree ".length).trim()
        continue
      }
      if (line.startsWith("branch ")) {
        first.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "")
      }
    }

    if (!first.directory) {
      throw new Error("Primary worktree not found")
    }
    if (!first.branch) {
      throw new Error(`Primary worktree is detached: ${first.directory}`)
    }
    return { directory: first.directory, branch: first.branch }
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
  async function reclaimBase(root: string, base: string): Promise<Info> {
    const name = base
    const branch = `opencorvus/${name}`
    const directory = path.join(root, name)
    const ref = `refs/heads/${branch}`

    const dirExists = await exists(directory)
    const branchCheck = await $`git show-ref --verify --quiet ${ref}`
      .quiet()
      .nothrow()
      .cwd(Instance.worktree)
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
      const stillExists = await $`git show-ref --verify --quiet ${ref}`
        .quiet()
        .nothrow()
        .cwd(Instance.worktree)
      if (stillExists.exitCode === 0) {
        const del = await $`git branch -D ${branch}`
          .quiet()
          .nothrow()
          .cwd(Instance.worktree)
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
      const branchCheck = await $`git show-ref --verify --quiet ${ref}`.quiet().nothrow().cwd(Instance.worktree)
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

  export const create = fn(CreateInput.optional(), async (input) => {
    if (!Project.isGitRepo(Instance.directory)) {
      throw new NotGitError({ message: "Worktrees are only supported for git projects" })
    }

    // Resolve the PRIMARY worktree (main repo root) first so a dispatched
    // goal session (whose Instance.directory IS itself a child worktree)
    // doesn't cause nested `.opencorvus/worktrees/.opencorvus/worktrees/...`
    // recursion. `primaryWorktreeInfo()` always returns the primary repo root.
    //
    // Worktrees live UNDER `<primary>/.opencorvus/worktrees/` — co-located
    // with other runtime scratch (attachments, visual-diff output). Previous
    // design placed them in the PARENT of the project root, which leaked
    // scratch dirs into the user's workspace for real projects and piled
    // hundreds of zombie dirs into %TEMP% for benchmarks. One `.gitignore`
    // entry (`/.opencorvus/`) covers the entire tree now.
    const primary = await primaryWorktreeInfo().catch((err) => {
      throw new CreateFailedError({ message: err instanceof Error ? err.message : String(err) })
    })
    const primaryDir = primary.directory
    const root = path.join(primaryDir, ".opencorvus", "worktrees")
    await fs.mkdir(root, { recursive: true })

    const base = input?.name ? slug(input.name) : ""

    // Optional fast path: caller asked to reuse a previously-created worktree
    // with the same deterministic name (build-agent retry of an attempt that
    // produced files but skipped merge_back). Only honoured when the existing
    // dir + git linkage is still healthy via isValid(); otherwise fall through
    // to the regular candidate/reclaim path so the unhealthy state cannot be
    // silently propagated.
    if (base && input?.reuseIfValid) {
      const directory = path.join(root, base)
      const branch = `opencorvus/${base}`
      const validity = await isValid(directory)
      if (validity.valid) {
        log.info("worktree reuse: existing valid worktree, skipping create", {
          name: base,
          directory,
          branch,
        })
        await Project.addSandbox(Instance.project.id, directory).catch(() => undefined)
        return Info.parse({ name: base, branch, directory })
      }
      log.info("worktree reuse: existing tree invalid, falling through to reclaim", {
        name: base,
        directory,
        reason: validity.reason,
      })
    }

    const info = await candidate(root, base || undefined)

    // All git operations serialized to prevent concurrent corruption
    await withGitLock(async () => {
      // CONTRACT: project opening always commits the baseline .gitignore
      // first (see engine/git.ts ensureGitignore), so HEAD is non-empty by
      // the time any worktree is requested. If we still see no HEAD here,
      // bootstrap broke earlier — fail loud rather than paper over with a
      // `git add -A` "initial scaffold" empty commit that historically
      // swallowed `node_modules/` into HEAD before .gitignore landed.
      const hasCommits = (await $`git rev-parse --verify HEAD`.quiet().cwd(primaryDir).nothrow()).exitCode === 0
      if (!hasCommits) {
        throw new CreateFailedError({
          message:
            `Worktree create requires HEAD to exist on the primary repo (${primaryDir}). ` +
            `The project bootstrap path (Instance.provide → Project.initGit → ensureGitignore) ` +
            `must seed the baseline .gitignore commit before any worktree dispatch — investigate ` +
            `why ensureGitignore did not land a first commit instead of patching here.`,
        })
      }

      const created = await $`git worktree add --no-checkout -b ${info.branch} ${info.directory} ${primary.branch}`
        .quiet()
        .nothrow()
        .cwd(primaryDir)
      if (created.exitCode !== 0) {
        throw new CreateFailedError({ message: errorText(created) || "Failed to create git worktree" })
      }
    })

    await Project.addSandbox(Instance.project.id, info.directory).catch(() => undefined)

    const projectID = Instance.project.id
    const extra = input?.startCommand?.trim()
    const populate = async () => {
      const populated = await $`git reset --hard`.quiet().nothrow().cwd(info.directory)
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
   * `.git`. The fallback `fs.rm` in cleanupGoalWorkspace swallows the same
   * error. On the next dispatch, `existsSync(workspace_dir)` still returns
   * true, so the reuse path reuses a directory whose git operations now
   * walk up and land on the PRIMARY repo's `.git` — commits go to master,
   * the goal branch never advances, every retry silently overwrites itself.
   * Callers that intend to reuse a recorded workspace_dir must gate on this.
   */
  export async function isValid(directory: string): Promise<{ valid: boolean; reason?: string }> {
    const gitLink = path.join(directory, ".git")
    if (!(await exists(gitLink))) {
      return { valid: false, reason: `missing .git linkage at ${gitLink}` }
    }
    const list = await $`git worktree list --porcelain`.quiet().nothrow().cwd(Instance.worktree)
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

  export const remove = fn(RemoveInput, async (input) => {
    if (!Project.isGitRepo(Instance.directory)) {
      throw new NotGitError({ message: "Worktrees are only supported for git projects" })
    }

    const directory = await canonical(input.directory)
    const locate = async (stdout: Uint8Array | undefined) => {
      const lines = outputText(stdout)
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

      return (async () => {
        for (const item of entries) {
          if (!item.path) continue
          const key = await canonical(item.path)
          if (key === directory) return item
        }
      })()
    }

    const clean = (target: string) =>
      fs
        .rm(target, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          throw new RemoveFailedError({ message: message || "Failed to remove git worktree directory" })
        })

    const stop = async (target: string) => {
      if (!(await exists(target))) return
      await $`git fsmonitor--daemon stop`.quiet().nothrow().cwd(target)
    }

    // All git operations serialized to prevent concurrent corruption with create/merge
    return withGitLock(async () => {
      const list = await $`git worktree list --porcelain`.quiet().nothrow().cwd(Instance.worktree)
      if (list.exitCode !== 0) {
        throw new RemoveFailedError({ message: errorText(list) || "Failed to read git worktrees" })
      }

      const entry = await locate(list.stdout)

      if (!entry?.path) {
        const directoryExists = await exists(directory)
        if (directoryExists) {
          await stop(directory)
          await clean(directory)
        }
        return true
      }

      await stop(entry.path)
      const removed = await $`git worktree remove --force ${entry.path}`.quiet().nothrow().cwd(Instance.worktree)
      if (removed.exitCode !== 0) {
        const next = await $`git worktree list --porcelain`.quiet().nothrow().cwd(Instance.worktree)
        if (next.exitCode !== 0) {
          throw new RemoveFailedError({
            message: errorText(removed) || errorText(next) || "Failed to remove git worktree",
          })
        }

        const stale = await locate(next.stdout)
        if (stale?.path) {
          throw new RemoveFailedError({ message: errorText(removed) || "Failed to remove git worktree" })
        }
      }

      await clean(entry.path)

      const branch = entry.branch?.replace(/^refs\/heads\//, "")
      if (branch) {
        const deleted = await $`git branch -D ${branch}`.quiet().nothrow().cwd(Instance.worktree)
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
      const list = await $`git worktree list --porcelain`.quiet().nothrow().cwd(Instance.worktree)
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
      const resetToTarget = await $`git reset --hard ${target}`.quiet().nothrow().cwd(worktreePath)
      if (resetToTarget.exitCode !== 0) {
        throw new ResetFailedError({ message: errorText(resetToTarget) || "Failed to reset worktree to target" })
      }

      const clean = await sweep(worktreePath)
      if (clean.exitCode !== 0) {
        throw new ResetFailedError({ message: errorText(clean) || "Failed to clean worktree" })
      }

      const update = await $`git submodule update --init --recursive --force`.quiet().nothrow().cwd(worktreePath)
      if (update.exitCode !== 0) {
        throw new ResetFailedError({ message: errorText(update) || "Failed to update submodules" })
      }

      const subReset = await $`git submodule foreach --recursive git reset --hard`.quiet().nothrow().cwd(worktreePath)
      if (subReset.exitCode !== 0) {
        throw new ResetFailedError({ message: errorText(subReset) || "Failed to reset submodules" })
      }

      const subClean = await $`git submodule foreach --recursive git clean -fdx`.quiet().nothrow().cwd(worktreePath)
      if (subClean.exitCode !== 0) {
        throw new ResetFailedError({ message: errorText(subClean) || "Failed to clean submodules" })
      }

      const status = await $`git status --porcelain=v1`.quiet().nothrow().cwd(worktreePath)
      if (status.exitCode !== 0) {
        throw new ResetFailedError({ message: errorText(status) || "Failed to read git status" })
      }

      const dirty = outputText(status.stdout)
      if (dirty) {
        throw new ResetFailedError({ message: `Worktree reset left local changes:\n${dirty}` })
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
