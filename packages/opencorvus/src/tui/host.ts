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
const BUFFER_CHUNK = 64 * 1024
const encoder = new TextEncoder()
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

interface HostConnection {
  send(chunk: string | Uint8Array<ArrayBuffer>): void
  close(code?: number, reason?: string): void
}

interface HostProcess {
  pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(handler: (chunk: string) => void): void
  onExit(handler: ExitHandler): void
}

interface HostSession {
  id: string
  title: string
  command: Tui.EmbeddedCommand
  process: HostProcess | null
  status: HostStatus
  cols: number
  rows: number
  buffer: string
  bufferCursor: number
  cursor: number
  connections: Set<HostConnection>
  exitHandlers: Set<ExitHandler>
  exitCode: number | null
  createdAt: number
  updatedAt: number
}

const state = lazyInstanceState(
  () => ({
    sessions: new Map<string, HostSession>(),
    primaryID: null as string | null,
  }),
  async (s) => {
    for (const session of s.sessions.values()) {
      closeSession(session, "TUI host stopped")
    }
    s.sessions.clear()
    s.primaryID = null
  },
)

function meta(cursor: number) {
  const json = JSON.stringify({ cursor })
  const bytes = encoder.encode(json)
  const out = new Uint8Array(bytes.length + 1)
  out[0] = 0
  out.set(bytes, 1)
  return out
}

function appendBuffer(session: HostSession, chunk: string) {
  session.cursor += chunk.length
  session.buffer += chunk
  while (Buffer.byteLength(session.buffer, "utf8") > MAX_BUFFER_BYTES) {
    const remove = Math.max(1, Math.floor(session.buffer.length / 4))
    session.buffer = session.buffer.slice(remove)
    session.bufferCursor += remove
  }
  session.updatedAt = Date.now()
  for (const connection of session.connections) {
    try {
      connection.send(chunk)
    } catch {
      session.connections.delete(connection)
    }
  }
}

function readOutput(session: HostSession | null, cursor?: number) {
  const end = session?.cursor ?? 0
  const start = session?.bufferCursor ?? 0
  const from =
    cursor === -1 ? end : typeof cursor === "number" && Number.isSafeInteger(cursor) ? Math.max(0, cursor) : 0
  const data = (() => {
    if (!session?.buffer || from >= end) return ""
    const offset = Math.max(0, from - start)
    if (offset >= session.buffer.length) return ""
    return session.buffer.slice(offset)
  })()
  return {
    ...info(session),
    data,
    cursor: end,
    from,
    truncated: !!session && from < start,
  }
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
      title: null,
      command: null,
      args: null,
      pid: null,
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
    directory: session.command.directory,
    title: session.title,
    command: session.command.command,
    args: session.command.args,
    pid: session.process?.pid ?? 0,
    exitCode: session.exitCode,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}

function currentSession() {
  const s = state()
  return s.primaryID ? (s.sessions.get(s.primaryID) ?? null) : null
}

function closeSession(session: HostSession, reason: string) {
  for (const connection of session.connections) {
    connection.close(1000, reason)
  }
  session.connections.clear()
  session.process?.kill()
  session.process = null
  session.status = "exited"
  session.updatedAt = Date.now()
}

function hostExitReason(exitCode: number | null) {
  return exitCode === null ? "TUI host exited" : `TUI host exited with code ${exitCode}`
}

function assertSize(cols: number, rows: number) {
  if (!Number.isInteger(cols) || cols < 1 || cols > 500) throw new Error("cols must be an integer from 1 to 500")
  if (!Number.isInteger(rows) || rows < 1 || rows > 200) throw new Error("rows must be an integer from 1 to 200")
}

function directPtyProcess(input: {
  command: Tui.EmbeddedCommand
  cols: number
  rows: number
  env: Record<string, string>
}): HostProcess {
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
    pid: proc.pid,
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
  throw new Error(
    `TUI PTY Node runtime is missing. Expected ${packaged.nodeExecutable} beside the opencorvus executable.`,
  )
}

function bridgeMessage(child: ChildProcess, message: unknown) {
  if (!child.stdin?.writable || child.stdin.destroyed || child.exitCode !== null) return
  try {
    child.stdin.write(JSON.stringify(message) + "\n")
  } catch {
    // The bridge process can exit between the writable check and write.
  }
}

