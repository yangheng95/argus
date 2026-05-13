import { expect, test } from "bun:test"
import { renderMarkdown } from "../src/utils/markdown"

test("renderMarkdown escapes raw html instead of injecting it", () => {
  const html = renderMarkdown("<script>alert(1)</script>\n<img src=x onerror=alert(1)>")
  expect(html).toContain("&lt;script&gt;")
  expect(html).not.toContain("<script>")
  expect(html).not.toContain("<img")
})

test("renderMarkdown drops javascript links", () => {
  const html = renderMarkdown("[click](javascript:alert(1))")
  expect(html).toContain("click")
  expect(html).not.toContain("javascript:")
  expect(html).not.toContain("<a ")
})

test("renderMarkdown keeps safe http links", () => {
  const html = renderMarkdown("[docs](https://example.com)")
  expect(html).toContain('href="https://example.com"')
  expect(html).toContain('rel="noopener noreferrer"')
})
