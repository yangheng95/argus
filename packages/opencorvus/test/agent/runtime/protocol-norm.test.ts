import { describe, expect, test } from "bun:test"
// audit-2026-04-29 W2-V38 — `@/agent/runtime` namespace was removed;
// normalize helpers moved to `@/session/tool-input-norm`. Pre-fix
// the import broke at module load → "Cannot find module" →
// "Unhandled error between tests" cascaded into other suites.
import { normalizeToolInput, normalizeToolOutput } from "@/session/tool-input-norm"

describe("normalizeToolInput", () => {
  test("undefined → ok empty object", () => {
    const r = normalizeToolInput(undefined)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toEqual({})
  })

  test("null → ok empty object", () => {
    const r = normalizeToolInput(null)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toEqual({})
  })

  test("plain object → passthrough", () => {
    const input = { a: 1, b: "two" }
    const r = normalizeToolInput(input)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe(input)
  })

  test("empty string / whitespace → ok empty object", () => {
    expect(normalizeToolInput("").ok).toBe(true)
    expect(normalizeToolInput("   ").ok).toBe(true)
  })

  test("JSON object string → parsed object", () => {
    const r = normalizeToolInput('{"a":1,"b":"two"}')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toEqual({ a: 1, b: "two" })
  })

  test("JSON array string → explicit failure with reason", () => {
    const r = normalizeToolInput("[1,2,3]")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain("array")
  })

  test("JSON primitive string → explicit failure", () => {
    const r = normalizeToolInput('"just a string"')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain("string")
  })

  test("malformed JSON string → explicit failure with parse error", () => {
    const r = normalizeToolInput("{broken")
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toContain("JSON.parse")
      expect(r.raw).toBe("{broken")
    }
  })

  test("array value → explicit failure (not accepted even though typeof === 'object')", () => {
    const r = normalizeToolInput([1, 2, 3])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain("unexpected type")
  })

  test("number/boolean → explicit failure", () => {
    expect(normalizeToolInput(42).ok).toBe(false)
    expect(normalizeToolInput(true).ok).toBe(false)
  })
})

describe("normalizeToolOutput", () => {
  test("string → output as-is", () => {
    const r = normalizeToolOutput("hello", "my-tool")
    expect(r.output).toBe("hello")
    expect(r.title).toBe("my-tool")
    expect(r.metadata).toEqual({})
  })

  test("object with output field → extracted", () => {
    const r = normalizeToolOutput({ output: "result", title: "fancy", metadata: { k: 1 } }, "fallback")
    expect(r.output).toBe("result")
    expect(r.title).toBe("fancy")
    expect(r.metadata).toEqual({ k: 1 })
  })

  test("object without output → JSON.stringified", () => {
    const r = normalizeToolOutput({ a: 1 }, "t")
    expect(r.output).toBe('{"a":1}')
    expect(r.title).toBe("t")
  })

  test("undefined / null → empty output", () => {
    expect(normalizeToolOutput(undefined, "t").output).toBe("")
    expect(normalizeToolOutput(null, "t").output).toBe("")
  })

  test("number → JSON.stringified", () => {
    expect(normalizeToolOutput(42, "t").output).toBe("42")
  })

  test("non-string title field falls back to provided default", () => {
    const r = normalizeToolOutput({ output: "x", title: 123 }, "fallback")
    expect(r.title).toBe("fallback")
  })

  test("non-object metadata is replaced with empty object", () => {
    const r = normalizeToolOutput({ output: "x", metadata: "oops" }, "t")
    expect(r.metadata).toEqual({})
  })
})
