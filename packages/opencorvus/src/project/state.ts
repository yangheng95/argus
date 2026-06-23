import { Log } from "@/util/log"

export namespace State {
  interface Entry {
    state: any
    dispose?: (state: any) => Promise<void>
  }

  const log = Log.create({ service: "state" })
  const recordsByKey = new Map<string, Map<any, Entry>>()

  type EntryTarget = {
    key: string
    init: unknown
    entry: Entry
  }

  function removeEntry(key: string, init: unknown, entry: Entry) {
    const entries = recordsByKey.get(key)
    if (!entries || entries.get(init) !== entry) return
    entries.delete(init)
    if (entries.size === 0) recordsByKey.delete(key)
  }

  async function disposeEntry(key: string, init: unknown, entry: Entry) {
    if (!entry.dispose) return
    const label = typeof init === "function" ? init.name : String(init)
    await Promise.resolve(entry.state)
      .then((state) => entry.dispose!(state))
      .catch((error) => {
        log.error("Error while disposing state:", { error, key, init: label })
        throw error
      })
  }

  async function disposeTargets(targets: EntryTarget[]) {
    const results = await Promise.allSettled(
      targets.map((target) => disposeEntry(target.key, target.init, target.entry)),
    )
    const errors: unknown[] = []
    for (const [index, result] of results.entries()) {
      const target = targets[index]
      if (result.status === "fulfilled") {
        removeEntry(target.key, target.init, target.entry)
      } else {
        errors.push(result.reason)
      }
    }
    if (errors.length > 0) throw errors[0]
  }

  export function create<S>(root: () => string, init: () => S, dispose?: (state: Awaited<S>) => Promise<void>) {
    const fn = (() => {
      const key = root()
      let entries = recordsByKey.get(key)
      if (!entries) {
        entries = new Map<string, Entry>()
        recordsByKey.set(key, entries)
      }
      const exists = entries.get(init)
      if (exists) return exists.state as S
      const state = init()
      entries.set(init, {
        state,
        dispose,
      })
      return state
    }) as (() => S) & { reset(): Promise<void>; resetAll(): Promise<void> }
    fn.reset = async () => {
      const key = root()
      const entries = recordsByKey.get(key)
      const entry = entries?.get(init)
      if (!entries || !entry) return
      if (!entry.dispose) {
        removeEntry(key, init, entry)
        return
      }
      await disposeTargets([{ key, init, entry }])
    }
    fn.resetAll = async () => {
      const targets: EntryTarget[] = []
      for (const [key, entries] of recordsByKey) {
        const entry = entries.get(init)
        if (!entry) continue
        if (!entry.dispose) {
          removeEntry(key, init, entry)
          continue
        }
        targets.push({ key, init, entry })
      }
      await disposeTargets(targets)
    }
    return fn
  }

  export async function dispose(key: string) {
    const entries = recordsByKey.get(key)
    if (!entries) return

    log.info("waiting for state disposal to complete", { key })

    let disposalFinished = false

    setTimeout(() => {
      if (!disposalFinished) {
        log.warn(
          "state disposal is taking an unusually long time - if it does not complete in a reasonable time, please report this as a bug",
          { key },
        )
      }
    }, 10000).unref()

    const targets: EntryTarget[] = []
    for (const [init, entry] of entries) {
      if (!entry.dispose) {
        removeEntry(key, init, entry)
        continue
      }
      targets.push({ key, init, entry })
    }

    try {
      await disposeTargets(targets)
    } finally {
      disposalFinished = true
    }

    if (entries.size === 0) recordsByKey.delete(key)

    log.info("state disposal completed", { key })
  }
}
