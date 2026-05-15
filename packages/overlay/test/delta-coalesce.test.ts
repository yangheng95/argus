import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";

const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

let nextFrameID = 1;
let frameCallbacks = new Map<number, FrameRequestCallback>();

globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
  const id = nextFrameID++;
  frameCallbacks.set(id, callback);
  return id;
}) as any;
globalThis.cancelAnimationFrame = ((id: number) => {
  frameCallbacks.delete(id);
}) as any;

const { setBoardStore } = await import("../src/store/board");
const { cardTreeStore } = await import("../src/store/card-tree");
const { applyEvent, resetWriter } = await import("../src/services/tree-writer");

const TASK_ID = "tsk_delta_coalesce";
const SESSION_ID = "ses_delta_coalesce";
const MESSAGE_ID = "msg_delta_coalesce";

function runFrame(): void {
  const callbacks = [...frameCallbacks.values()];
  frameCallbacks.clear();
  for (const callback of callbacks) callback(0);
}

function pendingFrameCount(): number {
  return frameCallbacks.size;
}

function seedBoard(): void {
  setBoardStore("selectedTaskID", TASK_ID);
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "delta coalesce",
      sessionID: SESSION_ID,
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  });
}

function messageUpdated(messageID = MESSAGE_ID, sessionID = SESSION_ID): void {
  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: {
        id: messageID,
        sessionID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        channel: "assistant",
        time: { created: 1_776_000_000_010 },
      },
    },
  });
}

function partUpdated(part: any): void {
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      part: {
        messageID: MESSAGE_ID,
        sessionID: SESSION_ID,
        resolvedRole: "assistant",
        channel: "assistant",
        ...part,
      },
    },
  });
}

function delta(partID: string, field: string, chunk: string, messageID = MESSAGE_ID, sessionID = SESSION_ID): void {
  applyEvent({
    type: "message.part.delta",
    properties: {
      taskID: TASK_ID,
      partID,
      messageID,
      sessionID,
      field,
      delta: chunk,
    },
  });
}

function sessionCard(sessionID = SESSION_ID) {
  return cardTreeStore.cards[`assistant:session:${sessionID}`];
}

function partText(partID: string): string {
  const part = (sessionCard()?.parts as any[]).find((entry) => entry.id === partID);
  return String(part?.text ?? "");
}

beforeEach(() => {
  frameCallbacks.clear();
  nextFrameID = 1;
  seedBoard();
  resetWriter();
  messageUpdated();
});

afterEach(() => {
  resetWriter();
  frameCallbacks.clear();
});

test("same session part field deltas merge into one frame-visible write", () => {
  partUpdated({ id: "part_text", type: "text", text: "" });
  const beforeVersion = cardTreeStore.visibleVersion;

  for (const chunk of ["Hel", "lo", " ", "world"]) delta("part_text", "text", chunk);

  expect(partText("part_text")).toBe("");
  expect(cardTreeStore.visibleVersion).toBe(beforeVersion);
  expect(pendingFrameCount()).toBe(1);

  runFrame();

  expect(partText("part_text")).toBe("Hello world");
  expect(cardTreeStore.visibleVersion).toBe(beforeVersion + 1);
  expect(pendingFrameCount()).toBe(0);
});

test("message.part.updated synchronously flushes buffered deltas before replacing the part", () => {
  partUpdated({ id: "part_replace", type: "text", text: "" });
  delta("part_replace", "text", "old");

  partUpdated({ id: "part_replace", type: "text", text: "final" });

  expect(partText("part_replace")).toBe("final");
  expect(pendingFrameCount()).toBe(0);
});

test("session.status terminal sees complete text before status mutation", () => {
  partUpdated({ id: "part_terminal", type: "text", text: "" });
  delta("part_terminal", "text", "complete");

  applyEvent({
    type: "session.status",
    emittedAt: 1_776_000_000_500,
    properties: {
      sessionID: SESSION_ID,
      status: { type: "terminal", reason: "completed" },
    },
  });

  expect(partText("part_terminal")).toBe("complete");
  expect(sessionCard()?.status).toBe("completed");
  expect(pendingFrameCount()).toBe(0);
});

test("resetWriter flushes and cancels buffered delta frames before clearing state", () => {
  partUpdated({ id: "part_reset", type: "text", text: "" });
  delta("part_reset", "text", "stale");
  expect(pendingFrameCount()).toBe(1);

  resetWriter();
  runFrame();

  expect(cardTreeStore.order).toEqual([]);
  expect(Object.keys(cardTreeStore.cards)).toEqual([]);
  expect(pendingFrameCount()).toBe(0);
});

test("interleaved parts keep independent buffers and insertion order", () => {
  partUpdated({ id: "part_a", type: "text", text: "" });
  partUpdated({ id: "part_b", type: "text", text: "" });

  delta("part_a", "text", "A");
  delta("part_b", "text", "B");
  delta("part_a", "text", "C");
  runFrame();

  expect(partText("part_a")).toBe("AC");
  expect(partText("part_b")).toBe("B");
  const ids = (sessionCard()?.parts as any[]).map((part) => part.id);
  expect(ids.slice(-2)).toEqual(["part_a", "part_b"]);
});

test("tool raw field deltas merge through the existing state.raw branch", () => {
  partUpdated({
    id: "part_tool",
    type: "tool",
    tool: "bash",
    state: { status: "running", raw: "" },
  });

  delta("part_tool", "raw", "line1\n");
  delta("part_tool", "raw", "line2\n");
  runFrame();

  const part = (sessionCard()?.parts as any[]).find((entry) => entry.id === "part_tool");
  expect(part?.state?.raw).toBe("line1\nline2\n");
});

afterAll(() => {
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
});
