import { afterEach, describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import {
  TASK_LIST_REFRESH_INTERVAL_MS,
  SELECTED_TASK_STREAM_STALL_MS,
  performSseReconnect,
  startSSE,
  startTaskListSSE,
  stopSSE,
  stopTaskListSSE,
  type SseReconnectDeps,
  type SseStartOptions,
} from "../src/services/sse"
import {
  HOST_CAPABILITIES,
  __setHostTransportForTest,
  type HostTransport,
  type StreamHandlers,
  type StreamOpenRequest,
  type TransportRequest,
} from "../src/services/host-transport"
import { setBoardStore, type BoardSource } from "../src/store/board"
import { messageStore } from "../src/store/messages"
import { setSettingsStore } from "../src/store/settings"
import { resetSelectedLiveCursor } from "../src/services/selected-stream-cursor"
import { selectTask } from "../src/services/task"

/**
 * Reconnect policy regression tests.
 *
 * After the selected task has loaded, reconnect must not full-hydrate the
 * conversation again. It reopens the task stream from the current
 * boardStore.taskSequence so the server can replay persisted events without
 * clearing cardTreeStore.
 *
 * A fast task switch during reconnect must still suppress the OLD task's
 * restart. startSSE calls stopSSE first, so restarting a stale stream would
 * silently kill the user-visible stream.
 */

interface Spy {
  resumeAfterCalls: number
  restartCalls: Array<[BoardSource, number, SseStartOptions | undefined]>
  retryCalls: number
  consoleErrors: unknown[][]
}

function makeDeps(opts: {
  taskID: string
  after: number
  currentTaskID: () => string
  resumeAfter: () => number
  restart?: (source: BoardSource, after: number, options?: SseStartOptions) => void
  retryDelayMs?: number
  fireRetry?: boolean
}): { deps: SseReconnectDeps; spy: Spy } {
  const spy: Spy = {
    resumeAfterCalls: 0,
    restartCalls: [],
    retryCalls: 0,
    consoleErrors: [],
  }
  const deps: SseReconnectDeps = {
    taskID: opts.taskID,
    after: opts.after,
    currentTaskID: opts.currentTaskID,
    resumeAfter: () => {
      spy.resumeAfterCalls++
      return opts.resumeAfter()
    },
    restart: (source, after, options) => {
      spy.restartCalls.push([source, after, options])
      opts.restart?.(source, after, options)
    },
    scheduleRetry: (fn, _ms) => {
      spy.retryCalls++
      if (opts.fireRetry) void Promise.resolve().then(fn)
    },
    retryDelayMs: opts.retryDelayMs ?? 3000,
  }
  return { deps, spy }
}

function conversationPayload(taskID: string, lastSequence: number) {
  return {
    lastSequence,
    board: {
      snapshotVersion: `board:${taskID}`,
      task: {
        id: taskID,
        status: "active",
        request: "tail repair",
        sessionID: `ses_${taskID}`,
        time: { created: 1_776_000_000_000 },
        attachments: [],
      },
      goalWorkflows: [],
      interactions: [],
    },
    transcript: [],
    timeline: [],
    events: [],
    eventReplay: {
      cursor: lastSequence,
      latestSequence: lastSequence,
      complete: true,
      limit: 500,
      sinceTimestamp: null,
    },
    history: { oldestTimestamp: null, oldestMessageID: null, hasMore: false, limit: 160 },
    view: { sessions: [] },
    agentView: { sessions: [] },
    messageWatermark: lastSequence,
  }
}

describe("performSseReconnect (audit W2-V10)", () => {
  test("happy path: reconnect restarts from the current selected task sequence without hydrating", async () => {
    const { deps, spy } = makeDeps({
      taskID: "tsk_a",
      after: 0,
      currentTaskID: () => "tsk_a",
      resumeAfter: () => 42,
    })
    await performSseReconnect(deps)
    expect(spy.resumeAfterCalls).toBe(1)
    expect(spy.restartCalls).toEqual([[{ kind: "task", id: "tsk_a" }, 42, undefined]])
    expect(spy.retryCalls).toBe(0)
    expect(spy.consoleErrors.length).toBe(0)
  })

  test("restart throw is caught and a retry is scheduled (no unhandled rejection)", async () => {
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
        resumeAfter: () => 100,
        restart: () => {
          throw new Error("network down")
        },
      })
      await expect(performSseReconnect(deps)).resolves.toBeUndefined()
      expect(spy.resumeAfterCalls).toBe(1)
      // Retry was scheduled.
      expect(spy.retryCalls).toBe(1)
      await new Promise((r) => setTimeout(r, 0))
      expect(spy.restartCalls).toEqual([[{ kind: "task", id: "tsk_b" }, 100, undefined]])
      // The throw was logged (not silently swallowed).
      expect(errs.length).toBeGreaterThanOrEqual(1)
      const msg = errs[0]!.map(String).join(" ")
      expect(msg).toMatch(/reconnect restart failed/)
      expect(msg).toMatch(/tsk_b/)
    } finally {
      console.error = orig
    }
  })

  test("restart retry re-reads the current resume sequence instead of using a stale cursor", async () => {
    let attempts = 0
    const sequences = [100, 123]
    const orig = console.error
    console.error = () => {}
    try {
      const { deps, spy } = makeDeps({
        taskID: "tsk_retry",
        after: 100,
        currentTaskID: () => "tsk_retry",
        fireRetry: true,
        resumeAfter: () => sequences[Math.min(attempts, sequences.length - 1)]!,
        restart: () => {
          attempts += 1
          if (attempts === 1) throw new Error("network down")
        },
      })

      await performSseReconnect(deps)
      await new Promise((r) => setTimeout(r, 0))

      expect(spy.resumeAfterCalls).toBe(2)
      expect(spy.retryCalls).toBe(1)
      expect(spy.restartCalls).toEqual([
        [{ kind: "task", id: "tsk_retry" }, 100, undefined],
        [{ kind: "task", id: "tsk_retry" }, 123, undefined],
      ])
    } finally {
      console.error = orig
    }
  })

  test("task-switch BEFORE reconnect: skip without reading cursor or restarting", async () => {
    const { deps, spy } = makeDeps({
      taskID: "tsk_c",
      after: 0,
      currentTaskID: () => "tsk_OTHER",
      resumeAfter: () => 999,
    })
    await performSseReconnect(deps)
    expect(spy.resumeAfterCalls).toBe(0)
    expect(spy.restartCalls).toEqual([])
    expect(spy.retryCalls).toBe(0)
  })

  test("task-switch DURING cursor read: cursor was read but restart MUST NOT", async () => {
    let currentTask = "tsk_d"
    const { deps, spy } = makeDeps({
      taskID: "tsk_d",
      after: 0,
      currentTaskID: () => currentTask,
      resumeAfter: () => {
        // Simulate the user switching tasks while reconnect is preparing.
        currentTask = "tsk_e"
        return 7
      },
    })
    await performSseReconnect(deps)
    expect(spy.resumeAfterCalls).toBe(1)
    expect(spy.restartCalls).toEqual([])
    expect(spy.retryCalls).toBe(0)
  })

  test("task-switch AFTER restart failure: retry MUST NOT fire restart for the stale task", async () => {
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
        resumeAfter: () => 8,
        restart: () => {
          // User switches tasks at the same moment restart fails.
          currentTask = "tsk_g"
          throw new Error("transient")
        },
      })
      await performSseReconnect(deps)
      // The retry-schedule branch sees currentTaskID !== "tsk_f"
      // and returns without scheduling. No restart, no retry.
      expect(spy.resumeAfterCalls).toBe(1)
      expect(spy.retryCalls).toBe(0)
      expect(spy.restartCalls).toEqual([[{ kind: "task", id: "tsk_f" }, 8, undefined]])
    } finally {
      console.error = orig
    }
  })
})

