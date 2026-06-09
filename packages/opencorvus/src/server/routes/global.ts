import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Instance } from "../../project/instance"
import { Installation } from "@/installation"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { Config } from "../../config/config"
import { Database } from "../../storage/db"
import { errors } from "../error"

const log = Log.create({ service: "server" })

export const GlobalDisposedEvent = BusEvent.define("global.disposed", z.object({}))

export const GlobalRoutes = lazy(() =>
  new Hono()
    .get(
      "/health",
      describeRoute({
        summary: "Get health",
        description:
          "Get health information about the OpenCorvus server, including the runtime-resolved on-disk paths the engine is actually using (database, data dir, home). The DB path is resolved by `Database.Path()` and is always the single global SQLite location for this server process — UIs should read this rather than rebuilding the path from a template.",
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
          stream.writeSSE({
            data: JSON.stringify({
              payload: {
                type: "server.connected",
                properties: {},
              },
            }),
          })
          async function handler(event: any) {
            await stream.writeSSE({
              data: JSON.stringify(event),
            })
          }
          GlobalBus.on("event", handler)

          // Send heartbeat every 10s to prevent stalled proxy streams.
          const heartbeat = setInterval(() => {
            stream.writeSSE({
              data: JSON.stringify({
                payload: {
                  type: "server.heartbeat",
                  properties: {},
                },
              }),
            })
          }, 10_000)

          await new Promise<void>((resolve) => {
            stream.onAbort(() => {
              clearInterval(heartbeat)
              GlobalBus.off("event", handler)
              resolve()
              log.info("global event disconnected")
            })
          })
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
        },
      }),
      async (c) => {
        const { hasActiveSessions } = await import("@/engine/runtime")
        if (hasActiveSessions()) {
          return c.json({ error: "Active executor sessions exist, skipping dispose" }, 409)
        }
        await Instance.disposeAll()
        GlobalBus.emit("event", {
          directory: "global",
          payload: {
            type: GlobalDisposedEvent.type,
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
          "DESTRUCTIVE. Disposes all in-memory Instance handles, closes the global SQLite DB, and removes the DB file (with WAL/SHM), snapshot scratch, and the specified project's worktree/ownership markers under <projectDir>/.opencorvus/. Caller must specify projectDir so project-scoped scratch can be removed alongside the shared DB. Schema is rebuilt from DDL on next access. Active executor sessions block the reset (409).",
        operationId: "global.db.reset",
        responses: {
          200: {
            description: "Reset results",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    ok: z.boolean(),
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
          ...errors(409),
        },
      }),
      validator(
        "json",
        z.object({
          projectDir: z
            .string()
            .describe(
              "Absolute filesystem path of the project whose .opencorvus scratch directories should be wiped alongside the shared DB.",
            ),
        }),
      ),
      async (c) => {
        const { projectDir } = c.req.valid("json")
        const { hasActiveSessions } = await import("@/engine/runtime")
        if (hasActiveSessions()) {
          return c.json({ error: "Active executor sessions exist, refusing DB reset" }, 409)
        }
        await Instance.disposeAll().catch(() => undefined)
        const targets = await Database.reset(projectDir)
        log.warn("db reset via /global/db/reset", { projectDir, targets })
        return c.json({ ok: targets.every((t) => t.ok), targets })
      },
    ),
)
