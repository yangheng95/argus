import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
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

const NATIVE_COMMAND_KINDS: NativeCommandKind[] = [
  "open-url",
  "open-path",
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
    const titlebar = read("src/components/titlebar/TitlebarMenubar.tsx")
    const onboarding = read("src/components/WorkspaceOnboardingDialog.tsx")
    const windowControls = read("src/components/WindowControls.tsx")
    const editorLaunchers = read("src/components/WorkspaceEditorLaunchers.tsx")

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
})
