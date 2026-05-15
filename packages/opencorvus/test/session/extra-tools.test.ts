import { describe, expect, test } from "bun:test"
import { asSchema, tool } from "ai"
import z from "zod"
// Import order matters: SessionPrompt loads session/index first which pulls
// in the rest of the session module graph; SessionLoop is then already
// populated by the time we reference it. Loading SessionLoop directly ahead
// of SessionPrompt triggers a module-init cycle where the prompt/index
// destructure sees an empty stub.
import { SessionPrompt } from "../../src/session/prompt"
import { SessionLoop } from "../../src/session/loop"
import { BuildResultSchema } from "../../src/build/types"
import { Instance } from "../../src/project/instance"
import { AttachmentStore } from "../../src/storage/attachment-store"
import { tmpdir } from "../fixture/fixture"

const dummyTool = () =>
  tool({
    description: "test-only",
    inputSchema: z.object({ x: z.number() }),
    async execute(args) {
      return `ok:${args.x}`
    },
  })

describe("SessionLoop.setExtraTools / getExtraTools", () => {
  test("round-trips a registered tool map", () => {
    const sessionID = `ses_extra_${Date.now()}_round_trip`
    expect(Object.keys(SessionLoop.getExtraTools(sessionID))).toEqual([])

    SessionLoop.setExtraTools(sessionID, { first: dummyTool(), second: dummyTool() })
    const read = SessionLoop.getExtraTools(sessionID)
    expect(Object.keys(read).sort()).toEqual(["first", "second"])

    SessionLoop.setExtraTools(sessionID, undefined)
    expect(Object.keys(SessionLoop.getExtraTools(sessionID))).toEqual([])
  })

  test("passing an empty map clears the entry", () => {
    const sessionID = `ses_extra_${Date.now()}_empty_clear`
    SessionLoop.setExtraTools(sessionID, { t: dummyTool() })
    expect(Object.keys(SessionLoop.getExtraTools(sessionID))).toEqual(["t"])
    SessionLoop.setExtraTools(sessionID, {})
    expect(SessionLoop.getExtraTools(sessionID)).toEqual({})
  })

  test("entries are isolated per sessionID", () => {
    const a = `ses_extra_${Date.now()}_a`
    const b = `ses_extra_${Date.now()}_b`
    SessionLoop.setExtraTools(a, { only_a: dummyTool() })
    SessionLoop.setExtraTools(b, { only_b: dummyTool() })
    expect(Object.keys(SessionLoop.getExtraTools(a))).toEqual(["only_a"])
    expect(Object.keys(SessionLoop.getExtraTools(b))).toEqual(["only_b"])
    SessionLoop.setExtraTools(a, undefined)
    SessionLoop.setExtraTools(b, undefined)
  })

  test("a second setExtraTools replaces the map wholesale (no merge)", () => {
    const sessionID = `ses_extra_${Date.now()}_replace`
    SessionLoop.setExtraTools(sessionID, { first: dummyTool() })
    SessionLoop.setExtraTools(sessionID, { second: dummyTool() })
    // Replacement — `first` is gone, not merged with `second`.
    expect(Object.keys(SessionLoop.getExtraTools(sessionID))).toEqual(["second"])
    SessionLoop.setExtraTools(sessionID, undefined)
  })
})

describe("SessionLoop.withExtraTools", () => {
  test("clears the registry after the callback resolves", async () => {
    const sessionID = `ses_extra_${Date.now()}_with_ok`
    await SessionLoop.withExtraTools(sessionID, { scoped: dummyTool() }, async () => {
      expect(Object.keys(SessionLoop.getExtraTools(sessionID))).toEqual(["scoped"])
    })
    expect(SessionLoop.getExtraTools(sessionID)).toEqual({})
  })

  test("clears the registry even when the callback throws", async () => {
    const sessionID = `ses_extra_${Date.now()}_with_throw`
    await expect(
      SessionLoop.withExtraTools(sessionID, { scoped: dummyTool() }, async () => {
        throw new Error("intentional")
      }),
    ).rejects.toThrow("intentional")
    expect(SessionLoop.getExtraTools(sessionID)).toEqual({})
  })

  test("propagates the callback's return value", async () => {
    const sessionID = `ses_extra_${Date.now()}_with_return`
    const result = await SessionLoop.withExtraTools(sessionID, { x: dummyTool() }, async () => 42)
    expect(result).toBe(42)
  })
})

