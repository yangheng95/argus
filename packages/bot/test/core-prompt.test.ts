import { describe, expect, test } from "bun:test"
import { BotCore } from "../src/core"

describe("bot core system prompt", () => {
  test("enforces memory recall and external setup research", () => {
    const core = new BotCore()
    const prompt = (core as any).buildSystemPrompt("slack") as string

    expect(prompt).toContain('memory(action: "search")')
    expect(prompt).toContain("websearch/webfetch")
    expect(prompt).toContain("Slack bot registration")
  })
})
