import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import {
  HOST_CAPABILITIES,
  type HostCapabilities,
  type HostKind,
  type NativeCommandKind,
} from "../src/services/host-transport"

const OVERLAY_ROOT = path.resolve(import.meta.dir, "..")

function read(relativePath: string): string {
  return readFileSync(path.join(OVERLAY_ROOT, relativePath), "utf8")
}

function productionSourceFiles(root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...productionSourceFiles(fullPath))
      continue
    }
    if (/\.(css|html|ts|tsx)$/.test(entry.name)) files.push(fullPath)
  }
  return files
}

const NATIVE_COMMAND_KINDS: NativeCommandKind[] = [
  "open-url",
  "open-path",
  "browserPreview.sync",
  "browserPreview.navigate",
  "browserPreview.close",
  "browserPreview.selection.setEnabled",
  "browserPreview.selection.take",
  "settings.load",
  "settings.save",
  "config.write-file",
  "server.info",
  "server.restart",
  "devtools.toggle",
  "window.quit",
  "tray.attention.set",
  "badge.set",
  "workspace.pickDir",
  "workspace.pickFiles",
  "workspace.openProjectEditor",
  "notification.permission",
  "notification.requestPermission",
  "notification.send",
]

function supported(capabilities: HostCapabilities): NativeCommandKind[] {
  return NATIVE_COMMAND_KINDS.filter((kind) => capabilities.nativeCommands[kind])
}

