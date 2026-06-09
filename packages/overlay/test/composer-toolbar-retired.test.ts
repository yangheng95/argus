import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

const OVERLAY_ROOT = path.resolve(import.meta.dir, "..")
const STYLES_ROOT = path.join(OVERLAY_ROOT, "src", "styles")

function read(relativePath: string): string {
  return readFileSync(path.join(OVERLAY_ROOT, relativePath), "utf8")
}

function walkCss(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walkCss(full))
    else if (entry.endsWith(".css")) out.push(full)
  }
  return out
}

const STYLES = walkCss(STYLES_ROOT)
  .map((file) => readFileSync(file, "utf8"))
  .join("\n")

describe("composer toolbar is retired", () => {
  test("ChatComposer no longer renders attach, web-search, or expand toolbar buttons", () => {
    const source = read("src/components/ChatComposer.tsx")

    expect(source).not.toContain("btnChatAttach")
    expect(source).not.toContain("btnWebSearch")
    expect(source).not.toContain('data-ui="chat-toolbar-button"')
    expect(source).not.toContain("composerExpanded")
  })

  test("toolbar column CSS is removed from the runtime styles", () => {
    expect(STYLES).not.toMatch(/\.chat-icon-col(?![-\w])/)
    expect(STYLES).not.toContain("chat-toolbar-button")
  })

  test("composer keeps drag attachment and top-edge resize affordances", () => {
    const source = read("src/components/ChatComposer.tsx")
    const css = read("src/styles/surfaces/composer.css")

    expect(source).toContain("onDrop={handleDrop}")
    expect(source).toContain('class="chat-resize-handle"')
    expect(css).toMatch(/\.chat-resize-handle\s*\{/)
    expect(css).toContain("--chat-textarea-height")
  })
})
