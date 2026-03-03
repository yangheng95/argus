import type { BotAdapter } from "./adapter"

type Env = Record<string, string | undefined>

export const ADAPTER_HINT =
  "Set one adapter token set: SLACK_BOT_TOKEN + SLACK_APP_TOKEN, TELEGRAM_BOT_TOKEN, or DISCORD_BOT_TOKEN (OPENCLAW_* fallbacks are also supported)."

export interface AdapterFactory {
  slack(opts: { token: string; appToken: string; signingSecret?: string }): BotAdapter
  telegram(opts: { token: string }): BotAdapter
  discord(opts: { token: string }): BotAdapter
}

function pick(env: Env, keys: readonly string[]) {
  return keys
    .map((key) => env[key]?.trim())
    .find((val): val is string => Boolean(val))
}

interface Rule {
  name: string
  req: Record<string, readonly string[]>
  opt?: Record<string, readonly string[]>
  make: (f: AdapterFactory, vals: Record<string, string | undefined>) => BotAdapter
}

interface Plan {
  name: string
  req: Record<string, readonly string[]>
}

const ready: Rule[] = [
  {
    name: "slack",
    req: {
      token: ["SLACK_BOT_TOKEN", "OPENCLAW_SLACK_BOT_TOKEN"],
      appToken: ["SLACK_APP_TOKEN", "OPENCLAW_SLACK_APP_TOKEN"],
    },
    opt: {
      signingSecret: ["SLACK_SIGNING_SECRET", "OPENCLAW_SLACK_SIGNING_SECRET"],
    },
    make: (
      f: AdapterFactory,
      vals: Record<string, string | undefined>,
    ) => f.slack({
      token: vals.token!,
      appToken: vals.appToken!,
      signingSecret: vals.signingSecret,
    }),
  },
  {
    name: "telegram",
    req: {
      token: ["TELEGRAM_BOT_TOKEN", "OPENCLAW_TELEGRAM_BOT_TOKEN"],
    },
    make: (
      f: AdapterFactory,
      vals: Record<string, string | undefined>,
    ) => f.telegram({
      token: vals.token!,
    }),
  },
  {
    name: "discord",
    req: {
      token: ["DISCORD_BOT_TOKEN"],
    },
    make: (
      f: AdapterFactory,
      vals: Record<string, string | undefined>,
    ) => f.discord({
      token: vals.token!,
    }),
  },
] 

const planned: Plan[] = [
  {
    name: "feishu",
    req: {
      appId: ["FEISHU_APP_ID", "OPENCLAW_FEISHU_APP_ID"],
      appSecret: ["FEISHU_APP_SECRET", "OPENCLAW_FEISHU_APP_SECRET"],
    },
  },
  {
    name: "whatsapp",
    req: {
      token: ["WHATSAPP_ACCESS_TOKEN", "OPENCLAW_WHATSAPP_ACCESS_TOKEN"],
      numberId: ["WHATSAPP_PHONE_NUMBER_ID", "OPENCLAW_WHATSAPP_PHONE_NUMBER_ID"],
    },
  },
  {
    name: "googlechat",
    req: {
      serviceAccount: ["GOOGLECHAT_SERVICE_ACCOUNT_JSON", "OPENCLAW_GOOGLECHAT_SERVICE_ACCOUNT_JSON"],
    },
  },
  {
    name: "msteams",
    req: {
      appId: ["MSTEAMS_APP_ID", "OPENCLAW_MSTEAMS_APP_ID"],
      appSecret: ["MSTEAMS_APP_SECRET", "OPENCLAW_MSTEAMS_APP_SECRET"],
    },
  },
  {
    name: "line",
    req: {
      token: ["LINE_CHANNEL_ACCESS_TOKEN", "OPENCLAW_LINE_CHANNEL_ACCESS_TOKEN"],
    },
  },
  {
    name: "matrix",
    req: {
      homeserver: ["MATRIX_HOMESERVER_URL", "OPENCLAW_MATRIX_HOMESERVER_URL"],
      token: ["MATRIX_ACCESS_TOKEN", "OPENCLAW_MATRIX_ACCESS_TOKEN"],
    },
  },
  {
    name: "mattermost",
    req: {
      url: ["MATTERMOST_SERVER_URL", "OPENCLAW_MATTERMOST_SERVER_URL"],
      token: ["MATTERMOST_BOT_TOKEN", "OPENCLAW_MATTERMOST_BOT_TOKEN"],
    },
  },
  {
    name: "signal",
    req: {
      service: ["SIGNAL_SERVICE_URL", "OPENCLAW_SIGNAL_SERVICE_URL"],
      account: ["SIGNAL_ACCOUNT", "OPENCLAW_SIGNAL_ACCOUNT"],
    },
  },
  {
    name: "wecom",
    req: {
      corpId: ["WECOM_CORP_ID", "OPENCLAW_WECOM_CORP_ID"],
      secret: ["WECOM_SECRET", "OPENCLAW_WECOM_SECRET"],
      agentId: ["WECOM_AGENT_ID", "OPENCLAW_WECOM_AGENT_ID"],
    },
  },
  {
    name: "dingtalk",
    req: {
      appKey: ["DINGTALK_APP_KEY", "OPENCLAW_DINGTALK_APP_KEY"],
      appSecret: ["DINGTALK_APP_SECRET", "OPENCLAW_DINGTALK_APP_SECRET"],
    },
  },
] 

export const READY_CHANNELS = ready.map((item) => item.name)
export const PLANNED_CHANNELS = planned.map((item) => item.name)

function have(env: Env, req: Record<string, readonly string[]>) {
  return Object.values(req).some((keys) => Boolean(pick(env, keys)))
}

function need(req: Record<string, readonly string[]>) {
  return Object.values(req)
    .map((keys) => keys[0])
    .join(", ")
}

export function registerAdapters(
  bot: { register(adapter: BotAdapter): unknown },
  env: Env = process.env,
  create: AdapterFactory,
) {
  const names: string[] = []
  const warns: string[] = []

  for (const item of ready) {
    const vals = Object.entries(item.req).reduce<Record<string, string | undefined>>((acc, [key, keys]) => {
      const val = pick(env, keys)
      acc[key] = val
      return acc
    }, {})
    const miss = Object.keys(item.req).filter((key) => !vals[key])
    if (miss.length > 0) {
      if (have(env, item.req)) {
        warns.push(`Skip ${item.name} adapter: missing required env. Need: ${need(item.req)}.`)
      }
      continue
    }

    const opt = item.opt
      ? Object.entries(item.opt).reduce<Record<string, string | undefined>>((acc, [key, keys]) => {
        acc[key] = pick(env, keys)
        return acc
      }, {})
      : {}
    bot.register(item.make(create, { ...vals, ...opt }))
    names.push(item.name)
  }

  for (const item of planned) {
    if (!have(env, item.req)) continue
    warns.push(`Channel '${item.name}' is configured but not implemented yet in OpenCorvus bot.`)
  }

  return { names, warns }
}
