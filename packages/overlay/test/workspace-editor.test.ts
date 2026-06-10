import { afterEach, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { __setHostTransportForTest, type HostTransport, type NativeCommand } from "../src/services/host-transport"
import { setLocaleData } from "../src/utils/i18n"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"

const { editorTargetPath, openDirectoryInEditor, openPathInSelectedEditor } = await import("../src/services/workspace")
const { applySettings, DEFAULT_SETTINGS } = await import("../src/store/settings")
const { pathBreadcrumb } = await import("../src/utils/dom-utils")

afterEach(() => {
  __setHostTransportForTest(undefined)
  applySettings(DEFAULT_SETTINGS)
})

function fakeTransport(calls: NativeCommand[]): HostTransport {
  return {
    kind: "tauri",
    async request() {
      throw new Error("request not expected")
    },
    openStream() {
      throw new Error("stream not expected")
    },
    async native(command) {
      calls.push(command)
      return true
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  }
}

test("openDirectoryInEditor routes the selected project editor through HostTransport", async () => {
  const calls: NativeCommand[] = []
  __setHostTransportForTest(fakeTransport(calls))

  await openDirectoryInEditor("vscode", "D:/workspace/app")

  expect(calls).toEqual([
    {
      kind: "workspace.openProjectEditor",
      editor: "vscode",
      path: "D:/workspace/app",
    },
  ])
})

test("openPathInSelectedEditor routes file links through the persisted top-right IDE", async () => {
  const calls: NativeCommand[] = []
  __setHostTransportForTest(fakeTransport(calls))
  applySettings({ ...DEFAULT_SETTINGS, projectEditor: "cursor" })

  await openPathInSelectedEditor("D:/workspace/app/src/main.ts")

  expect(calls).toEqual([
    {
      kind: "workspace.openProjectEditor",
      editor: "cursor",
      path: "D:/workspace/app/src/main.ts",
    },
  ])
})

test("editorTargetPath resolves relative file links against the active directory", () => {
  applySettings({ ...DEFAULT_SETTINGS, directory: "D:/workspace/app" })

  expect(editorTargetPath("src/main.ts")).toBe("D:/workspace/app/src/main.ts")
  expect(editorTargetPath("C:/other/file.ts")).toBe("C:/other/file.ts")
})

test("editorTargetPath refuses unresolved relative file links without an active directory", () => {
  applySettings(DEFAULT_SETTINGS)

  expect(editorTargetPath("src/main.ts")).toBe("")
  expect(editorTargetPath("C:/other/file.ts")).toBe("C:/other/file.ts")
})

test("markdown file links no longer open the built-in workspace file preview", () => {
  const main = readFileSync(join(import.meta.dir, "../src/main.tsx"), "utf8")
  const panel = readFileSync(join(import.meta.dir, "../src/components/WorkspacePanel.tsx"), "utf8")

  expect(main).toContain("openPathInSelectedEditor(path)")
  expect(main).not.toContain("openWorkspaceFile")
  expect(panel).not.toContain('kind: "file"')
  expect(panel).not.toContain("FileViewPanel")
})

test("cwd breadcrumb keeps editor launchers out of the directory control", () => {
  setLocaleData("en-US", {
    "cwd.browse": "Switch Folder…",
    "cwd.open": "Reveal in File Manager",
    "cwd.open_in_editor": "Open in {{name}}",
    "cwd.choose_level": "Use this folder",
  })

  const html = pathBreadcrumb("D:/workspace/app", { browseDirectory: true, openDirectory: true })

  expect(html).not.toContain("data-path-editor")
  expect(html).not.toContain("Open in VS Code")
  expect(html).not.toContain("Open in PyCharm")
  expect(html).not.toContain(">VS<")
  expect(html).not.toContain(">Py<")
  expect(html).not.toContain('data-path-action="create"')
})

test("cwd breadcrumb renders only host-supported native path actions", () => {
  setLocaleData("en-US", {
    "cwd.browse": "Switch Folder…",
    "cwd.open": "Reveal in File Manager",
    "cwd.choose_level": "Use this folder",
  })

  const supported = pathBreadcrumb("D:/workspace/app", { browseDirectory: true, openDirectory: true })
  expect(supported).toContain('data-path-action="browse"')
  expect(supported).toContain("data-path-open=")
  expect(supported).toContain("data-path-set=")

  const unsupported = pathBreadcrumb("D:/workspace/app", { browseDirectory: false, openDirectory: false })
  expect(unsupported).not.toContain('data-path-action="browse"')
  expect(unsupported).not.toContain("data-path-open=")
  expect(unsupported).toContain("data-path-set=")
  expect(unsupported).toContain('class="task-dir-node"')
})
