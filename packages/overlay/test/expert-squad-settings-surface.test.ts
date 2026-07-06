import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"

const OVERLAY_ROOT = join(import.meta.dir, "..")
const configService = await import("../src/services/config")
const expertSquadService = await import("../src/services/expert-squad")
const { installRealOverlayI18n } = await import("./fixtures/i18n")

installRealOverlayI18n()

const expertSquadPanel = readFileSync(
  join(OVERLAY_ROOT, "src", "components", "settings", "ExpertSquadPanel.tsx"),
  "utf8",
)
const chatComposer = readFileSync(join(OVERLAY_ROOT, "src", "components", "ChatComposer.tsx"), "utf8")
const dialogStore = readFileSync(join(OVERLAY_ROOT, "src", "store", "dialog.ts"), "utf8")
const configHost = readFileSync(join(OVERLAY_ROOT, "src", "components", "ConfigDialogHost.tsx"), "utf8")
const settingsCss = readFileSync(join(OVERLAY_ROOT, "src", "styles", "surfaces", "settings.css"), "utf8")
const en = JSON.parse(readFileSync(join(OVERLAY_ROOT, "src", "i18n", "en-US.json"), "utf8"))
const zh = JSON.parse(readFileSync(join(OVERLAY_ROOT, "src", "i18n", "zh-CN.json"), "utf8"))

describe("expert squad settings surface", () => {
  test("old PromptCatalog settings surface is removed", () => {
    expect(existsSync(join(OVERLAY_ROOT, "src", "components", "settings", "PromptCatalog.tsx"))).toBe(false)

    const configExports = new Set(Object.keys(configService))
    expect(configExports.has("loadPromptProfileCatalog")).toBe(false)
    expect(configExports.has("setProjectPromptProfileActive")).toBe(false)
    expect(configExports.has("setSessionPromptProfileActive")).toBe(false)
    expect(configExports.has("loadPromptCatalog")).toBe(false)

    expect(dialogStore).not.toContain('| "prompt"')
    expect(dialogStore).not.toContain("prompt.title")
    expect(configHost).not.toContain("PromptCatalog")
    expect(configHost).not.toContain('data-config-panel="prompt"')
    expect(settingsCss).not.toContain(".prompt-profile-")
  })

  test("settings tab is the expert-squad package inspector and lifecycle surface", () => {
    expect(dialogStore).toContain('| "expert-squad"')
    expect(dialogStore).toContain('{ id: "expert-squad", labelKey: "expert_squad.title" }')
    expect(configHost).toContain('import ExpertSquadPanel from "./settings/ExpertSquadPanel"')
    expect(configHost).toContain('return "expertSquadBody"')
    expect(configHost).toContain("<ExpertSquadPanel />")

    expect(expertSquadPanel).toContain('data-ui="expert-squad-panel"')
    expect(expertSquadPanel).toContain('data-ui="expert-squad-overview"')
    expect(expertSquadPanel).toContain('data-ui="expert-squad-actions"')
    expect(expertSquadPanel).toContain('data-ui="expert-squad-import-folder"')
    expect(expertSquadPanel).toContain('data-ui="expert-squad-import-archive"')
    expect(expertSquadPanel).toContain('data-ui="expert-squad-export"')
    expect(expertSquadPanel).toContain('data-ui="expert-squad-clear-session-override"')
    expect(expertSquadPanel).toContain("loadExpertSquadCatalog")
    expect(expertSquadPanel).toContain("clearSessionExpertSquadOverride")
    expect(expertSquadPanel).toContain("importExpertSquadFolder")
    expect(expertSquadPanel).toContain("importExpertSquadArchive")
    expect(expertSquadPanel).toContain("exportExpertSquadArchive")
    expect(expertSquadPanel).toContain("setProjectExpertSquadActive")
    expect(expertSquadPanel).toContain("setSessionExpertSquadActive")
    expect(expertSquadPanel).toContain("catalog()?.active.session_override")
    expect(expertSquadPanel).toContain("squad.display_label")
    expect(expertSquadPanel).toContain("squad.readme.content")
    expect(expertSquadPanel).toContain("squad.selector")
    expect(expertSquadPanel).toContain("selector_instructions_title")
    expect(expertSquadPanel).toContain("squad.capability_projection.scheduler")
    expect(chatComposer).toContain("option.display_label")
  })

  test("surface remains read-only for package prompt text and has no prompt editor residue", () => {
    expect(expertSquadPanel).not.toContain("savePromptEntry")
    expect(expertSquadPanel).not.toContain("resetPromptEntry")
    expect(expertSquadPanel).not.toContain("loadPromptCatalog")
    expect(expertSquadPanel).not.toContain("savePromptProfile")
    expect(expertSquadPanel).not.toContain("parsePromptProfileImportPayload")
    expect(expertSquadPanel).not.toContain("<textarea")
    expect(expertSquadPanel).not.toContain("AutoGrowTextarea")
    expect(expertSquadPanel).not.toContain('class="composer-textarea expert-squad-textarea"')
    expect(expertSquadPanel).not.toContain('data-ui="expert-squad-save"')
    expect(expertSquadPanel).not.toContain("deletePromptProfile")
    expect(expertSquadPanel).not.toContain("deleteExpertSquad")
  })

  test("expert-squad service is the single overlay catalog client", () => {
    const exports = new Set(Object.keys(expertSquadService))
    expect(exports.has("loadExpertSquadCatalog")).toBe(true)
    expect(exports.has("setProjectExpertSquadActive")).toBe(true)
    expect(exports.has("setSessionExpertSquadActive")).toBe(true)
    expect(exports.has("clearSessionExpertSquadOverride")).toBe(true)
    expect(exports.has("importExpertSquadFolder")).toBe(true)
    expect(exports.has("importExpertSquadArchive")).toBe(true)
    expect(exports.has("exportExpertSquadArchive")).toBe(true)
    expect(exports.has("loadPromptProfileCatalog")).toBe(false)
  })

  test("expert-squad labels are translated in every bundled locale", () => {
    for (const key of [
      "expert_squad.title",
      "expert_squad.settings_title",
      "expert_squad.import_folder",
      "expert_squad.import_archive",
      "expert_squad.replace_existing",
      "expert_squad.catalog_failed",
      "expert_squad.session_override",
      "expert_squad.clear_session_override",
      "expert_squad.cleared_session_override",
      "expert_squad.inherits_project",
      "expert_squad.readme_title",
      "expert_squad.selector_title",
      "expert_squad.selector_instructions_title",
      "expert_squad.capability_projection",
      "expert_squad.export",
    ]) {
      expect(en[key]).toBeTruthy()
      expect(zh[key]).toBeTruthy()
    }
  })
})
