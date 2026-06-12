import { test, expect, spyOn, beforeEach, afterEach, beforeAll } from "bun:test"
;(globalThis as any).__OPENCORVUS_OVERLAY_VERSION__ = "test"

// 2026-05-11 codex review found that `interaction.requested` events
// landed in `writeToTree` twice: once unconditionally inside
// `routeSSEEvent` and once again in `handleEventStreamEvent` after
// `routeSSEEvent` returned false. Side effects in `writeToTree`
// therefore risked firing notification side effects twice for a single SSE
// event. This test pins the contract: the per-task stream projects the tree
// exactly once and the global task-list stream is the sole notification owner.
// 2026-05-12: producer event name corrected — engine emits
// `interaction.requested` (engine/model.ts:1057), not `interaction.created`;
// the consumer + this fixture had drifted. See contract-event-names.test.ts
// for the guard.

let applySpy: ReturnType<typeof spyOn>
let notifySpy: ReturnType<typeof spyOn>
let treeWriter: typeof import("../src/services/tree-writer")
let notify: typeof import("../src/services/notify")
let events: typeof import("../src/services/events")

beforeAll(async () => {
  treeWriter = await import("../src/services/tree-writer")
  notify = await import("../src/services/notify")
  events = await import("../src/services/events")
})

beforeEach(() => {
  treeWriter.resetWriter()
  applySpy = spyOn(treeWriter, "applyEvent")
  notifySpy = spyOn(notify, "routeNotification").mockImplementation(() => {})
})

afterEach(() => {
  applySpy.mockRestore()
  notifySpy.mockRestore()
})

test("interaction.requested event is projected to tree-writer exactly once", () => {
  const event = {
    type: "interaction.requested",
    taskID: "task_1",
    properties: { taskID: "task_1", title: "needs input" },
  }
  const handled = events.routeSSEEvent(event)
  if (!handled) events.handleEventStreamEvent(event)
  // tree-writer's applyEvent must be invoked exactly once. The spy
  // counter pins the contract regardless of whether the event ends up
  // consumed by routeSSEEvent or forwarded to handleEventStreamEvent.
  expect(applySpy).toHaveBeenCalledTimes(1)
  expect(notifySpy).toHaveBeenCalledTimes(0)
  events.handleTaskListNotification({
    type: "interaction.requested",
    taskID: "task_1",
    sequence: 1,
    notify: { tier: 1, badge: true },
  })
  expect(notifySpy).toHaveBeenCalledTimes(1)
})

test("board-invalidating events fall through to handleEventStreamEvent without double-projecting", () => {
  const event = {
    type: "task.updated",
    taskID: "task_2",
    properties: { taskID: "task_2" },
  }
  const handled = events.routeSSEEvent(event)
  expect(handled).toBe(false)
  if (!handled) events.handleEventStreamEvent(event)
  expect(applySpy).toHaveBeenCalledTimes(1)
})

test("replayed interaction.requested events never route notifications", () => {
  events.replayTaskEventToTree({
    type: "interaction.requested",
    taskID: "task_replay",
    payload: {
      taskID: "task_replay",
      interactionID: "int_replay",
      requestType: "question",
      summary: "needs input",
    },
  })
  expect(applySpy).toHaveBeenCalledTimes(1)
  expect(notifySpy).toHaveBeenCalledTimes(0)
})
