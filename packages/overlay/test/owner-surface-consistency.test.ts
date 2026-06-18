import { expect, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")
const TITLEBAR_CSS = readFileSync(join(OVERLAY_ROOT, "src", "styles", "surfaces", "titlebar.css"), "utf8")
const SIDEBAR_CSS = readFileSync(join(OVERLAY_ROOT, "src", "styles", "surfaces", "sidebar.css"), "utf8")
const INSPECTOR_CSS = readFileSync(join(OVERLAY_ROOT, "src", "styles", "surfaces", "inspector.css"), "utf8")
const MESSAGES_CSS = readFileSync(join(OVERLAY_ROOT, "src", "styles", "surfaces", "messages.css"), "utf8")
const CARD_CSS = readFileSync(join(OVERLAY_ROOT, "src", "styles", "surfaces", "card.css"), "utf8")
const CONVERSATION_CSS = readFileSync(join(OVERLAY_ROOT, "src", "styles", "surfaces", "conversation.css"), "utf8")
const COMPOSER_CSS = readFileSync(join(OVERLAY_ROOT, "src", "styles", "surfaces", "composer.css"), "utf8")
const FIELD_CSS = readFileSync(join(OVERLAY_ROOT, "src", "styles", "surfaces", "field.css"), "utf8")

function walkFiles(dir: string, accept: (file: string) => boolean): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...walkFiles(full, accept))
    } else if (accept(full)) {
      out.push(full)
    }
  }
  return out
}

function bodyOf(source: string, selector: string): string {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "")
  const wanted = selector.replace(/\s+/g, " ").trim()
  for (const chunk of css.split("}")) {
    const open = chunk.indexOf("{")
    if (open < 0) continue
    if (chunk.slice(0, open).replace(/\s+/g, " ").trim() === wanted) return chunk.slice(open + 1)
  }
  throw new Error(`CSS rule not found: ${selector}`)
}

test("titlebar controls stay on the surface family", () => {
  expect(TITLEBAR_CSS).not.toContain("var(--guide-card-")
  expect(TITLEBAR_CSS).not.toContain("var(--hover-accent-shadow)")
  expect(
    bodyOf(TITLEBAR_CSS, ".titlebar-theme-option:hover, .titlebar-theme-option[data-highlighted], .titlebar-theme-option:focus-visible"),
  ).toMatch(/background:\s*var\(--surface-hover\)/)
  expect(
    bodyOf(
      TITLEBAR_CSS,
      '.titlebar-menubar-trigger:hover, .titlebar-menubar-trigger:focus-visible, .titlebar-menubar-trigger[data-active="true"]',
    ),
  ).toMatch(/background:\s*var\(--surface-hover\)/)
  expect(bodyOf(TITLEBAR_CSS, '.brand-guide:hover, .brand-guide:focus-visible, .brand-guide[aria-expanded="true"]')).toMatch(
    /background:\s*var\(--surface-hover\)/,
  )
  expect(TITLEBAR_CSS).toContain("background: var(--menu-panel-bg)")
  expect(bodyOf(TITLEBAR_CSS, ".titlebar-menubar-note")).toMatch(/background:\s*var\(--surface-inset\)/)
  for (const className of [
    "titlebar-status-chip",
    "titlebar-setup-cta",
    "titlebar-status-icon",
    "titlebar-task-status",
  ]) {
    expect(TITLEBAR_CSS).not.toMatch(new RegExp(`\\.${className}(?:\\s|[,>{:+~.#\\[])`))
  }
  expect(bodyOf(TITLEBAR_CSS, ".status-icon")).toContain("var(--oc-titlebar-status-icon)")
})

test("task and file search share the field primitive", () => {
  expect(bodyOf(SIDEBAR_CSS, ".task-list-search")).not.toMatch(/background|border|border-radius/)
  expect(INSPECTOR_CSS).not.toContain(".file-explorer-search {")
  expect(bodyOf(FIELD_CSS, ".search-field")).toMatch(
    /background:\s*color-mix\(in srgb, var\(--surface-inset\) 94%, transparent\)/,
  )
  expect(bodyOf(FIELD_CSS, ".search-field:focus-within")).toMatch(/background:\s*var\(--surface-inset\)/)
  expect(
    bodyOf(
      FIELD_CSS,
      '.search-field .oc-button[data-ui$="-search-clear"]:hover, .search-field .oc-button[data-ui$="-search-clear"]:focus-visible',
    ),
  ).toContain("--oc-button-bg: var(--surface-hover)")
})

test("inspector list rows keep a neutral inset base", () => {
  expect(bodyOf(INSPECTOR_CSS, ".knowledge-item")).toMatch(/background:\s*transparent/)
  expect(bodyOf(INSPECTOR_CSS, ".req-spec-content")).toMatch(/background:\s*var\(--surface-inset\)/)
  expect(bodyOf(INSPECTOR_CSS, ".integrity__issue, .integrity__correction, .integrity__missing")).toMatch(
    /background:\s*transparent/,
  )
  expect(bodyOf(INSPECTOR_CSS, ".gwg-objective")).toMatch(/border:\s*0 solid transparent/)
  expect(bodyOf(INSPECTOR_CSS, ".gwg-done-definition")).toMatch(/border:\s*0 solid transparent/)
  expect(bodyOf(INSPECTOR_CSS, ".arch-decision")).toMatch(/border:\s*0 solid transparent/)
  expect(INSPECTOR_CSS).not.toContain(".criteria-check")
  expect(INSPECTOR_CSS).not.toContain(".criteria-group")
  expect(INSPECTOR_CSS).not.toContain(".integrity__dimension")
  for (const retiredSelector of [".goal-item", ".goals-list", ".goal-status-icon", ".goal-priority", ".goal-actions"]) {
    expect(INSPECTOR_CSS).not.toContain(retiredSelector)
  }
  expect(bodyOf(INSPECTOR_CSS, ".gwg")).toMatch(/background:\s*var\(--gwg-surface-base\)/)
  expect(bodyOf(INSPECTOR_CSS, '.gwg[data-goal-status="running"] .gwg-status-icon')).toMatch(
    /background:\s*var\(--accent-dim\)/,
  )
})

