import { afterEach, expect, mock, test } from "bun:test";
import { routeSSEEvent, handleEventStreamEvent, handleTaskListNotification } from "../src/services/events";
import { boardStore, loadTasks, setBoardStore } from "../src/store/board";
import { appStore, setAppStore } from "../src/store/app";
import { resetWriter } from "../src/services/tree-writer";
import {
  __setHostTransportForTest,
  type HostTransport,
  type TransportRequest,
  type TransportResponse,
} from "../src/services/host-transport";

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
  sequence = 6,
): HostTransport {
  return {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      if (req.path === "global/tasks") {
        return { status: 200, ok: true, headers: {}, body: { tasks: [] } as T };
      }
      if (req.path === "task/tsk_refresh/conversation") {
        return {
          status: 200,
          ok: true,
          headers: {},
          body: {
            board: {
              task: {
                id: "tsk_refresh",
                sessionID: "ses_refresh",
                status: "active",
                request: "refresh",
                time: { created: 1_776_000_100_000 },
                attachments: [],
              },
              goalWorkflows: [],
              interactions: [],
            },
            transcript: [],
            timeline: [],
            events: [],
            view: { sessions: [] },
            eventReplay: { cursor: sequence, latestSequence: sequence, complete: true, limit: 10 },
            lastSequence: sequence,
          } as T,
        };
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

afterEach(() => {
  __setHostTransportForTest(undefined);
  setBoardStore("selectedTaskID", "");
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
  setBoardStore("selectedTaskID", "tsk_refresh");
  setBoardStore("board", {
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

test("message delta with missing tree prerequisites triggers selected-task recovery", async () => {
  resetWriter();
  const streams: Array<{ path: string; query?: Record<string, string> }> = [];
  __setHostTransportForTest(fakeRecoveryTransport(streams));
  setBoardStore("selectedTaskID", "tsk_refresh");
  setBoardStore("board", {
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
    type: "message.part.delta",
    properties: {
      sessionID: "ses_missing",
      messageID: "msg_missing",
      partID: "part_missing",
      field: "text",
      delta: "lost",
    },
  })).toBe(true);

  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(streams).toEqual([
    { path: "task/tsk_refresh/events", query: { after: "6" } },
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

test("consumed sequenced run progress advances selected cursor and avoids false recovery", async () => {
  resetWriter();
  const streams: Array<{ path: string; query?: Record<string, string> }> = [];
  __setHostTransportForTest(fakeRecoveryTransport(streams, 9));
  setBoardStore("selectedTaskID", "tsk_refresh");
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
    type: "goal.updated",
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
  setBoardStore("selectedTaskID", "tsk_refresh");
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
    type: "goal.updated",
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
  setBoardStore("selectedTaskID", "tsk_refresh");
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
    type: "goal.updated",
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
  setBoardStore("selectedTaskID", "tsk_refresh");
  setBoardStore("taskSequence", 5);

  handleEventStreamEvent({
    type: "goal.updated",
    taskID: "tsk_refresh",
    sequence: 7,
  });

  expect(boardStore.taskSequence).toBe(5);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(streams).toEqual([
    { path: "task/tsk_refresh/events", query: { after: "9" } },
  ]);
  expect(boardStore.taskSequence).toBe(9);
});

test("production dispatch gates sequence gap before tree writer prerequisites can throw", async () => {
  resetWriter();
  const streams: Array<{ path: string; query?: Record<string, string> }> = [];
  __setHostTransportForTest(fakeRecoveryTransport(streams, 12));
  setBoardStore("selectedTaskID", "tsk_refresh");
  setBoardStore("taskSequence", 5);

  const event = {
    type: "integrity.review.chunk",
    taskID: "tsk_refresh",
    sequence: 7,
    properties: {
      taskID: "tsk_refresh",
      kind: "dimension",
      dimensionID: "missing-started",
      delta: "would throw if routed before gap recovery",
    },
  };
  const handled = routeSSEEvent(event);
  if (!handled) handleEventStreamEvent(event);

  expect(boardStore.taskSequence).toBe(5);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(streams).toEqual([
    { path: "task/tsk_refresh/events", query: { after: "12" } },
  ]);
  expect(boardStore.taskSequence).toBe(12);
});

test("task-list notification does not advance visible cursor before per-task payload", async () => {
  resetWriter();
  const streams: Array<{ path: string; query?: Record<string, string> }> = [];
  __setHostTransportForTest(fakeRecoveryTransport(streams, 13));
  setBoardStore("selectedTaskID", "tsk_refresh");
  setBoardStore("taskSequence", 5);

  handleTaskListNotification({
    type: "message.part.delta",
    taskID: "tsk_refresh",
    sequence: 6,
  });
  expect(boardStore.taskSequence).toBe(5);

  const event = {
    type: "integrity.review.chunk",
    taskID: "tsk_refresh",
    sequence: 7,
    properties: {
      taskID: "tsk_refresh",
      kind: "dimension",
      dimensionID: "missing-started",
      delta: "would throw if task-list advanced the cursor",
    },
  };
  const handled = routeSSEEvent(event);
  if (!handled) handleEventStreamEvent(event);

  expect(boardStore.taskSequence).toBe(5);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(streams).toEqual([
    { path: "task/tsk_refresh/events", query: { after: "13" } },
  ]);
  expect(boardStore.taskSequence).toBe(13);
});

test("task-list selected sequence gap triggers selected-task recovery", async () => {
  resetWriter();
  const streams: Array<{ path: string; query?: Record<string, string> }> = [];
  __setHostTransportForTest(fakeRecoveryTransport(streams, 10));
  setBoardStore("selectedTaskID", "tsk_refresh");
  setBoardStore("taskSequence", 5);

  handleTaskListNotification({
    type: "message.part.delta",
    taskID: "tsk_refresh",
    sequence: 8,
  });

  expect(boardStore.taskSequence).toBe(5);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(streams).toEqual([
    { path: "task/tsk_refresh/events", query: { after: "10" } },
  ]);
  expect(boardStore.taskSequence).toBe(10);
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

  expect(routeSSEEvent({ type: "config.changed" })).toBe(true);
  expect(routeSSEEvent({ type: "config.changed" })).toBe(true);
  expect(routeSSEEvent({ type: "config.changed" })).toBe(true);

  await new Promise((resolve) => setTimeout(resolve, 90));

  expect(paths.filter((path) => path === "config").length).toBe(1);
  expect(appStore.config).toEqual({ model: "openai/coalesced" });
});
