import { afterAll, afterEach, expect, test } from "bun:test";
import { setBoardStore } from "../src/store/board";
import { cardTreeStore } from "../src/store/card-tree";
import { conversationAgentStore } from "../src/store/conversation-agents";
import {
  cancelConversationReplay,
  hydrateTaskConversation,
  loadConversationHistoryUntilCard,
} from "../src/services/conversation";
import { replayTaskEventToTree } from "../src/services/events";
import {
  __setHostTransportForTest,
  type HostTransport,
  type StreamHandlers,
  type StreamOpenRequest,
  type TransportRequest,
  type TransportResponse,
} from "../src/services/host-transport";
import { flushBufferedPartDeltas, resetWriter } from "../src/services/tree-writer";

const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
  callback(0);
  return 1;
}) as any;
globalThis.cancelAnimationFrame = (() => {}) as any;

function fakeTransport(
  responder: (req: TransportRequest) => Promise<TransportResponse<unknown>> | TransportResponse<unknown>,
): HostTransport {
  return {
    kind: "tauri",
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      return responder(req) as Promise<TransportResponse<T>> | TransportResponse<T>;
    },
    openStream(_input: StreamOpenRequest, _handlers: StreamHandlers) {
      throw new Error("openStream not used in conversation hydrate tests");
    },
    async native() {
      throw new Error("native not used in conversation hydrate tests");
    },
    subscribeUiCommand() {
      return { unsubscribe() {} };
    },
  } satisfies HostTransport;
}

afterEach(() => {
  cancelConversationReplay();
  __setHostTransportForTest(undefined);
  resetWriter();
  setBoardStore("selectedTaskID", "");
});

afterAll(() => {
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
});

