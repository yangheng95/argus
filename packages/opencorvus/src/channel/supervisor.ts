import path from "path"
import { Instance } from "@/project/instance"
import { Installation } from "@/installation"
import { Process } from "@/util/process"
import { Log } from "@/util/log"
import { ChannelCatalog, channelEnv } from "./catalog"

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

  env.OPENCORVUS_CHANNEL_SERVER_URL = process.env.OPENCORVUS_SERVER_URL || "http://127.0.0.1:7878"
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

async function syncProcess(current: State, next: ReturnType<typeof desired>, force = false) {
  await stop(current)
  if (!next.env) {
    current.status = next.status
    current.detail = next.detail
    current.signature = ""
    current.channels = []
    return
  }
  const child = spawnChannelRuntime(next.env)
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
    // Process was already killed — exit rejection is expected during teardown
    await child.exited.catch(() => undefined)
  }
}

function spawnChannelRuntime(env: Record<string, string>) {
  const runtimeMain = path.resolve(import.meta.dirname, "../../channel-runtime/src/main.ts")
  const runtimeCwd = path.dirname(runtimeMain)
  return Process.spawn([process.execPath, runtimeMain], {
    cwd: runtimeCwd,
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
    log.info("channel.runtime", { text })
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
