import { afterEach, expect, mock, test } from "bun:test";
import type { HostTransport, TransportRequest, TransportResponse } from "../src/services/host-transport";

(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test";

const { routeSSEEvent, handleEventStreamEvent, handleTaskListNotification } = await import("../src/services/events");
const { boardStore, loadTasks, setBoardStore } = await import("../src/store/board");
const { appStore, setAppStore } = await import("../src/store/app");
const { resetWriter } = await import("../src/services/tree-writer");
const { cardTreeStore } = await import("../src/store/card-tree");
const { sessionConfigRefreshToken } = await import("../src/services/config");
const { __setHostTransportForTest } = await import("../src/services/host-transport");
const { resetSelectedLiveCursor } = await import("../src/services/selected-stream-cursor");

if (typeof globalThis.requestAnimationFrame === "undefined") {
  (globalThis as any).requestAnimationFrame = (() => 1) as any;
  (globalThis as any).cancelAnimationFrame = (() => {}) as any;
}

function fakeConfigTransport(paths: string[]): HostTransport {
  return {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      paths.push(req.path);
      if (req.path === "config") {
        return { status: 200, ok: true, headers: {}, body: { model: "openai/coalesced" } as T };
      }
      if (req.path === "provider") {
        return { status: 200, ok: true, headers: {}, body: { all: [] } as T };
      }
      if (req.path === "provider/auth") {
        return { status: 200, ok: true, headers: {}, body: {} as T };
      }
      if (req.path === "channel" || req.path === "config/prompt") {
        return { status: 200, ok: true, headers: {}, body: [] as T };
      }
      throw new Error(`unexpected route ${req.path}`);
    },
    openStream() {
      throw new Error("openStream not used");
    },
    async native() {
      throw new Error("native not used");
    },
    subscribeUiCommand() {
      return { unsubscribe() {} };
    },
  };
}

function fakeRecoveryTransport(
  streams: Array<{ path: string; query?: Record<string, string> }>,
  _sequence = 6,
): HostTransport {
  return {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      if (req.path === "global/tasks") {
        return { status: 200, ok: true, headers: {}, body: { tasks: [] } as T };
      }
      throw new Error(`unexpected route ${req.path}`);
    },
    openStream(input) {
      streams.push(input);
      return { close() {} };
    },
    async native() {
      throw new Error("native not used");
    },
    subscribeUiCommand() {
      return { unsubscribe() {} };
    },
  };
}

async function waitForStreamCount(
  streams: Array<{ path: string; query?: Record<string, string> }>,
  count: number,
): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (streams.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function selectTaskForTest(taskID: string): void {
  setBoardStore("selectedTaskID", taskID);
  setBoardStore("selectedSource", taskID ? { kind: "task", id: taskID } : null);
}

afterEach(() => {
  __setHostTransportForTest(undefined);
  resetSelectedLiveCursor();
  selectTaskForTest("");
  setBoardStore("board", null);
  setBoardStore("boardSyncPending", false);
  setBoardStore("taskSequence", 0);
  setAppStore({
    config: null,
    providerCatalog: null,
    providerAuth: null,
    configLoadErrors: {},
    channels: [],
    promptEntries: [],
  });
});

test("selected-task message events update card tree without board refresh", () => {
  resetWriter();
  selectTaskForTest("tsk_refresh");
  setBoardStore("board", {
    snapshotVersion: "board:refresh",
    task: {
      id: "tsk_refresh",
      sessionID: "ses_refresh",
      status: "active",
      request: "refresh",
      time: { created: 1_776_000_100_000 },
      attachments: [],
    },
  });
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
  expect(boardStore.boardSyncPending).toBe(false);
});

test("selected-task message events advance the visible cursor without recovery", async () => {
  resetWriter();
  const streams: Array<{ path: string; query?: Record<string, string> }> = [];
  __setHostTransportForTest(fakeRecoveryTransport(streams, 9));
  selectTaskForTest("tsk_refresh");
  setBoardStore("taskSequence", 5);
  setBoardStore("board", {
    snapshotVersion: "board:refresh",
    task: {
      id: "tsk_refresh",
      sessionID: "ses_refresh",
      status: "active",
      request: "refresh",
      time: { created: 1_776_000_100_000 },
      attachments: [],
    },
  });
  expect(routeSSEEvent({
    type: "message.updated",
    taskID: "tsk_refresh",
    sequence: 6,
    properties: {
      info: {
        id: "msg_refresh_seq",
        sessionID: "ses_refresh",
        role: "assistant",
        resolvedRole: "assistant",
        channel: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_200_000 },
      },
    },
  })).toBe(true);
  expect(boardStore.taskSequence).toBe(6);

  expect(routeSSEEvent({
    type: "message.part.updated",
    taskID: "tsk_refresh",
    sequence: 7,
    properties: {
      part: {
        id: "part_refresh_seq",
        messageID: "msg_refresh_seq",
        sessionID: "ses_refresh",
        resolvedRole: "assistant",
        channel: "assistant",
        type: "text",
        text: "hello",
      },
    },
  })).toBe(true);
  expect(boardStore.taskSequence).toBe(7);

  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(streams).toEqual([]);
});

