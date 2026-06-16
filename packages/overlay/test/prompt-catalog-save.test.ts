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

  test("PromptCatalog editor uses editable_prompt instead of profile-applied effective_prompt", () => {
    const source = readFileSync(join(import.meta.dir, "../src/components/settings/PromptCatalog.tsx"), "utf8")
    expect(source).toContain("function editablePrompt")
    expect(source).toContain("entry.editable_prompt ?? entry.prompt ??")
    expect(source).toContain("entry.effective_prompt ?? currentDraft()")
  })

  test("PromptCatalog exposes visible prompt-profile management separate from per-agent prompt saves", () => {
    const source = readFileSync(join(import.meta.dir, "../src/components/settings/PromptCatalog.tsx"), "utf8")
    expect(source).toContain('data-ui="prompt-profile-panel"')
    expect(source).toContain("savePromptProfile(")
    expect(source).toContain("setProjectPromptProfileActive(")
    expect(source).toContain("setSessionPromptProfileActive(")
    expect(source).toContain("target.editable")
    expect(source).toContain("serviceSave(entry, value)")
  })
})
