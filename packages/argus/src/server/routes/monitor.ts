import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Monitor } from "../../argus/monitor"
import { CommandQueue } from "../../argus/brain"
import { lazy } from "../../util/lazy"
import { errors } from "../error"
import { randomBytes } from "crypto"

export const MonitorRoutes = lazy(
  () =>
    new Hono()
      .get(
        "/status",
        describeRoute({
          summary: "Get monitor status",
          description: "Retrieve the current status of the screen monitor.",
          operationId: "monitor.status",
          responses: {
            200: {
              description: "Monitor status",
              content: {
                "application/json": {
                  schema: resolver(
                    z.object({
                      state: z.enum(["stopped", "running", "paused"]),
                      config: z
                        .object({
                          enabled: z.boolean(),
                          captureInterval: z.number(),
                          diffThreshold: z.number(),
                          autonomyLevel: z.number(),
                          captureMode: z.string(),
                          brainEnabled: z.boolean(),
                        })
                        .nullable(),
                    }),
                  ),
                },
              },
            },
          },
        }),
        async (c) => {
          const result = Monitor.status()
          return c.json(result)
        },
      )
      .post(
        "/start",
        describeRoute({
          summary: "Start monitor",
          description: "Start the screen monitor with optional configuration overrides.",
          operationId: "monitor.start",
          responses: {
            200: {
              description: "Monitor started",
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
          z
            .object({
              captureInterval: z.number().optional(),
              diffThreshold: z.number().optional(),
              autonomyLevel: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
              captureMode: z.enum(["window", "fullscreen"]).optional(),
              windowTitle: z.string().optional(),
              brainEnabled: z.boolean().optional(),
            })
            .optional(),
        ),
        async (c) => {
          const body = c.req.valid("json")
          await Monitor.start(body ?? undefined)
          return c.json(true)
        },
      )
      .post(
        "/stop",
        describeRoute({
          summary: "Stop monitor",
          description: "Stop the screen monitor.",
          operationId: "monitor.stop",
          responses: {
            200: {
              description: "Monitor stopped",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
          },
        }),
        async (c) => {
          await Monitor.stop()
          return c.json(true)
        },
      )
      .post(
        "/pause",
        describeRoute({
          summary: "Pause monitor",
          description: "Pause the screen monitor without stopping it.",
          operationId: "monitor.pause",
          responses: {
            200: {
              description: "Monitor paused",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
          },
        }),
        async (c) => {
          await Monitor.pause()
          return c.json(true)
        },
      )
      .post(
        "/resume",
        describeRoute({
          summary: "Resume monitor",
          description: "Resume a paused screen monitor.",
          operationId: "monitor.resume",
          responses: {
            200: {
              description: "Monitor resumed",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
          },
        }),
        async (c) => {
          await Monitor.resume()
          return c.json(true)
        },
      )
      .post(
        "/command",
        describeRoute({
          summary: "Stage command",
          description: "Stage a command for the monitor brain to process.",
          operationId: "monitor.command.stage",
          responses: {
            200: {
              description: "Command staged",
              content: {
                "application/json": {
                  schema: resolver(
                    z.object({
                      staged: z.boolean(),
                      id: z.string(),
                    }),
                  ),
                },
              },
            },
            ...errors(400),
          },
        }),
        validator(
          "json",
          z.object({
            content: z.string(),
            priority: z.enum(["urgent", "high", "normal", "low"]).default("normal"),
          }),
        ),
        async (c) => {
          const body = c.req.valid("json")
          const id = `cmd_${Date.now().toString(36)}_${randomBytes(6).toString("hex")}`
          CommandQueue.stage({
            id,
            timestamp: Date.now(),
            priority: body.priority,
            source: "user",
            content: body.content,
          })
          return c.json({ staged: true, id })
        },
      )
      .get(
        "/queue",
        describeRoute({
          summary: "List queued commands",
          description: "List all commands currently in the staging queue.",
          operationId: "monitor.queue.list",
          responses: {
            200: {
              description: "Queued commands",
              content: {
                "application/json": {
                  schema: resolver(
                    z.array(
                      z.object({
                        id: z.string(),
                        timestamp: z.number(),
                        priority: z.string(),
                        source: z.string(),
                        content: z.string(),
                      }),
                    ),
                  ),
                },
              },
            },
          },
        }),
        async (c) => {
          return c.json(CommandQueue.list())
        },
      ),
)
