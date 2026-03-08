import { Config } from "@/config/config"

export async function slackConfig() {
  const config = await Config.get()
  const slack = config.channel?.slack
  const enabled = slack?.enabled !== false

  return {
    enabled,
    botToken: slack?.botToken || process.env.SLACK_BOT_TOKEN,
    appToken: slack?.appToken || process.env.SLACK_APP_TOKEN,
    signingSecret: slack?.signingSecret || process.env.SLACK_SIGNING_SECRET,
  }
}
