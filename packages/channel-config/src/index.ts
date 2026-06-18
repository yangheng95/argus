import z from "zod"

export const ChannelFieldType = z.enum(["boolean", "text", "secret"])
export const ChannelId = z.enum([
  "slack",
  "telegram",
  "discord",
  "feishu",
  "whatsapp",
  "googlechat",
  "msteams",
  "line",
  "matrix",
  "mattermost",
  "signal",
  "wecom",
  "dingtalk",
  "qq",
])
export const ChannelSurface = z.enum(["panel", "gateway", ...ChannelId.options])

export type ChannelName = z.infer<typeof ChannelId>
export type ChannelField = {
  key: string
  label: string
  type: z.infer<typeof ChannelFieldType>
  description: string
  placeholder?: string
  env?: string
  required?: boolean
}

type Spec = {
  id: ChannelName
  name: string
  fields: readonly ChannelField[]
  summaries: {
    configured: string
    partial: string
  }
}

function define(input: Spec) {
  return input
}

export const ChannelCatalog = [
  define({
    id: "slack",
    name: "Slack",
    summaries: {
      configured: "Managed runtime ready",
      partial: "Partially configured",
    },
    fields: [
      {
        key: "enabled",
        label: "Enable Slack",
        type: "boolean",
        description: "Enable Slack channel integration",
      },
      {
        key: "botToken",
        label: "Slack Bot Token",
        type: "secret",
        description: "Slack bot token",
        placeholder: "xoxb-...",
        env: "SLACK_BOT_TOKEN",
        required: true,
      },
      {
        key: "appToken",
        label: "Slack App Token",
        type: "secret",
        description: "Slack app token for Socket Mode",
        placeholder: "xapp-...",
        env: "SLACK_APP_TOKEN",
        required: true,
      },
      {
        key: "signingSecret",
        label: "Signing Secret",
        type: "secret",
        description: "Slack signing secret",
        placeholder: "Optional",
        env: "SLACK_SIGNING_SECRET",
      },
    ],
  }),
  define({
    id: "telegram",
    name: "Telegram",
    summaries: {
      configured: "Managed runtime ready",
      partial: "Partially configured",
    },
    fields: [
      {
        key: "enabled",
        label: "Enable Telegram",
        type: "boolean",
        description: "Enable Telegram channel integration",
      },
      {
        key: "token",
        label: "Telegram Bot Token",
        type: "secret",
        description: "Telegram bot token",
        placeholder: "123456:ABC...",
        env: "TELEGRAM_BOT_TOKEN",
        required: true,
      },
    ],
  }),
  define({
    id: "discord",
    name: "Discord",
    summaries: {
      configured: "Managed runtime ready",
      partial: "Partially configured",
    },
    fields: [
      {
        key: "enabled",
        label: "Enable Discord",
        type: "boolean",
        description: "Enable Discord channel integration",
      },
      {
        key: "token",
        label: "Discord Bot Token",
        type: "secret",
        description: "Discord bot token",
        placeholder: "Discord token",
        env: "DISCORD_BOT_TOKEN",
        required: true,
      },
    ],
  }),
  define({
    id: "feishu",
    name: "Feishu / Lark",
    summaries: {
      configured: "Managed runtime ready",
      partial: "Partially configured",
    },
    fields: [
      {
        key: "enabled",
        label: "Enable Feishu / Lark",
        type: "boolean",
        description: "Enable Feishu or Lark channel integration",
      },
      {
        key: "appId",
        label: "App ID",
        type: "secret",
        description: "Feishu or Lark app ID",
        placeholder: "cli_...",
        env: "FEISHU_APP_ID",
        required: true,
      },
      {
        key: "appSecret",
        label: "App Secret",
        type: "secret",
        description: "Feishu or Lark app secret",
        placeholder: "App secret",
        env: "FEISHU_APP_SECRET",
        required: true,
      },
      {
        key: "verificationToken",
        label: "Verification Token",
        type: "secret",
        description: "Optional Feishu or Lark webhook verification token",
        placeholder: "Optional",
        env: "FEISHU_VERIFICATION_TOKEN",
      },
      {
        key: "webhookHost",
        label: "Webhook Host",
        type: "text",
        description: "Optional Feishu or Lark webhook host",
        placeholder: "0.0.0.0",
        env: "FEISHU_WEBHOOK_HOST",
      },
      {
        key: "webhookPort",
        label: "Webhook Port",
        type: "text",
        description: "Optional Feishu or Lark webhook port",
        placeholder: "16666",
        env: "FEISHU_WEBHOOK_PORT",
      },
      {
        key: "webhookPath",
        label: "Webhook Path",
        type: "text",
        description: "Optional Feishu or Lark webhook path",
        placeholder: "/feishu",
        env: "FEISHU_WEBHOOK_PATH",
      },
    ],
  }),
  define({
    id: "whatsapp",
    name: "WhatsApp",
    summaries: {
      configured: "Managed runtime ready",
      partial: "Partially configured",
    },
    fields: [
      {
        key: "enabled",
        label: "Enable WhatsApp",
        type: "boolean",
        description: "Enable WhatsApp channel integration",
      },
      {
        key: "token",
        label: "Access Token",
        type: "secret",
        description: "WhatsApp Cloud API access token",
        placeholder: "EAAG...",
        env: "WHATSAPP_ACCESS_TOKEN",
        required: true,
      },
      {
        key: "numberId",
        label: "Phone Number ID",
        type: "secret",
        description: "WhatsApp Cloud API phone number ID",
        placeholder: "Phone number ID",
        env: "WHATSAPP_PHONE_NUMBER_ID",
        required: true,
      },
      {
        key: "appSecret",
        label: "App Secret",
        type: "secret",
        description: "WhatsApp Meta app secret used to verify webhook signatures",
        placeholder: "App secret",
        env: "WHATSAPP_APP_SECRET",
        required: true,
      },
      {
        key: "verifyToken",
        label: "Verify Token",
        type: "secret",
        description: "WhatsApp webhook verification token",
        placeholder: "Verify token",
        env: "WHATSAPP_VERIFY_TOKEN",
        required: true,
      },
      {
        key: "webhookHost",
        label: "Webhook Host",
        type: "text",
        description: "Optional WhatsApp webhook host",
        placeholder: "0.0.0.0",
        env: "WHATSAPP_WEBHOOK_HOST",
      },
      {
        key: "webhookPort",
        label: "Webhook Port",
        type: "text",
        description: "Optional WhatsApp webhook port",
        placeholder: "16667",
        env: "WHATSAPP_WEBHOOK_PORT",
      },
      {
        key: "webhookPath",
        label: "Webhook Path",
        type: "text",
        description: "Optional WhatsApp webhook path",
        placeholder: "/whatsapp",
        env: "WHATSAPP_WEBHOOK_PATH",
      },
    ],
  }),
  define({
    id: "googlechat",
    name: "Google Chat",
    summaries: {
      configured: "Managed runtime ready",
      partial: "Partially configured",
    },
    fields: [
      {
        key: "enabled",
        label: "Enable Google Chat",
        type: "boolean",
        description: "Enable Google Chat integration",
      },
      {
        key: "serviceAccount",
        label: "Service Account JSON",
        type: "secret",
        description: "Google Chat service account JSON or path",
        placeholder: "JSON or file path",
        env: "GOOGLECHAT_SERVICE_ACCOUNT_JSON",
        required: true,
      },
      {
        key: "authAudience",
        label: "Auth Audience",
        type: "secret",
        description: "Google Chat request token audience, usually the HTTPS endpoint URL",
        placeholder: "https://example.com/googlechat",
        env: "GOOGLECHAT_AUTH_AUDIENCE",
        required: true,
      },
      {
        key: "webhookHost",
        label: "Webhook Host",
        type: "text",
        description: "Optional Google Chat webhook host",
        placeholder: "0.0.0.0",
        env: "GOOGLECHAT_WEBHOOK_HOST",
      },
      {
        key: "webhookPort",
        label: "Webhook Port",
        type: "text",
        description: "Optional Google Chat webhook port",
        placeholder: "16668",
        env: "GOOGLECHAT_WEBHOOK_PORT",
      },
      {
        key: "webhookPath",
        label: "Webhook Path",
        type: "text",
        description: "Optional Google Chat webhook path",
        placeholder: "/googlechat",
        env: "GOOGLECHAT_WEBHOOK_PATH",
      },
    ],
  }),
  define({
    id: "msteams",
    name: "Microsoft Teams",
    summaries: {
      configured: "Managed runtime ready",
      partial: "Partially configured",
    },
    fields: [
      {
        key: "enabled",
        label: "Enable Microsoft Teams",
        type: "boolean",
        description: "Enable Microsoft Teams integration",
      },
      {
        key: "appId",
        label: "App ID",
        type: "secret",
        description: "Microsoft Teams bot app ID",
        placeholder: "Application ID",
        env: "MSTEAMS_APP_ID",
        required: true,
      },
      {
        key: "appSecret",
        label: "App Secret",
        type: "secret",
        description: "Microsoft Teams bot app secret",
        placeholder: "App secret",
        env: "MSTEAMS_APP_SECRET",
        required: true,
      },
      {
        key: "webhookHost",
        label: "Webhook Host",
        type: "text",
        description: "Optional Microsoft Teams webhook host",
        placeholder: "0.0.0.0",
        env: "MSTEAMS_WEBHOOK_HOST",
      },
      {
        key: "webhookPort",
        label: "Webhook Port",
        type: "text",
        description: "Optional Microsoft Teams webhook port",
        placeholder: "16669",
        env: "MSTEAMS_WEBHOOK_PORT",
      },
      {
        key: "webhookPath",
        label: "Webhook Path",
        type: "text",
        description: "Optional Microsoft Teams webhook path",
        placeholder: "/msteams",
        env: "MSTEAMS_WEBHOOK_PATH",
      },
    ],
  }),
  define({
    id: "line",
    name: "LINE",
    summaries: {
      configured: "Managed runtime ready",
      partial: "Partially configured",
    },
    fields: [
      {
        key: "enabled",
        label: "Enable LINE",
        type: "boolean",
        description: "Enable LINE integration",
      },
      {
        key: "token",
        label: "Channel Access Token",
        type: "secret",
        description: "LINE channel access token",
        placeholder: "Channel access token",
        env: "LINE_CHANNEL_ACCESS_TOKEN",
        required: true,
      },
      {
        key: "secret",
        label: "Channel Secret",
        type: "secret",
        description: "LINE channel secret for webhook verification",
        placeholder: "Channel secret",
        env: "LINE_CHANNEL_SECRET",
        required: true,
      },
      {
        key: "webhookHost",
        label: "Webhook Host",
        type: "text",
        description: "Optional LINE webhook host",
        placeholder: "0.0.0.0",
        env: "LINE_WEBHOOK_HOST",
      },
      {
        key: "webhookPort",
        label: "Webhook Port",
        type: "text",
        description: "Optional LINE webhook port",
        placeholder: "16670",
        env: "LINE_WEBHOOK_PORT",
      },
      {
        key: "webhookPath",
        label: "Webhook Path",
        type: "text",
        description: "Optional LINE webhook path",
        placeholder: "/line",
        env: "LINE_WEBHOOK_PATH",
      },
    ],
  }),
  define({
    id: "matrix",
    name: "Matrix",
    summaries: {
      configured: "Managed runtime ready",
      partial: "Partially configured",
    },
    fields: [
      {
        key: "enabled",
        label: "Enable Matrix",
        type: "boolean",
        description: "Enable Matrix integration",
      },
      {
        key: "homeserver",
        label: "Homeserver URL",
        type: "text",
        description: "Matrix homeserver URL",
        placeholder: "https://matrix.example.com",
        env: "MATRIX_HOMESERVER_URL",
        required: true,
      },
      {
        key: "token",
        label: "Access Token",
        type: "secret",
        description: "Matrix access token",
        placeholder: "Matrix token",
        env: "MATRIX_ACCESS_TOKEN",
        required: true,
      },
      {
        key: "since",
        label: "Since Token",
        type: "secret",
        description: "Optional Matrix sync token",
        placeholder: "Optional",
        env: "MATRIX_SINCE_TOKEN",
      },
    ],
  }),
  define({
    id: "mattermost",
    name: "Mattermost",
    summaries: {
      configured: "Managed runtime ready",
      partial: "Partially configured",
    },
    fields: [
      {
        key: "enabled",
        label: "Enable Mattermost",
        type: "boolean",
        description: "Enable Mattermost integration",
      },
      {
        key: "url",
        label: "Server URL",
        type: "text",
        description: "Mattermost server URL",
        placeholder: "https://mattermost.example.com",
        env: "MATTERMOST_SERVER_URL",
        required: true,
      },
      {
        key: "token",
        label: "Bot Token",
        type: "secret",
        description: "Mattermost bot token",
        placeholder: "Mattermost token",
        env: "MATTERMOST_BOT_TOKEN",
        required: true,
      },
      {
        key: "webhookToken",
        label: "Webhook Token",
        type: "secret",
        description: "Mattermost outgoing webhook token used to verify inbound requests",
        placeholder: "Outgoing webhook token",
        env: "MATTERMOST_WEBHOOK_TOKEN",
        required: true,
      },
      {
        key: "webhookHost",
        label: "Webhook Host",
        type: "text",
        description: "Optional Mattermost webhook host",
        placeholder: "0.0.0.0",
        env: "MATTERMOST_WEBHOOK_HOST",
      },
      {
        key: "webhookPort",
        label: "Webhook Port",
        type: "text",
        description: "Optional Mattermost webhook port",
        placeholder: "16671",
        env: "MATTERMOST_WEBHOOK_PORT",
      },
      {
        key: "webhookPath",
        label: "Webhook Path",
        type: "text",
        description: "Optional Mattermost webhook path",
        placeholder: "/mattermost",
        env: "MATTERMOST_WEBHOOK_PATH",
      },
    ],
  }),
  define({
    id: "signal",
    name: "Signal",
    summaries: {
      configured: "Managed runtime ready",
      partial: "Partially configured",
    },
    fields: [
      {
        key: "enabled",
        label: "Enable Signal",
        type: "boolean",
        description: "Enable Signal integration",
      },
      {
        key: "service",
        label: "Service URL",
        type: "text",
        description: "Signal service URL",
        placeholder: "http://localhost:8080",
        env: "SIGNAL_SERVICE_URL",
        required: true,
      },
      {
        key: "account",
        label: "Account",
        type: "text",
        description: "Signal sender account or number",
        placeholder: "+1234567890",
        env: "SIGNAL_ACCOUNT",
        required: true,
      },
    ],
  }),
  define({
    id: "wecom",
    name: "WeCom",
    summaries: {
      configured: "Managed runtime ready",
      partial: "Partially configured",
    },
    fields: [
      {
        key: "enabled",
        label: "Enable WeCom",
        type: "boolean",
        description: "Enable WeCom integration",
      },
      {
        key: "corpId",
        label: "Corp ID",
        type: "secret",
        description: "WeCom corp ID",
        placeholder: "Corp ID",
        env: "WECOM_CORP_ID",
        required: true,
      },
      {
        key: "secret",
        label: "Secret",
        type: "secret",
        description: "WeCom app secret",
        placeholder: "App secret",
        env: "WECOM_SECRET",
        required: true,
      },
      {
        key: "agentId",
        label: "Agent ID",
        type: "secret",
        description: "WeCom agent ID",
        placeholder: "1000002",
        env: "WECOM_AGENT_ID",
        required: true,
      },
      {
        key: "token",
        label: "Callback Token",
        type: "secret",
        description: "WeCom receive-message callback token",
        placeholder: "Callback token",
        env: "WECOM_CALLBACK_TOKEN",
        required: true,
      },
      {
        key: "encodingAesKey",
        label: "EncodingAESKey",
        type: "secret",
        description: "WeCom receive-message callback EncodingAESKey",
        placeholder: "43-character EncodingAESKey",
        env: "WECOM_ENCODING_AES_KEY",
        required: true,
      },
      {
        key: "webhookHost",
        label: "Webhook Host",
        type: "text",
        description: "Optional WeCom webhook host",
        placeholder: "0.0.0.0",
        env: "WECOM_WEBHOOK_HOST",
      },
      {
        key: "webhookPort",
        label: "Webhook Port",
        type: "text",
        description: "Optional WeCom webhook port",
        placeholder: "16672",
        env: "WECOM_WEBHOOK_PORT",
      },
      {
        key: "webhookPath",
        label: "Webhook Path",
        type: "text",
        description: "Optional WeCom webhook path",
        placeholder: "/wecom",
        env: "WECOM_WEBHOOK_PATH",
      },
    ],
  }),
  define({
    id: "dingtalk",
    name: "DingTalk",
    summaries: {
      configured: "Managed runtime ready",
      partial: "Partially configured",
    },
    fields: [
      {
        key: "enabled",
        label: "Enable DingTalk",
        type: "boolean",
        description: "Enable DingTalk integration",
      },
      {
        key: "appKey",
        label: "App Key",
        type: "secret",
        description: "DingTalk app key",
        placeholder: "App key",
        env: "DINGTALK_APP_KEY",
        required: true,
      },
      {
        key: "appSecret",
        label: "App Secret",
        type: "secret",
        description: "DingTalk app secret",
        placeholder: "App secret",
        env: "DINGTALK_APP_SECRET",
        required: true,
      },
      {
        key: "callbackToken",
        label: "Callback Token",
        type: "secret",
        description: "DingTalk callback token",
        placeholder: "Callback token",
        env: "DINGTALK_CALLBACK_TOKEN",
        required: true,
      },
      {
        key: "encodingAesKey",
        label: "EncodingAESKey",
        type: "secret",
        description: "DingTalk callback EncodingAESKey",
        placeholder: "43-character EncodingAESKey",
        env: "DINGTALK_ENCODING_AES_KEY",
        required: true,
      },
      {
        key: "defaultWebhook",
        label: "Default Webhook",
        type: "secret",
        description: "Optional DingTalk default session webhook",
        placeholder: "Optional",
        env: "DINGTALK_DEFAULT_WEBHOOK",
      },
      {
        key: "webhookHost",
        label: "Webhook Host",
        type: "text",
        description: "Optional DingTalk webhook host",
        placeholder: "0.0.0.0",
        env: "DINGTALK_WEBHOOK_HOST",
      },
      {
        key: "webhookPort",
        label: "Webhook Port",
        type: "text",
        description: "Optional DingTalk webhook port",
        placeholder: "16673",
        env: "DINGTALK_WEBHOOK_PORT",
      },
      {
        key: "webhookPath",
        label: "Webhook Path",
        type: "text",
        description: "Optional DingTalk webhook path",
        placeholder: "/dingtalk",
        env: "DINGTALK_WEBHOOK_PATH",
      },
    ],
  }),
  define({
    id: "qq",
    name: "QQ Bot",
    summaries: {
      configured: "Managed runtime ready",
      partial: "Partially configured",
    },
    fields: [
      {
        key: "enabled",
        label: "Enable QQ Bot",
        type: "boolean",
        description: "Enable QQ Bot channel integration",
      },
      {
        key: "appId",
        label: "App ID",
        type: "secret",
        description: "QQ Bot app ID from q.qq.com",
        placeholder: "QQ Bot app ID",
        env: "QQ_BOT_APP_ID",
        required: true,
      },
      {
        key: "appSecret",
        label: "App Secret",
        type: "secret",
        description: "QQ Bot app secret used for access token and webhook signatures",
        placeholder: "QQ Bot app secret",
        env: "QQ_BOT_APP_SECRET",
        required: true,
      },
      {
        key: "sandbox",
        label: "Sandbox",
        type: "text",
        description: "Optional sandbox flag, set to 1 or true to use sandbox.api.sgroup.qq.com",
        placeholder: "Optional: 1",
        env: "QQ_SANDBOX",
      },
      {
        key: "webhookHost",
        label: "Webhook Host",
        type: "text",
        description: "Optional QQ Bot webhook host",
        placeholder: "0.0.0.0",
        env: "QQ_WEBHOOK_HOST",
      },
      {
        key: "webhookPort",
        label: "Webhook Port",
        type: "text",
        description: "Optional QQ Bot webhook port",
        placeholder: "16674",
        env: "QQ_WEBHOOK_PORT",
      },
      {
        key: "webhookPath",
        label: "Webhook Path",
        type: "text",
        description: "Optional QQ Bot webhook path",
        placeholder: "/qqbot",
        env: "QQ_WEBHOOK_PATH",
      },
    ],
  }),
] as const

