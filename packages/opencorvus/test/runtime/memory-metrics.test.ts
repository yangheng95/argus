import { describe, expect, test } from "bun:test"
import { ServeRuntimeMemoryMetrics } from "../../src/runtime/memory-metrics"
import { expectNoProcessErrors } from "../fixture/process-errors"

describe("serve runtime memory metrics", () => {
  test("parses configurable interval with explicit disable values", () => {
    expect(ServeRuntimeMemoryMetrics.intervalMsFromEnv({})).toBe(60_000)
    expect(ServeRuntimeMemoryMetrics.intervalMsFromEnv({ OPENCORVUS_RUNTIME_MEMORY_METRICS_INTERVAL_MS: "2500" })).toBe(
      2500,
    )
    expect(ServeRuntimeMemoryMetrics.intervalMsFromEnv({ OPENCORVUS_RUNTIME_MEMORY_METRICS_INTERVAL_MS: "0" })).toBe(
      undefined,
    )
    expect(
      ServeRuntimeMemoryMetrics.intervalMsFromEnv({ OPENCORVUS_RUNTIME_MEMORY_METRICS_INTERVAL_MS: "false" }),
    ).toBe(undefined)
    expect(ServeRuntimeMemoryMetrics.intervalMsFromEnv({ OPENCORVUS_RUNTIME_MEMORY_METRICS_INTERVAL_MS: "bad" })).toBe(
      60_000,
    )
  })

  test("collects numeric process memory fields and existing browser stats", async () => {
    const id = `browser-mcp-test-${Date.now()}`
    const unregister = ServeRuntimeMemoryMetrics.register({
      id,
      snapshot: () => ({ active: 2, profiles: 1 }),
    })
    const snapshot = await ServeRuntimeMemoryMetrics.collect({
      providers: () => ServeRuntimeMemoryMetrics.providerSnapshots(),
    })
    unregister()

    expect(snapshot.pid).toBe(process.pid)
    expect(snapshot.uptimeMs).toBeGreaterThanOrEqual(0)
    expect(snapshot.process.rss).toBeGreaterThan(0)
    expect(snapshot.process.heapUsed).toBeGreaterThan(0)
    expect(snapshot.process.heapTotal).toBeGreaterThan(0)
    expect(snapshot.process.external).toBeGreaterThanOrEqual(0)
    expect(snapshot.process.arrayBuffers).toBeGreaterThanOrEqual(0)
    expect(snapshot.providers[id]).toEqual({ active: 2, profiles: 1 })
  })

  test("collect can use an explicit empty provider snapshot without importing browser session stats", async () => {
    const snapshot = await ServeRuntimeMemoryMetrics.collect({ providers: () => ({}) })

    expect(snapshot.providers).toEqual({})
  })

  test("provider registry unregisters and isolates provider failures", async () => {
    const okID = `ok-${Date.now()}`
    const badID = `bad-${Date.now()}`
    const unregister = ServeRuntimeMemoryMetrics.register({
      id: okID,
      snapshot: () => ({ value: 1 }),
    })
    const unregisterBad = ServeRuntimeMemoryMetrics.register({
      id: badID,
      snapshot: () => {
        throw new Error("provider failed")
      },
    })

    const snapshots = await ServeRuntimeMemoryMetrics.providerSnapshots()
    expect(snapshots[okID]).toEqual({ value: 1 })
    expect(snapshots[badID]).toEqual({ error: "provider failed" })
    unregister()
    const afterUnregister = await ServeRuntimeMemoryMetrics.providerSnapshots()
    expect(afterUnregister[okID]).toBeUndefined()
    expect(afterUnregister[badID]).toEqual({ error: "provider failed" })
    unregisterBad()
  })

  test("disabled start returns a no-op stopper without scheduling metrics", () => {
    const logged: string[] = []
    const handle = ServeRuntimeMemoryMetrics.start({
      intervalMs: 0,
      logger: {
        info(message) {
          logged.push(String(message))
        },
        warn(message) {
          logged.push(String(message))
        },
      },
    })

    handle.stop()
    expect(handle.intervalMs).toBe(0)
    expect(logged).toEqual([])
  })

  test("metrics logger failures do not leak process errors", async () => {
    await expectNoProcessErrors(async () => {
      const handle = ServeRuntimeMemoryMetrics.start({
        intervalMs: 10,
        logger: {
          info() {
            throw new Error("info failed")
          },
          warn() {
            throw new Error("warn failed")
          },
        },
      })
      try {
        await Bun.sleep(30)
      } finally {
        handle.stop()
      }
    })
  })
})
