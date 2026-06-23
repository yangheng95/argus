import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import {
  clampConfigSidebarWidth,
  configSidebarResizeBounds,
  nextConfigSidebarKeyboardWidth,
} from "../src/utils/config-sidebar-resizer"

const OVERLAY_ROOT = join(import.meta.dir, "..")
const SETTINGS_CSS = readFileSync(join(OVERLAY_ROOT, "src", "styles", "surfaces", "settings.css"), "utf8")
const FIELD_CSS = readFileSync(join(OVERLAY_ROOT, "src", "styles", "surfaces", "field.css"), "utf8")
const SETTINGS_COMPONENTS_DIR = join(OVERLAY_ROOT, "src", "components", "settings")
const CONFIG_DIALOG_TSX = readFileSync(join(OVERLAY_ROOT, "src", "components", "ConfigDialogHost.tsx"), "utf8")
const DIALOG_SERVICE = readFileSync(join(OVERLAY_ROOT, "src", "services", "dialog.ts"), "utf8")
const CHANNELS_TSX = readFileSync(join(OVERLAY_ROOT, "src", "components", "settings", "ChannelsPanel.tsx"), "utf8")
const HEADER_CSS = readFileSync(join(OVERLAY_ROOT, "src", "styles", "surfaces", "header.css"), "utf8")
const PROVIDERS_TSX = readFileSync(join(OVERLAY_ROOT, "src", "components", "settings", "ProvidersPanel.tsx"), "utf8")
const PROMPT_CATALOG_TSX = readFileSync(
  join(OVERLAY_ROOT, "src", "components", "settings", "PromptCatalog.tsx"),
  "utf8",
)
const RETIRED_LLM_PROVIDER_SELECTORS = [
  ".llm-panel",
  ".llm-summary-row",
  ".llm-summary",
  ".llm-api-key-summary",
  ".llm-auth-row",
]
const RETIRED_SETTINGS_CONTINUATION_SELECTORS = [
  ".playwright-options",
  ".channel-public-url-head",
  ".config-field-row",
  ".config-inline-popup",
  ".config-row",
  ".config-label",
  ".config-value",
  ".opacity-field",
]

