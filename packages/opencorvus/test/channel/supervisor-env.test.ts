import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

const adapterRegistrations: Array<{ env: Record<string, string | undefined>; slackOptions?: unknown }> = []

class FakeAdapter {
  constructor(readonly options: unknown) {}
}

class FakeRuntime {
  readonly adapters: unknown[] = []
  constructor(readonly options: unknown) {}
  register(adapter: unknown) {
    this.adapters.push(adapter)
    return this
  }
  setSTT(_pipeline: unknown) {}
  setVision(_pipeline: unknown) {}
  async start() {}
  async stop() {}
}

function adapterModule(exportName: string) {
  return { [exportName]: FakeAdapter }
}

mock.module("../../../channel-runtime/src/core", () => ({
  ChannelRuntime: FakeRuntime,
}))
mock.module("../../../channel-runtime/src/registry", () => ({
  ADAPTER_HINT: "test adapter hint",
  registerAdapters(
    runtime: { register(adapter: unknown): unknown },
    env: Record<string, string | undefined>,
    create: any,
  ) {
    const entry = { env: { ...env }, slackOptions: undefined as unknown }
    if (env.SLACK_BOT_TOKEN && env.SLACK_APP_TOKEN) {
      entry.slackOptions = {
        token: env.SLACK_BOT_TOKEN,
        appToken: env.SLACK_APP_TOKEN,
        signingSecret: env.SLACK_SIGNING_SECRET,
      }
      runtime.register(create.slack(entry.slackOptions))
      adapterRegistrations.push(entry)
      return { names: ["slack"], warns: [] }
    }
    adapterRegistrations.push(entry)
    return { names: [], warns: [] }
  },
}))
mock.module("../../../channel-runtime/src/adapters/slack", () => adapterModule("SlackAdapter"))
mock.module("../../../channel-runtime/src/adapters/telegram", () => adapterModule("TelegramAdapter"))
mock.module("../../../channel-runtime/src/adapters/discord", () => adapterModule("DiscordAdapter"))
mock.module("../../../channel-runtime/src/adapters/feishu", () => adapterModule("FeishuAdapter"))
mock.module("../../../channel-runtime/src/adapters/whatsapp", () => adapterModule("WhatsappAdapter"))
mock.module("../../../channel-runtime/src/adapters/googlechat", () => adapterModule("GoogleChatAdapter"))
mock.module("../../../channel-runtime/src/adapters/msteams", () => adapterModule("MSTeamsAdapter"))
mock.module("../../../channel-runtime/src/adapters/line", () => adapterModule("LineAdapter"))
mock.module("../../../channel-runtime/src/adapters/matrix", () => adapterModule("MatrixAdapter"))
mock.module("../../../channel-runtime/src/adapters/mattermost", () => adapterModule("MattermostAdapter"))
mock.module("../../../channel-runtime/src/adapters/signal", () => adapterModule("SignalAdapter"))
mock.module("../../../channel-runtime/src/adapters/wecom", () => adapterModule("WeComAdapter"))
mock.module("../../../channel-runtime/src/adapters/dingtalk", () => adapterModule("DingTalkAdapter"))
mock.module("../../../channel-runtime/src/adapters/qq", () => adapterModule("QQAdapter"))
mock.module("../../../channel-runtime/src/dashscope", () => ({
  applyDashscopeRuntime: async () => ({ key: undefined, baseURL: undefined }),
}))
mock.module("../../../channel-runtime/src/stt/setup", () => ({
  createConfiguredSTT: async () => undefined,
}))
mock.module("../../../channel-runtime/src/stt/pipeline", () => ({
  STTPipeline: class {
    async init() {}
  },
}))
mock.module("../../../channel-runtime/src/vision", () => ({
  VisionPipeline: class {},
}))
mock.module("@/server/server", () => ({
  Server: {
    url: () => new URL("http://127.0.0.1:17777"),
  },
}))

const { Instance } = await import("../../src/project/instance")
const { ChannelSupervisor } = await import("../../src/channel/supervisor")
const { Log } = await import("../../src/util/log")
const { resetDatabase } = await import("../fixture/db")
const { tmpdir } = await import("../fixture/fixture")

Log.init({ print: false })

const slackEnvKeys = ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_SIGNING_SECRET"] as const
let previousEnv: Record<(typeof slackEnvKeys)[number], string | undefined>

function slackConfig(suffix: string) {
  return {
    channel: {
      slack: {
        botToken: `xoxb-${suffix}`,
        appToken: `xapp-${suffix}`,
        signingSecret: `sig-${suffix}`,
      },
    },
  }
}

describe("channel supervisor env isolation", () => {
  beforeEach(() => {
    adapterRegistrations.length = 0
    previousEnv = {
      SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
      SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN,
      SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
    }
    for (const key of slackEnvKeys) delete process.env[key]
  })

  afterEach(async () => {
    await Instance.disposeAll()
    await resetDatabase()
    for (const key of slackEnvKeys) {
      const value = previousEnv[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  test("does not start managed runtime from global Slack env", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-global"
    process.env.SLACK_APP_TOKEN = "xapp-global"

    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const status = await ChannelSupervisor.sync({ channel: {} })

        expect(status.status).toBe("disabled")
        expect(status.running).toBe(false)
        expect(status.channels).toEqual([])
        expect(adapterRegistrations).toHaveLength(0)
      },
    })
  })

  test("does not leave project Slack config in process env after removal", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const active = await ChannelSupervisor.sync(slackConfig("a"))

        expect(active.status).toBe("running")
        expect(active.channels).toEqual(["slack"])
        expect(adapterRegistrations).toHaveLength(1)
        expect(adapterRegistrations[0]?.env.SLACK_BOT_TOKEN).toBe("xoxb-a")
        expect(process.env.SLACK_BOT_TOKEN).toBeUndefined()
        expect(process.env.SLACK_APP_TOKEN).toBeUndefined()
        expect(process.env.SLACK_SIGNING_SECRET).toBeUndefined()

        const disabled = await ChannelSupervisor.sync({ channel: {} })

        expect(disabled.status).toBe("disabled")
        expect(disabled.running).toBe(false)
        expect(disabled.channels).toEqual([])
        expect(adapterRegistrations).toHaveLength(1)
        expect(process.env.SLACK_BOT_TOKEN).toBeUndefined()
        expect(process.env.SLACK_APP_TOKEN).toBeUndefined()
        expect(process.env.SLACK_SIGNING_SECRET).toBeUndefined()
      },
    })
  })

  test("updates managed runtime with changed project Slack config", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await ChannelSupervisor.sync(slackConfig("a"))
        const updated = await ChannelSupervisor.sync(slackConfig("b"))

        expect(updated.status).toBe("running")
        expect(adapterRegistrations).toHaveLength(2)
        expect(adapterRegistrations[0]?.slackOptions).toEqual({
          token: "xoxb-a",
          appToken: "xapp-a",
          signingSecret: "sig-a",
        })
        expect(adapterRegistrations[1]?.slackOptions).toEqual({
          token: "xoxb-b",
          appToken: "xapp-b",
          signingSecret: "sig-b",
        })
        expect(process.env.SLACK_BOT_TOKEN).toBeUndefined()
        expect(process.env.SLACK_APP_TOKEN).toBeUndefined()
        expect(process.env.SLACK_SIGNING_SECRET).toBeUndefined()
      },
    })
  })
})
