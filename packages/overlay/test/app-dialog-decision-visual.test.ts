import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const overlayRoot = join(import.meta.dir, "..")

function readText(path: string): string {
  return readFileSync(join(overlayRoot, path), "utf8")
}

function block(css: string, selector: string): string {
  const index = css.indexOf(selector)
  if (index < 0) return ""
  const start = css.indexOf("{", index)
  const end = css.indexOf("\n}", start)
  return start >= 0 && end >= 0 ? css.slice(start + 1, end) : ""
}

describe("app dialog decision visual treatment", () => {
  test("task decision dialogs use a dedicated compact form shell", () => {
    const host = readText("src/components/AppDialogHost.tsx")
    const css = readText("src/styles/surfaces/dialog.css")

    expect(host).toContain('formClass={isTaskCardDecision() ? "app-dialog-form--decision" : undefined}')
    expect(css).toContain(".app-dialog-form--decision")
    expect(block(css, ".app-dialog-form--decision")).toContain("max-width: min(calc(520px * var(--ui-scale))")
    expect(block(css, ".app-dialog-form--decision > .dialog-header")).toContain("background: var(--surface)")
  })

  test("decision choices stay flat and avoid decorative gradients", () => {
    const css = readText("src/styles/surfaces/dialog.css")
    const decisionBlock = block(css, ".app-dialog-decision")
    const choiceBlock = block(css, ".app-dialog-decision__choice {")
    const hoverBlock = block(css, ".app-dialog-decision__choice:hover")

    expect(decisionBlock).not.toContain("radial-gradient")
    expect(decisionBlock).not.toContain("linear-gradient")
    expect(choiceBlock).not.toContain("linear-gradient")
    expect(choiceBlock).not.toContain("overflow: hidden")
    expect(choiceBlock).toContain("appearance: none")
    expect(choiceBlock).toContain("min-width: 0")
    expect(choiceBlock).toContain("font: inherit")
    expect(hoverBlock).not.toContain("translateY")
    expect(css).toContain(".app-dialog-decision__choice[data-pressed]")
    expect(css).not.toContain('.app-dialog-decision__choice[data-active="true"]')
    expect(css).not.toContain("data-selected")
  })

  test("recommended label uses the shared Badge primitive, not private dialog chrome", () => {
    const host = readText("src/components/AppDialogHost.tsx")
    const dialogCss = readText("src/styles/surfaces/dialog.css")
    const badge = readText("src/components/ui/Badge.tsx")
    const badgeCss = readText("src/styles/primitives/badge.css")
    const indexHtml = readText("src/index.html")

    expect(host).toContain('import { Badge } from "./ui/Badge"')
    expect(host).toContain('<Badge tone="accent" size="sm" data-ui="app-dialog-recommended-badge">')
    expect(host).not.toContain("app-dialog-decision__badge")
    expect(dialogCss).not.toContain(".app-dialog-decision__badge")
    expect(badge).toContain("export function Badge")
    expect(badge).toContain("className()")
    expect(badgeCss).toContain(".oc-badge")
    expect(badgeCss).toContain('.oc-badge[data-tone="accent"]')
    expect(badgeCss).toContain('.oc-badge[data-size="sm"]')
    expect(indexHtml.indexOf("styles/primitives/button.css")).toBeLessThan(
      indexHtml.indexOf("styles/primitives/badge.css"),
    )
    expect(indexHtml.indexOf("styles/primitives/badge.css")).toBeLessThan(
      indexHtml.indexOf("styles/primitives/tabs.css"),
    )
  })
})
