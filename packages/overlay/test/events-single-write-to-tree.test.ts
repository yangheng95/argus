import { test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import * as treeWriter from "../src/services/tree-writer";
import * as notify from "../src/services/notify";
import { handleEventStreamEvent, routeSSEEvent } from "../src/services/events";

// 2026-05-11 codex review found that `interaction.requested` events
// landed in `writeToTree` twice: once unconditionally inside
// `routeSSEEvent` and once again in `handleEventStreamEvent` after
// `routeSSEEvent` returned false. Side effects in `writeToTree`
// (notifyInteractionRequested → OS toast) therefore fired twice for a
// single SSE event. This test pins the contract so the duplicate
// cannot return: tree-writer's applyEvent must be invoked exactly
// once per dispatched event, and the OS notification path fires once.
// 2026-05-12: producer event name corrected — engine emits
// `interaction.requested` (engine/model.ts:1057), not `interaction.created`;
// the consumer + this fixture had drifted, leaving notifyInteractionRequested
// inert in production. See contract-event-names.test.ts for the guard.

let applySpy: ReturnType<typeof spyOn>;
let notifySpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  treeWriter.resetWriter();
  applySpy = spyOn(treeWriter, "applyEvent");
  notifySpy = spyOn(notify, "notifyInteractionRequested");
});

afterEach(() => {
  applySpy.mockRestore();
  notifySpy.mockRestore();
});

test("interaction.requested event is projected to tree-writer exactly once", () => {
  const event = {
    type: "interaction.requested",
    taskID: "task_1",
    properties: { taskID: "task_1", title: "needs input" },
  };
  const handled = routeSSEEvent(event);
  if (!handled) handleEventStreamEvent(event);
  // tree-writer's applyEvent must be invoked exactly once. The spy
  // counter pins the contract regardless of whether the event ends up
  // consumed by routeSSEEvent or forwarded to handleEventStreamEvent.
  expect(applySpy).toHaveBeenCalledTimes(1);
  // notifyInteractionRequested fires once per real `interaction.requested`.
  expect(notifySpy).toHaveBeenCalledTimes(1);
});

test("board-invalidating events fall through to handleEventStreamEvent without double-projecting", () => {
  const event = {
    type: "task.updated",
    taskID: "task_2",
    properties: { taskID: "task_2" },
  };
  const handled = routeSSEEvent(event);
  expect(handled).toBe(false);
  if (!handled) handleEventStreamEvent(event);
  expect(applySpy).toHaveBeenCalledTimes(1);
});
