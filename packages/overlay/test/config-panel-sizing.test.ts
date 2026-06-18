import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  clampConfigSidebarWidth,
  configSidebarResizeBounds,
  nextConfigSidebarKeyboardWidth,
} from "../src/components/settings/config-resizer"

const OVERLAY_ROOT = join(import.meta.dir, "..")
const SETTINGS_CSS = readFileSync(join(OVERLAY_ROOT, "src", "styles", "surfaces", "settings.css"), "utf8")
const CONFIG_DIALOG_TSX = readFileSync(join(OVERLAY_ROOT, "src", "components", "ConfigDialogHost.tsx"), "utf8")
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

  test("config sidebar resizer exposes keyboard separator semantics", () => {
    expect(CONFIG_DIALOG_TSX).toContain('role="separator"')
    expect(CONFIG_DIALOG_TSX).toContain('aria-orientation="vertical"')
    expect(CONFIG_DIALOG_TSX).toContain('aria-controls="configSidebar"')
    expect(CONFIG_DIALOG_TSX).toContain("aria-valuemin")
    expect(CONFIG_DIALOG_TSX).toContain("aria-valuemax")
    expect(CONFIG_DIALOG_TSX).toContain("aria-valuenow")
    expect(CONFIG_DIALOG_TSX).toContain("tabIndex={0}")
    expect(CONFIG_DIALOG_TSX).toContain("onKeyDown={handleResizeKeyDown}")
    expect(
      bodyOf(
        '.config-resizer:hover::before,\n.config-resizer:focus-visible::before,\n.config-resizer[data-active="true"]::before',
      ),
    ).toMatch(/background:\s*var\(--accent\)/)
  })

  test("config sidebar keyboard resize clamps to the same bounds", () => {
    const bounds = configSidebarResizeBounds(2)
    expect(bounds).toEqual({ min: 280, max: 640, step: 32 })
    expect(clampConfigSidebarWidth(100, bounds)).toBe(280)
    expect(clampConfigSidebarWidth(700, bounds)).toBe(640)
    expect(nextConfigSidebarKeyboardWidth(400, "ArrowLeft", bounds)).toBe(368)
    expect(nextConfigSidebarKeyboardWidth(400, "ArrowRight", bounds)).toBe(432)
    expect(nextConfigSidebarKeyboardWidth(400, "Home", bounds)).toBe(280)
    expect(nextConfigSidebarKeyboardWidth(400, "End", bounds)).toBe(640)
    expect(nextConfigSidebarKeyboardWidth(400, "Enter", bounds)).toBeUndefined()
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
      ".prompt-preview-card",
      ".extension-head",
      ".extension-row",
      ".channel-doc-card",
      ".market-card",
      ".detail-card",
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
    expect(bodyOf(".config-section-body")).toMatch(/border:\s*0 solid transparent/)
    expect(SETTINGS_CSS).not.toMatch(/(^|[\n,{])\s*\.config-section(?!-body)(?:\s|[,>{:+~.#\[]|$)/m)
    expect(SETTINGS_CSS).not.toMatch(/(^|[\n,{])\s*\.config-subsection(?:\s|[,>{:+~.#\[]|$)/m)
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

  test("about author avatar uses the Icon primitive", () => {
    expect(CONFIG_DIALOG_TSX).toContain('<Icon name="avatar-user" size={40} />')
    expect(CONFIG_DIALOG_TSX).not.toContain('viewBox="0 0 40 40"')
    expect(CONFIG_DIALOG_TSX).not.toMatch(/<svg\b/i)
    expect(bodyOf(".about-author-avatar")).toMatch(/color:\s*var\(--accent\)/)
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

  test("prompt profile editor has no retired per-agent prompt editor surface", () => {
    expect(PROMPT_CATALOG_TSX).not.toContain("<Tabs")
    expect(PROMPT_CATALOG_TSX).not.toContain("<Tab")
    expect(PROMPT_CATALOG_TSX).not.toContain('data-ui="prompt-view-tabs"')
    expect(PROMPT_CATALOG_TSX).not.toContain('data-ui="prompt-view-tab"')
    expect(PROMPT_CATALOG_TSX).not.toContain('role="tablist"')
    expect(PROMPT_CATALOG_TSX).not.toContain('role="tab"')
    expect(PROMPT_CATALOG_TSX).not.toContain('type PromptViewMode = "code" | "preview" | "default"')
    expect(PROMPT_CATALOG_TSX).not.toContain('when={viewMode(entryID) !== "code"}')
    expect(PROMPT_CATALOG_TSX).not.toContain('class="field-input prompt-textarea"')
    expect(PROMPT_CATALOG_TSX).toContain('class="field-input prompt-profile-textarea"')
    expect(PROMPT_CATALOG_TSX).toContain('class="prompt-preview-card prompt-preview-card--attached"')
    expect(PROMPT_CATALOG_TSX).not.toContain('class="prompt-toolbar"')
    expect(PROMPT_CATALOG_TSX).not.toContain('<details class="prompt-diff-details">')
    expect(PROMPT_CATALOG_TSX).not.toContain('{t("prompt.show_default")}')
    expect(SETTINGS_CSS).not.toContain('data-ui="prompt-view-tabs"')
    expect(SETTINGS_CSS).not.toContain('data-ui="prompt-view-tab"')
    expect(SETTINGS_CSS).not.toContain(".prompt-textarea")
    expect(SETTINGS_CSS).not.toContain(".prompt-editor-actions")
    expect(bodyOf(".prompt-preview-card--attached")).toMatch(/min-height:\s*calc\(160px \* var\(--ui-scale\)\)/)
  })
})
