import { afterEach, describe, expect, mock, test } from "bun:test"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("Provider.defaultModel - strict config only", () => {
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
        const fresh = (await import("../../src/provider/provider")).Provider
        await expect(fresh.defaultModel()).rejects.toThrow("MissingModelConfigError")
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
        const fresh = (await import("../../src/provider/provider")).Provider
        await expect(fresh.defaultModel()).resolves.toEqual({
          providerID: "deepseek",
          modelID: "deepseek-v4-pro",
        })
      },
    })
  })
})
