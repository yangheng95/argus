import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")

function read(rel: string): string {
  return readFileSync(join(OVERLAY_ROOT, rel), "utf8")
}

test("App owns the global overlay host components", () => {
  const app = read("src/components/App.tsx")
  const main = read("src/main.tsx")

  expect(app).not.toContain("return null")
  for (const host of [
    "solidTitlebarMenu",
    "solidWindowControls",
    "solidConnBadge",
    "connectionBannerHost",
    "commandPaletteHost",
    "appDialogHost",
    "configDialogHost",
    "sessionDialogHost",
    "interactionDialogHost",
    "goalDialogHost",
    "imagePreviewHost",
    "workspaceOnboardingHost",
  ]) {
    expect(app).toContain(`id="${host}"`)
  }
  for (const component of [
    "TitlebarMenubar",
    "WindowControls",
    "ConnectionBadge",
    "ConnectionBanner",
    "CommandPalette",
    "AppDialogHost",
    "ConfigDialogHost",
    "SessionDialogHost",
    "InteractionDialogHost",
    "GoalDialogHost",
    "ImagePreviewHost",
    "WorkspaceOnboardingDialog",
  ]) {
    expect(app).toContain(`<${component} />`)
    expect(main).not.toContain(`render(() => <${component}`)
  }
  expect(main).toContain('import { App } from "./components/App"')
  expect(main).toContain("render(() => <App />, host)")
  expect(main.indexOf("ensureOverlayAppHost()")).toBeLessThan(main.indexOf("await initApp({"))
})
