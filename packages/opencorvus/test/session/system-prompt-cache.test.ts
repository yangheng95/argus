import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { SystemPrompt } from "../../src/session/system"
import type { Provider } from "../../src/provider/provider"
import { tmpdir } from "../fixture/fixture"

const model: Provider.Model = {
  id: "test-model",
  providerID: "test",
  api: { id: "test-model", url: "https://example.com", npm: "@ai-sdk/openai" },
  name: "Test Model",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: true, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 0, input: 0, output: 0 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

describe("SystemPrompt.environment cache stability", () => {
  test("returns byte-identical output across calls within the same day", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const first = await SystemPrompt.environment(model)
        await new Promise((r) => setTimeout(r, 1100))
        const second = await SystemPrompt.environment(model)
        expect(second).toEqual(first)
      },
    })
  }, 10000)

  test("does not leak sub-day timestamps into the cached prefix", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const blocks = await SystemPrompt.environment(model)
        const joined = blocks.join("\n")
        expect(joined).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
        expect(joined).not.toMatch(/Current time/i)
      },
    })
  }, 10000)
})
