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
  test("primitive owns the shared icon-action shell", () => {
    const css = read("src/styles/primitives/button.css")
    expect(css).toContain('.oc-button[data-size="icon"][data-variant="ghost"][data-chrome="icon-action"]')
    expect(css).toContain("--oc-button-color: var(--text-soft);")
    expect(css).toContain("--oc-button-shadow:")
    expect(css).toContain("opacity: var(--ui-opacity-subtle);")
  })

  test("disabled send button keeps an explicit visible shell instead of opacity fade", () => {
    const css = read("src/styles/surfaces/composer.css")
    const body = soloRuleBody(css, ".chat-send:disabled")
    expect(body).toContain("border-color:")
    expect(body).toContain("background:")
    expect(body).toContain("color: color-mix(in srgb, var(--accent) 72%, var(--text-strong));")
    expect(body).not.toContain("opacity:")
    expect(body).not.toContain("white 78%")
    expect(body).not.toContain("var(--accent) 44%")
  })

  test("chat header no longer owns a workspace toggle affordance", () => {
    const css = read("src/styles/surfaces/conversation.css")
    const html = read("src/index.html")
    expect(html).not.toContain("btnWorkspaceToggle")
    expect(css).not.toContain(".workspace-toggle")
  })

  test("task row icon actions are intentionally hover-only", () => {
    const css = read("src/styles/surfaces/sidebar.css")
    const body = soloRuleBody(
      css,
      '.task-row-actions .oc-button[data-ui="task-row-delete"],\n.task-row-actions .oc-button[data-ui="task-row-cancel"],\n.task-row-actions .oc-button[data-ui="task-row-start-now"]',
    )
    expect(body).toContain("opacity: 0;")
    expect(body).toContain("pointer-events: none;")
    expect(body).not.toContain("--oc-button-color: var(--text-muted);")
  })

  test("notification dismiss button does not default to muted text", () => {
    const css = read("src/styles/surfaces/notifications.css")
    const body = soloRuleBody(css, '.app-notification .oc-button[data-ui="app-notification-close"]')
    expect(body).not.toContain("--oc-button-color: var(--text-muted);")
    expect(body).not.toContain("--oc-button-shadow:")
  })

  test("search clear buttons share the visible icon-action resting state", () => {
    const sidebarCss = read("src/styles/surfaces/sidebar.css")
    const providerCss = read("src/styles/surfaces/settings.css")
    const taskClear = soloRuleBody(sidebarCss, '.task-list-search .oc-button[data-ui="task-list-search-clear"]')
    const providerClear = soloRuleBody(providerCss, '.provider-search-field .oc-button[data-ui="provider-search-clear"]')
    for (const body of [taskClear, providerClear]) {
      expect(body).not.toContain("--oc-button-color: var(--text-muted);")
      expect(body).not.toContain("--oc-button-shadow:")
    }
  })
})
