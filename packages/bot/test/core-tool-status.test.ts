import { beforeEach, describe, expect, mock, test } from "bun:test"

mock.module("@opencorvus-ai/sdk", () => ({
  createOpencode: async () => {
    throw new Error("not used in this test")
  },
}))

const { BotCore } = await import("../src/core")

beforeEach(() => {
  delete process.env.OPENCORVUS_BOT_DEBUG_TOOL_INPUT
})

describe("bot core tool status", () => {
  test("hides tool input details by default", () => {
    const core = new BotCore()
    const status = (core as any).formatToolStatus.bind(core)

    expect(status("input", { action: "click", x: 120, y: 80, button: "left" })).toBe("`input.click`")
    expect(status("screen", { action: "bind_window", title: "OpenCorvus" })).toBe("`screen.bind_window`")
    expect(status("bash", { command: "echo secret" })).toBe("`$ bash`")
  })

  test("shows tool input details in debug mode", () => {
    process.env.OPENCORVUS_BOT_DEBUG_TOOL_INPUT = "1"
    const core = new BotCore()
    const status = (core as any).formatToolStatus.bind(core)

    expect(status("input", { action: "click", x: 120, y: 80, button: "left" })).toBe("`input.click: (120, 80) left`")
    expect(status("screen", { action: "bind_window", title: "OpenCorvus" })).toBe("`screen.bind_window: OpenCorvus`")
    expect(status("bash", { command: "echo secret" })).toBe("`$ echo secret`")
  })
})
