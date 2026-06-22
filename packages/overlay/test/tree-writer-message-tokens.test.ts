import { test, expect } from "bun:test"
import { installRealOverlayI18n } from "./fixtures/i18n"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"

installRealOverlayI18n()

if (typeof globalThis.requestAnimationFrame === "undefined") {
  ;(globalThis as any).requestAnimationFrame = (() => 1) as any
  ;(globalThis as any).cancelAnimationFrame = (() => {}) as any
}

const { setBoardStore } = await import("../src/store/board")
const { applyEvent, hydrateConversationView, resetWriter } = await import("../src/services/tree-writer")
const { cardTreeStore } = await import("../src/store/card-tree")
const { aggregateUsageAcrossSessions, formatUsageStrip } = await import("../src/utils/format-usage")

const TASK_ID = "tsk_message_tokens"
const SID = "ses_message_tokens"
const T0 = 1_780_000_000_000

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
  }
}

function partUpdated(input: { messageID: string; sessionID: string; partID: string; text: string; role: string }) {
  return {
    type: "message.part.updated",
    sequence: 1,
    timestamp: T0,
    taskID: TASK_ID,
    properties: {
      taskID: TASK_ID,
      part: {
        id: input.partID,
        messageID: input.messageID,
        sessionID: input.sessionID,
        type: "text",
        text: input.text,
        resolvedRole: input.role,
        channel: input.role,
      },
    },
  }
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
  } as any)
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()

  applyEvent(
    messageUpdated({
      id: "msg_assistant_1",
      sessionID: SID,
      role: "assistant",
      time: { created: T0 + 100 },
      tokens: { input: 1_200, output: 350, reasoning: 0, total: 1_550, cache: { read: 0, write: 0 } },
      cost: 0.0182,
    }),
  )

  const cardID = `assistant:session:${SID}:message:msg_assistant_1`
  const card = cardTreeStore.cards[cardID]
  expect(card).toBeDefined()
  expect(card!.usage).toEqual({
    inputTokens: 1_200,
    outputTokens: 350,
    totalTokens: 1_550,
    costUSD: 0.0182,
  })
  expect(card!.contextTokens).toBe(1_200)
  expect(card!.contextTokensEstimated).toBe(false)

  // The chat-usage aggregator should now see this card.
  const agg = aggregateUsageAcrossSessions(Object.values(cardTreeStore.cards))
  expect(agg.tokens).toBe(1_550)
  expect(agg.costUSD).toBe(0.0182)
  expect(agg.estimated).toBe(false)
  expect(cardTreeStore.usageAggregate).toEqual(agg)
})

test("live message regroup keeps user and assistant turns on the real timeline", async () => {
  setBoardStore("board", {
    task: { id: TASK_ID, status: "active", time: { created: T0 }, request: "test", attachments: [] },
    goals: [],
    interactions: [],
    goalWorkflows: [],
  } as any)
  setBoardStore("selectedSource", { kind: "session", id: SID })
  resetWriter()

  for (const item of [
    { id: "msg_user_1", role: "user", time: T0 + 100, text: "hello" },
    { id: "msg_assistant_1", role: "assistant", time: T0 + 200, text: "Hello! How can I help?" },
    { id: "msg_user_2", role: "user", time: T0 + 300, text: "你是什么模型" },
    { id: "msg_assistant_2", role: "assistant", time: T0 + 400, text: "我是 OpenCorvus。" },
  ]) {
    applyEvent(
      messageUpdated({
        id: item.id,
        sessionID: SID,
        role: item.role,
        time: { created: item.time },
      }),
    )
    applyEvent(
      partUpdated({
        messageID: item.id,
        sessionID: SID,
        partID: `part_${item.id}`,
        text: item.text,
        role: item.role,
      }),
    )
  }

  expect(cardTreeStore.order.filter((id) => id.includes(`:session:${SID}:message:`))).toEqual([
    `user:session:${SID}:message:msg_user_1`,
    `assistant:session:${SID}:message:msg_assistant_1`,
    `user:session:${SID}:message:msg_user_2`,
    `assistant:session:${SID}:message:msg_assistant_2`,
  ])
})