test("hydration replay projects persisted executor output into the card tree", () => {
  resetWriter();
  setBoardStore("board", {
    snapshotVersion: "board:hydrate",
    task: {
      id: "tsk_hydrate",
      status: "active",
      request: "restore conversation",
      sessionID: "ses_root",
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  });
  setBoardStore("selectedTaskID", "tsk_hydrate");

  replayTaskEventToTree({
    event_id: "pev_1",
    task_id: "tsk_hydrate",
    type: "run.output",
    timestamp: 1_776_000_001_000,
    sequence: 12,
    summary: "Hydrated executor output",
    payload: {
      runID: "run_1",
      sessionID: "ses_executor",
      type: "text_delta",
      text: "Recovered streamed output.",
    },
  });
  flushBufferedPartDeltas();

  const cardID = "executor:session:ses_executor:message:executor:msg:run_1";
  expect(cardTreeStore.cards[cardID]).toBeDefined();
  expect(
    cardTreeStore.cards[cardID]?.parts.some(
      (part) => part.type === "text" && String(part.text || "").includes("Recovered streamed output."),
    ),
  ).toBe(true);
});

test("hydrateTaskConversation waits for persisted event replay before returning resume sequence", async () => {
  resetWriter();
  setBoardStore("selectedTaskID", "tsk_replay");

  let resolveReplayPage!: (body: unknown) => void;
  const replayPage = new Promise<unknown>((resolve) => {
    resolveReplayPage = resolve;
  });
  let replayPageRequested!: () => void;
  const replayPageStarted = new Promise<void>((resolve) => {
    replayPageRequested = resolve;
  });

  __setHostTransportForTest(
    fakeTransport(async (req) => {
      if (req.path === "task/tsk_replay/conversation") {
        return {
          status: 200,
          ok: true,
          headers: {},
          body: {
            board: {
              snapshotVersion: "board:replay",
              task: {
                id: "tsk_replay",
                status: "active",
                request: "restore conversation",
                sessionID: "ses_root",
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
            eventReplay: { cursor: 1, latestSequence: 2, complete: false, limit: 10 },
            lastSequence: 1,
          },
        };
      }
      if (req.path === "task/tsk_replay/conversation/events") {
        replayPageRequested();
        return {
          status: 200,
          ok: true,
          headers: {},
          body: await replayPage,
        };
      }
      throw new Error(`unexpected request path: ${req.path}`);
    }),
  );

  let settled = false;
  const hydration = hydrateTaskConversation("tsk_replay").then((sequence) => {
    settled = true;
    return sequence;
  });

  await replayPageStarted;
  await Promise.resolve();
  expect(settled).toBe(false);

  resolveReplayPage({
    events: [
      {
        event_id: "pev_replay",
        task_id: "tsk_replay",
        type: "run.output",
        timestamp: 1_776_000_002_000,
        sequence: 2,
        summary: "Replayed executor output",
        payload: {
          runID: "run_replay",
          sessionID: "ses_executor_replay",
          type: "text_delta",
          text: "Replay completed before resume.",
        },
      },
    ],
    eventReplay: { cursor: 2, latestSequence: 2, complete: true, limit: 10 },
  });

  await expect(hydration).resolves.toBe(2);
  expect(cardTreeStore.cards["executor:session:ses_executor_replay:message:executor:msg:run_replay"]).toBeDefined();
});

test("hydrateTaskConversation renders the live tail first and prepends older history on demand", async () => {
  resetWriter();
  setBoardStore("selectedTaskID", "tsk_lazy");
  const requests: TransportRequest[] = [];

  const board = {
    snapshotVersion: "board:lazy",
    task: {
      id: "tsk_lazy",
      status: "active",
      request: "restore conversation lazily",
      sessionID: "ses_root",
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  };
  const oldMessage = {
    info: {
      id: "msg_old",
      sessionID: "ses_old",
      role: "assistant",
      resolvedRole: "assistant",
      channel: "integrity",
      time: { created: 1_776_000_000_100 },
    },
    parts: [
      { id: "part_old", sessionID: "ses_old", messageID: "msg_old", type: "text", text: "Older history." },
    ],
  };
  const latestMessage = {
    info: {
      id: "msg_latest",
      sessionID: "ses_root",
      role: "assistant",
      resolvedRole: "assistant",
      channel: "assistant",
      time: { created: 1_776_000_000_900 },
    },
    parts: [
      { id: "part_latest", sessionID: "ses_root", messageID: "msg_latest", type: "text", text: "Latest tail." },
    ],
  };

  __setHostTransportForTest(
    fakeTransport((req) => {
      requests.push(req);
      if (req.path === "task/tsk_lazy/conversation") {
        expect(req.query?.tail_limit).toBe("1");
        return {
          status: 200,
          ok: true,
          headers: {},
          body: {
            board,
            transcript: [latestMessage],
            timeline: [],
            events: [],
            view: {
              sessions: [
                {
                  sessionID: "ses_root",
                  stage: "assistant",
                  messageIDs: ["msg_latest"],
                  firstMessageTime: 1_776_000_000_900,
                  lastMessageTime: 1_776_000_000_900,
                  placement: "top_level",
                },
              ],
              topLevelSessionIDs: ["ses_root"],
            },
            agentView: {
              sessions: [
                {
                  sessionID: "ses_old",
                  stage: "integrity",
                  messageIDs: ["msg_old"],
                  firstMessageTime: 1_776_000_000_100,
                  lastMessageTime: 1_776_000_000_100,
                  placement: "top_level",
                },
                {
                  sessionID: "ses_root",
                  stage: "assistant",
                  messageIDs: ["msg_latest"],
                  firstMessageTime: 1_776_000_000_900,
                  lastMessageTime: 1_776_000_000_900,
                  placement: "top_level",
                },
              ],
              topLevelSessionIDs: ["ses_old", "ses_root"],
            },
            eventReplay: { cursor: 5, latestSequence: 5, complete: true, limit: 500 },
            history: { oldestTimestamp: 1_776_000_000_900, oldestMessageID: "msg_latest", hasMore: true, limit: 1 },
            lastSequence: 5,
          },
        };
      }
      if (req.path === "task/tsk_lazy/conversation/history") {
        expect(req.query?.before).toBe("1776000000900");
        expect(req.query?.before_id).toBe("msg_latest");
        return {
          status: 200,
          ok: true,
          headers: {},
          body: {
            transcript: [oldMessage],
            timeline: [],
            view: {
              sessions: [
                {
                  sessionID: "ses_old",
                  stage: "integrity",
                  messageIDs: ["msg_old"],
                  firstMessageTime: 1_776_000_000_100,
                  lastMessageTime: 1_776_000_000_100,
                  placement: "top_level",
                },
              ],
              topLevelSessionIDs: ["ses_old"],
            },
            history: { oldestTimestamp: 1_776_000_000_100, oldestMessageID: "msg_old", hasMore: false, limit: 160 },
          },
        };
      }
      throw new Error(`unexpected request path: ${req.path}`);
    }),
  );

  await expect(hydrateTaskConversation("tsk_lazy", { tailLimit: 1 })).resolves.toBe(5);
  expect(cardTreeStore.order.filter((id) => id !== "ctx:user-request")).toEqual([
    "assistant:session:ses_root:message:msg_latest",
  ]);
  expect(conversationAgentStore.records.map((record) => record.sessionID)).toEqual([
    "ses_old",
    "ses_root",
  ]);
  expect(conversationAgentStore.records[0]?.renderedCardID).toBe("integrity:session:ses_old");
  expect(cardTreeStore.cards["integrity:session:ses_old"]).toBeUndefined();

  await expect(loadConversationHistoryUntilCard("integrity:session:ses_old", "tsk_lazy")).resolves.toBe(true);
  expect(cardTreeStore.order.filter((id) => id !== "ctx:user-request")).toEqual([
    "integrity:session:ses_old",
    "assistant:session:ses_root:message:msg_latest",
  ]);
  expect(requests.map((req) => req.path)).toEqual([
    "task/tsk_lazy/conversation",
    "task/tsk_lazy/conversation/history",
  ]);
});
