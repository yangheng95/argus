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
  // Argus is a GUI automation agent — it MUST interact through the desktop GUI.
  // Deny all file-editing and shell tools to prevent the LLM from bypassing GUI.
  // If it needs to write code, it should open an editor (e.g. Claude, VS Code) via GUI.
  // If it needs to run a command, it should open a terminal via GUI.
  permission: {
    "*": "deny",
    screen: "allow",
    input: "allow",
    // Read-only tools for context understanding (no side effects)
    read: "allow",
    glob: "allow",
    grep: "allow",
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

// Auto-inject test prompt if TEST_PROMPT env var is set
if (process.env.TEST_PROMPT) {
  const channel = process.env.SLACK_CHANNEL_ID!
  console.log(`[Test] Injecting prompt into channel ${channel}`)
  bot.injectPrompt("slack", channel, process.env.TEST_PROMPT).catch((err) =>
    console.error("[Test] injectPrompt failed:", err),
  )
}
