/**
 * Coverage guard for flat-redesign Step 2 (specs/overlay-flat-redesign/plan.md §2.2).
 *
 * Pins the three border-rule decisions that make the overlay "flat":
 *
 *   Rule A (surface 层差替代描边): high-traffic surface containers do NOT
 *           declare a resting `border: <width> solid <color>`. Their
 *           visible boundary comes from --surface / --surface-strong /
 *           --surface-inset lightness steps.
 *
 *   Rule B (cross-context boundary only): titlebar carries one bottom-edge
 *           border (cross-context: titlebar ↔ panel-body). The `::after`
 *           decorative gradient line that used to double the bottom edge
 *           is retired.
 *
 *   Rule C (no border-color flip on state changes): hover/active/status
 *           state changes use background tint, not border-color or stray
 *           decorative rails.
 *
 * The guard is targeted — it only inspects the specific selectors the
 * 2026-05-04 user critique identified. Adding a `border:` rule to one of
 * these selectors is the regression we're guarding against.
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const STYLES_ROOT = join(import.meta.dir, "..", "src", "styles")

function readSurface(name: string): string {
  return readFileSync(join(STYLES_ROOT, "surfaces", name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
}

/** Extract the body of the *first* solo rule whose selector head matches. */
function ruleBody(text: string, selectorHead: string): string {
  // Selectors with attribute filters or pseudos need exact-string match.
  for (const chunk of text.split("}")) {
    const openIdx = chunk.indexOf("{")
    if (openIdx < 0) continue
    const head = chunk.slice(0, openIdx).trim()
    if (head !== selectorHead) continue
    return chunk.slice(openIdx + 1)
  }
  throw new Error(`solo rule "${selectorHead}" not found`)
}

function selectorRule(className: string): RegExp {
  return new RegExp(`(^|[\\n,{])\\s*\\.${className}(?:\\s|[,>{:+~.#\\[]|$)`, "m")
}

function retiredTitlebarStatusSelector(className: string): RegExp {
  return new RegExp(`(^|[\\n,{])\\s*\\.${className}(?:\\s|[,>{:+~.#\\[]|$)`, "m")
}

describe("flat-redesign Rule A — surface containers have no resting self-border", () => {
  const workspace = readSurface("workspace.css")
  const activity = readSurface("activity.css")
  const inspector = readSurface("inspector.css")
  const composer = readSurface("composer.css")

  test("retired workspace panel shell carries no chrome rules", () => {
    for (const className of ["workspace", "workspace-header", "workspace-tab", "workspace-close"]) {
      expect(workspace).not.toMatch(selectorRule(className))
    }
  })

  test("file changes diff close uses Button primitive variables", () => {
    const body = ruleBody(activity, '.file-changes-diff-header .oc-button[data-ui="file-changes-diff-close"]')
    expect(body).toMatch(/--oc-button-color:\s*var\(--text-muted\)/)
  })

  test(".oc-section right-rail card has no self-border", () => {
    const body = ruleBody(inspector, ".oc-section")
    expect(body).not.toMatch(/(?:^|\s)border\s*:\s*[^;]*\bsolid\b\s+var\(--border\)/)
    // Stack divider re-assertion is also retired.
    expect(inspector).not.toMatch(/\.oc-section:last-child\s*\{/)
  })

  test("executor chip resting state has no border", () => {
    const body = ruleBody(composer, '.executor-chip-slot .oc-button[data-ui^="executor-chip-"]')
    expect(body).not.toMatch(/(?:^|\s)border\s*:\s*[^;]*\bsolid\b/)
    expect(body).toMatch(/--oc-button-border:\s*0 solid transparent/)
  })

  test(".chat-attachment-item has no border", () => {
    const body = ruleBody(composer, ".chat-attachment-item")
    expect(body).not.toMatch(/(?:^|\s)border\s*:\s*[^;]*\bsolid\b/)
  })
})

describe("flat-redesign Rule B — only cross-context boundaries carry borders", () => {
  const titlebar = readSurface("titlebar.css")

  test(".titlebar carries one cross-context border (bottom only)", () => {
    const body = ruleBody(titlebar, ".titlebar")
    // Resting border must be 0 with explicit border-bottom.
    expect(body).toMatch(/(?:^|\s)border\s*:\s*0\s*;/)
    expect(body).toMatch(/border-bottom\s*:\s*var\(--oc-border-width\)\s+solid\s+var\(--border\)/)
    expect(body).not.toMatch(/border-left\s*:/)
    expect(body).not.toMatch(/border-right\s*:/)
  })

  test(".titlebar::after decorative gradient line is retired", () => {
    expect(titlebar).not.toMatch(/\.titlebar::after\s*\{/)
  })

  test("retired titlebar status utility shell carries no chrome rules", () => {
    for (const className of [
      "titlebar-status-chip",
      "titlebar-setup-cta",
      "titlebar-status-icon",
      "titlebar-task-status",
    ]) {
      expect(titlebar).not.toMatch(retiredTitlebarStatusSelector(className))
    }
  })
})

describe("flat-redesign Rule C — state changes use bg/stripe, not border-color flip", () => {
  const titlebar = readSurface("titlebar.css")
  const inspector = readSurface("inspector.css")
  const activity = readSurface("activity.css")
  const composer = readSurface("composer.css")

  test("retired titlebar task status variants stay absent", () => {
    for (const status of ["queued", "active", "completed", "failed"]) {
      expect(titlebar).not.toMatch(new RegExp(`\\.titlebar-task-status\\[data-status="${status}"\\]`))
    }
    expect(titlebar).not.toMatch(/\.titlebar-task-status:hover/)
  })

  test("titlebar menubar trigger active state doesn't flip border-color", () => {
    const body = ruleBody(titlebar, '.titlebar-menubar .oc-button[data-ui="titlebar-menubar-trigger"][data-active="true"]')
    expect(body).not.toMatch(/border-color\s*:/)
    expect(body).toMatch(/--oc-button-bg\s*:/)
  })

  test('.oc-section[data-phase-state="active"] uses bg-tint only, not border-color or rails', () => {
    const body = ruleBody(inspector, '.oc-section[data-phase-state="active"]')
    expect(body).not.toMatch(/border-color\s*:/)
    // Outer drop-shadow chrome was the other half of the active state — also retired.
    expect(body).not.toMatch(/box-shadow\s*:\s*[^;]*\binset\b/)
    expect(body).toMatch(/background\s*:/)
    expect(inspector).not.toMatch(/\.oc-section\[data-phase-state="active"\]::after\s*\{/)
  })

  test("open executor chip uses bg-tint, not border-color", () => {
    const body = ruleBody(composer, '.executor-chip-slot[data-open="true"] .oc-button[data-ui^="executor-chip-"]')
    expect(body).not.toMatch(/border-color\s*:/)
    expect(body).toMatch(/--oc-button-bg\s*:/)
  })

  test("file changes diff close hover uses bg-tint, not border-color", () => {
    const body = ruleBody(
      activity,
      '.file-changes-diff-header .oc-button[data-ui="file-changes-diff-close"]:hover,\n.file-changes-diff-header .oc-button[data-ui="file-changes-diff-close"]:focus-visible',
    )
    expect(body).not.toMatch(/border-color\s*:/)
    expect(body).toMatch(/--oc-button-bg\s*:/)
  })
})
