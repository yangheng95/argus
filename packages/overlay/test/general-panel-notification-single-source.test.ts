import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SOURCE = readFileSync(join(import.meta.dir, "../src/components/settings/GeneralPanel.tsx"), "utf8")

test("GeneralPanel desktop notification toggle uses the shared notify permission entrypoint", () => {
  expect(SOURCE).toContain('import { ensureDesktopNotificationPermission } from "../../services/notify";')
  expect(SOURCE).toContain("void ensureDesktopNotificationPermission();")
  expect(SOURCE).not.toContain("requestNotificationPermission")
  expect(SOURCE).not.toContain("notificationPermissionState")
  expect(SOURCE).not.toContain("nativeMessage")
})
