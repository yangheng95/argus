import { afterEach, expect, test } from "bun:test";
(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test";

import type {
  HostTransport,
  StreamHandlers,
  StreamOpenRequest,
  TransportRequest,
  TransportResponse,
} from "../src/services/host-transport";

const { setBoardStore } = await import("../src/store/board");
const { cardTreeStore } = await import("../src/store/card-tree");
const { recoverSelectedTaskConversation } = await import("../src/services/selected-task-recovery");
const { routeSSEEvent, handleEventStreamEvent } = await import("../src/services/events");
const { startSSE, stopSSE } = await import("../src/services/sse");
const { __setHostTransportForTest } = await import("../src/services/host-transport");
const { resetWriter } = await import("../src/services/tree-writer");
const { resetSelectedLiveCursor } = await import("../src/services/selected-stream-cursor");
const {
  __resetConversationRecoveryDiagnosticsSinkForTest,
  __setConversationRecoveryDiagnosticsSinkForTest,
} = await import("../src/services/refresh-diagnostics");

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
  __resetConversationRecoveryDiagnosticsSinkForTest();
  resetWriter();
  resetSelectedLiveCursor();
  setBoardStore("selectedTaskID", "");
  setBoardStore("taskSequence", 0);
  setBoardStore("board", null);
});

test("selected-task recovery resumes with the consumed live cursor", async () => {
  const streams: StreamOpenRequest[] = [];
  __setHostTransportForTest(
    fakeTransport({
      streams,
      request(req) {
        throw new Error(`selected-task recovery must not hydrate ${req.path}`);
      },
    }),
  );
  setBoardStore("selectedTaskID", "tsk_live");
  setBoardStore("taskSequence", 12);
  setBoardStore("board", {
    snapshotVersion: "board:live",
    task: {
      id: "tsk_live",
      sessionID: "ses_live",
      status: "active",
      request: "live",
      time: { created: 1_776_000_100_000 },
      attachments: [],
    },
  });

  expect(routeSSEEvent({
    type: "message.updated",
    task_id: "tsk_live",
    sequence: 0,
    live_sequence: 7,
    live_epoch: 1776,
    properties: {
      info: {
        id: "msg_live",
        sessionID: "ses_live",
        role: "assistant",
        resolvedRole: "assistant",
        channel: "assistant",
        agent: "assistant",
        time: { created: 1_776_000_200_000 },
      },
    },
  })).toBe(true);

  await expect(recoverSelectedTaskConversation("test live cursor recovery", "tsk_live")).resolves.toBe(12);

  expect(streams).toEqual([
    {
      path: "task/tsk_live/events",
      query: { after: "12", after_live: "7", after_live_epoch: "1776" },
    },
  ]);
});

test("selected-task recovery advances the live cursor for non-message selected events", async () => {
  const streams: StreamOpenRequest[] = [];
  __setHostTransportForTest(
    fakeTransport({
      streams,
      request(req) {
        throw new Error(`selected-task recovery must not hydrate ${req.path}`);
      },
    }),
  );
  setBoardStore("selectedTaskID", "tsk_live_non_message");
  setBoardStore("taskSequence", 12);

  expect(routeSSEEvent({
    type: "session.updated",
    task_id: "tsk_live_non_message",
    sequence: 0,
    live_sequence: 8,
    live_epoch: 1777,
    properties: { sessionID: "ses_live_non_message" },
  })).toBe(true);

  await expect(recoverSelectedTaskConversation("test live cursor recovery", "tsk_live_non_message")).resolves.toBe(12);

  expect(streams).toEqual([
    {
      path: "task/tsk_live_non_message/events",
      query: { after: "12", after_live: "8", after_live_epoch: "1777" },
    },
  ]);
});