test("selected-task protocol task_id envelope advances the visible cursor", async () => {
  resetWriter();
  const streams: Array<{ path: string; query?: Record<string, string> }> = [];
  __setHostTransportForTest(fakeRecoveryTransport(streams, 9));
  selectTaskForTest("tsk_refresh");
  setBoardStore("taskSequence", 5);
  setBoardStore("board", {
    snapshotVersion: "board:refresh",
    task: {
      id: "tsk_refresh",
      sessionID: "ses_refresh",
      status: "active",
      request: "refresh",
      time: { created: 1_776_000_100_000 },
      attachments: [],
    },
  });
  expect(routeSSEEvent({
    type: "message.updated",
    task_id: "tsk_refresh",
    sequence: 6,
    properties: {
      info: {
        id: "msg_snake_seq",
        sessionID: "ses_refresh",
        role: "assistant",
        resolvedRole: "assistant",
        channel: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_200_000 },
      },
    },
  })).toBe(true);
  expect(boardStore.taskSequence).toBe(6);

  expect(routeSSEEvent({
    type: "message.part.updated",
    task_id: "tsk_refresh",
    sequence: 7,
    properties: {
      part: {
        id: "part_snake_seq",
        messageID: "msg_snake_seq",
        sessionID: "ses_refresh",
        resolvedRole: "assistant",
        channel: "assistant",
        type: "text",
        text: "hello",
      },
    },
  })).toBe(true);
  expect(boardStore.taskSequence).toBe(7);

  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(streams).toEqual([]);
});

test("selected-task part removal updates the card tree in real time", () => {
  resetWriter();
  selectTaskForTest("tsk_refresh");
  setBoardStore("taskSequence", 7);
  setBoardStore("board", {
    snapshotVersion: "board:refresh",
    task: {
      id: "tsk_refresh",
      sessionID: "ses_refresh",
      status: "active",
      request: "refresh",
      time: { created: 1_776_000_100_000 },
      attachments: [],
    },
  });
  expect(routeSSEEvent({
    type: "message.updated",
    task_id: "tsk_refresh",
    sequence: 8,
    properties: {
      info: {
        id: "msg_remove_part",
        sessionID: "ses_refresh",
        role: "assistant",
        resolvedRole: "assistant",
        channel: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_200_000 },
      },
    },
  })).toBe(true);
  expect(routeSSEEvent({
    type: "message.part.updated",
    task_id: "tsk_refresh",
    sequence: 9,
    properties: {
      part: {
        id: "part_remove_me",
        messageID: "msg_remove_part",
        sessionID: "ses_refresh",
        resolvedRole: "assistant",
        channel: "assistant",
        type: "text",
        text: "remove me",
      },
    },
  })).toBe(true);

  const cardID = "assistant:session:ses_refresh:message:msg_remove_part";
  expect(cardTreeStore.cards[cardID]?.parts).toHaveLength(1);

  expect(routeSSEEvent({
    type: "message.part.removed",
    task_id: "tsk_refresh",
    sequence: 10,
    properties: {
      sessionID: "ses_refresh",
      messageID: "msg_remove_part",
      partID: "part_remove_me",
    },
  })).toBe(true);

  expect(cardTreeStore.cards[cardID]?.parts).toEqual([]);
  expect(boardStore.taskSequence).toBe(10);
});

