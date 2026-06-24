import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { Config } from "../../src/config/config"
import { EngineConfig } from "../../src/engine/config"

afterEach(() => {
  mock.restore()
})

test("retired host repair-loop setting is rejected by config schema", () => {
  const retiredKey = ["auto", "iteration"].join("_")
  const parsed = Config.Info.safeParse({
    assistant: {
      [retiredKey]: true,
    },
  })

  expect(parsed.success).toBe(false)
})

test("EngineConfig no longer materializes the retired repair-loop setting", async () => {
  spyOn(Config, "get").mockResolvedValue(Config.Info.parse({}))

  const config = await EngineConfig.get()

  expect(Object.hasOwn(config, ["auto", "iteration"].join("_"))).toBe(false)
})
