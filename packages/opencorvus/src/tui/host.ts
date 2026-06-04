import { spawn as nodeSpawn, type ChildProcess } from "node:child_process"
import { createInterface } from "node:readline"
import fs from "node:fs/promises"
import path from "node:path"
import {
  browserNodeExecutableName,
  isBunExecutable,
  packagedBrowserNodeRuntimePaths,
} from "@/browser/runtime/node-sidecar"
import { Identifier } from "@/id/id"
import { Instance, lazyInstanceState } from "@/project/instance"
import { requireRuntimePackage, runtimePackageRequire } from "@/runtime/package-require"
import { Tui } from "@/tui"

const MAX_BUFFER_BYTES = 1_000_000
const NODE_BRIDGE_SCRIPT = String.raw`
const readline = require("node:readline")

const payload = JSON.parse(Buffer.from(process.argv[1], "base64").toString("utf8"))
const Pty = require(payload.nodePtyRequirePath)
function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n")
}
const proc = Pty.spawn(payload.command, payload.args, {
  name: "xterm-256color",
  cols: payload.cols,
  rows: payload.rows,
  cwd: payload.cwd,
  env: { ...process.env, ...payload.env },
  useConptyDll: false,
})
proc.onData((data) => send({ type: "data", data }))
proc.onExit((event) => {
  send({ type: "exit", exitCode: event.exitCode })
  process.exit(0)
})
const reader = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
reader.on("line", (line) => {
  try {
    const message = JSON.parse(line)
    if (message.type === "input") proc.write(message.data)
    if (message.type === "resize") proc.resize(message.cols, message.rows)
    if (message.type === "kill") proc.kill()
  } catch (error) {
    send({ type: "error", error: error instanceof Error ? error.message : String(error) })
  }
})
process.on("SIGTERM", () => proc.kill())
`

type HostStatus = "idle" | "running" | "exited"
type ExitHandler = (event: { exitCode: number | null }) => void

interface HostProcess {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(handler: (chunk: string) => void): void
  onExit(handler: ExitHandler): void
}

interface HostSession {
  id: string
  command: Tui.EmbeddedCommand
  process: HostProcess | null
  status: HostStatus
  cols: number
  rows: number
  buffer: string
  exitCode: number | null
  createdAt: number
  updatedAt: number
}

const state = lazyInstanceState(
  () => ({
    session: null as HostSession | null,
  }),
  async (s) => {
    s.session?.process?.kill()
    s.session = null
  },
)

function appendBuffer(session: HostSession, chunk: string) {
  session.buffer += chunk
  while (Buffer.byteLength(session.buffer, "utf8") > MAX_BUFFER_BYTES) {
    session.buffer = session.buffer.slice(Math.max(1, Math.floor(session.buffer.length / 4)))
  }
  session.updatedAt = Date.now()
}

function info(session: HostSession | null) {
  if (!session) {
    return {
      id: null,
      running: false,
      status: "idle" as const,
      cols: null,
      rows: null,
      url: null,
      directory: Instance.current()?.directory ?? null,
      exitCode: null,
      createdAt: null,
      updatedAt: null,
    }
  }
  return {
    id: session.id,
    running: session.status === "running" && !!session.process,
    status: session.status,
    cols: session.cols,
    rows: session.rows,
    url: session.command.url,
    directory: session.command.cwd,
    exitCode: session.exitCode,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}

function assertSize(cols: number, rows: number) {
  if (!Number.isInteger(cols) || cols < 1 || cols > 500) throw new Error("cols must be an integer from 1 to 500")
  if (!Number.isInteger(rows) || rows < 1 || rows > 200) throw new Error("rows must be an integer from 1 to 200")
}

function directPtyProcess(input: { command: Tui.EmbeddedCommand; cols: number; rows: number; env: Record<string, string> }): HostProcess {
  const nodePty = requireRuntimePackage<typeof import("@lydell/node-pty")>("@lydell/node-pty")
  const proc = nodePty.spawn(input.command.command, input.command.args, {
    name: "xterm-256color",
    cols: input.cols,
    rows: input.rows,
    cwd: input.command.cwd,
    env: input.env,
    useConptyDll: false,
  })
  return {
    write: (data) => proc.write(data),
    resize: (cols, rows) => proc.resize(cols, rows),
    kill: () => proc.kill(),
    onData: (handler) => proc.onData(handler),
    onExit: (handler) => proc.onExit((event) => handler({ exitCode: event.exitCode })),
  }
}

async function exists(file: string) {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false)
}

