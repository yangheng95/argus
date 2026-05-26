import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { SessionCompaction } from "../../src/session/compaction"
import { CompactionHandoff } from "../../src/session/compaction-handoff"
import { Token } from "../../src/util/token"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { Session } from "../../src/session"
import { Message } from "../../src/session/message"
import type { Provider } from "../../src/provider/provider"
import type { Config } from "../../src/config/config"
import { Todo } from "../../src/session/todo"

Log.init({ print: false })

function handoffFixture(): CompactionHandoff.Info {
  return {
    objective: "Harden compaction handoff so session continuation keeps requirements intact",
    acceptanceCriteria: ["The handoff must preserve exact acceptance criteria and command evidence"],
    durableInstructionSources: [{ path: "/repo/AGENTS.md", role: "project rules" }],
    activeBuildContracts: [],
    todos: [
      {
        content: "Run targeted compaction tests",
        status: "pending",
        priority: "high",
      },
    ],
    currentState: {
      phase: "implementing structured handoff validation",
      activeTask: "replace generic Markdown summary with host-rendered handoff",
      sourceUserMessage: {
        id: "m-user",
        agent: "build",
        model: { providerID: "test", modelID: "test-model" },
        formatType: "text",
        systemMode: null,
        toolNames: ["shell"],
        variant: null,
        extraKeys: ["task"],
      },
    },
    decisions: [
      {
        decision: "Store validated handoff data in assistant.structured",
        rationale: "Boundary checks need a machine-validated source",
        evidence: "packages/opencorvus/src/session/compaction.ts",
      },
    ],
    evidence: [
      {
        kind: "command",
        value: "bun test packages/opencorvus/test/session/compaction.test.ts",
        detail: "targeted compaction contract test command",
      },
    ],
    files: [
      {
        path: "packages/opencorvus/src/session/compaction-handoff.ts",
        status: "created",
        detail: "single handoff schema and renderer",
      },
    ],
    testsAndCommands: [
      {
        command: "bun test packages/opencorvus/test/session/compaction.test.ts",
        result: "pending local verification",
        evidence: "test command captured before final gate",
      },
    ],
    errorsAndBlockers: [],
    userMessages: ["Fix compaction so it preserves resumable task state."],
    nextActions: ["run the targeted compaction contract test"],
    openRisks: ["full typecheck may expose unrelated dirty workspace issues"],
  }
}

