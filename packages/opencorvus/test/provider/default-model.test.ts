import { afterEach, describe, expect, mock, test } from "bun:test"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { tmpdir } from "../fixture/fixture"

describe("resolveConfiguredModelRef - strict configured model only", () => {
  afterEach(() => {
    mock.restore()
  })

  test("throws when cfg.model is absent", async () => {
    await using tmp = await tmpdir()
    mock.module("../../src/config/config", () => ({
      Config: {
        ...Config,
        get: async () => ({}) as any,
      },
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { resolveConfiguredModelRef } = await import("../../src/agent/model")
        await expect(resolveConfiguredModelRef()).rejects.toThrow("MissingModelConfigError")
      },
    })
  })

  test("returns the parsed cfg.model when present", async () => {
    await using tmp = await tmpdir()
    mock.module("../../src/config/config", () => ({
      Config: {
        ...Config,
        get: async () => ({ model: Config.DEFAULT_MODEL }) as any,
      },
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { resolveConfiguredModelRef } = await import("../../src/agent/model")
        await expect(resolveConfiguredModelRef()).resolves.toEqual(Provider.parseModel(Config.DEFAULT_MODEL))
      },
    })
  })
})
