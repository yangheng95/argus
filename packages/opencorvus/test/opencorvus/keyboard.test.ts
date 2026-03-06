import { beforeEach, describe, expect, mock, test } from "bun:test"

const typed: string[] = []
const pressed: unknown[] = []
const released: unknown[] = []
const keyEvents: Array<{ vk: number; flags: number }> = []
const positions: Array<{ x: number; y: number }> = []
let leftClicks = 0
let setCursorOk = false
let keyMap: Record<string, unknown> | undefined
const originalPlatform = process.platform

mock.module("@nut-tree-fork/nut-js", () => ({
  Point: class Point {
    x: number
    y: number
    constructor(x: number, y: number) {
      this.x = x
      this.y = y
    }
  },
  Button: {
    LEFT: "LEFT",
    MIDDLE: "MIDDLE",
  },
  keyboard: {
    type: async (text: string) => {
      typed.push(text)
    },
    pressKey: async (key: unknown) => {
      pressed.push(key)
    },
    releaseKey: async (key: unknown) => {
      released.push(key)
    },
  },
  mouse: {
    setPosition: async (point: { x: number; y: number }) => {
      positions.push({ x: point.x, y: point.y })
    },
    leftClick: async () => {
      leftClicks += 1
    },
    rightClick: async () => {},
    click: async () => {},
    doubleClick: async () => {},
    scrollUp: async () => {},
    scrollDown: async () => {},
    drag: async () => {},
  },
  straightTo: (point: unknown) => point,
  get Key() {
    return keyMap
  },
}))

mock.module("bun:ffi", () => ({
  dlopen: (_name: string, _symbols: unknown) => ({
    symbols: {
      keybd_event: (vk: number, _scan: number, flags: number, _extra: number) => {
        keyEvents.push({ vk, flags })
      },
      SetCursorPos: (_x: number, _y: number) => (setCursorOk ? 1 : 0),
      mouse_event: (_flags: number, _dx: number, _dy: number, _data: number, _extra: number) => {},
    },
    close() {},
  }),
}))

const { Keyboard } = await import("../../src/opencorvus/gui/keyboard")
const { Mouse } = await import("../../src/opencorvus/gui/mouse")

beforeEach(() => {
  typed.length = 0
  pressed.length = 0
  released.length = 0
  keyEvents.length = 0
  positions.length = 0
  leftClicks = 0
  setCursorOk = false
  keyMap = undefined
  Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true, writable: true })
})

describe("keyboard fallback behavior", () => {
  test("pressKey falls back to typing when Key export is missing", async () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true, writable: true })
    await Keyboard.pressKey("enter")
    expect(typed).toEqual(["enter"])
    expect(pressed).toHaveLength(0)
    expect(released).toHaveLength(0)
  })

  test("hotkey reports unknown key instead of crashing when Key export is missing", async () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true, writable: true })
    await expect(Keyboard.hotkey("ctrl", "v")).rejects.toThrow("Unknown key: ctrl")
  })

  test("hotkey uses win32 native fallback when Key export is missing", async () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true, writable: true })
    await Keyboard.hotkey("ctrl", "v")
    expect(keyEvents).toHaveLength(4)
    expect(keyEvents[0]).toEqual({ vk: 0xa2, flags: 0 })
    expect(keyEvents[1]).toEqual({ vk: 0x56, flags: 0 })
    expect(keyEvents[2]).toEqual({ vk: 0x56, flags: 0x0002 })
    expect(keyEvents[3]).toEqual({ vk: 0xa2, flags: 0x0002 })
    expect(pressed).toHaveLength(0)
    expect(released).toHaveLength(0)
  })
})

describe("mouse win32 fallback behavior", () => {
  test("falls back to nut-js click when SetCursorPos fails", async () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true, writable: true })
    await Mouse.click(320, 240)
    expect(positions).toEqual([{ x: 320, y: 240 }])
    expect(leftClicks).toBe(1)
  })

  test("prefers win32 click path when SetCursorPos succeeds", async () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true, writable: true })
    setCursorOk = true
    await Mouse.click(320, 240)
    expect(positions).toHaveLength(0)
    expect(leftClicks).toBe(0)
  })
})