describe("CompactionHandoff", () => {
  test("rejects generic placeholder actions", () => {
    const invalid = {
      ...handoffFixture(),
      nextActions: ["continue implementation"],
    }

    expect(CompactionHandoff.Schema.safeParse(invalid).success).toBe(false)
  })

  test("parses schema object and renders deterministic Markdown", () => {
    const handoff = handoffFixture()
    const parsed = CompactionHandoff.Schema.parse(handoff)
    const first = CompactionHandoff.renderMarkdown(parsed)
    const second = CompactionHandoff.renderMarkdown(parsed)

    expect(first).toBe(second)
    expect(
      first.startsWith("This session is being continued from a previous conversation that ran out of context."),
    ).toBe(true)
    expect(first).toContain("Summary:")
    expect(first).toContain("1. Primary Request and Intent:")
    expect(first).toContain("7. Todo List (verbatim):")
    expect(first).toContain("9. Current Work:")
    expect(first).toContain("10. Optional Next Step:")
    expect(first).toContain("Acceptance: The handoff must preserve exact acceptance criteria and command evidence")
    expect(first).toContain('"content": "Run targeted compaction tests"')
    expect(first).toContain("Fix compaction so it preserves resumable task state.")
    expect(first).toContain("bun test packages/opencorvus/test/session/compaction.test.ts")
    expect(first).toContain("packages/opencorvus/src/session/compaction-handoff.ts")
  })

  test("rejects schema-valid handoff that omits required input evidence", () => {
    const handoff = {
      ...handoffFixture(),
      userMessages: [],
      files: [],
      evidence: [],
    }

    const result = CompactionHandoff.validateMinimumEvidence(handoff, {
      sourceUserMessageID: "m-user",
      instructionPaths: ["/repo/AGENTS.md"],
      patchFiles: ["packages/opencorvus/src/session/compaction-handoff.ts"],
      errorNames: [],
      userMessages: true,
      fileEvidence: true,
      errorsAndBlockers: false,
      acceptanceCriteria: true,
      todos: handoffFixture().todos,
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain("userMessages")
      expect(result.error).toContain("files")
    }
  })

  test("accepts explicit empty arrays only when input facts prove those fields absent", () => {
    const handoff = {
      ...handoffFixture(),
      files: [],
      testsAndCommands: [],
      errorsAndBlockers: [],
      openRisks: [],
    }

    const result = CompactionHandoff.validateMinimumEvidence(handoff, {
      sourceUserMessageID: "m-user",
      instructionPaths: ["/repo/AGENTS.md"],
      patchFiles: [],
      errorNames: [],
      userMessages: true,
      fileEvidence: false,
      errorsAndBlockers: false,
      acceptanceCriteria: true,
      todos: handoffFixture().todos,
    })

    expect(result.success).toBe(true)
  })

  test("rejects handoff todos that do not exactly match runtime todo order and fields", () => {
    const handoff = {
      ...handoffFixture(),
      todos: [
        {
          content: "Run targeted compaction tests",
          status: "in_progress",
          priority: "high",
        },
      ],
    }

    const result = CompactionHandoff.validateMinimumEvidence(handoff, {
      sourceUserMessageID: "m-user",
      instructionPaths: ["/repo/AGENTS.md"],
      patchFiles: [],
      errorNames: [],
      userMessages: true,
      fileEvidence: false,
      errorsAndBlockers: false,
      acceptanceCriteria: true,
      todos: handoffFixture().todos,
    })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toContain("todos")
  })

  test("rejects non-empty handoff evidence that does not match runtime facts", () => {
    const handoff = {
      ...handoffFixture(),
      currentState: {
        ...handoffFixture().currentState,
        sourceUserMessage: {
          ...handoffFixture().currentState.sourceUserMessage,
          id: "forged-user",
        },
      },
      durableInstructionSources: [{ path: "/repo/OTHER.md", role: "wrong source" }],
      files: [{ path: "forged.ts", status: "modified", detail: "not present in patch evidence" }],
    } satisfies CompactionHandoff.Info

    const result = CompactionHandoff.validateMinimumEvidence(handoff, {
      sourceUserMessageID: "m-user",
      instructionPaths: ["/repo/AGENTS.md"],
      patchFiles: ["packages/opencorvus/src/session/compaction-handoff.ts"],
      errorNames: [],
      userMessages: true,
      fileEvidence: true,
      errorsAndBlockers: false,
      acceptanceCriteria: true,
      todos: handoffFixture().todos,
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain("currentState.sourceUserMessage.id")
      expect(result.error).toContain("durableInstructionSources")
      expect(result.error).toContain("files")
    }
  })

  test("requires every runtime patch file and error name to be reported exactly", () => {
    const handoff = {
      ...handoffFixture(),
      files: [{ path: "a.ts", status: "modified", detail: "first runtime patch file" }],
      evidence: [
        {
          kind: "error",
          value: "NotAPIErrorFake",
          detail: "substring spoof must not satisfy exact error-name evidence",
        },
      ],
      errorsAndBlockers: [],
    } satisfies CompactionHandoff.Info

    const result = CompactionHandoff.validateMinimumEvidence(handoff, {
      sourceUserMessageID: "m-user",
      instructionPaths: ["/repo/AGENTS.md"],
      patchFiles: ["a.ts", "b.ts"],
      errorNames: ["APIError", "ToolSchemaBudgetError"],
      userMessages: true,
      fileEvidence: true,
      errorsAndBlockers: true,
      acceptanceCriteria: true,
      todos: handoffFixture().todos,
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain("files")
      expect(result.error).toContain("errorsAndBlockers")
    }
  })

  test("host prompt always includes the structured handoff schema", () => {
    const prompt = SessionCompaction.buildPrompt({
      previousSummary: undefined,
      runtime: "<handoff-runtime-state></handoff-runtime-state>",
      context: ["plugin context"],
    })

    expect(prompt).toContain("CompactionHandoff schema")
    expect(prompt).toContain('"durableInstructionSources"')
    expect(prompt).toContain('"todos"')
    expect(prompt).toContain('"userMessages"')
    expect(prompt).toContain("If the StructuredOutput tool returns an error")
    expect(prompt).toContain("plugin context")
  })

  test("handoff output format exposes the CompactionHandoff schema for StructuredOutput", () => {
    const format = SessionCompaction.handoffOutputFormat()

    expect(format.type).toBe("json_schema")
    expect(format.schema).toMatchObject({
      type: "object",
      required: expect.arrayContaining(["objective", "currentState", "todos", "nextActions"]),
    })
    expect(format.retryCount).toBe(2)
    expect(JSON.stringify(format.schema)).toContain("activeBuildContracts")
  })

  test("validates StructuredOutput payloads instead of accepting fenced JSON text", () => {
    const handoff = handoffFixture()
    const requirements: CompactionHandoff.EvidenceRequirements = {
      sourceUserMessageID: "m-user",
      instructionPaths: ["/repo/AGENTS.md"],
      patchFiles: [],
      errorNames: [],
      userMessages: true,
      fileEvidence: false,
      errorsAndBlockers: false,
      acceptanceCriteria: true,
      todos: handoff.todos,
    }

    expect(SessionCompaction.validateHandoffPayload(handoff, requirements).success).toBe(true)
    const fenced = `\`\`\`json\n${JSON.stringify(handoff)}\n\`\`\``
    const invalid = SessionCompaction.validateHandoffPayload(fenced, requirements)
    expect(invalid.success).toBe(false)
    if (!invalid.success) expect(invalid.error).toContain("expected object")
  })

  test("request budget preflight catches oversize compaction payloads", () => {
    const model = createModel({ context: 100, output: 10 })
    const config = {} as Config.Info

    const oversized = SessionCompaction.requestBudget({
      messages: [{ role: "user", content: "x".repeat(1_000) }],
      config,
      model,
    })
    const normal = SessionCompaction.requestBudget({
      messages: [{ role: "user", content: "short" }],
      config,
      model,
    })

    expect(oversized.exceeds).toBe(true)
    expect(normal.exceeds).toBe(false)
  })

  test("runtime context injects current todos as exact structured handoff requirements", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "todo compaction" })
        const todos = [
          { content: "Keep exact todo text", status: "in_progress", priority: "high" },
          { content: "Do not reorder this item", status: "pending", priority: "medium" },
        ]
        Todo.update({ sessionID: session.id, todos })
        const user = {
          id: "m-user",
          sessionID: session.id,
          role: "user",
          time: { created: 0 },
          agent: "build",
          model: { providerID: "test", modelID: "test-model" },
        } as Message.User

        const runtime = await SessionCompaction.TestHooks.runtimeContext({
          sessionID: session.id,
          userMessage: user,
          selectedHead: [],
        })

        expect(runtime.text).toContain("Current todos. Copy this JSON array exactly")
        expect(runtime.text).toContain('"content": "Keep exact todo text"')
        expect(runtime.evidenceRequirements.todos).toEqual(todos)
      },
    })
  })
})

