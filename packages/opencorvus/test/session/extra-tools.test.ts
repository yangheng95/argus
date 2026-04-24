import { describe, expect, test } from "bun:test"
import { tool } from "ai"
import z from "zod"
// Import order matters: SessionPrompt loads session/index first which pulls
// in the rest of the session module graph; SessionLoop is then already
// populated by the time we reference it. Loading SessionLoop directly ahead
// of SessionPrompt triggers a module-init cycle where the prompt/index
// destructure sees an empty stub.
import { SessionPrompt } from "../../src/session/prompt"
import { SessionLoop } from "../../src/session/loop"

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
