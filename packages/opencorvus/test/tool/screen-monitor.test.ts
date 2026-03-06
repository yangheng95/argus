import { beforeEach, describe, expect, mock, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

let unbound = 0
let overlayCalls = 0
const clickMarkerCalls: Array<{ x: number; y: number; label: string | undefined }> = []
let bindCalls = 0
let monitorBinding: any = {
  monitorId: 2,
  match: "2",
  info: { id: 2, name: "Right", x: 1920, y: 0, width: 1920, height: 1080, isPrimary: false, scaleFactor: 1 },
}

mock.module("../../src/opencorvus/perception/window", () => ({
  WindowManager: {
    getBinding: async () => null,
    ensureBoundForeground: async () => true,
    rebindForTask: async (_taskEpoch: number) => null,
    findWindow: async (_title: string) => null,
    findWindowById: async (_id: number) => null,
    isBound: () => false,
    listWindows: async () => [
      {
        id: 7,
        title: "Editor",
        appName: "Code",
        x: 2100,
        y: 120,
        width: 1200,
        height: 800,
        isMinimized: false,
        isFocused: true,
      },
    ],
    bind: async (_title: string) => {
      bindCalls += 1
      return {
        windowId: 7,
        matchTitle: "editor",
        info: {
          id: 7,
          title: "Editor",
          appName: "Code",
          x: 2100,
          y: 120,
          width: 1200,
          height: 800,
          isMinimized: false,
          isFocused: true,
        },
      }
    },
    bindById: async (windowId: number, matchTitle?: string) => {
      bindCalls += 1
      return {
        windowId,
        matchTitle: matchTitle ?? "Editor",
        info: {
          id: windowId,
          title: "Editor",
          appName: "Code",
          x: 2100,
          y: 120,
          width: 1200,
          height: 800,
          isMinimized: false,
          isFocused: true,
        },
      }
    },
    unbind: () => {
      unbound += 1
    },
  },
}))

mock.module("../../src/opencorvus/perception/monitor", () => ({
  MonitorManager: {
    getBinding: async () => monitorBinding,
    bind: async (_query: string | number) => ({
      monitorId: 2,
      match: "2",
      info: { id: 2, name: "Right", x: 1920, y: 0, width: 1920, height: 1080, isPrimary: false, scaleFactor: 1 },
    }),
    listMonitors: async () => [
      { id: 1, name: "Main", x: 0, y: 0, width: 1920, height: 1080, isPrimary: true, scaleFactor: 1 },
      { id: 2, name: "Right", x: 1920, y: 0, width: 1920, height: 1080, isPrimary: false, scaleFactor: 1 },
    ],
  },
}))

mock.module("../../src/opencorvus/perception/capture", () => ({
  Capture: {
    scaleWindowBounds: (input: {
      logicalX: number
      logicalY: number
      logicalWidth: number
      logicalHeight: number
      imageWidth: number
      imageHeight: number
    }) => {
      const sx = input.logicalWidth > 0 ? input.imageWidth / input.logicalWidth : 1
      const sy = input.logicalHeight > 0 ? input.imageHeight / input.logicalHeight : 1
      return {
        x: Math.round(input.logicalX * sx),
        y: Math.round(input.logicalY * sy),
        width: input.imageWidth,
        height: input.imageHeight,
        scaleX: sx,
        scaleY: sy,
        logicalX: input.logicalX,
        logicalY: input.logicalY,
        logicalWidth: input.logicalWidth,
        logicalHeight: input.logicalHeight,
      }
    },
    take: async (_opts: unknown) => ({
      path: "x",
      width: 1920,
      height: 1080,
      buffer: Buffer.from("png"),
      rawBuffer: Buffer.from("raw"),
      timestamp: Date.now(),
      windowBounds: { x: 1920, y: 0, width: 1920, height: 1080 },
      scope: "monitor",
      monitor: { id: 2, name: "Right", x: 1920, y: 0, width: 1920, height: 1080, isPrimary: false, scaleFactor: 1 },
    }),
    cleanup: async () => {},
  },
}))

mock.module("../../src/opencorvus/perception/overlay", () => ({
  addCoordinateOverlay: async (buf: Buffer) => {
    overlayCalls += 1
    return Buffer.concat([buf, Buffer.from("-overlay")])
  },
  addClickMarker: async (buf: Buffer, x: number, y: number, label?: string) => {
    clickMarkerCalls.push({ x, y, label })
    return buf
  },
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
  unbound = 0
  overlayCalls = 0
  clickMarkerCalls.length = 0
  bindCalls = 0
  monitorBinding = {
    monitorId: 2,
    match: "2",
    info: { id: 2, name: "Right", x: 1920, y: 0, width: 1920, height: 1080, isPrimary: false, scaleFactor: 1 },
  }
  delete process.env.OPENCORVUS_SCREEN_DEBUG_COORDINATE_OVERLAY
})

describe("tool.screen monitor flow", () => {
  test("bind_monitor unbinds window and stores monitor target", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ScreenTool.init()
        const result = await tool.execute({ action: "bind_monitor", monitor: 2 }, ctx)
        expect(result.metadata.id).toBe(2)
        expect(unbound).toBe(1)
        const target = DesktopState.getTarget()
        expect(target?.scope).toBe("monitor")
        expect(target?.monitorId).toBe(2)
      },
    })
  })

  test("list_windows includes monitor mapping", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ScreenTool.init()
        const result = await tool.execute({ action: "list_windows" }, ctx)
        expect(result.output).toContain("monitor: 2")
        expect(result.output).toContain("Selectable targets")
        expect(result.metadata.candidates[0].window_id).toBe(7)
      },
    })
  })

  test("screenshot does not render visible coordinate overlay by default", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ScreenTool.init()
        const result = await tool.execute({ action: "screenshot" }, ctx)
        expect(overlayCalls).toBe(0)
        expect(result.output).toContain("no visible coordinate overlay")
      },
    })
  })

  test("screenshot renders coordinate overlay when debug flag is enabled", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCORVUS_SCREEN_DEBUG_COORDINATE_OVERLAY = "1"
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ScreenTool.init()
        const result = await tool.execute({ action: "screenshot" }, ctx)
        expect(overlayCalls).toBe(1)
        expect(result.output).toContain("Debug mode: coordinate ticks are visible on the image")
      },
    })
  })

  test("returns annotated screenshot on unchanged frame when click marker is pending", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ScreenTool.init()
        const first = await tool.execute({ action: "screenshot" }, ctx)
        expect(first.metadata.unchanged).toBe(false)
        GuiState.setClickMarker({ x: 100, y: 120, screenX: 2020, screenY: 120, label: "left click" })
        const second = await tool.execute({ action: "screenshot" }, ctx)
        expect(second.metadata.unchanged).toBe(true)
        expect(second.metadata.clickMarker).toBe(true)
        expect(second.metadata.clickMarkerApplied).toBe(true)
        expect(second.attachments?.length).toBe(1)
        expect(clickMarkerCalls).toEqual([{ x: 100, y: 120, label: "left click" }])

        const third = await tool.execute({ action: "screenshot" }, ctx)
        expect(third.metadata.unchanged).toBe(true)
        expect(third.attachments).toBeUndefined()
        expect(clickMarkerCalls).toEqual([{ x: 100, y: 120, label: "left click" }])
      },
    })
  })

  test("resolves pending verification as fail when unchanged screenshot has no clear effect", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ScreenTool.init()
        await tool.execute({ action: "screenshot" }, ctx)
        GuiState.startVerification({
          action: "click",
          expectation: "must_change",
          coords: { x: 260, y: 320 },
        })
        const second = await tool.execute({ action: "screenshot" }, ctx)
        expect(second.metadata.unchanged).toBe(true)
        expect(second.metadata.verificationStatus).toBe("fail")
        expect(second.attachments?.length).toBe(1)
        expect(GuiState.lastVerification()?.status).toBe("fail")
      },
    })
  })

  test("screenshot without active bindings does not auto-bind windows", async () => {
    monitorBinding = null
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ScreenTool.init()
        const result = await tool.execute({ action: "screenshot" }, ctx)
        expect(result.metadata.scope).toBe("monitor")
        expect(bindCalls).toBe(0)
      },
    })
  })
})