function walkFiles(root: string, accept: (path: string) => boolean): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) return walkFiles(path, accept)
    return accept(path) ? [path] : []
  })
}

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
    expect(() => configSidebarResizeBounds(0)).toThrow("Config sidebar resize scale must be a positive finite number")
    expect(() => configSidebarResizeBounds(Number.NaN)).toThrow(
      "Config sidebar resize scale must be a positive finite number",
    )
    expect(clampConfigSidebarWidth(100, bounds)).toBe(280)
    expect(clampConfigSidebarWidth(700, bounds)).toBe(640)
    expect(nextConfigSidebarKeyboardWidth(400, "ArrowLeft", bounds)).toBe(368)
    expect(nextConfigSidebarKeyboardWidth(400, "ArrowRight", bounds)).toBe(432)
    expect(nextConfigSidebarKeyboardWidth(400, "Home", bounds)).toBe(280)
    expect(nextConfigSidebarKeyboardWidth(400, "End", bounds)).toBe(640)
    expect(nextConfigSidebarKeyboardWidth(400, "Enter", bounds)).toBeUndefined()
  })

  test("config sidebar style and ARIA share the clamped width source", () => {
    expect(DIALOG_SERVICE).toContain('import { currentUIScale } from "../utils/layout-tokens"')
    expect(DIALOG_SERVICE).toContain(
      'setDialogStore("config", "sidebarWidth", clampConfigSidebarWidth(width, configSidebarResizeBounds(currentUIScale())))',
    )
    expect(CONFIG_DIALOG_TSX).toContain('import { currentUIScale } from "../utils/layout-tokens"')
    expect(CONFIG_DIALOG_TSX).toContain("const configuredSidebarWidth = createMemo")
    expect(CONFIG_DIALOG_TSX).toContain("return clampConfigSidebarWidth(width, resizeBounds())")
    expect(CONFIG_DIALOG_TSX).toContain("const width = configuredSidebarWidth()")
    expect(CONFIG_DIALOG_TSX).toContain("if (width != null) return width")
    expect(CONFIG_DIALOG_TSX).toContain("return resizeBounds().min")
    expect(CONFIG_DIALOG_TSX).not.toContain("220 * currentUIScale()")
    expect(CONFIG_DIALOG_TSX).not.toContain(
      'const width = dialogStore.config.sidebarWidth\n    if (typeof width === "number"',
    )
  })

  test("config sidebar pointer drag is frame coalesced", () => {
    expect(CONFIG_DIALOG_TSX).toContain("let pendingMove:")
    expect(CONFIG_DIALOG_TSX).toContain("requestAnimationFrame")
    expect(CONFIG_DIALOG_TSX).toContain("flushPendingMove()")
    expect(CONFIG_DIALOG_TSX).toContain("pendingMove = {\n        dx: moveEvent.clientX - startX")
    expect(CONFIG_DIALOG_TSX).toContain("schedulePendingMove()")
    expect(CONFIG_DIALOG_TSX).not.toContain("opts.onMove(moveEvent.clientX - startX")
  })

  test("settings panels keep a flat borderless owner surface", () => {
    const dialogBody = bodyOf("#configDialog .dialog-form")
    expect(dialogBody).toContain("--settings-surface-base: var(--surface-inset)")
    expect(dialogBody).toContain("--settings-surface-hover:")
    expect(dialogBody).toContain("--settings-surface-muted:")
    expect(dialogBody).toContain("--settings-surface-emphasis:")

    for (const selector of [
      ".s-row",
      ".provider-settings-row",
      ".provider-add-card",
      ".provider-command",
      ".config-status-box",
      ".about-author-card",
      ".about-info-grid",
      ".about-shortcut-grid",
      ".prompt-preview-card",
      ".extension-head",
      ".channel-doc-card",
      ".market-card",
      ".agent-model-table",
    ]) {
      const body = bodyOf(selector)
      expect(body).toMatch(/background:\s*transparent/)
      expect(body).toMatch(/border:\s*0(?:\s+solid transparent)?/)
    }

    for (const selector of [
      ".config-sidebar .oc-tab:hover,\n.config-sidebar .oc-tab:focus-visible",
      '.s-row[data-interactive="true"]:hover,\n.s-row[data-interactive="true"]:focus-within',
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

  test("retired LLM provider summary selectors stay out of settings surfaces", () => {
    for (const selector of RETIRED_LLM_PROVIDER_SELECTORS) {
      expect(SETTINGS_CSS).not.toContain(selector)
    }

    const residues = walkFiles(SETTINGS_COMPONENTS_DIR, (path) => /\.(?:ts|tsx)$/.test(path)).flatMap((file) => {
      const source = readFileSync(file, "utf8")
      return RETIRED_LLM_PROVIDER_SELECTORS.filter((selector) => source.includes(selector)).map(
        (selector) => `${file.replace(OVERLAY_ROOT, "").replace(/\\/g, "/")}: ${selector}`,
      )
    })
    expect(residues).toEqual([])
    expect(PROVIDERS_TSX).toContain('class="provider-row-summary"')
    expect(PROVIDERS_TSX).toContain("SettingsPill")
  })

  test("retired settings continuation selectors stay out while channel owners stay live", () => {
    for (const selector of RETIRED_SETTINGS_CONTINUATION_SELECTORS) {
      expect(SETTINGS_CSS).not.toContain(selector)
      expect(FIELD_CSS).not.toContain(selector)
    }

    expect(SETTINGS_CSS).toContain("#channelConfigBody")
    expect(SETTINGS_CSS).toContain("#channelList")
    expect(SETTINGS_CSS).toContain(".config-inline-form")
    expect(SETTINGS_CSS).toContain(".extension-head .field-label")
    expect(SETTINGS_CSS).toContain(".general-panel")
    expect(SETTINGS_CSS).toContain(".loading-hint")
    expect(CONFIG_DIALOG_TSX).toContain('return "channelConfigBody"')
    expect(CHANNELS_TSX).toContain('id="channelList"')
  })

  test("settings content normalizes same-level small button dimensions", () => {
    expect(bodyOf('.config-content .oc-button[data-size="sm"]')).toMatch(/--oc-button-height\s*:/)
    expect(bodyOf('.config-content .provider-head-actions .oc-button[data-size="sm"]')).toMatch(/min-width\s*:/)
    expect(bodyOf('.config-content .provider-api-key-row .oc-button[data-size="sm"]')).toMatch(
      /align-self\s*:\s*stretch/,
    )
    expect(PROVIDERS_TSX).toContain('data-ui="provider-refresh-button"')
    expect(PROVIDERS_TSX).toContain('data-spinning={refreshing() ? "true" : "false"}')
    expect(PROVIDERS_TSX).not.toContain("provider-refresh-btn")
    expect(SETTINGS_CSS).not.toContain(".provider-refresh-btn")
    expect(
      bodyOf(
        '.provider-head-actions .oc-button[data-ui="provider-refresh-button"][data-spinning="true"] .provider-refresh-icon',
      ),
    ).toMatch(/transform:\s*rotate\(90deg\)/)
  })

  test("about author avatar uses the Icon primitive", () => {
    expect(CONFIG_DIALOG_TSX).toContain('<Icon name="avatar-user" size={40} />')
    expect(CONFIG_DIALOG_TSX).not.toContain('viewBox="0 0 40 40"')
    expect(CONFIG_DIALOG_TSX).not.toMatch(/<svg\b/i)
    expect(bodyOf(".about-author-avatar")).toMatch(/color:\s*var\(--accent\)/)
  })

  test("memory tab owns a full-height scrollable list", () => {
    expect(bodyOf(".memory-panel")).toMatch(/flex\s*:\s*1 1 auto/)
    expect(bodyOf('.config-tab-panel[data-config-panel="memory"]')).toMatch(/display:\s*flex/)
    expect(bodyOf("#memoryBody")).toMatch(/flex\s*:\s*1 1 auto/)

    const list = bodyOf(".knowledge-list")
    expect(list).toMatch(/flex\s*:\s*1 1 auto/)
    expect(list).toMatch(/max-height:\s*none/)
    expect(list).toMatch(/overflow-y:\s*auto/)
    expect(list).toMatch(/scrollbar-width:\s*auto/)
    expect(bodyOf(".knowledge-list::-webkit-scrollbar")).toContain("width: var(--session-scrollbar-size)")
  })

  test("settings dialog sidebar uses the shared Tabs primitive", () => {
    expect(CONFIG_DIALOG_TSX).toContain('import { Button } from "./ui/Button"')
    expect(CONFIG_DIALOG_TSX).toContain("<Button")
    expect(CONFIG_DIALOG_TSX).toContain('data-ui="config-dialog-close"')
    expect(CONFIG_DIALOG_TSX).toContain('id="btnCloseConfigDialog"')
    expect(CONFIG_DIALOG_TSX).not.toContain('class="config-close-btn"')
    expect(CONFIG_DIALOG_TSX).toContain('import { Tab, TabList, TabPanel, Tabs } from "./ui/Tabs"')
    expect(CONFIG_DIALOG_TSX).toContain("<Tabs")
    expect(CONFIG_DIALOG_TSX).toContain("<TabList")
    expect(CONFIG_DIALOG_TSX).toContain("<Tab")
    expect(CONFIG_DIALOG_TSX).toContain("<TabPanel")
    expect(CONFIG_DIALOG_TSX).toContain("onValueChange={switchConfigTab}")
    expect(CONFIG_DIALOG_TSX).toContain('orientation="vertical"')
    expect(CONFIG_DIALOG_TSX).not.toContain('"config-nav-item"')
    expect(CONFIG_DIALOG_TSX).not.toContain('class="config-nav-spacer"')
    expect(CONFIG_DIALOG_TSX).not.toContain('class="config-tab-panel active"')
    expect(SETTINGS_CSS).not.toMatch(/\.config-nav-item\b/)
    expect(SETTINGS_CSS).not.toMatch(/\.config-nav-spacer\b/)
    expect(SETTINGS_CSS).not.toMatch(/\.config-tab-panel\.active\b/)
    expect(SETTINGS_CSS).not.toMatch(/\.config-close-btn\b/)
    expect(bodyOf('.dialog-header-actions .oc-button[data-ui="config-dialog-close"]')).toMatch(
      /--oc-button-color:\s*var\(--text-muted\)/,
    )
    expect(
      bodyOf(
        '.dialog-header-actions .oc-button[data-ui="config-dialog-close"]:hover,\n.dialog-header-actions .oc-button[data-ui="config-dialog-close"]:focus-visible',
      ),
    ).toMatch(/--oc-button-bg:\s*var\(--settings-surface-muted\)/)
    expect(bodyOf(".config-sidebar .oc-tabs")).toMatch(/flex-direction:\s*column/)
    expect(bodyOf(".config-sidebar .oc-tab")).toMatch(/justify-content:\s*flex-start/)
    expect(bodyOf('.config-sidebar .oc-tab[data-config-tab="about"]')).toMatch(/margin-top:\s*auto/)
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
    expect(PROMPT_CATALOG_TSX).toContain('class="composer-textarea prompt-profile-textarea"')
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