export function channelInfo(id: ChannelName) {
  const result = ChannelCatalog.find((item) => item.id === id)
  if (!result) throw new Error(`Unknown channel: ${id}`)
  return result
}

export function channelRequiredFields(id: ChannelName) {
  return channelInfo(id).fields.filter((field) => field.required && field.env)
}

export function buildChannelSchema(id: ChannelName, ref: string) {
  const shape = Object.fromEntries(
    channelInfo(id).fields.map((field) => [
      field.key,
      field.type === "boolean"
        ? z.boolean().optional().describe(field.description)
        : z.string().optional().describe(field.description),
    ]),
  ) as Record<string, z.ZodTypeAny>
  return z.object(shape).strict().meta({ ref })
}

function text(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return undefined
}

export function resolveChannel(
  id: ChannelName,
  raw: Record<string, unknown> | undefined,
  env: Record<string, string | undefined> = process.env,
) {
  const info = channelInfo(id)
  const values = info.fields.reduce<Record<string, string | undefined>>((acc, field) => {
    if (!field.env) return acc
    acc[field.key] = text(raw?.[field.key], env[field.env])
    return acc
  }, {})
  return {
    enabled: raw?.enabled !== false,
    values,
  }
}

export function channelState(
  id: ChannelName,
  raw: Record<string, unknown> | undefined,
  env: Record<string, string | undefined> = process.env,
) {
  const info = channelInfo(id)
  const resolved = resolveChannel(id, raw, env)
  const required = info.fields.filter((field) => field.required).map((field) => resolved.values[field.key])
  const configured = required.length > 0 && required.every(Boolean)
  const partial = Object.values(resolved.values).some(Boolean)
  const status = !resolved.enabled ? "disabled" : configured ? "configured" : partial ? "partial" : "missing"
  const summary =
    status === "disabled"
      ? "Disabled"
      : status === "configured"
        ? info.summaries.configured
        : status === "partial"
          ? info.summaries.partial
          : "Not configured"
  return {
    ...resolved,
    status,
    summary,
  }
}

export function channelEnv(
  id: ChannelName,
  raw: Record<string, unknown> | undefined,
  env: Record<string, string | undefined> = process.env,
) {
  const info = channelInfo(id)
  const resolved = channelState(id, raw, env)
  if (!resolved.enabled || resolved.status !== "configured") return
  return info.fields.reduce<Record<string, string>>((acc, field) => {
    if (!field.env) return acc
    const value = resolved.values[field.key]
    if (!value) return acc
    acc[field.env] = value
    return acc
  }, {})
}
