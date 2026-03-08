import path from "path"
import { Instance } from "@/project/instance"
import { Installation } from "@/installation"
import { Process } from "@/util/process"
import { Log } from "@/util/log"

const log = Log.create({ service: "channel.supervisor" })

type RuntimeStatus = "disabled" | "unavailable" | "starting" | "running" | "stopped" | "error"

type State = {
  child?: Process.Child
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
    if (current.signature === next.signature && current.child && current.status === "running") {
      return snapshot(current)
    }
    await syncProcess(current, next)
    return snapshot(current)
  }

  export async function restart(config?: Record<string, unknown>) {
    const current = await state()
    const next = desired(config)
    await syncProcess(current, next, true)
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

  if (
    channel.slack?.enabled !== false &&
    text(channel.slack?.botToken, process.env.SLACK_BOT_TOKEN) &&
    text(channel.slack?.appToken, process.env.SLACK_APP_TOKEN)
  ) {
    env.SLACK_BOT_TOKEN = text(channel.slack?.botToken, process.env.SLACK_BOT_TOKEN)!
    env.SLACK_APP_TOKEN = text(channel.slack?.appToken, process.env.SLACK_APP_TOKEN)!
    if (text(channel.slack?.signingSecret, process.env.SLACK_SIGNING_SECRET)) {
      env.SLACK_SIGNING_SECRET = text(channel.slack?.signingSecret, process.env.SLACK_SIGNING_SECRET)!
    }
    channels.push("slack")
  }
  if (channel.telegram?.enabled !== false && text(channel.telegram?.token, process.env.TELEGRAM_BOT_TOKEN, process.env.OPENCLAW_TELEGRAM_BOT_TOKEN)) {
    env.TELEGRAM_BOT_TOKEN = text(channel.telegram?.token, process.env.TELEGRAM_BOT_TOKEN, process.env.OPENCLAW_TELEGRAM_BOT_TOKEN)!
    channels.push("telegram")
  }
  if (channel.discord?.enabled !== false && text(channel.discord?.token, process.env.DISCORD_BOT_TOKEN)) {
    env.DISCORD_BOT_TOKEN = text(channel.discord?.token, process.env.DISCORD_BOT_TOKEN)!
    channels.push("discord")
  }

  if (channels.length === 0) {
    return {
      status: "disabled" as const,
      detail: "No managed Slack, Telegram, or Discord runtime configured.",
      env: undefined,
      signature: "",
      channels,
    }
  }

  env.OPENCORVUS_BOT_SERVER_URL = process.env.OPENCORVUS_SERVER_URL || "http://127.0.0.1:7878"
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

async function syncProcess(current: State, next: ReturnType<typeof desired>, force = false) {
  await stop(current)
  if (!next.env) {
    current.status = next.status
    current.detail = next.detail
    current.signature = ""
    current.channels = []
    return
  }
  const child = spawnBot(next.env)
  current.child = child
  current.status = "starting"
  current.detail = force ? `Restarting managed runtime for ${next.channels.join(", ")}.` : next.detail
  current.signature = next.signature
  current.channels = next.channels
  watch(child, current)
  current.status = "running"
  current.detail = `Managed runtime active for ${next.channels.join(", ")}.`
}

async function stop(current: State) {
  const child = current.child
  current.child = undefined
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM")
    await child.exited.catch(() => undefined)
  }
}

function spawnBot(env: Record<string, string>) {
  const botMain = path.resolve(import.meta.dirname, "../../bot/src/main.ts")
  const botCwd = path.dirname(botMain)
  return Process.spawn([process.execPath, botMain], {
    cwd: botCwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 2_000,
  })
}

function watch(child: Process.Child, current: State) {
  consume(child.stdout, current)
  consume(child.stderr, current)
  void child.exited
    .then((code) => {
      current.child = undefined
      current.status = code === 0 ? "stopped" : "error"
      current.detail = code === 0 ? "Managed channel runtime stopped." : `Managed channel runtime exited with code ${code}.`
    })
    .catch((error) => {
      current.child = undefined
      current.status = "error"
      current.detail = `Managed channel runtime failed: ${String(error)}`
    })
}

function consume(stream: NodeJS.ReadableStream | null | undefined, current: State) {
  if (!stream) return
  stream.on("data", (chunk) => {
    const text = chunk.toString().trim()
    if (!text) return
    current.logs.push(text)
    if (current.logs.length > 20) current.logs.shift()
    log.info("bot.runtime", { text })
  })
}

function snapshot(current: State) {
  return {
    status: current.status,
    detail: current.detail,
    channels: [...current.channels],
    logs: [...current.logs],
    running: !!current.child && current.status === "running",
  }
}

function text(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return undefined
}
