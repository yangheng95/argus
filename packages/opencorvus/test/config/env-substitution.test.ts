import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ConfigPaths } from "../../src/config/paths"
import { Log } from "../../src/util/log"

Log.init({ print: false })

/**
 * audit-2026-04-29 W2-V23. The `{env:VAR}` substitution branch of
 * ConfigPaths.parseText IGNORED the `missing: "error" | "empty"`
 * parameter. Pre-fix `process.env[varName] || ""` always replaced
 * an unset env var with empty string regardless of mode. A config
 * referencing `{env:DATABASE_URL}` for a required field silently
 * bound to "", slipped past zod's `.url()` validator, and the
 * sidecar tried to connect to a blank DSN.
 *
 * Post-fix:
 *   - `value === undefined` (UNSET) + missing="error" → throw
 *     naming the variable.
 *   - `value === ""` (EXPLICITLY-EMPTY) is honoured — operator
 *     intent.
 *   - missing="empty" mode keeps the silent-empty fallback for callers that explicitly request it.
 */

describe("ConfigPaths {env:VAR} substitution (audit W2-V23)", () => {
  const SAVED_VARS = ["W2_V23_PRESENT", "W2_V23_EMPTY", "W2_V23_MISSING"]
  const previousValues: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of SAVED_VARS) {
      previousValues[k] = process.env[k]
    }
    process.env.W2_V23_PRESENT = "real-value"
    process.env.W2_V23_EMPTY = ""
    delete process.env.W2_V23_MISSING
  })

  afterEach(() => {
    for (const k of SAVED_VARS) {
      if (previousValues[k] === undefined) delete process.env[k]
      else process.env[k] = previousValues[k]
    }
  })

  function fakeSource() {
    return { source: "<test>", dir: "/tmp" }
  }

  test("present env var substitutes its value (default error mode)", async () => {
    const json = await ConfigPaths.parseText(`{"x": "{env:W2_V23_PRESENT}"}`, fakeSource())
    expect(json).toEqual({ x: "real-value" })
  })

  test("explicitly-empty env var substitutes to '' (operator-intentional)", async () => {
    const json = await ConfigPaths.parseText(`{"x": "{env:W2_V23_EMPTY}"}`, fakeSource())
    expect(json).toEqual({ x: "" })
  })

  test("UNSET env var in 'error' mode (default) throws naming the variable", async () => {
    await expect(ConfigPaths.parseText(`{"x": "{env:W2_V23_MISSING}"}`, fakeSource())).rejects.toThrow(/W2_V23_MISSING/)
  })

  test("UNSET env var error message names the source for triage", async () => {
    try {
      await ConfigPaths.parseText(`{"x": "{env:W2_V23_MISSING}"}`, fakeSource())
    } catch (err) {
      const m = (err as Error).message
      expect(m).toContain("W2_V23_MISSING")
      expect(m).toContain("<test>")
      return
    }
    throw new Error("expected throw")
  })

  test("UNSET env var in 'empty' mode falls back to '' silently", async () => {
    const json = await ConfigPaths.parseText(`{"x": "{env:W2_V23_MISSING}"}`, fakeSource(), "empty")
    expect(json).toEqual({ x: "" })
  })

  test("multiple env vars in one text — all-present resolves; one-missing throws", async () => {
    const text = `{"a": "{env:W2_V23_PRESENT}", "b": "{env:W2_V23_PRESENT}"}`
    const json = await ConfigPaths.parseText(text, fakeSource())
    expect(json).toEqual({ a: "real-value", b: "real-value" })

    const broken = `{"a": "{env:W2_V23_PRESENT}", "b": "{env:W2_V23_MISSING}"}`
    await expect(ConfigPaths.parseText(broken, fakeSource())).rejects.toThrow(/W2_V23_MISSING/)
  })
})
