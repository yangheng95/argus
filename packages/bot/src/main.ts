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
import * as readline from "readline"
import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"

// ─── Saved config (persists across restarts) ────────────────────────────────

interface SavedConfig {
  // LLM
  providerId?: string
  providerEnvKey?: string
  providerApiKey?: string
  model?: string
  visionModel?: string
  // Slack
  slackBotToken?: string
  slackAppToken?: string
  slackSigningSecret?: string
  slackChannelId?: string
  slackAllowedUserIds?: string
  // Telegram
  telegramBotToken?: string
}

function getConfigPath(): string {
  const home = os.homedir()
  if (process.platform === "win32") {
    const dir = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local")
    return path.join(dir, "argus", "bot-provider.json")
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), "argus", "bot-provider.json")
}

async function loadConfig(): Promise<SavedConfig | null> {
  try {
    return JSON.parse(await fs.readFile(getConfigPath(), "utf-8"))
  } catch {
    return null
  }
}

async function saveConfigFile(cfg: SavedConfig): Promise<void> {
  const p = getConfigPath()
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, JSON.stringify(cfg, null, 2), { mode: 0o600 })
}

async function deleteConfigFile(): Promise<void> {
  try { await fs.unlink(getConfigPath()) } catch {}
}

function applyConfig(cfg: SavedConfig): void {
  if (cfg.providerEnvKey && cfg.providerApiKey) process.env[cfg.providerEnvKey] = cfg.providerApiKey
  if (cfg.visionModel) process.env.ARGUS_VISION_MODEL = cfg.visionModel
  if (cfg.slackBotToken) process.env.SLACK_BOT_TOKEN = cfg.slackBotToken
  if (cfg.slackAppToken) process.env.SLACK_APP_TOKEN = cfg.slackAppToken
  if (cfg.slackSigningSecret) process.env.SLACK_SIGNING_SECRET = cfg.slackSigningSecret
  if (cfg.slackChannelId) process.env.SLACK_CHANNEL_ID = cfg.slackChannelId
  if (cfg.slackAllowedUserIds) process.env.SLACK_ALLOWED_USER_IDS = cfg.slackAllowedUserIds
  if (cfg.telegramBotToken) process.env.TELEGRAM_BOT_TOKEN = cfg.telegramBotToken
}

// ─── Provider list ──────────────────────────────────────────────────────────

const PROVIDERS = [
  { name: "Anthropic", id: "anthropic", envKey: "ANTHROPIC_API_KEY", defaultModel: "anthropic/claude-sonnet-4-20250514" },
  { name: "OpenAI", id: "openai", envKey: "OPENAI_API_KEY", defaultModel: "openai/gpt-4o" },
  { name: "Google", id: "google", envKey: "GOOGLE_GENERATIVE_AI_API_KEY", defaultModel: "google/gemini-2.5-pro" },
  { name: "DeepSeek", id: "deepseek", envKey: "DEEPSEEK_API_KEY", defaultModel: "deepseek/deepseek-chat" },
  { name: "Alibaba (China)", id: "alibaba-cn", envKey: "DASHSCOPE_API_KEY", defaultModel: "alibaba-cn/qwen3.5-plus" },
  { name: "OpenRouter", id: "openrouter", envKey: "OPENROUTER_API_KEY", defaultModel: "openrouter/anthropic/claude-sonnet-4" },
] as const

// ─── Interactive setup ──────────────────────────────────────────────────────

function ask(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((resolve, reject) => {
    rl.question(q, resolve)
    rl.once("close", () => reject(new Error("stdin closed")))
  })
}

