import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool/registry"
import { tmpdir } from "../fixture/fixture"

const CLIENT = process.env.OPENCORVUS_CLIENT
const ENABLE_TUI = process.env.OPENCORVUS_ENABLE_TUI_TOOL

describe("tool registry", () => {
  afterEach(() => {
    if (CLIENT === undefined) delete process.env.OPENCORVUS_CLIENT
    else process.env.OPENCORVUS_CLIENT = CLIENT
    if (ENABLE_TUI === undefined) delete process.env.OPENCORVUS_ENABLE_TUI_TOOL
    else process.env.OPENCORVUS_ENABLE_TUI_TOOL = ENABLE_TUI
  })

  test("app client does not expose the tui tool by default", async () => {
    process.env.OPENCORVUS_CLIENT = "app"
    delete process.env.OPENCORVUS_ENABLE_TUI_TOOL

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await ToolRegistry.ids()).not.toContain("tui")
      },
    })
  })

  test("tui tool can be re-enabled explicitly", async () => {
    process.env.OPENCORVUS_CLIENT = "app"
    process.env.OPENCORVUS_ENABLE_TUI_TOOL = "1"

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await ToolRegistry.ids()).toContain("tui")
      },
    })
  })
})
