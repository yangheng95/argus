import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import "../../src/session/prompt"
import { ContextBudget } from "../../src/session/context-budget"
import { SessionLoop } from "../../src/session/loop"
import type { Message } from "../../src/session/message"
import type { Config } from "../../src/config/config"
import type { Provider } from "../../src/provider/provider"

const sessionLoopSourcePath = new URL("../../src/session/loop.ts", import.meta.url)

function model(input: Partial<Provider.Model["limit"]> = {}): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: {
      context: input.context ?? 100_000,
      input: input.input,
      output: input.output ?? 20_000,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model
}

function assistantMessage(id: string, input: Partial<Message.Assistant> = {}): Message.WithParts {
  return {
    info: {
      id,
      sessionID: "session",
      role: "assistant",
      time: { created: 0 },
      parentID: input.parentID ?? "user",
      modelID: input.modelID ?? "test-model",
      providerID: input.providerID ?? "test",
      agent: input.agent ?? "build",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      ...input,
    } as Message.Assistant,
    parts: [],
  }
}

function userMessage(id: string): Message.WithParts {
  return {
    info: {
      id,
      sessionID: "session",
      role: "user",
      time: { created: 0 },
      agent: "build",
      model: { providerID: "test", modelID: "test-model" },
    } as Message.User,
    parts: [],
  }
}

/**
 * Phase C of specs/new-arch/2026-04-28-structured-output-systemic-fix.md:
 * predictive compaction must NOT fire when compaction cannot rescue the
 * turn — either the tool schemas alone overrun budget (no shrink target),
 * the residue after a perfect compaction would still be over budget, or
 * the compressible message body is too small to absorb the overflow.
 *
 * `assistantMsgCount === 0` is no longer a hard fail-fast trigger; a jumbo
 * first user message can still be compactable.
 */
describe("SessionLoop.predictiveCompactionDecision", () => {
  const baseInput = {
    totalTokensEst: 100,
    limit: 200,
    usableBudget: 220,
    systemChars: 4_000,
    toolSchemaChars: 20_000,
    messagePayloadChars: 40_000,
    mediaTokensEst: 0,
    toolSchemaBudgetRatio: 0.5,
    lastFinishedSummary: false,
  }

  test("skips when usable budget is unknown (zero)", () => {
    const out = SessionLoop.predictiveCompactionDecision({ ...baseInput, usableBudget: 0 })
    expect(out.kind).toBe("skip")
  })

  test("skips when the previous turn was a compaction summary", () => {
    const out = SessionLoop.predictiveCompactionDecision({
      ...baseInput,
      lastFinishedSummary: true,
      totalTokensEst: 999,
    })
    expect(out.kind).toBe("skip")
  })

  test("skips when total tokens are within the predictive limit", () => {
    const out = SessionLoop.predictiveCompactionDecision({
      ...baseInput,
      totalTokensEst: 150,
      limit: 200,
    })
    expect(out.kind).toBe("skip")
  })

  test("fails fast when tool schemas alone overrun the budget ratio", () => {
    // toolSchemaChars=140K vs usableBudget=200K * ratio=0.5 = 100K → overrun
    const out = SessionLoop.predictiveCompactionDecision({
      ...baseInput,
      totalTokensEst: 250,
      limit: 200,
      usableBudget: 200_000,
      toolSchemaChars: 140_000,
      toolSchemaBudgetRatio: 0.5,
    })
    expect(out.kind).toBe("fail-tool-schema")
  })

  test("fails fast when post-compaction residue would still exceed the budget", () => {
    // system+tools alone are already over the limit, even with a 6K residue
    // the request can't shrink under the budget. usableBudget bumped to 2000
    // and toolSchemaBudgetRatio raised so the tool-schema rule does NOT
    // fire — we want to isolate the post-compaction-residue branch.
    const out = SessionLoop.predictiveCompactionDecision({
      ...baseInput,
      totalTokensEst: 1_000,
      limit: 800,
      usableBudget: 2_000,
      systemChars: 2_500,
      toolSchemaChars: 1_500,
      toolSchemaBudgetRatio: 0.95,
    })
    expect(out.kind).toBe("fail-prompt-budget")
    if (out.kind === "fail-prompt-budget") {
      expect(out.reason).toBe("post-compaction-still-over")
    }
  })

  test("fails fast when there is nothing meaningful to compress", () => {
    // overflow exists, but messagePayload (compressible) is tiny — compaction
    // cannot deliver enough headroom.
    const out = SessionLoop.predictiveCompactionDecision({
      ...baseInput,
      totalTokensEst: 60_000,
      limit: 50_000,
      usableBudget: 60_000,
      systemChars: 100_000,
      toolSchemaChars: 50_000,
      messagePayloadChars: 1_000, // tiny — nothing to fold up
      toolSchemaBudgetRatio: 0.95, // bypass tool-schema rule
    })
    // Either post-compaction-still-over or nothing-to-compress can trip
    // first depending on residue math; the contract is "do not compact".
    expect(out.kind).toBe("fail-prompt-budget")
  })

  test("compacts when there is enough compressible history to shrink under budget", () => {
    // overflow=1000 tokens, compressibleMessage=200K chars (50K tokens)
    // and post-compaction residue safely under limit.
    const out = SessionLoop.predictiveCompactionDecision({
      ...baseInput,
      totalTokensEst: 51_000,
      limit: 50_000,
      usableBudget: 60_000,
      systemChars: 4_000,
      toolSchemaChars: 6_000, // 10K non-compressible chars total
      messagePayloadChars: 200_000, // 50K tokens compressible
      toolSchemaBudgetRatio: 0.5,
    })
    expect(out.kind).toBe("compact")
  })

  test("a context-cold session with a compactable jumbo user message is allowed to compact", () => {
    // Scenario: step 1, assistantMsgCount === 0, user pasted a 200KB requirements doc.
    // Per spec the assistant count is no longer the gate — only the
    // compressibility math is.
    const out = SessionLoop.predictiveCompactionDecision({
      ...baseInput,
      totalTokensEst: 60_000,
      limit: 50_000,
      usableBudget: 60_000,
      systemChars: 3_000,
      toolSchemaChars: 5_000,
      messagePayloadChars: 240_000, // huge user paste — but compactable
      toolSchemaBudgetRatio: 0.5,
    })
    expect(out.kind).toBe("compact")
  })
})

