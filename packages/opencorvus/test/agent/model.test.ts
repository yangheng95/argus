import { afterEach, describe, expect, mock, test } from "bun:test"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("resolveConfiguredModelRef — strict, no fallback", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("returns the parsed project model when cfg.model is set", async () => {
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
        const fresh = (await import("../../src/agent/model")).resolveConfiguredModelRef
        await expect(fresh()).resolves.toEqual(Provider.parseModel(Config.DEFAULT_MODEL))
      },
    })
  })

  test("throws MissingModelConfigError when cfg.model is absent — no fallback", async () => {
    await using tmp = await tmpdir()
    mock.module("../../src/config/config", () => ({
      Config: {
        ...Config,
        get: async () => ({}) as any,
      },
    }))
    // Also set the legacy env vars that the old implementation used as a
    // fallback source. The strict contract ignores them entirely — if this
    // test ever starts passing without the mock below also being mocked
    // out, a fallback path has crept back in.
    const prevBench = process.env.OPENCORVUS_BENCHMARK_MODEL
    const prevE2E = process.env.OPENCORVUS_E2E_MODEL
    process.env.OPENCORVUS_BENCHMARK_MODEL = "anthropic/should-be-ignored"
    process.env.OPENCORVUS_E2E_MODEL = "anthropic/should-also-be-ignored"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { MissingModelConfigError, resolveConfiguredModelRef } = await import("../../src/agent/model")
          await expect(resolveConfiguredModelRef()).rejects.toBeInstanceOf(MissingModelConfigError)
        },
      })
    } finally {
      if (prevBench) process.env.OPENCORVUS_BENCHMARK_MODEL = prevBench
      else delete process.env.OPENCORVUS_BENCHMARK_MODEL
      if (prevE2E) process.env.OPENCORVUS_E2E_MODEL = prevE2E
      else delete process.env.OPENCORVUS_E2E_MODEL
    }
  })
})
