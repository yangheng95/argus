import { describe, expect, test } from "bun:test"
import { isHttpWebpageUrl } from "../../src/util/web-url"

describe("web URL helpers", () => {
  test("recognizes http and https webpage URLs case-insensitively", () => {
    expect(isHttpWebpageUrl("https://example.com")).toBe(true)
    expect(isHttpWebpageUrl("HTTP://example.com")).toBe(true)
    expect(isHttpWebpageUrl("HTTPS://example.com/path")).toBe(true)
    expect(isHttpWebpageUrl("ftp://example.com")).toBe(false)
    expect(isHttpWebpageUrl("example.com")).toBe(false)
  })
})
