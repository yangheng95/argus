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
import * as readline from "readline"
import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"

// ─── Provider selection at startup ───────────────────────────────────────────

interface ProviderOption {
  name: string
  id: string
  envKey: string
  defaultModel: string
  baseURL?: string
}

const PROVIDERS: ProviderOption[] = [
  { name: "Anthropic", id: "anthropic", envKey: "ANTHROPIC_API_KEY", defaultModel: "anthropic/claude-sonnet-4-20250514" },
  { name: "OpenAI", id: "openai", envKey: "OPENAI_API_KEY", defaultModel: "openai/gpt-4o" },
  { name: "Google", id: "google", envKey: "GOOGLE_GENERATIVE_AI_API_KEY", defaultModel: "google/gemini-2.5-pro" },
  { name: "DeepSeek", id: "deepseek", envKey: "DEEPSEEK_API_KEY", defaultModel: "deepseek/deepseek-chat" },
  { name: "Alibaba (China)", id: "alibaba-cn", envKey: "DASHSCOPE_API_KEY", defaultModel: "alibaba-cn/qwen3.5-plus" },
  { name: "OpenRouter", id: "openrouter", envKey: "OPENROUTER_API_KEY", defaultModel: "openrouter/anthropic/claude-sonnet-4" },
]

function rlQuestion(rl: readline.Interface, query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve))
}

interface PromptResult {
  model: string
  providerId: string
  providerOptions: Record<string, any>
  visionModel?: string
}

// ─── Persistent config (survives restart) ─────────────────────────────────────

interface SavedProviderConfig {
  providerId: string
  envKey: string
  apiKey: string
  model: string
  visionModel?: string
  // Slack tokens
  slackBotToken?: string
  slackAppToken?: string
  slackSigningSecret?: string
}

function getConfigPath(): string {
  const home = os.homedir()
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local")
    return path.join(localAppData, "argus", "bot-provider.json")
  }
  const xdgData = process.env.XDG_DATA_HOME || path.join(home, ".local", "share")
  return path.join(xdgData, "argus", "bot-provider.json")
}

async function loadSavedConfig(): Promise<SavedProviderConfig | null> {
  try {
    const raw = await fs.readFile(getConfigPath(), "utf-8")
    return JSON.parse(raw) as SavedProviderConfig
  } catch {
    return null
  }
}

async function saveConfig(config: SavedProviderConfig): Promise<void> {
  const configPath = getConfigPath()
  await fs.mkdir(path.dirname(configPath), { recursive: true })
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 })
}

async function deleteConfig(): Promise<void> {
  try {
    await fs.unlink(getConfigPath())
  } catch {}
}

function buildProviderOptions(providerId: string): Record<string, any> {
  const opts: Record<string, any> = {}
  if (providerId === "alibaba-cn") {
    const ck = process.env.CODING_DASHSCOPE_API_KEY
    opts.baseURL = ck
      ? "https://coding.dashscope.aliyuncs.com/v1"
      : "https://dashscope.aliyuncs.com/compatible-mode/v1"
  }
  return opts
}

// ─── Provider prompt ──────────────────────────────────────────────────────────