describe("SessionLoop prompt final message selection", () => {
  test("loop input defaults to reply mode but accepts explicit summary mode", () => {
    expect(SessionLoop.LoopInput.parse({ sessionID: "ses_test" }).result_mode).toBeUndefined()
    expect(SessionLoop.LoopInput.parse({ sessionID: "ses_test", result_mode: "summary" }).result_mode).toBe("summary")
  })

  test("returns the newest non-summary assistant", () => {
    const current = assistantMessage("assistant-current")
    const summary = assistantMessage("assistant-summary", {
      agent: "compaction",
      summary: true,
      finish: "stop",
      structured: {},
    } as Partial<Message.Assistant>)

    const selected = SessionLoop.selectPromptFinalMessageFromNewest([
      current,
      summary,
      userMessage("user-root"),
    ])

    expect(selected.type).toBe("message")
    if (selected.type === "message") expect(selected.message.info.id).toBe("assistant-current")
  })

  test("classifies a latest compaction summary as maintenance, not a prompt result", () => {
    const selected = SessionLoop.selectPromptFinalMessageFromNewest([
      assistantMessage("assistant-summary", {
        agent: "compaction",
        summary: true,
        finish: "stop",
        structured: {},
      } as Partial<Message.Assistant>),
      assistantMessage("assistant-old", { finish: "tool-calls" }),
      userMessage("user-root"),
    ])

    expect(selected.type).toBe("maintenance-summary")
    if (selected.type === "maintenance-summary") expect(selected.message.info.id).toBe("assistant-summary")
  })

  test("preserves maintenance summary error details in reply-mode failures", () => {
    const message = assistantMessage("assistant-summary", {
      agent: "compaction",
      summary: true,
      finish: "error",
      error: {
        name: "StructuredOutputPayloadError",
        data: { message: "Compaction handoff omitted required evidence fields: files" },
      },
    } as Partial<Message.Assistant>)

    const text = SessionLoop.maintenanceSummaryFailureMessage(message)

    expect(text).toContain("internal compaction summary checkpoint")
    expect(text).toContain("StructuredOutputPayloadError")
    expect(text).toContain("omitted required evidence fields")
  })

  test("does not fall back to an older assistant before the newest user message", () => {
    const selected = SessionLoop.selectPromptFinalMessageFromNewest([
      userMessage("user-latest"),
      assistantMessage("assistant-old", { finish: "stop" }),
      userMessage("user-root"),
    ])

    expect(selected).toEqual({ type: "none" })
  })
})