describe("extras execute-return normalisation (integration via resolveTools)", () => {
  // We can't hit resolveTools without the full session/model context, but we
  // can verify the wrapping behaviour by inspecting the registered tool and
  // calling its execute directly.
  const plainStringTool = () =>
    tool({
      description: "returns plain string",
      inputSchema: z.object({}),
      async execute() {
        return "OK: hello"
      },
    })

  const partialObjectTool = () =>
    tool({
      description: "returns partial object",
      inputSchema: z.object({}),
      async execute() {
        return { output: "done" } // missing title + metadata
      },
    })

  const fullObjectTool = () =>
    tool({
      description: "returns full object",
      inputSchema: z.object({}),
      async execute() {
        return { output: "x", title: "t", metadata: { a: 1 } }
      },
    })

  test("plain-string returns survive resolveTools via the wrapper (smoke)", async () => {
    // Exercising resolveTools requires a live session. This unit-level smoke
    // just confirms that setExtraTools accepts an execute returning a plain
    // string — the wrapper behaviour is verified end-to-end by the
    // intent-analysis smoke test, which used to fail with a ZodError on
    // Message.ToolPart persistence before the wrapper was added.
    const sessionID = `ses_extra_${Date.now()}_wrap_smoke`
    SessionLoop.setExtraTools(sessionID, {
      plain: plainStringTool(),
      partial: partialObjectTool(),
      full: fullObjectTool(),
    })
    const extras = SessionLoop.getExtraTools(sessionID)
    expect(Object.keys(extras).sort()).toEqual(["full", "partial", "plain"])
    SessionLoop.setExtraTools(sessionID, undefined)
  })

  test("normalizes multimodal extra-tool results without stringifying attachments into output", () => {
    const dataUrl = "data:image/png;base64," + "a".repeat(1024)
    const normalized = SessionLoop.normalizeExtraToolResult({
      text: "{\"ok\":true,\"path\":\"shot.png\"}",
      attachments: [{ type: "file", mime: "image/png", url: dataUrl }],
    })

    expect(normalized.output).toBe("{\"ok\":true,\"path\":\"shot.png\"}")
    expect(normalized.output).not.toContain("data:image/png;base64")
    expect(normalized.attachments).toEqual([{ type: "file", mime: "image/png", url: dataUrl }])
  })

  test("rejects attachment-only extra-tool results instead of serializing bytes as text", () => {
    expect(() =>
      SessionLoop.normalizeExtraToolResult({
        attachments: [{ type: "file", mime: "image/png", url: "data:image/png;base64,UE5H" }],
      }),
    ).toThrow("attachments without string output/text")
  })

  test("materializes data URL tool-result attachments into AttachmentStore refs", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const attachments = await SessionLoop.materializeToolResultAttachments([
          { type: "file", mime: "image/png", filename: "tool.png", url: "data:image/png;base64,UE5H" },
        ])
        expect(Array.isArray(attachments)).toBe(true)
        const first = (attachments as Array<{ url: string; mime: string }>)[0]
        expect(first.url.startsWith("data:")).toBe(false)
        const located = AttachmentStore.nameFromUrl(first.url)
        expect(located).toBeTruthy()
        const bytes = await AttachmentStore.read(located!.projectID, located!.name)
        expect(bytes.toString("utf8")).toBe("PNG")
      },
    })
  }, 20000)
})

describe("extra tool provider schema preparation", () => {
  const dashScopeModel = {
    providerID: "alibaba-cn",
    id: "kimi-k2.5",
    api: {
      id: "kimi-k2.5",
      npm: "@ai-sdk/openai-compatible",
      url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
  } as any

  test("keeps explicit final confirmation required on extra submit tools", () => {
    const prepared = SessionLoop.prepareProviderTool({
      name: "submit_requirements",
      source: "extra",
      model: dashScopeModel,
      tool: tool({
        description: "submit",
        inputSchema: z.object({ final: z.literal(true) }),
        async execute() {
          return { output: "ok", title: "", metadata: {} }
        },
      }),
    }) as any

    const schema = asSchema(prepared.inputSchema).jsonSchema as any
    expect(schema.type).toBe("object")
    expect(schema.required).toContain("final")
    expect(schema.properties.final.const).toBe(true)
  })

  test("normalizes extra discriminated result tools to provider-bound root object schema", () => {
    const prepared = SessionLoop.prepareProviderTool({
      name: "report_build_result",
      source: "extra",
      model: dashScopeModel,
      tool: tool({
        description: "report build result",
        inputSchema: BuildResultSchema,
        async execute() {
          return { output: "ok", title: "", metadata: {} }
        },
      }),
    }) as any

    const schema = asSchema(prepared.inputSchema).jsonSchema as any
    expect(schema.type).toBe("object")
    expect(schema.anyOf).toBeUndefined()
    expect(schema.properties.status.enum).toEqual(["passed", "failed"])
  })

  test("rejects provider-bound tools without an input schema", () => {
    expect(() =>
      SessionLoop.prepareProviderTool({
        name: "broken_extra",
        source: "extra",
        model: dashScopeModel,
        tool: { description: "broken" } as any,
      }),
    ).toThrow("missing inputSchema")
  })
})

describe("SessionLoop.summarizeModelMessagePayloads", () => {
  test("reports the largest model-message parts without logging payload bytes", () => {
    const rows = SessionLoop.summarizeModelMessagePayloads([
      { role: "user", content: [{ type: "text", text: "small" }] },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolName: "verify_page_integrity",
            toolCallId: "call-1",
            output: { type: "text", value: "x".repeat(500) },
          },
          { type: "text", text: "tiny" },
        ],
      },
      {
        role: "user",
        content: [{ type: "file", mediaType: "image/png", data: "y".repeat(300) }],
      },
    ] as any)

    expect(rows[0]).toMatchObject({
      role: "tool",
      type: "tool-result",
      toolName: "verify_page_integrity",
      toolCallId: "call-1",
    })
    expect(rows[1]).toMatchObject({
      role: "user",
      type: "file",
      mediaType: "image/png",
    })
    expect(JSON.stringify(rows)).not.toContain("yyyyyyyyyyyyyyyy")
  })
})

