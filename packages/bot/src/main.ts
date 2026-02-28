import { BotCore } from "./core"
import { SlackAdapter } from "./adapters/slack"

// Pass Argus config inline since the SDK spawns the server in packages/argus,
// which won't find the project-root .argus/ config directory.
process.env.ARGUS_CONFIG_CONTENT = JSON.stringify({
  model: "alibaba-cn/qwen3.5-plus",
  provider: {
    "alibaba-cn": {
      options: {
        baseURL: "https://coding.dashscope.aliyuncs.com/v1",
      },
    },
  },
  // Bot runs headless — auto-approve all tool permissions (no UI to confirm)
  permission: {
    input: "allow",
    screen: "allow",
    bash: "allow",
    edit: "allow",
    write: "allow",
  },
})

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
