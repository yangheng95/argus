import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { createHash } from "crypto"
import { Log } from "../util/log"
import { Flag } from "../flag/flag"
import { Global } from "../global"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Scheduler } from "../scheduler"

export namespace Snapshot {
  const log = Log.create({ service: "snapshot" })
  const hour = 60 * 60 * 1000
  const prune = "7.days"
  const coreAutocrlf =
    process.env.OPENCORVUS_SNAPSHOT_CORE_AUTOCRLF || (process.platform === "win32" ? "input" : "false")
  const coreSymlinks =
    process.env.OPENCORVUS_SNAPSHOT_CORE_SYMLINKS || (process.platform === "win32" ? "false" : "true")

  async function env(git: string) {
    await fs.mkdir(path.join(git, "indexes"), { recursive: true })
    return {
      ...process.env,
      GIT_DIR: git,
      GIT_WORK_TREE: Instance.worktree,
      // Parallel goal workspaces share the object store but must not share one git index.
      GIT_INDEX_FILE: path.join(
        git,
        "indexes",
        createHash("sha1").update(Instance.worktree.replaceAll("\\", "/")).digest("hex"),
      ),
    }
  }

  export function init() {
    Scheduler.register({
      id: "snapshot.cleanup",
      interval: hour,
      run: cleanup,
      scope: "instance",
    })
  }

  export async function cleanup() {
    if (Instance.project.vcs !== "git" || Flag.OPENCORVUS_CLIENT === "acp") return
    const cfg = await Config.get()
    if (cfg.snapshot === false) return
    const git = gitdir()
    const exists = await fs
      .stat(git)
      .then(() => true)
      .catch(() => false)
    if (!exists) return
    const result = await $`git --git-dir ${git} --work-tree ${Instance.worktree} gc --prune=${prune}`
      .env(await env(git))
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
    if (Instance.project.vcs !== "git" || Flag.OPENCORVUS_CLIENT === "acp") return
    const cfg = await Config.get()
    if (cfg.snapshot === false) return
    const git = gitdir()
    if (await fs.mkdir(git, { recursive: true })) {
      await $`git init`
        .env(await env(git))
        .quiet()
        .nothrow()
      await $`git --git-dir ${git} config core.autocrlf ${coreAutocrlf}`.env(await env(git)).quiet().nothrow()
      await $`git --git-dir ${git} config core.longpaths true`.env(await env(git)).quiet().nothrow()
      await $`git --git-dir ${git} config core.symlinks ${coreSymlinks}`.env(await env(git)).quiet().nothrow()
      await $`git --git-dir ${git} config core.fsmonitor false`.env(await env(git)).quiet().nothrow()
      log.info("initialized")
    }
    await add(git)
    const hash = await $`git --git-dir ${git} --work-tree ${Instance.worktree} write-tree`
      .env(await env(git))
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
      .text()
    log.info("tracking", { hash, cwd: Instance.directory, git })
    return hash.trim()
  }

  export const Patch = z.object({
    hash: z.string(),
    files: z.string().array(),
  })
  export type Patch = z.infer<typeof Patch>

  export async function patch(hash: string): Promise<Patch> {
    const git = gitdir()
    await add(git)
    const result =
      await $`git -c core.autocrlf=${coreAutocrlf} -c core.longpaths=true -c core.symlinks=${coreSymlinks} -c core.quotepath=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff --name-only ${hash} -- .`
        .env(await env(git))
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
  }

