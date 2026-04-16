import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { resolveConfiguredModelRef } from "../../src/agent/model"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("resolveConfiguredModelRef", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("prefers explicit benchmark model over Provider.defaultModel", async () => {
    await using tmp = await tmpdir()
    const fallback = spyOn(Provider, "defaultModel").mockResolvedValue({
      providerID: "alibaba-coding-plan-cn",
      modelID: "kimi-k2.5",
    })
    const previous = process.env.OPENCORVUS_BENCHMARK_MODEL
    process.env.OPENCORVUS_BENCHMARK_MODEL = "alibaba-coding-plan-cn/qwen3.5-plus"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(resolveConfiguredModelRef()).resolves.toEqual({
            providerID: "alibaba-coding-plan-cn",
            modelID: "qwen3.5-plus",
          })
        },
      })
      expect(fallback).not.toHaveBeenCalled()
    } finally {
      if (previous) process.env.OPENCORVUS_BENCHMARK_MODEL = previous
      else delete process.env.OPENCORVUS_BENCHMARK_MODEL
    }
  })
})
