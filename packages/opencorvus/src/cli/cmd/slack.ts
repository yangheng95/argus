import { SlackGateway } from "@/channel/slack"
import { cmd } from "./cmd"

export const SlackCommand = cmd({
  command: "slack",
  describe: "starts the headless Slack gateway",
  builder: (yargs) =>
    yargs
      .option("bot-token", {
        type: "string",
        describe: "Slack bot token (defaults to SLACK_BOT_TOKEN)",
      })
      .option("app-token", {
        type: "string",
        describe: "Slack app token for Socket Mode (defaults to SLACK_APP_TOKEN)",
      })
      .option("signing-secret", {
        type: "string",
        describe: "Slack signing secret (defaults to SLACK_SIGNING_SECRET)",
      }),
  handler: async (args) => {
    const token = args.botToken ?? process.env.SLACK_BOT_TOKEN
    const appToken = args.appToken ?? process.env.SLACK_APP_TOKEN
    const signingSecret = args.signingSecret ?? process.env.SLACK_SIGNING_SECRET

    if (!token) throw new Error("SLACK_BOT_TOKEN is required")
    if (!appToken) throw new Error("SLACK_APP_TOKEN is required")

    const gateway = new SlackGateway({
      directory: process.cwd(),
      token,
      appToken,
      signingSecret,
    })
    await gateway.start()
    await new Promise(() => {})
  },
})
