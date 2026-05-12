import { afterEach, expect, test } from "bun:test"
import {
  __setHostTransportForTest,
  type HostTransport,
  type NativeCommand,
} from "../src/services/host-transport"
import { openDirectoryInEditor } from "../src/services/workspace"
import { pathBreadcrumb } from "../src/utils/dom-utils"
import { setLocaleData } from "../src/utils/i18n"

afterEach(() => __setHostTransportForTest(undefined))

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

test("cwd breadcrumb keeps editor launchers out of the directory control", () => {
  setLocaleData("en-US", {
    "cwd.browse": "Switch Folder…",
    "cwd.new": "New",
    "cwd.open": "Reveal in File Manager",
    "cwd.open_in_editor": "Open in {{name}}",
    "cwd.choose_level": "Use this folder",
  })

  const html = pathBreadcrumb("D:/workspace/app")

  expect(html).not.toContain("data-path-editor")
  expect(html).not.toContain("Open in VS Code")
  expect(html).not.toContain("Open in PyCharm")
  expect(html).not.toContain(">VS<")
  expect(html).not.toContain(">Py<")
})
