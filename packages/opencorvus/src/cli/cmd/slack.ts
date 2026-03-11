import { SlackGateway } from "@/channel/slack"
import { slackConfig } from "@/channel/slack-config"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"

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
    await bootstrap(process.cwd(), async () => {
      const slack = await slackConfig()
      const token = args.botToken ?? slack.botToken
      const appToken = args.appToken ?? slack.appToken
      const signingSecret = args.signingSecret ?? slack.signingSecret

      if (!token) throw new Error("Slack bot token is required")
      if (!appToken) throw new Error("Slack app token is required")

      const gateway = new SlackGateway({
        directory: process.cwd(),
        token,
        appToken,
        signingSecret,
      })
      await gateway.start()
      await new Promise(() => {})
    })
  },
})
