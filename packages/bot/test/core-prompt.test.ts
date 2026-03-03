import { describe, expect, mock, test } from "bun:test"

mock.module("@opencorvus-ai/sdk", () => ({
  createOpencode: async () => {
    throw new Error("not used in this test")
  },
}))

const { BotCore } = await import("../src/core")

describe("bot core system prompt", () => {
  test("enforces visible execution principles", () => {
    const core = new BotCore()
    const prompt = (core as any).buildSystemPrompt("slack") as string

    expect(prompt).toContain("The visibility principle")
    expect(prompt).toContain("OpenCorvus TUI")
    expect(prompt).toContain("Search memory at the start of each task")
  })
})