async function nodeBridgePtyProcess(input: {
  command: Tui.EmbeddedCommand
  cols: number
  rows: number
  env: Record<string, string>
}): Promise<HostProcess> {
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
  child.stdin?.on("error", () => {
    // The Pseudo Terminal (PTY) child may exit before a late kill/input message reaches stdin.
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
    pid: child.pid ?? 0,
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

async function hostProcess(input: {
  command: Tui.EmbeddedCommand
  cols: number
  rows: number
  env: Record<string, string>
}) {
  if (process.platform === "win32" && isBunExecutable(process.execPath)) {
    return nodeBridgePtyProcess(input)
  }
  return directPtyProcess(input)
}

async function spawnPrepared(input: { command: Tui.EmbeddedCommand; cols: number; rows: number; title?: string }) {
  assertSize(input.cols, input.rows)
  const now = Date.now()
  const session: HostSession = {
    id: Identifier.ascending("pty"),
    title: input.title ?? "OpenCorvus TUI",
    command: input.command,
    process: null,
    status: "running",
    cols: input.cols,
    rows: input.rows,
    buffer: "",
    bufferCursor: 0,
    cursor: 0,
    connections: new Set(),
    exitHandlers: new Set(),
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
    for (const connection of session.connections) {
      connection.close(4405, hostExitReason(event.exitCode))
    }
    session.connections.clear()
    for (const handler of session.exitHandlers) handler(event)
    session.exitHandlers.clear()
    const s = state()
    if (s.sessions.get(session.id) === session) {
      s.sessions.delete(session.id)
      if (s.primaryID === session.id) s.primaryID = Array.from(s.sessions.keys()).at(-1) ?? null
    }
  })
  return session
}

export namespace TuiHost {
  export type Info = ReturnType<typeof info>
  export type Snapshot = Info & { buffer: string }
  export type Output = ReturnType<typeof readOutput>
  export type PreparedConnection = {
    attach(input: HostConnection): {
      onMessage(data: string): void
      onClose(): void
    }
  }

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

  export async function startPrepared(input: {
    command: Tui.EmbeddedCommand
    cols?: number
    rows?: number
    title?: string
  }) {
    const s = state()
    const session = await spawnPrepared({
      command: input.command,
      cols: input.cols ?? 100,
      rows: input.rows ?? 30,
      title: input.title,
    })
    s.sessions.set(session.id, session)
    s.primaryID = session.id
    return info(session)
  }

  export function status() {
    return info(currentSession())
  }

  export function list() {
    return Array.from(state().sessions.values()).map((session) => info(session))
  }

  export function get(id: string) {
    return info(state().sessions.get(id) ?? null)
  }

  export function onExit(id: string, handler: ExitHandler) {
    const session = state().sessions.get(id)
    if (!session) return () => {}
    session.exitHandlers.add(handler)
    return () => {
      session.exitHandlers.delete(handler)
    }
  }

  export function snapshot(): Snapshot {
    const session = currentSession()
    return {
      ...info(session),
      buffer: session?.buffer ?? "",
    }
  }

  export function output(input?: { cursor?: number }): Output {
    return readOutput(currentSession(), input?.cursor)
  }

  export function preparePtyConnect(input: { id: string; cursor?: number }): PreparedConnection {
    const s = state()
    const session = s.sessions.get(input.id)
    if (!session?.process || session.status !== "running" || session.id !== input.id) {
      throw new Error("PTY session not found")
    }
    const retained = readOutput(session, input.cursor)
    return {
      attach(connection) {
        if (!session.process || session.status !== "running") {
          connection.close(4404, "PTY session is not running")
          return {
            onMessage() {},
            onClose() {},
          }
        }
        session.connections.add(connection)
        if (retained.data) {
          for (let i = 0; i < retained.data.length; i += BUFFER_CHUNK) {
            connection.send(retained.data.slice(i, i + BUFFER_CHUNK))
          }
        }
        connection.send(meta(retained.cursor))
        return {
          onMessage(data) {
            if (!session.process || session.status !== "running") return
            session.process.write(data)
            session.updatedAt = Date.now()
          },
          onClose() {
            session.connections.delete(connection)
          },
        }
      },
    }
  }

  export function input(data: string) {
    const session = currentSession()
    if (!session?.process || session.status !== "running") throw new Error("TUI host is not running")
    session.process.write(data)
    session.updatedAt = Date.now()
    return true
  }

  export function resize(input: { cols: number; rows: number }) {
    assertSize(input.cols, input.rows)
    const session = currentSession()
    if (!session?.process || session.status !== "running") throw new Error("TUI host is not running")
    session.process.resize(input.cols, input.rows)
    session.cols = input.cols
    session.rows = input.rows
    session.updatedAt = Date.now()
    return info(session)
  }

  export function rename(input: { id: string; title: string }) {
    const session = state().sessions.get(input.id)
    if (!session || session.id !== input.id) throw new Error("PTY session not found")
    session.title = input.title
    session.updatedAt = Date.now()
    return info(session)
  }

  export function resizePty(input: { id: string; cols: number; rows: number }) {
    assertSize(input.cols, input.rows)
    const session = state().sessions.get(input.id)
    if (!session?.process || session.status !== "running") throw new Error("PTY session not found")
    session.process.resize(input.cols, input.rows)
    session.cols = input.cols
    session.rows = input.rows
    session.updatedAt = Date.now()
    return info(session)
  }

  export async function stop() {
    const s = state()
    const session = currentSession()
    if (!session) return true
    closeSession(session, "TUI host stopped")
    s.sessions.delete(session.id)
    if (s.primaryID === session.id) s.primaryID = Array.from(s.sessions.keys()).at(-1) ?? null
    return true
  }

  export async function remove(input: { id: string }) {
    const s = state()
    const session = s.sessions.get(input.id)
    if (!session) return true
    closeSession(session, "PTY session removed")
    s.sessions.delete(input.id)
    if (s.primaryID === input.id) s.primaryID = Array.from(s.sessions.keys()).at(-1) ?? null
    return true
  }
}