test("selected-task message removal removes its visible card in real time", () => {
  resetWriter();
  selectTaskForTest("tsk_refresh");
  setBoardStore("taskSequence", 3);
  setBoardStore("board", {
    snapshotVersion: "board:refresh",
    task: {
      id: "tsk_refresh",
      sessionID: "ses_refresh",
      status: "active",
      request: "refresh",
      time: { created: 1_776_000_100_000 },
      attachments: [],
    },
  });

  expect(routeSSEEvent({
    type: "message.updated",
    task_id: "tsk_refresh",
    sequence: 4,
    properties: {
      info: {
        id: "msg_remove_all",
        sessionID: "ses_refresh",
        role: "assistant",
        resolvedRole: "assistant",
        channel: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_200_000 },
      },
    },
  })).toBe(true);
  expect(routeSSEEvent({
    type: "message.part.updated",
    task_id: "tsk_refresh",
    sequence: 5,
    properties: {
      part: {
        id: "part_remove_all",
        messageID: "msg_remove_all",
        sessionID: "ses_refresh",
        resolvedRole: "assistant",
        channel: "assistant",
        type: "text",
        text: "remove card",
      },
    },
  })).toBe(true);

  const cardID = "assistant:session:ses_refresh:message:msg_remove_all";
  expect(cardTreeStore.cards[cardID]).toBeDefined();

  expect(routeSSEEvent({
    type: "message.removed",
    task_id: "tsk_refresh",
    sequence: 6,
    properties: {
      sessionID: "ses_refresh",
      messageID: "msg_remove_all",
    },
  })).toBe(true);

  expect(cardTreeStore.cards[cardID]).toBeUndefined();
  expect(boardStore.taskSequence).toBe(6);
});

test("selected-task message payload is still applied when board cursor is ahead", () => {
  resetWriter();
  selectTaskForTest("tsk_refresh");
  setBoardStore("taskSequence", 10);
  setBoardStore("board", {
    snapshotVersion: "board:refresh",
    task: {
      id: "tsk_refresh",
      sessionID: "ses_refresh",
      status: "active",
      request: "refresh",
      time: { created: 1_776_000_100_000 },
      attachments: [],
    },
  });

  expect(routeSSEEvent({
    type: "message.updated",
    task_id: "tsk_refresh",
    sequence: 7,
    properties: {
      info: {
        id: "msg_late_payload",
        sessionID: "ses_refresh",
        role: "assistant",
        resolvedRole: "assistant",
        channel: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_200_000 },
      },
    },
  })).toBe(true);

  expect(boardStore.taskSequence).toBe(10);
  expect(cardTreeStore.cards["assistant:session:ses_refresh:message:msg_late_payload"]).toBeDefined();
});

test("board-owned run progress advances selected-task cursor", async () => {
  resetWriter();
  const streams: Array<{ path: string; query?: Record<string, string> }> = [];
  __setHostTransportForTest(fakeRecoveryTransport(streams, 9));
  selectTaskForTest("tsk_refresh");
  setBoardStore("taskSequence", 5);
  setBoardStore("board", {
    snapshotVersion: "board:refresh",
    task: {
      id: "tsk_refresh",
      sessionID: "ses_refresh",
      status: "active",
      request: "refresh",
      time: { created: 1_776_000_100_000 },
      attachments: [],
    },
  });

  expect(routeSSEEvent({
    type: "run.progress",
    task_id: "tsk_refresh",
    sequence: 6,
    properties: { type: "executor.status", status: "running" },
  })).toBe(true);
  expect(boardStore.taskSequence).toBe(6);

  expect(routeSSEEvent({
    type: "message.updated",
    task_id: "tsk_refresh",
    sequence: 7,
    properties: {
      info: {
        id: "msg_after_run_progress",
        sessionID: "ses_refresh",
        role: "assistant",
        resolvedRole: "assistant",
        channel: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_200_000 },
      },
    },
  })).toBe(true);
  expect(boardStore.taskSequence).toBe(7);

  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(streams).toEqual([]);
});