test("retired preference row selectors stay removed from production source", () => {
  const productionText = walkFiles(join(OVERLAY_ROOT, "src"), (file) => /\.(?:css|html|ts|tsx|json)$/.test(file))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n")

  for (const className of ["pref-item", "pref-item-head", "pref-item-key", "pref-item-value"]) {
    expect(productionText).not.toContain(className)
  }
})

test("message content carriers keep a neutral surface base", () => {
  expect(MESSAGES_CSS).not.toContain(".msg-tool::before")
  expect(MESSAGES_CSS).not.toMatch(/\.msg-tool\[data-status="[^\"]+"\]::before/)
  expect(bodyOf(MESSAGES_CSS, ".msg-tool")).not.toMatch(/position:\s*relative/)
  expect(bodyOf(MESSAGES_CSS, ".tool-icon")).not.toMatch(/margin-left\s*:/)
  expect(MESSAGES_CSS).not.toContain("msg-tool-output-details")
  expect(MESSAGES_CSS).not.toContain("msg-tool-output-summary")
  expect(bodyOf(MESSAGES_CSS, ".msg-tool-diff-card")).toMatch(/background:\s*transparent/)
  expect(bodyOf(MESSAGES_CSS, ".msg-todo-card")).toMatch(/background:\s*transparent/)
  expect(bodyOf(MESSAGES_CSS, ".msg-todo-list")).toMatch(/background:\s*transparent/)
  expect(bodyOf(MESSAGES_CSS, ".msg-read-meta")).toMatch(/background:\s*transparent/)
  expect(bodyOf(MESSAGES_CSS, ".msg-read-reminder")).toMatch(/background:\s*transparent/)
  expect(bodyOf(MESSAGES_CSS, ".msg-file-chip")).toMatch(/background:\s*var\(--surface-inset\)/)
})

test("structured card body content does not create nested card chrome", () => {
  expect(bodyOf(CARD_CSS, '.card:not([data-depth="0"])[data-kind="tool"]')).toMatch(
    /border-left:\s*0 solid transparent/,
  )
  expect(CARD_CSS).not.toMatch(/\[data-kind="tool"\][^{]*\{[^}]*border-left-color:\s*var\(--card-stage-info\)/)
  expect(bodyOf(CARD_CSS, ".card__body")).toMatch(/border-top:\s*0 solid transparent/)
  expect(bodyOf(CARD_CSS, ".card__collapsed-preview")).toMatch(/border-left:\s*0 solid transparent/)
  expect(bodyOf(CARD_CSS, ".card__goal-desc")).toMatch(/background:\s*transparent/)
  expect(bodyOf(CARD_CSS, ".card__goal-desc")).toMatch(/border:\s*0 solid transparent/)
  expect(bodyOf(CARD_CSS, ".card__goal-desc")).toMatch(/box-shadow:\s*none/)
  expect(bodyOf(CARD_CSS, '.card[data-kind="step"] > .card__body > .msg-text')).toMatch(/background:\s*transparent/)
  expect(bodyOf(CARD_CSS, '.card[data-kind="step"] > .card__body > .msg-text')).toMatch(/box-shadow:\s*none/)
  expect(bodyOf(CARD_CSS, '.card[data-kind="step"] > .card__body > .msg-text::before')).toMatch(/content:\s*none/)
})

test("conversation agent rail and conversation owner surfaces stay flat", () => {
  expect(bodyOf(CONVERSATION_CSS, ".conversation-agent-rail")).toMatch(/overflow:\s*hidden/)
  expect(bodyOf(CONVERSATION_CSS, ".conversation-agent-rail__row")).toMatch(/display:\s*grid/)
  expect(CONVERSATION_CSS).not.toContain("conversation-agent-rail__run")
  expect(CONVERSATION_CSS).not.toContain("conversation-agent-rail__report")
  expect(
    bodyOf(
      CONVERSATION_CSS,
      '.conversation-agent-rail .oc-button[data-ui="conversation-agent-rail-locate"]:hover, .conversation-agent-rail .oc-button[data-ui="conversation-agent-rail-locate"]:focus-visible',
    ),
  ).toMatch(
    /--oc-button-bg:\s*var\(--subtle-2\)/,
  )
  expect(bodyOf(CARD_CSS, ".task-progress__pill")).toMatch(/border:\s*var\(--oc-border-width\) solid var\(--card-border\)/)
  expect(bodyOf(CARD_CSS, ".task-progress__pill")).toMatch(/background:\s*var\(--card-bg-0\)/)
  expect(bodyOf(COMPOSER_CSS, ".chat-empty--task")).toMatch(/border:\s*0 solid transparent/)
  expect(bodyOf(COMPOSER_CSS, ".chat-empty--task")).toMatch(/background:\s*transparent/)
})
