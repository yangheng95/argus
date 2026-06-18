import z from "zod"
import { Log } from "../util/log"
import { Instance, lazyInstanceState } from "../project/instance"
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

  const SUBSCRIBER_TIMEOUT_MS = 15_000 // 15s per subscriber — short enough to avoid back-pressuring pipeline stages

  function withTimeout(promise: unknown, timeoutMs: number, label: string): Promise<unknown> {
    if (!promise || typeof (promise as any).then !== "function") return Promise.resolve(promise)
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Bus subscriber timeout (${timeoutMs}ms): ${label}`)), timeoutMs)
    })
    return Promise.race([
      (promise as Promise<unknown>).finally(() => {
        if (timer) clearTimeout(timer)
      }),
      timeout,
    ])
  }

  async function dispatch(payload: { type: string; properties: any }) {
    const pending: Array<Promise<unknown>> = []
    let index = 0
    for (const key of [payload.type, "*"]) {
      const match = state().subscriptions.get(key)
      for (const sub of match ?? []) {
        if (isBusTraceEnabled()) {
          index += 1
          traceBus({
            phase: "before-dispatch",
            type: payload.type,
            key,
            index,
            source: source.get(sub),
          })
        }
        const label = `${payload.type}/${source.get(sub) ?? "unknown"}`
        let result: unknown
        try {
          result = sub(payload)
        } catch (err) {
          result = Promise.reject(err)
        }
        pending.push(
          withTimeout(result, SUBSCRIBER_TIMEOUT_MS, label).catch((err) => {
            log.warn("subscriber timed out or failed", { type: payload.type, label, error: String(err) })
          }),
        )
      }
    }
    return Promise.allSettled(pending)
  }

  const state = lazyInstanceState(
    () => {
      const subscriptions = new Map<any, Subscription[]>()

      return {
        subscriptions,
      }
    },
    async () => {
      await dispatch({
        type: InstanceDisposed.type,
        properties: {
          directory: Instance.directory,
        },
      })
    },
  )

  export async function publish<Definition extends BusEvent.Definition>(
    def: Definition,
    properties: z.output<Definition["properties"]>,
  ) {
    const parsed = BusEvent.parseProperties(def, properties)
    const payload = {
      type: def.type,
      properties: parsed,
    }
    log.debug("publishing", {
      type: def.type,
    })
    const result = dispatch(payload)
    GlobalBus.emit("event", {
      directory: Instance.directory,
      payload,
    })
    return result
  }

  export function subscribe<Definition extends BusEvent.Definition>(
    def: Definition,
    callback: (event: { type: Definition["type"]; properties: z.infer<Definition["properties"]> }) => void,
  ) {
    return raw(def.type, callback)
  }

  export function subscribeAll(callback: (event: any) => void) {
    return raw("*", callback)
  }

  export function subscriptionStats() {
    const subscriptions = state().subscriptions
    let callbacks = 0
    for (const match of subscriptions.values()) callbacks += match.length
    return {
      types: subscriptions.size,
      callbacks,
    }
  }

  export function once<Definition extends BusEvent.Definition>(
    def: Definition,
    callback: (event: {
      type: Definition["type"]
      properties: z.infer<Definition["properties"]>
    }) => unknown | Promise<unknown>,
  ) {
    const unsub = raw(def.type, async (event) => {
      const result = await callback(event)
      if (result === "done") unsub()
    })
    return unsub
  }

  function raw(type: string, callback: (event: any) => void) {
    log.debug("subscribing", { type })
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
    if (!match.includes(callback)) {
      match.push(callback)
      subscriptions.set(type, match)
    }

    return () => {
      log.debug("unsubscribing", { type })
      const match = subscriptions.get(type)
      if (!match) return
      const index = match.indexOf(callback)
      if (index === -1) return
      match.splice(index, 1)
      if (match.length === 0) subscriptions.delete(type)
    }
  }
}
