import { describe, expect, mock, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const binding = {
  windowId: 99,
  matchTitle: "Editor",
  info: {
    id: 99,
    title: "Editor (old)",
    appName: "Code",
    x: 20,
    y: 20,
    width: 1000,
    height: 700,
    isMinimized: false,
    isFocused: true,
  },
}

mock.module("../../src/opencorvus/perception/window", () => ({
  WindowManager: {
    getBinding: async () => binding,
    ensureBoundForeground: async () => true,
    rebindForTask: async (_taskEpoch: number) => null,
  },
}))

mock.module("../../src/opencorvus/perception/capture", () => ({
  Capture: {
    take: async () => ({
      path: "x",
      width: 1280,
      height: 800,
      buffer: Buffer.from("png"),
      rawBuffer: Buffer.from("raw"),
      timestamp: Date.now(),
      windowBounds: { x: 100, y: 80, width: 1280, height: 800 },
      scope: "window",
      window: { id: 7, title: "Editor", appName: "Code" },
      monitor: null,
    }),
    cleanup: async () => {},
  },
}))

mock.module("../../src/opencorvus/perception/overlay", () => ({
  addCoordinateOverlay: async (buf: Buffer) => buf,
}))

mock.module("../../src/tool/overlay-client", () => ({
  showWindowHighlight: () => {},
}))

const { ScreenTool } = await import("../../src/tool/screen")
const { DesktopState } = await import("../../src/tool/desktop-state")

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "test",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.screen screenshot anchor", () => {
  test("records anchor from captured window metadata instead of stale binding metadata", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ScreenTool.init()
        const result = await tool.execute({ action: "screenshot" }, ctx)
        expect(result.metadata.scope).toBe("window")
        expect(DesktopState.getTarget()?.scope).toBe("window")
        expect(DesktopState.getTarget()?.windowId).toBe(7)
      },
    })
  })
})
