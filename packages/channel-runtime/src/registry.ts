import { ChannelCatalog, type ChannelName, channelRequiredFields, resolveChannel } from "@opencorvus-ai/channel-config"
import type { ChannelAdapter } from "./adapter"

type Env = Record<string, string | undefined>
type Values = Record<string, string | undefined>

type AdapterOptions = {
  slack: { token: string; appToken: string; signingSecret?: string }
  telegram: { token: string }
  discord: { token: string }
  feishu: {
    appId: string
    appSecret: string
    host?: string
    port?: number
    path?: string
    verificationToken?: string
  }
  whatsapp: {
    token: string
    numberId: string
    host?: string
    port?: number
    path?: string
    verifyToken?: string
  }
  googlechat: {
    serviceAccount: string
    host?: string
    port?: number
    path?: string
  }
  msteams: {
    appId: string
    appSecret: string
    host?: string
    port?: number
    path?: string
  }
  line: {
    token: string
    host?: string
    port?: number
    path?: string
    secret?: string
  }
  matrix: { homeserver: string; token: string; since?: string }
  mattermost: {
    url: string
    token: string
    host?: string
    port?: number
    path?: string
  }
  signal: { service: string; account: string }
  wecom: {
    corpId: string
    secret: string
    agentId: string
    host?: string
    port?: number
    path?: string
  }
  dingtalk: {
    appKey: string
    appSecret: string
    host?: string
    port?: number
    path?: string
    defaultWebhook?: string
  }
  qq: {
    appId: string
    appSecret: string
    host?: string
    port?: number
    path?: string
    sandbox?: boolean
  }
}

export const ADAPTER_HINT = `Set one chat channel token set: ${ChannelCatalog.map((item) =>
  channelRequiredFields(item.id)
    .map((field) => field.env)
    .filter((field): field is string => Boolean(field))
    .join(" + "),
)
  .filter((item) => item.length > 0)
  .join(", ")}.`

export type AdapterFactory = {
  [K in keyof AdapterOptions]: (opts: AdapterOptions[K]) => ChannelAdapter
}

export const READY_CHANNELS = ChannelCatalog.map((item) => item.id)
export const PLANNED_CHANNELS: readonly ChannelName[] = []

function parsePort(value?: string) {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function have(values: Values) {
  return Object.values(values).some(Boolean)
}

function need(id: ChannelName) {
  return channelRequiredFields(id)
    .map((field) => field.env)
    .filter((field): field is string => Boolean(field))
    .join(", ")
}

function bool(value?: string): boolean | undefined {
  if (!value) return undefined
  const text = value.trim().toLowerCase()
  if (text === "1" || text === "true" || text === "yes" || text === "on") return true
  if (text === "0" || text === "false" || text === "no" || text === "off") return false
  return undefined
}

function build(id: ChannelName, create: AdapterFactory, values: Values) {
  switch (id) {
    case "slack":
      return create.slack({
        token: values.botToken!,
        appToken: values.appToken!,
        signingSecret: values.signingSecret,
      })
    case "telegram":
      return create.telegram({
        token: values.token!,
      })
    case "discord":
      return create.discord({
        token: values.token!,
      })
    case "feishu":
      return create.feishu({
        appId: values.appId!,
        appSecret: values.appSecret!,
        host: values.webhookHost,
        port: parsePort(values.webhookPort),
        path: values.webhookPath,
        verificationToken: values.verificationToken,
      })
    case "whatsapp":
      return create.whatsapp({
        token: values.token!,
        numberId: values.numberId!,
        host: values.webhookHost,
        port: parsePort(values.webhookPort),
        path: values.webhookPath,
        verifyToken: values.verifyToken,
      })
    case "googlechat":
      return create.googlechat({
        serviceAccount: values.serviceAccount!,
        host: values.webhookHost,
        port: parsePort(values.webhookPort),
        path: values.webhookPath,
      })
    case "msteams":
      return create.msteams({
        appId: values.appId!,
        appSecret: values.appSecret!,
        host: values.webhookHost,
        port: parsePort(values.webhookPort),
        path: values.webhookPath,
      })
    case "line":
      return create.line({
        token: values.token!,
        host: values.webhookHost,
        port: parsePort(values.webhookPort),
        path: values.webhookPath,
        secret: values.secret,
      })
    case "matrix":
      return create.matrix({
        homeserver: values.homeserver!,
        token: values.token!,
        since: values.since,
      })
    case "mattermost":
      return create.mattermost({
        url: values.url!,
        token: values.token!,
        host: values.webhookHost,
        port: parsePort(values.webhookPort),
        path: values.webhookPath,
      })
    case "signal":
      return create.signal({
        service: values.service!,
        account: values.account!,
      })
    case "wecom":
      return create.wecom({
        corpId: values.corpId!,
        secret: values.secret!,
        agentId: values.agentId!,
        host: values.webhookHost,
        port: parsePort(values.webhookPort),
        path: values.webhookPath,
      })
    case "dingtalk":
      return create.dingtalk({
        appKey: values.appKey!,
        appSecret: values.appSecret!,
        host: values.webhookHost,
        port: parsePort(values.webhookPort),
        path: values.webhookPath,
        defaultWebhook: values.defaultWebhook,
      })
    case "qq":
      return create.qq({
        appId: values.appId!,
        appSecret: values.appSecret!,
        host: values.webhookHost,
        port: parsePort(values.webhookPort),
        path: values.webhookPath,
        sandbox: bool(values.sandbox),
      })
  }
}

export function registerAdapters(
  runtime: { register(adapter: ChannelAdapter): unknown },
  env: Env = process.env,
  create: AdapterFactory,
) {
  const names: string[] = []
  const warns: string[] = []

  for (const item of ChannelCatalog) {
    const values = resolveChannel(item.id, undefined, env).values
    const missing = channelRequiredFields(item.id).filter((field) => !values[field.key])
    if (missing.length > 0) {
      if (have(values)) {
        warns.push(`Skip ${item.id} channel: missing required env. Need: ${need(item.id)}.`)
      }
      continue
    }
    runtime.register(build(item.id, create, values))
    names.push(item.id)
  }

  return { names, warns }
}
