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
import { streamSSE } from "hono/streaming"
import z from "zod"
import { errors } from "../error"
import { ProjectRoutes } from "./project"
import { ConfigRoutes } from "./config"
import { ExperimentalRoutes } from "./experimental"
import { SessionRoutes } from "./session"
import { PermissionRoutes } from "./permission"
import { QuestionRoutes } from "./question"
import { ChannelRoutes } from "./channel"
import { ExecutorRoutes } from "./executor"
import { ProviderRoutes } from "./provider"
import { FileRoutes } from "./file"
import { McpRoutes } from "./mcp"
import { SkillRoutes } from "./skill"
import { TuiRoutes } from "./tui"
import { ExportRoutes } from "./export"
import { EngineRoutes } from "./orchestrator"
import { PanelRoutes } from "./panel"
import { ControlRoutes } from "./control"
import { CodingRoutes } from "./coding"
import { TerminalRoutes } from "./terminal"
import { AttachmentRoutes } from "./attachment"
import { GatewayRoutes } from "./gateway"
import { MissionRoutes } from "./mission"
import { hasServerShutdownHandler, requestServerShutdown } from "../shutdown"
import { Env } from "@/runtime/env"

const log = Log.create({ service: "server" })

export const AppDocumentation = {
  info: {
    title: "opencorvus",
    version: "0.0.1-alpha",
    description: "opencorvus api",
  },
  openapi: "3.1.1",
} as const

export function AppRoutes(root: Hono) {
  return new Hono()
    .get(
      "/doc",
      openAPIRouteHandler(root, {
        documentation: AppDocumentation,
      }),
    )
    .use(validator("query", z.object({ directory: z.string().optional() })))
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
    .route("/panel", PanelRoutes())
    .route("/control", ControlRoutes())
    .route("/coding", CodingRoutes())
    .route("/gateway", GatewayRoutes())
    .route("/mission", MissionRoutes())
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
        },
      }),
      async (c) => {
        if (!hasServerShutdownHandler()) {
          log.warn("restart requested without registered shutdown handler")
          return c.json({ ok: false }, 503)
        }
        log.info("restart requested, spawning new process")
        const argv = process.argv
        const child = Bun.spawn(argv, {
          cwd: process.cwd(),
          env: Env.snapshot(),
          stdio: ["ignore", "ignore", "ignore"],
        })
        child.unref()
        setTimeout(() => {
          requestServerShutdown("server.restart")
        }, 25)
        return c.json({ ok: true })
      },
    )
    .route("/", EngineRoutes())
    .route("/export", ExportRoutes())
    .route("/", FileRoutes())
    .route("/attachment", AttachmentRoutes())
    .route("/mcp", McpRoutes())
    .route("/tui", TuiRoutes())
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
        },
      }),
      async (c) => {
        const { hasActiveSessions } = await import("@/engine/runtime")
        if (hasActiveSessions()) {
          return c.json({ error: "Active executor sessions exist, skipping dispose" }, 409)
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
          ...errors(400),
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
                schema: resolver(
                  z.object({
                    path: z.string(),
                    lines: z.string().array(),
                  }),
                ),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          directory: z.string().optional(),
          n: z.coerce.number().int().min(1).max(5000).default(500),
        }),
      ),
      async (c) => {
        const n = c.req.valid("query").n
        const logFile = Log.file()
        if (!logFile) {
          return c.json({ path: "", lines: [] })
        }
        try {
          const content = await Bun.file(logFile).text()
          const all = content.split("\n")
          const lines = all.slice(-n).filter((line) => line.length > 0)
          return c.json({ path: logFile, lines })
        } catch {
          return c.json({ path: logFile, lines: [] })
        }
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
          stream.writeSSE({
            data: JSON.stringify({
              type: "server.connected",
              properties: {},
            }),
          })
          const unsub = Bus.subscribeAll(async (event) => {
            await stream.writeSSE({
              data: JSON.stringify(event),
            })
            if (event.type === Bus.InstanceDisposed.type) {
              stream.close()
            }
          })

          const heartbeat = setInterval(() => {
            stream.writeSSE({
              data: JSON.stringify({
                type: "server.heartbeat",
                properties: {},
              }),
            })
          }, 10_000)

          await new Promise<void>((resolve) => {
            stream.onAbort(() => {
              clearInterval(heartbeat)
              unsub()
              resolve()
              log.info("event disconnected")
            })
          })
        })
      },
    )
}
