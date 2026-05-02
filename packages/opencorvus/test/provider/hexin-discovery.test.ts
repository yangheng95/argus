import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Global } from "../../src/global"
import { discoverHexinModels, refreshHexinCache } from "../../src/provider/hexin-discovery"

const cacheFile = path.join(Global.Path.cache, "hexin-models.json")
const originalFetch = globalThis.fetch
const originalKey = process.env.HEXIN_API_KEY

beforeEach(async () => {
  await fs.rm(cacheFile, { force: true })
  process.env.HEXIN_API_KEY = "test-hexin-key"
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  if (originalKey === undefined) delete process.env.HEXIN_API_KEY
  else process.env.HEXIN_API_KEY = originalKey
  await fs.rm(cacheFile, { force: true })
})

describe("hexin model discovery", () => {
  test("normal provider-list discovery never fetches live models", async () => {
    let called = false
    globalThis.fetch = (async () => {
      called = true
      throw new Error("live fetch must not run")
    }) as typeof fetch

    const models = await discoverHexinModels()

    expect(models).toEqual({})
    expect(called).toBe(false)
  })

  test("explicit refresh fetches live models and writes the cache", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ id: "hexin-test-model" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch

    const models = await refreshHexinCache()
    const cached = JSON.parse(await Bun.file(cacheFile).text()) as { ids: string[] }

    expect(Object.keys(models)).toEqual(["hexin-test-model"])
    expect(cached.ids).toEqual(["hexin-test-model"])
  })
})
