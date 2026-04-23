import { expect, mock, test } from "bun:test";
import { routeSSEEvent, handleTaskListNotification } from "../src/services/events";
import { boardStore, setBoardStore } from "../src/store/board";
import { resetWriter } from "../src/services/tree-writer";

test("selected-task message events mark the board for refresh", () => {
  resetWriter();
  setBoardStore("selectedTaskID", "tsk_refresh");
  setBoardStore("boardSyncPending", false);

  const handled = routeSSEEvent({
    type: "message.updated",
    properties: {
      taskID: "tsk_refresh",
      info: {
        id: "msg_refresh",
        sessionID: "ses_refresh",
        role: "assistant",
        resolvedRole: "assistant",
        channel: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_200_000 },
      },
    },
  });

  expect(handled).toBe(true);
  expect(boardStore.boardSyncPending).toBe(true);
});

test("task-list notifications reload tasks for message deltas", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  const originalWindow = (globalThis as any).window;
  const fetchMock = mock(async () =>
    new Response(JSON.stringify({ tasks: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
  globalThis.fetch = fetchMock as typeof fetch;
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  } as Storage;
  (globalThis as any).window = {};

  try {
    handleTaskListNotification({
      type: "message.part.delta",
      taskID: "tsk_sidebar_refresh",
      sequence: 7,
    });

    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/global/tasks")),
    ).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalLocalStorage;
    (globalThis as any).window = originalWindow;
  }
});