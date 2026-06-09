import { beforeEach, describe, expect, mock, test } from "bun:test"
import { PROTOCOL_VERSION, type ExtensionMessage, type WebviewMessage } from "@opencorvus-ai/transport-protocol"
import { resetVsCodeRuntimeMock, vscodeMockState, vscodeRuntimeMock } from "./vscode-runtime-mock"

mock.module("vscode", () => vscodeRuntimeMock)

interface MockWebview {
  postedMessages: ExtensionMessage[]
  receive(message: WebviewMessage | unknown): Promise<void>
  postMessage(m: ExtensionMessage): Thenable<boolean>
  onDidReceiveMessage(fn: (m: unknown) => void): { dispose: () => void }
}

function mockWebview(): MockWebview {
  const posted: ExtensionMessage[] = []
  let receiveHandler: ((m: unknown) => void) | undefined
  return {
    postedMessages: posted,
    onDidReceiveMessage(fn) {
      receiveHandler = fn
      return { dispose() {} }
    },
    postMessage(m) {
      posted.push(m)
      return Promise.resolve(true) as any
    },
    async receive(message) {
      if (!receiveHandler) throw new Error("no message handler attached")
      receiveHandler(message)
      await new Promise((r) => setTimeout(r, 0))
    },
  }
}

function mockSidecar(): any {
  return {
    baseUrl: "http://127.0.0.1:9999",
    token: "secret-token",
    username: "opencorvus",
    pid: 1,
    workspace: "/tmp/ws",
    onExit() {},
    async stop() {},
  }
}

async function createBridge() {
  const { TransportBridge } = await import("../src/transport/bridge")
  const webview = mockWebview()
  const bridge = new TransportBridge(webview as any, mockSidecar())
  return { bridge, webview }
}

function nativeResponses(webview: MockWebview): ExtensionMessage[] {
  return webview.postedMessages.filter((message) => message.type === "native.response")
}

describe("TransportBridge VS Code native command bridge", () => {
  beforeEach(() => {
    resetVsCodeRuntimeMock()
  })

  test("opens URLs and filesystem paths through vscode.env.openExternal", async () => {
    const { bridge, webview } = await createBridge()
    try {
      await webview.receive({
        protocol: PROTOCOL_VERSION,
        type: "native.request",
        id: "url-1",
        command: { kind: "open-url", url: "https://example.com/docs" },
      })
      await webview.receive({
        protocol: PROTOCOL_VERSION,
        type: "native.request",
        id: "path-1",
        command: { kind: "open-path", path: "D:/workspace/app" },
      })
      expect(vscodeMockState.openExternal.map((uri: any) => uri.toString())).toEqual([
        "https://example.com/docs",
        "file://D:/workspace/app",
      ])
      expect(nativeResponses(webview).map((message: any) => [message.id, message.ok, message.value])).toEqual([
        ["url-1", true, true],
        ["path-1", true, true],
      ])
    } finally {
      bridge.dispose()
    }
  })

  test("uses VS Code open dialog for directory and file picking", async () => {
    const { bridge, webview } = await createBridge()
    try {
      vscodeMockState.openDialogResult = [{ fsPath: "D:/workspace/app" }]
      await webview.receive({
        protocol: PROTOCOL_VERSION,
        type: "native.request",
        id: "dir-1",
        command: { kind: "workspace.pickDir", start: "D:/workspace" },
      })
      vscodeMockState.openDialogResult = [{ fsPath: "D:/workspace/a.ts" }, { fsPath: "D:/workspace/b.ts" }]
      await webview.receive({
        protocol: PROTOCOL_VERSION,
        type: "native.request",
        id: "files-1",
        command: { kind: "workspace.pickFiles", start: "D:/workspace", multiple: true },
      })
      expect(vscodeMockState.showOpenDialog[0]).toMatchObject({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
      })
      expect(vscodeMockState.showOpenDialog[1]).toMatchObject({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: true,
      })
      expect(nativeResponses(webview).map((message: any) => [message.id, message.value])).toEqual([
        ["dir-1", "D:/workspace/app"],
        ["files-1", ["D:/workspace/a.ts", "D:/workspace/b.ts"]],
      ])
    } finally {
      bridge.dispose()
    }
  })

  test("opens VS Code project editor targets with folder and file commands", async () => {
    const { bridge, webview } = await createBridge()
    try {
      vscodeMockState.fileTypes.set("D:/workspace/app", 2)
      vscodeMockState.fileTypes.set("D:/workspace/app/src/main.ts", 1)
      await webview.receive({
        protocol: PROTOCOL_VERSION,
        type: "native.request",
        id: "folder-1",
        command: { kind: "workspace.openProjectEditor", editor: "vscode", path: "D:/workspace/app" },
      })
      await webview.receive({
        protocol: PROTOCOL_VERSION,
        type: "native.request",
        id: "file-1",
        command: { kind: "workspace.openProjectEditor", editor: "vscode", path: "D:/workspace/app/src/main.ts" },
      })
      expect(vscodeMockState.executeCommand.map((call) => (call as unknown[])[0])).toEqual([
        "vscode.openFolder",
        "vscode.open",
      ])
      expect(nativeResponses(webview).every((message: any) => message.ok === true && message.value === true)).toBe(true)
    } finally {
      bridge.dispose()
    }
  })

  test("surfaces notification permission as granted and sends visible VS Code messages", async () => {
    const { bridge, webview } = await createBridge()
    try {
      await webview.receive({
        protocol: PROTOCOL_VERSION,
        type: "native.request",
        id: "perm-1",
        command: { kind: "notification.permission" },
      })
      await webview.receive({
        protocol: PROTOCOL_VERSION,
        type: "native.request",
        id: "notice-1",
        command: { kind: "notification.send", title: "Task finished", body: "OpenCorvus result ready" },
      })
      expect(vscodeMockState.information).toEqual(["Task finished\nOpenCorvus result ready"])
      expect(nativeResponses(webview).map((message: any) => [message.id, message.ok, message.value])).toEqual([
        ["perm-1", true, "granted"],
        ["notice-1", true, undefined],
      ])
    } finally {
      bridge.dispose()
    }
  })
})
