import { beforeEach, describe, expect, mock, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { createHash } from "crypto"

let binding: null | {
  windowId: number
  matchTitle: string
  info: {
    id: number
    title: string
    appName: string
    x: number
    y: number
    width: number
    height: number
    isMinimized: boolean
    isFocused: boolean
  }
} = {
  windowId: 7,
  matchTitle: "Editor",
  info: {
    id: 7,
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

let captureScope: "window" | "monitor" = "window"
const capturePlan: Array<"window" | "monitor"> = []

mock.module("../../src/opencorvus/perception/window", () => ({
  WindowManager: {
    getBinding: async () => binding,
    ensureBoundForeground: async () => true,
    rebindForTask: async (_taskEpoch: number) => null,
  },
}))

mock.module("../../src/opencorvus/perception/capture", () => ({
  Capture: {
    take: async () => {
      const scope = capturePlan.shift() ?? captureScope
      return scope === "window"
      ? {
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
        }
      : {
          path: "x",
          width: 1280,
          height: 800,
          buffer: Buffer.from("png"),
          rawBuffer: Buffer.from("raw"),
          timestamp: Date.now(),
          windowBounds: { x: 0, y: 0, width: 1920, height: 1080 },
          scope: "monitor",
          window: null,
          monitor: { id: 1, name: "Main", x: 0, y: 0, width: 1920, height: 1080, isPrimary: true, scaleFactor: 1 },
        }
    },
    cleanup: async () => {},
  },
}))

mock.module("../../src/opencorvus/perception/diff", () => ({
  ScreenDiff: {
    compare: async () => ({ changed: true, diffPercent: 100 }),
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
const { GuiState } = await import("../../src/tool/gui-state")

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

beforeEach(() => {
  captureScope = "window"
  capturePlan.length = 0
  binding = {
    windowId: 7,
    matchTitle: "Editor",
    info: {
      id: 7,
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
})

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

  test("blocks screenshot when bound window capture drifts to monitor scope", async () => {
    captureScope = "monitor"
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ScreenTool.init()
        const result = await tool.execute({ action: "screenshot" }, ctx)
        expect(result.metadata.blocked).toBe(true)
        expect(result.metadata.reason).toBe("bound_window_capture_fallback")
      },
    })
  })

  test("blocks screenshot when wait_for_change result drifts after polling", async () => {
    capturePlan.push("window", "monitor")
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ScreenTool.init()
        GuiState.activate()
        GuiState.recordScreenshot(createHash("md5").update(Buffer.from("png")).digest("hex"), 1280, 800, true)
        const result = await tool.execute({ action: "screenshot", wait_for_change: true }, ctx)
        expect(result.metadata.blocked).toBe(true)
        expect(result.metadata.reason).toBe("bound_window_capture_fallback")
      },
    })
  })

  test("blocks screenshot when window target exists but binding disappeared", async () => {
    binding = null
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        DesktopState.bindWindow(99, "Editor")
        const tool = await ScreenTool.init()
        const result = await tool.execute({ action: "screenshot" }, ctx)
        expect(result.metadata.blocked).toBe(true)
        expect(result.metadata.reason).toBe("stale_window_binding")
      },
    })
  })
})
