import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import {
  advanceSseActiveElapsed,
  pauseSseActiveElapsed,
  type SseActiveElapsedState,
} from "../src/utils/sse-active-elapsed"
import {
  __resetSelectedTaskSseActivityForTest,
  pauseSelectedTaskSseActivity,
  recordSelectedTaskSseActivity,
  selectedTaskSseActiveElapsedMs,
  taskRuntimeActivityKey,
} from "../src/services/task-runtime-activity"

test("SSE active elapsed accumulates only intervals between active selected-task updates", () => {
  const key = "tsk_active:1776000000000"
  let state: SseActiveElapsedState = { key: "", elapsedMs: 0 }

  state = advanceSseActiveElapsed(state, { key, active: true, eventAt: 1000 })
  expect(state.elapsedMs).toBe(0)

  state = advanceSseActiveElapsed(state, { key, active: true, eventAt: 2600 })
  expect(state.elapsedMs).toBe(1600)

  state = advanceSseActiveElapsed(state, { key, active: false, eventAt: 9000 })
  expect(state.elapsedMs).toBe(1600)
  expect(state.observedAt).toBeUndefined()

  state = advanceSseActiveElapsed(state, { key, active: true, eventAt: 12_000 })
  expect(state.elapsedMs).toBe(1600)

  state = advanceSseActiveElapsed(state, { key, active: true, eventAt: 12_700 })
  expect(state.elapsedMs).toBe(2300)
})

test("SSE active elapsed pauses reconnect gaps and resets on a new task run key", () => {
  const key = "tsk_reconnect:1776000000000"
  let state: SseActiveElapsedState = { key: "", elapsedMs: 0 }

  state = advanceSseActiveElapsed(state, { key, active: true, eventAt: 100 })
  state = advanceSseActiveElapsed(state, { key, active: true, eventAt: 600 })
  state = pauseSseActiveElapsed(state, key)
  state = advanceSseActiveElapsed(state, { key, active: true, eventAt: 10_000 })
  expect(state.elapsedMs).toBe(500)

  state = advanceSseActiveElapsed(state, { key: "tsk_reconnect:1776000010000", active: true, eventAt: 11_000 })
  expect(state.elapsedMs).toBe(0)
})

test("selected task SSE activity service is reactive and keyed by task run", () => {
  createRoot((dispose) => {
    __resetSelectedTaskSseActivityForTest()
    const key = taskRuntimeActivityKey({ taskID: "tsk_service", createdAt: 1_776_000_000_000 })

    recordSelectedTaskSseActivity({ key, active: true, eventAt: 10 })
    expect(selectedTaskSseActiveElapsedMs(key)).toBe(0)
    recordSelectedTaskSseActivity({ key, active: true, eventAt: 1010 })
    expect(selectedTaskSseActiveElapsedMs(key)).toBe(1000)
    pauseSelectedTaskSseActivity(key)
    recordSelectedTaskSseActivity({ key, active: true, eventAt: 8010 })
    expect(selectedTaskSseActiveElapsedMs(key)).toBe(1000)
    recordSelectedTaskSseActivity({ key, active: true, eventAt: 8510 })
    expect(selectedTaskSseActiveElapsedMs(key)).toBe(1500)

    dispose()
  })
})

test("SSE active elapsed rejects invalid timestamps instead of using wall-clock fallback", () => {
  expect(() =>
    advanceSseActiveElapsed({ key: "tsk_invalid:1", elapsedMs: 0 }, { key: "tsk_invalid:1", active: true, eventAt: NaN }),
  ).toThrow("SSE active elapsed timestamp must be finite")
  expect(() => taskRuntimeActivityKey({ taskID: "tsk_invalid", createdAt: 0 })).toThrow(
    "runtime activity requires a positive task.time.created timestamp",
  )
})
