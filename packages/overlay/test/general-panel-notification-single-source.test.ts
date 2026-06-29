import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SOURCE = readFileSync(join(import.meta.dir, "../src/components/settings/GeneralPanel.tsx"), "utf8")
const removedInfoMissingSelector = ["settings-fail-on-", "information-missing"].join("")
const removedInfoMissingConfigKey = ["fail_on_", "information_missing"].join("")

test("GeneralPanel desktop notification toggle uses the shared notify permission entrypoint", () => {
  expect(SOURCE).toContain('import { ensureDesktopNotificationPermission } from "../../services/notify"')
  expect(SOURCE).toContain("if (enabled) void ensureDesktopNotificationPermission()")
  expect(SOURCE).not.toContain("requestNotificationPermission")
  expect(SOURCE).not.toContain("notificationPermissionState")
  expect(SOURCE).not.toContain("nativeMessage")
})

test("GeneralPanel settings writes show errors instead of failing open", () => {
  expect(SOURCE).toContain("const [error, setError] = createSignal")
  expect(SOURCE).toContain("await saveSettings()")
  expect(SOURCE).toContain('setError(t("settings.save_failed"')
  expect(SOURCE).toContain('setDbResetNotice(t("settings.db_reset_failed"')
  expect(SOURCE).toContain('class="config-status-box"')
  expect(SOURCE).not.toContain(removedInfoMissingSelector)
  expect(SOURCE).not.toContain(removedInfoMissingConfigKey)
  expect(SOURCE).not.toContain("handleInformationMissingChange")
  expect(SOURCE).not.toContain("patchConfig")
  expect(SOURCE).not.toContain("void patchConfig({")
  expect(SOURCE).not.toContain("saveSettings()\n    setSaved(true)")
})
