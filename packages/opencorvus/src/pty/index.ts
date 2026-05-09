import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Plugin } from "@/plugin"
import { lazy } from "@opencorvus-ai/util/lazy"
import z from "zod"
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { TerminalProfile } from "./profile"

export namespace Pty {
  const log = Log.create({ service: "pty" })

  const BUFFER_LIMIT = 1024 * 1024 * 2
  const BUFFER_CHUNK = 64 * 1024

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

  const pty = lazy(async () => {
    const { spawn } = await import("bun-pty")
    return spawn as Spawn
  })

  export const Info = z
    .object({
      id: Identifier.schema("pty"),
      profileID: z.string(),
      title: z.string(),
      command: z.string(),
      args: z.array(z.string()),
      cwd: z.string(),
      status: z.enum(["running", "exited"]),
      pid: z.number(),
      cursor: z.number().int().nonnegative(),
    })
    .meta({ ref: "Pty" })

  export type Info = z.infer<typeof Info>

  export const CreateInput = z.object({
    profileID: z.string().min(1),
    cwd: z.string().min(1),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
    title: z.string().optional(),
  })

  export type CreateInput = z.infer<typeof CreateInput>

  export const UpdateInput = z.object({
    title: z.string().optional(),
    size: z
      .object({
        rows: z.number().int().positive(),
        cols: z.number().int().positive(),
      })
      .optional(),
  })

  export type UpdateInput = z.infer<typeof UpdateInput>

  const ClientMessage = z.discriminatedUnion("type", [
    z.object({ type: z.literal("input"), data: z.string() }),
    z.object({ type: z.literal("resize"), cols: z.number().int().positive(), rows: z.number().int().positive() }),
    z.object({ type: z.literal("kill") }),
  ])

  export type ClientMessage = z.infer<typeof ClientMessage>

  export type ServerMessage =
    | { type: "ready"; cursor: number; info: Info }
    | { type: "output"; cursor: number; data: string }
    | { type: "history_truncated"; requestedCursor: number; oldestCursor: number }
    | { type: "exit"; exitCode: number }
    | { type: "error"; message: string }

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

  const state = Instance.state<Map<string, ActiveSession>>(
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
    const profile = await TerminalProfile.resolve(input.profileID)
    const cwd = await TerminalProfile.validateCwd(input.cwd)

    const shellEnv = await Plugin.trigger("shell.env", { cwd }, { env: {} })
    const shellVars = shellEnv.env as Record<string, string>
    const term = profile.env.TERM
    if (!term) {
      throw new TerminalProfile.ConfigError({
        message: `Terminal profile ${profile.id} must configure TERM`,
      })
    }
    const env = {
      ...process.env,
      ...shellVars,
      ...profile.env,
      TERM: term,
      OPENCORVUS_TERMINAL: "1",
    } as Record<string, string>

    if (process.platform === "win32") {
      env.LC_ALL = "C.UTF-8"
      env.LC_CTYPE = "C.UTF-8"
      env.LANG = "C.UTF-8"
    }

    log.info("creating session", { id, profileID: profile.id, cmd: profile.command, args: profile.args, cwd })

    const spawn = await pty()
    const ptyProcess = spawn(profile.command, profile.args, {
      name: term,
      cwd,
      env,
    })
    ptyProcess.resize(input.cols, input.rows)

    const info: Info = {
      id,
      profileID: profile.id,
      title: input.title ?? profile.label,
      command: profile.command,
      args: profile.args,
      cwd,
      status: "running",
      pid: ptyProcess.pid,
      cursor: 0,
    }
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
      session.info.cursor = session.cursor

      for (const [key, sub] of session.subscribers.entries()) {
        if (!current(sub)) {
          session.subscribers.delete(key)
          continue
        }

        try {
          send(sub.ws, { type: "output", cursor: session.cursor, data: chunk })
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
      if (session.info.status === "exited") return
      log.info("session exited", { id, exitCode })
      session.info.status = "exited"
      for (const [key, sub] of session.subscribers.entries()) {
        if (!current(sub)) {
          session.subscribers.delete(key)
          continue
        }
        try {
          send(sub.ws, { type: "exit", exitCode })
        } catch {
          session.subscribers.delete(key)
        }
      }
      Bus.publish(Event.Exited, { id, exitCode })
      void remove(id)
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
    state().delete(id)
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

    try {
      send(ws, { type: "ready", cursor: end, info: session.info })
      if (from < start) {
        send(ws, { type: "history_truncated", requestedCursor: from, oldestCursor: start })
      }
    } catch {
      cleanup()
      ws.close()
      return
    }

    const data = (() => {
      if (!session.buffer) return ""
      if (from >= end) return ""
      const offset = Math.max(0, from - start)
      if (offset >= session.buffer.length) return ""
      return session.buffer.slice(offset)
    })()

    if (data) {
      try {
        const replayStart = Math.max(from, start)
        for (let i = 0; i < data.length; i += BUFFER_CHUNK) {
          const chunk = data.slice(i, i + BUFFER_CHUNK)
          send(ws, { type: "output", cursor: replayStart + i + chunk.length, data: chunk })
        }
      } catch {
        cleanup()
        ws.close()
        return
      }
    }

    return {
      onMessage: (message: string | ArrayBuffer) => {
        const raw = typeof message === "string" ? message : Buffer.from(message).toString("utf8")
        const parsed = parseClientMessage(raw)
        if (!parsed.success) {
          send(ws, { type: "error", message: parsed.message })
          ws.close(1002, parsed.message)
          cleanup()
          return
        }
        if (session.info.status !== "running") {
          send(ws, { type: "error", message: "Terminal session has exited" })
          ws.close(1008, "Terminal session has exited")
          cleanup()
          return
        }
        if (parsed.message.type === "input") {
          session.process.write(parsed.message.data)
        } else if (parsed.message.type === "resize") {
          session.process.resize(parsed.message.cols, parsed.message.rows)
        } else {
          void remove(id)
        }
      },
      onClose: () => {
        log.info("client disconnected from session", { id })
        cleanup()
      },
    }
  }

  function send(ws: Socket, message: ServerMessage) {
    ws.send(JSON.stringify(message))
  }

  function parseClientMessage(raw: string):
    | { success: true; message: ClientMessage }
    | { success: false; message: string } {
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      return { success: false, message: "Terminal WebSocket message must be JSON" }
    }
    const parsed = ClientMessage.safeParse(json)
    if (!parsed.success) {
      return { success: false, message: parsed.error.issues.map((issue) => issue.message).join("; ") }
    }
    return { success: true, message: parsed.data }
  }
}
