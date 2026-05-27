import { test, expect } from "bun:test";

(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test";

if (typeof globalThis.requestAnimationFrame === "undefined") {
  (globalThis as any).requestAnimationFrame = (() => 1) as any;
  (globalThis as any).cancelAnimationFrame = (() => {}) as any;
}

const { setBoardStore } = await import("../src/store/board");
const { applyEvent, resetWriter } = await import("../src/services/tree-writer");
const { cardTreeStore } = await import("../src/store/card-tree");
const { aggregateUsageAcrossSessions } = await import("../src/utils/format-usage");

const TASK_ID = "tsk_message_tokens";
const SID = "ses_message_tokens";
const T0 = 1_780_000_000_000;

function messageUpdated(info: Record<string, any>) {
  return {
    type: "message.updated",
    sequence: 1,
    timestamp: T0,
    taskID: TASK_ID,
    properties: {
      taskID: TASK_ID,
      info: {
        resolvedRole: info.resolvedRole ?? info.role,
        agent: info.agent ?? info.role,
        channel: info.role,
        ...info,
      },
    },
  };
}

// Regression: the overlay chat-usage strip was empty for any task whose
// orchestrator / planner / chat agents run on the internal session loop.
// Internal sessions write tokens onto `Message.Assistant.{tokens,cost}`
// and emit `message.updated`; no `usage.updated` ever fires. The
// tree-writer must project those fields onto the turn card's `usage` so
// the aggregator (`format-usage.ts`) returns nonzero and the strip
// renders.
test("handleMessageUpdated projects info.tokens + info.cost onto the turn card", async () => {
  setBoardStore("board", {
    task: { id: TASK_ID, status: "active", time: { created: T0 }, request: "test", attachments: [] },
    goals: [],
    interactions: [],
    goalWorkflows: [],
  } as any);
  setBoardStore("selectedTaskID", TASK_ID);
  resetWriter();

  applyEvent(messageUpdated({
    id: "msg_assistant_1",
    sessionID: SID,
    role: "assistant",
    time: { created: T0 + 100 },
    tokens: { input: 1_200, output: 350, reasoning: 0, total: 1_550, cache: { read: 0, write: 0 } },
    cost: 0.0182,
  }));

  const cardID = `assistant:session:${SID}:message:msg_assistant_1`;
  const card = cardTreeStore.cards[cardID];
  expect(card).toBeDefined();
  expect(card!.usage).toEqual({
    inputTokens: 1_200,
    outputTokens: 350,
    totalTokens: 1_550,
    costUSD: 0.0182,
  });

  // The chat-usage aggregator should now see this card.
  const agg = aggregateUsageAcrossSessions(Object.values(cardTreeStore.cards));
  expect(agg.tokens).toBe(1_550);
  expect(agg.costUSD).toBe(0.0182);
});

test("handleMessageUpdated leaves card.usage unset for assistant messages with zero usage", async () => {
  setBoardStore("board", {
    task: { id: TASK_ID, status: "active", time: { created: T0 }, request: "test", attachments: [] },
    goals: [],
    interactions: [],
    goalWorkflows: [],
  } as any);
  setBoardStore("selectedTaskID", TASK_ID);
  resetWriter();

  // The engine creates the message row eagerly with zero counters
  // (build/agent.ts:1564). The first message.updated fires before any
  // step completes — usage must stay unset, not project a noisy
  // `{0,0,0,0}` chip onto the card.
  applyEvent(messageUpdated({
    id: "msg_assistant_zero",
    sessionID: SID,
    role: "assistant",
    time: { created: T0 + 50 },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    cost: 0,
  }));

  const cardID = `assistant:session:${SID}:message:msg_assistant_zero`;
  const card = cardTreeStore.cards[cardID];
  expect(card).toBeDefined();
  expect(card!.usage).toBeUndefined();
});

test("user messages do not get a usage chip even when tokens accidentally appear on info", async () => {
  setBoardStore("board", {
    task: { id: TASK_ID, status: "active", time: { created: T0 }, request: "test", attachments: [] },
    goals: [],
    interactions: [],
    goalWorkflows: [],
  } as any);
  setBoardStore("selectedTaskID", TASK_ID);
  resetWriter();

  applyEvent(messageUpdated({
    id: "msg_user_1",
    sessionID: SID,
    role: "user",
    time: { created: T0 + 50 },
    // User messages carry no tokens in the schema, but a defensive
    // payload should never produce a usage chip on the user card.
    tokens: { input: 999, output: 999, reasoning: 0, total: 1_998, cache: { read: 0, write: 0 } },
    cost: 0.5,
  } as any));

  const cards = Object.values(cardTreeStore.cards);
  const userCard = cards.find((c) => c.id.includes("msg_user_1"));
  expect(userCard).toBeDefined();
  expect(userCard!.usage).toBeUndefined();
});

// Regression for the cross-session conversation total. Each card carries
// its own per-message tokens (not cumulative); the aggregator sums them.
test("aggregateUsageAcrossSessions sums per-message usage across multiple sessions", async () => {
  setBoardStore("board", {
    task: { id: TASK_ID, status: "active", time: { created: T0 }, request: "test", attachments: [] },
    goals: [],
    interactions: [],
    goalWorkflows: [],
  } as any);
  setBoardStore("selectedTaskID", TASK_ID);
  resetWriter();

  applyEvent(messageUpdated({
    id: "msg_orch_a",
    sessionID: "ses_orchestrator",
    role: "assistant",
    time: { created: T0 + 100 },
    tokens: { input: 500, output: 100, reasoning: 0, total: 600, cache: { read: 0, write: 0 } },
    cost: 0.01,
  }));
  applyEvent(messageUpdated({
    id: "msg_orch_b",
    sessionID: "ses_orchestrator",
    role: "assistant",
    time: { created: T0 + 200 },
    tokens: { input: 800, output: 250, reasoning: 0, total: 1_050, cache: { read: 0, write: 0 } },
    cost: 0.025,
  }));
  applyEvent(messageUpdated({
    id: "msg_build_a",
    sessionID: "ses_build_worker",
    role: "assistant",
    agent: "build",
    time: { created: T0 + 300 },
    tokens: { input: 4_000, output: 600, reasoning: 0, total: 4_600, cache: { read: 0, write: 0 } },
    cost: 0.08,
  }));

  const agg = aggregateUsageAcrossSessions(Object.values(cardTreeStore.cards));
  // 600 + 1050 + 4600 = 6250 tokens; 0.01 + 0.025 + 0.08 = 0.115 USD.
  expect(agg.tokens).toBe(6_250);
  expect(agg.costUSD).toBeCloseTo(0.115, 5);
});
