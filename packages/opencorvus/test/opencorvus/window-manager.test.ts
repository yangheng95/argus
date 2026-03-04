import { beforeEach, describe, expect, mock, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

type Win = {
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

let windows: Win[] = []

function native(w: Win) {
  return {
    id: () => w.id,
    title: () => w.title,
    appName: () => w.appName,
    x: () => w.x,
    y: () => w.y,
    width: () => w.width,
    height: () => w.height,
    isMinimized: () => w.isMinimized,
    isFocused: () => w.isFocused,
  }
}

mock.module("node-screenshots", () => ({
  Window: {
    all: () => windows.map(native),
  },
}))

const { WindowManager } = await import("../../src/opencorvus/perception/window")

beforeEach(() => {
  windows = [
    {
      id: 7,
      title: "Editor",
      appName: "Code",
      x: 100,
      y: 80,
      width: 1400,
      height: 900,
      isMinimized: false,
      isFocused: true,
    },
    {
      id: 11,
      title: "Editor",
      appName: "Code",
      x: 120,
      y: 100,
      width: 1280,
      height: 820,
      isMinimized: false,
      isFocused: true,
    },
  ]
})

describe("opencorvus.window rebind", () => {
  test("keeps exact window_id binding across task rebinding when duplicates exist", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await WindowManager.bindById(7, "Editor")
        windows = [windows[1], windows[0]]
        const rebound = await WindowManager.rebindForTask(1)
        expect(rebound?.windowId).toBe(7)
        expect(rebound?.matchWindowId).toBe(7)
      },
    })
  })

  test("falls back to title match when original window_id disappears", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await WindowManager.bindById(7, "Editor")
        windows = [windows[1]]
        const rebound = await WindowManager.rebindForTask(1)
        expect(rebound?.windowId).toBe(11)
        expect(rebound?.matchWindowId).toBe(7)
      },
    })
  })

  test("prefers same app during title-based task rebinding", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        windows = [
          {
            id: 7,
            title: "Editor",
            appName: "Code",
            x: 100,
            y: 80,
            width: 1400,
            height: 900,
            isMinimized: false,
            isFocused: true,
          },
          {
            id: 21,
            title: "Editor",
            appName: "Terminal",
            x: 200,
            y: 120,
            width: 1300,
            height: 860,
            isMinimized: false,
            isFocused: false,
          },
        ]
        await WindowManager.bind("Editor")
        windows = [
          {
            id: 21,
            title: "Editor",
            appName: "Terminal",
            x: 200,
            y: 120,
            width: 1300,
            height: 860,
            isMinimized: false,
            isFocused: true,
          },
          {
            id: 7,
            title: "Editor",
            appName: "Code",
            x: 100,
            y: 80,
            width: 1400,
            height: 900,
            isMinimized: false,
            isFocused: true,
          },
        ]
        const rebound = await WindowManager.rebindForTask(1)
        expect(rebound?.windowId).toBe(7)
        expect(rebound?.matchAppName).toBe("Code")
      },
    })
  })

  test("ignores by-id candidate when app identity no longer matches", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await WindowManager.bindById(7, "Editor")
        windows = [
          {
            id: 7,
            title: "Terminal",
            appName: "Terminal",
            x: 200,
            y: 120,
            width: 1300,
            height: 860,
            isMinimized: false,
            isFocused: true,
          },
          {
            id: 11,
            title: "Editor",
            appName: "Code",
            x: 120,
            y: 100,
            width: 1280,
            height: 820,
            isMinimized: false,
            isFocused: true,
          },
        ]
        const rebound = await WindowManager.rebindForTask(1)
        expect(rebound?.windowId).toBe(11)
      },
    })
  })
})
