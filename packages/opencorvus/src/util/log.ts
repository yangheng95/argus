import path from "path"
import fs from "fs/promises"
import pino, { type Logger as PinoLogger } from "pino"
import { Global } from "../global"
import z from "zod"
import { Glob } from "./glob"
import { sanitizeMessage } from "./log-safety"
import { SessionObservability } from "./session-observability"

export namespace Log {
  export const Level = z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).meta({ ref: "LogLevel", description: "Log level" })
  export type Level = z.infer<typeof Level>

  type PinoLevel = "debug" | "info" | "warn" | "error"

  const pinoLevel: Record<Level, PinoLevel> = {
    DEBUG: "debug",
    INFO: "info",
    WARN: "warn",
    ERROR: "error",
  }

  export type Logger = {
    debug(message?: any, extra?: Record<string, any>): void
    info(message?: any, extra?: Record<string, any>): void
    error(message?: any, extra?: Record<string, any>): void
    warn(message?: any, extra?: Record<string, any>): void
    tag(key: string, value: string): Logger
    clone(): Logger
    time(
      message: string,
      extra?: Record<string, any>,
    ): {
      stop(): void
      [Symbol.dispose](): void
    }
  }

  export interface Options {
    print: boolean
    dev?: boolean
    level?: Level
  }

  let level: Level = "INFO"
  let logpath = ""
  let generation = 0
  let root = createRootLogger(pino.destination(2))

  export const Default = create({ service: "default" })
  export const FileName = z.string().regex(/^[^/\\:]+\.log$/, {
    message: "Log file must be a .log file name without path separators or drive/name-stream separators",
  })

  export type FileName = z.infer<typeof FileName>

  export type FileInfo = {
    name: string
    path: string
    size: number
    modified: string
    current: boolean
  }

  export type ReadResult = {
    directory: string
    path: string
    file: string
    lines: string[]
  }

  export function directory() {
    return Global.Path.log
  }

  export function file() {
    return logpath
  }

  export async function init(options: Options) {
    if (options.level) level = options.level
    await cleanup(directory())
    logpath = ""
    let destination: pino.DestinationStream
    if (options.print) {
      destination = pino.destination(2)
    } else {
      logpath = path.join(
        directory(),
        options.dev ? "dev.log" : new Date().toISOString().split(".")[0].replace(/:/g, "") + ".log",
      )
      await fs.truncate(logpath).catch(() => {})
      destination = pino.destination({ dest: logpath, sync: false, mkdir: true })
    }
    root = createRootLogger(destination)
    generation++
  }

  const KEEP_RECENT = 10
  async function cleanup(dir: string) {
    const files = await Glob.scan("????-??-??T??????.log", {
      cwd: dir,
      absolute: true,
      include: "file",
    })
    if (files.length <= KEEP_RECENT) return
    const filesToDelete = files.slice(0, -KEEP_RECENT)
    await Promise.all(filesToDelete.map((file) => fs.unlink(file).catch(() => {})))
  }

  export async function files(): Promise<FileInfo[]> {
    const dir = directory()
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return []
      throw error
    })
    const list = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && FileName.safeParse(entry.name).success)
        .map(async (entry) => {
          const pathname = path.join(dir, entry.name)
          const stat = await fs.stat(pathname)
          return {
            name: entry.name,
            path: pathname,
            size: stat.size,
            modified: stat.mtime.toISOString(),
            current: pathname === logpath,
          } satisfies FileInfo
        }),
    )
    return list.sort((left, right) => right.modified.localeCompare(left.modified))
  }

  export async function read(input: { file?: FileName; lines: number }): Promise<ReadResult> {
    const dir = directory()
    const pathname = input.file ? path.join(dir, input.file) : logpath
    if (!pathname) {
      return {
        directory: dir,
        path: "",
        file: "",
        lines: [],
      }
    }
    const content = await fs.readFile(pathname, "utf8").catch((error) => {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return ""
      throw error
    })
    const lines = content.split("\n").filter((line) => line.length > 0).slice(-input.lines)
    return {
      directory: dir,
      path: pathname,
      file: path.basename(pathname),
      lines,
    }
  }

  function createRootLogger(destination: pino.DestinationStream) {
    return pino(
      {
        base: undefined,
        level: pinoLevel[level],
        messageKey: "message",
        errorKey: "error",
        timestamp: pino.stdTimeFunctions.isoTime,
        formatters: {
          level(label) {
            return { level: label }
          },
        },
        serializers: {
          error: pino.stdSerializers.err,
          err: pino.stdSerializers.err,
        },
      },
      destination,
    )
  }

  function sanitizeRecord(input?: Record<string, any>): Record<string, any> {
    if (!input) return {}
    const output: Record<string, any> = {}
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined || value === null) continue
      output[key] = typeof value === "string" ? sanitizeMessage(value) : value
    }
    return output
  }

  function emit(logger: PinoLogger, level: PinoLevel, message: any, extra?: Record<string, any>) {
    const attributes = {
      ...sanitizeRecord(extra),
      ...sanitizeRecord(SessionObservability.logTags()),
    }
    const safeMessage = message === undefined || message === null ? undefined : sanitizeMessage(message)
    logger[level](attributes, safeMessage)
  }

  export function create(tags?: Record<string, any>) {
    const ownTags = sanitizeRecord(tags)
    let cachedGeneration = -1
    let cachedLogger: PinoLogger | undefined

    function logger() {
      if (!cachedLogger || cachedGeneration !== generation) {
        cachedLogger = root.child(ownTags)
        cachedGeneration = generation
      }
      return cachedLogger
    }

    const result: Logger = {
      debug(message?: any, extra?: Record<string, any>) {
        emit(logger(), "debug", message, extra)
      },
      info(message?: any, extra?: Record<string, any>) {
        emit(logger(), "info", message, extra)
      },
      error(message?: any, extra?: Record<string, any>) {
        emit(logger(), "error", message, extra)
      },
      warn(message?: any, extra?: Record<string, any>) {
        emit(logger(), "warn", message, extra)
      },
      tag(key: string, value: string) {
        return Log.create({ ...ownTags, [key]: value })
      },
      clone() {
        return Log.create({ ...ownTags })
      },
      time(message: string, extra?: Record<string, any>) {
        const now = Date.now()
        result.info(message, { status: "started", ...extra })
        let stopped = false
        function stop() {
          if (stopped) return
          stopped = true
          result.info(message, {
            status: "completed",
            duration: Date.now() - now,
            ...extra,
          })
        }
        return {
          stop,
          [Symbol.dispose]() {
            stop()
          },
        }
      },
    }

    return result
  }
}
