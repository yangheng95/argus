import { SlackAdapter } from "@opencode-ai/slack"
import { BotCore } from "./core"

const bot = new BotCore()
bot.register(
  new SlackAdapter({
    token: process.env.SLACK_BOT_TOKEN!,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    appToken: process.env.SLACK_APP_TOKEN!,
  }),
)
await bot.start()
console.log("Bot is running")
