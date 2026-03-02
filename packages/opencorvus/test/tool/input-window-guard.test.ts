import { beforeEach, describe, expect, mock, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

let binding: any = null
let foreground = true
const clicks: Array<{ x: number; y: number }> = []
const middleClicks: Array<{ x: number; y: number }> = []

mock.module("../../src/opencorvus/perception/window", () => ({
  WindowManager: {
    getBinding: async () => binding,
    ensureBoundForeground: async () => foreground,
  },
}))

mock.module("../../src/opencorvus/gui/index", () => ({
  GUI: {
    click: async (x: number, y: number) => {
      clicks.push({ x, y })
    },
    doubleClick: async (_x: number, _y: number) => {},
    rightClick: async (_x: number, _y: number) => {},
    middleClick: async (x: number, y: number) => {
      middleClicks.push({ x, y })
    },
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
  }),
  parseOverlayReply: (line: string) => {
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      return
    }
    if (!raw || typeof raw !== "object") return
    const obj = raw as Record<string, unknown>
    if (obj.type !== "confirm-reply") return
    if (typeof obj.id !== "string") return
    if (obj.answer !== "confirm" && obj.answer !== "cancel" && obj.answer !== "timeout") return
    return { id: obj.id, answer: obj.answer }
  },
}))

const { InputTool } = await import("../../src/tool/input")
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

beforeEach(() => {
  binding = null
  foreground = true
  clicks.length = 0
  middleClicks.length = 0
})

describe("tool.input bound window guard", () => {
  test("blocks pointer action when bound window cannot be foregrounded", async () => {
    binding = {
      info: { title: "Editor", appName: "Code" },
    }
    foreground = false

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        DesktopState.setBounds({ x: 0, y: 0, width: 1000, height: 700 })
        const tool = await InputTool.init()
        const result = await tool.execute({ action: "click", x: 100, y: 120, button: "left" }, ctx)
        expect(result.metadata.blocked).toBe(true)
        expect(result.metadata.reason).toBe("bound_window_not_foreground")
        expect(clicks).toHaveLength(0)
      },
    })
  })

  test("allows pointer action when no window is bound", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        DesktopState.setBounds({ x: 0, y: 0, width: 1000, height: 700 })
        const tool = await InputTool.init()
        const result = await tool.execute({ action: "click", x: 200, y: 240, button: "left" }, ctx)
        expect(result.metadata.blocked).toBeUndefined()
        expect(clicks).toEqual([{ x: 200, y: 240 }])
      },
    })
  })

  test("executes middle click with middle button", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        DesktopState.setBounds({ x: 0, y: 0, width: 1000, height: 700 })
        const tool = await InputTool.init()
        const result = await tool.execute({ action: "click", x: 320, y: 360, button: "middle" }, ctx)
        expect(result.metadata.blocked).toBeUndefined()
        expect(middleClicks).toEqual([{ x: 320, y: 360 }])
        expect(clicks).toHaveLength(0)
      },
    })
  })

  test("confirm unavailable includes diagnostic reason", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await InputTool.init()
        const result = await tool.execute(
          {
            action: "confirm",
            title: "Proceed?",
            message: "Run destructive action?",
            confirm: "Yes",
            cancel: "No",
            timeoutMs: 3000,
          },
          ctx,
        )
        expect(result.metadata.unavailable).toBe(true)
        expect(result.metadata.unavailableReason).toBe("binary_missing")
      },
    })
  })
})