test("message delta with missing tree prerequisites triggers selected-task recovery", async () => {
  resetWriter();
  const streams: Array<{ path: string; query?: Record<string, string> }> = [];
  __setHostTransportForTest(fakeRecoveryTransport(streams));
  selectTaskForTest("tsk_refresh");
  setBoardStore("board", {
    snapshotVersion: "board:refresh",
    task: {
      id: "tsk_refresh",
      sessionID: "ses_refresh",
      status: "active",
      request: "refresh",
      time: { created: 1_776_000_100_000 },
      attachments: [],
    },
  });
  const treeEpoch = cardTreeStore.treeEpoch;

  expect(routeSSEEvent({
    type: "message.part.delta",
    properties: {
      sessionID: "ses_missing",
      messageID: "msg_missing",
      partID: "part_missing",
      field: "text",
      delta: "lost",
    },
  })).toBe(true);

  await waitForStreamCount(streams, 1);
  expect(cardTreeStore.treeEpoch).toBe(treeEpoch);
  expect(streams).toEqual([
    { path: "task/tsk_refresh/events", query: { after_live: "0" } },
  ]);
});

test("board-owned run progress still schedules board refresh", () => {
  resetWriter();
  setBoardStore("boardSyncPending", false);

  expect(routeSSEEvent({
    type: "run.progress",
    properties: { type: "executor.status", status: "running" },
  })).toBe(true);

  expect(boardStore.boardSyncPending).toBe(true);
});

test("selected-task session status updates cards without board refresh", () => {
  resetWriter();
  selectTaskForTest("tsk_refresh");
  setBoardStore("boardSyncPending", false);
  setBoardStore("board", {
    snapshotVersion: "board:refresh",
    task: {
      id: "tsk_refresh",
      sessionID: "ses_refresh",
      status: "active",
      request: "refresh",
      time: { created: 1_776_000_100_000 },
      attachments: [],
    },
  });

  const event = {
    type: "session.status",
    taskID: "tsk_refresh",
    sequence: 6,
    properties: {
      taskID: "tsk_refresh",
      sessionID: "ses_refresh",
      status: { type: "streaming" },
    },
  };
  const handled = routeSSEEvent(event);
  if (!handled) handleEventStreamEvent(event);

  expect(boardStore.boardSyncPending).toBe(false);
  expect(boardStore.taskSequence).toBe(6);
});

test("task-list session status notification does not refresh selected board", () => {
  resetWriter();
  selectTaskForTest("tsk_refresh");
  setBoardStore("boardSyncPending", false);
  setBoardStore("taskSequence", 5);

  handleTaskListNotification({
    type: "session.status",
    taskID: "tsk_refresh",
    sequence: 6,
  });

  expect(boardStore.boardSyncPending).toBe(false);
  expect(boardStore.taskSequence).toBe(5);
});

test("consumed sequenced run progress advances selected cursor and avoids false recovery", async () => {
  resetWriter();
  const streams: Array<{ path: string; query?: Record<string, string> }> = [];
  __setHostTransportForTest(fakeRecoveryTransport(streams, 9));
  selectTaskForTest("tsk_refresh");
  setBoardStore("taskSequence", 5);

  expect(routeSSEEvent({
    type: "run.progress",
    taskID: "tsk_refresh",
    sequence: 6,
    properties: {
      type: "executor.status",
      taskID: "tsk_refresh",
      status: "running",
    },
  })).toBe(true);

  expect(boardStore.taskSequence).toBe(6);

  const event = {
    type: "goal.progress",
    taskID: "tsk_refresh",
    sequence: 7,
  };
  const handled = routeSSEEvent(event);
  if (!handled) handleEventStreamEvent(event);

  expect(boardStore.taskSequence).toBe(7);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(streams).toEqual([]);
});