test("hydrateConversationView keeps user and assistant turns on the real timeline", async () => {
  setBoardStore("board", {
    task: { id: TASK_ID, status: "active", time: { created: T0 }, request: "test", attachments: [] },
    goals: [],
    interactions: [],
    goalWorkflows: [],
  } as any)
  setBoardStore("selectedSource", { kind: "session", id: SID })
  resetWriter()

  hydrateConversationView({ sessions: [{ sessionID: SID, stage: "assistant" }] }, [
    {
      info: {
        id: "msg_hydrate_user_1",
        sessionID: SID,
        role: "user",
        resolvedRole: "user",
        agent: "user",
        channel: "user",
        time: { created: T0 + 100 },
      },
      parts: [{ id: "part_hydrate_user_1", type: "text", text: "hello" }],
    },
    {
      info: {
        id: "msg_hydrate_assistant_1",
        sessionID: SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        channel: "assistant",
        time: { created: T0 + 200 },
      },
      parts: [{ id: "part_hydrate_assistant_1", type: "text", text: "Hello!" }],
    },
    {
      info: {
        id: "msg_hydrate_user_2",
        sessionID: SID,
        role: "user",
        resolvedRole: "user",
        agent: "user",
        channel: "user",
        time: { created: T0 + 300 },
      },
      parts: [{ id: "part_hydrate_user_2", type: "text", text: "你是什么模型" }],
    },
    {
      info: {
        id: "msg_hydrate_assistant_2",
        sessionID: SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        channel: "assistant",
        time: { created: T0 + 400 },
      },
      parts: [{ id: "part_hydrate_assistant_2", type: "text", text: "OpenCorvus." }],
    },
  ])

  expect(cardTreeStore.order.filter((id) => id.includes(`:session:${SID}:message:`))).toEqual([
    `user:session:${SID}:message:msg_hydrate_user_1`,
    `assistant:session:${SID}:message:msg_hydrate_assistant_1`,
    `user:session:${SID}:message:msg_hydrate_user_2`,
    `assistant:session:${SID}:message:msg_hydrate_assistant_2`,
  ])
})

test("message regroup keeps every displayable non-phase message on its own card", async () => {
  setBoardStore("board", {
    task: { id: TASK_ID, status: "active", time: { created: T0 }, request: "test", attachments: [] },
    goals: [],
    interactions: [],
    goalWorkflows: [],
  } as any)
  setBoardStore("selectedSource", { kind: "session", id: SID })
  resetWriter()

  for (const item of [
    { id: "msg_group_assistant_1", role: "assistant", time: T0 + 100, text: "first assistant" },
    { id: "msg_group_assistant_2", role: "assistant", time: T0 + 200, text: "second assistant" },
    { id: "msg_group_user_1", role: "user", time: T0 + 300, text: "user interruption" },
    { id: "msg_group_assistant_3", role: "assistant", time: T0 + 400, text: "resumed assistant" },
  ]) {
    applyEvent(
      messageUpdated({
        id: item.id,
        sessionID: SID,
        role: item.role,
        time: { created: item.time },
      }),
    )
    applyEvent(
      partUpdated({
        messageID: item.id,
        sessionID: SID,
        partID: `part_${item.id}`,
        text: item.text,
        role: item.role,
      }),
    )
  }

  expect(cardTreeStore.order.filter((id) => id.includes(`:session:${SID}:message:`))).toEqual([
    `assistant:session:${SID}:message:msg_group_assistant_1`,
    `assistant:session:${SID}:message:msg_group_assistant_2`,
    `user:session:${SID}:message:msg_group_user_1`,
    `assistant:session:${SID}:message:msg_group_assistant_3`,
  ])
  expect(
    cardTreeStore.cards[`assistant:session:${SID}:message:msg_group_assistant_1`]?.parts.map(
      (part: any) => part.messageID,
    ),
  ).toEqual(["msg_group_assistant_1"])
  expect(
    cardTreeStore.cards[`assistant:session:${SID}:message:msg_group_assistant_2`]?.parts.map(
      (part: any) => part.messageID,
    ),
  ).toEqual(["msg_group_assistant_2"])
})

