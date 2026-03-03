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

const defaults = {
  x: 100,
  y: 120,
  width: 1280,
  height: 820,
  isMinimized: false,
  isFocused: false,
}

let wins: Win[] = []

function makeWindow(win: Win) {
  return {
    id: () => win.id,
    title: () => win.title,
    appName: () => win.appName,
    x: () => win.x,
    y: () => win.y,
    width: () => win.width,
    height: () => win.height,
    isMinimized: () => win.isMinimized,
    isFocused: () => win.isFocused,
  }
}

mock.module("@nut-tree-fork/libnut", () => ({
  DefaultWindowAction: class {
    async focusWindow(_windowId: number) {}
  },
}))

mock.module("node-screenshots", () => ({
  Window: {
    all: () => wins.map(makeWindow),
  },
}))

const { WindowManager } = await import("../../src/opencorvus/perception/window")

beforeEach(() => {
  wins = []
})

describe("window binding recovery", () => {
  test("rebinds when bound window id changes but same app remains", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        wins = [
          {
            id: 11,
            title: "Settings",
            appName: "SystemSettings",
            ...defaults,
            isFocused: true,
          },
        ]
        await WindowManager.bindById(11, "Settings")

        wins = [
          {
            id: 25,
            title: "System > Display",
            appName: "SystemSettings",
            ...defaults,
          },
          {
            id: 31,
            title: "OpenCorvus Console",
            appName: "OpenCorvus",
            x: 40,
            y: 40,
            width: 1500,
            height: 900,
            isMinimized: false,
            isFocused: true,
          },
        ]

        const binding = await WindowManager.getBinding()
        expect(binding?.windowId).toBe(25)
        expect(binding?.info.appName).toBe("SystemSettings")
      },
    })
  })

  test("clears binding when no candidate window remains", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        wins = [
          {
            id: 11,
            title: "Settings",
            appName: "SystemSettings",
            ...defaults,
            isFocused: true,
          },
        ]
        await WindowManager.bindById(11, "Settings")
        wins = []
        const binding = await WindowManager.getBinding()
        expect(binding).toBeNull()
      },
    })
  })
})
