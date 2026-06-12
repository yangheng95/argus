import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")
const SETTINGS_CSS = readFileSync(join(OVERLAY_ROOT, "src", "styles", "surfaces", "settings.css"), "utf8")
const HEADER_CSS = readFileSync(join(OVERLAY_ROOT, "src", "styles", "surfaces", "header.css"), "utf8")
const PROVIDERS_TSX = readFileSync(join(OVERLAY_ROOT, "src", "components", "settings", "ProvidersPanel.tsx"), "utf8")
const PROMPT_CATALOG_TSX = readFileSync(
  join(OVERLAY_ROOT, "src", "components", "settings", "PromptCatalog.tsx"),
  "utf8",
)

function bodyOfSource(source: string, selector: string): string {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "")
  for (const chunk of css.split("}")) {
    const open = chunk.indexOf("{")
    if (open < 0) continue
    if (chunk.slice(0, open).trim() === selector) return chunk.slice(open + 1)
  }
  throw new Error(`CSS rule not found: ${selector}`)
}

function bodyOf(selector: string): string {
  return bodyOfSource(SETTINGS_CSS, selector)
}

describe("config panel sizing", () => {
  test("config dialog keeps a stable minimum height", () => {
    expect(bodyOf("#configDialog .dialog-form")).toMatch(/min-height\s*:/)
    expect(bodyOf(".config-dialog-layout")).toMatch(/flex\s*:\s*1 1 auto/)
    expect(bodyOf(".config-content")).toMatch(/min-height\s*:\s*0/)
  })

  test("settings panels keep a flat borderless owner surface", () => {
    const layoutBody = bodyOf(".config-dialog-layout")
    expect(layoutBody).toContain("--settings-surface-base: var(--surface-inset)")
    expect(layoutBody).toContain("--settings-surface-hover:")
    expect(layoutBody).toContain("--settings-surface-muted:")
    expect(layoutBody).toContain("--settings-surface-emphasis:")

    for (const selector of [
      ".config-panel-card",
      ".provider-flat-row",
      ".provider-command",
      ".config-status-box",
      ".about-author-card",
      ".about-info-grid",
      ".about-shortcut-grid",
      ".prompt-card",
      ".prompt-preview-card",
      ".extension-head",
      ".extension-row",
      ".channel-doc-card",
      ".market-card",
      ".detail-card",
      ".config-section",
      ".config-subsection",
      ".agent-model-table",
      ".llm-summary-row",
    ]) {
      const body = bodyOf(selector)
      expect(body).toMatch(/background:\s*transparent/)
      expect(body).toMatch(/border:\s*0(?:\s+solid transparent)?/)
    }

    for (const selector of [
      ".config-nav-item:hover",
      ".config-toggle-list-item:hover",
      ".agent-model-row:hover",
      // PermissionsPanel migrated off .perm-row → .s-row on 2026-05-26.
      // The primitive's hover wash is opt-in via data-interactive; the
      // selector below is what every settings panel will use once its
      // rows migrate too.
      '.s-row[data-interactive="true"]:hover,\n.s-row[data-interactive="true"]:focus-within',
      ".provider-flat-row:hover,\n.provider-flat-row:focus-within",
    ]) {
      expect(bodyOf(selector)).toMatch(/background:\s*var\(--settings-surface-hover\)/)
    }

    expect(bodyOf(".knowledge-toolbar")).toMatch(/background:\s*transparent/)
    expect(bodyOf(".config-sidebar")).toMatch(/background:\s*transparent/)
    expect(bodyOf(".knowledge-toolbar")).toMatch(/border:\s*0 solid transparent/)
    expect(bodyOf(".config-section-head")).toMatch(/background:\s*transparent/)
    expect(bodyOf(".config-section-body")).toMatch(/border:\s*0 solid transparent/)
    expect(bodyOfSource(HEADER_CSS, '.oc-surface-header[data-surface="settings-group"]')).toMatch(
      /background:\s*transparent/,
    )
    expect(bodyOfSource(HEADER_CSS, '.oc-surface-header[data-surface="settings-group"]')).toMatch(
      /border-block-end:\s*0 solid transparent/,
    )
  })

  test("settings content normalizes same-level small button dimensions", () => {
    expect(bodyOf('.config-content .oc-button[data-size="sm"]')).toMatch(/--oc-button-height\s*:/)
    expect(bodyOf('.config-content .provider-head-actions .oc-button[data-size="sm"]')).toMatch(/min-width\s*:/)
    expect(bodyOf('.config-content .provider-api-key-row .oc-button[data-size="sm"]')).toMatch(
      /align-self\s*:\s*stretch/,
    )
    expect(PROVIDERS_TSX).toContain('data-ui="provider-refresh-button"')
  })

  test("memory tab owns a full-height scrollable list", () => {
    expect(bodyOf(".memory-panel")).toMatch(/flex\s*:\s*1 1 auto/)
    expect(bodyOf('.config-tab-panel[data-config-panel="memory"].active')).toMatch(/display:\s*flex/)
    expect(bodyOf("#memoryBody")).toMatch(/flex\s*:\s*1 1 auto/)

    const list = bodyOf(".knowledge-list")
    expect(list).toMatch(/flex\s*:\s*1 1 auto/)
    expect(list).toMatch(/max-height:\s*none/)
    expect(list).toMatch(/overflow-y:\s*auto/)
    expect(list).toMatch(/scrollbar-width:\s*auto/)
    expect(bodyOf(".knowledge-list::-webkit-scrollbar")).toContain("width: var(--session-scrollbar-size)")
  })

  test("prompt editor switches markdown code and preview in one tab surface", () => {
    expect(PROMPT_CATALOG_TSX).toContain("<Tabs")
    expect(PROMPT_CATALOG_TSX).toContain("<Tab")
    expect(PROMPT_CATALOG_TSX).toContain('data-ui="prompt-view-tabs"')
    expect(PROMPT_CATALOG_TSX).toContain('data-ui="prompt-view-tab"')
    expect(PROMPT_CATALOG_TSX).not.toContain('role="tablist"')
    expect(PROMPT_CATALOG_TSX).not.toContain('role="tab"')
    expect(PROMPT_CATALOG_TSX).toContain('type PromptViewMode = "code" | "preview" | "default"')
    expect(PROMPT_CATALOG_TSX).toContain('when={viewMode(entryID) !== "code"}')
    expect(PROMPT_CATALOG_TSX).toContain('class="field-input prompt-textarea"')
    expect(PROMPT_CATALOG_TSX).toContain('class="prompt-preview-card prompt-preview-card--attached"')
    expect(PROMPT_CATALOG_TSX).not.toContain('class="prompt-toolbar"')
    expect(PROMPT_CATALOG_TSX).not.toContain('<details class="prompt-diff-details">')
    expect(PROMPT_CATALOG_TSX).not.toContain('{t("prompt.show_default")}')
    expect(bodyOf('.oc-tabs[data-ui="prompt-view-tabs"]')).toMatch(/--oc-tabs-gap\s*:/)
    expect(bodyOf(".prompt-editor-actions")).toMatch(/display:\s*inline-flex/)
    expect(bodyOf('.oc-tab[data-ui="prompt-view-tab"][data-active="true"]')).toMatch(/--oc-tab-bg:\s*var\(--surface\)/)
    expect(bodyOf(".prompt-preview-card--attached")).toMatch(/min-height:\s*calc\(160px \* var\(--ui-scale\)\)/)
  })
})