test("handleMessageUpdated projects the actual assistant model from message info", async () => {
  setBoardStore("board", {
    task: { id: TASK_ID, status: "active", time: { created: T0 }, request: "test", attachments: [] },
    goals: [],
    interactions: [],
    goalWorkflows: [],
  } as any)
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()

  applyEvent(
    messageUpdated({
      id: "msg_model_1",
      sessionID: SID,
      role: "assistant",
      providerID: "hexin",
      modelID: "kimi-k2",
      time: { created: T0 + 100 },
    }),
  )

  const cardID = `assistant:session:${SID}:message:msg_model_1`
  expect(cardTreeStore.cards[cardID]?.model).toEqual({
    providerID: "hexin",
    modelID: "kimi-k2",
    display: "hexin/kimi-k2",
  })
})

test("separate assistant cards display their own real model", async () => {
  setBoardStore("board", {
    task: { id: TASK_ID, status: "active", time: { created: T0 }, request: "test", attachments: [] },
    goals: [],
    interactions: [],
    goalWorkflows: [],
  } as any)
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()

  applyEvent(
    messageUpdated({
      id: "msg_model_group_a",
      sessionID: SID,
      role: "assistant",
      providerID: "hexin",
      modelID: "old-model",
      time: { created: T0 + 100 },
    }),
  )
  applyEvent(
    messageUpdated({
      id: "msg_model_group_b",
      sessionID: SID,
      role: "assistant",
      providerID: "openai-compatible",
      modelID: "new-model",
      time: { created: T0 + 200 },
    }),
  )

  const firstCardID = `assistant:session:${SID}:message:msg_model_group_a`
  const secondCardID = `assistant:session:${SID}:message:msg_model_group_b`
  expect(cardTreeStore.cards[firstCardID]?.model).toEqual({
    providerID: "hexin",
    modelID: "old-model",
    display: "hexin/old-model",
  })
  expect(cardTreeStore.cards[secondCardID]?.model).toEqual({
    providerID: "openai-compatible",
    modelID: "new-model",
    display: "openai-compatible/new-model",
  })
})

test("separate assistant card with no model fields does not clear the previous card model", async () => {
  setBoardStore("board", {
    task: { id: TASK_ID, status: "active", time: { created: T0 }, request: "test", attachments: [] },
    goals: [],
    interactions: [],
    goalWorkflows: [],
  } as any)
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()

  applyEvent(
    messageUpdated({
      id: "msg_model_missing_a",
      sessionID: SID,
      role: "assistant",
      providerID: "hexin",
      modelID: "old-model",
      time: { created: T0 + 100 },
    }),
  )
  applyEvent(
    messageUpdated({
      id: "msg_model_missing_b",
      sessionID: SID,
      role: "assistant",
      time: { created: T0 + 200 },
    }),
  )

  const firstCardID = `assistant:session:${SID}:message:msg_model_missing_a`
  const secondCardID = `assistant:session:${SID}:message:msg_model_missing_b`
  expect(cardTreeStore.cards[firstCardID]?.model).toEqual({
    providerID: "hexin",
    modelID: "old-model",
    display: "hexin/old-model",
  })
  expect(cardTreeStore.cards[secondCardID]?.model).toBeUndefined()
})

