import { afterEach, expect, test } from "bun:test";
import { setBoardStore } from "../src/store/board";
import { recoverSelectedTaskConversation } from "../src/services/selected-task-recovery";
import { startSSE, stopSSE } from "../src/services/sse";
import {
  __setHostTransportForTest,
  type HostTransport,
  type StreamHandlers,
  type StreamOpenRequest,
  type TransportRequest,
  type TransportResponse,
} from "../src/services/host-transport";
import { resetWriter } from "../src/services/tree-writer";

function conversationBody(taskID: string, sequence: number) {
  return {
    board: {
      task: {
        id: taskID,
        status: "active",
        request: "recover",
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
    view: { sessions: [] },
    eventReplay: { cursor: sequence, latestSequence: sequence, complete: true, limit: 10 },
    lastSequence: sequence,
  };
}

function fakeTransport(opts: {
  request: (req: TransportRequest) => Promise<TransportResponse<unknown>> | TransportResponse<unknown>;
  streams?: StreamOpenRequest[];
  closeCalls?: { count: number };
}): HostTransport {
  return {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      return opts.request(req) as Promise<TransportResponse<T>> | TransportResponse<T>;
    },
    openStream(input: StreamOpenRequest, handlers: StreamHandlers) {
      opts.streams?.push(input);
      return {
        close() {
          if (opts.closeCalls) opts.closeCalls.count += 1;
          handlers.onClose?.("test-close");
        },
      };
    },
    async native() {
      throw new Error("native not used in selected-task recovery tests");
    },
    subscribeUiCommand() {
      return { unsubscribe() {} };
    },
  } satisfies HostTransport;
}

afterEach(() => {
  stopSSE();
  __setHostTransportForTest(undefined);
  resetWriter();
  setBoardStore("selectedTaskID", "");
  setBoardStore("board", null);
});

test("selected-task recovery stops the old stream, hydrates, then resumes from hydrated sequence", async () => {
  const streams: StreamOpenRequest[] = [];
  const closeCalls = { count: 0 };
  __setHostTransportForTest(
    fakeTransport({
      streams,
      closeCalls,
      request(req) {
        if (req.path === "task/tsk_atomic/conversation") {
          return { status: 200, ok: true, headers: {}, body: conversationBody("tsk_atomic", 9) };
        }
        throw new Error(`unexpected request path: ${req.path}`);
      },
    }),
  );
  setBoardStore("selectedTaskID", "tsk_atomic");

  startSSE("tsk_atomic", 3);
  expect(streams).toEqual([
    { path: "task/tsk_atomic/events", query: { after: "3" } },
  ]);

  await expect(recoverSelectedTaskConversation("test atomic recovery", "tsk_atomic")).resolves.toBe(9);

  expect(closeCalls.count).toBe(1);
  expect(streams).toEqual([
    { path: "task/tsk_atomic/events", query: { after: "3" } },
    { path: "task/tsk_atomic/events", query: { after: "9" } },
  ]);
});

test("selected-task recovery does not mutate or restart after task switch during hydrate", async () => {
  let releaseConversation!: () => void;
  const conversationReleased = new Promise<void>((resolve) => {
    releaseConversation = resolve;
  });
  let requestStarted!: () => void;
  const requestSeen = new Promise<void>((resolve) => {
    requestStarted = resolve;
  });
  const streams: StreamOpenRequest[] = [];

  __setHostTransportForTest(
    fakeTransport({
      streams,
      async request(req) {
        if (req.path !== "task/tsk_stale/conversation") {
          throw new Error(`unexpected request path: ${req.path}`);
        }
        requestStarted();
        await conversationReleased;
        return { status: 200, ok: true, headers: {}, body: conversationBody("tsk_stale", 4) };
      },
    }),
  );
  setBoardStore("selectedTaskID", "tsk_stale");

  const recovery = recoverSelectedTaskConversation("test stale recovery", "tsk_stale");
  await requestSeen;
  setBoardStore("selectedTaskID", "tsk_new");
  releaseConversation();

  await expect(recovery).rejects.toMatchObject({ name: "AbortError" });
  expect(streams).toEqual([]);
});

test("stale scheduled recovery does not stop the newly selected task stream", async () => {
  const streams: StreamOpenRequest[] = [];
  const closeCalls = { count: 0 };
  __setHostTransportForTest(
    fakeTransport({
      streams,
      closeCalls,
      request(req) {
        throw new Error(`stale recovery must not request ${req.path}`);
      },
    }),
  );
  setBoardStore("selectedTaskID", "tsk_new");

  startSSE("tsk_new", 11);
  await expect(recoverSelectedTaskConversation("stale delayed recovery", "tsk_old"))
    .rejects.toMatchObject({ name: "AbortError" });

  expect(closeCalls.count).toBe(0);
  expect(streams).toEqual([
    { path: "task/tsk_new/events", query: { after: "11" } },
  ]);
});
