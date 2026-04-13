import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { FileIgnore } from "./ignore"
import { Config } from "../config/config"
import path from "path"
import { createWrapper } from "@parcel/watcher/wrapper"
import { lazy } from "@/util/lazy"
import { withTimeout } from "@/util/timeout"
import { $ } from "bun"
import { Flag } from "@/flag/flag"
import { readdir } from "fs/promises"
import type { FSWatcher } from "chokidar"

const SUBSCRIBE_TIMEOUT_MS = 10_000

declare const OPENCORVUS_LIBC: string | undefined

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

  const parcel = lazy((): typeof import("@parcel/watcher") | undefined => {
    try {
      const binding = require(
        `@parcel/watcher-${process.platform}-${process.arch}${process.platform === "linux" ? `-${OPENCORVUS_LIBC || "glibc"}` : ""}`,
      )
      return createWrapper(binding) as typeof import("@parcel/watcher")
    } catch (error) {
      log.error("failed to load watcher binding", { error })
      return
    }
  })

  const chokidar = lazy((): typeof import("chokidar") | undefined => {
    try {
      return require("chokidar") as typeof import("chokidar")
    } catch (error) {
      log.error("failed to load chokidar fallback", { error })
      return
    }
  })

  function publish(evt: { type: string; path: string }) {
    if (evt.type === "create" || evt.type === "add") Bus.publish(Event.Updated, { file: evt.path, event: "add" })
    if (evt.type === "update" || evt.type === "change") Bus.publish(Event.Updated, { file: evt.path, event: "change" })
    if (evt.type === "delete" || evt.type === "unlink") Bus.publish(Event.Updated, { file: evt.path, event: "unlink" })
  }

  function ignored(dir: string, patterns: string[]) {
    return (input: string) => {
      const rel = path.relative(dir, input).replaceAll("\\", "/")
      if (!rel || rel === ".") return false
      if (rel.startsWith("../")) return false
      const name = rel.split("/").at(0)
      if (name && patterns.includes(name)) return true
      for (const item of patterns) {
        if (path.isAbsolute(item) && input.startsWith(item)) return true
      }
      return FileIgnore.match(rel, { extra: patterns })
    }
  }

  async function subscribeWithParcel(
    watcher: typeof import("@parcel/watcher"),
    dir: string,
    ignore: string[],
    backend: "windows" | "fs-events" | "inotify",
  ) {
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
    const sub = await withTimeout(pending, SUBSCRIBE_TIMEOUT_MS).catch((err) => {
      log.error("failed to subscribe via parcel", { error: err, dir, backend })
      pending.then((s) => s.unsubscribe()).catch(() => {})
      return undefined
    })
    if (!sub) return
    return {
      unsubscribe: () => sub.unsubscribe(),
    } satisfies Subscription
  }

  function subscribeWithChokidar(watcher: typeof import("chokidar"), dir: string, ignore: string[]) {
    const instance: FSWatcher = watcher.watch(dir, {
      ignoreInitial: true,
      ignored: ignored(dir, ignore),
    })
    instance.on("add", (item) => publish({ type: "add", path: item }))
    instance.on("change", (item) => publish({ type: "change", path: item }))
    instance.on("unlink", (item) => publish({ type: "unlink", path: item }))
    instance.on("error", (error) => {
      log.error("chokidar watch error", { error, dir })
    })
    return {
      unsubscribe: async () => {
        await instance.close()
      },
    } satisfies Subscription
  }

  const state = Instance.state(
    async () => {
      log.info("init")
      const cfg = await Config.get()
      const backend = (() => {
        if (process.platform === "win32") return "windows"
        if (process.platform === "darwin") return "fs-events"
        if (process.platform === "linux") return "inotify"
      })()
      if (!backend) {
        log.error("watcher backend not supported", { platform: process.platform })
        return {}
      }

      const parcelWatcher = parcel()
      const chokidarWatcher = parcelWatcher ? undefined : chokidar()
      if (!parcelWatcher && !chokidarWatcher) return {}
      log.info("watcher backend", {
        platform: process.platform,
        backend,
        runtime: parcelWatcher ? "parcel" : "chokidar",
      })

      const subs: Subscription[] = []
      const cfgIgnores = cfg.watcher?.ignore ?? []
      const subscribe = async (dir: string, ignore: string[]) => {
        if (parcelWatcher) return subscribeWithParcel(parcelWatcher, dir, ignore, backend)
        if (chokidarWatcher) return subscribeWithChokidar(chokidarWatcher, dir, ignore)
      }

      if (Flag.OPENCORVUS_EXPERIMENTAL_FILEWATCHER) {
        const sub = await subscribe(Instance.directory, [...FileIgnore.PATTERNS, ...cfgIgnores])
        if (sub) subs.push(sub)
      }

      if (Instance.project.vcs === "git") {
        const vcsDir = await $`git rev-parse --git-dir`
          .quiet()
          .nothrow()
          .cwd(Instance.worktree)
          .text()
          .then((x) => path.resolve(Instance.worktree, x.trim()))
          .catch(() => undefined)
        if (vcsDir && !cfgIgnores.includes(".git") && !cfgIgnores.includes(vcsDir)) {
          const gitDirContents = await readdir(vcsDir).catch(() => [])
          const ignoreList = gitDirContents.filter((entry) => entry !== "HEAD")
          const sub = await subscribe(vcsDir, ignoreList)
          if (sub) subs.push(sub)
        }
      }

      return { subs }
    },
    async (state) => {
      if (!state.subs) return
      await Promise.all(state.subs.map((sub) => sub?.unsubscribe()))
    },
  )

  export function init() {
    if (Flag.OPENCORVUS_EXPERIMENTAL_DISABLE_FILEWATCHER) {
      return
    }
    state()
  }
}
