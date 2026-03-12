import z from "zod"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { BusEvent } from "./bus-event"
import { GlobalBus } from "./global"
import { isBusTraceEnabled, traceBus } from "../util/debug-trace"

export namespace Bus {
  const log = Log.create({ service: "bus" })
  type Subscription = (event: any) => void
  const source = new WeakMap<Subscription, string>()

  export const InstanceDisposed = BusEvent.define(
    "server.instance.disposed",
    z.object({
      directory: z.string(),
    }),
  )

  const state = Instance.state(
    () => {
      const subscriptions = new Map<string, Subscription[]>()

      return {
        subscriptions,
      }
    },
    async (entry) => {
      const wildcard = entry.subscriptions.get("*")
      if (!wildcard) return
      const event = {
        type: InstanceDisposed.type,
        properties: {
          directory: Instance.directory,
        },
      }
      for (const sub of [...wildcard]) {
        sub(event)
      }
    },
  )

  const SUBSCRIBER_TIMEOUT_MS = 120_000 // 2 minutes per subscriber (last-resort safety net)

  function withTimeout(promise: unknown, timeoutMs: number, label: string): Promise<unknown> {
    // Duck-type thenable check: subscriber callbacks may return void, a raw
    // value, or a Promise.  We only need to race/timeout actual thenables.
    if (!promise || typeof promise !== "object" || !("then" in promise) || typeof promise.then !== "function") return Promise.resolve(promise)
    let timer: ReturnType<typeof setTimeout>
    return Promise.race([
      (promise as Promise<unknown>).finally(() => clearTimeout(timer)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Bus subscriber timeout (${timeoutMs}ms): ${label}`)), timeoutMs)
      }),
    ])
  }

  export async function publish<Definition extends BusEvent.Definition>(
    def: Definition,
    properties: z.output<Definition["properties"]>,
  ) {
    const payload = {
      type: def.type,
      properties,
    }
    log.info("publishing", {
      type: def.type,
    })
    const pending: Array<Promise<unknown>> = []
    let index = 0
    for (const key of [def.type, "*"]) {
      const match = state().subscriptions.get(key)
      for (const sub of match ?? []) {
        if (isBusTraceEnabled()) {
          index += 1
          traceBus({
            phase: "before-dispatch",
            type: def.type,
            key,
            index,
            source: source.get(sub),
          })
        }
        const result = sub(payload)
        pending.push(
          withTimeout(result, SUBSCRIBER_TIMEOUT_MS, `${def.type}/${source.get(sub) ?? "unknown"}`).catch((err) => {
            log.warn("subscriber timed out or failed", {
              type: def.type,
              source: source.get(sub),
              error: err instanceof Error ? err : String(err),
            })
          }),
        )
      }
    }
    GlobalBus.emit("event", {
      directory: Instance.directory,
      payload,
    })
    return Promise.allSettled(pending)
  }

  export function subscribe<Definition extends BusEvent.Definition>(
    def: Definition,
    callback: (event: { type: Definition["type"]; properties: z.infer<Definition["properties"]> }) => void,
  ) {
    return raw(def.type, callback)
  }

  export function once<Definition extends BusEvent.Definition>(
    def: Definition,
    callback: (event: {
      type: Definition["type"]
      properties: z.infer<Definition["properties"]>
    }) => "done" | undefined,
  ) {
    const unsub = subscribe(def, (event) => {
      if (callback(event)) unsub()
    })
  }

  export function subscribeAll(callback: (event: any) => void) {
    return raw("*", callback)
  }

  function raw(type: string, callback: (event: any) => void) {
    log.info("subscribing", { type })
    if (isBusTraceEnabled()) {
      const stack = new Error().stack
        ?.split("\n")
        .slice(2, 6)
        .map((x) => x.trim())
        .join(" | ")
      source.set(callback, stack ?? "unknown")
      traceBus({
        phase: "subscribe",
        type,
        callback: callback.name || "anonymous",
        source: stack,
      })
    }
    const subscriptions = state().subscriptions
    let match = subscriptions.get(type) ?? []
    if (match.includes(callback)) return () => {}
    match.push(callback)
    subscriptions.set(type, match)

    return () => {
      log.info("unsubscribing", { type })
      const match = subscriptions.get(type)
      if (!match) return
      const index = match.indexOf(callback)
      if (index === -1) return
      match.splice(index, 1)
    }
  }
}
