import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const OVERLAY_ROOT = path.resolve(import.meta.dir, "..")

function read(relativePath: string): string {
  return readFileSync(path.join(OVERLAY_ROOT, relativePath), "utf8")
}

function soloRuleBody(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const head = new RegExp(`(^|\\n)${escaped}\\s*\\{`, "m").exec(source)
  if (!head) throw new Error(`selector not found: ${selector}`)
  const open = head.index + head[0].length - 1
  const close = source.indexOf("}", open)
  if (close < 0) throw new Error(`malformed block for ${selector}`)
  return source.slice(open + 1, close)
}

describe("icon affordances stay visible at rest", () => {
  test("composer toolbar icons do not default to muted text", () => {
    const css = read("src/styles/surfaces/composer.css")
    const body = soloRuleBody(css, '.chat-icon-col .oc-button[data-ui="chat-toolbar-button"]')
    expect(body).toContain("--oc-button-color: var(--text-soft);")
    expect(body).toContain("--oc-button-shadow:")
    expect(body).not.toContain("--oc-button-color: var(--text-muted);")
  })

  test("disabled send button keeps an explicit visible shell instead of opacity fade", () => {
    const css = read("src/styles/surfaces/composer.css")
    const body = soloRuleBody(css, ".chat-send:disabled")
    expect(body).toContain("border-color:")
    expect(body).toContain("background:")
    expect(body).not.toContain("opacity:")
  })

  test("collapse row keeps a readable resting icon and label", () => {
    const css = read("src/styles/surfaces/card.css")
    expect(soloRuleBody(css, ".card__collapse-toggle")).toContain("color: var(--text-soft);")
    expect(soloRuleBody(css, ".card__collapse-toggle-icon")).not.toContain("var(--text-muted)")
    expect(soloRuleBody(css, ".card__collapse-toggle-label")).toContain("color: var(--text-strong);")
  })

  test("workspace toggle stays visible without dim opacity", () => {
    const css = read("src/styles/surfaces/conversation.css")
    const body = soloRuleBody(css, ".chat-header-meta .workspace-toggle")
    expect(body).toContain("color: var(--text-soft);")
    expect(body).toContain("opacity: var(--ui-opacity-full);")
    expect(body).not.toContain("opacity: var(--ui-opacity-dim);")
  })
})