test("handleMessageUpdated leaves card.usage unset for assistant messages with zero usage", async () => {
  setBoardStore("board", {
    task: { id: TASK_ID, status: "active", time: { created: T0 }, request: "test", attachments: [] },
    goals: [],
    interactions: [],
    goalWorkflows: [],
  } as any)
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()

  // The engine creates the message row eagerly with zero counters
  // (build/agent.ts:1564). The first message.updated fires before any
  // step completes — usage must stay unset, not project a noisy
  // `{0,0,0,0}` chip onto the card.
  applyEvent(
    messageUpdated({
      id: "msg_assistant_zero",
      sessionID: SID,
      role: "assistant",
      time: { created: T0 + 50 },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0,
    }),
  )

  const cardID = `assistant:session:${SID}:message:msg_assistant_zero`
  const card = cardTreeStore.cards[cardID]
  expect(card).toBeDefined()
  expect(card!.usage).toBeUndefined()
  expect(card!.contextTokens).toBeUndefined()
})

test("hydrateConversationView restores usage and context tokens from transcript messages", async () => {
  setBoardStore("board", {
    task: { id: TASK_ID, status: "active", time: { created: T0 }, request: "test", attachments: [] },
    goals: [],
    interactions: [],
    goalWorkflows: [],
  } as any)
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()

  hydrateConversationView({ sessions: [{ sessionID: SID, stage: "assistant" }] }, [
    {
      info: {
        id: "msg_hydrated_usage",
        sessionID: SID,
        role: "assistant",
        agent: "assistant",
        resolvedRole: "assistant",
        channel: "assistant",
        time: { created: T0 + 150 },
        tokens: { input: 700, output: 80, reasoning: 0, total: 780, cache: { read: 50, write: 25 } },
        cost: 0.012,
      },
      parts: [
        { id: "part_hydrated_usage", type: "text", text: "done", messageID: "msg_hydrated_usage", sessionID: SID },
      ],
    },
  ])

  const cardID = `assistant:session:${SID}:message:msg_hydrated_usage`
  const card = cardTreeStore.cards[cardID]
  expect(card).toBeDefined()
  expect(card!.usage).toEqual({
    inputTokens: 700,
    outputTokens: 80,
    totalTokens: 780,
    costUSD: 0.012,
  })
  expect(card!.contextTokens).toBe(775)
  expect(card!.contextTokensEstimated).toBe(false)
})

test("hydrateConversationView restores actual model from transcript message info", async () => {
  setBoardStore("board", {
    task: { id: TASK_ID, status: "active", time: { created: T0 }, request: "test", attachments: [] },
    goals: [],
    interactions: [],
    goalWorkflows: [],
  } as any)
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()

  hydrateConversationView({ sessions: [{ sessionID: SID, stage: "assistant" }] }, [
    {
      info: {
        id: "msg_hydrated_model",
        sessionID: SID,
        role: "assistant",
        agent: "assistant",
        resolvedRole: "assistant",
        channel: "assistant",
        providerID: "hexin",
        modelID: "gpt-oss-120b",
        time: { created: T0 + 150 },
      },
      parts: [{ id: "part_hydrated_model", type: "text", text: "done" }],
    },
  ])

  const cardID = `assistant:session:${SID}:message:msg_hydrated_model`
  expect(cardTreeStore.cards[cardID]?.model).toEqual({
    providerID: "hexin",
    modelID: "gpt-oss-120b",
    display: "hexin/gpt-oss-120b",
  })
})

