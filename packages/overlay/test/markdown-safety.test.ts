import { afterAll, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { setLocale } from "../src/utils/i18n"
import { installIconHtmlRenderer } from "../src/utils/icon-html"
import {
  CODE_BLOCK_RENDER_LINE_LIMIT,
  MARKDOWN_DATA_IMAGE_CHAR_LIMIT,
  MARKDOWN_RENDER_CHAR_LIMIT,
  renderCodeBlock,
  renderMarkdown,
} from "../src/utils/markdown"
import { installRealOverlayI18n } from "./fixtures/i18n"

const MARKDOWN_CSS = readFileSync(join(import.meta.dir, "../src/styles/surfaces/markdown.css"), "utf8")
const MARKDOWN_SOURCE = readFileSync(join(import.meta.dir, "../src/utils/markdown.ts"), "utf8")
const MAIN_SOURCE = readFileSync(join(import.meta.dir, "../src/main.tsx"), "utf8")
const EN_US = JSON.parse(readFileSync(join(import.meta.dir, "../src/i18n/en-US.json"), "utf8")) as Record<string, unknown>
const ZH_CN = JSON.parse(readFileSync(join(import.meta.dir, "../src/i18n/zh-CN.json"), "utf8")) as Record<string, unknown>

const disposeIconHtmlRenderer = installIconHtmlRenderer(({ name, size }) => {
  if (name !== "copy") throw new Error(`Unknown test icon "${name}"`)
  return `<svg data-test-icon="${name}" width="${size}" height="${size}" aria-hidden="true"></svg>`
})

installRealOverlayI18n()
await setLocale("en-US")

afterAll(() => {
  disposeIconHtmlRenderer()
})

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

test("renderCodeBlock copy action uses the shared Button contract", () => {
  const result = renderCodeBlock("console.log('ok')", "typescript", Infinity)

  expect(result.html).toContain('class="oc-button md-code-copy"')
  expect(result.html).toContain('data-variant="ghost"')
  expect(result.html).toContain('data-size="icon"')
  expect(result.html).toContain('data-tone="neutral"')
  expect(result.html).toContain('data-chrome="icon-action"')
  expect(result.html).toContain('data-ui="markdown-code-copy"')
  expect(result.html).toContain('data-md-copy=')
  expect(result.html).toContain('title="Copy code"')
  expect(result.html).toContain('aria-label="Copy code"')
  expect(result.html).toContain('data-test-icon="copy"')
  expect(MARKDOWN_SOURCE).toContain('t("markdown.copy_code")')
  expect(MAIN_SOURCE).toContain('flash(t("markdown.copied"))')
  expect(MAIN_SOURCE).toContain('flash(t("markdown.copy_failed"))')
  expect(MAIN_SOURCE).not.toContain('flash("Copied")')
  expect(MAIN_SOURCE).not.toContain('flash("Copy failed")')
  expect(MARKDOWN_CSS).toContain('.oc-button[data-ui="markdown-code-copy"]')
  expect(MARKDOWN_CSS).toContain('.oc-button[data-ui="markdown-code-copy"][data-copied="true"]')
  expect(MARKDOWN_CSS).not.toMatch(/\.md-code-copy:(?:hover|focus-visible)\b/)
})

test("renderCodeBlock copy action locale keys are complete", () => {
  for (const key of ["markdown.copy_code", "markdown.copied", "markdown.copy_failed"]) {
    expect(EN_US[key]).toEqual(expect.any(String))
    expect(ZH_CN[key]).toEqual(expect.any(String))
    expect(EN_US[key]).not.toBe(key)
    expect(ZH_CN[key]).not.toBe(key)
  }
  expect(EN_US["markdown.copy_code"]).toBe("Copy code")
  expect(ZH_CN["markdown.copy_code"]).toBe("复制代码")
})