test("consumed sequenced run output advances selected cursor and avoids false recovery", async () => {
  resetWriter();
  const streams: Array<{ path: string; query?: Record<string, string> }> = [];
  __setHostTransportForTest(fakeRecoveryTransport(streams, 9));
  selectTaskForTest("tsk_refresh");
  setBoardStore("taskSequence", 5);

  expect(routeSSEEvent({
    type: "run.output",
    taskID: "tsk_refresh",
    event_id: "evt_output_1",
    sequence: 6,
    summary: "partial output",
    properties: {
      taskID: "tsk_refresh",
      runID: "run_refresh",
      sessionID: "ses_refresh",
      text: "partial output",
    },
  })).toBe(true);

  expect(boardStore.taskSequence).toBe(6);

  const event = {
    type: "goal.progress",
    taskID: "tsk_refresh",
    sequence: 7,
  };
  const handled = routeSSEEvent(event);
  if (!handled) handleEventStreamEvent(event);

  expect(boardStore.taskSequence).toBe(7);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(streams).toEqual([]);
});

test("consumed sequenced task rewound advances selected cursor and avoids false recovery", async () => {
  resetWriter();
  const streams: Array<{ path: string; query?: Record<string, string> }> = [];
  __setHostTransportForTest(fakeRecoveryTransport(streams, 9));
  selectTaskForTest("tsk_refresh");
  setBoardStore("taskSequence", 5);

  expect(routeSSEEvent({
    type: "task.rewound",
    taskID: "tsk_refresh",
    sequence: 6,
    properties: {
      taskID: "tsk_refresh",
      cursorTime: 1_776_000_100_000,
      resetWorktree: false,
    },
  })).toBe(true);

  expect(boardStore.taskSequence).toBe(6);

  const event = {
    type: "goal.progress",
    taskID: "tsk_refresh",
    sequence: 7,
  };
  const handled = routeSSEEvent(event);
  if (!handled) handleEventStreamEvent(event);

  expect(boardStore.taskSequence).toBe(7);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(streams).toEqual([]);
});

test("selected task sequence gap triggers recovery without advancing cursor", async () => {
  resetWriter();
  const streams: Array<{ path: string; query?: Record<string, string> }> = [];
  __setHostTransportForTest(fakeRecoveryTransport(streams, 9));
  selectTaskForTest("tsk_refresh");
  setBoardStore("taskSequence", 5);

  handleEventStreamEvent({
    type: "goal.progress",
    taskID: "tsk_refresh",
    sequence: 7,
  });

  expect(boardStore.taskSequence).toBe(5);
  await waitForStreamCount(streams, 1);
  expect(streams).toEqual([
    { path: "task/tsk_refresh/events", query: { after: "5", after_live: "0" } },
  ]);
  expect(boardStore.taskSequence).toBe(5);
});

test("production dispatch gates sequence gap before tree writer prerequisites can throw", async () => {
  resetWriter();
  const streams: Array<{ path: string; query?: Record<string, string> }> = [];
  __setHostTransportForTest(fakeRecoveryTransport(streams, 12));
  selectTaskForTest("tsk_refresh");
  setBoardStore("taskSequence", 5);

  const event = {
    type: "review.stream.chunk",
    taskID: "tsk_refresh",
    sequence: 7,
    properties: {
      taskID: "tsk_refresh",
      reviewID: "integrity:missing-started",
      phase: "integrity",
      kind: "dimension",
      dimensionID: "missing-started",
      delta: "would throw if routed before gap recovery",
    },
  };
  const handled = routeSSEEvent(event);
  if (!handled) handleEventStreamEvent(event);

  expect(boardStore.taskSequence).toBe(5);
  await waitForStreamCount(streams, 1);
  expect(streams).toEqual([
    { path: "task/tsk_refresh/events", query: { after: "5", after_live: "0" } },
  ]);
  expect(boardStore.taskSequence).toBe(5);
});

test("task-list notification does not advance visible cursor before per-task payload", async () => {
  resetWriter();
  const streams: Array<{ path: string; query?: Record<string, string> }> = [];
  __setHostTransportForTest(fakeRecoveryTransport(streams, 13));
  selectTaskForTest("tsk_refresh");
  setBoardStore("taskSequence", 5);

  handleTaskListNotification({
    type: "message.part.delta",
    taskID: "tsk_refresh",
    sequence: 6,
  });
  expect(boardStore.taskSequence).toBe(5);

  const event = {
    type: "review.stream.chunk",
    taskID: "tsk_refresh",
    sequence: 7,
    properties: {
      taskID: "tsk_refresh",
      reviewID: "integrity:missing-started",
      phase: "integrity",
      kind: "dimension",
      dimensionID: "missing-started",
      delta: "would throw if task-list advanced the cursor",
    },
  };
  const handled = routeSSEEvent(event);
  if (!handled) handleEventStreamEvent(event);

  expect(boardStore.taskSequence).toBe(5);
  await waitForStreamCount(streams, 1);
  expect(streams).toEqual([
    { path: "task/tsk_refresh/events", query: { after: "5", after_live: "0" } },
  ]);
  expect(boardStore.taskSequence).toBe(5);
});

