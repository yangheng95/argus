import { describe, expect, test } from "bun:test"
import path from "path"
import { GlobTool } from "../../src/tool/glob"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.glob", () => {
  test("finds files in the current project", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "a.txt"), "a")
        await Bun.write(path.join(dir, "b.md"), "b")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const glob = await GlobTool.init()
        const result = await glob.execute({ pattern: "*.txt", path: tmp.path }, ctx)
        expect(result.metadata.count).toBe(1)
        expect(result.output).toContain("a.txt")
      },
    })
  })

  test("accepts /mnt-style paths on Windows", async () => {
    if (process.platform !== "win32") return
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "windows.txt"), "hello")
      },
    })
    const mntPath = tmp.path.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const glob = await GlobTool.init()
        const result = await glob.execute({ pattern: "*.txt", path: mntPath }, ctx)
        expect(result.metadata.count).toBe(1)
        expect(result.output).toContain("windows.txt")
      },
    })
  })
})