function createModel(opts: {
  context: number
  output: number
  input?: number
  cost?: Provider.Model["cost"]
  npm?: string
}): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: {
      context: opts.context,
      input: opts.input,
      output: opts.output,
    },
    cost: opts.cost ?? { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: opts.npm ?? "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model
}

describe("session.compaction.isOverflow", () => {
  test("returns true when token count exceeds usable context", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 32_000 })
        const tokens = { input: 75_000, output: 5_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(true)
      },
    })
  })

  test("returns false when token count within usable context", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 200_000, output: 32_000 })
        const tokens = { input: 100_000, output: 10_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(false)
      },
    })
  })

  test("includes cache.read in token count", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 32_000 })
        const tokens = { input: 60_000, output: 10_000, reasoning: 0, cache: { read: 10_000, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(true)
      },
    })
  })

  test("respects input limit for input caps", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 400_000, input: 272_000, output: 128_000 })
        const tokens = { input: 271_000, output: 1_000, reasoning: 0, cache: { read: 2_000, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(true)
      },
    })
  })

  test("returns false when below input-limit compaction threshold", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 400_000, input: 272_000, output: 128_000 })
        const tokens = { input: 120_000, output: 20_000, reasoning: 0, cache: { read: 10_000, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(false)
      },
    })
  })

  test("default auto-compaction threshold is eighty percent of usable input budget", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 20_000 })
        // usable = 100_000 - reserved(20_000) = 80_000; threshold 0.8 → limit 64_000.
        // usageCount = input + output + cache, so 62_000 + 1_000 = 63_000 stays
        // under 64_000 and must not trigger isOverflow.
        const tokens = { input: 62_000, output: 1_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(false)
      },
    })
  })

  test("returns false when output within limit with input caps", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 200_000, input: 120_000, output: 10_000 })
        const tokens = { input: 50_000, output: 9_999, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(false)
      },
    })
  })

  test("reserves headroom when limit.input is set", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 200_000, input: 200_000, output: 32_000 })
        const tokens = { input: 180_000, output: 15_000, reasoning: 0, cache: { read: 3_000, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(true)
      },
    })
  })

  test("without limit.input, same token count triggers compaction", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 200_000, output: 32_000 })
        const tokens = { input: 180_000, output: 15_000, reasoning: 0, cache: { read: 3_000, write: 0 } }

        const result = await SessionCompaction.isOverflow({ tokens, model })
        expect(result).toBe(true)
      },
    })
  })

  test("input-limit and context-only models compact consistently near the boundary", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const withInputLimit = createModel({ context: 200_000, input: 200_000, output: 32_000 })
        const withoutInputLimit = createModel({ context: 200_000, output: 32_000 })
        const tokens = { input: 166_000, output: 10_000, reasoning: 0, cache: { read: 5_000, write: 0 } }

        const withLimit = await SessionCompaction.isOverflow({ tokens, model: withInputLimit })
        const withoutLimit = await SessionCompaction.isOverflow({ tokens, model: withoutInputLimit })

        expect(withLimit).toBe(true)
        expect(withoutLimit).toBe(true)
      },
    })
  })

  test("returns false when model context limit is 0", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 0, output: 32_000 })
        const tokens = { input: 100_000, output: 10_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(false)
      },
    })
  })

  test("returns false when compaction.auto is disabled", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const configDir = path.join(dir, ".opencorvus")
        await fs.mkdir(configDir, { recursive: true })
        await Bun.write(
          path.join(configDir, "opencorvus.json"),
          JSON.stringify({
            compaction: { auto: false },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 32_000 })
        const tokens = { input: 75_000, output: 5_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(false)
      },
    })
  })
})