async function promptProviderSelection(): Promise<PromptResult | null> {
  // 1. Load saved config and apply to env immediately (so "skip" still works)
  const saved = await loadSavedConfig()
  if (saved) {
    process.env[saved.envKey] = saved.apiKey
    if (saved.visionModel) process.env.ARGUS_VISION_MODEL = saved.visionModel
    if (saved.slackBotToken) process.env.SLACK_BOT_TOKEN = saved.slackBotToken
    if (saved.slackAppToken) process.env.SLACK_APP_TOKEN = saved.slackAppToken
    if (saved.slackSigningSecret) process.env.SLACK_SIGNING_SECRET = saved.slackSigningSecret
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    console.log("\n\x1b[36m┌  Argus Bot Configuration\x1b[0m")
    console.log("\x1b[36m│\x1b[0m")

    // Show saved config
    if (saved) {
      const name = PROVIDERS.find((p) => p.id === saved.providerId)?.name ?? saved.providerId
      const visionHint = saved.visionModel ? `, vision: ${saved.visionModel}` : ""
      const slackHint = saved.slackBotToken ? ", slack: configured" : ""
      console.log(`\x1b[36m│\x1b[0m  \x1b[33mSaved:\x1b[0m ${name} (${saved.model}${visionHint}${slackHint})`)
      console.log(`\x1b[36m│\x1b[0m  \x1b[2mConfig: ${getConfigPath()}\x1b[0m`)
      console.log("\x1b[36m│\x1b[0m")
    }

    // Show env-configured providers
    const configured = PROVIDERS.filter((p) => process.env[p.envKey])
    if (configured.length > 0) {
      console.log(`\x1b[36m│\x1b[0m  \x1b[34mConfigured:\x1b[0m ${configured.map((p) => p.name).join(", ")}`)
      console.log("\x1b[36m│\x1b[0m")
    }

    // ── Step 1: LLM Provider ──
    console.log("\x1b[36m│\x1b[0m  \x1b[1mLLM Provider\x1b[0m")
    console.log(`\x1b[36m│\x1b[0m  \x1b[1m0\x1b[0m) ${saved ? "Keep saved" : "Skip (use env/defaults)"}`)
    for (let i = 0; i < PROVIDERS.length; i++) {
      const p = PROVIDERS[i]
      const tag = process.env[p.envKey] ? " \x1b[32m✓\x1b[0m" : ""
      console.log(`\x1b[36m│\x1b[0m  \x1b[1m${i + 1}\x1b[0m) ${p.name}${tag}  \x1b[2m${p.envKey}\x1b[0m`)
    }
    if (saved) {
      console.log(`\x1b[36m│\x1b[0m  \x1b[1mR\x1b[0m) \x1b[31mReset (delete all saved config)\x1b[0m`)
    }
    console.log("\x1b[36m│\x1b[0m")

    const choice = await rlQuestion(rl, "\x1b[36m◆\x1b[0m  Select provider [0]: ")
    const trimmed = choice.trim().toLowerCase()

    // ── Reset saved config ──
    if (trimmed === "r" && saved) {
      await deleteConfig()
      console.log(`\x1b[36m│\x1b[0m  \x1b[31mSaved configuration deleted\x1b[0m`)
      console.log(`\x1b[36m└\x1b[0m\n`)
      return null
    }

    const idx = parseInt(trimmed || "0", 10)

    // Track what we'll save
    let providerId = saved?.providerId ?? ""
    let envKey = saved?.envKey ?? ""
    let apiKey = saved?.apiKey ?? ""
    let model = saved?.model ?? ""
    let visionModel = saved?.visionModel
    let slackBotToken = saved?.slackBotToken
    let slackAppToken = saved?.slackAppToken
    let slackSigningSecret = saved?.slackSigningSecret
    let result: PromptResult | null = null
    let dirty = false // track if anything changed

    if (idx === 0 || isNaN(idx) || idx > PROVIDERS.length) {
      // ── Keep existing LLM ──
      if (saved) {
        console.log("\x1b[36m│\x1b[0m  LLM: keeping saved config")
        result = {
          model: saved.model,
          providerId: saved.providerId,
          providerOptions: buildProviderOptions(saved.providerId),
          visionModel: saved.visionModel,
        }
      } else {
        console.log("\x1b[36m│\x1b[0m  LLM: using env/defaults")
      }
    } else {
      // ── New LLM provider ──
      const selected = PROVIDERS[idx - 1]
      const apiKeyInput = await rlQuestion(rl, `\x1b[36m◆\x1b[0m  API key for ${selected.name}: `)

      if (apiKeyInput.trim()) {
        process.env[selected.envKey] = apiKeyInput.trim()
        providerId = selected.id
        envKey = selected.envKey
        apiKey = apiKeyInput.trim()
        dirty = true

        const modelInput = await rlQuestion(
          rl,
          `\x1b[36m◆\x1b[0m  LLM model [\x1b[2m${selected.defaultModel}\x1b[0m]: `,
        )
        model = modelInput.trim() || selected.defaultModel

        const currentVision = process.env.ARGUS_VISION_MODEL ?? "qwen3.5-plus"
        const visionInput = await rlQuestion(
          rl,
          `\x1b[36m◆\x1b[0m  Vision model [\x1b[2m${currentVision}\x1b[0m]: `,
        )
        visionModel = visionInput.trim() || undefined

        result = {
          model,
          providerId: selected.id,
          providerOptions: buildProviderOptions(selected.id),
          visionModel,
        }
      } else {
        console.log("\x1b[36m│\x1b[0m  No key entered, keeping existing LLM config")
        if (saved) {
          result = {
            model: saved.model,
            providerId: saved.providerId,
            providerOptions: buildProviderOptions(saved.providerId),
            visionModel: saved.visionModel,
          }
        }
      }
    }

    // ── Step 2: Slack Configuration (always asked) ──
    console.log("\x1b[36m│\x1b[0m")
    console.log("\x1b[36m│\x1b[0m  \x1b[1mSlack Configuration\x1b[0m (leave blank to keep current)")
    const currentSlackBot = process.env.SLACK_BOT_TOKEN
    const slackStatus = currentSlackBot ? " \x1b[32m✓ configured\x1b[0m" : " \x1b[2mnot set\x1b[0m"
    const slackBotInput = await rlQuestion(
      rl,
      `\x1b[36m◆\x1b[0m  SLACK_BOT_TOKEN${slackStatus}: `,
    )

    if (slackBotInput.trim()) {
      slackBotToken = slackBotInput.trim()
      process.env.SLACK_BOT_TOKEN = slackBotToken
      dirty = true

      const appTokenInput = await rlQuestion(rl, `\x1b[36m◆\x1b[0m  SLACK_APP_TOKEN: `)
      slackAppToken = appTokenInput.trim() || slackAppToken
      if (slackAppToken) process.env.SLACK_APP_TOKEN = slackAppToken

      const signingInput = await rlQuestion(rl, `\x1b[36m◆\x1b[0m  SLACK_SIGNING_SECRET: `)
      slackSigningSecret = signingInput.trim() || slackSigningSecret
      if (slackSigningSecret) process.env.SLACK_SIGNING_SECRET = slackSigningSecret
    }

    // ── Persist if anything changed ──
    if (dirty && providerId && apiKey) {
      await saveConfig({
        providerId,
        envKey,
        apiKey,
        model,
        visionModel,
        slackBotToken,
        slackAppToken,
        slackSigningSecret,
      })
      console.log("\x1b[36m│\x1b[0m")
      console.log(`\x1b[36m│\x1b[0m  LLM:    ${model || "(env default)"}`)
      console.log(`\x1b[36m│\x1b[0m  Vision: ${visionModel ?? process.env.ARGUS_VISION_MODEL ?? "qwen3.5-plus"}`)
      console.log(`\x1b[36m│\x1b[0m  Slack:  ${slackBotToken ? "\x1b[32mconfigured\x1b[0m" : "\x1b[2mnot set\x1b[0m"}`)
      console.log(`\x1b[36m│\x1b[0m  \x1b[2mSaved to: ${getConfigPath()}\x1b[0m`)
      console.log(`\x1b[36m└\x1b[0m  \x1b[32mConfiguration saved\x1b[0m\n`)
    } else if (dirty && slackBotToken) {
      // Only Slack changed but no LLM provider selected (and no saved LLM) — save Slack-only
      // We need at least a placeholder provider to save
      if (saved) {
        await saveConfig({ ...saved, slackBotToken, slackAppToken, slackSigningSecret })
      }
      console.log("\x1b[36m│\x1b[0m")
      console.log(`\x1b[36m│\x1b[0m  Slack: \x1b[32mconfigured\x1b[0m`)
      console.log(`\x1b[36m│\x1b[0m  \x1b[2mSaved to: ${getConfigPath()}\x1b[0m`)
      console.log(`\x1b[36m└\x1b[0m  \x1b[32mConfiguration saved\x1b[0m\n`)
    } else {
      console.log(`\x1b[36m└\x1b[0m  OK\n`)
    }

    return result
  } finally {
    rl.close()
  }
}

