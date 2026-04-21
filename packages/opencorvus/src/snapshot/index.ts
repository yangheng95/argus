import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { Log } from "../util/log"
import { Flag } from "../flag/flag"
import { Global } from "../global"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Project } from "../project/project"
import { Scheduler } from "../scheduler"
import { FileDiff as _FileDiff, Patch as _Patch } from "./types"
import type { FileDiff as _FileDiffType, Patch as _PatchType } from "./types"

export namespace Snapshot {
  const log = Log.create({ service: "snapshot" })
  const hour = 60 * 60 * 1000
  // Snapshots are an agent-only cache: every tree object written by `track()`
  // is dangling (no ref) from the moment it is written, so the classic 7-day
  // grace period has no value here. `--prune=now` reclaims disk immediately.
  const prune = "now"
  const coreAutocrlf =
    process.env.OPENCORVUS_SNAPSHOT_CORE_AUTOCRLF || (process.platform === "win32" ? "input" : "false")
  const coreSymlinks =
    process.env.OPENCORVUS_SNAPSHOT_CORE_SYMLINKS || (process.platform === "win32" ? "false" : "true")

  export function init() {
    Scheduler.register({
      id: "snapshot.cleanup",
      interval: hour,
      run: cleanup,
      scope: "instance",
    })
  }

  export async function cleanup() {
    if (!Project.isGitRepo(Instance.directory) || Flag.OPENCORVUS_CLIENT === "acp") return
    const cfg = await Config.get()
    if (cfg.snapshot === false) return
    const git = gitdir()
    const exists = await fs
      .stat(git)
      .then(() => true)
      .catch(() => false)
    if (!exists) return
    const result = await $`git --git-dir ${git} --work-tree ${Instance.worktree} gc --prune=${prune}`
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
    if (result.exitCode !== 0) {
      log.warn("cleanup failed", {
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        stdout: result.stdout.toString(),
      })
      return
    }
    log.info("cleanup", { prune })
  }

  export async function track() {
    if (!Project.isGitRepo(Instance.directory) || Flag.OPENCORVUS_CLIENT === "acp") return
    const cfg = await Config.get()
    if (cfg.snapshot === false) return
    const git = gitdir()
    if (await fs.mkdir(git, { recursive: true })) {
      await $`git init`
        .env({
          ...process.env,
          GIT_DIR: git,
          GIT_WORK_TREE: Instance.worktree,
        })
        .quiet()
        .nothrow()
      await $`git --git-dir ${git} config core.autocrlf ${coreAutocrlf}`.quiet().nothrow()
      await $`git --git-dir ${git} config core.longpaths true`.quiet().nothrow()
      await $`git --git-dir ${git} config core.symlinks ${coreSymlinks}`.quiet().nothrow()
      await $`git --git-dir ${git} config core.fsmonitor false`.quiet().nothrow()
      log.info("initialized")
    }
    // Use per-call temporary index to prevent race conditions when multiple
    // worktrees call track() concurrently against the same snapshot git repo.
    // Without this, concurrent `git add .` from different work-trees overwrite
    // the shared index, causing `write-tree` to capture the wrong directory's state.
    const indexFile = path.join(git, `index-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    try {
      await add(git, indexFile)
      const hash = await $`git --git-dir ${git} --work-tree ${Instance.worktree} write-tree`
        .env({ ...process.env, GIT_INDEX_FILE: indexFile })
        .quiet()
        .cwd(Instance.directory)
        .nothrow()
        .text()
      log.info("tracking", { hash, cwd: Instance.directory, git })
      return hash.trim()
    } finally {
      await fs.unlink(indexFile).catch(() => {})
    }
  }

  // Re-exported from ./types so schema-only consumers (engine/store, engine/model)
  // can import directly from "@/snapshot/types" without pulling in the runtime
  // surface (Scheduler, Instance, file I/O). External callers using the
  // `Snapshot.Patch` namespace form keep working unchanged.
  export const Patch = _Patch
  export type Patch = _PatchType

  export async function patch(hash: string): Promise<Patch> {
    const git = gitdir()
    const indexFile = path.join(git, `index-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    try {
      await add(git, indexFile)
      const result =
        await $`git -c core.autocrlf=${coreAutocrlf} -c core.longpaths=true -c core.symlinks=${coreSymlinks} -c core.quotepath=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff --name-only ${hash} -- .`
          .env({ ...process.env, GIT_INDEX_FILE: indexFile })
          .quiet()
          .cwd(Instance.directory)
          .nothrow()

      // If git diff fails, return empty patch
      if (result.exitCode !== 0) {
        log.warn("failed to get diff", { hash, exitCode: result.exitCode })
        return { hash, files: [] }
      }

      const files = result.text()
      return {
        hash,
        files: files
          .trim()
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean)
          .map((x) => path.join(Instance.worktree, x).replaceAll("\\", "/")),
      }
    } finally {
      await fs.unlink(indexFile).catch(() => {})
    }
  }

