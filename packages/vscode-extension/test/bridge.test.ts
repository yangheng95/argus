import { describe, expect, test } from "bun:test"
import { buildUrl, validatePath } from "../src/transport/bridge"

describe("validatePath", () => {
  test("accepts plain server-relative paths", () => {
    expect(validatePath("global/health")).toEqual({ ok: true, path: "global/health" })
    expect(validatePath("task/abc/conversation")).toEqual({ ok: true, path: "task/abc/conversation" })
  })

  test("strips a single leading slash", () => {
    expect(validatePath("/global/health")).toEqual({ ok: true, path: "global/health" })
  })

  test("rejects protocol-relative-style double-leading-slash", () => {
    // Browsers parse `//host/path` as `<current-protocol>://host/path`.
    // Allowing it here would let a crafted webview bypass the
    // "no absolute URL" guard. Reject early.
    expect(validatePath("//global/health").ok).toBe(false)
  })

  test("rejects empty path", () => {
    const result = validatePath("")
    expect(result.ok).toBe(false)
  })

  test("rejects absolute http(s) URLs", () => {
    expect(validatePath("http://evil.example/health").ok).toBe(false)
    expect(validatePath("HTTPS://evil.example/health").ok).toBe(false)
    expect(validatePath("//evil.example/health").ok).toBe(false)
  })

  test("rejects parent-directory traversal", () => {
    expect(validatePath("../etc/passwd").ok).toBe(false)
    expect(validatePath("/foo/../bar").ok).toBe(false)
    expect(validatePath("foo/..").ok).toBe(false)
  })

  test("rejects null byte and backslash", () => {
    expect(validatePath("foo\0bar").ok).toBe(false)
    expect(validatePath("foo\\bar").ok).toBe(false)
  })
})

describe("buildUrl", () => {
  test("joins base and path correctly", () => {
    expect(buildUrl("http://127.0.0.1:8080", "global/health", {})).toBe("http://127.0.0.1:8080/global/health")
  })

  test("strips trailing slash from base", () => {
    expect(buildUrl("http://127.0.0.1:8080/", "global/health", {})).toBe("http://127.0.0.1:8080/global/health")
  })

  test("encodes query parameters", () => {
    const url = buildUrl("http://127.0.0.1:8080", "task/abc/board", {
      sync: "1",
      directory: "C:\\Users\\test",
    })
    expect(url).toContain("sync=1")
    expect(url).toContain("directory=C%3A%5CUsers%5Ctest")
  })

  test("preserves multi-segment paths", () => {
    expect(buildUrl("http://127.0.0.1:8080", "task/abc/conversation/events", {})).toBe(
      "http://127.0.0.1:8080/task/abc/conversation/events",
    )
  })
})
