import { describe, expect, mock, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

type WindowInfo = {
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

const windows: Record<number, WindowInfo> = {
  7: {
    id: 7,
    title: "Editor A",
    appName: "Code",
    x: 100,
    y: 80,
    width: 1200,
    height: 800,
    isMinimized: false,
    isFocused: true,
  },
  11: {
    id: 11,
    title: "Editor A",
    appName: "Code",
    x: 300,
    y: 200,
    width: 1200,
    height: 800,
    isMinimized: false,
    isFocused: true,
  },
}

let binding: any = null
let captureSeq = 0
const rebindCalls: number[] = []
const clicks: Array<{ x: number; y: number }> = []

mock.module("../../src/opencorvus/perception/window", () => ({
  WindowManager: {
    listWindows: async () => [windows[7], windows[11]],
    findWindow: async (_q: string) => windows[7],
    bindById: async (windowId: number, matchTitle?: string) => {
      const info = windows[windowId]
      if (!info) throw new Error(`No window found with id ${windowId}`)
      binding = {
        windowId,
        matchTitle: matchTitle?.trim() || info.title,
        info,
      }
      return binding
    },
    bind: async (_title: string) => {
      binding = {
        windowId: 7,
        matchTitle: "editor",
        info: windows[7],
      }
      return binding
    },
    getBinding: async () => binding,
    ensureBoundForeground: async () => true,
    rebindForTask: async (taskEpoch: number) => {
      rebindCalls.push(taskEpoch)
      if (taskEpoch === 1 && binding?.windowId === 7) {
        binding = {
          windowId: 11,
          matchTitle: binding.matchTitle,
          info: windows[11],
        }
      }
      return binding
    },
    unbind: () => {
      binding = null
    },
  },
}))

mock.module("../../src/opencorvus/perception/monitor", () => ({
  MonitorManager: {
    listMonitors: async () => [
      { id: 1, name: "Main", x: 0, y: 0, width: 2560, height: 1440, isPrimary: true, scaleFactor: 1 },
    ],
    bind: async (_query: string | number) => ({
      monitorId: 1,
      match: "1",
      info: { id: 1, name: "Main", x: 0, y: 0, width: 2560, height: 1440, isPrimary: true, scaleFactor: 1 },
    }),
    getBinding: async () => null,
    unbind: () => {},
  },
}))

mock.module("../../src/opencorvus/perception/capture", () => ({
  Capture: {
    take: async () => {
      if (!binding) {
        return {
          path: "x",
          width: 1920,
          height: 1080,
          buffer: Buffer.from(`m-${captureSeq++}`),
          rawBuffer: Buffer.from(`mr-${captureSeq}`),
          timestamp: Date.now(),
          windowBounds: { x: 0, y: 0, width: 1920, height: 1080 },
          scope: "monitor" as const,
          window: null,
          monitor: { id: 1, name: "Main", x: 0, y: 0, width: 1920, height: 1080, isPrimary: true, scaleFactor: 1 },
        }
      }
      return {
        path: "x",
        width: binding.info.width,
        height: binding.info.height,
        buffer: Buffer.from(`w-${binding.windowId}-${captureSeq++}`),
        rawBuffer: Buffer.from(`wr-${binding.windowId}-${captureSeq}`),
        timestamp: Date.now(),
        windowBounds: { x: binding.info.x, y: binding.info.y, width: binding.info.width, height: binding.info.height },
        scope: "window" as const,
        window: { id: binding.windowId, title: binding.info.title, appName: binding.info.appName },
        monitor: null,
      }
    },
    cleanup: async () => {},
  },
}))

mock.module("../../src/opencorvus/perception/overlay", () => ({
  addCoordinateOverlay: async (buf: Buffer) => buf,
  addClickMarker: async (buf: Buffer) => buf,
}))

mock.module("../../src/opencorvus/gui/index", () => ({
  GUI: {
    click: async (x: number, y: number) => {
      clicks.push({ x, y })
    },
    doubleClick: async (_x: number, _y: number) => {},
    rightClick: async (_x: number, _y: number) => {},
    middleClick: async (_x: number, _y: number) => {},
    scroll: async (_direction: "up" | "down", _amount = 3) => {},
    moveTo: async (_x: number, _y: number) => {},
    drag: async (_startX: number, _startY: number, _endX: number, _endY: number) => {},
    paste: async (_text: string) => {},
    pressKey: async (_key: string) => {},
    hotkey: async (..._keys: string[]) => {},
  },
}))

mock.module("../../src/tool/overlay-client", () => ({
  showOverlay: () => {},
  showWindowHighlight: () => {},
  requestOverlayConfirm: async () => "unavailable",
  overlayDiagnostic: () => ({
    available: false,
    reason: "binary_missing",
    updatedAt: Date.now(),
    path: "overlay-binary",
    failures: 0,
    consecutiveFailures: 0,
  }),
}))

const { ScreenTool } = await import("../../src/tool/screen")
const { InputTool } = await import("../../src/tool/input")
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

describe("tool gui state migration", () => {
  test("bind -> screenshot -> input -> task rebind -> screenshot -> input stays anchored", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        binding = null
        captureSeq = 0
        rebindCalls.length = 0
        clicks.length = 0

        const screen = await ScreenTool.init()
        const input = await InputTool.init()

        const bound = await screen.execute({ action: "bind_window", window_id: 7 }, ctx)
        expect(bound.metadata.windowId).toBe(7)
        expect(DesktopState.getPhase()).toBe("window_bound")

        await screen.execute({ action: "screenshot" }, ctx)
        expect(DesktopState.getPhase()).toBe("window_anchored")
        expect(DesktopState.getTarget()?.windowId).toBe(7)

        await input.execute({ action: "click", x: 10, y: 20, button: "left" }, ctx)
        expect(clicks[0]).toEqual({ x: 110, y: 100 })

        GuiState.markNewTask()
        await screen.execute({ action: "screenshot" }, ctx)
        expect(rebindCalls.some((x) => x === 1)).toBe(true)
        expect(DesktopState.getTarget()?.windowId).toBe(11)
        expect(DesktopState.getBounds()?.x).toBe(300)

        await input.execute({ action: "click", x: 10, y: 20, button: "left" }, ctx)
        expect(clicks[1]).toEqual({ x: 310, y: 220 })
      },
    })
  })
})