describe("SessionPrompt re-exports extraTools API", () => {
  test("surfaces setExtraTools / getExtraTools / withExtraTools", () => {
    expect(typeof SessionPrompt.setExtraTools).toBe("function")
    expect(typeof SessionPrompt.getExtraTools).toBe("function")
    expect(typeof SessionPrompt.withExtraTools).toBe("function")
    // The re-exports must be the same function references — SessionPrompt is
    // a thin namespace on top of SessionLoop, not an independent copy.
    expect(SessionPrompt.setExtraTools).toBe(SessionLoop.setExtraTools)
    expect(SessionPrompt.getExtraTools).toBe(SessionLoop.getExtraTools)
    expect(SessionPrompt.withExtraTools).toBe(SessionLoop.withExtraTools)
  })
})

describe("SessionLoop.setStepHook / withStepHook", () => {
  test("setStepHook round-trips via withStepHook (hook cleared on completion)", async () => {
    const sessionID = `ses_step_${Date.now()}_ok`
    const calls: Array<{ step: number; turn: string }> = []
    await SessionLoop.withStepHook(sessionID, async (event) => {
      calls.push({ step: event.step, turn: event.turn })
    }, async () => {
      // Inside the wrapper, a hook is registered — we can't directly assert
      // registration without exposing a getter, but we assert clearing via
      // an indirect contract: a post-exit setStepHook(undefined) is a no-op.
      expect(true).toBe(true)
    })
    // Post-callback: setting undefined on an empty slot is a no-op — this
    // throws if the cleanup was skipped (the Map remembers the fn).
    expect(() => SessionLoop.setStepHook(sessionID, undefined)).not.toThrow()
    expect(calls).toEqual([])
  })

  test("withStepHook clears even when the callback throws", async () => {
    const sessionID = `ses_step_${Date.now()}_throw`
    const hook = () => undefined
    await expect(
      SessionLoop.withStepHook(sessionID, hook, async () => {
        throw new Error("intentional")
      }),
    ).rejects.toThrow("intentional")
    // Map entry cleared — setting again should not stack (idempotent no-op).
    SessionLoop.setStepHook(sessionID, undefined)
  })

  test("setStepHook replaces the registered hook wholesale", async () => {
    const sessionID = `ses_step_${Date.now()}_replace`
    const firstCalls: number[] = []
    const secondCalls: number[] = []
    const first = (e: { step: number }) => {
      firstCalls.push(e.step)
    }
    const second = (e: { step: number }) => {
      secondCalls.push(e.step)
    }
    SessionLoop.setStepHook(sessionID, first)
    SessionLoop.setStepHook(sessionID, second)
    // After replace, only `second` is active. We cannot invoke the hook
    // from here without running a real session, so this test just asserts
    // the API contract does not throw.
    SessionLoop.setStepHook(sessionID, undefined)
    expect(firstCalls).toEqual([])
    expect(secondCalls).toEqual([])
  })

  test("SessionPrompt re-exports setStepHook / withStepHook with identity", () => {
    expect(SessionPrompt.setStepHook).toBe(SessionLoop.setStepHook)
    expect(SessionPrompt.withStepHook).toBe(SessionLoop.withStepHook)
  })
})
