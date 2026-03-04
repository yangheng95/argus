import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const { DesktopState } = await import("../../src/tool/desktop-state")

describe("tool.desktop-state flow", () => {
  test("tracks window bind -> capture -> task transitions", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        DesktopState.bindWindow(7, "Editor")
        expect(DesktopState.getPhase()).toBe("window_bound")
        expect(DesktopState.getBounds()).toBeNull()
        expect(DesktopState.getTarget()?.scope).toBe("window")

        DesktopState.recordCapture({
          scope: "window",
          bounds: { x: 100, y: 80, width: 1280, height: 800 },
          window: { windowId: 7, title: "Editor" },
          screenshotHash: "abc123",
        })
        expect(DesktopState.getPhase()).toBe("window_anchored")
        expect(DesktopState.getBounds()?.width).toBe(1280)
        expect(DesktopState.getAnchorHash()).toBe("abc123")

        const changed = DesktopState.markTask(1)
        expect(changed).toBe(true)
        expect(DesktopState.getPhase()).toBe("window_bound")
        expect(DesktopState.getBounds()).toBeNull()
        expect(DesktopState.getAnchorHash()).toBeNull()
      },
    })
  })

  test("tracks monitor bind -> capture transitions", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        DesktopState.bindMonitor(2, "Right")
        expect(DesktopState.getPhase()).toBe("monitor_bound")
        expect(DesktopState.getTarget()?.scope).toBe("monitor")

        DesktopState.recordCapture({
          scope: "monitor",
          bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
          monitor: { id: 2, name: "Right" },
          screenshotHash: "def456",
        })
        expect(DesktopState.getPhase()).toBe("monitor_anchored")
        expect(DesktopState.getTarget()?.monitorId).toBe(2)
        expect(DesktopState.getAnchorHash()).toBe("def456")
      },
    })
  })

  test("rejects window capture without window metadata", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(() =>
          DesktopState.recordCapture({
            scope: "window",
            bounds: { x: 10, y: 10, width: 100, height: 80 },
            screenshotHash: "bad",
          }),
        ).toThrow("DesktopState.recordCapture(scope=window) requires window metadata")
      },
    })
  })

  test("rejects monitor capture without monitor metadata", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(() =>
          DesktopState.recordCapture({
            scope: "monitor",
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            screenshotHash: "bad",
          }),
        ).toThrow("DesktopState.recordCapture(scope=monitor) requires monitor metadata")
      },
    })
  })
})
