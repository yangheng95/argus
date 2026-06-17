import { Instance } from "@/project/instance"
import { Installation } from "@/installation"
import { Log } from "@/util/log"
import { Server } from "@/server/server"
import { ChannelCatalog, channelEnv } from "./catalog"

const log = Log.create({ service: "channel.supervisor" })

type RuntimeStatus = "disabled" | "unavailable" | "starting" | "running" | "stopped" | "error"

type InProcessRuntime = { stop(): Promise<void> }

type State = {
  runtime?: InProcessRuntime
  status: RuntimeStatus
  detail: string
  signature: string
  channels: string[]
  logs: string[]
}

export namespace ChannelSupervisor {
  const state = Instance.state<State>(
    () => ({
      status: "disabled",
      detail: "No managed channel runtime active.",
      signature: "",
      channels: [],
      logs: [],
    }),
    async (current) => {
      await stop(current)
    },
  )

  export async function sync(config?: Record<string, unknown>) {
    const current = await state()
    const next = desired(config)
    if (next.status === "disabled" || next.status === "unavailable") {
      await stop(current)
      current.status = next.status
      current.detail = next.detail
      current.signature = ""
      current.channels = []
      return snapshot(current)
    }
    if (current.signature === next.signature && current.runtime && current.status === "running") {
      return snapshot(current)
    }
    await syncRuntime(current, next)
    return snapshot(current)
  }

  export async function restart(config?: Record<string, unknown>) {
    const current = await state()
    const next = desired(config)
    await syncRuntime(current, next, true)
    return snapshot(current)
  }

  export async function status() {
    return snapshot(await state())
  }

  export async function channelStatus(id: string) {
    const current = await state()
    if (!current.channels.includes(id)) {
      return {
        runtime_status: current.status === "unavailable" ? "unavailable" : "disabled",
        runtime_detail: current.detail,
      }
    }
    return {
      runtime_status: current.status,
      runtime_detail: current.detail,
    }
  }

  export async function handles(id: string) {
    return (await state()).channels.includes(id)
  }
}

function desired(config?: Record<string, unknown>) {
  if (!Installation.isLocal()) {
    return {
      status: "unavailable" as const,
      detail: "Managed channel runtime is only available in local development installs.",
      env: undefined,
      signature: "",
      channels: [] as string[],
    }
  }
  const channel = (config?.channel ?? {}) as Record<string, any>
  const env: Record<string, string> = {}
  const channels: string[] = []

  for (const item of ChannelCatalog) {
    const next = channelEnv(item.id, channel[item.id], process.env)
    if (!next) continue
    Object.assign(env, next)
    channels.push(item.id)
  }

  if (channels.length === 0) {
    return {
      status: "disabled" as const,
      detail: "No managed channel runtime configured.",
      env: undefined,
      signature: "",
      channels,
    }
  }

  env.OPENCORVUS_CHANNEL_SERVER_URL = Server.url().toString().replace(/\/+$/, "")
  env.OPENCORVUS_CHANNEL_PROTOCOL = "1"
  env.OPENCORVUS_PROJECT_DIR = Instance.directory
  env.OPENCORVUS_CONFIG_CONTENT = JSON.stringify(config ?? {})

  return {
    status: "starting" as const,
    detail: `Launching managed runtime for ${channels.join(", ")}.`,
    env,
    signature: JSON.stringify({ env, channels }),
    channels,
  }
}

async function syncRuntime(current: State, next: ReturnType<typeof desired>, force = false) {
  await stop(current)
  if (!next.env) {
    current.status = next.status
    current.detail = next.detail
    current.signature = ""
    current.channels = []
    return
  }
  current.status = "starting"
  current.detail = force ? `Restarting managed runtime for ${next.channels.join(", ")}.` : next.detail
  current.signature = next.signature
  current.channels = next.channels

  try {
    current.runtime = await startInProcess(next.env, current)
    current.status = "running"
    current.detail = `Managed runtime active for ${next.channels.join(", ")}.`
  } catch (error) {
    current.status = "error"
    current.detail = `Channel runtime failed: ${String(error)}`
    log.error("channel runtime failed", { error: String(error) })
  }
}

async function stop(current: State) {
  const runtime = current.runtime
  current.runtime = undefined
  if (runtime) {
    await runtime.stop().catch(() => undefined)
  }
}

