import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { Config } from "../../src/config/config"
import { EngineConfig } from "../../src/engine/config"

afterEach(() => {
  mock.restore()
})

test("assistant.auto_iteration defaults off in EngineConfig", async () => {
  spyOn(Config, "get").mockResolvedValue(Config.Info.parse({}))

  const config = await EngineConfig.get()

  expect(config.auto_iteration).toBe(false)
})

test("assistant.auto_iteration enables host-side repair iteration", async () => {
  const parsed = Config.Info.parse({
    assistant: {
      auto_iteration: true,
    },
  })
  spyOn(Config, "get").mockResolvedValue(parsed)

  const config = await EngineConfig.get()

  expect(parsed.assistant?.auto_iteration).toBe(true)
  expect(config.auto_iteration).toBe(true)
})