async function interactiveSetup(): Promise<void> {
  const saved = await loadConfig()
  if (saved) applyConfig(saved)

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    console.log("\n\x1b[36m┌  Argus Bot Setup\x1b[0m")
    console.log("\x1b[36m│\x1b[0m")

    // Show saved
    if (saved?.providerId) {
      const pn = PROVIDERS.find((p) => p.id === saved.providerId)?.name ?? saved.providerId
      const platHint = [saved.slackBotToken && "slack ✓", saved.telegramBotToken && "telegram ✓"].filter(Boolean).join(", ")
      console.log(`\x1b[36m│\x1b[0m  \x1b[33mSaved:\x1b[0m ${pn} (${saved.model ?? "default"})${platHint ? ", " + platHint : ""}`)
    }

    // Show env status
    const configuredProviders = PROVIDERS.filter((p) => process.env[p.envKey])
    const envPlatforms = [process.env.SLACK_BOT_TOKEN && "Slack ✓", process.env.TELEGRAM_BOT_TOKEN && "Telegram ✓"].filter(Boolean)
    const envParts = [...configuredProviders.map((p) => p.name), ...envPlatforms]
    if (envParts.length > 0) {
      console.log(`\x1b[36m│\x1b[0m  \x1b[34mEnv:\x1b[0m ${envParts.join(", ")}`)
    }
    console.log("\x1b[36m│\x1b[0m")

    // ── LLM Provider ──
    const hasPlatform = !!(process.env.SLACK_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN)
    console.log(`\x1b[36m│\x1b[0m  \x1b[1m0\x1b[0m) ${saved?.providerId || hasPlatform ? "Keep current" : "Skip"}`)
    for (let i = 0; i < PROVIDERS.length; i++) {
      const p = PROVIDERS[i]
      const tag = process.env[p.envKey] ? " \x1b[32m✓\x1b[0m" : ""
      console.log(`\x1b[36m│\x1b[0m  \x1b[1m${i + 1}\x1b[0m) ${p.name}${tag}`)
    }
    if (saved) console.log(`\x1b[36m│\x1b[0m  \x1b[1mR\x1b[0m) \x1b[31mReset saved config\x1b[0m`)
    console.log("\x1b[36m│\x1b[0m")

    const choice = (await ask(rl, "\x1b[36m◆\x1b[0m  LLM provider [0]: ")).trim().toLowerCase()

    if (choice === "r" && saved) {
      await deleteConfigFile()
      console.log("\x1b[36m└\x1b[0m  \x1b[31mConfig deleted\x1b[0m\n")
      return
    }

    const idx = parseInt(choice || "0", 10)
    const cfg: SavedConfig = { ...(saved ?? {}) }
    let changed = false

    if (idx >= 1 && idx <= PROVIDERS.length) {
      const sel = PROVIDERS[idx - 1]
      const key = (await ask(rl, `\x1b[36m◆\x1b[0m  ${sel.name} API key: `)).trim()
      if (key) {
        process.env[sel.envKey] = key
        cfg.providerId = sel.id
        cfg.providerEnvKey = sel.envKey
        cfg.providerApiKey = key
        changed = true

        const m = (await ask(rl, `\x1b[36m◆\x1b[0m  LLM model [\x1b[2m${sel.defaultModel}\x1b[0m]: `)).trim()
        cfg.model = m || sel.defaultModel

        const cv = process.env.ARGUS_VISION_MODEL ?? "qwen3.5-plus"
        const v = (await ask(rl, `\x1b[36m◆\x1b[0m  Vision model [\x1b[2m${cv}\x1b[0m]: `)).trim()
        if (v) { cfg.visionModel = v; process.env.ARGUS_VISION_MODEL = v }
      }
    }

    // ── Chat Platform ──
    console.log("\x1b[36m│\x1b[0m")
    console.log("\x1b[36m│\x1b[0m  \x1b[1mChat Platform\x1b[0m")
    const hasSlackCfg = !!process.env.SLACK_BOT_TOKEN
    const hasTgCfg = !!process.env.TELEGRAM_BOT_TOKEN
    console.log(`\x1b[36m│\x1b[0m  \x1b[1m0\x1b[0m) Skip (keep current)`)
    console.log(`\x1b[36m│\x1b[0m  \x1b[1m1\x1b[0m) Slack${hasSlackCfg ? " \x1b[32m✓\x1b[0m" : ""}`)
    console.log(`\x1b[36m│\x1b[0m  \x1b[1m2\x1b[0m) Telegram${hasTgCfg ? " \x1b[32m✓\x1b[0m" : ""}`)
    console.log("\x1b[36m│\x1b[0m")

    const platChoice = parseInt((await ask(rl, "\x1b[36m◆\x1b[0m  Platform [0]: ")).trim() || "0", 10)

    if (platChoice === 1) {
      const sbt = (await ask(rl, `\x1b[36m◆\x1b[0m  SLACK_BOT_TOKEN: `)).trim()
      if (sbt) {
        process.env.SLACK_BOT_TOKEN = sbt
        cfg.slackBotToken = sbt
        changed = true

        const sat = (await ask(rl, `\x1b[36m◆\x1b[0m  SLACK_APP_TOKEN: `)).trim()
        if (sat) { process.env.SLACK_APP_TOKEN = sat; cfg.slackAppToken = sat }

        const sss = (await ask(rl, `\x1b[36m◆\x1b[0m  SLACK_SIGNING_SECRET (blank=skip): `)).trim()
        if (sss) { process.env.SLACK_SIGNING_SECRET = sss; cfg.slackSigningSecret = sss }

        const sch = (await ask(rl, `\x1b[36m◆\x1b[0m  SLACK_CHANNEL_ID (blank=skip): `)).trim()
        if (sch) { process.env.SLACK_CHANNEL_ID = sch; cfg.slackChannelId = sch }

        const sau = (await ask(rl, `\x1b[36m◆\x1b[0m  SLACK_ALLOWED_USER_IDS (e.g. U08CKA80BGS, blank=all): `)).trim()
        if (sau) {
          // Normalize: accept comma-separated or JSON array
          const ids = sau.startsWith("[") ? sau : JSON.stringify(sau.split(",").map((s) => s.trim()).filter(Boolean))
          process.env.SLACK_ALLOWED_USER_IDS = ids
          cfg.slackAllowedUserIds = ids
        }
      }
    } else if (platChoice === 2) {
      const tbt = (await ask(rl, `\x1b[36m◆\x1b[0m  TELEGRAM_BOT_TOKEN: `)).trim()
      if (tbt) {
        process.env.TELEGRAM_BOT_TOKEN = tbt
        cfg.telegramBotToken = tbt
        changed = true
      }
    }

    // ── Save ──
    if (changed) {
      await saveConfigFile(cfg)
      console.log(`\x1b[36m│\x1b[0m  \x1b[2mSaved: ${getConfigPath()}\x1b[0m`)
    }
    console.log("\x1b[36m└\x1b[0m  OK\n")
  } finally {
    rl.close()
  }
}