describe("SessionLoop predictive compaction transcript hygiene", () => {
  test("removes the preflight assistant placeholder before creating compaction", async () => {
    const source = await fs.readFile(sessionLoopSourcePath, "utf8")
    const trigger = source.indexOf('if (decision.kind === "compact")')
    const create = source.indexOf("await SessionCompaction.create", trigger)
    const remove = source.indexOf("await Session.removeMessage", trigger)

    expect(trigger).toBeGreaterThan(0)
    expect(remove).toBeGreaterThan(trigger)
    expect(remove).toBeLessThan(create)
  })

  test("removes the reactive overflow assistant placeholder before creating compaction", async () => {
    const source = await fs.readFile(sessionLoopSourcePath, "utf8")
    const trigger = source.indexOf('if (result === "compact")')
    const enabledBranch = source.indexOf("overflow: true", trigger)
    const create = source.lastIndexOf("await SessionCompaction.create", enabledBranch)
    const remove = source.lastIndexOf("await Session.removeMessage", create)

    expect(trigger).toBeGreaterThan(0)
    expect(remove).toBeGreaterThan(trigger)
    expect(remove).toBeLessThan(create)
  })

  test("fail-fast branches persist visible assistant errors instead of throwing past the placeholder", async () => {
    const source = await fs.readFile(sessionLoopSourcePath, "utf8")

    expect(source).not.toContain("throw new Message.ToolSchemaBudgetError")
    expect(source).not.toContain("throw new Message.PromptBudgetOverflowError")
    expect(source).toContain("stopTurnWithPredictiveBudgetError")
    expect(source).toContain('processor.message.finish = "error"')
    expect(source).toContain("Predictive compaction budget error:")
    expect(source).toContain("await Session.updatePart")
  })
})

describe("ContextBudget predictive limit", () => {
  test("returns undefined when automatic compaction is disabled", () => {
    const limit = ContextBudget.predictiveLimit({
      config: { compaction: { auto: false } } as Config.Info,
      model: model(),
    })

    expect(limit).toBeUndefined()
  })

  test("uses the configured threshold and reserved budget", () => {
    const limit = ContextBudget.predictiveLimit({
      config: { compaction: { threshold: 0.5, reserved: 10_000 } } as Config.Info,
      model: model({ context: 100_000, input: 90_000, output: 20_000 }),
    })

    expect(limit).toEqual({
      usableBudget: 80_000,
      threshold: 0.5,
      limit: 40_000,
    })
  })

  test("applies reserved budget to context-only models", () => {
    const limit = ContextBudget.predictiveLimit({
      config: { compaction: { threshold: 0.5, reserved: 10_000 } } as Config.Info,
      model: model({ context: 100_000, output: 20_000 }),
    })

    expect(limit).toEqual({
      usableBudget: 90_000,
      threshold: 0.5,
      limit: 45_000,
    })
  })
})

describe("SessionLoop.estimateModelMessagePayload", () => {
  test("does not count inline image base64 as text payload", () => {
    const base64 = "a".repeat(1_600_000)
    const estimate = SessionLoop.estimateModelMessagePayload([
      {
        role: "user",
        content: [
          { type: "text", text: "please inspect chat ui.png" },
          {
            type: "file",
            mediaType: "image/png",
            filename: "chat ui.png",
            url: `data:image/png;base64,${base64}`,
          },
        ],
      },
    ] as any)

    expect(estimate.mediaCounts.image).toBe(1)
    expect(estimate.mediaTokensEst).toBe(1_600)
    expect(estimate.messagePayloadChars).toBeLessThan(1_000)
  })

  test("keeps ordinary jumbo text as compressible message payload", () => {
    const text = "x".repeat(120_000)
    const estimate = SessionLoop.estimateModelMessagePayload([
      { role: "user", content: [{ type: "text", text }] },
    ] as any)

    expect(estimate.mediaTokensEst).toBe(0)
    expect(estimate.messagePayloadChars).toBeGreaterThan(120_000)
  })
})