describe("HostTransport capability contract", () => {
  test("every host declares the same exhaustive NativeCommand key set", () => {
    for (const kind of ["tauri", "browser", "vscode"] satisfies HostKind[]) {
      expect(Object.keys(HOST_CAPABILITIES[kind].nativeCommands).sort()).toEqual([...NATIVE_COMMAND_KINDS].sort())
    }
  })

  test("capability matrix matches implemented native command surfaces", () => {
    expect(supported(HOST_CAPABILITIES.tauri)).toEqual(NATIVE_COMMAND_KINDS)
    expect(supported(HOST_CAPABILITIES.browser)).toEqual([
      "settings.load",
      "settings.save",
      "notification.permission",
      "notification.requestPermission",
      "notification.send",
    ])
    expect(supported(HOST_CAPABILITIES.vscode)).toEqual([
      "open-url",
      "open-path",
      "settings.load",
      "settings.save",
      "workspace.pickDir",
      "workspace.pickFiles",
      "workspace.openProjectEditor",
      "notification.permission",
      "notification.requestPermission",
      "notification.send",
    ])
  })

  test("visible controls read HostTransport capabilities instead of host kind checks", () => {
    const taskDirBar = read("src/components/TaskDirBar.tsx")
    const titlebar = read("src/components/titlebar/TitlebarMenubar.tsx")
    const channelsPanel = read("src/components/settings/ChannelsPanel.tsx")
    const skillMarketPanel = read("src/components/settings/SkillMarketPanel.tsx")
    const main = read("src/main.tsx")
    const onboarding = read("src/components/WorkspaceOnboardingDialog.tsx")
    const windowControls = read("src/components/WindowControls.tsx")
    const editorLaunchers = read("src/components/WorkspaceEditorLaunchers.tsx")

    expect(taskDirBar).toContain('from "../services/workspace"')
    expect(taskDirBar).not.toContain("getHostTransport().kind")

    expect(channelsPanel).toContain("const nativeCommands = getHostTransport().capabilities.nativeCommands")
    expect(channelsPanel).toContain('nativeCommands["open-url"]')
    expect(channelsPanel).toContain("canOpenTutorialDocs()")

    expect(skillMarketPanel).toContain("const nativeCommands = getHostTransport().capabilities.nativeCommands")
    expect(skillMarketPanel).toContain('nativeCommands["workspace.pickDir"]')
    expect(skillMarketPanel).toContain('nativeCommands["open-path"]')
    expect(skillMarketPanel).toContain('nativeCommands["open-url"]')
    expect(skillMarketPanel).toContain("canPickSkillDirectory()")
    expect(skillMarketPanel).toContain("canOpenLocalPath()")
    expect(skillMarketPanel).toContain("canOpenRemoteUrl()")
    expect(skillMarketPanel).toMatch(
      /import\s+\{[\s\S]*\bSettingsSelect\b[\s\S]*\btype SettingsSelectOption\b[\s\S]*\}\s+from "\.\/primitives"/,
    )
    expect(skillMarketPanel).toContain("<SettingsSelect<FormSelectOption>")
    expect(skillMarketPanel).toContain('optionClass="settings-form-select-option"')
    expect(skillMarketPanel).toContain('optionData={(option) => ({ "data-value": option.value })}')
    expect(skillMarketPanel).not.toContain('import * as Select from "@kobalte/core/select"')
    expect(skillMarketPanel).not.toContain("<Select.Root")
    expect(skillMarketPanel).not.toContain("function FormSelectOptionItem")
    expect(skillMarketPanel).not.toContain("<select")
    expect(skillMarketPanel).not.toContain("<option")
    expect(skillMarketPanel).not.toContain("<optgroup")

    expect(main).toContain('getHostTransport().capabilities.nativeCommands["open-url"]')
    expect(main).toContain("if (!previewUrl && !canOpenExternalUrl) return")
    expect(main).toContain("if (!canOpenExternalUrl) return")

    expect(titlebar).toContain('nativeCommands["workspace.pickDir"]')
    expect(titlebar).toContain('nativeCommands["open-path"]')
    expect(titlebar).toContain('nativeCommands["open-url"]')
    expect(titlebar).toContain('nativeCommands["devtools.toggle"]')
    expect(titlebar).not.toContain('getHostTransport().kind === "tauri"')
    expect(titlebar).not.toContain('getHostTransport().kind === "browser"')
    expect(titlebar).not.toContain('getHostTransport().kind === "vscode"')

    expect(onboarding).toContain("capabilities.ui.manualWorkspacePathEntry")
    expect(onboarding).not.toContain('kind === "browser"')

    expect(windowControls).toContain("capabilities")
    expect(windowControls).toContain("ui.windowControls")
    expect(windowControls).toContain("ui.windowDrag")

    expect(editorLaunchers).toContain("capabilities.ui.projectEditors")
    expect(editorLaunchers).not.toContain("<For each={PROJECT_EDITORS}>")
    expect(HOST_CAPABILITIES.vscode.ui.projectEditors).toEqual(["vscode"])
  })

  test("retired TopBar source-test double does not remain in production source", () => {
    const references = productionSourceFiles(path.join(OVERLAY_ROOT, "src"))
      .filter((file) => /TopBar|top-bar/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(OVERLAY_ROOT, file).replace(/\\/g, "/"))

    expect(references).toEqual([])
  })

  test("native picker commands reject malformed path payloads instead of falling back", () => {
    const workspace = read("src/services/workspace.ts")
    const tauriMain = read("src-tauri/src/main.rs")

    expect(workspace).toContain('throw new Error("workspace.pickDir returned a non-string payload")')
    expect(workspace).toContain('throw new Error("workspace.pickFiles returned a non-string-array payload")')
    expect(tauriMain).toContain('"picked directory is not a filesystem path"')
    expect(tauriMain).toContain('"picked file is not a filesystem path"')
    expect(tauriMain).toContain(") -> Result<Vec<String>, String>")
    expect(tauriMain).toContain("multiple: Option<bool>")
    expect(tauriMain).toContain("blocking_pick_file()")
    expect(tauriMain).not.toContain("fall back to display string")
    expect(tauriMain).not.toContain("item_back.to_string()")
    expect(tauriMain).not.toContain("if let Ok(path) = entry.into_path()")
    expect(tauriMain).not.toContain("struct PickedFile")
    expect(tauriMain).not.toContain("mime_from_ext")
    expect(tauriMain).not.toContain("cancelled/no-op pick")
    expect(tauriMain).not.toContain("norm(picked_path) == norm(start_path)")
  })
})
