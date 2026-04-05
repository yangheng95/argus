import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { $ } from "bun"
import z from "zod"
import { Log } from "@/util/log"
import { Instance } from "./instance"
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
      branch: z.string().optional(),
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

  function parse(text: string, branch?: string, initialized = false): Info {
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
      initialized,
      branch,
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

  async function currentBranch() {
    return $`git rev-parse --abbrev-ref HEAD`
      .quiet()
      .nothrow()
      .cwd(Instance.worktree)
      .text()
      .then((x) => x.trim())
      .catch(() => undefined)
  }

  const state = Instance.state(
    async () => {
      if (Instance.project.vcs !== "git") {
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

  export async function branch() {
    return await state().then((s) => s.branch())
  }

  export async function info() {
    const initialized = Instance.project.vcs === "git"
    const branch = await state().then((s) => s.branch())
    if (!initialized) {
      return parse("", branch, false)
    }
    const text = await $`git status --porcelain=v1 --branch`
      .quiet()
      .nothrow()
      .cwd(Instance.directory)
      .text()
      .catch(() => "")
    return parse(text, branch, true)
  }
}