// ─── Run provider prompt ─────────────────────────────────────────────────────

let providerChoice: Awaited<ReturnType<typeof promptProviderSelection>> = null

// Still load saved config even when prompt is skipped
if (process.env.SKIP_PROVIDER_PROMPT || process.env.TEST_PROMPT) {
  const saved = await loadSavedConfig()
  if (saved) {
    process.env[saved.envKey] = saved.apiKey
    if (saved.visionModel) process.env.ARGUS_VISION_MODEL = saved.visionModel
    if (saved.slackBotToken) process.env.SLACK_BOT_TOKEN = saved.slackBotToken
    if (saved.slackAppToken) process.env.SLACK_APP_TOKEN = saved.slackAppToken
    if (saved.slackSigningSecret) process.env.SLACK_SIGNING_SECRET = saved.slackSigningSecret
    providerChoice = {
      model: saved.model,
      providerId: saved.providerId,
      providerOptions: buildProviderOptions(saved.providerId),
      visionModel: saved.visionModel,
    }
  }
  console.log("[Bot] Skipping provider prompt (saved config applied)")
} else {
  try {
    providerChoice = await promptProviderSelection()
  } catch {
    // Non-interactive — skip
  }
}

// ─── DashScope / provider setup ──────────────────────────────────────────────

// Select the correct API key and base URL based on key type:
//   sk-sp-* (CODING_DASHSCOPE_API_KEY) → Coding Plan endpoint
//   sk-*   (DASHSCOPE_API_KEY)         → Standard DashScope OpenAI-compatible endpoint
const codingKey = process.env.CODING_DASHSCOPE_API_KEY
const standardKey = process.env.DASHSCOPE_API_KEY
const useCodingPlan = !!codingKey
const activeKey = useCodingPlan ? codingKey! : standardKey
const dashscopeBaseURL = useCodingPlan
  ? "https://coding.dashscope.aliyuncs.com/v1"
  : "https://dashscope.aliyuncs.com/compatible-mode/v1"

