import { test, expect, beforeEach } from "bun:test";
import { applyEvent, resetWriter } from "../src/services/tree-writer";
import { setBoardStore } from "../src/store/board";
import { cardTreeStore } from "../src/store/card-tree";

const TASK_ID = "task_01HZFIDELITYSTREAM01";
const SESSION_ID = "ses_fidelity_req_01";
const FID_CARD_ID = `fidelity:${TASK_ID}`;

function minimalBoardFor(taskID: string) {
  return {
    task: { id: taskID, title: "t", status: "running" },
    goalWorkflows: [],
    interactions: [],
  };
}

function emit(type: string, properties: Record<string, unknown>) {
  applyEvent({
    id: `evt_${type}_${Math.random().toString(36).slice(2)}`,
    type,
    properties,
    emittedAt: Date.now(),
  } as any);
}

/** Materialise the requirements session card the same way the live overlay
 *  does — via a `message.updated` event. Without it, handleFidelityCompleted
 *  will stash the payload in `pendingFidelity` and the card stays running. */
function seedRequirementsSession() {
  emit("message.updated", {
    info: {
      id: "msg_requirements_1",
      sessionID: SESSION_ID,
      role: "assistant",
      resolvedRole: "requirements",
      agent: "requirements",
      time: { created: Date.now() },
    },
  });
}

beforeEach(() => {
  setBoardStore("board", minimalBoardFor(TASK_ID));
  setBoardStore("selectedTaskID", TASK_ID);
  resetWriter();
});

test("fidelity chunk appends to a reasoning part keyed by attempt", () => {
  emit("fidelity.review.started", { taskID: TASK_ID, sessionID: SESSION_ID });
  emit("fidelity.review.chunk", {
    taskID: TASK_ID,
    sessionID: SESSION_ID,
    attempt: 1,
    textDelta: "{\n  \"verdict\":",
  });
  emit("fidelity.review.chunk", {
    taskID: TASK_ID,
    sessionID: SESSION_ID,
    attempt: 1,
    textDelta: " \"faithful\"\n}",
  });

  const card = cardTreeStore.cards[FID_CARD_ID];
  expect(card).toBeDefined();
  expect(card!.status).toBe("running");
  const reasoningParts = (card!.parts || []).filter((p: any) => p?.type === "reasoning");
  expect(reasoningParts).toHaveLength(1);
  expect(reasoningParts[0].id).toBe(`fidelity-reasoning:${TASK_ID}:1`);
  expect(reasoningParts[0].text).toBe("{\n  \"verdict\": \"faithful\"\n}");
});

test("new attempt opens a fresh reasoning part, keeping the previous one", () => {
  emit("fidelity.review.started", { taskID: TASK_ID, sessionID: SESSION_ID });
  emit("fidelity.review.chunk", {
    taskID: TASK_ID,
    sessionID: SESSION_ID,
    attempt: 1,
    textDelta: "attempt 1 body",
  });
  emit("fidelity.review.chunk", {
    taskID: TASK_ID,
    sessionID: SESSION_ID,
    attempt: 2,
    textDelta: "attempt 2 body",
  });

  const card = cardTreeStore.cards[FID_CARD_ID];
  const reasoningParts = (card!.parts || []).filter((p: any) => p?.type === "reasoning");
  expect(reasoningParts).toHaveLength(2);
  expect(reasoningParts[0].id).toBe(`fidelity-reasoning:${TASK_ID}:1`);
  expect(reasoningParts[0].text).toBe("attempt 1 body");
  expect(reasoningParts[1].id).toBe(`fidelity-reasoning:${TASK_ID}:2`);
  expect(reasoningParts[1].text).toBe("attempt 2 body");
});

test("completed event preserves streamed reasoning and adds the verdict", () => {
  seedRequirementsSession();
  emit("fidelity.review.started", { taskID: TASK_ID, sessionID: SESSION_ID });
  emit("fidelity.review.chunk", {
    taskID: TASK_ID,
    sessionID: SESSION_ID,
    attempt: 1,
    textDelta: "raw json stream",
  });
  emit("fidelity.review.completed", {
    taskID: TASK_ID,
    sessionID: SESSION_ID,
    verdict: "faithful",
    issues: [],
    corrections: [],
    missingGoals: [],
    attempts: 1,
  });

  const card = cardTreeStore.cards[FID_CARD_ID];
  expect(card).toBeDefined();
  expect(card!.status).toBe("completed");
  expect(card!.fidelity?.verdict).toBe("faithful");
  expect(card!.fidelity?.attempts).toBe(1);
  const reasoningParts = (card!.parts || []).filter((p: any) => p?.type === "reasoning");
  expect(reasoningParts).toHaveLength(1);
  expect(reasoningParts[0].text).toBe("raw json stream");
});

test("chunk arriving before started still lands on the card", () => {
  emit("fidelity.review.chunk", {
    taskID: TASK_ID,
    sessionID: SESSION_ID,
    attempt: 1,
    textDelta: "early token",
  });
  const card = cardTreeStore.cards[FID_CARD_ID];
  expect(card).toBeDefined();
  expect(card!.kind).toBe("fidelity");
  const reasoningParts = (card!.parts || []).filter((p: any) => p?.type === "reasoning");
  expect(reasoningParts).toHaveLength(1);
  expect(reasoningParts[0].text).toBe("early token");
});
