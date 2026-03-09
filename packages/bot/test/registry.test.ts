import { describe, expect, test } from "bun:test"
import type { BotAdapter, MessageHandler } from "../src/adapter"
import { registerAdapters, READY_CHANNELS } from "../src/registry"

class Fake implements BotAdapter {
  constructor(
    readonly platform: string,
    readonly options?: unknown,
  ) {}
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

function factory() {
  return {
    slack: (options: unknown) => new Fake("slack", options),
    telegram: (options: unknown) => new Fake("telegram", options),
    discord: (options: unknown) => new Fake("discord", options),
    feishu: (options: unknown) => new Fake("feishu", options),
    whatsapp: (options: unknown) => new Fake("whatsapp", options),
    googlechat: (options: unknown) => new Fake("googlechat", options),
    msteams: (options: unknown) => new Fake("msteams", options),
    line: (options: unknown) => new Fake("line", options),
    matrix: (options: unknown) => new Fake("matrix", options),
    mattermost: (options: unknown) => new Fake("mattermost", options),
    signal: (options: unknown) => new Fake("signal", options),
    wecom: (options: unknown) => new Fake("wecom", options),
    dingtalk: (options: unknown) => new Fake("dingtalk", options),
  }
}

describe("channel registry", () => {
  test("registers slack, telegram, discord and feishu from standard env keys", () => {
    const app = bot()
    const result = registerAdapters(
      app,
      {
        SLACK_BOT_TOKEN: "xoxb-a",
        SLACK_APP_TOKEN: "xapp-a",
        TELEGRAM_BOT_TOKEN: "tg-a",
        DISCORD_BOT_TOKEN: "dc-a",
        FEISHU_APP_ID: "cli_a",
        FEISHU_APP_SECRET: "sec_a",
      },
      factory(),
    )

    expect(result.warns).toHaveLength(0)
    expect(result.names).toEqual(["slack", "telegram", "discord", "feishu"])
    expect(app.list.map((item) => item.platform)).toEqual(["slack", "telegram", "discord", "feishu"])
  })

  test("warns and skips slack when app token is missing", () => {
    const app = bot()
    const result = registerAdapters(
      app,
      {
        SLACK_BOT_TOKEN: "xoxb-a",
      },
      factory(),
    )

    expect(result.names).toEqual([])
    expect(result.warns).toEqual(["Skip slack channel: missing required env. Need: SLACK_BOT_TOKEN, SLACK_APP_TOKEN."])
    expect(app.list).toHaveLength(0)
  })

  test("registers dingtalk from env keys", () => {
    const app = bot()
    const result = registerAdapters(
      app,
      {
        DINGTALK_APP_KEY: "ding_key",
        DINGTALK_APP_SECRET: "ding_secret",
      },
      factory(),
    )

    expect(result.warns).toEqual([])
    expect(result.names).toEqual(["dingtalk"])
    expect(app.list.map((item) => item.platform)).toEqual(["dingtalk"])
  })

  test("forwards optional webhook settings from shared channel definitions", () => {
    const app = bot()
    const result = registerAdapters(
      app,
      {
        FEISHU_APP_ID: "cli_a",
        FEISHU_APP_SECRET: "sec_a",
        FEISHU_VERIFICATION_TOKEN: "verify_a",
        FEISHU_WEBHOOK_HOST: "0.0.0.0",
        FEISHU_WEBHOOK_PORT: "16666",
        FEISHU_WEBHOOK_PATH: "/feishu",
      },
      factory(),
    )

    expect(result.warns).toHaveLength(0)
    expect(result.names).toEqual(["feishu"])
    expect((app.list[0] as Fake).options).toEqual({
      appId: "cli_a",
      appSecret: "sec_a",
      host: "0.0.0.0",
      port: 16666,
      path: "/feishu",
      verificationToken: "verify_a",
    })
  })

  test("no planned channels remain", () => {
    expect(READY_CHANNELS).toContain("dingtalk")
  })
})
