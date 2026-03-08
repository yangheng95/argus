import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Identifier } from "../id/id"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { lazy } from "@opencorvus-ai/util/lazy"
import { Shell } from "@/shell/shell"
import { Plugin } from "@/plugin"

export namespace Pty {
  const log = Log.create({ service: "pty" })

  const BUFFER_LIMIT = 1024 * 1024 * 2
  const BUFFER_CHUNK = 64 * 1024
  const encoder = new TextEncoder()

  interface Proc {
    pid: number
    write(data: string): void
    resize(cols: number, rows: number): void
    kill(signal?: string): void
    onData(listener: (data: string) => void): { dispose(): void }
    onExit(listener: (event: { exitCode: number }) => void): { dispose(): void }
  }

  type Spawn = (command: string, args: string[], input: { name: string; cwd: string; env: Record<string, string> }) => Proc

  type Socket = {
    readyState: number
    data?: unknown
    send: (data: string | Uint8Array | ArrayBuffer) => void
    close: (code?: number, reason?: string) => void
  }

  // WebSocket control frame: 0x00 + UTF-8 JSON.
  const meta = (cursor: number) => {
    const json = JSON.stringify({ cursor })
    const bytes = encoder.encode(json)
    const out = new Uint8Array(bytes.length + 1)
    out[0] = 0
    out.set(bytes, 1)
    return out
  }

  const pty = lazy(async () => {
    try {
      const { spawn } = await import("bun-pty")
      return spawn as Spawn
    } catch (error) {
      log.warn("bun-pty unavailable, using pipe fallback", { error })
      return fallback
    }
  })

  const fallback: Spawn = (command, args, input) => {
    const proc = Bun.spawn([command, ...args], {
      cwd: input.cwd,
      env: input.env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
    const data = new Set<(chunk: string) => void>()
    const exit = new Set<(info: { exitCode: number }) => void>()
    let buffer = ""
    let code: number | undefined

    const push = (chunk: string) => {
      if (!chunk) return
      if (data.size === 0) {
        buffer += chunk
        return
      }
      for (const item of data) item(chunk)
    }

    const stream = async (source: ReadableStream<Uint8Array> | null | undefined) => {
      if (!source) return
      const decoder = new TextDecoder()
      const reader = source.getReader()
      while (true) {
        const result = await reader.read()
        if (result.done) break
        push(decoder.decode(result.value, { stream: true }))
      }
      push(decoder.decode())
    }

    void Promise.all([stream(proc.stdout), stream(proc.stderr), proc.exited])
      .then(([, , status]) => {
        code = status ?? 0
      })
      .catch(() => {
        code = 1
      })
      .finally(() => {
        if (code === undefined) code = 1
        for (const item of exit) item({ exitCode: code })
      })

    return {
      pid: proc.pid,
      write(value) {
        proc.stdin?.write(value)
      },
      resize() {},
      kill() {
        proc.kill()
      },
      onData(fn) {
        data.add(fn)
        if (buffer) {
          fn(buffer)
          buffer = ""
        }
        return {
          dispose() {
            data.delete(fn)
          },
        }
      },
      onExit(fn) {
        if (code !== undefined) {
          fn({ exitCode: code })
          return {
            dispose() {},
          }
        }
        exit.add(fn)
        return {
          dispose() {
            exit.delete(fn)
          },
        }
      },
    }
  }

  export const Info = z
    .object({
      id: Identifier.schema("pty"),
      title: z.string(),
      command: z.string(),
      args: z.array(z.string()),
      cwd: z.string(),
      status: z.enum(["running", "exited"]),
      pid: z.number(),
    })
    .meta({ ref: "Pty" })

  export type Info = z.infer<typeof Info>

  export const CreateInput = z.object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    title: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
  })

  export type CreateInput = z.infer<typeof CreateInput>

  export const UpdateInput = z.object({
    title: z.string().optional(),
    size: z
      .object({
        rows: z.number(),
        cols: z.number(),
      })
      .optional(),
  })

  export type UpdateInput = z.infer<typeof UpdateInput>

  export const Event = {
    Created: BusEvent.define("pty.created", z.object({ info: Info })),
    Updated: BusEvent.define("pty.updated", z.object({ info: Info })),
    Exited: BusEvent.define("pty.exited", z.object({ id: Identifier.schema("pty"), exitCode: z.number() })),
    Deleted: BusEvent.define("pty.deleted", z.object({ id: Identifier.schema("pty") })),
  }

  interface ActiveSession {
    info: Info
    process: Proc
    buffer: string
    bufferCursor: number
    cursor: number
    subscribers: Map<symbol, Subscriber>
  }

  interface Subscriber {
    ws: Socket
    data: unknown
    send: Socket["send"]
    close: Socket["close"]
  }

  const current = (sub: Subscriber) =>
    sub.ws.readyState === 1 &&
    Object.is(sub.ws.data, sub.data) &&
    sub.ws.send === sub.send &&
    sub.ws.close === sub.close

  const state = Instance.state(
    () => new Map<string, ActiveSession>(),
    async (sessions) => {
      for (const session of sessions.values()) {
        try {
          session.process.kill()
        } catch {}
        for (const [key, sub] of session.subscribers.entries()) {
          if (!current(sub)) {
            session.subscribers.delete(key)
            continue
          }
          try {
            sub.ws.close()
          } catch {
            // ignore
          }
        }
      }
      sessions.clear()
    },
  )

