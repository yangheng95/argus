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

  const parcel = lazy((): typeof import("@parcel/watcher") => {
    const { createWrapper } =
      requireRuntimePackage<typeof import("@parcel/watcher/wrapper")>("@parcel/watcher/wrapper")
    const binding = requireRuntimePackage(
      `@parcel/watcher-${process.platform}-${process.arch}${process.platform === "linux" ? `-${OPENCORVUS_LIBC || "glibc"}` : ""}`,
    )
    return createWrapper(binding) as typeof import("@parcel/watcher")
  })

  function publish(evt: { type: string; path: string }) {
    if (evt.type === "create" || evt.type === "add") Bus.publish(Event.Updated, { file: evt.path, event: "add" })
    if (evt.type === "update" || evt.type === "change") Bus.publish(Event.Updated, { file: evt.path, event: "change" })
    if (evt.type === "delete" || evt.type === "unlink") Bus.publish(Event.Updated, { file: evt.path, event: "unlink" })
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
      const subscribe = (dir: string, ignore: string[]) =>
        subscribeWithParcel(parcelWatcher, dir, ignore, backend)

      if (Flag.OPENCORVUS_EXPERIMENTAL_FILEWATCHER) {
        subs.push(await subscribe(Instance.directory, [...FileIgnore.PATTERNS, ...cfgIgnores]))
      }

      if (Project.isGitRepo(Instance.directory)) {
        const vcsDir = await $`git rev-parse --git-dir`
          .quiet()
          .nothrow()
          .cwd(Instance.worktree)
          .text()
          .then((x) => path.resolve(Instance.worktree, x.trim()))
        if (vcsDir && !cfgIgnores.includes(".git") && !cfgIgnores.includes(vcsDir)) {
          const gitDirContents = await readdir(vcsDir)
          const ignoreList = gitDirContents.filter((entry) => entry !== "HEAD")
          subs.push(await subscribe(vcsDir, ignoreList))
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
