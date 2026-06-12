import { expect, test } from "bun:test"
import {
  CODE_BLOCK_RENDER_LINE_LIMIT,
  MARKDOWN_DATA_IMAGE_CHAR_LIMIT,
  MARKDOWN_RENDER_CHAR_LIMIT,
  renderCodeBlock,
  renderMarkdown,
} from "../src/utils/markdown"

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
  expect(html).toContain('data-browser-preview-url="https://example.com"')
  expect(html).toContain('rel="noopener noreferrer"')
})

test("renderMarkdown uses bounded bare urls and routes them to browser preview", () => {
  const html = renderMarkdown("open https://example.com/path?x=1 and www.example.org/docs")

  expect(html).toContain('href="https://example.com/path?x=1"')
  expect(html).toContain('data-browser-preview-url="https://example.com/path?x=1"')
  expect(html).toContain('href="http://www.example.org/docs"')
  expect(html).toContain('data-browser-preview-url="http://www.example.org/docs"')
})

test("renderMarkdown does not include adjacent JSON fields in bare url links", () => {
  const html = renderMarkdown(
    '{"url":"http://localhost:3006/world-economy/","title":"World Economy","loadStatus":"full"}',
  )

  expect(html).toContain('href="http://localhost:3006/world-economy/"')
  expect(html).toContain('data-browser-preview-url="http://localhost:3006/world-economy/"')
  expect(html).not.toContain('href="http://localhost:3006/world-economy/,&quot;title')
  expect(html).not.toContain('data-browser-preview-url="http://localhost:3006/world-economy/,&quot;title')
})

test("renderMarkdown leaves urls inside code blocks as code text", () => {
  const html = renderMarkdown('```json\n{"url":"http://localhost:3006/world-economy/","title":"World Economy"}\n```')

  expect(html).toContain("&quot;url&quot;")
  expect(html).not.toContain("<a ")
  expect(html).not.toContain("data-browser-preview-url")
})

test("renderMarkdown does not route mailto links to browser preview", () => {
  const html = renderMarkdown("[mail](mailto:ops@example.com)")

  expect(html).toContain('href="mailto:ops@example.com"')
  expect(html).not.toContain("data-browser-preview-url")
})

test("renderMarkdown clips oversized static text before parsing", () => {
  const tail = "SHOULD_NOT_RENDER"
  const html = renderMarkdown(`${"a".repeat(MARKDOWN_RENDER_CHAR_LIMIT + 1)}${tail}`)

  expect(html).toContain("Overlay display clipped")
  expect(html).not.toContain(tail)
})

test("renderMarkdown drops oversized data images", () => {
  const html = renderMarkdown(`![huge](data:image/png;base64,${"A".repeat(MARKDOWN_DATA_IMAGE_CHAR_LIMIT + 1)})`)

  expect(html).toContain("huge")
  expect(html).not.toContain("data:image")
  expect(html).not.toContain("<img")
})

test("renderCodeBlock respects render line and copy budgets", () => {
  const sentinel = "SHOULD_NOT_RENDER"
  const content = `${Array.from({ length: CODE_BLOCK_RENDER_LINE_LIMIT + 1 }, (_, index) => `line-${index}`).join("\n")}\n${sentinel}`
  const result = renderCodeBlock(content, "plaintext", Infinity)

  expect(result.truncated).toBe(true)
  expect(result.totalLines).toBe(CODE_BLOCK_RENDER_LINE_LIMIT + 2)
  expect(result.html).toContain("Overlay display clipped")
  expect(result.html).not.toContain(sentinel)
  expect(result.html).not.toContain(`data-md-copy="${content}`)
})
