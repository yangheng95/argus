import { beforeEach, describe, expect, mock, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

let binding: any = null
const bindings: any[] = []
let foreground: boolean | ((binding: any) => boolean) = true
let foregroundCalls = 0
let clickFailures = 0
const clicks: Array<{ x: number; y: number }> = []
const middleClicks: Array<{ x: number; y: number }> = []
const hotkeys: string[][] = []
const keys: string[] = []

mock.module("../../src/opencorvus/perception/window", () => ({
  WindowManager: {
    getBinding: async () => bindings.shift() ?? binding,
    ensureBoundForeground: async (current?: any) => {
      foregroundCalls++
      return typeof foreground === "function" ? foreground(current) : foreground
    },
    rebindForTask: async (_taskEpoch: number) => null,
  },
}))

mock.module("../../src/opencorvus/gui/index", () => ({
  GUI: {
    click: async (x: number, y: number) => {
      if (clickFailures > 0) {
        clickFailures--
        throw new Error("transient click failure")
      }
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
    pressKey: async (key: string) => {
      keys.push(key)
    },
    hotkey: async (...keys: string[]) => {
      hotkeys.push(keys)
    },
  },
}))

mock.module("../../src/tool/overlay-client", () => ({
  showOverlay: () => {},
  showWindowHighlight: () => {},
  resolveOverlayCoord: (value: number | undefined, fallback: number) => typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback,
  requestOverlayConfirm: async () => "unavailable",
  overlayDiagnostic: () => ({
    available: false,
    reason: "binary_missing",
    updatedAt: Date.now(),
    path: "overlay-binary",
    failures: 0,
    consecutiveFailures: 0,
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

function anchorMonitor(bounds: {
  x: number
  y: number
  width: number
  height: number
  scaleX?: number
  scaleY?: number
  logicalX?: number
  logicalY?: number
  logicalWidth?: number
  logicalHeight?: number
}) {
  DesktopState.recordCapture({
    scope: "monitor",
    bounds,
    monitor: { id: 1, name: "Main" },
    screenshotHash: "monitor-anchor",
  })
}

function anchorWindow(windowId: number, title: string, bounds: {
  x: number
  y: number
  width: number
  height: number
  scaleX?: number
  scaleY?: number
  logicalX?: number
  logicalY?: number
  logicalWidth?: number
  logicalHeight?: number
}) {
  DesktopState.recordCapture({
    scope: "window",
    bounds,
    window: { windowId, title },
    screenshotHash: "window-anchor",
  })
}

beforeEach(() => {
  binding = null
  bindings.length = 0
  foreground = true
  foregroundCalls = 0
  clickFailures = 0
  clicks.length = 0
  middleClicks.length = 0
  hotkeys.length = 0
  keys.length = 0
  delete process.env.OPENCORVUS_COORDINATE_SPACE
})

describe("tool.input bound window guard", () => {
  test("blocks pointer action when bound window cannot be foregrounded", async () => {
    binding = {
      windowId: 7,
      info: { title: "Editor", appName: "Code" },
    }
    foreground = false

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        anchorWindow(7, "Editor", { x: 0, y: 0, width: 1000, height: 700 })
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
        anchorMonitor({ x: 0, y: 0, width: 1000, height: 700 })
        const tool = await InputTool.init()
        const result = await tool.execute({ action: "click", x: 200, y: 240, button: "left" }, ctx)
        expect(result.metadata.blocked).toBeUndefined()
        expect(clicks).toEqual([{ x: 200, y: 240 }])
      },
    })
  })

  test("allows pointer action on monitor anchor even when bound window is not foreground", async () => {
    binding = {
      windowId: 7,
      info: { title: "Editor", appName: "Code" },
    }
    foreground = false

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        anchorMonitor({ x: 0, y: 0, width: 1000, height: 700 })
        const tool = await InputTool.init()
        const result = await tool.execute({ action: "click", x: 210, y: 260, button: "left" }, ctx)
        expect(result.metadata.blocked).toBeUndefined()
        expect(clicks).toEqual([{ x: 210, y: 260 }])
      },
    })
  })

  test("allows key action on monitor anchor even when bound window is not foreground", async () => {
    binding = {
      windowId: 7,
      info: { title: "Editor", appName: "Code" },
    }
    foreground = false

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        DesktopState.bindMonitor(1, "Main")
        const tool = await InputTool.init()
        const result = await tool.execute({ action: "key", key: "enter" }, ctx)
        expect(result.metadata.blocked).toBeUndefined()
        expect(keys).toEqual(["enter"])
      },
    })
  })

  test("blocks pointer action when desktop anchor points to stale window binding", async () => {
    binding = null
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        anchorWindow(7, "Editor", { x: 0, y: 0, width: 1000, height: 700 })
        const tool = await InputTool.init()
        const result = await tool.execute({ action: "click", x: 180, y: 220, button: "left" }, ctx)
        expect(result.metadata.blocked).toBe(true)
        expect(result.metadata.reason).toBe("stale_window_anchor")
        expect(clicks).toHaveLength(0)
      },
    })
  })

  test("blocks pointer action when bound window geometry drifted from anchor", async () => {
    binding = {
      windowId: 7,
      info: { title: "Editor", appName: "Code", x: 40, y: 30, width: 1000, height: 700 },
    }

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        anchorWindow(7, "Editor", { x: 0, y: 0, width: 1000, height: 700 })
        const tool = await InputTool.init()
        const result = await tool.execute({ action: "click", x: 180, y: 220, button: "left" }, ctx)
        expect(result.metadata.blocked).toBe(true)
        expect(result.metadata.reason).toBe("window_geometry_drifted")
        expect(clicks).toHaveLength(0)
      },
    })
  })

  test("uses one binding snapshot for pointer anchor and foreground checks", async () => {
    binding = null
    bindings.push(
      {
        windowId: 7,
        info: { title: "Editor", appName: "Code", x: 0, y: 0, width: 1000, height: 700 },
      },
      {
        windowId: 9,
        info: { title: "Terminal", appName: "Terminal", x: 0, y: 0, width: 1000, height: 700 },
      },
    )
    foreground = (current) => current?.windowId === 7

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        anchorWindow(7, "Editor", { x: 0, y: 0, width: 1000, height: 700 })
        const tool = await InputTool.init()
        const result = await tool.execute({ action: "click", x: 200, y: 240, button: "left" }, ctx)
        expect(result.metadata.blocked).toBeUndefined()
        expect(clicks).toEqual([{ x: 200, y: 240 }])
      },
    })
  })

  test("retries pointer action once after transient click failure", async () => {
    binding = {
      windowId: 7,
      info: { title: "Editor", appName: "Code", x: 0, y: 0, width: 1000, height: 700 },
    }
    clickFailures = 1
    foreground = true

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        anchorWindow(7, "Editor", { x: 0, y: 0, width: 1000, height: 700 })
        const tool = await InputTool.init()
        const result = await tool.execute({ action: "click", x: 260, y: 280, button: "left" }, ctx)
        expect(result.metadata.blocked).toBeUndefined()
        expect(clicks).toEqual([{ x: 260, y: 280 }])
        expect(foregroundCalls).toBe(2)
      },
    })
  })

  test("executes middle click with middle button", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        anchorMonitor({ x: 0, y: 0, width: 1000, height: 700 })
        const tool = await InputTool.init()
        const result = await tool.execute({ action: "click", x: 320, y: 360, button: "middle" }, ctx)
        expect(result.metadata.blocked).toBeUndefined()
        expect(middleClicks).toEqual([{ x: 320, y: 360 }])
        expect(clicks).toHaveLength(0)
      },
    })
  })

  test("blocks non-recovery key when bound window cannot be foregrounded", async () => {
    binding = {
      info: { title: "Editor", appName: "Code" },
    }
    foreground = false

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await InputTool.init()
        const result = await tool.execute({ action: "key", key: "enter" }, ctx)
        expect(result.metadata.blocked).toBe(true)
        expect(result.metadata.reason).toBe("bound_window_not_foreground")
        expect(hotkeys).toHaveLength(0)
      },
    })
  })

  test("blocks key action when active window binding drifts from anchor", async () => {
    binding = {
      windowId: 9,
      info: { title: "Terminal", appName: "Terminal" },
    }
    foreground = true

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        DesktopState.bindWindow(7, "Editor")
        const tool = await InputTool.init()
        const result = await tool.execute({ action: "key", key: "enter" }, ctx)
        expect(result.metadata.blocked).toBe(true)
        expect(result.metadata.reason).toBe("window_binding_drifted")
        expect(hotkeys).toHaveLength(0)
      },
    })
  })

  test("allows focus recovery key when bound window cannot be foregrounded", async () => {
    binding = {
      info: { title: "Editor", appName: "Code" },
    }
    foreground = false

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await InputTool.init()
        const result = await tool.execute({ action: "key", key: "alt+tab" }, ctx)
        expect(result.metadata.blocked).toBeUndefined()
        expect(hotkeys).toEqual([["alt", "tab"]])
      },
    })
  })

  test("maps coordinates in logical space when configured", async () => {
    const previous = process.env.OPENCORVUS_COORDINATE_SPACE
    process.env.OPENCORVUS_COORDINATE_SPACE = "logical"
    await using tmp = await tmpdir()
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          anchorMonitor({
            x: 150,
            y: 75,
            width: 1200,
            height: 900,
            scaleX: 1.5,
            scaleY: 1.5,
            logicalX: 100,
            logicalY: 50,
            logicalWidth: 800,
            logicalHeight: 600,
          })
          const tool = await InputTool.init()
          const result = await tool.execute({ action: "click", x: 450, y: 300, button: "left" }, ctx)
          expect(result.metadata.coordinateSpace).toBe("logical")
          expect(clicks).toEqual([{ x: 400, y: 250 }])
        },
      })
    } finally {
      if (previous === undefined) {
        delete process.env.OPENCORVUS_COORDINATE_SPACE
      } else {
        process.env.OPENCORVUS_COORDINATE_SPACE = previous
      }
    }
  })

  test("auto space resolves to logical on scaled bounds", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        anchorMonitor({
          x: 150,
          y: 75,
          width: 1200,
          height: 900,
          scaleX: 1.5,
          scaleY: 1.5,
          logicalX: 100,
          logicalY: 50,
          logicalWidth: 800,
          logicalHeight: 600,
        })
        const tool = await InputTool.init()
        const result = await tool.execute({ action: "click", x: 450, y: 300, button: "left" }, ctx)
        expect(result.metadata.coordinateSpaceRequested).toBe("auto")
        expect(result.metadata.coordinateSpace).toBe("logical")
        expect(clicks).toEqual([{ x: 400, y: 250 }])
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
