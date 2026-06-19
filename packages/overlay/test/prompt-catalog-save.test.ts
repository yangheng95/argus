import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"

const { promptConfigValueForSave } = await import("../src/services/config")
const { installRealOverlayI18n } = await import("./fixtures/i18n")

installRealOverlayI18n()

describe("prompt catalog save values", () => {
  const appendEntry = {
    key: "architect",
    prompt_mode: "append",
    default_prompt: "Default architect prompt.",
  }

  test("append-mode preserves the editable append text exactly", () => {
    expect(promptConfigValueForSave(appendEntry, "Default architect prompt.")).toBe("Default architect prompt.")
  })

  test("append-mode saves the editable append text exactly", () => {
    expect(promptConfigValueForSave(appendEntry, "Extra instruction.")).toBe("Extra instruction.")
  })

  test("append-mode no longer strips a built-in prompt prefix on save", () => {
    expect(promptConfigValueForSave(appendEntry, "Replaced architect prompt.")).toBe("Replaced architect prompt.")
  })

  test("override-mode saves the editor text exactly", () => {
    expect(
      promptConfigValueForSave(
        {
          key: "coding",
          prompt_mode: "override",
          default_prompt: "Default coding prompt.",
        },
        "Custom coding prompt.",
      ),
    ).toBe("Custom coding prompt.")
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

  test("PromptCatalog exposes prompt-profile management and import as the editable prompt surface", () => {
    const source = readFileSync(join(import.meta.dir, "../src/components/settings/PromptCatalog.tsx"), "utf8")
    expect(source).toContain('data-ui="prompt-profile-panel"')
    expect(source).toContain('data-ui="prompt-profile-import-input"')
    expect(source).toContain('data-ui="prompt-profile-import-preview"')
    expect(source).toContain("savePromptProfile(")
    expect(source).toContain("importPromptProfiles(")
    expect(source).toContain("parsePromptProfileImportPayload(")
    expect(source).toContain("setProjectPromptProfileActive(")
    expect(source).toContain("setSessionPromptProfileActive(")
    expect(source).toContain("target.editable")
    expect(source).toContain("promptProfileTargetLabelID(target.id)")
    expect(source).toContain("<strong id={labelID}>{target.label}</strong>")
    expect(source).toContain('class="composer-textarea prompt-profile-textarea"')
    expect(source).toContain("aria-labelledby={labelID}")
    expect(source).toContain("<SettingsRow")
    expect(source).toContain('as="button"')
    expect(source).toContain('class="prompt-profile-list-row"')
    expect(source).toContain('data-active={selectedProfileID() === profile.id ? "true" : "false"}')
    expect(source).toContain('aria-current={selectedProfileID() === profile.id ? "true" : undefined}')
    expect(source).not.toContain('class="prompt-profile-list-item"')
    expect(source).not.toContain('aria-selected={selectedProfileID() === profile.id')
    expect(source).not.toContain('aria-pressed={selectedProfileID() === profile.id')
    expect(source).not.toContain('class="composer-textarea prompt-profile-textarea"\n                                  aria-label=')
  })
})
