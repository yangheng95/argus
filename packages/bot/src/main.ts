import { BotCore } from "./core"
import { SlackAdapter } from "./adapters/slack"
import { TelegramAdapter } from "./adapters/telegram"
import { DiscordAdapter } from "./adapters/discord"
import { STTPipeline } from "./stt/pipeline"
import { GroqProvider } from "./stt/providers/groq"
import { OpenAIWhisperProvider } from "./stt/providers/openai-whisper"
import { DeepgramProvider } from "./stt/providers/deepgram"
import { GoogleGeminiProvider } from "./stt/providers/google-gemini"
import { LocalCLIProvider } from "./stt/providers/local-cli"
import { VisionPipeline } from "./vision"
import { applyDashscopeRuntime } from "./dashscope"

const botPermission = {
  "*": "deny",
  doom_loop: "allow",
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
  planner: "allow",
  goal: "allow",
  vision_analyze: "allow",
  external_directory: "allow",
}

function inlineConfig() {
  if (!process.env.ARGUS_CONFIG_CONTENT) return {}
  try {
    const parsed = JSON.parse(process.env.ARGUS_CONFIG_CONTENT)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

const runtime = await applyDashscopeRuntime()
const activeKey = runtime.key
const useCodingPlan = runtime.useCodingPlan
const baseURL = runtime.baseURL

const config = inlineConfig()
const permission = config.permission
const permissionMap =
  permission && typeof permission === "object" && !Array.isArray(permission) ? (permission as Record<string, unknown>) : {}
process.env.ARGUS_CONFIG_CONTENT = JSON.stringify({
  ...config,
  permission: {
    ...permissionMap,
    ...botPermission,
  },
})

console.log("[Bot] Model/provider config source: argus auth + argus.json + ARGUS_CONFIG_CONTENT")
if (!activeKey) {
  console.log("[Bot] DashScope key not found in argus auth. Run: argus auth login (provider: alibaba-cn)")
}
if (activeKey) {
  const keyType = useCodingPlan ? "sk-sp-* (Coding Plan)" : "sk-* (DashScope)"
  const provider = runtime.authProvider ?? "unknown"
  const from = runtime.authPath ? `auth:${provider} @ ${runtime.authPath}` : `auth:${provider}`
  console.log(`[Bot] DashScope runtime: ${keyType}, baseURL: ${baseURL}, source: ${from}`)
}

const bot = new BotCore()

// --- STT Pipeline Setup ---
const sttPipeline = new STTPipeline({
  providers: (process.env.STT_PROVIDERS ?? "groq,openai-whisper,deepgram,google-gemini,local-cli").split(","),
  language: process.env.STT_LANGUAGE,
})
sttPipeline.register(
  new GroqProvider({
    apiKey: process.env.GROQ_API_KEY,
    model: process.env.STT_GROQ_MODEL,
    baseURL: process.env.STT_GROQ_BASE_URL,
  }),
)
sttPipeline.register(
  new OpenAIWhisperProvider({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.STT_OPENAI_MODEL,
    baseURL: process.env.STT_OPENAI_BASE_URL,
  }),
)
sttPipeline.register(
  new DeepgramProvider({
    apiKey: process.env.DEEPGRAM_API_KEY,
    model: process.env.STT_DEEPGRAM_MODEL,
    baseURL: process.env.STT_DEEPGRAM_BASE_URL,
  }),
)
sttPipeline.register(
  new GoogleGeminiProvider({
    apiKey: process.env.GOOGLE_API_KEY,
    model: process.env.STT_GOOGLE_MODEL,
    baseURL: process.env.STT_GOOGLE_BASE_URL,
  }),
)
sttPipeline.register(new LocalCLIProvider({ command: process.env.STT_LOCAL_COMMAND }))
await sttPipeline.init()
bot.setSTT(sttPipeline)

// --- Vision Pipeline Setup ---
if (activeKey) {
  const visionModel = process.env.ARGUS_VISION_MODEL
  if (visionModel) {
    bot.setVision(
      new VisionPipeline({
        apiKey: activeKey,
        baseURL,
        model: visionModel,
      }),
    )
    const keySource = useCodingPlan ? "argus auth (coding plan)" : "argus auth"
    console.log(`[Bot] Vision pipeline enabled (model: ${visionModel}, key: ${keySource}, baseURL: ${baseURL})`)
  } else {
    console.log("[Bot] Vision pipeline disabled (ARGUS_VISION_MODEL not set)")
  }
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

if (process.env.DISCORD_BOT_TOKEN) {
  bot.register(
    new DiscordAdapter({
      token: process.env.DISCORD_BOT_TOKEN,
    }),
  )
}

if (bot.adapterCount === 0) {
  console.error("No adapter configured. Set SLACK_BOT_TOKEN, TELEGRAM_BOT_TOKEN, or DISCORD_BOT_TOKEN.")
  process.exit(1)
}

await bot.start()
console.log("Bot is running")

// Auto-inject test prompt if TEST_PROMPT env var is set
if (process.env.TEST_PROMPT) {
  const channel = process.env.SLACK_CHANNEL_ID!
  console.log(`[Test] Injecting prompt into channel ${channel}`)
  bot.injectPrompt("slack", channel, process.env.TEST_PROMPT).catch((err) => console.error("[Test] injectPrompt failed:", err))
}
