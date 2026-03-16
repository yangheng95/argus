import { describe, expect, test } from "bun:test"
import path from "path"
import { createCodebaseTools } from "../../src/orchestrator/codebase-tools"
import { tmpdir } from "../fixture/fixture"

describe("orchestrator.codebase-tools", () => {
  test("search_code uses managed ripgrep path", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "alpha.ts"), "export const alpha = 'hello world'\n")
      },
    })
    const tools = createCodebaseTools(tmp.path)
    const result = await tools.search_code.execute?.({
      pattern: "hello world",
      max_results: 5,
    })
    expect(result).toContain("alpha.ts:1:")
  })

  test("search_code accepts /mnt-style paths on Windows", async () => {
    if (process.platform !== "win32") return
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "beta.ts"), "export const beta = 'windows mount'\n")
      },
    })
    const target = tmp.path.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`)
    const tools = createCodebaseTools(tmp.path)
    const result = await tools.search_code.execute?.({
      pattern: "windows mount",
      path: target,
      max_results: 5,
    })
    expect(result).toContain("beta.ts:1:")
  })
})
