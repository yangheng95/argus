import { beforeEach, describe, expect, mock, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { AutomationRuntime } from "../../src/opencorvus/automation"
import { PlaywrightDriver } from "../../src/opencorvus/automation/adapters/playwright"

let binding: any = null
const bindings: any[] = []
let foreground: boolean | ((binding: any) => boolean) = true
let foregroundCalls = 0
let clickFailures = 0
const clicks: Array<{ x: number; y: number }> = []
const middleClicks: Array<{ x: number; y: number }> = []
const hotkeys: string[][] = []
const keys: string[] = []
const pastes: string[] = []

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
    paste: async (text: string) => {
      pastes.push(text)
    },
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
  resolveOverlayCoord: (value: number | undefined, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback,
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
const { GuiState } = await import("../../src/tool/gui-state")

class LocatorStub implements PlaywrightDriver.Locator {
  count() {
    return Promise.resolve(0)
  }

  first() {
    return this
  }

  click() {
    return Promise.resolve()
  }

  fill() {
    return Promise.resolve()
  }

  isVisible() {
    return Promise.resolve(true)
  }

  isEnabled() {
    return Promise.resolve(true)
  }

  evaluate<T>(fn: (element: Element, arg?: unknown) => T | Promise<T>, arg?: unknown) {
    return Promise.resolve(fn({} as Element, arg))
  }
}

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

function anchorWindow(
  windowId: number,
  title: string,
  bounds: {
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
  },
) {
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
  pastes.length = 0
  AutomationRuntime.clear()
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

  test("resolves click coordinates from target_id", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        anchorMonitor({ x: 0, y: 0, width: 1000, height: 700 })
        GuiState.activate()
        GuiState.recordScreenshot("monitor-anchor", 1000, 700, false)
        GuiState.recordVisionTargets("monitor-anchor", [
          {
            id: "send_button",
            description: "Send button",
            type: "button",
            x: 420,
            y: 380,
            confidence: 0.97,
            bbox: { x: 390, y: 360, width: 60, height: 40 },
          },
        ])
        const tool = await InputTool.init()
        const result = await tool.execute(
          { action: "click", target_id: "send_button", screenshot_hash: "monitor-anchor", button: "left" },
          ctx,
        )
        expect(result.metadata.blocked).toBeUndefined()
        expect(result.metadata.source).toBe("target_id")
        expect(result.metadata.targetID).toBe("send_button")
        expect(clicks).toEqual([{ x: 420, y: 380 }])
      },
    })
  })

  test("blocks click when target_id does not exist", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        anchorMonitor({ x: 0, y: 0, width: 1000, height: 700 })
        GuiState.activate()
        GuiState.recordScreenshot("monitor-anchor", 1000, 700, false)
        const tool = await InputTool.init()
        const result = await tool.execute(
          { action: "click", target_id: "missing_target", screenshot_hash: "monitor-anchor", button: "left" },
          ctx,
        )
        expect(result.metadata.blocked).toBe(true)
        expect(result.metadata.reason).toBe("target_id_not_found")
        expect(clicks).toHaveLength(0)
      },
    })
  })

  test("blocks click when screenshot hash is stale", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        anchorMonitor({ x: 0, y: 0, width: 1000, height: 700 })
        GuiState.activate()
        GuiState.recordScreenshot("old-hash", 1000, 700, false)
        GuiState.recordVisionTargets("old-hash", [
          {
            id: "send_button",
            description: "Send button",
            type: "button",
            x: 420,
            y: 380,
            confidence: 0.92,
            bbox: { x: 390, y: 360, width: 60, height: 40 },
          },
        ])
        anchorMonitor({ x: 0, y: 0, width: 1000, height: 700 })
        const tool = await InputTool.init()
        const result = await tool.execute(
          { action: "click", target_id: "send_button", screenshot_hash: "old-hash", button: "left" },
          ctx,
        )
        expect(result.metadata.blocked).toBe(true)
        expect(result.metadata.reason).toBe("stale_screenshot_hash")
        expect(clicks).toHaveLength(0)
      },
    })
  })

  test("uses alternate target candidate after failed verification", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        anchorMonitor({ x: 0, y: 0, width: 1000, height: 700 })
        GuiState.activate()
        GuiState.recordScreenshot("monitor-anchor", 1000, 700, false)
        GuiState.recordVisionTargets("monitor-anchor", [
          {
            id: "send_button",
            description: "Send button",
            type: "button",
            x: 420,
            y: 380,
            confidence: 0.96,
            bbox: { x: 390, y: 360, width: 60, height: 40 },
          },
        ])
        GuiState.startVerification({
          action: "click",
          expectation: "must_change",
          coords: { x: 420, y: 380 },
        })
        GuiState.resolveVerification({
          changed: false,
          marker: false,
          screenshotHash: "verify-fail",
        })
        const tool = await InputTool.init()
        const result = await tool.execute(
          { action: "click", target_id: "send_button", screenshot_hash: "monitor-anchor", button: "left" },
          ctx,
        )
        expect(result.metadata.blocked).toBeUndefined()
        expect(result.metadata.source).toBe("target_id")
        expect(result.metadata.targetCandidateIndex).toBeGreaterThan(0)
        expect(clicks).toHaveLength(1)
        expect(clicks[0]).not.toEqual({ x: 420, y: 380 })
      },
    })
  })

  test("verification marks click miss with distance metrics", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        GuiState.activate()
        GuiState.startVerification({
          action: "click",
          expectation: "must_change",
          coords: { x: 420, y: 380 },
          target: {
            id: "send_button",
            center: { x: 420, y: 380 },
            bbox: { x: 390, y: 360, width: 60, height: 40 },
          },
        })
        const resolved = GuiState.resolveVerification({
          changed: false,
          marker: true,
          markerPoint: { x: 480, y: 430 },
          screenshotHash: "verify-miss",
        })
        expect(resolved?.status).toBe("fail")
        expect(resolved?.hit).toBe(false)
        expect(resolved?.distanceToBBox).toBeGreaterThan(0)
        expect(resolved?.distanceToCenter).toBeGreaterThan(0)
      },
    })
  })

  test("verification keeps hit click as uncertain when screen does not change", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        GuiState.activate()
        GuiState.startVerification({
          action: "click",
          expectation: "must_change",
          coords: { x: 420, y: 380 },
          target: {
            id: "send_button",
            center: { x: 420, y: 380 },
            bbox: { x: 390, y: 360, width: 60, height: 40 },
          },
        })
        const resolved = GuiState.resolveVerification({
          changed: false,
          marker: true,
          markerPoint: { x: 420, y: 380 },
          screenshotHash: "verify-hit",
        })
        expect(resolved?.status).toBe("uncertain")
        expect(resolved?.hit).toBe(true)
        expect(resolved?.distanceToBBox).toBe(0)
      },
    })
  })

  test("stores pending click marker after click for next screenshot verification", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        anchorMonitor({ x: 0, y: 0, width: 1000, height: 700 })
        const tool = await InputTool.init()
        await tool.execute({ action: "click", x: 220, y: 260, button: "left" }, ctx)
        const marker = GuiState.peekClickMarker()
        expect(marker?.x).toBe(220)
        expect(marker?.y).toBe(260)
        expect(marker?.screenX).toBe(220)
        expect(marker?.screenY).toBe(260)
      },
    })
  })

  test("blocks new input action until previous action is verified by screenshot", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        anchorMonitor({ x: 0, y: 0, width: 1000, height: 700 })
        const tool = await InputTool.init()
        const first = await tool.execute({ action: "click", x: 240, y: 280, button: "left" }, ctx)
        const verification = first.metadata.verification as { state?: string } | undefined
        expect(verification?.state).toBe("pending")
        const second = await tool.execute({ action: "key", key: "enter" }, ctx)
        expect(second.metadata.blocked).toBe(true)
        expect(second.metadata.reason).toBe("verification_pending")
      },
    })
  })

  test("blocks repeating same click coordinates after failed verification", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        anchorMonitor({ x: 0, y: 0, width: 1000, height: 700 })
        GuiState.activate()
        GuiState.startVerification({
          action: "click",
          expectation: "must_change",
          coords: { x: 300, y: 320 },
        })
        GuiState.resolveVerification({
          changed: false,
          marker: false,
          screenshotHash: "verify-fail",
        })
        const tool = await InputTool.init()
        const result = await tool.execute({ action: "click", x: 300, y: 320, button: "left" }, ctx)
        expect(result.metadata.blocked).toBe(true)
        expect(result.metadata.reason).toBe("verification_recovery_required")
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
        expect(foregroundCalls).toBe(3)
      },
    })
  })

  test("skips postcondition check when post=none", async () => {
    binding = {
      windowId: 7,
      info: { title: "Editor", appName: "Code", x: 0, y: 0, width: 1000, height: 700 },
    }
    foreground = true

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        anchorWindow(7, "Editor", { x: 0, y: 0, width: 1000, height: 700 })
        const tool = await InputTool.init()
        const result = await tool.execute({ action: "click", x: 280, y: 300, button: "left", post: "none" }, ctx)
        expect(result.metadata.blocked).toBeUndefined()
        expect(clicks).toEqual([{ x: 280, y: 300 }])
        expect(foregroundCalls).toBe(1)
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

  test("blocks pointer action when non-desktop driver is requested", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        anchorMonitor({ x: 0, y: 0, width: 1000, height: 700 })
        const tool = await InputTool.init()
        const result = await tool.execute(
          { action: "click", x: 320, y: 360, button: "left", driver: "playwright" },
          ctx,
        )
        expect(result.metadata.blocked).toBe(true)
        expect(result.metadata.reason).toBe("pointer_driver_unsupported")
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

  test("skips desktop foreground guard for playwright type action", async () => {
    binding = {
      windowId: 7,
      info: { title: "Editor", appName: "Code" },
    }
    foreground = false
    const page: PlaywrightDriver.Page = {
      locator: () => new LocatorStub(),
      getByRole: () => new LocatorStub(),
      getByText: () => new LocatorStub(),
      keyboard: {
        press: async () => {},
        type: async () => {},
      },
      mouse: {
        wheel: async () => {},
      },
      screenshot: async () => new Uint8Array([1]),
    }
    AutomationRuntime.setPlaywright({ page })

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        DesktopState.bindWindow(7, "Editor")
        const tool = await InputTool.init()
        const result = await tool.execute({ action: "type", text: "hello", driver: "playwright" }, ctx)
        expect(result.metadata.blocked).toBeUndefined()
        expect(pastes).toHaveLength(0)
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
