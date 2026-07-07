import { Instance, lazyInstanceState } from "../project/instance"
import { Log } from "../util/log"

export namespace Scheduler {
  const log = Log.create({ service: "scheduler" })

  export type Task = {
    id: string
    interval: number
    run: () => Promise<void>
    scope?: "instance" | "global"
  }

  type Timer = ReturnType<typeof setInterval>
  type Entry = {
    tasks: Map<string, Task>
    timers: Map<string, Timer>
    active: Set<Promise<void>>
  }

  const create = (): Entry => {
    const tasks = new Map<string, Task>()
    const timers = new Map<string, Timer>()
    const active = new Set<Promise<void>>()
    return { tasks, timers, active }
  }

  const shared = create()

  const state = lazyInstanceState(
    () => create(),
    async (entry) => {
      await disposeEntry(entry)
    },
  )

  export function register(task: Task) {
    const scope = task.scope ?? "instance"
    const entry = scope === "global" ? shared : state()
    const current = entry.timers.get(task.id)
    if (current && scope === "global") return
    if (current) clearInterval(current)

    entry.tasks.set(task.id, task)
    start(entry, task)
    const timer = setInterval(() => {
      start(entry, task)
    }, task.interval)
    timer.unref()
    entry.timers.set(task.id, timer)
  }

  export async function disposeGlobal() {
    await disposeEntry(shared)
  }

  function start(entry: Entry, task: Task) {
    let active!: Promise<void>
    active = run(task).finally(() => {
      entry.active.delete(active)
    })
    entry.active.add(active)
  }

  async function disposeEntry(entry: Entry) {
    for (const timer of entry.timers.values()) {
      clearInterval(timer)
    }
    entry.timers.clear()
    const active = [...entry.active]
    if (active.length > 0) await Promise.allSettled(active)
    entry.active.clear()
    entry.tasks.clear()
  }

  async function run(task: Task) {
    log.debug("run", { id: task.id })
    await task.run().catch((error) => {
      log.error("run failed", { id: task.id, error })
    })
  }
}
