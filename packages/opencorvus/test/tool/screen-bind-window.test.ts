import { beforeEach, describe, expect, mock, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const binds: string[] = []
let windows = [
  { id: 7, title: "Editor", appName: "Code", x: 120, y: 80, width: 1400, height: 900, isMinimized: false, isFocused: true },
]
let monitors = [
  { id: 1, name: "Main", x: 0, y: 0, width: 2560, height: 1440, isPrimary: true, scaleFactor: 1 },
]

mock.module("../../src/opencorvus/perception/window", () => ({
  WindowManager: {
    getBinding: async () => null,
    ensureBoundForeground: async () => true,
    listWindows: async () => windows,
    findWindow: async (title: string) => {
      const query = title.trim().toLowerCase()
      if (!query) return null
      return windows.find((w) => w.title.toLowerCase().includes(query) || w.appName.toLowerCase().includes(query)) ?? null
    },
    bind: async (title: string) => {
      binds.push(title)
      const query = title.trim().toLowerCase()
      const info = windows.find((w) => w.title.toLowerCase().includes(query) || w.appName.toLowerCase().includes(query))
      if (!info) throw new Error(`No window found matching "${title}"`)
      return {
        windowId: info.id,
        matchTitle: title,
        info,
      }
    },
    unbind: () => {},
  },
}))

mock.module("../../src/opencorvus/perception/monitor", () => ({
  MonitorManager: {
    getBinding: async () => null,
    listMonitors: async () => monitors,
    bind: async (_query: string | number) => ({
      monitorId: 1,
      match: "1",
      info: { id: 1, name: "Main", x: 0, y: 0, width: 2560, height: 1440, isPrimary: true, scaleFactor: 1 },
    }),
  },
}))

mock.module("../../src/tool/overlay-client", () => ({
  showWindowHighlight: () => {},
}))

const { ScreenTool } = await import("../../src/tool/screen")

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
  binds.length = 0
  windows = [
    { id: 7, title: "Editor", appName: "Code", x: 120, y: 80, width: 1400, height: 900, isMinimized: false, isFocused: true },
  ]
  monitors = [
    { id: 1, name: "Main", x: 0, y: 0, width: 2560, height: 1440, isPrimary: true, scaleFactor: 1 },
  ]
})

describe("tool.screen bind_window", () => {
  test("falls back to focused window on single monitor when title is missing", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ScreenTool.init()
        const result = await tool.execute({ action: "bind_window", title: "Missing Window" }, ctx)
        expect(result.metadata.title).toBe("Editor")
        expect(result.metadata.singleMonitorFallback).toBe(true)
        expect(result.metadata.requestedTitle).toBe("Missing Window")
        expect(binds).toEqual(["Editor"])
      },
    })
  })

  test("keeps strict matching on multi-monitor setup", async () => {
    monitors = [
      { id: 1, name: "Main", x: 0, y: 0, width: 1920, height: 1080, isPrimary: true, scaleFactor: 1 },
      { id: 2, name: "Right", x: 1920, y: 0, width: 1920, height: 1080, isPrimary: false, scaleFactor: 1 },
    ]

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ScreenTool.init()
        await expect(tool.execute({ action: "bind_window", title: "Missing Window" }, ctx)).rejects.toThrow(
          'No window found matching "Missing Window"',
        )
        expect(binds).toHaveLength(0)
      },
    })
  })
})
