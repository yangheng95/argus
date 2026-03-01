import { BotCore } from "./core"
import { SlackAdapter } from "./adapters/slack"
import { TelegramAdapter } from "./adapters/telegram"
import { STTPipeline } from "./stt/pipeline"
import { GroqProvider } from "./stt/providers/groq"
import { OpenAIWhisperProvider } from "./stt/providers/openai-whisper"
import { DeepgramProvider } from "./stt/providers/deepgram"
import { GoogleGeminiProvider } from "./stt/providers/google-gemini"
import { LocalCLIProvider } from "./stt/providers/local-cli"
import { VisionPipeline } from "./vision"

// Ensure DASHSCOPE_API_KEY is set for the Argus alibaba-cn provider.
// Support both: DASHSCOPE_API_KEY (standard) and CODING_DASHSCOPE_API_KEY (Coding Plan).
// The Coding Plan key (sk-sp-*) uses a different baseURL (coding.dashscope.aliyuncs.com).
if (!process.env.DASHSCOPE_API_KEY && process.env.CODING_DASHSCOPE_API_KEY) {
  process.env.DASHSCOPE_API_KEY = process.env.CODING_DASHSCOPE_API_KEY
}

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
  permission: {
    "*": "deny",
    screen: "allow",
    input: "allow",
    bash: "allow",
    edit: "allow",
    write: "allow",
    read: "allow",
    glob: "allow",
    grep: "allow",
    skill: "allow",
    memory: "allow",
    schedule: "allow",
    external_directory: "allow",
  },
})

const bot = new BotCore()

// --- STT Pipeline Setup ---
const sttPipeline = new STTPipeline({
  providers: (process.env.STT_PROVIDERS ?? "groq,openai-whisper,deepgram,google-gemini,local-cli").split(","),
  language: process.env.STT_LANGUAGE,
})
sttPipeline.register(new GroqProvider({ apiKey: process.env.GROQ_API_KEY }))
sttPipeline.register(new OpenAIWhisperProvider({ apiKey: process.env.OPENAI_API_KEY }))
sttPipeline.register(new DeepgramProvider({ apiKey: process.env.DEEPGRAM_API_KEY }))
sttPipeline.register(new GoogleGeminiProvider({ apiKey: process.env.GOOGLE_API_KEY }))
sttPipeline.register(new LocalCLIProvider({ command: process.env.STT_LOCAL_COMMAND }))
await sttPipeline.init()
bot.setSTT(sttPipeline)

// --- Vision Pipeline Setup ---
// Support both key names: DASHSCOPE_API_KEY (standard) and CODING_DASHSCOPE_API_KEY (Coding Plan)
const dashscopeKey = process.env.DASHSCOPE_API_KEY ?? process.env.CODING_DASHSCOPE_API_KEY
if (dashscopeKey) {
  const visionModel = process.env.ARGUS_VISION_MODEL ?? "qwen3.5-plus"
  bot.setVision(new VisionPipeline({
    apiKey: dashscopeKey,
    baseURL: "https://coding.dashscope.aliyuncs.com/v1",
    model: visionModel,
  }))
  const keySource = process.env.DASHSCOPE_API_KEY ? "DASHSCOPE_API_KEY" : "CODING_DASHSCOPE_API_KEY"
  console.log(`[Bot] Vision pipeline enabled (model: ${visionModel}, key: ${keySource})`)
}

if (process.env.SLACK_BOT_TOKEN) {
  bot.register(
    new SlackAdapter({
      token: process.env.SLACK_BOT_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET,
      appToken: process.env.SLACK_APP_TOKEN!,
    }),
  )
}

if (process.env.TELEGRAM_BOT_TOKEN) {
  bot.register(
    new TelegramAdapter({
      token: process.env.TELEGRAM_BOT_TOKEN,
    }),
  )
}

if (bot.adapterCount === 0) {
  console.error("No adapter configured. Set SLACK_BOT_TOKEN or TELEGRAM_BOT_TOKEN.")
  process.exit(1)
}

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