// Expose the selected key as DASHSCOPE_API_KEY so the Argus server picks it up.
if (activeKey) process.env.DASHSCOPE_API_KEY = activeKey

// Build Argus config — use provider selection if user chose one, else default
const argusModel = providerChoice?.model ?? "alibaba-cn/qwen3.5-plus"
const argusProvider: Record<string, any> = {
  "alibaba-cn": {
    options: {
      baseURL: dashscopeBaseURL,
    },
  },
}

// Merge selected provider config if not alibaba-cn
if (providerChoice && providerChoice.providerId !== "alibaba-cn") {
  argusProvider[providerChoice.providerId] = {
    options: providerChoice.providerOptions,
  }
}

// Pass Argus config inline since the SDK spawns the server in packages/argus,
// which won't find the project-root .argus/ config directory.
process.env.ARGUS_CONFIG_CONTENT = JSON.stringify({
  model: argusModel,
  provider: argusProvider,
  permission: {
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
// User-selected vision model takes priority over env var and default
if (providerChoice?.visionModel) {
  process.env.ARGUS_VISION_MODEL = providerChoice.visionModel
}
if (activeKey) {
  const visionModel = process.env.ARGUS_VISION_MODEL ?? "qwen3.5-plus"
  bot.setVision(new VisionPipeline({
    apiKey: activeKey,
    baseURL: dashscopeBaseURL,
    model: visionModel,
  }))
  const keySource = useCodingPlan ? "CODING_DASHSCOPE_API_KEY (coding plan)" : "DASHSCOPE_API_KEY (standard)"
  console.log(`[Bot] Vision pipeline enabled (model: ${visionModel}, key: ${keySource}, baseURL: ${dashscopeBaseURL})`)
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
  bot.injectPrompt("slack", channel, process.env.TEST_PROMPT).catch((err) =>
    console.error("[Test] injectPrompt failed:", err),
  )
}
