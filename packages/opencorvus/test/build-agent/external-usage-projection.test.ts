import { describe, expect, test } from "bun:test"
import { applyExternalUsageToAssistantMessage } from "../../src/build/agent"
import type { Message } from "../../src/session/message"

/**
 * The external-executor `case "usage"` path is the single source for
 * tokens/cost when build runs through claude-agent / codex-app-server.
 * It must write directly onto the active assistantMessage row so the
 * subsequent `Session.updateMessage` publishes a `message.updated` event
 * carrying the totals. The overlay then projects `info.tokens` /
 * `info.cost` onto the card via tree-writer's `handleMessageUpdated`.
 *
 * No `usage.updated` protocol event is involved — message-row is the
 * single source (rule 8: 禁止双源).
 */

function freshAssistantMessage(): Message.Assistant {
  return {
    id: "msg_external_usage",
    sessionID: "ses_external_usage",
    role: "assistant",
    agent: "build",
    parentID: "msg_user",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: Date.now() },
    modelID: "claude-agent",
    providerID: "claude-agent",
    path: { cwd: "/tmp", root: "/tmp" },
  } as Message.Assistant
}

describe("applyExternalUsageToAssistantMessage", () => {
  test("writes cumulative totals from a single result-style usage event (claude-agent shape)", () => {
    const msg = freshAssistantMessage()
    applyExternalUsageToAssistantMessage(msg, {
      type: "usage",
      inputTokens: 12_500,
      outputTokens: 3_400,
      totalTokens: 15_900,
      costUSD: 0.4521,
    })
    expect(msg.tokens.input).toBe(12_500)
    expect(msg.tokens.output).toBe(3_400)
    expect(msg.tokens.total).toBe(15_900)
    expect(msg.cost).toBe(0.4521)
  })

  test("overwrites (not accumulates) when codex-app-server emits successive cumulative pings", () => {
    // codex-app-server fires `thread/tokenUsage/updated` repeatedly; the
    // payload is always the running total for the thread, not a delta.
    const msg = freshAssistantMessage()
    applyExternalUsageToAssistantMessage(msg, {
      type: "usage",
      inputTokens: 1_000,
      outputTokens: 200,
      totalTokens: 1_200,
    })
    applyExternalUsageToAssistantMessage(msg, {
      type: "usage",
      inputTokens: 1_400,
      outputTokens: 350,
      totalTokens: 1_750,
    })
    // Latest event wins — no double-counting.
    expect(msg.tokens.input).toBe(1_400)
    expect(msg.tokens.output).toBe(350)
    expect(msg.tokens.total).toBe(1_750)
  })

  test("derives totalTokens from input + output when the event omits it", () => {
    const msg = freshAssistantMessage()
    applyExternalUsageToAssistantMessage(msg, {
      type: "usage",
      inputTokens: 800,
      outputTokens: 200,
    })
    expect(msg.tokens.total).toBe(1_000)
  })

  test("preserves reasoning + cache counters that the external executor doesn't report", () => {
    const msg = freshAssistantMessage()
    msg.tokens.reasoning = 17
    msg.tokens.cache = { read: 5, write: 9 }
    applyExternalUsageToAssistantMessage(msg, {
      type: "usage",
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    })
    expect(msg.tokens.reasoning).toBe(17)
    expect(msg.tokens.cache).toEqual({ read: 5, write: 9 })
  })

  test("no-ops when every numeric field is absent (a meta-only usage ping)", () => {
    const msg = freshAssistantMessage()
    msg.cost = 0.2
    msg.tokens = { input: 11, output: 22, reasoning: 0, total: 33, cache: { read: 0, write: 0 } }
    applyExternalUsageToAssistantMessage(msg, { type: "usage" })
    expect(msg.cost).toBe(0.2)
    expect(msg.tokens.input).toBe(11)
    expect(msg.tokens.output).toBe(22)
    expect(msg.tokens.total).toBe(33)
  })
})