// ─── Run setup ──────────────────────────────────────────────────────────────

try {
  await interactiveSetup()
} catch (e) {
  console.error("[Setup] Interactive setup failed:", e instanceof Error ? e.message : e)
  // Non-interactive (piped stdin, CI, etc.) — still load saved config
  const saved = await loadConfig()
  if (saved) applyConfig(saved)
}

// ─── DashScope / provider setup ─────────────────────────────────────────────

if (!process.env.DASHSCOPE_API_KEY && process.env.CODING_DASHSCOPE_API_KEY) {
  process.env.DASHSCOPE_API_KEY = process.env.CODING_DASHSCOPE_API_KEY
}

// Build ARGUS_CONFIG_CONTENT from saved/env config
const savedCfg = await loadConfig()
const argusModel = savedCfg?.model ?? "alibaba-cn/qwen3.5-plus"
// Detect Coding Plan key (sk-sp-*) regardless of which env var it came from
const dashKey = process.env.DASHSCOPE_API_KEY ?? process.env.CODING_DASHSCOPE_API_KEY ?? ""
const isCodingPlanKey = !!process.env.CODING_DASHSCOPE_API_KEY || dashKey.startsWith("sk-sp-")
const argusProvider: Record<string, any> = {
  "alibaba-cn": {
    options: {
      baseURL: isCodingPlanKey
        ? "https://coding.dashscope.aliyuncs.com/v1"
        : "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
  },
}
if (savedCfg?.providerId && savedCfg.providerId !== "alibaba-cn") {
  argusProvider[savedCfg.providerId] = { options: {} }
}

process.env.ARGUS_CONFIG_CONTENT = JSON.stringify({
  model: argusModel,
  provider: argusProvider,
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
const dashscopeKey = process.env.DASHSCOPE_API_KEY ?? process.env.CODING_DASHSCOPE_API_KEY
if (dashscopeKey) {
  const visionModel = process.env.ARGUS_VISION_MODEL ?? "qwen3.5-plus"
  const visionIsCoding = !!process.env.CODING_DASHSCOPE_API_KEY || dashscopeKey.startsWith("sk-sp-")
  const baseURL = visionIsCoding
    ? "https://coding.dashscope.aliyuncs.com/v1"
    : "https://dashscope.aliyuncs.com/compatible-mode/v1"
  bot.setVision(new VisionPipeline({
    apiKey: dashscopeKey,
    baseURL,
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
