import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const GENERAL_PANEL = readFileSync(join(import.meta.dir, "../src/components/settings/GeneralPanel.tsx"), "utf8")
const CONFIG_SERVICE = readFileSync(join(import.meta.dir, "../src/services/config.ts"), "utf8")
const MAIN = readFileSync(join(import.meta.dir, "../src/main.tsx"), "utf8")
const EN = JSON.parse(readFileSync(join(import.meta.dir, "../src/i18n/en-US.json"), "utf8"))
const ZH = JSON.parse(readFileSync(join(import.meta.dir, "../src/i18n/zh-CN.json"), "utf8"))

test("GeneralPanel database reset is exposed through the config service with explicit confirmation", () => {
  expect(GENERAL_PANEL).toContain('import { reloadProjectScope, patchConfig, resetDatabase } from "../../services/config"')
  expect(GENERAL_PANEL).toContain('import { activeProjectDirectory } from "../../services/project-directory"')
  expect(GENERAL_PANEL).toContain('window.confirm(t("settings.db_reset_confirm"')
  expect(GENERAL_PANEL).toContain("await resetDatabase(directory)")
  expect(GENERAL_PANEL).toContain('data-ui="settings-db-reset"')
  expect(GENERAL_PANEL).not.toContain('apiJson("global/db/reset"')
})

test("config service owns the global database reset request shape", () => {
  expect(CONFIG_SERVICE).toContain("export async function resetDatabase(projectDir: string)")
  expect(CONFIG_SERVICE).toContain('apiJson("global/db/reset"')
  expect(CONFIG_SERVICE).toContain("body: JSON.stringify({ projectDir: directory })")
  expect(GENERAL_PANEL).not.toContain('apiJson("global/db/reset"')
  expect(GENERAL_PANEL).not.toContain('apiRequest<unknown>("global/db/reset"')
  expect(MAIN).toContain('import { loadPromptProfileCatalog, resetDatabase, type PromptProfileOption } from "./services/config"')
  expect(MAIN).toContain("await resetDatabase(projectDir)")
  expect(MAIN).not.toContain('apiJson("global/db/reset"')
  expect(MAIN).not.toContain('apiRequest<unknown>("global/db/reset"')
})

test("database reset settings strings are translated in every bundled locale", () => {
  for (const key of [
    "settings.section.database",
    "settings.db_reset_label",
    "settings.db_reset_hint",
    "settings.db_reset_button",
    "settings.db_reset_running",
    "settings.db_reset_confirm",
    "settings.db_reset_missing_directory",
    "settings.db_reset_complete",
    "settings.db_reset_partial",
    "settings.db_reset_reload_failed",
    "settings.db_reset_failed",
  ]) {
    expect(EN[key]).toBeTruthy()
    expect(ZH[key]).toBeTruthy()
  }
})
