import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Agent } from "@/agent/agent"
import { Global } from "@/global"
import { Vcs } from "@/project/vcs"
import { Instance } from "@/project/instance"
import { LSP } from "@/lsp"
import { Command } from "@/command"
import { Format } from "@/format"
import { Log } from "@/util/log"
import { Hono } from "hono"
import { describeRoute, openAPIRouteHandler, resolver, validator } from "hono-openapi"
import { streamSSE } from "../sse"
import z from "zod"
import { ActiveExecutorSessionsResponse, errors, namedErrorResponse } from "../error"
import { ProjectRoutes } from "./project"
import { ConfigRoutes } from "./config"
import { ExperimentalRoutes, resetExperimentalRouteFactoriesForOpenApi } from "./experimental"
import { SessionRoutes } from "./session"
import { PermissionRoutes } from "./permission"
import { QuestionRoutes } from "./question"
import { ChannelRoutes } from "./channel"
import { ExecutorRoutes } from "./executor"
import { ProviderRoutes } from "./provider"
import { FileRoutes } from "./file"
import { McpRoutes } from "./mcp"
import { SkillRoutes } from "./skill"
import { ExpertSquadRoutes } from "./expert-squad"
import { PtyRoutes } from "./pty"
import { ExportRoutes } from "./export"
import { EngineRoutes } from "./orchestrator"
import { PanelRoutes } from "./panel"
import { ControlRoutes } from "./control"
import { CodingRoutes } from "./coding"
import { TerminalRoutes } from "./terminal"
import { AttachmentRoutes } from "./attachment"
import { GatewayRoutes } from "./gateway"
import { MissionRoutes } from "./mission"
import { BrowserPreviewRoutes } from "./browser-preview"
import { PluginRoutes } from "./plugin"
import { QuickNoteRoutes } from "@/quicknote/routes"
import "@/tool/goal-report-event"
import { hasServerShutdownHandler, requestServerShutdown } from "../shutdown"
import { startServerRestart } from "../restart"
import { AppDocumentation } from "./documentation"
import { serverErrorResponse } from "../error-handler"
import { Event as ServerEvent, payload as serverEventPayload } from "../event"

const log = Log.create({ service: "server" })
const ShutdownUnavailableResponse = {
  description: "Shutdown handler unavailable",
  content: {
    "application/json": {
      schema: resolver(z.object({ ok: z.boolean() })),
    },
  },
} as const

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

const LogReadResponse = z.object({
  directory: z.string(),
  path: z.string(),
  file: z.string(),
  lines: z.string().array(),
})
const LogFileInfo = z.object({
  name: z.string(),
  path: z.string(),
  size: z.number(),
  modified: z.string(),
  current: z.boolean(),
})
const LogFilesResponse = z.object({
  directory: z.string(),
  current: z.string(),
  files: LogFileInfo.array(),
})
const LogReadQuery = z.object({
  file: Log.FileName.optional(),
  n: z.coerce.number().int().min(1).max(5000).default(500),
})

export function resetAppRouteFactoriesForOpenApi() {
  ProjectRoutes.reset()
  ConfigRoutes.reset()
  ChannelRoutes.reset()
  ExecutorRoutes.reset()
  resetExperimentalRouteFactoriesForOpenApi()
  SessionRoutes.reset()
  PermissionRoutes.reset()
  QuestionRoutes.reset()
  ProviderRoutes.reset()
  QuickNoteRoutes.reset()
  BrowserPreviewRoutes.reset()
  EngineRoutes.reset()
  ExportRoutes.reset()
  FileRoutes.reset()
  AttachmentRoutes.reset()
  McpRoutes.reset()
  PtyRoutes.reset()
}

