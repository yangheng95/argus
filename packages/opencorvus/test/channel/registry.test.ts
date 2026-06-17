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
        const ids = items.map((item) => item.id)
        const telegram = items.find((item) => item.id === "telegram")
        const discord = items.find((item) => item.id === "discord")
        const feishu = items.find((item) => item.id === "feishu")
        const whatsapp = items.find((item) => item.id === "whatsapp")

        expect(ids).toContain("feishu")
        expect(ids).toContain("whatsapp")
        expect(ids).toContain("signal")
        expect(ids).toContain("mattermost")
        expect(ids).toContain("qq")
        expect(telegram?.runtime_status).toBeDefined()
        expect(typeof telegram?.runtime_detail).toBe("string")
        expect(discord?.runtime_status).toBeDefined()
        expect(typeof discord?.runtime_detail).toBe("string")
        expect(feishu?.fields.some((item) => item.key === "appId")).toBe(true)
        expect(whatsapp?.fields.some((item) => item.key === "numberId")).toBe(true)
      },
    })
  })

  test("does not mark project channel configured from global process env", async () => {
    const previousBotToken = process.env.SLACK_BOT_TOKEN
    const previousAppToken = process.env.SLACK_APP_TOKEN
    process.env.SLACK_BOT_TOKEN = "xoxb-global"
    process.env.SLACK_APP_TOKEN = "xapp-global"

    try {
      await using tmp = await tmpdir({ git: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const items = await ChannelRegistry.list()
          const slack = items.find((item) => item.id === "slack")

          expect(slack?.status).toBe("missing")
          expect(slack?.runtime_status).toBe("disabled")
        },
      })
    } finally {
      if (previousBotToken === undefined) delete process.env.SLACK_BOT_TOKEN
      else process.env.SLACK_BOT_TOKEN = previousBotToken
      if (previousAppToken === undefined) delete process.env.SLACK_APP_TOKEN
      else process.env.SLACK_APP_TOKEN = previousAppToken
    }
  })
})
