import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { Agent } from "../../src/agent/agent"
import { Config } from "../../src/config/config"
import { Provider } from "../../src/provider/provider"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..")

async function repoFile(...parts: string[]) {
  return readFile(path.join(ROOT, ...parts), "utf8")
}

describe("global config route runtime refresh", () => {
  let previousGlobalConfigDir: string | undefined

  beforeEach(async () => {
    previousGlobalConfigDir = process.env.OPENCORVUS_GLOBAL_CONFIG_DIR
    await Instance.disposeAll()
    await resetDatabase()
    Config.global.reset()
    Server.resetProjectRoutesAppForTest()
  })

  afterEach(async () => {
    if (previousGlobalConfigDir === undefined) delete process.env.OPENCORVUS_GLOBAL_CONFIG_DIR
    else process.env.OPENCORVUS_GLOBAL_CONFIG_DIR = previousGlobalConfigDir
    Config.global.reset()
    Server.resetProjectRoutesAppForTest()
    await Instance.disposeAll()
    await resetDatabase()
  })

  async function patchGlobalConfig(body: unknown) {
    return Server.App().request("/global/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  }

  test("PATCH /global/config refreshes active project config, provider, and agent caches", async () => {
    await using globalDir = await tmpdir()
    await using project = await tmpdir({ git: true })
    process.env.OPENCORVUS_GLOBAL_CONFIG_DIR = globalDir.path
    Config.global.reset()

    const initialResponse = await patchGlobalConfig({
      username: "bh098-before",
      provider: {
        "bh098-old": {
          name: "BH098 Old",
          api: "https://old.example.test/v1",
          models: {
            "m-old": { name: "M Old" },
          },
        },
      },
      agent: {
        build: {
          description: "BH098 old build agent",
        },
      },
    })
    expect(initialResponse.status).toBe(200)

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const configResponse = await Server.App().request("/config", {
          headers: { "x-opencorvus-directory": project.path },
        })
        expect(configResponse.status).toBe(200)
        const config = (await configResponse.json()) as Config.Info
        expect(config.username).toBe("bh098-before")

        const providers = await Provider.list()
        expect(providers["bh098-old"]?.name).toBe("BH098 Old")
        expect(providers["bh098-new"]).toBeUndefined()

        const build = await Agent.get("build")
        expect(build.description).toBe("BH098 old build agent")
      },
    })

    const updateResponse = await patchGlobalConfig({
      username: "bh098-after",
      provider: {
        "bh098-new": {
          name: "BH098 New",
          api: "https://new.example.test/v1",
          models: {
            "m-new": { name: "M New" },
          },
        },
      },
      agent: {
        build: {
          description: "BH098 new build agent",
        },
      },
    })
    expect(updateResponse.status).toBe(200)

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        expect((await Config.get()).username).toBe("bh098-after")

        const configResponse = await Server.App().request("/config", {
          headers: { "x-opencorvus-directory": project.path },
        })
        expect(configResponse.status).toBe(200)
        const config = (await configResponse.json()) as Config.Info
        expect(config.username).toBe("bh098-after")

        const providers = await Provider.list()
        expect(providers["bh098-old"]?.name).toBe("BH098 Old")
        expect(providers["bh098-new"]?.name).toBe("BH098 New")

        const build = await Agent.get("build")
        expect(build.description).toBe("BH098 new build agent")
      },
    })
  })

  test("global config update owns active runtime invalidation", async () => {
    const configSource = await repoFile("packages", "opencorvus", "src", "config", "config.ts")
    const start = configSource.indexOf("export async function updateGlobal")
    expect(start).toBeGreaterThan(0)
    const body = configSource.slice(start, configSource.indexOf("export async function directories", start))

    expect(body).toContain("await state.resetAll()")
    expect(body).toContain("Provider.resetAll()")
    expect(body).toContain("Agent.resetAll()")
    expect(body).toContain("Instance.forEachActive")
    expect(body).toContain("ChannelSupervisor.sync(await get())")

    const globalRouteSource = await repoFile("packages", "opencorvus", "src", "server", "routes", "global.ts")
    expect(globalRouteSource).not.toContain("Provider.resetAll()")
    expect(globalRouteSource).not.toContain("Agent.resetAll()")
  })
})