describe("util.token.estimate", () => {
  test("estimates tokens from text (4 chars per token)", () => {
    const text = "x".repeat(4000)
    expect(Token.estimate(text)).toBe(1000)
  })

  test("estimates tokens from larger text", () => {
    const text = "y".repeat(20_000)
    expect(Token.estimate(text)).toBe(5000)
  })

  test("returns 0 for empty string", () => {
    expect(Token.estimate("")).toBe(0)
  })
})

describe("session.getUsage", () => {
  test("normalizes standard usage to token format", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      },
    })

    expect(result.tokens.input).toBe(1000)
    expect(result.tokens.output).toBe(500)
    expect(result.tokens.reasoning).toBe(0)
    expect(result.tokens.cache.read).toBe(0)
    expect(result.tokens.cache.write).toBe(0)
  })

  test("extracts cached tokens to cache.read", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokens: 200,
      },
    })

    expect(result.tokens.input).toBe(800)
    expect(result.tokens.cache.read).toBe(200)
  })

  test("handles anthropic cache write metadata", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      },
      metadata: {
        anthropic: {
          cacheCreationInputTokens: 300,
        },
      },
    })

    expect(result.tokens.cache.write).toBe(300)
  })

  test("does not subtract cached tokens for anthropic provider", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokens: 200,
      },
      metadata: {
        anthropic: {},
      },
    })

    expect(result.tokens.input).toBe(1000)
    expect(result.tokens.cache.read).toBe(200)
  })

  test("handles reasoning tokens", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        reasoningTokens: 100,
      },
    })

    expect(result.tokens.reasoning).toBe(100)
  })

  test("handles undefined optional values gracefully", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    })

    expect(result.tokens.input).toBe(0)
    expect(result.tokens.output).toBe(0)
    expect(result.tokens.reasoning).toBe(0)
    expect(result.tokens.cache.read).toBe(0)
    expect(result.tokens.cache.write).toBe(0)
    expect(Number.isNaN(result.cost)).toBe(false)
  })

  test("calculates cost correctly", () => {
    const model = createModel({
      context: 100_000,
      output: 32_000,
      cost: {
        input: 3,
        output: 15,
        cache: { read: 0.3, write: 3.75 },
      },
    })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        totalTokens: 1_100_000,
      },
    })

    expect(result.cost).toBe(3 + 1.5)
  })

  test.each(["@ai-sdk/anthropic", "@ai-sdk/amazon-bedrock", "@ai-sdk/google-vertex/anthropic"])(
    "computes total from components for %s models",
    (npm) => {
      const model = createModel({ context: 100_000, output: 32_000, npm })
      const usage = {
        inputTokens: 1000,
        outputTokens: 500,
        // These providers typically report total as input + output only,
        // excluding cache read/write.
        totalTokens: 1500,
        cachedInputTokens: 200,
      }
      if (npm === "@ai-sdk/amazon-bedrock") {
        const result = Session.getUsage({
          model,
          usage,
          metadata: {
            bedrock: {
              usage: {
                cacheWriteInputTokens: 300,
              },
            },
          },
        })

        expect(result.tokens.input).toBe(1000)
        expect(result.tokens.cache.read).toBe(200)
        expect(result.tokens.cache.write).toBe(300)
        expect(result.tokens.total).toBe(2000)
        return
      }

      const result = Session.getUsage({
        model,
        usage,
        metadata: {
          anthropic: {
            cacheCreationInputTokens: 300,
          },
        },
      })

      expect(result.tokens.input).toBe(1000)
      expect(result.tokens.cache.read).toBe(200)
      expect(result.tokens.cache.write).toBe(300)
      expect(result.tokens.total).toBe(2000)
    },
  )
})
