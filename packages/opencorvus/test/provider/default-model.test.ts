import path from "path"
import { describe, expect, test } from "bun:test"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { tmpdir } from "../fixture/fixture"

describe("resolveConfiguredModelRef - strict configured model only", () => {
  test("throws when cfg.model is absent", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { resolveConfiguredModelRef } = await import("../../src/agent/model")
        await expect(resolveConfiguredModelRef()).rejects.toThrow("MissingModelConfigError")
      },
    })
  })

  test("returns the parsed cfg.model when present", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencorvus.json"),
          JSON.stringify({
            $schema: "https://opencorvus.ai/config.json",
            model: Config.DEFAULT_MODEL,
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { resolveConfiguredModelRef } = await import("../../src/agent/model")
        await expect(resolveConfiguredModelRef()).resolves.toEqual(Provider.parseModel(Config.DEFAULT_MODEL))
      },
    })
  })
})
