import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"

const configService = await import("../src/services/config")
const { installRealOverlayI18n } = await import("./fixtures/i18n")

installRealOverlayI18n()

describe("prompt profile catalog selection", () => {
  test("overlay config service no longer exports prompt catalog mutation helpers", () => {
    const exports = new Set(Object.keys(configService))
    expect(exports.has("applyPromptEntries")).toBe(false)
    expect(exports.has("loadPromptCatalog")).toBe(false)
    expect(exports.has("savePromptEntry")).toBe(false)
    expect(exports.has("promptConfigValueForSave")).toBe(false)
    expect(exports.has("resetPromptEntry")).toBe(false)
  })

  test("PromptCatalog no longer renders per-agent prompt editor cards", () => {
    const source = readFileSync(join(import.meta.dir, "../src/components/settings/PromptCatalog.tsx"), "utf8")
    expect(source).not.toContain("savePromptEntry")
    expect(source).not.toContain("resetPromptEntry")
    expect(source).not.toContain("loadPromptCatalog")
    expect(source).not.toContain("data-prompt-entry")
    expect(source).not.toContain("serviceSave(entry, value)")
    expect(source).not.toContain("prompt-textarea")
  })

  test("PromptCatalog exposes read-only package-backed expert-squad selection", () => {
    const source = readFileSync(join(import.meta.dir, "../src/components/settings/PromptCatalog.tsx"), "utf8")
    expect(source).toContain('data-ui="prompt-profile-panel"')
    expect(source).toContain('data-ui="prompt-profile-overview"')
    expect(source).toContain('data-ui="prompt-profile-actions"')
    expect(source).toContain("const directory = promptProfileCatalogDirectory()")
    expect(source).toContain("if (!directory) return")
    expect(source).toContain("setProjectPromptProfileActive(")
    expect(source).toContain("setSessionPromptProfileActive(")
    expect(source).toContain("promptProfileTargetLabelID(target.id)")
    expect(source).toContain("<strong id={labelID}>{target.label}</strong>")
    expect(source).toContain('data-editable="false"')
    expect(source).toContain('data-has-overlay={value().trim().length > 0 ? "true" : "false"}')
    expect(source).toContain("<SettingsRow")
    expect(source).toContain('as="button"')
    expect(source).toContain('class="prompt-profile-list-row"')
    expect(source).toContain('data-active={selectedProfileID() === profile.id ? "true" : "false"}')
    expect(source).toContain('aria-current={selectedProfileID() === profile.id ? "true" : undefined}')
    expect(source).not.toContain('data-ui="prompt-profile-metadata"')
    expect(source).not.toContain('data-ui="prompt-profile-import-input"')
    expect(source).not.toContain('data-ui="prompt-profile-import-preview"')
    expect(source).not.toContain("savePromptProfile(")
    expect(source).not.toContain("importPromptProfiles(")
    expect(source).not.toContain("parsePromptProfileImportPayload(")
    expect(source).not.toContain('class="composer-textarea prompt-profile-textarea"')
    expect(source).not.toContain('data-ui="prompt-profile-save"')
    expect(source).not.toContain('class="prompt-profile-list-item"')
    expect(source).not.toContain("aria-selected={selectedProfileID() === profile.id")
    expect(source).not.toContain("aria-pressed={selectedProfileID() === profile.id")
    expect(source).not.toContain(
      'class="composer-textarea prompt-profile-textarea"\n                                  aria-label=',
    )
  })
})