export function AppRoutes(root: Hono) {
  return new Hono()
    .onError(serverErrorResponse)
    .get(
      "/doc",
      openAPIRouteHandler(root, {
        documentation: AppDocumentation,
      }),
    )
    .route("/project", ProjectRoutes())
    .route("/terminal", TerminalRoutes())
    .route("/config", ConfigRoutes())
    .route("/channel", ChannelRoutes())
    .route("/executor", ExecutorRoutes())
    .route("/experimental", ExperimentalRoutes())
    .route("/session", SessionRoutes())
    .route("/permission", PermissionRoutes())
    .route("/question", QuestionRoutes())
    .route("/provider", ProviderRoutes())
    .route("/skill", SkillRoutes())
    .route("/expert-squad", ExpertSquadRoutes())
    .route("/panel", PanelRoutes())
    .route("/control", ControlRoutes())
    .route("/coding", CodingRoutes())
    .route("/gateway", GatewayRoutes())
    .route("/mission", MissionRoutes())
    .route("/api/v1", QuickNoteRoutes())
    .route("/", BrowserPreviewRoutes())
    .post(
      "/shutdown",
      describeRoute({
        summary: "Shutdown the server",
        description: "Gracefully abort live execution state and stop the current process.",
        operationId: "server.shutdown",
        responses: {
          200: {
            description: "Shutdown initiated",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean() })),
              },
            },
          },
          503: ShutdownUnavailableResponse,
        },
      }),
      async (c) => {
        if (!hasServerShutdownHandler()) {
          log.warn("shutdown requested without registered shutdown handler")
          return c.json({ ok: false }, 503)
        }
        log.info("shutdown requested")
        setTimeout(() => {
          requestServerShutdown("http.shutdown")
        }, 25)
        return c.json({ ok: true })
      },
    )
    .post(
      "/restart",
      describeRoute({
        summary: "Restart the server",
        description: "Spawn a new server process with the same arguments, then exit.",
        operationId: "server.restart",
        responses: {
          200: {
            description: "Restart initiated",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean() })),
              },
            },
          },
          503: ShutdownUnavailableResponse,
        },
      }),
      async (c) => {
        if (!hasServerShutdownHandler()) {
          log.warn("restart requested without registered shutdown handler")
          return c.json({ ok: false }, 503)
        }
        log.info("restart requested, spawning new process")
        startServerRestart("server.restart")
        return c.json({ ok: true })
      },
    )
    .route("/", EngineRoutes())
    .route("/export", ExportRoutes())
    .route("/", FileRoutes())
    .route("/attachment", AttachmentRoutes())
    .route("/mcp", McpRoutes())
    .route("/pty", PtyRoutes())
    .route("/plugin", PluginRoutes())
    .post(
      "/instance/dispose",
      describeRoute({
        summary: "Dispose instance",
        description: "Clean up and dispose the current OpenCorvus instance, releasing all resources.",
        operationId: "instance.dispose",
        responses: {
          200: {
            description: "Instance disposed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          409: ActiveExecutorSessionsResponse,
        },
      }),
      async (c) => {
        const { activeExecutorSessionsError, hasActiveSessions } = await import("@/engine/runtime")
        if (hasActiveSessions()) {
          throw activeExecutorSessionsError("instance.dispose")
        }
        await Instance.dispose()
        return c.json(true)
      },
    )
    .get(
      "/path",
      describeRoute({
        summary: "Get paths",
        description: "Retrieve the current working directory and related path information for the OpenCorvus instance.",
        operationId: "path.get",
        responses: {
          200: {
            description: "Path",
            content: {
              "application/json": {
                schema: resolver(
                  z
                    .object({
                      home: z.string(),
                      state: z.string(),
                      config: z.string(),
                      worktree: z.string(),
                      directory: z.string(),
                    })
                    .meta({
                      ref: "Path",
                    }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({
          home: Global.Path.home,
          state: Global.Path.state,
          config: Global.Path.config,
          worktree: Instance.worktree,
          directory: Instance.directory,
        })
      },
    )
    .get(
      "/vcs",
      describeRoute({
        summary: "Get VCS info",
        description:
          "Retrieve version control system (VCS) information for the current project, such as git branch and working tree status.",
        operationId: "vcs.get",
        responses: {
          200: {
            description: "VCS info",
            content: {
              "application/json": {
                schema: resolver(Vcs.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Vcs.info())
      },
    )
    .get(
      "/vcs/diff",
      describeRoute({
        summary: "Get VCS diff",
        description: "Retrieve the current git diff for the working tree or against the default branch.",
        operationId: "vcs.diff",
        responses: {
          200: {
            description: "VCS diff",
            content: {
              "application/json": {
                schema: resolver(Vcs.FileDiff.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          mode: Vcs.Mode.default("git"),
          context: z.coerce.number().int().nonnegative().optional(),
          directory: z.string().optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        return c.json(await Vcs.diff(query.mode, { context: query.context }))
      },
    )
    .get(
      "/command",
      describeRoute({
        summary: "List commands",
        description: "Get a list of all available commands in the OpenCorvus system.",
        operationId: "command.list",
        responses: {
          200: {
            description: "List of commands",
            content: {
              "application/json": {
                schema: resolver(Command.Info.array()),
              },
            },
          },
          500: namedErrorResponse("Command list failed", "UnknownError"),
        },
      }),
      async (c) => {
        const commands = await Command.list()
        return c.json(commands)
      },
    )
    .post(
      "/log",
      describeRoute({
        summary: "Write log",
        description: "Write a log entry to the server logs with specified level and metadata.",
        operationId: "app.log",
        responses: {
          200: {
            description: "Log entry written successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "json",
        z.object({
          service: z.string().meta({ description: "Service name for the log entry" }),
          level: z.enum(["debug", "info", "error", "warn"]).meta({ description: "Log level" }),
          message: z.string().meta({ description: "Log message" }),
          extra: z
            .record(z.string(), z.unknown())
            .optional()
            .meta({ description: "Additional metadata for the log entry" }),
        }),
      ),
      async (c) => {
        const { service, level, message, extra } = c.req.valid("json")
        const logger = Log.create({ service })

        switch (level) {
          case "debug":
            logger.debug(message, extra)
            break
          case "info":
            logger.info(message, extra)
            break
          case "error":
            logger.error(message, extra)
            break
          case "warn":
            logger.warn(message, extra)
            break
        }

        return c.json(true)
      },
    )
    .get(
      "/log",
      describeRoute({
        summary: "Read logs",
        description: "Read the last N lines from the current or named server log file in the unified log directory.",
        operationId: "log.read",
        responses: {
          200: {
            description: "Log lines",
            content: {
              "application/json": {
                schema: resolver(LogReadResponse),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("query", LogReadQuery),
      async (c) => {
        const query = c.req.valid("query")
        return c.json(await Log.read({ file: query.file, lines: query.n }))
      },
    )
    .get(
      "/log/files",
      describeRoute({
        summary: "List log files",
        description: "List server log files from the unified log directory.",
        operationId: "log.files",
        responses: {
          200: {
            description: "Log files",
            content: {
              "application/json": {
                schema: resolver(LogFilesResponse),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({
          directory: Log.directory(),
          current: Log.file(),
          files: await Log.files(),
        })
      },
    )
    .get(
      "/log/tail",
      describeRoute({
        summary: "Read recent logs",
        description: "Read the last N lines from the current server log file.",
        operationId: "log.tail",
        responses: {
          200: {
            description: "Log lines",
            content: {
              "application/json": {
                schema: resolver(LogReadResponse),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator(
        "query",
        z.object({
          n: z.coerce.number().int().min(1).max(5000).default(500),
        }),
      ),
      async (c) => {
        const n = c.req.valid("query").n
        return c.json(await Log.read({ lines: n }))
      },
    )
    .get(
      "/agent",
      describeRoute({
        summary: "List agents",
        description: "Get a list of all available AI agents in the OpenCorvus system.",
        operationId: "app.agents",
        responses: {
          200: {
            description: "List of agents",
            content: {
              "application/json": {
                schema: resolver(Agent.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const modes = await Agent.list()
        return c.json(modes)
      },
    )
    .get(
      "/lsp",
      describeRoute({
        summary: "Get LSP status",
        description: "Get LSP server status",
        operationId: "lsp.status",
        responses: {
          200: {
            description: "LSP server status",
            content: {
              "application/json": {
                schema: resolver(LSP.Status.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await LSP.status())
      },
    )
    .get(
      "/formatter",
      describeRoute({
        summary: "Get formatter status",
        description: "Get formatter status",
        operationId: "formatter.status",
        responses: {
          200: {
            description: "Formatter status",
            content: {
              "application/json": {
                schema: resolver(Format.Status.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Format.status())
      },
    )
    .get(
      "/event",
      describeRoute({
        summary: "Subscribe to events",
        description: "Get events",
        operationId: "event.subscribe",
        responses: {
          200: {
            description: "Event stream",
            content: {
              "text/event-stream": {
                schema: resolver(BusEvent.payloads()),
              },
            },
          },
        },
      }),
      async (c) => {
        log.info("event connected")
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")
        return streamSSE(c, async (stream) => {
          let heartbeat: ReturnType<typeof setInterval> | undefined
          let unsub = () => {}
          let finishStream = () => {}
          let closed = false
          const cleanup = (input?: { closeStream?: boolean; error?: unknown }) => {
            if (closed) return
            closed = true
            if (heartbeat) clearInterval(heartbeat)
            unsub()
            if (input?.error) {
              log.warn("event stream write failed", { error: errorMessage(input.error) })
            }
            if (input?.closeStream) stream.close()
            finishStream()
          }
          const finished = new Promise<void>((resolve) => {
            finishStream = resolve
          })
          const writeData = (data: string) => {
            if (closed) return Promise.resolve()
            return stream.writeSSE({ data }).catch((error) => {
              cleanup({ closeStream: true, error })
            })
          }
          await writeData(JSON.stringify(serverEventPayload(ServerEvent.Connected, {})))
          if (closed) return
          unsub = Bus.subscribeAll((event) => {
            void writeData(JSON.stringify(event))
            if (event.type === Bus.InstanceDisposed.type) {
              cleanup({ closeStream: true })
            }
          })

          heartbeat = setInterval(() => {
            void writeData(JSON.stringify(serverEventPayload(ServerEvent.Heartbeat, {})))
          }, 10_000)

          stream.onAbort(() => {
            cleanup()
            log.info("event disconnected")
          })
          await finished
        })
      },
    )
}
