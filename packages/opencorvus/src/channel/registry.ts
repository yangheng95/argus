import z from "zod"
import { slackConfig } from "./slack-config"

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
    fields: Field.array(),
  })

  export async function list() {
    const slack = await slackConfig()
    const hasBot = !!slack.botToken
    const hasApp = !!slack.appToken
    const status = !slack.enabled ? "disabled" : hasBot && hasApp ? "configured" : hasBot ? "partial" : "missing"
    const summary =
      status === "disabled"
        ? "Disabled"
        : status === "configured"
          ? "Inbound + outbound ready"
          : status === "partial"
            ? "Outbound mirror only"
            : "Not configured"

    return Info.array().parse([
      {
        id: "slack",
        name: "Slack",
        status,
        summary,
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
    ])
  }
}
