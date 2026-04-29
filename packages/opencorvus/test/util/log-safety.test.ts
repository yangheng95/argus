import { describe, expect, test } from "bun:test"
import { safeStringify, sanitizeMessage } from "../../src/util/log-safety"

/**
 * audit-2026-04-29 W2-V17. Two latent crashes / injection paths in
 * the logger:
 *
 *   (a) Circular-reference crash. `JSON.stringify(value)` on an
 *       object that cycles (axios error referencing its own
 *       request, solid-store node referencing its parent, etc.)
 *       throws TypeError. Pre-fix the throw bubbled up from
 *       `build()` and crashed the very logger.error call that
 *       was supposed to record the failure.
 *
 *   (b) Log injection via newlines. A user-controlled message
 *       containing `\n` split across multiple log lines, masking
 *       malicious input as synthetic log entries that ops
 *       dashboards then parse as legitimate.
 *
 * The two helpers — safeStringify, sanitizeMessage — are the entire
 * boundary; lock their contracts so a future drift trips this test.
 */

describe("safeStringify (audit W2-V17)", () => {
  test("trivial round-trip matches JSON.stringify", () => {
    expect(safeStringify({ a: 1, b: "x" })).toBe(`{"a":1,"b":"x"}`)
  })

  test("cyclic object → does not throw, replaces with [Circular]", () => {
    const cyclic: any = { name: "loop" }
    cyclic.self = cyclic
    const out = safeStringify(cyclic)
    expect(out).toContain("[Circular]")
    expect(out).toContain("loop")
  })

  test("nested cycle deeper in the tree is replaced too", () => {
    const root: any = { children: [{ id: 1 }, { id: 2 }] }
    root.children[0].parent = root
    expect(() => safeStringify(root)).not.toThrow()
    expect(safeStringify(root)).toContain("[Circular]")
  })

  test("BigInt rendered as `<n>n` (default JSON.stringify throws)", () => {
    expect(safeStringify({ id: 123n })).toBe(`{"id":"123n"}`)
  })

  test("function rendered as [Function: name] / [Function: anonymous]", () => {
    function namedFn() {}
    const anon = () => {}
    Object.defineProperty(anon, "name", { value: "" }) // strip inferred name
    expect(safeStringify({ fn: namedFn })).toContain(`[Function: namedFn]`)
    expect(safeStringify({ fn: anon })).toContain(`[Function: anonymous]`)
  })

  test("plain primitives stringify as JSON does", () => {
    expect(safeStringify(42)).toBe("42")
    expect(safeStringify("hello")).toBe(`"hello"`)
    expect(safeStringify(true)).toBe("true")
    expect(safeStringify(null)).toBe("null")
  })

  test("undefined → 'undefined' (since JSON.stringify(undefined) returns undefined, not a string)", () => {
    expect(safeStringify(undefined)).toBe("undefined")
  })
})

describe("sanitizeMessage (audit W2-V17)", () => {
  test("normal text passes through unchanged", () => {
    expect(sanitizeMessage("hello world")).toBe("hello world")
  })

  test("newline → \\x0a (single-line invariant)", () => {
    expect(sanitizeMessage("line1\nline2")).toBe("line1\\x0aline2")
  })

  test("CR + LF (Windows) both escaped", () => {
    expect(sanitizeMessage("a\r\nb")).toBe("a\\x0d\\x0ab")
  })

  test("NUL byte escaped", () => {
    expect(sanitizeMessage("foo\0bar")).toBe("foo\\x00bar")
  })

  test("ANSI escape (0x1b) escaped — defends against terminal injection in tail", () => {
    expect(sanitizeMessage("\x1b[31mred\x1b[0m")).toBe("\\x1b[31mred\\x1b[0m")
  })

  test("DEL (0x7f) escaped", () => {
    expect(sanitizeMessage("a\x7fb")).toBe("a\\x7fb")
  })

  test("non-string input is coerced via String()", () => {
    expect(sanitizeMessage(42)).toBe("42")
    expect(sanitizeMessage(undefined)).toBe("undefined")
  })

  test("regression: classic log-injection probe is neutralised", () => {
    // An attacker-controlled string that tries to forge an entry
    // for a different timestamp / level. Pre-fix the receiver tail
    // would render two visible lines, the second masquerading as
    // a legitimate log entry.
    const probe = "user input\n2026-04-29T00:00:00 INFO  fake.service forged-entry"
    const out = sanitizeMessage(probe)
    expect(out).not.toContain("\n")
    expect(out).toContain("\\x0a")
  })
})