test("task-list selected sequence gap triggers selected-task recovery", async () => {
  resetWriter();
  const streams: Array<{ path: string; query?: Record<string, string> }> = [];
  __setHostTransportForTest(fakeRecoveryTransport(streams, 10));
  selectTaskForTest("tsk_refresh");
  setBoardStore("taskSequence", 5);

  handleTaskListNotification({
    type: "message.part.delta",
    taskID: "tsk_refresh",
    sequence: 8,
  });

  expect(boardStore.taskSequence).toBe(5);
  await waitForStreamCount(streams, 1);
  expect(streams).toEqual([
    { path: "task/tsk_refresh/events", query: { after: "5", after_live: "0" } },
  ]);
  expect(boardStore.taskSequence).toBe(5);
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

test("task-list reloads are single-flight across refresh triggers", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const paths: string[] = [];
  const transport = {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      paths.push(req.path);
      await pending;
      return { status: 200, ok: true, headers: {}, body: { tasks: [] } as T };
    },
    openStream() {
      throw new Error("openStream not used");
    },
    async native() {
      throw new Error("native not used");
    },
    subscribeUiCommand() {
      return { unsubscribe() {} };
    },
  } satisfies HostTransport;
  __setHostTransportForTest(transport);

  const first = loadTasks();
  const second = loadTasks();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(paths).toEqual(["global/tasks"]);

  release();
  await Promise.all([first, second]);
});

test("config.changed SSE burst coalesces into one config refresh", async () => {
  resetWriter();
  const paths: string[] = [];
  __setHostTransportForTest(fakeConfigTransport(paths));
  const beforeToken = sessionConfigRefreshToken();

  expect(routeSSEEvent({ type: "config.changed" })).toBe(true);
  expect(routeSSEEvent({ type: "config.changed" })).toBe(true);
  expect(routeSSEEvent({ type: "config.changed" })).toBe(true);
  expect(sessionConfigRefreshToken()).toBe(beforeToken + 3);

  await new Promise((resolve) => setTimeout(resolve, 90));

  expect(paths.filter((path) => path === "config").length).toBe(1);
  expect(appStore.config).toEqual({ model: "openai/coalesced" });
});

test("session.updated invalidates session config resources", () => {
  const beforeSession = sessionConfigRefreshToken();
  expect(routeSSEEvent({
    type: "session.updated",
    properties: {
      info: {
        id: "ses_config_refresh",
      },
    },
  })).toBe(true);
  expect(sessionConfigRefreshToken()).toBe(beforeSession + 1);
});

test("session.diff SSE is consumed without card or board refresh", () => {
  resetWriter();
  selectTaskForTest("tsk_session_diff");
  setBoardStore("board", {
    snapshotVersion: "board:session-diff",
    task: {
      id: "tsk_session_diff",
      sessionID: "ses_session_diff",
      status: "active",
      request: "session diff",
      time: { created: 1_776_000_100_000 },
      attachments: [],
    },
  });
  const beforeOrder = [...cardTreeStore.order];
  const beforeCards = Object.keys(cardTreeStore.cards);

  expect(routeSSEEvent({
    event_id: "ephemeral-session-diff",
    session_id: "ses_session_diff",
    type: "session.diff",
    emittedAt: 1_780_163_309_731,
    timestamp: 1_780_163_309_731,
    sequence: 0,
    summary: "session.diff",
    payload: {
      sessionID: "ses_session_diff",
      diff: [],
      summary: "session.diff",
    },
  })).toBe(true);

  expect(cardTreeStore.order).toEqual(beforeOrder);
  expect(Object.keys(cardTreeStore.cards)).toEqual(beforeCards);
  expect(boardStore.boardSyncPending).toBe(false);
});
