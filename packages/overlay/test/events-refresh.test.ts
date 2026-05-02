import { afterEach, expect, mock, test } from "bun:test";
import { routeSSEEvent, handleTaskListNotification } from "../src/services/events";
import { boardStore, setBoardStore } from "../src/store/board";
import { appStore, setAppStore } from "../src/store/app";
import { resetWriter } from "../src/services/tree-writer";
import {
  __setHostTransportForTest,
  type HostTransport,
  type TransportRequest,
  type TransportResponse,
} from "../src/services/host-transport";

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

afterEach(() => {
  __setHostTransportForTest(undefined);
  setAppStore({
    config: null,
    providerCatalog: null,
    providerAuth: null,
    configLoadErrors: {},
    channels: [],
    promptEntries: [],
  });
});

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