async function startInProcess(env: Record<string, string>, current: State): Promise<InProcessRuntime> {
  // Apply channel env vars to current process (don't overwrite existing)
  for (const [key, value] of Object.entries(env)) {
    if (!process.env[key]) process.env[key] = value
  }

  // Dynamic import to avoid loading channel-runtime when not needed
  const { ChannelRuntime } = await import("../../../channel-runtime/src/core")
  const { registerAdapters, ADAPTER_HINT } = await import("../../../channel-runtime/src/registry")
  const { SlackAdapter } = await import("../../../channel-runtime/src/adapters/slack")
  const { TelegramAdapter } = await import("../../../channel-runtime/src/adapters/telegram")
  const { DiscordAdapter } = await import("../../../channel-runtime/src/adapters/discord")
  const { FeishuAdapter } = await import("../../../channel-runtime/src/adapters/feishu")
  const { WhatsappAdapter } = await import("../../../channel-runtime/src/adapters/whatsapp")
  const { GoogleChatAdapter } = await import("../../../channel-runtime/src/adapters/googlechat")
  const { MSTeamsAdapter } = await import("../../../channel-runtime/src/adapters/msteams")
  const { LineAdapter } = await import("../../../channel-runtime/src/adapters/line")
  const { MatrixAdapter } = await import("../../../channel-runtime/src/adapters/matrix")
  const { MattermostAdapter } = await import("../../../channel-runtime/src/adapters/mattermost")
  const { SignalAdapter } = await import("../../../channel-runtime/src/adapters/signal")
  const { WeComAdapter } = await import("../../../channel-runtime/src/adapters/wecom")
  const { DingTalkAdapter } = await import("../../../channel-runtime/src/adapters/dingtalk")
  const { QQAdapter } = await import("../../../channel-runtime/src/adapters/qq")
  const { applyDashscopeRuntime } = await import("../../../channel-runtime/src/dashscope")
  const { STTPipeline } = await import("../../../channel-runtime/src/stt/pipeline")
  const { VisionPipeline } = await import("../../../channel-runtime/src/vision")

  const dashscope = await applyDashscopeRuntime()
  const serverUrl = env.OPENCORVUS_CHANNEL_SERVER_URL

  const runtime = new ChannelRuntime({
    baseUrl: serverUrl,
    directory: env.OPENCORVUS_PROJECT_DIR,
    sharedMode: process.env.OPENCORVUS_SHARED_SESSION_MODE === "1",
    sharedFile: process.env.OPENCORVUS_SHARED_SESSION_FILE,
  })

  // STT pipeline (best-effort, no hard failure)
  try {
    const sttPipeline = new STTPipeline({
      providers: (process.env.STT_PROVIDERS ?? "groq,openai-whisper,deepgram,google-gemini,local-cli").split(","),
      language: process.env.STT_LANGUAGE,
    })
    await sttPipeline.init().catch(() => undefined)
    runtime.setSTT(sttPipeline)
  } catch {
    /* STT optional */
  }

  // Vision pipeline (optional)
  if (dashscope.key && process.env.OPENCORVUS_VISION_MODEL) {
    try {
      runtime.setVision(
        new VisionPipeline({
          apiKey: dashscope.key,
          baseURL: dashscope.baseURL,
          model: process.env.OPENCORVUS_VISION_MODEL,
        }),
      )
    } catch {
      /* Vision optional */
    }
  }

  // Register adapters
  const adapters = registerAdapters(runtime, process.env, {
    slack: (opts: any) => new SlackAdapter(opts),
    telegram: (opts: any) => new TelegramAdapter(opts),
    discord: (opts: any) => new DiscordAdapter(opts),
    feishu: (opts: any) => new FeishuAdapter(opts),
    whatsapp: (opts: any) => new WhatsappAdapter(opts),
    googlechat: (opts: any) => new GoogleChatAdapter(opts),
    msteams: (opts: any) => new MSTeamsAdapter(opts),
    line: (opts: any) => new LineAdapter(opts),
    matrix: (opts: any) => new MatrixAdapter(opts),
    mattermost: (opts: any) => new MattermostAdapter(opts),
    signal: (opts: any) => new SignalAdapter(opts),
    wecom: (opts: any) => new WeComAdapter(opts),
    dingtalk: (opts: any) => new DingTalkAdapter(opts),
    qq: (opts: any) => new QQAdapter(opts),
  })
  for (const warn of adapters.warns) {
    log.warn("channel adapter skip", { message: warn })
  }
  if (adapters.names.length === 0) {
    throw new Error(`No chat channel configured. ${ADAPTER_HINT}`)
  }
  log.info("channel runtime starting", { channels: adapters.names })
  for (const name of adapters.names) {
    appendLog(current, `Registered: ${name}`)
  }

  await runtime.start()
  log.info("channel runtime started", { channels: adapters.names })
  appendLog(current, `Channel runtime active: ${adapters.names.join(", ")}`)

  return { stop: () => runtime.stop() }
}

function appendLog(current: State, text: string) {
  current.logs.push(text)
  if (current.logs.length > 20) current.logs.shift()
}

function snapshot(current: State) {
  return {
    status: current.status,
    detail: current.detail,
    channels: [...current.channels],
    logs: [...current.logs],
    running: !!current.runtime && current.status === "running",
  }
}
