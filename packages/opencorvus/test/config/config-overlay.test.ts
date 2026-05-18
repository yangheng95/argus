import { describe, expect, test } from "bun:test"
import { Config } from "../../src/config/config"

describe("Config.Overlay schema (Phase 0)", () => {
  test("accepts the session-overridable subset (decision §6-1)", () => {
    const parsed = Config.Overlay.parse({
      model: "anthropic/claude-opus-4-7",
      prompt: { core_header: "custom header" },
      agent: {
        coding: { model: "anthropic/claude-sonnet-4-6", temperature: 0.2, prompt_append: "extra" },
      },
    })
    expect(parsed.model).toBe("anthropic/claude-opus-4-7")
    expect(parsed.agent?.coding?.temperature).toBe(0.2)
  })

  test("pinned invariant: rejects a top-level key outside the overlay set", () => {
    // permission / tools / mcp / provider must NOT be session-overridable.
    expect(() => Config.Overlay.parse({ permission: { edit: "allow" } } as never)).toThrow()
    expect(() => Config.Overlay.parse({ mcp: {} } as never)).toThrow()
  })

  test("pinned invariant: rejects a non-overridable agent sub-key (.strict)", () => {
    expect(() =>
      Config.Overlay.parse({ agent: { coding: { permission: { edit: "deny" } } } } as never),
    ).toThrow()
    expect(() => Config.Overlay.parse({ agent: { coding: { tools: { include: ["x"] } } } } as never)).toThrow()
  })
})

describe("Config.mergeOverlay (Phase 0)", () => {
  test("scalar present in overlay wins; absent inherits base", () => {
    const base = { model: "p/base", username: "u" } as never
    const out = Config.mergeOverlay(base, { model: "p/session" })
    expect(out.model).toBe("p/session")
    expect((out as { username: string }).username).toBe("u")
  })

  test("deep-merges nested agent without dropping sibling keys", () => {
    const base = { agent: { coding: { model: "p/base", temperature: 0.9 } } } as never
    const out = Config.mergeOverlay(base, { agent: { coding: { model: "p/session" } } })
    expect(out.agent?.coding?.model).toBe("p/session")
    expect((out.agent?.coding as { temperature: number }).temperature).toBe(0.9)
  })

  test("RFC 7396: null in overlay deletes the key (clears an override)", () => {
    const base = { model: "p/base", agent: { coding: { model: "p/x" } } } as never
    const out = Config.mergeOverlay(base, { model: null as never })
    expect("model" in out).toBe(false)
  })

  test("base is treated as immutable (fresh object returned)", () => {
    const base = { model: "p/base", agent: { coding: { temperature: 0.1 } } } as never
    const out = Config.mergeOverlay(base, { agent: { coding: { temperature: 0.7 } } })
    expect((base as { agent: { coding: { temperature: number } } }).agent.coding.temperature).toBe(0.1)
    expect(out.agent?.coding?.temperature).toBe(0.7)
    expect(out).not.toBe(base)
  })
})
