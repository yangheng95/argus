import { afterEach, describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { performSseReconnect, startSSE, startTaskListSSE, stopSSE, stopTaskListSSE, type SseReconnectDeps } from "../src/services/sse"
import {
  __setHostTransportForTest,
  type HostTransport,
  type StreamHandlers,
  type StreamOpenRequest,
  type TransportRequest,
} from "../src/services/host-transport"
import { setBoardStore } from "../src/store/board"
import { messageStore } from "../src/store/messages"
import { setSettingsStore } from "../src/store/settings"

/**
 * audit-2026-04-29 W2-V10 — regression for two latent P1s in the
 * SSE reconnect tick.
 *
 *   (a) Pre-fix: `await hydrateTaskConversation(taskID)` ran inside
 *       an async setTimeout callback with no .catch. A throw (network
 *       down, /conversation 500) bubbled to an unhandled promise →
 *       SSE never restarted, no toast, conversation looked frozen.
 *
 *   (b) Pre-fix: the selectedTaskID guard sat ABOVE the hydrate
 *       await. A fast task-switch during hydrate would have us
 *       restart the OLD task's SSE — startSSE calls stopSSE first,
 *       so this stomped the NEW task's already-live handle and
 *       silently killed the user-visible stream.
 *
 * The reconnect tick was extracted from sse.ts onClose so this test
 * can drive both paths without standing up real timers / transport.
 */

interface Spy {
  hydrateCalls: string[]
  restartCalls: Array<[string, number]>
  retryCalls: number
  consoleErrors: unknown[][]
}

function makeDeps(opts: {
  taskID: string
  after: number
  currentTaskID: () => string
  hydrate: (taskID: string) => Promise<number>
  retryDelayMs?: number
}): { deps: SseReconnectDeps; spy: Spy } {
  const spy: Spy = {
    hydrateCalls: [],
    restartCalls: [],
    retryCalls: 0,
    consoleErrors: [],
  }
  const deps: SseReconnectDeps = {
    taskID: opts.taskID,
    after: opts.after,
    currentTaskID: opts.currentTaskID,
    hydrate: async (id) => {
      spy.hydrateCalls.push(id)
      return opts.hydrate(id)
    },
    restart: (id, after) => {
      spy.restartCalls.push([id, after])
    },
    scheduleRetry: (fn, _ms) => {
      spy.retryCalls++
      // Fire immediately so the test can observe what the retry
      // would do without standing up a real setTimeout.
      void Promise.resolve().then(fn)
    },
    retryDelayMs: opts.retryDelayMs ?? 3000,
  }
  return { deps, spy }
}

describe("performSseReconnect (audit W2-V10)", () => {
  test("happy path: hydrate succeeds → restart fires with the new sequence", async () => {
    const { deps, spy } = makeDeps({
      taskID: "tsk_a",
      after: 0,
      currentTaskID: () => "tsk_a",
      hydrate: async () => 42,
    })
    await performSseReconnect(deps)
    expect(spy.hydrateCalls).toEqual(["tsk_a"])
    expect(spy.restartCalls).toEqual([["tsk_a", 42]])
    expect(spy.retryCalls).toBe(0)
    expect(spy.consoleErrors.length).toBe(0)
  })

  test("hydrate throw is caught and a retry is scheduled (no unhandled rejection)", async () => {
    const errs: unknown[][] = []
    const orig = console.error
    console.error = (...a: unknown[]) => {
      errs.push(a)
    }
    try {
      const { deps, spy } = makeDeps({
        taskID: "tsk_b",
        after: 100,
        currentTaskID: () => "tsk_b",
        hydrate: async () => {
          throw new Error("network down")
        },
      })
      await expect(performSseReconnect(deps)).resolves.toBeUndefined()
      // Hydrate ran once and threw.
      expect(spy.hydrateCalls).toEqual(["tsk_b"])
      // Retry was scheduled.
      expect(spy.retryCalls).toBe(1)
      // Yield so the (microtask-queued) retry callback runs.
      await new Promise((r) => setTimeout(r, 0))
      // Retry, now still on the same task, fires startSSE with the
      // ORIGINAL `after` (the hydrate cursor we couldn't compute).
      expect(spy.restartCalls).toEqual([["tsk_b", 100]])
      // The throw was logged (not silently swallowed).
      expect(errs.length).toBeGreaterThanOrEqual(1)
      const msg = errs[0]!.map(String).join(" ")
      expect(msg).toMatch(/reconnect hydrate failed/)
      expect(msg).toMatch(/tsk_b/)
    } finally {
      console.error = orig
    }
  })

  test("task-switch BEFORE hydrate: skip without firing hydrate or restart", async () => {
    const { deps, spy } = makeDeps({
      taskID: "tsk_c",
      after: 0,
      currentTaskID: () => "tsk_OTHER",
      hydrate: async () => 999,
    })
    await performSseReconnect(deps)
    expect(spy.hydrateCalls).toEqual([])
    expect(spy.restartCalls).toEqual([])
    expect(spy.retryCalls).toBe(0)
  })

  test("task-switch DURING hydrate (post-await race): hydrate ran but restart MUST NOT", async () => {
    // The bug: pre-fix the selectedTaskID guard was only BEFORE the
    // hydrate await. If the user task-switched while hydrate was in
    // flight, the old taskID's startSSE fired and stomped the new
    // taskID's already-live handle.
    let currentTask = "tsk_d"
    const { deps, spy } = makeDeps({
      taskID: "tsk_d",
      after: 0,
      currentTaskID: () => currentTask,
      hydrate: async (id) => {
        // Simulate the user switching tasks DURING hydrate.
        currentTask = "tsk_e"
        return 7
      },
    })
    await performSseReconnect(deps)
    // Hydrate did run (the request was already in flight when the
    // user switched); but post-await guard caught the change and
    // suppressed the restart.
    expect(spy.hydrateCalls).toEqual(["tsk_d"])
    expect(spy.restartCalls).toEqual([])
    expect(spy.retryCalls).toBe(0)
  })

  test("task-switch AFTER hydrate failure: retry MUST NOT fire restart for the stale task", async () => {
    let currentTask = "tsk_f"
    const errs: unknown[][] = []
    const orig = console.error
    console.error = (...a: unknown[]) => {
      errs.push(a)
    }
    try {
      const { deps, spy } = makeDeps({
        taskID: "tsk_f",
        after: 0,
        currentTaskID: () => currentTask,
        hydrate: async () => {
          // User switches tasks at the same moment hydrate fails.
          currentTask = "tsk_g"
          throw new Error("transient")
        },
      })
      await performSseReconnect(deps)
      // The retry-schedule branch sees currentTaskID !== "tsk_f"
      // and returns without scheduling. No restart, no retry.
      expect(spy.hydrateCalls).toEqual(["tsk_f"])
      expect(spy.retryCalls).toBe(0)
      expect(spy.restartCalls).toEqual([])
    } finally {
      console.error = orig
    }
  })
})

describe("startSSE stream error handling", () => {
  afterEach(() => {
    stopSSE()
    stopTaskListSSE()
    __setHostTransportForTest(undefined)
    setBoardStore("selectedTaskID", "")
    setSettingsStore("directory", "")
  })

  test("stream error closes the handle so hydrate-and-resume reconnect can run from onClose", () => {
    createRoot((dispose) => {
      let handlers: StreamHandlers | undefined
      let closeCalls = 0
      const transport = {
        kind: "tauri",
        request: async <T>(_input: TransportRequest) => ({ status: 200, ok: true, headers: {}, body: null as T }),
        openStream: (_input: StreamOpenRequest, h: StreamHandlers) => {
          handlers = h
          return {
            close: () => {
              closeCalls++
              h.onClose?.("test-error-close")
            },
          }
        },
        native: async () => null,
        subscribeUiCommand: () => ({ unsubscribe() {} }),
      } satisfies HostTransport

      __setHostTransportForTest(transport)
      setBoardStore("selectedTaskID", "tsk_error")

      startSSE("tsk_error")
      handlers!.onOpen?.()
      expect(messageStore.sseConnected).toBe(true)

      handlers!.onError?.(new Error("network interrupted"))

      expect(messageStore.sseConnected).toBe(false)
      expect(closeCalls).toBe(1)

      stopSSE()
      dispose()
    })
  })

  test("task-list stream error closes the handle so sidebar refresh reconnect can run from onClose", () => {
    createRoot((dispose) => {
      let handlers: StreamHandlers | undefined
      let closeCalls = 0
      const transport = {
        kind: "tauri",
        request: async <T>(_input: TransportRequest) => ({ status: 200, ok: true, headers: {}, body: null as T }),
        openStream: (_input: StreamOpenRequest, h: StreamHandlers) => {
          handlers = h
          return {
            close: () => {
              closeCalls++
              h.onClose?.("test-task-list-error-close")
            },
          }
        },
        native: async () => null,
        subscribeUiCommand: () => ({ unsubscribe() {} }),
      } satisfies HostTransport

      __setHostTransportForTest(transport)
      setSettingsStore("directory", "D:\\workspace")

      startTaskListSSE()
      handlers!.onError?.(new Error("task list stream interrupted"))

      expect(closeCalls).toBe(1)

      stopTaskListSSE()
      dispose()
    })
  })
})
