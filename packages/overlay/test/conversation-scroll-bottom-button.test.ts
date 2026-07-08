import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")

function read(relativePath: string): string {
  return readFileSync(join(OVERLAY_ROOT, relativePath), "utf8")
}

describe("conversation scroll-to-bottom control", () => {
  test("Conversation mounts a floating button through the existing scroll owner", () => {
    const source = read("src/components/Conversation.tsx")

    expect(source).toContain('import { Portal } from "solid-js/web"')
    expect(source).toContain('data-ui="conversation-scroll-bottom"')
    expect(source).toContain('variant="ghost"')
    expect(source).toContain('Icon name="chevron-down"')
    expect(source).toContain("setTracking(true)")
    expect(source).toContain("scrollController?.scrollToBottom()")
    expect(source).toContain("onUserScrollUp: () => setTracking(false)")
    expect(source).toContain("onAtBottom: () => setTracking(true)")
    expect(source).not.toContain("document.body")
  })

  test("conversation CSS anchors the button inside the message scroll shell", () => {
    const css = read("src/styles/surfaces/conversation.css")
    const shellRule = css.match(/\.conversation-scroll-shell\s*\{[^}]*\}/)?.[0] ?? ""
    const buttonRule =
      css.match(
        /\.conversation-scroll-shell > \.oc-button\.conversation-scroll-bottom\[data-ui="conversation-scroll-bottom"\]\s*\{[^}]*\}/,
      )?.[0] ?? ""

    expect(shellRule).toContain("position: relative")
    expect(css).toContain(".conversation-scroll-bottom")
    expect(buttonRule).toContain("border-radius: var(--oc-radius-pill)")
    expect(buttonRule).toContain("--oc-button-bg: color-mix(in srgb, var(--text-strong) 14%, transparent)")
    expect(buttonRule).toContain("width: var(--oc-button-height)")
    expect(buttonRule).toContain("backdrop-filter: blur(calc(8px * var(--ui-scale)))")
  })

  test("scroll button label is localized in both shipped dictionaries", () => {
    expect(read("src/i18n/en-US.json")).toContain('"chat.scroll_bottom": "Scroll to bottom"')
    expect(read("src/i18n/zh-CN.json")).toContain('"chat.scroll_bottom": "滚动到底部"')
  })
})