  export function list() {
    return Array.from(state().values()).map((s) => s.info)
  }

  export function get(id: string) {
    return state().get(id)?.info
  }

  export async function create(input: CreateInput) {
    const id = Identifier.create("pty", false)
    const command = input.command || Shell.preferred()
    const args = input.args || []
    if (command.endsWith("sh")) {
      args.push("-l")
    }

    const cwd = input.cwd || Instance.directory
    const shellEnv = await Plugin.trigger("shell.env", { cwd }, { env: {} })
    const shellVars = shellEnv.env as Record<string, string>
    const term = input.env?.TERM || shellVars.TERM || process.env.TERM || "xterm-256color"
    const env = {
      ...process.env,
      ...input.env,
      ...shellVars,
      TERM: term,
      OPENCORVUS_TERMINAL: "1",
    } as Record<string, string>

    if (process.platform === "win32") {
      env.LC_ALL = "C.UTF-8"
      env.LC_CTYPE = "C.UTF-8"
      env.LANG = "C.UTF-8"
    }
    log.info("creating session", { id, cmd: command, args, cwd })

    const spawn = await pty()
    const ptyProcess = spawn(command, args, {
      name: term,
      cwd,
      env,
    })

    const info = {
      id,
      title: input.title || `Terminal ${id.slice(-4)}`,
      command,
      args,
      cwd,
      status: "running",
      pid: ptyProcess.pid,
    } as const
    const session: ActiveSession = {
      info,
      process: ptyProcess,
      buffer: "",
      bufferCursor: 0,
      cursor: 0,
      subscribers: new Map(),
    }
    state().set(id, session)
    ptyProcess.onData((chunk) => {
      session.cursor += chunk.length

      for (const [key, sub] of session.subscribers.entries()) {
        if (!current(sub)) {
          session.subscribers.delete(key)
          continue
        }

        try {
          sub.ws.send(chunk)
        } catch {
          session.subscribers.delete(key)
        }
      }

      session.buffer += chunk
      if (session.buffer.length <= BUFFER_LIMIT) return
      const excess = session.buffer.length - BUFFER_LIMIT
      session.buffer = session.buffer.slice(excess)
      session.bufferCursor += excess
    })
    ptyProcess.onExit(({ exitCode }) => {
      log.info("session exited", { id, exitCode })
      session.info.status = "exited"
      for (const [key, sub] of session.subscribers.entries()) {
        if (!current(sub)) {
          session.subscribers.delete(key)
          continue
        }
        try {
          sub.ws.close()
        } catch {
          // ignore
        }
      }
      session.subscribers.clear()
      Bus.publish(Event.Exited, { id, exitCode })
      state().delete(id)
    })
    Bus.publish(Event.Created, { info })
    return info
  }

  export async function update(id: string, input: UpdateInput) {
    const session = state().get(id)
    if (!session) return
    if (input.title) {
      session.info.title = input.title
    }
    if (input.size) {
      session.process.resize(input.size.cols, input.size.rows)
    }
    Bus.publish(Event.Updated, { info: session.info })
    return session.info
  }

  export async function remove(id: string) {
    const session = state().get(id)
    if (!session) return
    log.info("removing session", { id })
    try {
      session.process.kill()
    } catch {}
    for (const [key, sub] of session.subscribers.entries()) {
      if (!current(sub)) {
        session.subscribers.delete(key)
        continue
      }
      try {
        sub.ws.close()
      } catch {
        // ignore
      }
    }
    session.subscribers.clear()
    state().delete(id)
    Bus.publish(Event.Deleted, { id })
  }

  export function resize(id: string, cols: number, rows: number) {
    const session = state().get(id)
    if (session && session.info.status === "running") {
      session.process.resize(cols, rows)
    }
  }

  export function write(id: string, data: string) {
    const session = state().get(id)
    if (session && session.info.status === "running") {
      session.process.write(data)
    }
  }

  export function connect(id: string, ws: Socket, cursor?: number) {
    const session = state().get(id)
    if (!session) {
      ws.close()
      return
    }
    log.info("client connected to session", { id })

    for (const other of state().values()) {
      for (const [key, sub] of other.subscribers.entries()) {
        if (sub.ws !== ws) continue
        other.subscribers.delete(key)
      }
    }

    const key = Symbol(id)
    session.subscribers.set(key, {
      ws,
      data: ws.data,
      send: ws.send,
      close: ws.close,
    })

    const cleanup = () => {
      session.subscribers.delete(key)
    }

    const start = session.bufferCursor
    const end = session.cursor

    const from =
      cursor === -1 ? end : typeof cursor === "number" && Number.isSafeInteger(cursor) ? Math.max(0, cursor) : 0

    const data = (() => {
      if (!session.buffer) return ""
      if (from >= end) return ""
      const offset = Math.max(0, from - start)
      if (offset >= session.buffer.length) return ""
      return session.buffer.slice(offset)
    })()

    if (data) {
      try {
        for (let i = 0; i < data.length; i += BUFFER_CHUNK) {
          ws.send(data.slice(i, i + BUFFER_CHUNK))
        }
      } catch {
        cleanup()
        ws.close()
        return
      }
    }

    try {
      ws.send(meta(end))
    } catch {
      cleanup()
      ws.close()
      return
    }
    return {
      onMessage: (message: string | ArrayBuffer) => {
        session.process.write(String(message))
      },
      onClose: () => {
        log.info("client disconnected from session", { id })
        cleanup()
      },
    }
  }
}
