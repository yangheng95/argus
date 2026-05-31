import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { apiUrl, configure } from "../src/services/api";
import { __setHostTransportForTest, type HostTransport } from "../src/services/host-transport";
import { boardStore, setBoardStore } from "../src/store/board";
import { setSettingsStore } from "../src/store/settings";

mock.module("../src/services/conversation", () => ({
  cancelConversationReplay: () => undefined,
  hydrateTaskConversation: async () => 0,
}));

mock.module("../src/services/sse", () => ({
  isSelectedTaskSSEConnected: () => false,
  startSSE: () => undefined,
  startTaskListSSE: () => undefined,
  stopSSE: () => undefined,
  stopTaskListSSE: () => undefined,
}));

const { restoreInitialWorkspace } = await import("../src/services/init");

function fakeTransport(): HostTransport {
  return {
    kind: "tauri",
    async request() {
      return { status: 200, ok: true, headers: {}, body: null };
    },
    openStream() {
      return { close() {} };
    },
    async native() {
      return true;
    },
    subscribeUiCommand() {
      return { unsubscribe() {} };
    },
  } satisfies HostTransport;
}

describe("initial workspace restore directory sync", () => {
  beforeEach(() => {
    __setHostTransportForTest(fakeTransport());
    configure({
      serverUrl: "http://127.0.0.1:7878",
      directory: "D:/projects/old",
    });
    setSettingsStore({
      directory: "D:/projects/old",
      savedDirectory: "D:/projects/old",
      workspaceDirectory: "D:/projects/new",
      workspaceTaskID: "tsk_saved",
      workspaceEpoch: 0,
      directoryEpoch: 0,
    });
    setBoardStore({
      board: null,
      tasks: [
        {
          task: {
            id: "tsk_saved",
            status: "active",
            directory: "D:/projects/new",
          },
          pending_interactions: 0,
        },
      ],
      pendingTasks: [],
      selectedSource: null,
      taskSwitching: false,
      selectEpoch: 0,
    });
  });

  afterEach(() => {
    __setHostTransportForTest(undefined);
    configure({ directory: "" });
    setSettingsStore({
      directory: "",
      savedDirectory: "",
      workspaceDirectory: "",
      workspaceTaskID: "",
      workspaceEpoch: 0,
      directoryEpoch: 0,
    });
    setBoardStore({
      board: null,
      tasks: [],
      pendingTasks: [],
      selectedSource: null,
      taskSwitching: false,
      selectEpoch: 0,
    });
  });

  test("retargets the API client before selecting a restored cross-project task", async () => {
    await expect(restoreInitialWorkspace()).resolves.toBe(true);

    expect(boardStore.selectedSource).toEqual({ kind: "task", id: "tsk_saved" });
    expect(new URL(apiUrl("agent")).searchParams.get("directory")).toBe("D:/projects/new");
  });
});