test("selected-task recovery advances the live cursor for board-invalidating selected events", async () => {
  const streams: StreamOpenRequest[] = [];
  __setHostTransportForTest(
    fakeTransport({
      streams,
      request(req) {
        throw new Error(`selected-task recovery must not hydrate ${req.path}`);
      },
    }),
  );
  setBoardStore("selectedTaskID", "tsk_live_board");
  setBoardStore("taskSequence", 12);

  const event = {
    type: "task.updated",
    task_id: "tsk_live_board",
    sequence: 13,
    live_sequence: 9,
    live_epoch: 1778,
    properties: { taskID: "tsk_live_board" },
  };
  expect(routeSSEEvent(event)).toBe(false);
  handleEventStreamEvent(event);

  await expect(recoverSelectedTaskConversation("test live cursor recovery", "tsk_live_board")).resolves.toBe(13);

  expect(streams).toEqual([
    {
      path: "task/tsk_live_board/events",
      query: { after: "13", after_live: "9", after_live_epoch: "1778" },
    },
  ]);
});

test("selected-task recovery restarts the stream from the current sequence without hydrating", async () => {
  const streams: StreamOpenRequest[] = [];
  const closeCalls = { count: 0 };
  const diagnostics: any[] = [];
  __setConversationRecoveryDiagnosticsSinkForTest((_prefix, record) => {
    diagnostics.push(record);
  });
  __setHostTransportForTest(
    fakeTransport({
      streams,
      closeCalls,
      request(req) {
        throw new Error(`selected-task recovery must not hydrate ${req.path}`);
      },
    }),
  );
  setBoardStore("selectedTaskID", "tsk_atomic");
  setBoardStore("taskSequence", 9);

  startSSE("tsk_atomic", 3);
  expect(streams).toEqual([
    { path: "task/tsk_atomic/events", query: { after: "3", after_live: "0" } },
  ]);
  const treeEpoch = cardTreeStore.treeEpoch;

  await expect(recoverSelectedTaskConversation("test atomic recovery", "tsk_atomic")).resolves.toBe(9);

  expect(closeCalls.count).toBe(1);
  expect(cardTreeStore.treeEpoch).toBe(treeEpoch);
  expect(streams).toEqual([
    { path: "task/tsk_atomic/events", query: { after: "3", after_live: "0" } },
    { path: "task/tsk_atomic/events", query: { after: "9", after_live: "0" } },
  ]);
  expect(diagnostics).toEqual([
    {
      event: "conversation-recovery.started",
      channel: "selected-task-recovery",
      reason: "test atomic recovery",
      taskID: "tsk_atomic",
      source: "selected-task-recovery",
    },
    expect.objectContaining({
      event: "conversation-recovery.succeeded",
      channel: "selected-task-recovery",
      reason: "test atomic recovery",
      taskID: "tsk_atomic",
      source: "selected-task-recovery",
      resumeSequence: 9,
    }),
  ]);
});

test("selected-task recovery refuses replay-expired full refresh and leaves the live tree mounted", async () => {
  const streams: StreamOpenRequest[] = [];
  const closeCalls = { count: 0 };
  const diagnostics: any[] = [];
  __setConversationRecoveryDiagnosticsSinkForTest((_prefix, record) => {
    diagnostics.push(record);
  });

  __setHostTransportForTest(
    fakeTransport({
      streams,
      closeCalls,
      request(req) {
        throw new Error(`replay-expired recovery must not hydrate ${req.path}`);
      },
    }),
  );
  setBoardStore("selectedTaskID", "tsk_expired");
  setBoardStore("taskSequence", 5);

  startSSE("tsk_expired", 5);
  const treeEpoch = cardTreeStore.treeEpoch;

  await expect(recoverSelectedTaskConversation("task replay expired", "tsk_expired"))
    .rejects.toThrow(/refused full conversation refresh/);

  expect(closeCalls.count).toBe(0);
  expect(cardTreeStore.treeEpoch).toBe(treeEpoch);
  expect(streams).toEqual([{ path: "task/tsk_expired/events", query: { after: "5", after_live: "0" } }]);
  expect(diagnostics).toEqual([
    {
      event: "conversation-recovery.started",
      channel: "selected-task-recovery",
      reason: "task replay expired",
      taskID: "tsk_expired",
      source: "selected-task-recovery",
    },
    expect.objectContaining({
      event: "conversation-recovery.failed",
      channel: "selected-task-recovery",
      reason: "task replay expired",
      taskID: "tsk_expired",
      source: "selected-task-recovery",
    }),
  ]);
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
    { path: "task/tsk_new/events", query: { after: "11", after_live: "0" } },
  ]);
});
