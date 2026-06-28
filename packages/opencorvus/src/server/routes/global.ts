import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { streamSSE } from "../sse"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Event as ServerEvent, globalEnvelope } from "../event"
import "@/tool/goal-report-event"
import { Instance } from "../../project/instance"
import { Project } from "../../project/project"
import { Installation } from "@/installation"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { Config } from "../../config/config"
import { Database } from "../../storage/db"
import { ActiveExecutorSessionsResponse, errors } from "../error"
import { canRestartServer, startServerRestart } from "../restart"
import { closeBrowserPreviewLiveSessions } from "@/browser-preview/live"
import {
  MysqlTransferFullExport,
  MysqlTransferImportResult,
  MysqlTransferSchemaExport,
  MysqlTransferSnapshot,
  exportMysqlTransferPackage,
  importMysqlTransferSnapshot,
  mysqlSchemaExport,
} from "@/storage/mysql-transfer"

const log = Log.create({ service: "server" })

const DatabaseResetRequest = z
  .object({
    database: z.string().trim().min(1),
  })
  .strict()

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function badRequest(message: string) {
  return {
    success: false as const,
    data: { message },
    errors: [{ message }],
  }
}

export const GlobalRoutes = lazy(() =>
  new Hono()
    .get(
      "/health",
      describeRoute({
        summary: "Get health",
        description:
          "Get health information about the OpenCorvus server, including the runtime-resolved on-disk paths the engine is actually using (database, data dir, home). The DB path is resolved by `Database.Path()` and is the current SQLite location for this server process — UIs should read this rather than rebuilding the path from a template.",
        operationId: "global.health",
        responses: {
          200: {
            description: "Health information",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    healthy: z.literal(true),
                    version: z.string(),
                    paths: z.object({
                      database: z.string(),
                      data: z.string(),
                      home: z.string(),
                    }),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const { Global } = await import("../../global")
        return c.json({
          healthy: true as const,
          version: Installation.VERSION,
          paths: {
            database: Database.Path(),
            data: Global.Path.data,
            home: Global.Path.home,
          },
        })
      },
    )
    .get(
      "/projects/discover",
      describeRoute({
        summary: "Discover local OpenCorvus projects",
        description:
          "Scan the server launch directory and its direct child directories for projects containing a .opencorvus directory. This is a control-plane discovery route and does not require an active project directory.",
        operationId: "global.projects.discover",
        responses: {
          200: {
            description: "Discovered projects",
            content: {
              "application/json": {
                schema: resolver(Project.Discovery),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => c.json(await Project.discoverFromLaunchDirectory()),
    )
    .get(
      "/event",
      describeRoute({
        summary: "Get global events",
        description: "Subscribe to global events from the OpenCorvus system using server-sent events.",
        operationId: "global.event",
        responses: {
          200: {
            description: "Event stream",
            content: {
              "text/event-stream": {
                schema: resolver(
                  z
                    .object({
                      directory: z.string(),
                      payload: BusEvent.payloads(),
                    })
                    .meta({
                      ref: "GlobalEvent",
                    }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        log.info("global event connected")
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")
        return streamSSE(c, async (stream) => {
          let heartbeat: ReturnType<typeof setInterval> | undefined
          let finishStream = () => {}
          let closed = false
          const cleanup = (input?: { closeStream?: boolean; error?: unknown }) => {
            if (closed) return
            closed = true
            if (heartbeat) clearInterval(heartbeat)
            GlobalBus.off("event", handler)
            if (input?.error) {
              log.warn("global event stream write failed", { error: errorMessage(input.error) })
            }
            if (input?.closeStream) stream.close()
            finishStream()
          }
          const finished = new Promise<void>((resolve) => {
            finishStream = resolve
          })
          let handler = (_event: any) => {}
          const writeData = (data: string) => {
            if (closed) return Promise.resolve()
            return stream.writeSSE({ data }).catch((error) => {
              cleanup({ closeStream: true, error })
            })
          }
          handler = (event: any) => {
            void writeData(JSON.stringify(event))
          }
          await writeData(JSON.stringify(globalEnvelope("global", ServerEvent.Connected, {})))
          if (closed) return
          GlobalBus.on("event", handler)

          // Send heartbeat every 10s to prevent stalled proxy streams.
          heartbeat = setInterval(() => {
            void writeData(JSON.stringify(globalEnvelope("global", ServerEvent.Heartbeat, {})))
          }, 10_000)

          stream.onAbort(() => {
            cleanup()
            log.info("global event disconnected")
          })
          await finished
        })
      },
    )
    .get(
      "/config",
      describeRoute({
        summary: "Get global configuration",
        description: "Retrieve the current global OpenCorvus configuration settings and preferences.",
        operationId: "global.config.get",
        responses: {
          200: {
            description: "Get global config info",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Config.getGlobal())
      },
    )
    .patch(
      "/config",
      describeRoute({
        summary: "Update global configuration",
        description: "Update global OpenCorvus configuration settings and preferences.",
        operationId: "global.config.update",
        responses: {
          200: {
            description: "Successfully updated global config",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Config.Info),
      async (c) => {
        const config = c.req.valid("json")
        const next = await Config.updateGlobal(config)
        return c.json(next)
      },
    )
    .post(
      "/dispose",
      describeRoute({
        summary: "Dispose instance",
        description: "Clean up and dispose all OpenCorvus instances, releasing all resources.",
        operationId: "global.dispose",
        responses: {
          200: {
            description: "Global disposed",
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
        const { activeExecutorSessionsError, hasAnyActiveSessions } = await import("@/engine/runtime")
        if (hasAnyActiveSessions()) {
          throw activeExecutorSessionsError("global.dispose")
        }
        await closeBrowserPreviewLiveSessions()
        await Instance.disposeAll()
        GlobalBus.emit("event", {
          directory: "global",
          payload: {
            type: ServerEvent.Disposed.type,
            properties: {},
          },
        })
        return c.json(true)
      },
    )
    .post(
      "/db/reset",
      describeRoute({
        summary: "Reset database",
        description:
          "DESTRUCTIVE. The caller must send the current DB path reported by /global/health. The server verifies that it exactly matches Database.Path(), refuses active executor sessions, disposes all in-memory Instance handles, closes SQLite, deletes the current DB file with WAL/SHM, then spawns a replacement server process so schema is rebuilt from DDL on startup. The route does not read SQLite state before deletion, so it remains usable when schema drift or DB corruption requires an explicit file reset.",
        operationId: "global.db.reset",
        responses: {
          200: {
            description: "Reset results",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    ok: z.boolean(),
                    restarting: z.boolean(),
                    targets: z.array(
                      z.object({
                        label: z.string(),
                        path: z.string(),
                        ok: z.boolean(),
                        error: z.string().optional(),
                      }),
                    ),
                  }),
                ),
              },
            },
          },
          500: {
            description: "Database file deletion failed",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    ok: z.literal(false),
                    restarting: z.literal(false),
                    targets: z.array(
                      z.object({
                        label: z.string(),
                        path: z.string(),
                        ok: z.boolean(),
                        error: z.string().optional(),
                      }),
                    ),
                  }),
                ),
              },
            },
          },
          503: {
            description: "Server restart handler is not registered",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    ok: z.literal(false),
                    error: z.string(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
          409: ActiveExecutorSessionsResponse,
        },
      }),
      validator("json", DatabaseResetRequest),
      async (c) => {
        const { database } = c.req.valid("json")
        const currentDatabase = Database.Path()
        if (database !== currentDatabase) {
          return c.json(
            badRequest(`DB reset target must match current Database.Path(): expected ${currentDatabase}`),
            400,
          )
        }
        if (!canRestartServer()) {
          log.warn("db reset requested without registered restart handler")
          return c.json({ ok: false, error: "Server restart handler is not registered; refusing DB reset" }, 503)
        }
        const { activeExecutorSessionsError, hasAnyActiveSessions } = await import("@/engine/runtime")
        if (Database.hasOpenConnection() && hasAnyActiveSessions()) {
          throw activeExecutorSessionsError("global.db.reset")
        }
        await Instance.disposeAll()
        const targets = await Database.resetFiles(database)
        const ok = targets.every((t) => t.ok)
        log.warn("db reset via /global/db/reset", { database, targets, restarting: ok })
        if (!ok) return c.json({ ok: false, restarting: false, targets }, 500)
        startServerRestart("server.restart")
        return c.json({ ok: true, restarting: true, targets })
      },
    )
    .get(
      "/db/mysql/schema",
      describeRoute({
        summary: "Export MySQL staging schema",
        description:
          "Export the current OpenCorvus SQLite table shape as MySQL-compatible staging DDL plus the strict transfer schema fingerprint used by /global/db/mysql/import.",
        operationId: "global.db.mysql.schema",
        responses: {
          200: {
            description: "MySQL transfer schema",
            content: {
              "application/json": {
                schema: resolver(MysqlTransferSchemaExport),
              },
            },
          },
        },
      }),
      async (c) => c.json(mysqlSchemaExport()),
    )
    .get(
      "/db/mysql/export",
      describeRoute({
        summary: "Export MySQL transfer snapshot",
        description:
          "Export MySQL-compatible staging DDL and a strict JSON snapshot of the current SQLite data. The snapshot can be posted back to /global/db/mysql/import to rebuild the local DB.",
        operationId: "global.db.mysql.export",
        responses: {
          200: {
            description: "MySQL transfer package",
            content: {
              "application/json": {
                schema: resolver(MysqlTransferFullExport),
              },
            },
          },
        },
      }),
      async (c) => c.json(exportMysqlTransferPackage()),
    )
    .post(
      "/db/mysql/import",
      describeRoute({
        summary: "Import MySQL transfer snapshot",
        description:
          "DESTRUCTIVE. Rebuild the local SQLite DB from a strict MySQL transfer snapshot. This does not make MySQL a runtime DB; it is a one-shot transfer/import surface.",
        operationId: "global.db.mysql.import",
        responses: {
          200: {
            description: "Import result",
            content: {
              "application/json": {
                schema: resolver(MysqlTransferImportResult),
              },
            },
          },
          ...errors(400),
          409: ActiveExecutorSessionsResponse,
        },
      }),
      validator("json", z.object({ snapshot: MysqlTransferSnapshot })),
      async (c) => {
        const { activeExecutorSessionsError, hasAnyActiveSessions } = await import("@/engine/runtime")
        if (hasAnyActiveSessions()) {
          throw activeExecutorSessionsError("global.db.mysql.import")
        }
        await Instance.disposeAll()
        const { snapshot } = c.req.valid("json")
        let result: MysqlTransferImportResult
        try {
          result = importMysqlTransferSnapshot(snapshot)
        } catch (err) {
          return c.json(
            {
              success: false as const,
              data: { message: err instanceof Error ? err.message : String(err) },
              errors: [],
            },
            400,
          )
        }
        log.warn("db import via /global/db/mysql/import", {
          schemaFingerprint: result.schemaFingerprint,
          tables: result.tables.length,
        })
        return c.json(result)
      },
    ),
)
