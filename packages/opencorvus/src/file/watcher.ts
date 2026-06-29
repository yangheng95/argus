import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Instance, lazyInstanceState } from "../project/instance"
import { Project } from "../project/project"
import { Log } from "../util/log"
import { FileIgnore } from "./ignore"
import { Config } from "../config/config"
import path from "path"
import { lazy } from "@/util/lazy"
import { withTimeout } from "@/util/timeout"
import { $ } from "bun"
import { Flag } from "@/flag/flag"
import { readdir } from "fs/promises"
import { requireRuntimePackage } from "@/runtime/package-require"

const SUBSCRIBE_TIMEOUT_MS = 10_000

export namespace FileWatcher {
  const log = Log.create({ service: "file.watcher" })

  export const Event = {
    Updated: BusEvent.define(
      "file.watcher.updated",
      z.object({
        file: z.string(),
        event: z.union([z.literal("add"), z.literal("change"), z.literal("unlink")]),
      }),
    ),
  }

  type Subscription = {
    unsubscribe: () => Promise<void>
  }
  type Subscribe = (dir: string, ignore: string[]) => Promise<Subscription>

  const parcel = lazy((): typeof import("@parcel/watcher") => {
    return requireRuntimePackage<typeof import("@parcel/watcher")>("@parcel/watcher")
  })

  function publish(evt: { type: string; path: string }) {
    if (evt.type === "create" || evt.type === "add") Bus.publish(Event.Updated, { file: evt.path, event: "add" })
    if (evt.type === "update" || evt.type === "change") Bus.publish(Event.Updated, { file: evt.path, event: "change" })
    if (evt.type === "delete" || evt.type === "unlink") Bus.publish(Event.Updated, { file: evt.path, event: "unlink" })
  }

  function isMissingWatchPathError(error: unknown) {
    if (!error || typeof error !== "object") return false
    const code = (error as { code?: unknown }).code
    return code === "ENOENT" || code === "ENOTDIR"
  }

  function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }

  async function subscribeWithParcel(
    watcher: typeof import("@parcel/watcher"),
    dir: string,
    ignore: string[],
    backend: "windows" | "fs-events" | "inotify",
  ): Promise<Subscription> {
    const pending = watcher.subscribe(
      dir,
      (err, evts) => {
        if (err) return
        evts.forEach(publish)
      },
      {
        ignore,
        backend,
      },
    )
    const sub = await withTimeout(pending, SUBSCRIBE_TIMEOUT_MS)
    return {
      unsubscribe: () => sub.unsubscribe(),
    }
  }

  async function subscribeWatchDirectory(
    subscribe: Subscribe,
    dir: string,
    ignore: string[],
    label: string,
  ): Promise<Subscription | undefined> {
    try {
      return await subscribe(dir, ignore)
    } catch (error) {
      if (isMissingWatchPathError(error)) {
        log.warn("file watcher directory disappeared before subscription completed", {
          label,
          dir,
          error: errorMessage(error),
        })
        return undefined
      }
      throw error
    }
  }

  async function readWatchDirectory(dir: string, label: string): Promise<string[] | undefined> {
    try {
      return await readdir(dir)
    } catch (error) {
      if (isMissingWatchPathError(error)) {
        log.warn("file watcher directory disappeared before initialization completed", {
          label,
          dir,
          error: errorMessage(error),
        })
        return undefined
      }
      throw error
    }
  }

  async function resolveGitDirectoryForWatch(): Promise<string | undefined> {
    try {
      const output = await $`git rev-parse --git-dir`.quiet().nothrow().cwd(Instance.worktree).text()
      return path.resolve(Instance.worktree, output.trim())
    } catch (error) {
      if (isMissingWatchPathError(error)) {
        log.warn("project directory disappeared before file watcher resolved git directory", {
          dir: Instance.worktree,
          error: errorMessage(error),
        })
        return undefined
      }
      throw error
    }
  }

  const state = lazyInstanceState(
    async () => {
      log.info("init")
      const cfg = await Config.get()
      const backend = (() => {
        if (process.platform === "win32") return "windows"
        if (process.platform === "darwin") return "fs-events"
        if (process.platform === "linux") return "inotify"
        throw new Error(`watcher backend not supported on platform: ${process.platform}`)
      })()

      const parcelWatcher = parcel()
      log.info("watcher backend", { platform: process.platform, backend })

      const subs: Subscription[] = []
      const cfgIgnores = cfg.watcher?.ignore ?? []
      const subscribe = (dir: string, ignore: string[]) => subscribeWithParcel(parcelWatcher, dir, ignore, backend)

      if (Flag.OPENCORVUS_EXPERIMENTAL_FILEWATCHER) {
        const sourceSub = await subscribeWatchDirectory(
          subscribe,
          Instance.directory,
          [...FileIgnore.PATTERNS, ...cfgIgnores],
          "source",
        )
        if (sourceSub) subs.push(sourceSub)
      }

      if (Project.isGitRepo(Instance.directory)) {
        const vcsDir = await resolveGitDirectoryForWatch()
        if (vcsDir && !cfgIgnores.includes(".git") && !cfgIgnores.includes(vcsDir)) {
          const gitDirContents = await readWatchDirectory(vcsDir, "git")
          if (gitDirContents) {
            const ignoreList = gitDirContents.filter((entry) => entry !== "HEAD")
            const gitSub = await subscribeWatchDirectory(subscribe, vcsDir, ignoreList, "git")
            if (gitSub) subs.push(gitSub)
          }
        }
      }

      return { subs }
    },
    async (state) => {
      if (!state.subs) return
      await Promise.all(state.subs.map((sub) => sub.unsubscribe()))
    },
  )

  export function init() {
    if (Flag.OPENCORVUS_EXPERIMENTAL_DISABLE_FILEWATCHER) {
      return
    }
    state()
  }
}