async function resolvePtyNodeRuntime() {
  const packaged = packagedBrowserNodeRuntimePaths()
  if (await exists(packaged.nodeExecutable)) {
    const runtimeRoot = path.dirname(packaged.nodeExecutable)
    return {
      nodeExecutable: packaged.nodeExecutable,
      cwd: runtimeRoot,
      nodePtyRequirePath: path.join(runtimeRoot, "node_modules", "@lydell", "node-pty", "index.js"),
    }
  }
  if (isBunExecutable(process.execPath)) {
    return {
      nodeExecutable: process.env.OPENCORVUS_TUI_PTY_NODE ?? browserNodeExecutableName(process.platform),
      cwd: process.cwd(),
      nodePtyRequirePath: runtimePackageRequire().resolve("@lydell/node-pty"),
    }
  }
  throw new Error(`TUI PTY Node runtime is missing. Expected ${packaged.nodeExecutable} beside the opencorvus executable.`)
}

function bridgeMessage(child: ChildProcess, message: unknown) {
  if (!child.stdin?.writable) throw new Error("TUI PTY bridge is not writable")
  child.stdin.write(JSON.stringify(message) + "\n")
}

async function nodeBridgePtyProcess(input: { command: Tui.EmbeddedCommand; cols: number; rows: number; env: Record<string, string> }): Promise<HostProcess> {
  const runtime = await resolvePtyNodeRuntime()
  const payload = Buffer.from(
    JSON.stringify({
      command: input.command.command,
      args: input.command.args,
      cwd: input.command.cwd,
      cols: input.cols,
      rows: input.rows,
      env: input.env,
      nodePtyRequirePath: runtime.nodePtyRequirePath,
    }),
    "utf8",
  ).toString("base64")
  const child = nodeSpawn(runtime.nodeExecutable, ["-e", NODE_BRIDGE_SCRIPT, payload], {
    cwd: runtime.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
  const dataHandlers: Array<(chunk: string) => void> = []
  const exitHandlers: ExitHandler[] = []
  const pendingData: string[] = []
  let pendingExit: { exitCode: number | null } | undefined
  let exited = false

  const emitData = (chunk: string) => {
    if (dataHandlers.length === 0) {
      pendingData.push(chunk)
      return
    }
    for (const handler of dataHandlers) handler(chunk)
  }

  const emitExit = (event: { exitCode: number | null }) => {
    if (exitHandlers.length === 0) {
      pendingExit = event
      return
    }
    for (const handler of exitHandlers) handler(event)
  }

  child.stderr?.setEncoding("utf8")
  child.stderr?.on("data", (chunk) => {
    emitData(String(chunk))
  })

  const reader = createInterface({ input: child.stdout!, crlfDelay: Infinity })
  reader.on("line", (line) => {
    const message = JSON.parse(line) as
      | { type: "data"; data: string }
      | { type: "exit"; exitCode: number | null }
      | { type: "error"; error: string }
    if (message.type === "data") {
      emitData(message.data)
    }
    if (message.type === "error") {
      emitData(message.error)
    }
    if (message.type === "exit" && !exited) {
      exited = true
      emitExit({ exitCode: message.exitCode })
    }
  })
  child.on("exit", (exitCode) => {
    if (exited) return
    exited = true
    emitExit({ exitCode })
  })
  child.on("error", (error) => {
    emitData(error.message)
  })

  return {
    write: (data) => bridgeMessage(child, { type: "input", data }),
    resize: (cols, rows) => bridgeMessage(child, { type: "resize", cols, rows }),
    kill: () => bridgeMessage(child, { type: "kill" }),
    onData: (handler) => {
      dataHandlers.push(handler)
      for (const chunk of pendingData.splice(0)) handler(chunk)
    },
    onExit: (handler) => {
      exitHandlers.push(handler)
      if (pendingExit) handler(pendingExit)
    },
  }
}

async function hostProcess(input: { command: Tui.EmbeddedCommand; cols: number; rows: number; env: Record<string, string> }) {
  if (process.platform === "win32" && isBunExecutable(process.execPath)) {
    return nodeBridgePtyProcess(input)
  }
  return directPtyProcess(input)
}

async function spawnPrepared(input: { command: Tui.EmbeddedCommand; cols: number; rows: number }) {
  assertSize(input.cols, input.rows)
  const now = Date.now()
  const session: HostSession = {
    id: Identifier.ascending("pty"),
    command: input.command,
    process: null,
    status: "running",
    cols: input.cols,
    rows: input.rows,
    buffer: "",
    exitCode: null,
    createdAt: now,
    updatedAt: now,
  }
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      ...input.command.env,
      OPENCORVUS_TUI_HOST: "1",
    }).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
  const proc = await hostProcess({
    command: input.command,
    cols: input.cols,
    rows: input.rows,
    env,
  })
  session.process = proc
  proc.onData((chunk) => appendBuffer(session, chunk))
  proc.onExit((event) => {
    session.status = "exited"
    session.process = null
    session.exitCode = event.exitCode
    session.updatedAt = Date.now()
  })
  return session
}