describe("startSSE stream error handling", () => {
  afterEach(() => {
    stopSSE()
    stopTaskListSSE()
    resetSelectedLiveCursor()
    __setHostTransportForTest(undefined)
    setBoardStore("selectedTaskID", "")
    setBoardStore("selectedSource", null)
    setBoardStore("taskSequence", 0)
    setBoardStore("board", null)
    setBoardStore("taskSwitching", false)
    setSettingsStore("directory", "")
  })

  test("stream error closes the handle so sequence-only reconnect can run from onClose", () => {
    createRoot((dispose) => {
      let handlers: StreamHandlers | undefined
      let closeCalls = 0
      const transport = {
        kind: "tauri",
        capabilities: HOST_CAPABILITIES.tauri,
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
      setBoardStore("selectedSource", { kind: "task", id: "tsk_error" })

      startSSE({ kind: "task", id: "tsk_error" })
      handlers!.onOpen?.()
      expect(messageStore.sseConnected).toBe(true)

      handlers!.onError?.(new Error("network interrupted"))

      expect(messageStore.sseConnected).toBe(false)
      expect(closeCalls).toBe(1)

      stopSSE()
      dispose()
    })
  })

  test("live replay expiry reconnects from persisted sequence without requesting live replay", async () => {
    createRoot((dispose) => {
      const originalSetTimeout = globalThis.setTimeout
      const originalClearTimeout = globalThis.clearTimeout
      const timers: Array<{ fn: () => void; ms: number }> = []
      const streams: StreamOpenRequest[] = []
      const requests: string[] = []
      let handlers: StreamHandlers | undefined
      const transport = {
        kind: "tauri",
        capabilities: HOST_CAPABILITIES.tauri,
        request: async <T>(input: TransportRequest) => {
          requests.push(input.path)
          return { status: 200, ok: true, headers: {}, body: conversationPayload("tsk_expired", 6) as T }
        },
        openStream: (input: StreamOpenRequest, h: StreamHandlers) => {
          streams.push(input)
          handlers = h
          return { close() {} }
        },
        native: async () => null,
        subscribeUiCommand: () => ({ unsubscribe() {} }),
      } satisfies HostTransport

      globalThis.setTimeout = ((handler: TimerHandler, timeout?: number) => {
        timers.push({ fn: () => (typeof handler === "function" ? handler() : undefined), ms: Number(timeout) })
        return timers.length as unknown as ReturnType<typeof setTimeout>
      }) as typeof globalThis.setTimeout
      globalThis.clearTimeout = ((_handle?: ReturnType<typeof setTimeout>) => {}) as typeof globalThis.clearTimeout

      try {
        __setHostTransportForTest(transport)
        setBoardStore("selectedTaskID", "tsk_expired")
        setBoardStore("selectedSource", { kind: "task", id: "tsk_expired" })
        setBoardStore("taskSequence", 6)

        startSSE({ kind: "task", id: "tsk_expired" }, 5)
        handlers!.onEvent(
          JSON.stringify({
            type: "task.live_replay_expired",
            task_id: "tsk_expired",
            sequence: 0,
            payload: { reason: "selected task live replay retention expired" },
          }),
        )
        handlers!.onClose?.("server-fatal-close")

        const reconnect = timers.find((timer) => timer.ms === 3000)
        expect(reconnect).toBeDefined()
        reconnect!.fn()

        expect(streams).toEqual([
          { path: "task/tsk_expired/events", query: { after: "5", after_live: "0" } },
          { path: "task/tsk_expired/events", query: { after: "6" } },
        ])
        expect(requests).toEqual(["task/tsk_expired/conversation"])
      } finally {
        stopSSE()
        dispose()
        __setHostTransportForTest(undefined)
        globalThis.setTimeout = originalSetTimeout
        globalThis.clearTimeout = originalClearTimeout
      }
    })
  })

  test("task-list stream error closes the handle so sidebar refresh reconnect can run from onClose", () => {
    createRoot((dispose) => {
      let handlers: StreamHandlers | undefined
      let closeCalls = 0
      const transport = {
        kind: "tauri",
        capabilities: HOST_CAPABILITIES.tauri,
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

  test("selected task stream watchdog closes a silent stale handle so reconnect can run", () => {
    createRoot((dispose) => {
      const originalSetTimeout = globalThis.setTimeout
      const originalClearTimeout = globalThis.clearTimeout
      const timers: Array<{ fn: () => void; ms: number }> = []
      let handlers: StreamHandlers | undefined
      let closeCalls = 0
      const transport = {
        kind: "tauri",
        capabilities: HOST_CAPABILITIES.tauri,
        request: async <T>(_input: TransportRequest) => ({ status: 200, ok: true, headers: {}, body: null as T }),
        openStream: (_input: StreamOpenRequest, h: StreamHandlers) => {
          handlers = h
          return {
            close: () => {
              closeCalls++
              h.onClose?.("watchdog-test-close")
            },
          }
        },
        native: async () => null,
        subscribeUiCommand: () => ({ unsubscribe() {} }),
      } satisfies HostTransport

      globalThis.setTimeout = ((handler: TimerHandler, timeout?: number) => {
        timers.push({ fn: () => (typeof handler === "function" ? handler() : undefined), ms: Number(timeout) })
        return timers.length as unknown as ReturnType<typeof setTimeout>
      }) as typeof globalThis.setTimeout
      globalThis.clearTimeout = ((_handle?: ReturnType<typeof setTimeout>) => {}) as typeof globalThis.clearTimeout

      try {
        __setHostTransportForTest(transport)
        setBoardStore("selectedTaskID", "tsk_watchdog")
        setBoardStore("selectedSource", { kind: "task", id: "tsk_watchdog" })
        setBoardStore("taskSequence", 41)

        startSSE({ kind: "task", id: "tsk_watchdog" }, 40)
        handlers!.onOpen?.()
        expect(messageStore.sseConnected).toBe(true)

        const watchdog = timers.find((timer) => timer.ms === SELECTED_TASK_STREAM_STALL_MS)
        expect(watchdog).toBeDefined()
        watchdog!.fn()

        expect(closeCalls).toBe(1)
        expect(messageStore.sseConnected).toBe(false)
        expect(timers.some((timer) => timer.ms === 3000)).toBe(true)
      } finally {
        stopSSE()
        dispose()
        __setHostTransportForTest(undefined)
        globalThis.setTimeout = originalSetTimeout
        globalThis.clearTimeout = originalClearTimeout
      }
    })
  })

  test("clicking an already loaded disconnected task restarts its selected stream", async () => {
    const streams: StreamOpenRequest[] = []
    const transport = {
      kind: "tauri",
      capabilities: HOST_CAPABILITIES.tauri,
      request: async <T>(input: TransportRequest) => ({
        status: 200,
        ok: true,
        headers: {},
        body: input.path === "task/tsk_same/conversation" ? (conversationPayload("tsk_same", 77) as T) : (null as T),
      }),
      openStream: (input: StreamOpenRequest, _h: StreamHandlers) => {
        streams.push(input)
        return { close() {} }
      },
      native: async () => null,
      subscribeUiCommand: () => ({ unsubscribe() {} }),
    } satisfies HostTransport

    __setHostTransportForTest(transport)
    setBoardStore("selectedTaskID", "tsk_same")
    setBoardStore("selectedSource", { kind: "task", id: "tsk_same" })
    setBoardStore("taskSequence", 77)
    setBoardStore("board", {
      snapshotVersion: "board:same",
      task: {
        id: "tsk_same",
        status: "active",
        request: "same",
        sessionID: "ses_same",
        time: { created: 1_776_000_000_000 },
        attachments: [],
      },
      goalWorkflows: [],
      interactions: [],
    })

    await selectTask("tsk_same")

    expect(streams).toEqual([{ path: "task/tsk_same/events", query: { after: "77", after_live: "0" } }])
  })

  test("task-list periodic refresh reloads the global list even without stream events", async () => {
    let tick: (() => void) | undefined
    let intervalMs = 0
    let clearCalls = 0
    const originalSetInterval = globalThis.setInterval
    const originalClearInterval = globalThis.clearInterval

    globalThis.setInterval = ((handler: TimerHandler, timeout?: number) => {
      tick = () => {
        if (typeof handler === "function") handler()
      }
      intervalMs = Number(timeout)
      return 177 as unknown as ReturnType<typeof setInterval>
    }) as typeof globalThis.setInterval
    globalThis.clearInterval = ((_handle?: ReturnType<typeof setInterval>) => {
      clearCalls++
    }) as typeof globalThis.clearInterval

    try {
      const paths: string[] = []
      let streamOpened = 0
      const transport = {
        kind: "tauri",
        capabilities: HOST_CAPABILITIES.tauri,
        request: async <T>(input: TransportRequest) => {
          paths.push(input.path)
          return { status: 200, ok: true, headers: {}, body: { tasks: [] } as T }
        },
        openStream: (_input: StreamOpenRequest, _h: StreamHandlers) => {
          streamOpened++
          return { close() {} }
        },
        native: async () => null,
        subscribeUiCommand: () => ({ unsubscribe() {} }),
      } satisfies HostTransport

      __setHostTransportForTest(transport)
      setSettingsStore("directory", "")

      startTaskListSSE()

      expect(intervalMs).toBe(TASK_LIST_REFRESH_INTERVAL_MS)
      expect(streamOpened).toBe(0)
      expect(tick).toBeDefined()

      tick!()
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(paths).toEqual(["global/tasks"])

      stopTaskListSSE()
      expect(clearCalls).toBe(1)
    } finally {
      stopTaskListSSE()
      __setHostTransportForTest(undefined)
      globalThis.setInterval = originalSetInterval
      globalThis.clearInterval = originalClearInterval
      setSettingsStore("directory", "")
    }
  })

  test("task-list deliberate stop closes the stream without scheduling reconnect", () => {
    const originalSetInterval = globalThis.setInterval
    const originalClearInterval = globalThis.clearInterval
    const originalSetTimeout = globalThis.setTimeout
    const originalClearTimeout = globalThis.clearTimeout
    let timeoutCalls = 0
    let closeCalls = 0

    globalThis.setInterval = ((_handler: TimerHandler, _timeout?: number) =>
      211 as unknown as ReturnType<typeof setInterval>) as typeof globalThis.setInterval
    globalThis.clearInterval = ((_handle?: ReturnType<typeof setInterval>) => {}) as typeof globalThis.clearInterval
    globalThis.setTimeout = ((_handler: TimerHandler, _timeout?: number) => {
      timeoutCalls++
      return 233 as unknown as ReturnType<typeof setTimeout>
    }) as typeof globalThis.setTimeout
    globalThis.clearTimeout = ((_handle?: ReturnType<typeof setTimeout>) => {}) as typeof globalThis.clearTimeout

    try {
      const transport = {
        kind: "tauri",
        capabilities: HOST_CAPABILITIES.tauri,
        request: async <T>(_input: TransportRequest) => ({ status: 200, ok: true, headers: {}, body: null as T }),
        openStream: (_input: StreamOpenRequest, h: StreamHandlers) => {
          return {
            close: () => {
              closeCalls++
              h.onClose?.("manual-stop")
            },
          }
        },
        native: async () => null,
        subscribeUiCommand: () => ({ unsubscribe() {} }),
      } satisfies HostTransport

      __setHostTransportForTest(transport)
      setSettingsStore("directory", "D:\\workspace")

      startTaskListSSE()
      stopTaskListSSE()

      expect(closeCalls).toBe(1)
      expect(timeoutCalls).toBe(0)
    } finally {
      stopTaskListSSE()
      __setHostTransportForTest(undefined)
      globalThis.setInterval = originalSetInterval
      globalThis.clearInterval = originalClearInterval
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
      setSettingsStore("directory", "")
    }
  })
})