test("context token hint stays scoped to each message card", async () => {
  setBoardStore("board", {
    task: { id: TASK_ID, status: "active", time: { created: T0 }, request: "test", attachments: [] },
    goals: [],
    interactions: [],
    goalWorkflows: [],
  } as any)
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()

  applyEvent(
    messageUpdated({
      id: "msg_group_a",
      sessionID: SID,
      role: "assistant",
      time: { created: T0 + 100 },
      tokens: { input: 500, output: 100, reasoning: 0, total: 600, cache: { read: 0, write: 0 } },
      cost: 0.01,
    }),
  )
  applyEvent(
    messageUpdated({
      id: "msg_group_b",
      sessionID: SID,
      role: "assistant",
      time: { created: T0 + 200 },
      tokens: { input: 800, output: 250, reasoning: 0, total: 1_050, cache: { read: 0, write: 0 } },
      cost: 0.025,
    }),
  )

  const firstCard = cardTreeStore.cards[`assistant:session:${SID}:message:msg_group_a`]
  const secondCard = cardTreeStore.cards[`assistant:session:${SID}:message:msg_group_b`]
  expect(firstCard).toBeDefined()
  expect(secondCard).toBeDefined()
  expect(firstCard!.usage).toEqual({
    inputTokens: 500,
    outputTokens: 100,
    totalTokens: 600,
    costUSD: 0.01,
  })
  expect(firstCard!.contextTokens).toBe(500)
  expect(secondCard!.usage).toEqual({
    inputTokens: 800,
    outputTokens: 250,
    totalTokens: 1_050,
    costUSD: 0.025,
  })
  expect(secondCard!.contextTokens).toBe(800)
})

test("external executor cumulative usage does not masquerade as current context", async () => {
  setBoardStore("board", {
    task: { id: TASK_ID, status: "active", time: { created: T0 }, request: "test", attachments: [] },
    goals: [],
    interactions: [],
    goalWorkflows: [],
  } as any)
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()

  applyEvent(
    messageUpdated({
      id: "msg_external_cumulative",
      sessionID: SID,
      role: "assistant",
      providerID: "codex-app-server",
      modelID: "codex-app-server",
      time: { created: T0 + 250 },
      tokens: { input: 3_889_000, output: 5_000, reasoning: 0, total: 3_894_000, cache: { read: 0, write: 0 } },
      cost: 0,
    }),
  )

  const cardID = `assistant:session:${SID}:message:msg_external_cumulative`
  const card = cardTreeStore.cards[cardID]
  expect(card).toBeDefined()
  expect(card!.usage?.totalTokens).toBe(3_894_000)
  expect(card!.contextTokens).toBeUndefined()
})

test("user messages do not get a usage chip even when tokens accidentally appear on info", async () => {
  setBoardStore("board", {
    task: { id: TASK_ID, status: "active", time: { created: T0 }, request: "test", attachments: [] },
    goals: [],
    interactions: [],
    goalWorkflows: [],
  } as any)
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()

  applyEvent(
    messageUpdated({
      id: "msg_user_1",
      sessionID: SID,
      role: "user",
      time: { created: T0 + 50 },
      // User messages carry no tokens in the schema, but a defensive
      // payload should never produce a usage chip on the user card.
      tokens: { input: 999, output: 999, reasoning: 0, total: 1_998, cache: { read: 0, write: 0 } },
      cost: 0.5,
    } as any),
  )

  const cards = Object.values(cardTreeStore.cards)
  const userCard = cards.find((c) => c.id.includes("msg_user_1"))
  expect(userCard).toBeDefined()
  expect(userCard!.usage).toBeUndefined()
  expect(userCard!.contextTokens).toBeUndefined()
})

test("user messages do not get a model chip even when provider fields accidentally appear", async () => {
  setBoardStore("board", {
    task: { id: TASK_ID, status: "active", time: { created: T0 }, request: "test", attachments: [] },
    goals: [],
    interactions: [],
    goalWorkflows: [],
  } as any)
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()

  applyEvent(
    messageUpdated({
      id: "msg_user_model",
      sessionID: SID,
      role: "user",
      providerID: "not-real-for-user",
      modelID: "ignored",
      time: { created: T0 + 50 },
    } as any),
  )

  const userCard = Object.values(cardTreeStore.cards).find((card) => card.id.includes("msg_user_model"))
  expect(userCard).toBeDefined()
  expect(userCard!.model).toBeUndefined()
})