export namespace TuiHost {
  export type Info = ReturnType<typeof info>
  export type Snapshot = Info & { buffer: string }

  export async function start(input: {
    directory?: string
    sessionID?: string
    model?: string
    agent?: string
    prompt?: string
    continue?: boolean
    fork?: boolean
    port?: number
    hostname?: string
    bin?: string
    cols?: number
    rows?: number
  }) {
    return startPrepared({
      command: await Tui.resolveEmbeddedCommand({
        directory: input.directory ?? Instance.directory,
        sessionID: input.sessionID,
        model: input.model,
        agent: input.agent,
        prompt: input.prompt,
        continue: input.continue,
        fork: input.fork,
        port: input.port,
        hostname: input.hostname,
        bin: input.bin,
      }),
      cols: input.cols ?? 100,
      rows: input.rows ?? 30,
    })
  }

  export async function startPrepared(input: { command: Tui.EmbeddedCommand; cols?: number; rows?: number }) {
    await stop()
    const s = state()
    s.session = await spawnPrepared({
      command: input.command,
      cols: input.cols ?? 100,
      rows: input.rows ?? 30,
    })
    return info(s.session)
  }

  export function status() {
    return info(state().session)
  }

  export function snapshot(): Snapshot {
    const session = state().session
    return {
      ...info(session),
      buffer: session?.buffer ?? "",
    }
  }

  export function input(data: string) {
    const session = state().session
    if (!session?.process || session.status !== "running") throw new Error("TUI host is not running")
    session.process.write(data)
    session.updatedAt = Date.now()
    return true
  }

  export function resize(input: { cols: number; rows: number }) {
    assertSize(input.cols, input.rows)
    const session = state().session
    if (!session?.process || session.status !== "running") throw new Error("TUI host is not running")
    session.process.resize(input.cols, input.rows)
    session.cols = input.cols
    session.rows = input.rows
    session.updatedAt = Date.now()
    return info(session)
  }

  export async function stop() {
    const s = state()
    const session = s.session
    if (!session) return true
    session.process?.kill()
    session.process = null
    session.status = "exited"
    session.updatedAt = Date.now()
    s.session = null
    return true
  }
}
