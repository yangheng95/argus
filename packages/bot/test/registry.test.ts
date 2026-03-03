import { describe, expect, test } from "bun:test"
import type { BotAdapter, MessageHandler } from "../src/adapter"
import { registerAdapters } from "../src/registry"

class Fake implements BotAdapter {
  constructor(readonly platform: string) {}
  async start() {}
  async stop() {}
  async sendMessage(_channel: string, _thread: string, _text: string) {}
  async uploadImage(_channel: string, _thread: string, _imageBuffer: Buffer, _filename: string, _title?: string) {}
  onMessage(_handler: MessageHandler) {}
}

function bot() {
  const list: BotAdapter[] = []
  return {
    list,
    register(adapter: BotAdapter) {
      list.push(adapter)
      return this
    },
  }
}

describe("adapter registry", () => {
  test("registers slack, telegram, discord and feishu from standard env keys", () => {
    const app = bot()
    const result = registerAdapters(app, {
      SLACK_BOT_TOKEN: "xoxb-a",
      SLACK_APP_TOKEN: "xapp-a",
      TELEGRAM_BOT_TOKEN: "tg-a",
      DISCORD_BOT_TOKEN: "dc-a",
      FEISHU_APP_ID: "cli_a",
      FEISHU_APP_SECRET: "sec_a",
    }, {
      slack: () => new Fake("slack"),
      telegram: () => new Fake("telegram"),
      discord: () => new Fake("discord"),
      feishu: () => new Fake("feishu"),
    })

    expect(result.warns).toHaveLength(0)
    expect(result.names).toEqual(["slack", "telegram", "discord", "feishu"])
    expect(app.list.map((item) => item.platform)).toEqual(["slack", "telegram", "discord", "feishu"])
  })

  test("supports openclaw fallback env keys", () => {
    const app = bot()
    const result = registerAdapters(app, {
      OPENCLAW_SLACK_BOT_TOKEN: "xoxb-a",
      OPENCLAW_SLACK_APP_TOKEN: "xapp-a",
      OPENCLAW_TELEGRAM_BOT_TOKEN: "tg-a",
    }, {
      slack: () => new Fake("slack"),
      telegram: () => new Fake("telegram"),
      discord: () => new Fake("discord"),
      feishu: () => new Fake("feishu"),
    })

    expect(result.warns).toHaveLength(0)
    expect(result.names).toEqual(["slack", "telegram"])
    expect(app.list.map((item) => item.platform)).toEqual(["slack", "telegram"])
  })

  test("warns and skips slack when app token is missing", () => {
    const app = bot()
    const result = registerAdapters(app, {
      SLACK_BOT_TOKEN: "xoxb-a",
    }, {
      slack: () => new Fake("slack"),
      telegram: () => new Fake("telegram"),
      discord: () => new Fake("discord"),
      feishu: () => new Fake("feishu"),
    })

    expect(result.names).toEqual([])
    expect(result.warns).toEqual([
      "Skip slack adapter: missing required env. Need: SLACK_BOT_TOKEN, SLACK_APP_TOKEN.",
    ])
    expect(app.list).toHaveLength(0)
  })

  test("warns when planned channel is configured", () => {
    const app = bot()
    const result = registerAdapters(app, {
      DINGTALK_APP_KEY: "ding_key",
      DINGTALK_APP_SECRET: "ding_secret",
    }, {
      slack: () => new Fake("slack"),
      telegram: () => new Fake("telegram"),
      discord: () => new Fake("discord"),
      feishu: () => new Fake("feishu"),
    })

    expect(result.names).toEqual([])
    expect(result.warns).toContain("Channel 'dingtalk' is configured but not implemented yet in OpenCorvus bot.")
  })
})