// Regression for the cross-session conversation total. Each card carries
// its own per-message tokens (not cumulative); the aggregator sums them.
test("aggregateUsageAcrossSessions sums per-message usage across multiple sessions", async () => {
  setBoardStore("board", {
    task: { id: TASK_ID, status: "active", time: { created: T0 }, request: "test", attachments: [] },
    goals: [],
    interactions: [],
    goalWorkflows: [],
  } as any)
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()

  applyEvent(
    messageUpdated({
      id: "msg_orch_a",
      sessionID: "ses_orchestrator",
      role: "assistant",
      time: { created: T0 + 100 },
      tokens: { input: 500, output: 100, reasoning: 0, total: 600, cache: { read: 0, write: 0 } },
      cost: 0.01,
    }),
  )
  applyEvent(
    messageUpdated({
      id: "msg_orch_b",
      sessionID: "ses_orchestrator",
      role: "assistant",
      time: { created: T0 + 200 },
      tokens: { input: 800, output: 250, reasoning: 0, total: 1_050, cache: { read: 0, write: 0 } },
      cost: 0.025,
    }),
  )
  applyEvent(
    messageUpdated({
      id: "msg_build_a",
      sessionID: "ses_build_worker",
      role: "assistant",
      agent: "build",
      time: { created: T0 + 300 },
      tokens: { input: 4_000, output: 600, reasoning: 0, total: 4_600, cache: { read: 0, write: 0 } },
      cost: 0.08,
    }),
  )

  const agg = aggregateUsageAcrossSessions(Object.values(cardTreeStore.cards))
  // 600 + 1050 + 4600 = 6250 tokens; 0.01 + 0.025 + 0.08 = 0.115 USD.
  expect(agg.tokens).toBe(6_250)
  expect(agg.costUSD).toBeCloseTo(0.115, 5)
  expect(agg.estimated).toBe(false)
  expect(cardTreeStore.usageAggregate.tokens).toBe(agg.tokens)
  expect(cardTreeStore.usageAggregate.costUSD).toBeCloseTo(agg.costUSD, 5)
  expect(cardTreeStore.usageAggregate.estimated).toBe(agg.estimated)
  expect(formatUsageStrip(cardTreeStore.usageAggregate)).toBe("6.3k tok · $0.115")
})

test("message.removed subtracts deleted card usage from the store aggregate", async () => {
  setBoardStore("board", {
    task: { id: TASK_ID, status: "active", time: { created: T0 }, request: "test", attachments: [] },
    goals: [],
    interactions: [],
    goalWorkflows: [],
  } as any)
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()

  applyEvent(
    messageUpdated({
      id: "msg_removed_usage_a",
      sessionID: SID,
      role: "assistant",
      time: { created: T0 + 100 },
      tokens: { input: 500, output: 100, reasoning: 0, total: 600, cache: { read: 0, write: 0 } },
      cost: 0.01,
    }),
  )
  applyEvent(
    messageUpdated({
      id: "msg_removed_usage_b",
      sessionID: SID,
      role: "assistant",
      time: { created: T0 + 200 },
      tokens: { input: 800, output: 250, reasoning: 0, total: 1_050, cache: { read: 0, write: 0 } },
      cost: 0.025,
    }),
  )

  expect(cardTreeStore.usageAggregate.tokens).toBe(1_650)
  expect(cardTreeStore.usageAggregate.costUSD).toBeCloseTo(0.035, 5)

  applyEvent({
    type: "message.removed",
    properties: {
      taskID: TASK_ID,
      sessionID: SID,
      messageID: "msg_removed_usage_a",
    },
  })

  expect(cardTreeStore.cards[`assistant:session:${SID}:message:msg_removed_usage_a`]).toBeUndefined()
  expect(cardTreeStore.usageAggregate.tokens).toBe(1_050)
  expect(cardTreeStore.usageAggregate.costUSD).toBeCloseTo(0.025, 5)
  expect(cardTreeStore.usageAggregate.estimated).toBe(false)
})