  export async function restore(snapshot: string) {
    log.info("restore", { commit: snapshot })
    const git = gitdir()
    const indexFile = path.join(git, `index-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    try {
      const result =
        await $`git -c core.longpaths=true -c core.symlinks=${coreSymlinks} --git-dir ${git} --work-tree ${Instance.worktree} read-tree ${snapshot} && git -c core.longpaths=true -c core.symlinks=${coreSymlinks} --git-dir ${git} --work-tree ${Instance.worktree} checkout-index -a -f`
          .env({ ...process.env, GIT_INDEX_FILE: indexFile })
          .quiet()
          .cwd(Instance.worktree)
          .nothrow()

      if (result.exitCode !== 0) {
        log.error("failed to restore snapshot", {
          snapshot,
          exitCode: result.exitCode,
          stderr: result.stderr.toString(),
          stdout: result.stdout.toString(),
        })
      }
    } finally {
      await fs.unlink(indexFile).catch(() => {})
    }
  }

  export async function revert(patches: Patch[]) {
    const files = new Set<string>()
    const git = gitdir()
    for (const item of patches) {
      for (const file of item.files) {
        if (files.has(file)) continue
        log.info("reverting", { file, hash: item.hash })
        const result =
          await $`git -c core.longpaths=true -c core.symlinks=${coreSymlinks} --git-dir ${git} --work-tree ${Instance.worktree} checkout ${item.hash} -- ${file}`
            .quiet()
            .cwd(Instance.worktree)
            .nothrow()
        if (result.exitCode !== 0) {
          const relativePath = path.relative(Instance.worktree, file)
          const checkTree =
            await $`git -c core.longpaths=true -c core.symlinks=${coreSymlinks} --git-dir ${git} --work-tree ${Instance.worktree} ls-tree ${item.hash} -- ${relativePath}`
              .quiet()
              .cwd(Instance.worktree)
              .nothrow()
          if (checkTree.exitCode === 0 && checkTree.text().trim()) {
            log.info("file existed in snapshot but checkout failed, keeping", {
              file,
            })
          } else {
            log.info("file did not exist in snapshot, deleting", { file })
            await fs.unlink(file).catch(() => {})
          }
        }
        files.add(file)
      }
    }
  }

  export async function diff(hash: string) {
    const git = gitdir()
    const indexFile = path.join(git, `index-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    try {
      await add(git, indexFile)
      const result =
        await $`git -c core.autocrlf=${coreAutocrlf} -c core.longpaths=true -c core.symlinks=${coreSymlinks} -c core.quotepath=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff ${hash} -- .`
          .env({ ...process.env, GIT_INDEX_FILE: indexFile })
          .quiet()
          .cwd(Instance.worktree)
          .nothrow()

      if (result.exitCode !== 0) {
        log.warn("failed to get diff", {
          hash,
          exitCode: result.exitCode,
          stderr: result.stderr.toString(),
          stdout: result.stdout.toString(),
        })
        return ""
      }

      return result.text().trim()
    } finally {
      await fs.unlink(indexFile).catch(() => {})
    }
  }

  // Re-exported from ./types — see Patch above for rationale.
  export const FileDiff = _FileDiff
  export type FileDiff = _FileDiffType
  export async function diffFull(from: string, to: string): Promise<FileDiff[]> {
    const git = gitdir()
    const result: FileDiff[] = []
    const status = new Map<string, "added" | "deleted" | "modified">()

    const statuses =
      await $`git -c core.autocrlf=${coreAutocrlf} -c core.longpaths=true -c core.symlinks=${coreSymlinks} -c core.quotepath=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff --name-status --no-renames ${from} ${to} -- .`
        .quiet()
        .cwd(Instance.directory)
        .nothrow()
        .text()

    for (const line of statuses.trim().split("\n")) {
      if (!line) continue
      const [code, file] = line.split("\t")
      if (!code || !file) continue
      const kind = code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified"
      status.set(file, kind)
    }

    for await (const line of $`git -c core.autocrlf=${coreAutocrlf} -c core.longpaths=true -c core.symlinks=${coreSymlinks} -c core.quotepath=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff --no-renames --numstat ${from} ${to} -- .`
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
      .lines()) {
      if (!line) continue
      const [additions, deletions, file] = line.split("\t")
      const isBinaryFile = additions === "-" && deletions === "-"
      const before = isBinaryFile
        ? ""
        : await $`git -c core.autocrlf=${coreAutocrlf} -c core.longpaths=true -c core.symlinks=${coreSymlinks} --git-dir ${git} --work-tree ${Instance.worktree} show ${from}:${file}`
            .quiet()
            .nothrow()
            .text()
      const after = isBinaryFile
        ? ""
        : await $`git -c core.autocrlf=${coreAutocrlf} -c core.longpaths=true -c core.symlinks=${coreSymlinks} --git-dir ${git} --work-tree ${Instance.worktree} show ${to}:${file}`
            .quiet()
            .nothrow()
            .text()
      const added = isBinaryFile ? 0 : parseInt(additions)
      const deleted = isBinaryFile ? 0 : parseInt(deletions)
      result.push({
        file,
        before,
        after,
        additions: Number.isFinite(added) ? added : 0,
        deletions: Number.isFinite(deleted) ? deleted : 0,
        status: status.get(file) ?? "modified",
      })
    }
    return result
  }

  function gitdir() {
    const project = Instance.project
    return path.join(Global.Path.data, "snapshot", project.id)
  }

  async function add(git: string, indexFile?: string) {
    await syncExclude(git)
    const env = indexFile ? { ...process.env, GIT_INDEX_FILE: indexFile } : undefined
    const cmd = $`git -c core.autocrlf=${coreAutocrlf} -c core.longpaths=true -c core.symlinks=${coreSymlinks} --git-dir ${git} --work-tree ${Instance.worktree} add .`
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
    if (env) await cmd.env(env)
    else await cmd
  }

  // Baseline exclude rules layered on top of the user project's own
  // .gitignore / .git/info/exclude. These are the paths that every modern
  // language ecosystem treats as disposable build output or dependency cache:
  // blobs here have no value as a version-history waypoint, and silently
  // including them is what bloats snapshots from ~1 MB to ~200 MB+.
  //
  // The list is intentionally conservative — only well-known directory names
  // and unambiguous binary extensions. Source material never lives here under
  // conventional layouts, so false positives are unlikely. If a future
  // project legitimately wants one of these tracked, it can override via its
  // own `.git/info/exclude` (negation rules apply the usual gitignore
  // precedence).
  const BASELINE_EXCLUDE = [
    "# --- opencorvus snapshot baseline (auto-managed, do not edit) ---",
    "node_modules/",
    "dist/",
    "build/",
    "out/",
    "target/",
    ".next/",
    ".nuxt/",
    ".svelte-kit/",
    ".turbo/",
    ".parcel-cache/",
    ".cache/",
    ".venv/",
    "venv/",
    "__pycache__/",
    "*.pyc",
    "coverage/",
    ".nyc_output/",
    "*.exe",
    "*.dll",
    "*.dylib",
    "*.pdb",
    "# --- end baseline ---",
    "",
  ].join("\n")

  async function syncExclude(git: string) {
    const file = await excludes()
    const target = path.join(git, "info", "exclude")
    await fs.mkdir(path.join(git, "info"), { recursive: true })
    const userText = file
      ? await Bun.file(file)
          .text()
          .catch(() => "")
      : ""
    // Baseline FIRST, user rules AFTER. gitignore later-rule-wins semantics
    // means the user's `.git/info/exclude` (and any negation via `!path`)
    // continues to take precedence — the baseline is a floor, not a ceiling.
    const merged = BASELINE_EXCLUDE + (userText.endsWith("\n") ? userText : userText + (userText ? "\n" : ""))
    await Bun.write(target, merged)
  }

  async function excludes() {
    const file = await $`git rev-parse --path-format=absolute --git-path info/exclude`
      .quiet()
      .cwd(Instance.worktree)
      .nothrow()
      .text()
    if (!file.trim()) return
    const exists = await fs
      .stat(file.trim())
      .then(() => true)
      .catch(() => false)
    if (!exists) return
    return file.trim()
  }
}
