import { afterEach, describe, expect, test } from "bun:test"
import { ChannelRegistry } from "../../src/channel/registry"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("channel.registry", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("includes runtime status fields for managed channels", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const items = await ChannelRegistry.list()
        const telegram = items.find((item) => item.id === "telegram")
        const discord = items.find((item) => item.id === "discord")

        expect(telegram?.runtime_status).toBeDefined()
        expect(typeof telegram?.runtime_detail).toBe("string")
        expect(discord?.runtime_status).toBeDefined()
        expect(typeof discord?.runtime_detail).toBe("string")
      },
    })
  })
})
