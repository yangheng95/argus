import z from "zod"
import { Config } from "@/config/config"
import { slackConfig } from "./slack-config"
import { ChannelSupervisor } from "./supervisor"

export namespace ChannelRegistry {
  export const Field = z.object({
    key: z.string(),
    label: z.string(),
    type: z.enum(["boolean", "text", "secret"]),
    placeholder: z.string().optional(),
  })

  export const Info = z.object({
    id: z.string(),
    name: z.string(),
    status: z.enum(["disabled", "configured", "partial", "missing"]),
    summary: z.string(),
    runtime_status: z.enum(["disabled", "unavailable", "starting", "running", "stopped", "error"]),
    runtime_detail: z.string(),
    fields: Field.array(),
  })

  export async function list() {
    const config = await Config.get()
    const slack = await slackConfig()
    const telegram = config.channel?.telegram
    const discord = config.channel?.discord
    const supervisor = await ChannelSupervisor.status()

    return Info.array().parse([
      {
        id: "slack",
        name: "Slack",
        ...channelStatus({
          enabled: slack.enabled,
          values: [slack.botToken, slack.appToken],
          configured: (vals) => vals.every(Boolean),
          partial: (vals) => vals.some(Boolean),
          summaries: {
            configured: "Inbound + outbound ready",
            partial: "Outbound mirror only",
          },
          runtime: channelRuntime(supervisor, "slack"),
        }),
        fields: [
          {
            key: "enabled",
            label: "Enable Slack",
            type: "boolean",
          },
          {
            key: "botToken",
            label: "Slack Bot Token",
            type: "secret",
            placeholder: "xoxb-...",
          },
          {
            key: "appToken",
            label: "Slack App Token",
            type: "secret",
            placeholder: "xapp-...",
          },
          {
            key: "signingSecret",
            label: "Signing Secret",
            type: "secret",
            placeholder: "Optional",
          },
        ],
      },
      {
        id: "telegram",
        name: "Telegram",
        ...channelStatus({
          enabled: telegram?.enabled !== false,
          values: [telegram?.token || process.env.TELEGRAM_BOT_TOKEN || process.env.OPENCLAW_TELEGRAM_BOT_TOKEN],
          configured: (vals) => vals.every(Boolean),
          partial: (vals) => vals.some(Boolean),
          summaries: {
            configured: "Bot runtime ready",
            partial: "Partially configured",
          },
          runtime: channelRuntime(supervisor, "telegram"),
        }),
        fields: [
          {
            key: "enabled",
            label: "Enable Telegram",
            type: "boolean",
          },
          {
            key: "token",
            label: "Telegram Bot Token",
            type: "secret",
            placeholder: "123456:ABC...",
          },
        ],
      },
      {
        id: "discord",
        name: "Discord",
        ...channelStatus({
          enabled: discord?.enabled !== false,
          values: [discord?.token || process.env.DISCORD_BOT_TOKEN],
          configured: (vals) => vals.every(Boolean),
          partial: (vals) => vals.some(Boolean),
          summaries: {
            configured: "Bot runtime ready",
            partial: "Partially configured",
          },
          runtime: channelRuntime(supervisor, "discord"),
        }),
        fields: [
          {
            key: "enabled",
            label: "Enable Discord",
            type: "boolean",
          },
          {
            key: "token",
            label: "Discord Bot Token",
            type: "secret",
            placeholder: "Discord token",
          },
        ],
      },
    ])
  }
}

function channelStatus(input: {
  enabled: boolean
  values: Array<string | undefined>
  configured: (values: Array<string | undefined>) => boolean
  partial: (values: Array<string | undefined>) => boolean
  summaries: {
    configured: string
    partial: string
  }
  runtime: {
    status: "disabled" | "unavailable" | "starting" | "running" | "stopped" | "error"
    detail: string
  }
}) {
  const status = !input.enabled
    ? "disabled"
    : input.configured(input.values)
      ? "configured"
      : input.partial(input.values)
        ? "partial"
        : "missing"
  const summary =
    status === "disabled"
      ? "Disabled"
      : status === "configured"
        ? input.summaries.configured
        : status === "partial"
          ? input.summaries.partial
          : "Not configured"
  return {
    status,
    summary,
    runtime_status: input.runtime.status,
    runtime_detail: input.runtime.detail,
  }
}

function channelRuntime(
  supervisor: Awaited<ReturnType<typeof ChannelSupervisor.status>>,
  channel: string,
) {
  if (supervisor.channels.includes(channel)) {
    return {
      status: supervisor.status,
      detail: supervisor.detail,
    } as const
  }
  return {
    status: supervisor.status === "unavailable" ? "unavailable" : "disabled",
    detail: supervisor.detail,
  } as const
}
