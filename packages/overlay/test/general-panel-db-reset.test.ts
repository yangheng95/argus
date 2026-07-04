import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const GENERAL_PANEL = readFileSync(join(import.meta.dir, "../src/components/settings/GeneralPanel.tsx"), "utf8")
const CONFIG_SERVICE = readFileSync(join(import.meta.dir, "../src/services/config.ts"), "utf8")
const MAIN = readFileSync(join(import.meta.dir, "../src/main.tsx"), "utf8")
const EN = JSON.parse(readFileSync(join(import.meta.dir, "../src/i18n/en-US.json"), "utf8"))
const ZH = JSON.parse(readFileSync(join(import.meta.dir, "../src/i18n/zh-CN.json"), "utf8"))

test("GeneralPanel database reset is exposed through the config service with explicit confirmation", () => {
  expect(GENERAL_PANEL).toContain(
    'import { reloadProjectScope, resetDatabase } from "../../services/config"',
  )
  expect(GENERAL_PANEL).not.toContain('from "../../services/project-directory"')
  expect(GENERAL_PANEL).toContain("appStore.enginePaths?.database?.trim()")
  expect(GENERAL_PANEL).toContain('window.confirm(t("settings.db_reset_confirm"')
  expect(GENERAL_PANEL).toContain("await resetDatabase(database)")
  expect(GENERAL_PANEL).not.toContain("settings.db_reset_reload_failed")
  expect(GENERAL_PANEL).toContain('data-ui="settings-db-reset"')
  expect(GENERAL_PANEL).not.toContain('apiJson("global/db/reset"')
})

test("config service owns the current database reset request shape", () => {
  expect(CONFIG_SERVICE).toContain("export async function resetDatabase(database: string)")
  expect(CONFIG_SERVICE).toContain('apiJson("global/db/reset"')
  expect(CONFIG_SERVICE).toContain("body: JSON.stringify({ database: currentDatabase })")
  expect(CONFIG_SERVICE).toContain('throw new Error("resetDatabase: database is required")')
  expect(CONFIG_SERVICE).not.toContain("projectDir")
  expect(GENERAL_PANEL).not.toContain('apiJson("global/db/reset"')
  expect(GENERAL_PANEL).not.toContain('apiRequest<unknown>("global/db/reset"')
  expect(MAIN).toContain('from "./services/config"')
  expect(MAIN).toContain("loadExpertSquadCatalog")
  expect(MAIN).toContain("resetDatabase")
  expect(MAIN).toContain("type ExpertSquadOption")
  expect(MAIN).toContain("await resetDatabase(databasePath)")
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
    "settings.db_reset_missing_database",
    "settings.db_reset_complete",
    "settings.db_reset_partial",
    "settings.db_reset_failed",
  ]) {
    expect(EN[key]).toBeTruthy()
    expect(ZH[key]).toBeTruthy()
  }
})
