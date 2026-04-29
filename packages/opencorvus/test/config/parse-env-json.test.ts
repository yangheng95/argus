import { describe, expect, test } from "bun:test"
import { parseEnvJson } from "../../src/config/parse-env-json"

/**
 * audit-2026-04-29 W2-V22. Pre-fix the config loader did
 *   JSON.parse(Flag.OPENCORVUS_PERMISSION)
 * with no try/catch. A user with a typo (missing quote, trailing
 * comma) saw the bare engine error
 *   "Unexpected token } in JSON at position 17"
 * with no hint that the cause was their env var — config bootstrap
 * aborted and the sidecar refused to start without telling the
 * operator where to look.
 *
 * parseEnvJson wraps with a named throw that names the var AND
 * echoes the offending value (truncated for safety).
 */

describe("parseEnvJson (audit W2-V22)", () => {
  test("returns the parsed value on valid JSON", () => {
    expect(parseEnvJson("FOO", `{"a":1}`)).toEqual({ a: 1 })
    expect(parseEnvJson("FOO", `[1,2,3]`)).toEqual([1, 2, 3])
    expect(parseEnvJson("FOO", `"hello"`)).toBe("hello")
    expect(parseEnvJson("FOO", `42`)).toBe(42)
    expect(parseEnvJson("FOO", `null`)).toBe(null)
    expect(parseEnvJson("FOO", `true`)).toBe(true)
  })

  test("throws on malformed JSON with the env var name in the message", () => {
    try {
      parseEnvJson("OPENCORVUS_PERMISSION", `{a:1}`) // unquoted key
      throw new Error("expected throw")
    } catch (err) {
      expect(err instanceof Error).toBe(true)
      expect((err as Error).message).toContain("OPENCORVUS_PERMISSION")
      expect((err as Error).message).toContain("not valid JSON")
    }
  })

  test("error message includes the offending value (preview)", () => {
    try {
      parseEnvJson("FOO", `{"unterminated":`)
    } catch (err) {
      expect((err as Error).message).toContain(`Got: {"unterminated":`)
      return
    }
    throw new Error("expected throw")
  })

  test("error message truncates long input to 200 chars + ellipsis", () => {
    const long = `{"x":"` + "a".repeat(500) + `,broken`
    try {
      parseEnvJson("FOO", long)
    } catch (err) {
      const m = (err as Error).message
      // "Got: " prefix + 200 chars + ellipsis. Total preview length
      // strictly bounded so log lines don't blow up on huge envs.
      expect(m).toContain("…")
      // The first 200 chars of long should appear; the final
      // ",broken" should NOT (truncated).
      expect(m.includes(",broken")).toBe(false)
      return
    }
    throw new Error("expected throw")
  })

  test("trailing comma (common typo) produces actionable error", () => {
    try {
      parseEnvJson("OPENCORVUS_PERMISSION", `{"foo": "bar",}`)
    } catch (err) {
      expect((err as Error).message).toContain("OPENCORVUS_PERMISSION")
      expect((err as Error).message).toContain(`{"foo": "bar",}`)
      return
    }
    throw new Error("expected throw")
  })

  test("empty string throws (not silently treated as undefined)", () => {
    expect(() => parseEnvJson("FOO", "")).toThrow(/not valid JSON/)
  })
})