  export async function restore(snapshot: string) {
    log.info("restore", { commit: snapshot })
    const git = gitdir()
    const result =
      await $`git -c core.longpaths=true -c core.symlinks=${coreSymlinks} --git-dir ${git} --work-tree ${Instance.worktree} read-tree ${snapshot} && git -c core.longpaths=true -c core.symlinks=${coreSymlinks} --git-dir ${git} --work-tree ${Instance.worktree} checkout-index -a -f`
        .env(await env(git))
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
            .env(await env(git))
            .quiet()
            .cwd(Instance.worktree)
            .nothrow()
        if (result.exitCode !== 0) {
          const relativePath = path.relative(Instance.worktree, file)
          const checkTree =
            await $`git -c core.longpaths=true -c core.symlinks=${coreSymlinks} --git-dir ${git} --work-tree ${Instance.worktree} ls-tree ${item.hash} -- ${relativePath}`
              .env(await env(git))
              .quiet()
              .cwd(Instance.worktree)
              .nothrow()
          if (checkTree.exitCode === 0 && checkTree.text().trim()) {
            log.info("file existed in snapshot but checkout failed, keeping", {
              file,
            })
          } else {
            log.info("file did not exist in snapshot, deleting", { file })
            // Best-effort deletion: the file may already be gone or locked.
            // Failure is non-critical since the revert goal is to match the
            // snapshot state, and a missing file satisfies that.
            await fs.unlink(file).catch(() => {})
          }
        }
        files.add(file)
      }
    }
  }

  export async function diff(hash: string) {
    const git = gitdir()
    await add(git)
    const result =
      await $`git -c core.autocrlf=${coreAutocrlf} -c core.longpaths=true -c core.symlinks=${coreSymlinks} -c core.quotepath=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff ${hash} -- .`
        .env(await env(git))
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
  }

  export const FileDiff = z
    .object({
      file: z.string(),
      before: z.string(),
      after: z.string(),
      additions: z.number(),
      deletions: z.number(),
      status: z.enum(["added", "deleted", "modified"]).optional(),
    })
    .meta({
      ref: "FileDiff",
    })
  export type FileDiff = z.infer<typeof FileDiff>
  export async function diffFull(from: string, to: string): Promise<FileDiff[]> {
    const git = gitdir()
    const result: FileDiff[] = []
    const status = new Map<string, "added" | "deleted" | "modified">()

    const statuses =
      await $`git -c core.autocrlf=${coreAutocrlf} -c core.longpaths=true -c core.symlinks=${coreSymlinks} -c core.quotepath=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff --name-status --no-renames ${from} ${to} -- .`
        .env(await env(git))
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
      .env(await env(git))
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
      .lines()) {
      if (!line) continue
      const parts = line.split("\t")
      if (parts.length < 3) continue
      const [additions, deletions, file] = parts
      const isBinaryFile = additions === "-" && deletions === "-"
      const before = isBinaryFile
        ? ""
        : await $`git -c core.autocrlf=${coreAutocrlf} -c core.longpaths=true -c core.symlinks=${coreSymlinks} --git-dir ${git} --work-tree ${Instance.worktree} show ${from}:${file}`
            .env(await env(git))
            .quiet()
            .nothrow()
            .text()
      const after = isBinaryFile
        ? ""
        : await $`git -c core.autocrlf=${coreAutocrlf} -c core.longpaths=true -c core.symlinks=${coreSymlinks} --git-dir ${git} --work-tree ${Instance.worktree} show ${to}:${file}`
            .env(await env(git))
            .quiet()
            .nothrow()
            .text()
      const added = isBinaryFile ? 0 : parseInt(additions, 10)
      const deleted = isBinaryFile ? 0 : parseInt(deletions, 10)
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

  async function add(git: string) {
    await syncExclude(git)
    await $`git -c core.autocrlf=${coreAutocrlf} -c core.longpaths=true -c core.symlinks=${coreSymlinks} --git-dir ${git} --work-tree ${Instance.worktree} add .`
      .env(await env(git))
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
  }

  async function syncExclude(git: string) {
    const file = await excludes()
    const target = path.join(git, "info", "exclude")
    await fs.mkdir(path.join(git, "info"), { recursive: true })
    if (!file) {
      await Bun.write(target, "")
      return
    }
    const text = await Bun.file(file)
      .text()
      .catch(() => "")
    await Bun.write(target, text)
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
